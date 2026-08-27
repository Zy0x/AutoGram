@echo off
setlocal
echo ========================================================
echo  AutoGram Android Native - Live Auto-Reload Watcher
echo  100%% Zero-C Drive Isolation (F:\AutoGram Storage)
echo ========================================================

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0quick_reload.ps1" -Watch
pause
