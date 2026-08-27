@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_android.ps1" -Variant Debug
exit /b %ERRORLEVEL%
