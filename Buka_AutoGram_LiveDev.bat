@echo off
title AutoGram Live Dev (Instant HMR & Auto Sync)
echo ========================================================
echo   AutoGram Desktop - Mode Pengembangan Langsung (Live Dev)
echo   Perubahan UI/Kode akan langsung sinkron secara otomatis!
echo ========================================================
cd /d "f:\AutoGram\AutoGram App\frontend"
npx tauri dev -- --no-default-features --features grammers
pause
