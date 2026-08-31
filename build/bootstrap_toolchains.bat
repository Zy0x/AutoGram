@echo off
setlocal
echo [BOOTSTRAP] Initializing Portable Android Toolchains...
cd /d "%~dp0..\AutoGram App\android"
powershell -NoProfile -ExecutionPolicy Bypass -File "bootstrap_toolchain.ps1"
pause
