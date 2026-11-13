@echo off
setlocal
cd /d "%~dp0"
call "%~dp0init_msvc.bat"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_desktop.ps1"
pause
