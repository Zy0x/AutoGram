$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9225 --remote-allow-origins=*"

$exePath = "F:\AutoGram\AutoGram App\frontend\src-tauri\target\debug\frontend.exe"
$workingDir = "F:\AutoGram\AutoGram App\frontend\src-tauri"

Write-Host "Launching AutoGram Desktop App visually..." -ForegroundColor Green
$proc = Start-Process -FilePath $exePath -WorkingDirectory $workingDir -PassThru

Start-Sleep -Seconds 2

$code = @"
using System;
using System.Runtime.InteropServices;

public class WindowManager {
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@

Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue

$frontendProc = Get-Process -Name "frontend" -ErrorAction SilentlyContinue | Select-Object -First 1

if ($frontendProc -and $frontendProc.MainWindowHandle -ne 0) {
    Write-Host "Found main window handle: $($frontendProc.MainWindowHandle). Bringing to front..." -ForegroundColor Yellow
    [WindowManager]::ShowWindow($frontendProc.MainWindowHandle, 9) # 9 = SW_RESTORE
    [WindowManager]::BringWindowToTop($frontendProc.MainWindowHandle)
    [WindowManager]::SetForegroundWindow($frontendProc.MainWindowHandle)
} else {
    Write-Host "Frontend process ID $($proc.Id) is running." -ForegroundColor Cyan
}
