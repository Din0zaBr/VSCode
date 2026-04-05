#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Installs the LogVault agent as a Windows service using NSSM.

.DESCRIPTION
    - Downloads and installs NSSM (Non-Sucking Service Manager) if not present.
    - Installs pywin32 for Windows Event Log access.
    - Registers the agent as a persistent Windows service.
    - Grants read access to the Security Event Log channel.

.PARAMETER ServerUrl
    URL of the LogVault server, e.g. http://10.0.0.1:8000

.PARAMETER AgentId
    Unique agent identifier for this host.

.PARAMETER ApiKey
    API key configured on the server (AGENT_API_KEY env var).

.PARAMETER InstallDir
    Directory where the agent will be installed.
    Default: C:\Program Files\logvault-agent

.PARAMETER DataDir
    Directory for offsets, buffer DB, and config.
    Default: C:\ProgramData\logvault-agent

.PARAMETER ServiceName
    Windows service name. Default: logvault-agent

.PARAMETER PythonExe
    Path to the Python interpreter. Default: python

.EXAMPLE
    .\install-windows.ps1 -ServerUrl http://10.0.0.5:8000 -AgentId win-dc01 -ApiKey secret123
#>

param(
    [Parameter(Mandatory)][string]$ServerUrl,
    [Parameter(Mandatory)][string]$AgentId,
    [Parameter(Mandatory)][string]$ApiKey,
    [string]$InstallDir  = "C:\Program Files\logvault-agent",
    [string]$DataDir     = "C:\ProgramData\logvault-agent",
    [string]$ServiceName = "logvault-agent",
    [string]$PythonExe   = "python"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Helper functions ─────────────────────────────────────────────────────────

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-OK([string]$msg)   { Write-Host "    OK: $msg"   -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "    WARN: $msg" -ForegroundColor Yellow }

function Ensure-Directory([string]$path) {
    if (-not (Test-Path $path)) {
        New-Item -ItemType Directory -Force -Path $path | Out-Null
        Write-OK "Created $path"
    }
}

function Get-NssmExe {
    $local = Join-Path $DataDir "nssm.exe"
    if (Test-Path $local) { return $local }

    # Try system PATH first
    $sys = Get-Command nssm -ErrorAction SilentlyContinue
    if ($sys) { return $sys.Source }

    # Download portable NSSM
    Write-Step "Downloading NSSM..."
    $nssmZip = Join-Path $env:TEMP "nssm.zip"
    $nssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
    Invoke-WebRequest -Uri $nssmUrl -OutFile $nssmZip -UseBasicParsing
    Expand-Archive -Path $nssmZip -DestinationPath (Join-Path $env:TEMP "nssm") -Force
    $nssmSrc = if ([Environment]::Is64BitOperatingSystem) {
        Join-Path $env:TEMP "nssm\nssm-2.24\win64\nssm.exe"
    } else {
        Join-Path $env:TEMP "nssm\nssm-2.24\win32\nssm.exe"
    }
    Copy-Item $nssmSrc $local -Force
    Write-OK "NSSM saved to $local"
    return $local
}

# ── Pre-flight checks ─────────────────────────────────────────────────────────

Write-Step "Checking Python..."
try {
    $pyVer = & $PythonExe --version 2>&1
    Write-OK "$pyVer"
} catch {
    Write-Error "Python not found at '$PythonExe'. Install Python 3.10+ and re-run."
    exit 1
}

# ── Create directories ────────────────────────────────────────────────────────

Write-Step "Creating directories..."
Ensure-Directory $InstallDir
Ensure-Directory $DataDir
Ensure-Directory (Join-Path $DataDir "offsets")

# ── Install Python dependencies ───────────────────────────────────────────────

Write-Step "Installing Python dependencies..."
$reqFile = Join-Path $PSScriptRoot "requirements-windows.txt"
& $PythonExe -m pip install --quiet --upgrade pip
& $PythonExe -m pip install --quiet -r $reqFile
if ($LASTEXITCODE -ne 0) {
    Write-Error "pip install failed."
    exit 1
}
Write-OK "Python packages installed"

# Run pywin32 post-install to register DLLs
Write-Step "Registering pywin32 COM objects..."
$pyScripts = & $PythonExe -c "import sys; print(sys.prefix + r'\Scripts')"
$postInstall = Join-Path $pyScripts "pywin32_postinstall.py"
if (Test-Path $postInstall) {
    & $PythonExe $postInstall -install 2>&1 | Out-Null
    Write-OK "pywin32 registered"
} else {
    Write-Warn "pywin32_postinstall.py not found — skip (may work anyway)"
}

# ── Write config file ─────────────────────────────────────────────────────────

Write-Step "Writing agent config..."
$configPath = Join-Path $DataDir "config.yaml"
$bufferDb   = Join-Path $DataDir "buffer.db"

@"
server_url: "$ServerUrl"
agent_id: "$AgentId"
api_key: "$ApiKey"
hostname: ""

batch_size: 200
flush_interval: 2.0
retry_base: 1.0
retry_max: 60.0
buffer_db: "$($bufferDb.Replace('\','/'))"

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
      - 4624
      - 4625
      - 4634
      - 4648
      - 4672
      - 4688
      - 4698
      - 4720
      - 4726
      - 4740
      - 7045
"@ | Set-Content -Encoding UTF8 $configPath
Write-OK "Config written to $configPath"

# ── Grant Security Event Log read access ──────────────────────────────────────

Write-Step "Granting Security Event Log read access to SYSTEM..."
try {
    # O:BA = owner Builtin\Admins; G:SY = group SYSTEM
    # (A;;0x2;;;BA) = Allow Read to Builtin\Admins
    # (A;;0x2;;;SY) = Allow Read to SYSTEM  <-- this is what the service needs
    $currentSddl = (wevtutil gl Security | Select-String "channelAccess").ToString().Split(": ")[1]
    if ($currentSddl -notmatch "A;;0x2;;;SY") {
        wevtutil sl Security /ca:"$currentSddl(A;;0x2;;;SY)"
        Write-OK "Security channel access updated"
    } else {
        Write-OK "Security channel already accessible to SYSTEM"
    }
} catch {
    Write-Warn "Could not update Security log ACL: $_"
    Write-Warn "Security events may not be collected if service runs as a limited user."
}

# ── Copy agent source to install directory ────────────────────────────────────

Write-Step "Copying agent files to $InstallDir..."
$srcRoot = $PSScriptRoot
# Copy src/ and top-level Python files
$itemsToCopy = @("src", "agent", "requirements.txt", "requirements-windows.txt")
foreach ($item in $itemsToCopy) {
    $srcPath = Join-Path $srcRoot $item
    if (Test-Path $srcPath) {
        Copy-Item -Path $srcPath -Destination $InstallDir -Recurse -Force
    }
}
Write-OK "Agent files copied"

# ── Register Windows service via NSSM ────────────────────────────────────────

$nssm = Get-NssmExe

Write-Step "Registering Windows service '$ServiceName'..."

# Stop and remove if already installed
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Warn "Service '$ServiceName' already exists — reinstalling..."
    & $nssm stop  $ServiceName confirm 2>&1 | Out-Null
    & $nssm remove $ServiceName confirm 2>&1 | Out-Null
}

