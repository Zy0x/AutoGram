@echo off
setlocal enabledelayedexpansion
echo ========================================================
echo  AutoGram Android Native - Real Emulator Launcher
echo  100%% Zero-C Drive Isolation (F:\AutoGram Storage)
echo ========================================================

set "PROJECT_ROOT=F:\AutoGram"
set "ANDROID_AVD_HOME=%PROJECT_ROOT%\.build-cache\android-avd"
set "ANDROID_USER_HOME=%PROJECT_ROOT%\.build-cache\android-user-home"
set "ANDROID_EMULATOR_HOME=%PROJECT_ROOT%\.build-cache\android-emulator"
set "ANDROID_SDK_ROOT=%PROJECT_ROOT%\.toolchains\android-sdk"
set "ANDROID_HOME=%PROJECT_ROOT%\.toolchains\android-sdk"
set "JAVA_HOME=%PROJECT_ROOT%\.toolchains\jdk-17"
set "TEMP=%PROJECT_ROOT%\.build-cache\temp"
set "TMP=%PROJECT_ROOT%\.build-cache\temp"
set "PATH=%JAVA_HOME%\bin;%ANDROID_SDK_ROOT%\platform-tools;%ANDROID_SDK_ROOT%\emulator;%PATH%"

set "AVD_NAME=AutoGram_Native_Device"
set "EMULATOR_EXE=%ANDROID_SDK_ROOT%\emulator\emulator.exe"
set "ADB_EXE=%ANDROID_SDK_ROOT%\platform-tools\adb.exe"
set "APK_PATH=%~dp0app\build\outputs\apk\debug\app-universal-debug.apk"
if not exist "%APK_PATH%" set "APK_PATH=%~dp0app\build\outputs\apk\debug\app-x86_64-debug.apk"

echo [1/3] Menjalankan Google Android Emulator (%AVD_NAME%)...
start "AutoGram Android Emulator" "%EMULATOR_EXE%" -avd %AVD_NAME% -gpu auto -no-snapshot-load

echo [2/3] Menunggu sistem Android selesai booting...
"%ADB_EXE%" wait-for-device

:boot_loop
timeout /t 2 /nobreak >nul
set "BOOT_STATUS="
for /f "tokens=*" %%a in ('"%ADB_EXE%" shell getprop sys.boot_completed 2^>nul') do set "BOOT_STATUS=%%a"
if not "!BOOT_STATUS!"=="1" (
    echo Booting Android OS...
    goto boot_loop
)

echo.
echo [3/3] Memasang AutoGram Native APK ke Emulator...
if exist "%APK_PATH%" (
    "%ADB_EXE%" install -r "%APK_PATH%"
    "%ADB_EXE%" shell am start -n com.autogram.app/com.autogram.app.MainActivity
    echo.
    echo ========================================================
    echo  AutoGram Berhasil Terbuka dan Berjalan di Emulator!
    echo ========================================================
) else (
    echo [ERROR] Berkas APK tidak ditemukan di: %APK_PATH%
)

echo Jendela emulator sedang aktif di layar Anda.
pause
