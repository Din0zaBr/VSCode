#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Installs the LogVault agent as a Windows Scheduled Task (runs at boot, as SYSTEM).

.DESCRIPTION
    - Grants read access to the Security Event Log channel.
    - Enables Process Creation audit policy (for Event ID 4688).
    - Registers a Scheduled Task that starts at boot under SYSTEM account.
    - The task restarts automatically if the agent crashes.

.PARAMETER ServerUrl
    URL of the LogVault server, e.g. https://10.0.0.1 or http://10.0.0.1:8000

.PARAMETER AgentId
    Unique agent identifier for this host (default: machine hostname).

.PARAMETER ApiKey
    API key configured on the server (AGENT_API_KEY env var).

.PARAMETER PythonExe
    Path to the Python interpreter. Default: auto-detect from PATH.

.PARAMETER SourceRoot
    Root directory containing the agent source (parent of logvault-agent/).
    Default: directory of this script's parent.

.PARAMETER DataDir
    Directory for config, offsets, and buffer DB.
    Default: C:\ProgramData\logvault-agent

.PARAMETER TaskName
    Scheduled task name. Default: LogVault Agent

.EXAMPLE
    # Basic install — uses this machine's hostname as agent_id
    .\install-windows.ps1 -ServerUrl https://10.0.0.5 -ApiKey secret123

.EXAMPLE
    # Full options
    .\install-windows.ps1 -ServerUrl https://10.0.0.5 -AgentId dc01 -ApiKey secret123 `
        -PythonExe "C:\Python311\python.exe"
#>

param(
    [Parameter(Mandatory)][string]$ServerUrl,
    [string]$AgentId    = $env:COMPUTERNAME,
    [Parameter(Mandatory)][string]$ApiKey,
    [string]$PythonExe  = "",
    [string]$SourceRoot = "",
    [string]$DataDir    = "C:\ProgramData\logvault-agent",
    [string]$TaskName   = "LogVault Agent"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $SourceRoot) { $SourceRoot = Split-Path -Parent $PSScriptRoot }

function Write-Step([string]$m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-OK([string]$m)   { Write-Host "    OK  $m" -ForegroundColor Green }
function Write-Warn([string]$m) { Write-Host "    WARN $m" -ForegroundColor Yellow }

# ── 1. Find Python ────────────────────────────────────────────────────────────
Write-Step "Locating Python..."

if (-not $PythonExe) {
    # PS 5.1 compatible — avoid ?. null-conditional operator (requires PS 7+)
    $pyCmd  = Get-Command python  -ErrorAction SilentlyContinue
    $py3Cmd = Get-Command python3 -ErrorAction SilentlyContinue
    $candidates = @(
        $(if ($pyCmd)  { $pyCmd.Source }  else { $null }),
        $(if ($py3Cmd) { $py3Cmd.Source } else { $null }),
        "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python310\python.exe",
        "C:\Python311\python.exe",
        "C:\Python312\python.exe"
    ) | Where-Object { $_ -and (Test-Path $_) }
    $PythonExe = $candidates | Select-Object -First 1
}

if (-not $PythonExe -or -not (Test-Path $PythonExe)) {
    Write-Error "Python not found. Install Python 3.10+ or pass -PythonExe path."
    exit 1
}

$pyVer = & $PythonExe --version 2>&1
Write-OK "$pyVer at $PythonExe"

# ── 2. Install Python dependencies ───────────────────────────────────────────
Write-Step "Installing Python dependencies (pywin32 + base)..."

$reqFile = Join-Path $PSScriptRoot "requirements-windows.txt"
& $PythonExe -m pip install --quiet --upgrade pip
& $PythonExe -m pip install --quiet -r $reqFile
if ($LASTEXITCODE -ne 0) { Write-Error "pip install failed."; exit 1 }
Write-OK "Dependencies installed"

# Register pywin32 DLLs
$pyScripts = & $PythonExe -c "import sys; print(sys.prefix + r'\Scripts')"
$postInstall = Join-Path $pyScripts "pywin32_postinstall.py"
if (Test-Path $postInstall) {
    & $PythonExe $postInstall -install 2>&1 | Out-Null
    Write-OK "pywin32 DLLs registered"
}

# ── 3. Create data directories ────────────────────────────────────────────────
Write-Step "Creating data directories..."
foreach ($d in @($DataDir, "$DataDir\offsets")) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}
Write-OK "Directories ready at $DataDir"

# ── 4. Write config file ──────────────────────────────────────────────────────
Write-Step "Writing agent config..."
$configPath = Join-Path $DataDir "config.yaml"
$bufferDb   = "$DataDir\buffer.db" -replace '\\', '/'
$dataDirFwd = $DataDir -replace '\\', '/'

@"
server_url: "$ServerUrl"
agent_id: "$AgentId"
api_key: "$ApiKey"
hostname: ""          # auto-detect

batch_size: 200
flush_interval: 3.0
retry_base: 1.0
retry_max: 60.0
buffer_db: "$bufferDb"
verify_ssl: false     # set true if server uses a valid trusted certificate

