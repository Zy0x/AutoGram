# Silent: ensure remote + run suite. No console when launched via VBS.
# Logs: reports/logs/suite-silent-*.log and last-run-status.txt
$ErrorActionPreference = 'Continue'
$remoteRoot = $PSScriptRoot
$logDir = Join-Path $remoteRoot 'reports\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$logFile = Join-Path $logDir "suite-silent-$stamp.log"
$statusFile = Join-Path $remoteRoot 'reports\last-run-status.txt'

function Write-Log([string]$msg) {
  $line = "$(Get-Date -Format 'HH:mm:ss') $msg"
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
}

function Set-Status([string]$text) {
  Set-Content -LiteralPath $statusFile -Value $text -Encoding UTF8
}

Write-Log '=== silent suite start ==='
Set-Status "RUNNING $stamp"

# 1) ensure-remote in SEPARATE hidden process (its "exit" must not kill this script)
$ensure = Join-Path $remoteRoot 'ensure-remote.ps1'
if (-not (Test-Path -LiteralPath $ensure)) {
  Set-Status 'FAIL ensure-remote.ps1 missing'
  exit 1
}

Write-Log 'ensure-remote (CreateNoWindow child)...'
# Use ProcessStartInfo CreateNoWindow so no conhost appears behind frontend
$psiE = New-Object System.Diagnostics.ProcessStartInfo
$psiE.FileName = 'powershell.exe'
$psiE.Arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ensure`""
$psiE.WorkingDirectory = $remoteRoot
$psiE.UseShellExecute = $false
$psiE.CreateNoWindow = $true
$psiE.RedirectStandardOutput = $true
$psiE.RedirectStandardError = $true
$pEnsure = New-Object System.Diagnostics.Process
$pEnsure.StartInfo = $psiE
[void]$pEnsure.Start()
$eOut = $pEnsure.StandardOutput.ReadToEnd()
$eErr = $pEnsure.StandardError.ReadToEnd()
$pEnsure.WaitForExit()
if ($eOut) { Add-Content -LiteralPath $logFile -Value $eOut -Encoding UTF8 }
if ($eErr) { Add-Content -LiteralPath $logFile -Value "ENSURE_ERR:`n$eErr" -Encoding UTF8 }
$ensureCode = $pEnsure.ExitCode
Write-Log "ensure-remote exit=$ensureCode"
if ($ensureCode -ne 0) {
  Set-Status "FAIL ensure-remote exit=$ensureCode log=$logFile"
  exit $ensureCode
}

# 2) Suite with CreateNoWindow node
$runJs = Join-Path $remoteRoot 'run.mjs'
if (-not (Test-Path -LiteralPath $runJs)) {
  Set-Status 'FAIL run.mjs missing'
  exit 2
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Set-Status 'FAIL node not in PATH'
  exit 3
}

Write-Log 'node run.mjs (CreateNoWindow)...'
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $nodeCmd.Source
$psi.Arguments = "`"$runJs`""
$psi.WorkingDirectory = $remoteRoot
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$p = New-Object System.Diagnostics.Process
$p.StartInfo = $psi
[void]$p.Start()
$stdout = $p.StandardOutput.ReadToEnd()
$stderr = $p.StandardError.ReadToEnd()
$p.WaitForExit()
Add-Content -LiteralPath $logFile -Value $stdout -Encoding UTF8
if ($stderr) { Add-Content -LiteralPath $logFile -Value "STDERR:`n$stderr" -Encoding UTF8 }
$code = $p.ExitCode
Write-Log "suite exit=$code"

if ($code -eq 0) {
  Set-Status "OK suite PASS $stamp log=$logFile"
} else {
  Set-Status "FAIL suite exit=$code $stamp log=$logFile summary=$remoteRoot\reports\summary_dashboard.json"
}
exit $code
