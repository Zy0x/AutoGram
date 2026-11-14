#!/usr/bin/env bash
# =============================================================================
# AutoGram Smart Media Uploader - Root Launcher (Topic: Donghua NSFW)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_SH="$SCRIPT_DIR/tools/upload_donghua/upload_donghua.sh"

if [ -f "$TARGET_SH" ]; then
    bash "$TARGET_SH" "$@"
else
    echo "Tidak menemukan $TARGET_SH"
    exit 1
fi
