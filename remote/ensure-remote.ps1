# Ensure Vite (hidden) + frontend.exe (VISIBLE) + CDP :9222
# Cold-start optimized (post Windows reboot):
#   - PHASE timestamps + elapsed ms in ensure-remote.log
#   - Fast TCP port probe before full HTTP
#   - Adaptive poll (early exit when up)
#   - Progressive last-run-status.txt so first open does not look hung
#   - Heal subprocess hard-capped (Playwright cold load must not block forever)
#
# ENSURE_PARENT_WAIT_MIN = 5 (silent-launch.vbs ENSURE_DEADLINE_MIN)
# Worst-case phase budgets (ms): VITE 55k + ensureNode 25k + WAIT2 15k + CDP 20k + HEAL 12k = 127s
# + cold overhead ~90s => must stay under parent 5 minutes. Parent kills orphan on timeout.
# ASCII-only (PS 5.1 -File without BOM).
$ErrorActionPreference = 'Continue'
$suiteRoot = $PSScriptRoot
$frontendRoot = Join-Path $suiteRoot '..\AutoGram App\frontend' | Resolve-Path
$tauriDir = Join-Path $frontendRoot 'src-tauri'
$exeDebug = Join-Path $tauriDir 'target\debug\frontend.exe'
$exeRelease = Join-Path $tauriDir 'target\release\frontend.exe'
$exe = if (Test-Path $exeDebug) { $exeDebug } elseif (Test-Path $exeRelease) { $exeRelease } else { $null }
$logDir = Join-Path $suiteRoot 'reports\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$ensureLog = Join-Path $logDir 'ensure-remote.log'
$vitePort = 1420
$viteUrl = "http://127.0.0.1:$vitePort/"
# BUG-5 FIX: Frontend WebView2 binds on IPv6 [::1]:9222, NOT 127.0.0.1:9222.
# GoogleDriveFS hijacks 127.0.0.1:9222 — using that always connects to the wrong process.
$cdpUrlIPv6 = 'http://[::1]:9222/json'
$cdpUrlIPv4 = 'http://127.0.0.1:9222/json'
$cdpUrl     = $cdpUrlIPv6   # primary (AutoGram WebView2)
$script:EnsureStart = [Diagnostics.Stopwatch]::StartNew()

function Write-EnsureLog([string]$msg) {
  try {
    $ms = [int]$script:EnsureStart.ElapsedMilliseconds
    Add-Content -LiteralPath $ensureLog -Value ("{0} +{1}ms {2}" -f (Get-Date -Format o), $ms, $msg) -Encoding UTF8
  } catch {}
}

function Write-Phase([string]$phase, [string]$detail = '') {
  $ms = [int]$script:EnsureStart.ElapsedMilliseconds
  $p = ($phase -replace '\s+', '_').ToUpperInvariant()
  $line = if ($detail) { "PHASE $p +${ms}ms $detail" } else { "PHASE $p +${ms}ms" }
  Write-EnsureLog $line
}

function Set-Status([string]$text) {
  try {
    $statusPath = Join-Path $suiteRoot 'reports\last-run-status.txt'
    Set-Content -LiteralPath $statusPath -Value $text -Encoding UTF8
  } catch {}
}

function Set-Progress([string]$phase, [string]$hint = '') {
  $sec = [int][Math]::Round($script:EnsureStart.Elapsed.TotalSeconds)
  $h = if ($hint) { " - $hint" } else { '' }
  Set-Status ("WORKING {0} ({1}s){2}" -f $phase, $sec, $h)
}

function Test-TcpPort([string]$HostName, [int]$Port, [int]$TimeoutMs = 400) {
  $client = $null
  try {
    $family = if ($HostName -match ':') {
      [System.Net.Sockets.AddressFamily]::InterNetworkV6
    } else {
      [System.Net.Sockets.AddressFamily]::InterNetwork
    }
    $client = [System.Net.Sockets.TcpClient]::new($family)
    $iar = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
      return $false
    }
    $client.EndConnect($iar)
    return $client.Connected
  } catch {
    return $false
  } finally {
    if ($client) { try { $client.Close() } catch {} }
  }
}

