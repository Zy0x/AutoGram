@echo off
title AutoGram Desktop
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9230
cd /d "f:\AutoGram\AutoGram App\frontend\src-tauri"
start "" "target\release\frontend.exe"
exit

