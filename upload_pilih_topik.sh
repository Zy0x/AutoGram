#!/usr/bin/env bash
# =============================================================================
# AutoGram Media Uploader - Interactive Topic Selector Launcher
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_PY="$SCRIPT_DIR/tools/upload_donghua/upload_donghua.py"

if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
    echo "[ERROR] Python 3 tidak ditemukan di sistem."
    exit 1
fi

PY_BIN="python3"
if ! command -v python3 &> /dev/null; then
    PY_BIN="python"
fi

exec "$PY_BIN" -u "$TARGET_PY" --select-topic "$@"
