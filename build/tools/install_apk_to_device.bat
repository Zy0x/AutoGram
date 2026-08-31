@echo off
setlocal
set "PROJECT_ROOT=%~dp0..\.."
set "ADB_EXE=%PROJECT_ROOT%\.toolchains\android-sdk\platform-tools\adb.exe"
if not exist "%ADB_EXE%" set "ADB_EXE=adb"

echo [ADB] Checking for connected devices...
"%ADB_EXE%" devices

set "APK_FILE=%PROJECT_ROOT%\build\output\apk\AutoGram-debug.apk"
if not exist "%APK_FILE%" (
    set "APK_FILE=%PROJECT_ROOT%\AutoGram App\android\app\build\outputs\apk\debug\app-debug.apk"
)

if not exist "%APK_FILE%" (
    echo [ERROR] No APK found in build\output\apk. Please run build_apk.bat first!
    pause
    exit /b 1
)

echo [ADB] Installing %APK_FILE%...
"%ADB_EXE%" install -r "%APK_FILE%"
if %ERRORLEVEL% equ 0 (
    echo [SUCCESS] AutoGram APK successfully installed to device!
    echo [ADB] Launching AutoGram...
    "%ADB_EXE%" shell am start -n com.autogram.app/.MainActivity
) else (
    echo [FAILED] Installation failed. Ensure USB debugging is authorized.
)
pause