# Locate the main.py entrypoint
$mainPy = Join-Path $InstallDir "src\main.py"

& $nssm install $ServiceName $PythonExe
& $nssm set     $ServiceName AppParameters "-m agent.src.main `"$configPath`""
& $nssm set     $ServiceName AppDirectory   $InstallDir
& $nssm set     $ServiceName DisplayName   "LogVault Agent"
& $nssm set     $ServiceName Description   "Collects logs and forwards them to the LogVault SIEM server."
& $nssm set     $ServiceName Start          SERVICE_AUTO_START
& $nssm set     $ServiceName ObjectName     LocalSystem
& $nssm set     $ServiceName AppStdout      (Join-Path $DataDir "agent-stdout.log")
& $nssm set     $ServiceName AppStderr      (Join-Path $DataDir "agent-stderr.log")
& $nssm set     $ServiceName AppRotateFiles 1
& $nssm set     $ServiceName AppRotateBytes 10485760   # 10 MB

Write-OK "Service '$ServiceName' registered"

# ── Start the service ─────────────────────────────────────────────────────────

Write-Step "Starting service..."
& $nssm start $ServiceName
if ($LASTEXITCODE -eq 0) {
    Write-OK "Service started successfully"
} else {
    Write-Warn "Service start returned exit code $LASTEXITCODE — check logs in $DataDir"
}

# ── Summary ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "────────────────────────────────────────────────" -ForegroundColor Green
Write-Host " LogVault Agent installed successfully!" -ForegroundColor Green
Write-Host "────────────────────────────────────────────────" -ForegroundColor Green
Write-Host " Service name : $ServiceName"
Write-Host " Config file  : $configPath"
Write-Host " Log output   : $DataDir\agent-stdout.log"
Write-Host " Log errors   : $DataDir\agent-stderr.log"
Write-Host ""
Write-Host " Useful commands:"
Write-Host "   Start   : nssm start $ServiceName"
Write-Host "   Stop    : nssm stop $ServiceName"
Write-Host "   Status  : Get-Service $ServiceName"
Write-Host "   Logs    : Get-Content $DataDir\agent-stderr.log -Tail 50"
Write-Host ""
