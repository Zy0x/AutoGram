@echo off
setlocal
echo [BINDINGS] Generating UniFFI Kotlin Bindings from Rust Core...
cd /d "%~dp0..\..\AutoGram App\crates\autogram-android-bridge"
call generate_kotlin_bindings.bat
pause
