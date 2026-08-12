@echo off
title AutoGram Remote Debug Launcher
echo ========================================================
echo   Launching AutoGram Desktop App (CDP Debug Port 9230)
echo ========================================================
echo.

:: Check if Vite server is running on port 1420, if not start it in background
powershell -Command "try { \$resp = Invoke-WebRequest -Uri 'http://localhost:1420' -TimeoutSec 1 -UseBasicParsing; exit 0 } catch { exit 1 }"
if %errorlevel% neq 0 (
    echo [INFO] Starting Vite Frontend Server on port 1420...
    start /b "" cmd /c "cd /d "%~dp0AutoGram App\frontend" && npm run dev"
    timeout /t 3 /nobreak >nul
)

set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9230 --remote-allow-origins=*

echo [INFO] Opening AutoGram Desktop window on your screen...
start "" "%~dp0AutoGram App\frontend\src-tauri\target\debug\frontend.exe"

echo.
echo [SUCCESS] AutoGram Desktop is now running visually on your screen!
echo You can now prompt Antigravity to run live visual remote control.
echo.
timeout /t 5
