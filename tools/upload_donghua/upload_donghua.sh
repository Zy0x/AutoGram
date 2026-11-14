#!/usr/bin/env bash
# =============================================================================
# AutoGram Smart Media Uploader - Bash Entry Script
# Target: 'U8542241823/D-1003214112048/T8' (Topik Donghua NSFW)
# Source: E:\Data\Upload\Dong | Limit: 500 media per run
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_SCRIPT="$SCRIPT_DIR/upload_donghua.py"

# Cari executable Python yang tersedia
PYTHON_BIN=""
if command -v python3 &>/dev/null; then
    PYTHON_BIN="python3"
elif command -v python &>/dev/null; then
    PYTHON_BIN="python"
elif command -v py &>/dev/null; then
    PYTHON_BIN="py"
elif [ -f "/c/Python314/python.exe" ]; then
    PYTHON_BIN="/c/Python314/python.exe"
elif [ -f "C:/Python314/python.exe" ]; then
    PYTHON_BIN="C:/Python314/python.exe"
else
    echo -e "\033[91m[ERROR] Python tidak ditemukan di PATH!\033[0m"
    echo "Pastikan Python 3.8+ telah terinstal dan ada di PATH sistem."
    exit 1
fi

export PYTHONUNBUFFERED=1
echo -e "\033[1m\033[96m>> Menjalankan AutoGram Smart Uploader via $PYTHON_BIN...\033[0m"

# Jalankan script python unbuffered dengan argumen yang diberikan
"$PYTHON_BIN" -u "$PYTHON_SCRIPT" "$@"

EXIT_CODE=$?
exit $EXIT_CODE
