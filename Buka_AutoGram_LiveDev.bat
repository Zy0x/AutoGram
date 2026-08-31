@echo off
title AutoGram Live Dev (Instant HMR & Auto Sync)
echo ========================================================
echo   AutoGram Desktop - Mode Pengembangan Langsung (Live Dev)
echo   Perubahan UI/Kode akan langsung sinkron secara otomatis!
echo ========================================================
cd /d "%~dp0AutoGram App\frontend"
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9230
npx tauri dev -- --no-default-features --features grammers
pause
