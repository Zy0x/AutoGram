#!/usr/bin/env python3
"""Install or update the latest static FFmpeg & FFprobe binaries atomically."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import sys
import tempfile
import urllib.request
import zipfile
import tarfile
from pathlib import Path


# Standard lightweight static release asset endpoints
WINDOWS_ZIP_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
LINUX_TAR_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"
MACOS_ZIP_URL = "https://evermeet.cx/ffmpeg/getrelease/zip"


def _root() -> Path:
    return Path(__file__).resolve().parents[1]


def _state_path() -> Path:
    return _root() / "runtime" / "state.json"


def _bin_dir() -> Path:
    d = _root() / "bin"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _request_download(url: str, dest_path: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "AutoGram-ffmpeg-plugin/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response, open(dest_path, "wb") as out_file:
        shutil.copyfileobj(response, out_file)


def extract_binaries(archive_path: Path, target_bin_dir: Path) -> list[str]:
    extracted = []
    suffix = archive_path.suffix.lower()
    
    if suffix == ".zip":
        with zipfile.ZipFile(archive_path, 'r') as zip_ref:
            for member in zip_ref.namelist():
                name = Path(member).name.lower()
                if name in ("ffmpeg.exe", "ffprobe.exe", "ffmpeg", "ffprobe"):
                    source = zip_ref.open(member)
                    target_file = target_bin_dir / Path(member).name
                    with open(target_file, "wb") as target:
                        shutil.copyfileobj(source, target)
                    if not target_file.name.endswith(".exe"):
                        target_file.chmod(0o755)
                    extracted.append(target_file.name)
    elif suffix in (".xz", ".tar", ".gz") or str(archive_path).endswith(".tar.xz"):
        with tarfile.open(archive_path, 'r:*') as tar_ref:
            for member in tar_ref.getmembers():
                name = Path(member.name).name.lower()
                if name in ("ffmpeg", "ffprobe", "ffmpeg.exe", "ffprobe.exe"):
                    source = tar_ref.extractfile(member)
                    if source:
                        target_file = target_bin_dir / Path(member.name).name
                        with open(target_file, "wb") as target:
                            shutil.copyfileobj(source, target)
                        target_file.chmod(0o755)
                        extracted.append(target_file.name)
    return extracted


def main() -> int:
    parser = argparse.ArgumentParser(description="AutoGram FFmpeg Plugin Updater")
    parser.add_argument("--check", action="store_true", help="only check installed version status")
    parser.add_argument("--force", action="store_true", help="force reinstall even if already present")
    parser.add_argument("--target-dir", type=str, default="", help="custom destination bin directory")
    args = parser.parse_args()

    bin_dir = Path(args.target_dir) if args.target_dir else _bin_dir()
    bin_dir.mkdir(parents=True, exist_ok=True)

    state_file = _state_path()
    state = {}
    if state_file.exists():
        try:
            state = json.loads(state_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            state = {}

    system = platform.system().lower()
    ffmpeg_exe = bin_dir / ("ffmpeg.exe" if system == "windows" else "ffmpeg")
    ffprobe_exe = bin_dir / ("ffprobe.exe" if system == "windows" else "ffprobe")
    installed = ffmpeg_exe.is_file()

    info = {
        "installed": installed,
        "ffmpeg": str(ffmpeg_exe) if installed else None,
        "ffprobe": str(ffprobe_exe) if ffprobe_exe.is_file() else None,
        "version": state.get("version", "static-gpl"),
        "platform": system,
    }
    print(json.dumps(info))

    if args.check:
        return 0
    if installed and not args.force:
        return 0

    download_url = WINDOWS_ZIP_URL if system == "windows" else (MACOS_ZIP_URL if system == "darwin" else LINUX_TAR_URL)

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_archive = Path(tmp_dir) / ("ffmpeg_download" + (".zip" if "zip" in download_url else ".tar.xz"))
        print(f"Downloading FFmpeg runtime from {download_url}...")
        _request_download(download_url, tmp_archive)
        
        print("Extracting FFmpeg & FFprobe binaries...")
        extracted = extract_binaries(tmp_archive, bin_dir)
        if not extracted:
            raise RuntimeError("Failed to extract ffmpeg/ffprobe from download archive")

    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps({
        "version": "latest-static",
        "url": download_url,
        "extracted": extracted,
    }, indent=2), encoding="utf-8")

    print(f"FFmpeg plugin successfully installed to {bin_dir} ({', '.join(extracted)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
