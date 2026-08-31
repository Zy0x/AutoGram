#!/usr/bin/env python3
"""Install or update the latest yt-dlp standalone executable atomically."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import sys
import tempfile
import urllib.request
from pathlib import Path


REPOSITORY = "yt-dlp/yt-dlp"
API_URL = f"https://api.github.com/repos/{REPOSITORY}/releases/latest"


def _asset_name() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    if system == "windows":
        return "yt-dlp_arm64.exe" if "arm64" in machine or "aarch64" in machine else "yt-dlp.exe"
    if system == "darwin":
        return "yt-dlp_macos"
    return "yt-dlp_linux_aarch64" if "aarch64" in machine or "arm64" in machine else "yt-dlp_linux"


def _root() -> Path:
    return Path(__file__).resolve().parents[1]


def _state_path() -> Path:
    return _root() / "runtime" / "state.json"


def _binary_path(asset: str) -> Path:
    return _root() / "bin" / asset


def _request(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "AutoGram-ytdlp-plugin"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def _latest_release() -> dict:
    return json.loads(_request(API_URL).decode("utf-8"))


def _sha256_sums(release: dict) -> str:
    asset = next((a for a in release.get("assets", []) if a.get("name") == "SHA2-256SUMS"), None)
    if not asset:
        raise RuntimeError("latest yt-dlp release does not publish SHA2-256SUMS")
    return _request(asset["browser_download_url"]).decode("utf-8", errors="replace")


def _expected_sha(sums: str, asset: str) -> str:
    for line in sums.splitlines():
        parts = line.strip().split()
        if len(parts) >= 2 and parts[-1].lstrip("*") == asset:
            return parts[0].lower()
    raise RuntimeError(f"SHA2-256SUMS has no entry for {asset}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="only report the latest version")
    parser.add_argument("--force", action="store_true", help="reinstall even when the version matches")
    args = parser.parse_args()

    asset = _asset_name()
    release = _latest_release()
    tag = str(release.get("tag_name") or "").strip()
    if not tag:
        raise RuntimeError("latest release did not contain tag_name")
    target = _binary_path(asset)
    state_file = _state_path()
    state = {}
    if state_file.exists():
        try:
            state = json.loads(state_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            state = {}

    print(json.dumps({"latest": tag, "asset": asset, "installed": state.get("version"), "path": str(target)}))
    if args.check:
        return 0
    if target.exists() and state.get("version") == tag and not args.force:
        return 0

    release_asset = next((a for a in release.get("assets", []) if a.get("name") == asset), None)
    if not release_asset:
        raise RuntimeError(f"latest release has no {asset} asset")

    payload = _request(release_asset["browser_download_url"])
    digest = hashlib.sha256(payload).hexdigest()
    expected = _expected_sha(_sha256_sums(release), asset)
    if digest != expected:
        raise RuntimeError(f"SHA-256 mismatch for {asset}: expected {expected}, got {digest}")

    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{asset}.", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        if os.name != "nt":
            os.chmod(temp_name, 0o755)
        os.replace(temp_name, target)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)

    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(
        json.dumps({"version": tag, "asset": asset, "sha256": digest, "updatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()}, indent=2),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # keep CLI diagnostics short and actionable
        print(f"yt-dlp plugin update failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
