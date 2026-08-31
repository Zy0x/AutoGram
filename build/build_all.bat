@echo off
setlocal
echo ==========================================================
echo    AUTOGRAM MASTER BUILDER (DESKTOP + ANDROID APK)
echo ==========================================================
echo.

echo [1/2] Building AutoGram Desktop (Windows)...
call "%~dp0build_desktop.bat"

echo.
echo [2/2] Building AutoGram Android APK...
call "%~dp0build_apk.bat"

echo.
echo ==========================================================
echo  [ALL COMPLETE] Check build\output for generated binaries!
echo ==========================================================
pause
