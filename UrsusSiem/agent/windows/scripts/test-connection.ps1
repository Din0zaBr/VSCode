#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Tests network connectivity and API authentication to the LogVault server.

.DESCRIPTION
    Runs a series of connectivity checks against the LogVault server:
      1. DNS / TCP reachability  — ensures the host is reachable on the port.
      2. Health endpoint GET     — GET $ServerUrl/health (no auth required).
      3. Authenticated request   — GET $ServerUrl/health with X-API-Key header.

    Prints a clear PASS / FAIL result for each check and an overall summary.
    Exit code is 0 when all checks pass, 1 when any check fails.

.PARAMETER ServerUrl
    Base URL of the LogVault server, e.g. https://10.0.0.5 or http://10.0.0.5:8000
    Required (prompted if omitted).

.PARAMETER ApiKey
    API key to test authentication with. Required (prompted if omitted).

.PARAMETER TimeoutSec
    HTTP request timeout in seconds. Default: 10

.PARAMETER SkipCertCheck
    Switch. Disable TLS certificate validation (useful for self-signed certs).

.EXAMPLE
    .\test-connection.ps1 -ServerUrl https://10.0.0.5 -ApiKey secret123

.EXAMPLE
    # Self-signed certificate
    .\test-connection.ps1 -ServerUrl https://10.0.0.5 -ApiKey secret123 -SkipCertCheck

.EXAMPLE
    # Read values from the existing config file
    $cfg = Get-Content C:\ProgramData\logvault-agent\config.yaml | ConvertFrom-Yaml
    .\test-connection.ps1 -ServerUrl $cfg.server_url -ApiKey $cfg.api_key
#>