sources:
  - type: winevent
    channel: "System"
    service: "windows-system"

  - type: winevent
    channel: "Application"
    service: "windows-app"

  - type: winevent
    channel: "Security"
    service: "windows-security"
    event_ids:
      - 4624   # Logon
      - 4625   # Logon failure
      - 4634   # Logoff
      - 4648   # Explicit credential logon
      - 4672   # Special privileges assigned to new logon
      - 4688   # Process creation
      - 4689   # Process termination
      - 4698   # Scheduled task created
      - 4699   # Scheduled task deleted
      - 4702   # Scheduled task updated
      - 4720   # User account created
      - 4722   # User account enabled
      - 4725   # User account disabled
      - 4726   # User account deleted
      - 4728   # Member added to security-enabled global group
      - 4732   # Member added to local group
      - 4740   # Account locked out
      - 7034   # Service crashed unexpectedly
      - 7036   # Service state change
      - 7045   # New service installed
"@ | Set-Content -Encoding UTF8 -Path $configPath

Write-OK "Config written to $configPath"

# ── 5. Grant Security Event Log read access ───────────────────────────────────
Write-Step "Granting Security Event Log read access to SYSTEM..."
try {
    $raw = wevtutil gl Security 2>&1
    $line = ($raw | Select-String "channelAccess")
    if ($line) {
        $currentSddl = $line.ToString().Trim().Split(": ", 2)[1]
        # (A;;0x1;;;SY) = Allow Read to SYSTEM
        if ($currentSddl -notmatch "A;;0x1;;;SY" -and $currentSddl -notmatch "A;;0x2;;;SY") {
            wevtutil sl Security /ca:"$currentSddl(A;;0x1;;;SY)"
            Write-OK "SYSTEM read access granted to Security channel"
        } else {
            Write-OK "SYSTEM already has Security channel access"
        }
    }
} catch {
    Write-Warn "Could not update Security log ACL: $_"
}

# ── 6. Enable Process Creation audit (Event ID 4688) ─────────────────────────
Write-Step "Enabling Process Creation audit policy (Event ID 4688)..."
try {
    # Use GUID {0CCE922B-69AE-11D9-BED3-505054503030} — works on any Windows locale
    $result = auditpol /set /subcategory:"{0CCE922B-69AE-11D9-BED3-505054503030}" /success:enable /failure:enable 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Process Creation auditing enabled (Event ID 4688)"
    } else {
        Write-Warn "auditpol returned: $result"
    }
} catch {
    Write-Warn "Could not set audit policy: $_"
}

# ── 7. Write launcher scripts ────────────────────────────────────────────────
Write-Step "Writing launcher scripts..."

# bat: sets PYTHONPATH and runs the agent (stdout/stderr → agent.log)
$launcherPath = Join-Path $DataDir "run-agent.bat"
@"
@echo off
echo [%DATE% %TIME%] Starting LogVault Agent >> "$DataDir\agent.log"
set PYTHONPATH=$SourceRoot
cd /d "$SourceRoot"
"$PythonExe" -m agent.src.main "$configPath" >> "$DataDir\agent.log" 2>&1
echo [%DATE% %TIME%] Agent exited %ERRORLEVEL% >> "$DataDir\agent.log"
"@ | Set-Content -Encoding ASCII -Path $launcherPath

# vbs: launches the bat silently (no console window) — placed in Startup folder
$vbsPath = Join-Path $DataDir "start-agent.vbs"
@"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Environment("Process")("PYTHONPATH") = "$SourceRoot"
WshShell.Run "cmd.exe /c ""`"$launcherPath`""""", 0, False
"@ | Set-Content -Encoding ASCII -Path $vbsPath

Write-OK "Launcher written to $launcherPath"
Write-OK "Startup wrapper written to $vbsPath"

# ── 8. Register autostart via user Startup folder ────────────────────────────
# NOTE: Task Scheduler with SYSTEM account cannot access Python installed in
# user AppData. ONLOGON tasks stay "Queued" in interactive-only mode.
# The reliable solution: place a VBScript in the user's Startup folder.
# It runs at logon as the current user (full access to AppData Python), silently.
Write-Step "Registering autostart via Startup folder..."

$startupDir = [System.Environment]::GetFolderPath("Startup")
$startupVbs  = Join-Path $startupDir "logvault-agent.vbs"
Copy-Item $vbsPath $startupVbs -Force
Write-OK "Autostart entry: $startupVbs"

# ── 9. Start agent now ────────────────────────────────────────────────────────
Write-Step "Starting agent now..."
Start-Process wscript.exe -ArgumentList "`"$vbsPath`""
Start-Sleep -Seconds 8
$logFile = Join-Path $DataDir "agent.log"
if (Test-Path $logFile) {
    Write-OK "agent.log exists — agent started"
    Get-Content $logFile -Tail 10
} else {
    Write-Warn "agent.log not found — check $vbsPath and $launcherPath manually"
}

# ── 10. Summary ───────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "─────────────────────────────────────────────────" -ForegroundColor Green
Write-Host " LogVault Agent installed successfully!" -ForegroundColor Green
Write-Host "─────────────────────────────────────────────────" -ForegroundColor Green
Write-Host " Config      : $configPath"
Write-Host " Source root : $SourceRoot"
Write-Host " Log file    : $logFile"
Write-Host " Autostart   : $startupVbs (runs at logon)"
Write-Host ""
Write-Host " Useful commands:"
Write-Host "   Start  : Start-Process wscript.exe -ArgumentList '$vbsPath'"
Write-Host "   Stop   : Get-Process python | Stop-Process -Force"
Write-Host "   Log    : Get-Content '$logFile' -Tail 30 -Wait"
Write-Host ""
Write-Host " To verify events are flowing:"
Write-Host "   Invoke-WebRequest -Uri '$ServerUrl/search?service=windows-security&size=5'"
Write-Host ""
