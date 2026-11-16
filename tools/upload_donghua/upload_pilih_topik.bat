@echo off
setlocal
title AutoGram Smart Media Uploader - Pilih Topik Target
chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
set "PYTHON_SCRIPT=%SCRIPT_DIR%upload_donghua.py"

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python tidak terdeteksi di PATH sistem.
    echo Silakan install Python 3.8+ atau tambahkan ke environment PATH.
    pause
    exit /b 1
)

python -u "%PYTHON_SCRIPT%" --select-topic %*

if %errorlevel% neq 0 (
    echo.
    echo [SELESAI DENGAN CATATAN/ERROR] Tekan tombol apa saja untuk menutup...
    pause >nul
)

endlocal
