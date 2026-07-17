@echo off
cd /d "%~dp0"
wscript.exe //nologo "%~dp0core\silent-launch.vbs" suite
if %ERRORLEVEL% EQU 0 exit /b 0

echo.
echo [Peringatan] Windows Script Host mungkin dimatikan atau diblokir.
echo Mencoba menjalankan via PowerShell secara langsung...
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start-all-silent.ps1"
set ERR=%ERRORLEVEL%
if %ERR% NEQ 0 (
  echo.
  echo GAGAL (Exit Code: %ERR%)
  pause
  exit /b %ERR%
)
exit /b 0
