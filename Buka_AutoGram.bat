@echo off
title AutoGram Desktop
cd /d "f:\AutoGram\AutoGram App\frontend\src-tauri"
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9230 --remote-allow-origins=*
start "" "target\debug\frontend.exe"
exit
