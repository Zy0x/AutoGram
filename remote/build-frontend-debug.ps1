# Build debug frontend.exe required by ensure-remote / CDP.
# Usage (from remote/):
#   powershell -File build-frontend-debug.ps1
#   npm run build:exe
$ErrorActionPreference = 'Stop'
$suiteRoot = $PSScriptRoot
$frontendRoot = Join-Path $suiteRoot '..\AutoGram App\frontend' | Resolve-Path
$tauriDir = Join-Path $frontendRoot 'src-tauri'
$logDir = Join-Path $suiteRoot 'reports\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'build-frontend-debug.log'

function Log([string]$m) {
  $line = "{0} {1}" -f (Get-Date -Format o), $m
  Add-Content -LiteralPath $log -Value $line -Encoding UTF8
  Write-Host $line
}

Log "BUILD START frontendRoot=$frontendRoot"
if (-not (Test-Path (Join-Path $frontendRoot 'node_modules\vite\bin\vite.js'))) {
  Log 'npm install (frontend) ...'
  Push-Location $frontendRoot
  npm install 2>&1 | Tee-Object -FilePath (Join-Path $logDir 'npm-install.log')
  Pop-Location
}

Push-Location $tauriDir
try {
  Log 'cargo build (debug frontend.exe) — first run can take several minutes'
  # Cargo writes normal progress and warnings to stderr. PowerShell 5 turns
  # those records into NativeCommandError when Stop is active, causing a false
  # wrapper failure before Cargo has finished.
  $ErrorActionPreference = 'Continue'
  cargo build 2>&1 | Tee-Object -FilePath (Join-Path $logDir 'cargo-build.log')
  $cargoExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($cargoExit -ne 0) {
    Log "FAIL cargo build exit=$cargoExit"
    exit $cargoExit
  }
  $exe = Join-Path $tauriDir 'target\debug\frontend.exe'
  if (-not (Test-Path $exe)) {
    Log "FAIL missing $exe"
    exit 1
  }
  Log "OK $exe size=$((Get-Item $exe).Length)"
  exit 0
} finally {
  Pop-Location
}
