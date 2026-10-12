@echo off
setlocal
title AutoGram - Pembersihan Cache Aman

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0build\clean_build_safe.ps1"
set "CLEAN_EXIT_CODE=%ERRORLEVEL%"

echo.
pause
endlocal & exit /b %CLEAN_EXIT_CODE%