function Test-ViteUp {
  # Fast path: nothing listening => fail without full HTTP stack
  if (-not (Test-TcpPort '127.0.0.1' $vitePort 350)) {
    return $false
  }
  try {
    $r = Invoke-WebRequest $viteUrl -UseBasicParsing -TimeoutSec 1
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Test-CdpUp {
  # Try port 9225 first (dedicated for AutoGram to avoid GoogleDriveFS on 9222), then 9222.
  foreach ($port in @(9225, 9222)) {
    foreach ($hName in @('127.0.0.1', '::1')) {
      if (-not (Test-TcpPort $hName $port 350)) { continue }
      try {
        $url = if ($hName -eq '::1') { "http://[::1]:$port/json/list" } else { "http://127.0.0.1:$port/json/list" }
        $json = (& curl.exe -g -sS --max-time 2 $url 2>$null) -join "`n"
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($json)) { continue }
        if ($json -match 'localhost:1420' -or $json -match 'tauri') {
          $script:ResolvedCdpUrl = $url
          Write-EnsureLog "CDP resolved: $url (host=$hName port=$port)"
          return $true
        }
      } catch {}
    }
  }
  return $false
}

function Get-NodePath {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  foreach ($c in @(
      "$env:ProgramFiles\nodejs\node.exe",
      "${env:ProgramFiles(x86)}\nodejs\node.exe",
      "$env:LOCALAPPDATA\Programs\node\node.exe"
    )) {
    if ($c -and (Test-Path -LiteralPath $c)) { return $c }
  }
  return $null
}

function Start-ViteHidden {
  $viteJs = Join-Path $frontendRoot 'node_modules\vite\bin\vite.js'
  if (-not (Test-Path -LiteralPath $viteJs)) {
    Write-EnsureLog "ERROR vite missing: $viteJs"
    Set-Status 'FAIL vite.js missing - npm install in frontend'
    return $false
  }
  $node = Get-NodePath
  if (-not $node) {
    Write-EnsureLog 'ERROR node not in PATH'
    Set-Status 'FAIL node not in PATH'
    return $false
  }
  $outLog = Join-Path $logDir 'vite-hidden.out.log'
  $errLog = Join-Path $logDir 'vite-hidden.err.log'
  Write-Phase 'VITE_START' "node=$node port=$vitePort"
  try {
    $null = Start-Process -FilePath $node -ArgumentList @(
      "`"$viteJs`"", '--host', '127.0.0.1', '--port', "$vitePort", '--strictPort'
    ) -WorkingDirectory $frontendRoot -WindowStyle Hidden `
      -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
  } catch {
    Write-EnsureLog "vite start failed: $_"
    return $false
  }
  return $true
}

# Adaptive wait: short polls first, early exit on success (not fixed sleep*N).
function Wait-Until([scriptblock]$Probe, [int]$MaxWaitMs, [string]$Label) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $interval = 200
  $maxInterval = 700
  $attempt = 0
  while ($sw.ElapsedMilliseconds -lt $MaxWaitMs) {
    $attempt++
    if (& $Probe) {
      Write-Phase $Label "ready attempts=$attempt elapsed=$([int]$sw.ElapsedMilliseconds)ms"
      return $true
    }
    Set-Progress $Label "waiting... attempt $attempt"
    Start-Sleep -Milliseconds $interval
    $interval = [Math]::Min($maxInterval, [int][Math]::Ceiling($interval * 1.3))
  }
  Write-Phase $Label "TIMEOUT after ${MaxWaitMs}ms attempts=$attempt"
  return $false
}

Write-EnsureLog 'ensure-remote START'
Write-Phase 'START' 'cold ensure'
Set-Status 'WORKING bootstrap (0s) - starting remote stack...'

# Fresh start cleanup: terminate any running processes related to AutoGram
Write-Phase 'CLEANUP' 'force-closing existing AutoGram processes'
Set-Progress 'Cleanup' 'terminating stale processes'

$currentPid = $PID
Get-CimInstance Win32_Process | Where-Object {
  ($_.ExecutablePath -and ($_.ExecutablePath -like "*AutoGram*")) -or 
  ($_.CommandLine -and ($_.CommandLine -like "*AutoGram*"))
} | Where-Object {
  $_.ProcessId -ne $currentPid -and $_.Name -notlike "*powershell*"
} | ForEach-Object {
  try {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-EnsureLog "Killed stale process: $($_.Name) (PID $($_.ProcessId))"
  } catch {}
}
Start-Sleep -Milliseconds 600

if (-not $exe) {
  Write-EnsureLog 'ERROR frontend.exe missing — attempting cargo build via build-frontend-debug.ps1'
  Set-Status 'WORKING build frontend.exe (first time may take several minutes)'
  $builder = Join-Path $suiteRoot 'build-frontend-debug.ps1'
  if (Test-Path -LiteralPath $builder) {
    try {
      & powershell -NoProfile -ExecutionPolicy Bypass -File $builder
      if ($LASTEXITCODE -ne 0) {
        Write-EnsureLog "build-frontend-debug exit=$LASTEXITCODE"
      }
    } catch {
      Write-EnsureLog "auto-build failed: $_"
    }
  }
  $exe = if (Test-Path $exeDebug) { $exeDebug } elseif (Test-Path $exeRelease) { $exeRelease } else { $null }
}
if (-not $exe) {
  Write-EnsureLog 'ERROR frontend.exe missing'
  Set-Status 'FAIL frontend.exe missing - run: cd remote; npm run build:exe'
  exit 1
}
Write-EnsureLog "exe=$exe"

# --- Vite HARD gate (debug frontend.exe = devUrl localhost:1420) ---
Write-Phase 'VITE_PROBE' 'initial'
Set-Progress 'Vite' 'checking :1420'
$viteOk = Test-ViteUp
if ($viteOk) {
  Write-Phase 'VITE_PROBE' 'already_up'
} else {
  Write-Phase 'VITE_PROBE' 'down'
  Set-Progress 'Vite' 'starting hidden (first boot may take ~15-40s)'
  if (-not (Start-ViteHidden)) {
    exit 1
  }
  # Cold reboot: Node+Vite first compile can take 30-50s on HDD/AV; cap 55s with adaptive poll
  # Budget must fit silent-launch ENSURE_DEADLINE_MIN (5m) with other phases.
  $viteOk = Wait-Until { Test-ViteUp } 55000 'VITE_WAIT'
}

if (-not $viteOk) {
  $node = Get-NodePath
  if ($node) {
    Write-Phase 'VITE_ENSURE_NODE' 'fallback vite_ensure.mjs'
    Set-Progress 'Vite' 'node ensure fallback'
    try {
      $viteEnsure = Join-Path $suiteRoot 'core\vite_ensure.mjs'
      $p = Start-Process -FilePath $node -ArgumentList @($viteEnsure) `
        -WorkingDirectory $suiteRoot -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDir 'vite-ensure.out.log') `
        -RedirectStandardError (Join-Path $logDir 'vite-ensure.err.log')
      if (-not $p.WaitForExit(25000)) {
        try { $p.Kill() } catch {}
        Write-EnsureLog 'vite_ensure.mjs timed out 25s'
      } else {
        Write-EnsureLog "vite_ensure.mjs exit=$($p.ExitCode)"
      }
    } catch {
      Write-EnsureLog "vite_ensure.mjs failed: $_"
    }
    $viteOk = Wait-Until { Test-ViteUp } 15000 'VITE_WAIT2'
  }
}

if (-not $viteOk) {
  Write-EnsureLog "ERROR Vite not ready - refuse to start frontend (would show can't reach page)"
  Set-Status "FAIL Vite :$vitePort not ready - see reports/logs/vite-hidden.err.log"
  exit 2
}

Write-Phase 'VITE_OK' $viteUrl
Set-Progress 'Frontend' 'Vite ready'

# --- frontend.exe ---
$needStart = $true
$existing = Get-Process frontend -ErrorAction SilentlyContinue
if ($existing) {
  if (Test-CdpUp) {
    Write-Phase 'FRONTEND' "reuse_cdp pid=$($existing.Id)"
    $needStart = $false
    try {
      Add-Type -Namespace Win -Name Api -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
'@ -ErrorAction SilentlyContinue
      $existing.Refresh()
      if ($existing.MainWindowHandle -ne [IntPtr]::Zero) {
        [void][Win.Api]::ShowWindow($existing.MainWindowHandle, 9)
        [void][Win.Api]::SetForegroundWindow($existing.MainWindowHandle)
      }
    } catch {}
  } else {
    Write-Phase 'FRONTEND' 'restart_no_cdp'
    $existing | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 600
  }
}

if ($needStart) {
  Write-Phase 'FRONTEND_START' $exe
  Set-Progress 'Frontend' 'launching frontend.exe'
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.WorkingDirectory = $tauriDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $false
  $userDataDir = Join-Path $suiteRoot '.webview2_data'
  if (-not (Test-Path -LiteralPath $userDataDir)) { New-Item -ItemType Directory -Force -Path $userDataDir | Out-Null }
  $psi.EnvironmentVariables['WEBVIEW2_USER_DATA_FOLDER'] = $userDataDir
  $psi.EnvironmentVariables['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = '--remote-debugging-port=9225 --remote-allow-origins=*'
  $psi.EnvironmentVariables['AUTOGRAM_SESSIONS_DIR'] = 'F:\AutoGram\AutoGram App\worker\sessions'
  try {
    $psi.EnvironmentVariables['PATH'] = [Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH', 'User')
  } catch {}

  try {
    $proc = [System.Diagnostics.Process]::Start($psi)
  } catch {
    Write-EnsureLog "frontend Start failed: $_"
    Set-Status "FAIL frontend start: $_"
    exit 3
  }

  if (-not $proc) {
    Write-EnsureLog 'frontend Start returned null'
    Set-Status 'FAIL frontend start null'
    exit 3
  }

  Start-Sleep -Milliseconds 300
  $alive = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
  if (-not $alive) {
    Write-EnsureLog 'frontend exited immediately'
    Set-Status 'FAIL frontend exited immediately'
    exit 3
  }

  try {
    Add-Type -Namespace Win -Name Api -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
'@ -ErrorAction SilentlyContinue
    $alive.Refresh()
    if ($alive.MainWindowHandle -ne [IntPtr]::Zero) {
      [void][Win.Api]::ShowWindow($alive.MainWindowHandle, 9)
      [void][Win.Api]::SetForegroundWindow($alive.MainWindowHandle)
    }
  } catch {}

  Write-Phase 'FRONTEND_OK' "pid=$($proc.Id)"
  Set-Progress 'CDP' "frontend pid=$($proc.Id)"
}

# CDP: WebView2 cold after reboot can take a bit; adaptive early exit
Set-Progress 'CDP' 'waiting :9222'
$cdpOk = Wait-Until { Test-CdpUp } 60000 'CDP_WAIT'
if (-not $cdpOk) {
  Write-EnsureLog 'ERROR CDP not up'
  Set-Status 'FAIL CDP :9222 not ready'
  exit 4
}
Write-Phase 'CDP_OK' ':9222'

# --- Heal: cap wall time (Playwright import is slow on first post-reboot run) ---
$node = Get-NodePath
if ($node) {
  $healJs = Join-Path $suiteRoot 'heal-remote.mjs'
  if (Test-Path -LiteralPath $healJs) {
    Write-Phase 'HEAL_START' 'heal-remote.mjs (max 12s)'
    Set-Progress 'Heal' 'CDP page heal (max 12s)'
    try {
      $healOut = Join-Path $logDir 'heal-remote.out.log'
      $healErr = Join-Path $logDir 'heal-remote.err.log'
      $hp = Start-Process -FilePath $node -ArgumentList @($healJs) `
        -WorkingDirectory $suiteRoot -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $healOut -RedirectStandardError $healErr
      $healBudgetMs = 12000
      if (-not $hp.WaitForExit($healBudgetMs)) {
        try { $hp.Kill() } catch {}
        Write-Phase 'HEAL_TIMEOUT' "${healBudgetMs}ms - stack still usable"
      } else {
        Write-Phase 'HEAL_DONE' "exit=$($hp.ExitCode)"
        if ($hp.ExitCode -gt 2) {
          Write-EnsureLog 'WARN heal soft-failed (Vite may still be OK)'
        }
      }
    } catch {
      Write-EnsureLog "heal-remote failed: $_"
      Write-Phase 'HEAL_FAIL' "$_"
    }
  }
}

$fe = Get-Process frontend -ErrorAction SilentlyContinue | Select-Object -First 1
$pidTxt = if ($fe) { "pid=$($fe.Id)" } else { 'pid=?' }
$totalMs = [int]$script:EnsureStart.ElapsedMilliseconds
Set-Status "OK remote ready $(Get-Date -Format o) $pidTxt vite=$viteUrl total=${totalMs}ms"
Write-Phase 'DONE' "OK total=${totalMs}ms $pidTxt"
Write-EnsureLog 'ensure-remote DONE OK'
exit 0
