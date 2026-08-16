@echo off
echo ========================================================
echo   AutoGram Android Native Build (Jetpack Compose)
echo ========================================================

cd /d "%~dp0"

echo [1/2] Syncing Rust UniFFI Bindings...
call ..\crates\autogram-android-bridge\generate_kotlin_bindings.bat
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] UniFFI Kotlin generation failed.
    exit /b %ERRORLEVEL%
)

cd /d "%~dp0"
copy /Y "..\crates\autogram-android-bridge\bindings\kotlin\uniffi\autogram_android_bridge\autogram_android_bridge.kt" "app\src\main\java\uniffi\autogram_android_bridge\autogram_android_bridge.kt"

echo [2/2] Ready for Gradle / Android Studio build.
echo Open 'AutoGram App/android' in Android Studio or run 'gradle assembleDebug'.
