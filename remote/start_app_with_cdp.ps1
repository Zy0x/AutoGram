$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222 --remote-allow-origins=*"
$exe = "f:\AutoGram\AutoGram App\frontend\src-tauri\target\debug\frontend.exe"
$tauriDir = "f:\AutoGram\AutoGram App\frontend\src-tauri"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exe
$psi.WorkingDirectory = $tauriDir
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.EnvironmentVariables["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--remote-debugging-port=9222 --remote-allow-origins=*"
$psi.EnvironmentVariables["PATH"] = [Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [Environment]::GetEnvironmentVariable("PATH", "User")

$proc = [System.Diagnostics.Process]::Start($psi)
Write-Host "Started frontend.exe PID:" $proc.Id
