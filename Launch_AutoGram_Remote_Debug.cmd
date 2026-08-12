@echo off
title AutoGram Full Package Remote Debug Launcher
echo ====================================================================
echo   Launching AutoGram Full Package (Frontend + Rust Backend + CDP)
echo ====================================================================
echo.

set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9230 --remote-allow-origins=*

echo [INFO] Starting AutoGram full stack (Tauri Dev + Rust Backend + Vite)...
cd /d "%~dp0AutoGram App\frontend"
npx tauri dev

pause
