#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Interactive configuration helper for the LogVault Agent on Windows.

.DESCRIPTION
    Generates C:\ProgramData\logvault-agent\config.yaml with Windows Event Log
    sources (Security, System, Application).  All parameters can be supplied on
    the command line; any that are omitted are prompted for interactively.

    The script also creates the data directory and the offsets sub-directory if
    they do not already exist.

.PARAMETER ServerUrl
    Base URL of the LogVault server, e.g. https://10.0.0.5 or http://10.0.0.5:8000
    Required (prompted if omitted).

.PARAMETER AgentId
    Unique identifier for this agent/host. Default: current machine hostname.

.PARAMETER ApiKey
    API key configured on the server (AGENT_API_KEY). Required (prompted if omitted).

.PARAMETER DataDir
    Directory for config, offsets, and buffer DB.
    Default: C:\ProgramData\logvault-agent

.PARAMETER BatchSize
    Number of events sent per HTTP batch. Default: 200

.PARAMETER FlushInterval
    Seconds between batch flushes. Default: 3.0

.PARAMETER VerifySsl
    Whether to verify the server TLS certificate. Default: false.
    Set to true when the server uses a certificate from a trusted CA.

.PARAMETER IncludeSysmon
    Switch. Add Microsoft-Windows-Sysmon/Operational as an event source if
    Sysmon is installed.

.PARAMETER IncludePowerShell
    Switch. Add Microsoft-Windows-PowerShell/Operational as an event source.

.PARAMETER Overwrite
    Switch. Overwrite an existing config.yaml without prompting.

.EXAMPLE
    # Fully interactive — will prompt for server URL and API key
    .\configure.ps1

.EXAMPLE
    # Provide all required values on the command line
    .\configure.ps1 -ServerUrl https://10.0.0.5 -ApiKey secret123

.EXAMPLE
    # Include Sysmon and PowerShell sources, overwrite existing config
    .\configure.ps1 -ServerUrl https://10.0.0.5 -ApiKey secret123 `
        -IncludeSysmon -IncludePowerShell -Overwrite
#>

param(
    [string]$ServerUrl       = "",
    [string]$AgentId         = $env:COMPUTERNAME,
    [string]$ApiKey          = "",
    [string]$DataDir         = "C:\ProgramData\logvault-agent",
    [int]   $BatchSize       = 200,
    [double]$FlushInterval   = 3.0,
    [bool]  $VerifySsl       = $false,
    [switch]$IncludeSysmon,
    [switch]$IncludePowerShell,
    [switch]$Overwrite
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step([string]$m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-OK([string]$m)   { Write-Host "    OK   $m" -ForegroundColor Green }
function Write-Warn([string]$m) { Write-Host "    WARN $m" -ForegroundColor Yellow }
function Write-Info([string]$m) { Write-Host "    ...  $m" -ForegroundColor Gray }

function Prompt-Required([string]$label, [string]$current, [string]$hint = "") {
    if ($current) { return $current }
    $display = if ($hint) { "${label} [${hint}]: " } else { "${label}: " }
    $value = ""
    while (-not $value) {
        $value = (Read-Host $display).Trim()
        if (-not $value) { Write-Host "    Value is required." -ForegroundColor Red }
    }
    return $value
}

function Prompt-Optional([string]$label, [string]$current, [string]$default) {
    if ($current -and $current -ne $default) { return $current }
    $display = "${label} [default: ${default}]: "
    $value = (Read-Host $display).Trim()
    if (-not $value) { return $default }
    return $value
}

# ── 1. Collect / prompt for required parameters ────────────────────────────────
Write-Host ""
Write-Host "  LogVault Agent — Configuration Helper" -ForegroundColor Cyan
Write-Host "  ──────────────────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host ""

$ServerUrl = Prompt-Required "Server URL" $ServerUrl "e.g. https://10.0.0.5 or http://10.0.0.5:8000"
$AgentId   = Prompt-Optional "Agent ID"   $AgentId   $env:COMPUTERNAME
$ApiKey    = Prompt-Required "API key"    $ApiKey    "value of AGENT_API_KEY on the server"

# Normalise: strip trailing slash from server URL
$ServerUrl = $ServerUrl.TrimEnd('/')

# ── 2. Create data directories ─────────────────────────────────────────────────
Write-Step "Preparing data directory..."

foreach ($d in @($DataDir, "$DataDir\offsets")) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Force -Path $d | Out-Null
        Write-OK "Created $d"
    } else {
        Write-Info "Already exists: $d"
    }
}

# ── 3. Check for existing config ──────────────────────────────────────────────
$configPath = Join-Path $DataDir "config.yaml"
$bufferDb   = ($DataDir + "\buffer.db") -replace '\\', '/'

