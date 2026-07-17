@echo off
REM Launcher AutoGram Remote
REM Coba jalankan mode silent via wscript untuk menghindari flash cmd.
wscript.exe //nologo "%~dp0core\silent-launch.vbs" ensure
if %ERRORLEVEL% EQU 0 exit /b 0

echo.
echo [Peringatan] Windows Script Host mungkin dimatikan atau diblokir.
echo Mencoba menjalankan via PowerShell secara langsung...
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0ensure-remote.ps1"
set ERR=%ERRORLEVEL%
if %ERR% NEQ 0 (
  echo.
  echo GAGAL (Exit Code: %ERR%)
  echo Silakan cek log di reports\logs\ensure-remote.log
  pause
  exit /b %ERR%
)
exit /b 0
