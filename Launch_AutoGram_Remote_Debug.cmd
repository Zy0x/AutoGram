@echo off
title AutoGram Remote Debug Launcher
echo ========================================================
echo   Launching AutoGram Desktop App (CDP Debug Port 9230)
echo ========================================================
echo.

set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9230 --remote-allow-origins=*

echo Opening AutoGram Desktop window on your screen...
start "" "%~dp0AutoGram App\frontend\src-tauri\target\debug\frontend.exe"

echo.
echo [SUCCESS] AutoGram Desktop is now running visually on your screen!
echo You can now prompt Antigravity to run live visual remote control.
echo.
timeout /t 5
