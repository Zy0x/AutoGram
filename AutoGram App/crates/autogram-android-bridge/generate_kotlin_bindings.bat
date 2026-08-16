@echo off
cd /d "%~dp0"
echo ========================================================
echo   AutoGram UniFFI Kotlin Bindings Generator
echo ========================================================

cargo build --lib
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to compile autogram_android_bridge library.
    exit /b %ERRORLEVEL%
)

cargo run --bin uniffi-bindgen generate --library target/debug/autogram_android_bridge.dll --language kotlin --out-dir bindings/kotlin --no-format
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to generate Kotlin bindings.
    exit /b %ERRORLEVEL%
)

echo [SUCCESS] Generated Kotlin bindings in bindings/kotlin/uniffi/autogram_android_bridge/