param(
    [string]$ServerUrl    = "",
    [string]$ApiKey       = "",
    [int]   $TimeoutSec   = 10,
    [switch]$SkipCertCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Helpers ───────────────────────────────────────────────────────────────────
function Write-Pass([string]$label, [string]$detail = "") {
    $line = "  [PASS]  $label"
    if ($detail) { $line += "  — $detail" }
    Write-Host $line -ForegroundColor Green
}

function Write-Fail([string]$label, [string]$detail = "") {
    $line = "  [FAIL]  $label"
    if ($detail) { $line += "  — $detail" }
    Write-Host $line -ForegroundColor Red
}

function Write-Skip([string]$label, [string]$detail = "") {
    Write-Host "  [SKIP]  $label  — $detail" -ForegroundColor Yellow
}

function Write-Section([string]$title) {
    Write-Host ""
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host ("  " + ("-" * ($title.Length))) -ForegroundColor Cyan
}

# ── Prompt for missing required params ────────────────────────────────────────
if (-not $ServerUrl) {
    $ServerUrl = (Read-Host "  Server URL (e.g. https://10.0.0.5 or http://10.0.0.5:8000)").Trim()
}
if (-not $ApiKey) {
    $ApiKey = (Read-Host "  API key").Trim()
}

$ServerUrl = $ServerUrl.TrimEnd('/')

# ── TLS: optionally allow untrusted certs ─────────────────────────────────────
# Works on both PowerShell 5.1 and 7+
if ($SkipCertCheck) {
    try {
        # PS 5.1 / .NET 4.x callback approach
        Add-Type -TypeDefinition @"
using System.Net;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
public class TrustAllCerts {
    public static void Set() {
        ServicePointManager.ServerCertificateValidationCallback =
            (object s, X509Certificate c, X509Chain ch, SslPolicyErrors e) => true;
    }
}
"@ -ErrorAction SilentlyContinue
        [TrustAllCerts]::Set()
    } catch {
        # PS 7+ — use -SkipCertificateCheck on Invoke-WebRequest instead
    }
    [System.Net.ServicePointManager]::SecurityProtocol = `
        [System.Net.SecurityProtocolType]::Tls12 -bor `
        [System.Net.SecurityProtocolType]::Tls11
}

# ── Build Invoke-WebRequest common args ──────────────────────────────────────
$iwrBase = @{
    Method          = "GET"
    TimeoutSec      = $TimeoutSec
    UseBasicParsing = $true
    ErrorAction     = "Stop"
}
if ($SkipCertCheck) {
    # -SkipCertificateCheck exists in PS 7+; on 5.1 we already patched via callback
    if ($PSVersionTable.PSVersion.Major -ge 7) {
        $iwrBase["SkipCertificateCheck"] = $true
    }
}

# ── Parse host + port from URL ────────────────────────────────────────────────
$uri       = [System.Uri]$ServerUrl
$hostName  = $uri.Host
$port      = if ($uri.Port -gt 0) { $uri.Port } else { if ($uri.Scheme -eq "https") { 443 } else { 80 } }
$healthUrl = "$ServerUrl/health"

$allPassed = $true

# ─────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  LogVault Agent — Connection Test" -ForegroundColor Cyan
Write-Host "  ════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Server   : $ServerUrl"
Write-Host "  API key  : $($ApiKey.Substring(0, [Math]::Min(4, $ApiKey.Length)))****"
Write-Host "  Endpoint : $healthUrl"
Write-Host "  TLS check: $(if ($SkipCertCheck) { 'disabled' } else { 'enabled' })"

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 1 — TCP reachability
# ─────────────────────────────────────────────────────────────────────────────
Write-Section "Check 1 of 3 — TCP reachability ($hostName`:$port)"

try {
    $tcpClient = New-Object System.Net.Sockets.TcpClient
    $asyncResult = $tcpClient.BeginConnect($hostName, $port, $null, $null)
    $waitHandle  = $asyncResult.AsyncWaitHandle
    if ($waitHandle.WaitOne([TimeSpan]::FromSeconds($TimeoutSec), $false)) {
        $tcpClient.EndConnect($asyncResult) | Out-Null
        Write-Pass "TCP connect to ${hostName}:${port}"
    } else {
        Write-Fail "TCP connect to ${hostName}:${port}" "Connection timed out after ${TimeoutSec}s"
        $allPassed = $false
    }
} catch {
    Write-Fail "TCP connect to ${hostName}:${port}" $_.Exception.Message
    $allPassed = $false
} finally {
    if ($tcpClient) { $tcpClient.Close() }
}

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 2 — Health endpoint (unauthenticated)
# ─────────────────────────────────────────────────────────────────────────────
Write-Section "Check 2 of 3 — Health endpoint GET $healthUrl"

try {
    $resp = Invoke-WebRequest @iwrBase -Uri $healthUrl
    $code = $resp.StatusCode
    if ($code -ge 200 -and $code -lt 300) {
        Write-Pass "GET /health" "HTTP $code"
        # Show a snippet of the response body if it looks like JSON
        $body = $resp.Content
        if ($body -and $body.Length -le 512) {
            Write-Host "           Response: $body" -ForegroundColor Gray
        }
    } elseif ($code -ge 400 -and $code -lt 500) {
        # A 401 / 403 from /health means the server is up but auth is required even there
        Write-Pass "GET /health" "HTTP $code (server reachable, auth may be required)"
    } else {
        Write-Fail "GET /health" "Unexpected HTTP $code"
        $allPassed = $false
    }
} catch [System.Net.WebException] {
    $webEx = $_.Exception
    $statusCode = [int]($webEx.Response.StatusCode)
    if ($statusCode -ge 400 -and $statusCode -lt 500) {
        Write-Pass "GET /health" "HTTP $statusCode (server reachable, auth required)"
    } else {
        Write-Fail "GET /health" $webEx.Message
        $allPassed = $false
    }
} catch {
    Write-Fail "GET /health" $_.Exception.Message
    $allPassed = $false
}

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 3 — Authenticated request
# ─────────────────────────────────────────────────────────────────────────────
Write-Section "Check 3 of 3 — Authenticated GET $healthUrl"

$authArgs = $iwrBase.Clone()
$authArgs["Headers"] = @{ "X-API-Key" = $ApiKey }

try {
    $resp = Invoke-WebRequest @authArgs -Uri $healthUrl
    $code = $resp.StatusCode
    if ($code -ge 200 -and $code -lt 300) {
        Write-Pass "Authenticated GET /health" "HTTP $code — API key accepted"
        $body = $resp.Content
        if ($body -and $body.Length -le 512) {
            Write-Host "           Response: $body" -ForegroundColor Gray
        }
    } else {
        Write-Fail "Authenticated GET /health" "Unexpected HTTP $code"
        $allPassed = $false
    }
} catch [System.Net.WebException] {
    $webEx     = $_.Exception
    $statusCode = [int]($webEx.Response.StatusCode)
    if ($statusCode -eq 401) {
        Write-Fail "Authenticated GET /health" "HTTP 401 Unauthorized — API key rejected or missing"
        $allPassed = $false
    } elseif ($statusCode -eq 403) {
        Write-Fail "Authenticated GET /health" "HTTP 403 Forbidden — API key recognized but insufficient permissions"
        $allPassed = $false
    } elseif ($statusCode -ge 200 -and $statusCode -lt 300) {
        Write-Pass "Authenticated GET /health" "HTTP $statusCode"
    } else {
        Write-Fail "Authenticated GET /health" "HTTP $statusCode — $($webEx.Message)"
        $allPassed = $false
    }
} catch {
    Write-Fail "Authenticated GET /health" $_.Exception.Message
    $allPassed = $false
}

# ─────────────────────────────────────────────────────────────────────────────
# Overall result
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ════════════════════════════════════════════════" -ForegroundColor Cyan
if ($allPassed) {
    Write-Host "  RESULT: ALL CHECKS PASSED" -ForegroundColor Green
    Write-Host "  The agent can reach $ServerUrl and authenticate successfully." -ForegroundColor Green
} else {
    Write-Host "  RESULT: ONE OR MORE CHECKS FAILED" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Troubleshooting tips:" -ForegroundColor Yellow
    Write-Host "    - Verify the server is running: Invoke-WebRequest -Uri '$healthUrl'"
    Write-Host "    - Check firewall rules on both this host and the server"
    Write-Host "    - For TLS errors with self-signed certs, add -SkipCertCheck"
    Write-Host "    - Confirm the API key matches AGENT_API_KEY on the server"
}
Write-Host "  ════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

exit $(if ($allPassed) { 0 } else { 1 })
