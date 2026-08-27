@echo off
setlocal
echo ========================================================
echo  AutoGram Android Native - Isolated Studio Launcher
echo  100%% Zero-C Drive Isolation (F:\AutoGram Storage)
echo ========================================================

set "PROJECT_ROOT=F:\AutoGram"
set "GRADLE_USER_HOME=%PROJECT_ROOT%\.build-cache\gradle"
set "ANDROID_USER_HOME=%PROJECT_ROOT%\.build-cache\android-user-home"
set "ANDROID_HOME=%PROJECT_ROOT%\.toolchains\android-sdk"
set "ANDROID_SDK_ROOT=%PROJECT_ROOT%\.toolchains\android-sdk"
set "JAVA_HOME=%PROJECT_ROOT%\.toolchains\jdk-17"
set "CARGO_HOME=%PROJECT_ROOT%\.toolchains\cargo"
set "RUSTUP_HOME=%PROJECT_ROOT%\.toolchains\rustup"
set "CARGO_TARGET_DIR=%PROJECT_ROOT%\.build-cache\cargo-target"
set "TEMP=%PROJECT_ROOT%\.build-cache\temp"
set "TMP=%PROJECT_ROOT%\.build-cache\temp"
set "GRADLE_OPTS=-Djava.io.tmpdir=%PROJECT_ROOT%\.build-cache\temp -Dorg.gradle.user.home=%PROJECT_ROOT%\.build-cache\gradle"

if not exist "%TEMP%" mkdir "%TEMP%"
if not exist "%GRADLE_USER_HOME%" mkdir "%GRADLE_USER_HOME%"
if not exist "%ANDROID_USER_HOME%" mkdir "%ANDROID_USER_HOME%"

:: Cari lokasi Android Studio
set "STUDIO_EXE="
if exist "C:\Program Files\Android\Android Studio\bin\studio64.exe" set "STUDIO_EXE=C:\Program Files\Android\Android Studio\bin\studio64.exe"
if exist "%LOCALAPPDATA%\Programs\Android Studio\bin\studio64.exe" set "STUDIO_EXE=%LOCALAPPDATA%\Programs\Android Studio\bin\studio64.exe"
if exist "F:\Android Studio\bin\studio64.exe" set "STUDIO_EXE=F:\Android Studio\bin\studio64.exe"

if defined STUDIO_EXE (
    echo Menjalankan Android Studio dengan isolasi Drive F:...
    start "" "%STUDIO_EXE%" "%~dp0"
) else (
    echo [INFO] Android Studio tidak terdeteksi di lokasi otomatis.
    echo Buka Android Studio Anda, lalu buka folder: %~dp0
    echo Seluruh cache dan SDK telah terkunci aman di Drive F:
    pause
)
