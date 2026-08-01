$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9225 --remote-allow-origins=*"
$exe = "f:\AutoGram\AutoGram App\frontend\src-tauri\target\debug\frontend.exe"
$tauriDir = "f:\AutoGram\AutoGram App\frontend\src-tauri"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exe
$psi.WorkingDirectory = $tauriDir
$psi.UseShellExecute = $false
$userDataDir = "f:\AutoGram\remote\.webview2_data"
$psi.EnvironmentVariables["WEBVIEW2_USER_DATA_FOLDER"] = $userDataDir
$psi.EnvironmentVariables["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--remote-debugging-port=9225 --remote-allow-origins=*"
$psi.EnvironmentVariables["AUTOGRAM_SESSIONS_DIR"] = "F:\AutoGram\AutoGram App\worker\sessions"
$psi.EnvironmentVariables["PATH"] = [Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [Environment]::GetEnvironmentVariable("PATH", "User")

$proc = [System.Diagnostics.Process]::Start($psi)
Write-Host "Started frontend.exe PID:" $proc.Id
