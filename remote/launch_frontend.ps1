$tauriDir = "F:\AutoGram\AutoGram App\frontend\src-tauri"
$exePath = Join-Path $tauriDir "target\debug\frontend.exe"

$userDataDir = "F:\AutoGram\remote\.webview2_data"
if (!(Test-Path $userDataDir)) {
    New-Item -ItemType Directory -Force -Path $userDataDir | Out-Null
}

$env:WEBVIEW2_USER_DATA_FOLDER = $userDataDir
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9225 --remote-allow-origins=*"
$env:AUTOGRAM_SESSIONS_DIR = "F:\AutoGram\AutoGram App\worker\sessions"

Write-Host "Launching frontend.exe with CDP port 9225..."
Start-Process -FilePath $exePath
