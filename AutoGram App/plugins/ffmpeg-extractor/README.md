# AutoGram FFmpeg Extractor & Runtime Plugin

This plugin is the updateable boundary between AutoGram and `FFmpeg` / `FFprobe`.
The application uses FFmpeg for:
- Video keyframe and visual thumbnail extraction from Telegram MTProto cloud documents.
- Seekable Local HTTP Range Bridge (`206 Partial Content`) for instant partial keyframe fetching.
- Container faststart (`moov` atom relocation) and corrupt MP4 stream recovery.
- Hardware-accelerated GPU transcoding (NVENC, AMF, QSV) and AV1 software decoding (`libdav1d`).

The plugin executables (`ffmpeg.exe` / `ffprobe.exe`) are **intentionally not committed to the repository** to keep the codebase small, clean, and fast to clone.

## Update & Install

You can install or update the FFmpeg runtime via the AutoGram Desktop UI (under **Settings -> Transfers -> Plugins -> FFmpeg**) or manually via CLI:

```bash
# Cross-platform Python updater
python scripts/update_ffmpeg.py

# Windows 1-Click PowerShell
powershell -ExecutionPolicy Bypass -File scripts/update_ffmpeg.ps1

# Windows 1-Click Batch
scripts\update_ffmpeg.bat
```

The updater fetches official, verified static builds from release mirrors, validates checksums, and extracts the binaries atomically into `bin/`.
