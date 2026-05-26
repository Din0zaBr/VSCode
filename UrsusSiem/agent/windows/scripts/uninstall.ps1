#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Removes the LogVault Agent scheduled task and optionally deletes all data.

.DESCRIPTION
    - Stops any running agent (python) process started by the LogVault task.
    - Unregisters the "LogVault Agent" scheduled task.
    - Removes the autostart VBS entry from the current user's Startup folder.
    - When -RemoveData is specified, also deletes the entire data directory
      (C:\ProgramData\logvault-agent), including config.yaml and the buffer DB.

.PARAMETER RemoveData
    Switch. If supplied, the data directory C:\ProgramData\logvault-agent is
    deleted after the task is removed. Prompts for confirmation unless -Force
    is also supplied.

.PARAMETER Force
    Switch. Suppresses the confirmation prompt when -RemoveData is used.

.PARAMETER DataDir
    Path to the agent data directory. Default: C:\ProgramData\logvault-agent

.PARAMETER TaskName
    Scheduled task name. Default: LogVault Agent

.EXAMPLE
    # Remove the task only (keep config + data)
    .\uninstall.ps1

.EXAMPLE
    # Remove everything including config and buffer DB
    .\uninstall.ps1 -RemoveData

.EXAMPLE
    # Non-interactive full removal
    .\uninstall.ps1 -RemoveData -Force
#>

param(
    [switch]$RemoveData,
    [switch]$Force,
    [string]$DataDir  = "C:\ProgramData\logvault-agent",
    [string]$TaskName = "LogVault Agent"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step([string]$m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-OK([string]$m)   { Write-Host "    OK   $m" -ForegroundColor Green }
function Write-Warn([string]$m) { Write-Host "    WARN $m" -ForegroundColor Yellow }
function Write-Info([string]$m) { Write-Host "    ...  $m" -ForegroundColor Gray }

# ── 1. Stop running agent process ─────────────────────────────────────────────
Write-Step "Stopping running agent process (if any)..."

# The agent runs as a python subprocess spawned by the scheduled task.
# Identify processes whose command line references the logvault-agent path.
$stopped = $false
try {
    $procs = Get-WmiObject Win32_Process -Filter "Name='python.exe' OR Name='python3.exe'" `
             -ErrorAction SilentlyContinue
    foreach ($p in $procs) {
        $cmdLine = $p.CommandLine
        if ($cmdLine -and ($cmdLine -match "logvault" -or $cmdLine -match "logvault-agent")) {
            Write-Info "Stopping PID $($p.ProcessId): $cmdLine"
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
            $stopped = $true
        }
    }
} catch {
    Write-Warn "WMI query failed, falling back to process name search: $_"
    # Broad fallback — only safe if the user knows no other Python process is needed
    Get-Process -Name python  -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Get-Process -Name python3 -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    $stopped = $true
}

if ($stopped) {
    Write-OK "Agent process stopped"
} else {
    Write-Info "No running agent process found"
}

# Also stop wscript.exe if it is running the LogVault VBS launcher
try {
    $wscripts = Get-WmiObject Win32_Process -Filter "Name='wscript.exe'" -ErrorAction SilentlyContinue
    foreach ($p in $wscripts) {
        if ($p.CommandLine -and $p.CommandLine -match "logvault") {
            Write-Info "Stopping wscript.exe PID $($p.ProcessId)"
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
} catch {
    Write-Warn "Could not enumerate wscript.exe processes: $_"
}

# ── 2. Remove scheduled task ──────────────────────────────────────────────────
Write-Step "Removing scheduled task '$TaskName'..."

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-OK "Scheduled task '$TaskName' removed"
} else {
    Write-Info "Scheduled task '$TaskName' not found — already removed or never registered"
}

# ── 3. Remove Startup folder autostart entry ──────────────────────────────────
Write-Step "Removing Startup folder entry..."

$startupDir = [System.Environment]::GetFolderPath("Startup")
$startupVbs = Join-Path $startupDir "logvault-agent.vbs"

if (Test-Path $startupVbs) {
    Remove-Item $startupVbs -Force
    Write-OK "Removed autostart entry: $startupVbs"
} else {
    Write-Info "Startup entry not found at $startupVbs"
}

# Also check All Users startup
$allUsersStartup = [System.Environment]::GetFolderPath("CommonStartup")
$allUsersVbs     = Join-Path $allUsersStartup "logvault-agent.vbs"
if (Test-Path $allUsersVbs) {
    Remove-Item $allUsersVbs -Force
    Write-OK "Removed All Users autostart entry: $allUsersVbs"
}

# ── 4. Optionally remove data directory ───────────────────────────────────────
if ($RemoveData) {
    Write-Step "Removing data directory '$DataDir'..."

    if (Test-Path $DataDir) {
        if (-not $Force) {
            $reply = Read-Host "    This will permanently delete '$DataDir' including config.yaml and the buffer DB. Continue? [y/N]"
            if ($reply -notmatch '^[Yy]$') {
                Write-Warn "Data removal cancelled by user. Directory left intact."
                $RemoveData = $false
            }
        }

        if ($RemoveData) {
            Remove-Item $DataDir -Recurse -Force
            Write-OK "Data directory '$DataDir' deleted"
        }
    } else {
        Write-Info "Data directory '$DataDir' not found — nothing to delete"
    }
} else {
    Write-Host ""
    Write-Host "    Config and data preserved at: $DataDir" -ForegroundColor Yellow
    Write-Host "    Run with -RemoveData to delete them as well." -ForegroundColor Yellow
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "─────────────────────────────────────────────────" -ForegroundColor Green
Write-Host " LogVault Agent uninstalled successfully." -ForegroundColor Green
Write-Host "─────────────────────────────────────────────────" -ForegroundColor Green
if (-not $RemoveData -and (Test-Path $DataDir)) {
    Write-Host " Config left at : $DataDir\config.yaml"
    Write-Host " Buffer DB left : $DataDir\buffer.db"
    Write-Host " Re-install     : .\install-windows.ps1 -ServerUrl <url> -ApiKey <key>"
}
Write-Host ""