if ((Test-Path $configPath) -and (-not $Overwrite)) {
    $reply = Read-Host "`n    Config already exists at '$configPath'. Overwrite? [y/N]"
    if ($reply -notmatch '^[Yy]$') {
        Write-Warn "Configuration cancelled — existing config left unchanged."
        exit 0
    }
}

# ── 4. Detect optional channels ───────────────────────────────────────────────
Write-Step "Detecting available optional event channels..."

$sysmonAvailable = $false
if ($IncludeSysmon) {
    try {
        $result = wevtutil gl "Microsoft-Windows-Sysmon/Operational" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $sysmonAvailable = $true
            Write-OK "Sysmon channel detected"
        } else {
            Write-Warn "Sysmon channel not found. Sysmon may not be installed."
            Write-Info "Download from: https://docs.microsoft.com/sysinternals/downloads/sysmon"
        }
    } catch {
        Write-Warn "Could not query Sysmon channel: $_"
    }
}

$psLogAvailable = $false
if ($IncludePowerShell) {
    try {
        $result = wevtutil gl "Microsoft-Windows-PowerShell/Operational" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $psLogAvailable = $true
            Write-OK "PowerShell/Operational channel detected"
        } else {
            Write-Warn "PowerShell/Operational channel not found."
        }
    } catch {
        Write-Warn "Could not query PowerShell channel: $_"
    }
}

# ── 5. Build optional source blocks ──────────────────────────────────────────
$optionalSources = ""

if ($sysmonAvailable) {
    $optionalSources += @"

  # ── Sysmon (process creation, network, file, registry events) ──────────────
  - type: winevent
    channel: "Microsoft-Windows-Sysmon/Operational"
    service: "sysmon"
"@
}

if ($psLogAvailable) {
    $optionalSources += @"

  # ── PowerShell script block logging ─────────────────────────────────────────
  - type: winevent
    channel: "Microsoft-Windows-PowerShell/Operational"
    service: "powershell"
    event_ids:
      - 4103   # Module logging
      - 4104   # Script block logging
      - 4105   # Start command
      - 4106   # Stop command
"@
}

# ── 6. Write config.yaml ──────────────────────────────────────────────────────
Write-Step "Writing config to $configPath..."

$verifySslStr = if ($VerifySsl) { "true" } else { "false" }

$configContent = @"
# LogVault Agent — configuration file
# Generated by configure.ps1 on $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
# Edit and re-run configure.ps1 or modify directly, then restart the agent.

server_url: "$ServerUrl"
agent_id:   "$AgentId"
api_key:    "$ApiKey"
hostname:   ""          # leave blank to auto-detect

batch_size:     $BatchSize
flush_interval: $FlushInterval
retry_base:     1.0
retry_max:      60.0
buffer_db:      "$bufferDb"
verify_ssl:     $verifySslStr

# ─────────────────────────────────────────────────────────────────────────────
# Log sources
# ─────────────────────────────────────────────────────────────────────────────
# Security channel requires the agent to run as SYSTEM or as a user granted
# explicit read rights:
#   wevtutil sl Security /ca:"<current-sddl>(A;;0x1;;;SY)"
# ─────────────────────────────────────────────────────────────────────────────
sources:

  # ── Windows Security Log ────────────────────────────────────────────────────
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
      - 4698   # Scheduled task created
      - 4720   # User account created
      - 4726   # User account deleted
      - 4740   # Account locked out
      - 7045   # New service installed

  # ── Windows System Log ──────────────────────────────────────────────────────
  - type: winevent
    channel: "System"
    service: "windows-system"

  # ── Windows Application Log ─────────────────────────────────────────────────
  - type: winevent
    channel: "Application"
    service: "windows-app"
$optionalSources
"@

$configContent | Set-Content -Encoding UTF8 -Path $configPath
Write-OK "Config written to $configPath"

# ── 7. Summary ────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "─────────────────────────────────────────────────" -ForegroundColor Green
Write-Host " LogVault Agent configured successfully!" -ForegroundColor Green
Write-Host "─────────────────────────────────────────────────" -ForegroundColor Green
Write-Host " Config path : $configPath"
Write-Host " Server URL  : $ServerUrl"
Write-Host " Agent ID    : $AgentId"
Write-Host " Buffer DB   : $bufferDb"
Write-Host ""
Write-Host " Next steps:"
Write-Host "   1. Verify connectivity : .\test-connection.ps1 -ServerUrl $ServerUrl -ApiKey $ApiKey"
Write-Host "   2. Install the agent   : ..\..\install-windows.ps1 -ServerUrl $ServerUrl -ApiKey $ApiKey"
Write-Host "   3. Check logs          : Get-Content '$DataDir\agent.log' -Tail 30 -Wait"
Write-Host ""
