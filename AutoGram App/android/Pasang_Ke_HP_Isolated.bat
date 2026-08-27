@echo off
setlocal
echo ========================================================
echo  AutoGram Android Native - Pasang ke HP / Emulator
echo ========================================================

set "PROJECT_ROOT=F:\AutoGram"
set "ADB_EXE=%PROJECT_ROOT%\.toolchains\android-sdk\platform-tools\adb.exe"
set "APK_PATH=%~dp0app\build\outputs\apk\debug\app-universal-debug.apk"
set "ANDROID_USER_HOME=%PROJECT_ROOT%\.build-cache\android-user-home"

if not exist "%ADB_EXE%" (
    echo [ERROR] ADB tidak ditemukan di %ADB_EXE%
    pause
    exit /b 1
)

if not exist "%APK_PATH%" (
    echo [INFO] APK belum dirakit. Merakit APK sekarang...
    call "%~dp0build_android.bat"
)

echo.
echo [1/3] Memeriksa perangkat Android yang terhubung...
"%ADB_EXE%" devices
echo.

echo [2/3] Memasang APK ke perangkat...
"%ADB_EXE%" install -r "%APK_PATH%"
if %ERRORLEVEL% neq 0 (
    echo.
    echo [PETUNJUK] Pastikan HP sudah tercolok via USB dan:
    echo 1. 'Opsi Pengembang' (Developer Options) sudah aktif di HP.
    echo 2. 'Debugging USB' (USB Debugging) sudah diaktifkan / dicentang.
    echo 3. Pilih 'Izinkan Debugging USB' saat muncul pop-up di layar HP.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [3/3] Membuka AutoGram di layar HP...
"%ADB_EXE%" shell am start -n com.autogram.app/com.autogram.app.MainActivity
echo.
echo ========================================================
echo  AutoGram berhasil terbuka di HP Anda!
echo ========================================================
pause
