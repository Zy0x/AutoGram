# Stop any running frontend
Get-Process frontend -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

$exe = "F:\AutoGram\AutoGram App\frontend\src-tauri\target\debug\frontend.exe"
$tauriDir = "F:\AutoGram\AutoGram App\frontend\src-tauri"
$userDataDir = "F:\AutoGram\remote\.webview2_fresh"

if (Test-Path $userDataDir) {
    Remove-Item -Recurse -Force $userDataDir -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $userDataDir | Out-Null

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exe
$psi.WorkingDirectory = $tauriDir
$psi.UseShellExecute = $false
$psi.EnvironmentVariables["WEBVIEW2_USER_DATA_FOLDER"] = $userDataDir
$psi.EnvironmentVariables["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--remote-debugging-port=9225 --remote-allow-origins=*"
$psi.EnvironmentVariables["AUTOGRAM_SESSIONS_DIR"] = "F:\AutoGram\AutoGram App\worker\sessions"

$proc = [System.Diagnostics.Process]::Start($psi)
Write-Host "Started frontend.exe PID:" $proc.Id
