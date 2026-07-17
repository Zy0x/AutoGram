# Start Vite with ZERO console window (no node.exe / cmd flash on desktop).
# Logs: remote/reports/logs/vite-hidden.{out,err}.log
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File start-vite-hidden.ps1 -FrontendRoot "F:\...\frontend" -Port 1420
param(
  [Parameter(Mandatory = $true)]
  [string]$FrontendRoot,
  [int]$Port = 1420,
  [string]$BindHost = '127.0.0.1'
)

$ErrorActionPreference = 'Stop'
$FrontendRoot = (Resolve-Path -LiteralPath $FrontendRoot).Path
$viteJs = Join-Path $FrontendRoot 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $viteJs)) {
  Write-Host "[ERROR] Vite missing: $viteJs"
  exit 1
}

# Already listening?
try {
  $code = (Invoke-WebRequest "http://${BindHost}:$Port/" -UseBasicParsing -TimeoutSec 2).StatusCode
  if ($code -ge 200 -and $code -lt 500) {
    Write-Host "[OK] Vite already on :$Port"
    exit 0
  }
} catch {}

# This file is remote/core/ → suite root is parent of core
$suiteRoot = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $suiteRoot 'reports\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$outLog = Join-Path $logDir 'vite-hidden.out.log'
$errLog = Join-Path $logDir 'vite-hidden.err.log'

$node = (Get-Command node -ErrorAction Stop).Source
# Redirected Start-Process forces no window (UseShellExecute=false)
$p = Start-Process -FilePath $node `
  -ArgumentList @(
    $viteJs,
    '--host', $BindHost,
    '--port', "$Port",
    '--strictPort'
  ) `
  -WorkingDirectory $FrontendRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

if (-not $p) {
  Write-Host '[ERROR] Failed to start node (Vite)'
  exit 2
}

Write-Host "[..] Vite starting hidden PID=$($p.Id) (no console window)"
for ($i = 0; $i -lt 80; $i++) {
  try {
    $code = (Invoke-WebRequest "http://${BindHost}:$Port/" -UseBasicParsing -TimeoutSec 1).StatusCode
    if ($code -ge 200 -and $code -lt 500) {
      Write-Host "[OK] Vite hidden ready http://${BindHost}:$Port/"
      exit 0
    }
  } catch {}
  if ($p.HasExited) {
    Write-Host "[ERROR] Vite node exited early code=$($p.ExitCode). See $errLog"
    exit 3
  }
  Start-Sleep -Milliseconds 500
}

Write-Host "[WARN] Vite not ready after wait - process PID=$($p.Id) may still be starting. Logs: $errLog"
exit 4
