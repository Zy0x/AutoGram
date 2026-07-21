"""
Path policy for Drive upload/download (defense in depth).

Upload: any readable local file is allowed except sensitive / system-critical paths.
  (Downloads/Documents still preferred for UX, but not required.)
Download: write under a granted save_dir / save_path parent (or any non-sensitive abs dir).
Never touch Telethon sessions, .env, or app secrets via transfer paths.
"""
from __future__ import annotations

import os
import re
from typing import Iterable, List, Optional, Sequence

# Basenames / suffixes that must never be upload sources
_BLOCK_BASENAME_RE = re.compile(
    r"(?i)^(\.env.*|.*\.session(-journal)?|credentials.*|secrets.*|master\.key)$"
)
_BLOCK_PATH_SUBSTR = (
    f"{os.sep}sessions{os.sep}",
    f"{os.sep}.ssh{os.sep}",
    f"{os.sep}secrets{os.sep}",
    "/sessions/",
    "/.ssh/",
    "/secrets/",
)

# Refuse reading/writing OS-critical trees (upload from "anywhere" ≠ system dirs)
_SYSTEM_PATH_MARKERS = (
    f"{os.sep}windows{os.sep}system32{os.sep}",
    f"{os.sep}windows{os.sep}syswow64{os.sep}",
    f"{os.sep}windows{os.sep}winsxs{os.sep}",
    f"{os.sep}program files{os.sep}",
    f"{os.sep}program files (x86){os.sep}",
    f"{os.sep}$recycle.bin{os.sep}",
    f"{os.sep}system volume information{os.sep}",
    "/etc/",
    "/usr/bin/",
    "/usr/sbin/",
    "/bin/",
    "/sbin/",
    "/boot/",
    "/proc/",
    "/sys/",
    "/dev/",
)


def _worker_root() -> str:
    # worker/engine/path_policy.py → worker/
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def transfer_pause_flag_path() -> str:
    """Soft-pause flag written by the UI (worker/temp/drive_pause.txt)."""
    return os.path.join(_worker_root(), "temp", "drive_pause.txt")


def is_transfer_paused() -> bool:
    """Disable file-based pause checks in V2."""
    return False


def _home() -> str:
    return os.path.expanduser("~") or os.environ.get("USERPROFILE") or os.environ.get("HOME") or ""


def allowed_upload_roots() -> List[str]:
    """Directories from which upload is permitted."""
    home = _home()
    worker = _worker_root()
    candidates = [
        os.path.join(home, "Downloads"),
        os.path.join(home, "Documents"),
        os.path.join(home, "Desktop"),
        os.path.join(home, "Pictures"),
        os.path.join(home, "Videos"),
        os.path.join(home, "Music"),
        os.path.join(home, "OneDrive"),
        os.path.join(home, "OneDrive", "Documents"),
        os.path.join(home, "OneDrive", "Pictures"),
        worker,
        os.path.join(worker, "temp"),
        os.path.join(worker, "cache"),
        os.path.join(worker, "cache", "open"),
        os.path.join(worker, "cache", "previews"),
        os.environ.get("TEMP") or "",
        os.environ.get("TMP") or "",
        os.path.join(home, "AppData", "Local", "Temp") if home else "",
    ]
    roots: List[str] = []
    seen = set()
    for c in candidates:
        if not c:
            continue
        try:
            p = os.path.realpath(c)
        except OSError:
            p = os.path.abspath(c)
        if not os.path.isdir(p):
            continue
        key = p.lower()
        if key in seen:
            continue
        seen.add(key)
        roots.append(p)
    return roots


def allowed_download_roots() -> List[str]:
    """Same user-facing areas (dialog typically picks under these)."""
    return allowed_upload_roots()


def _norm(path: str) -> str:
    s = str(path or "").strip().strip('"').strip("'")
    if s.startswith("\\\\?\\"):
        s = s[4:]
    return s


def is_blocked_sensitive_path(path: str) -> bool:
    raw = _norm(path)
    if not raw:
        return True
    base = os.path.basename(raw)
    if _BLOCK_BASENAME_RE.match(base):
        return True
    low = raw.replace("/", os.sep).lower()
    # session dir under worker
    if f"{os.sep}sessions{os.sep}" in low or low.endswith(f"{os.sep}sessions"):
        return True
    for sub in _BLOCK_PATH_SUBSTR:
        if sub.lower() in low:
            return True
    # Telethon session files without extension patterns
    if low.endswith(".session") or low.endswith(".session-journal"):
        return True
    return False


def is_system_critical_path(path: str) -> bool:
    """True for OS system trees that must never be upload sources."""
    raw = _norm(path)
    if not raw:
        return True
    low = raw.replace("/", os.sep).lower()
    # Normalize for marker matching
    low_slash = low.replace("\\", "/")
    for m in _SYSTEM_PATH_MARKERS:
        mm = m.replace("\\", "/").lower()
        if mm in low_slash:
            return True
    # Windows root-ish: C:\Windows\...
    if re.search(r"(?i)(^|[\\/])windows([\\/]|$)", low_slash):
        # allow user files named "Windows" under home/docs — only block real OS Windows tree
        if re.search(r"(?i)^[a-z]:/windows(/|$)", low_slash.replace("\\", "/")):
            return True
    return False


def _is_under_root(real_path: str, root: str) -> bool:
    try:
        rp = os.path.realpath(real_path)
        rr = os.path.realpath(root)
    except OSError:
        rp = os.path.abspath(real_path)
        rr = os.path.abspath(root)
    rp_l = rp.lower()
    rr_l = rr.lower()
    if rp_l == rr_l:
        return True
    prefix = rr_l if rr_l.endswith(os.sep) else rr_l + os.sep
    return rp_l.startswith(prefix)


def validate_upload_path(path: str, extra_roots: Optional[Sequence[str]] = None) -> str:
    """
    Return canonical absolute path if allowed for upload read.

    Policy (flexible):
      - Any existing regular file on any drive is allowed
      - Blocked: sessions, .env, secrets, SSH keys, OS system directories
      - extra_roots kept for API compatibility (always included in soft checks)
    """
    raw = _norm(path)
    if not raw:
        raise ValueError("Path upload kosong")
    if is_blocked_sensitive_path(raw):
        raise ValueError(
            f"Path diblokir (sensitif): {os.path.basename(raw)}. "
            "Session/.env/secrets tidak boleh diunggah."
        )
    if not os.path.isfile(raw):
        raise ValueError(f"File tidak ditemukan: {raw}")

    try:
        real = os.path.realpath(raw)
    except OSError:
        real = os.path.abspath(raw)

    if not os.path.isfile(real):
        raise ValueError(f"File tidak ditemukan: {raw}")

    if is_blocked_sensitive_path(real):
        raise ValueError(f"Path diblokir (sensitif): {os.path.basename(real)}")

    # Never allow reading from sessions even under worker root
    if f"{os.sep}sessions{os.sep}" in real.replace("/", os.sep).lower():
        raise ValueError("Upload dari folder sessions diblokir")

    if is_system_critical_path(real):
        raise ValueError(
            "Path sistem diblokir untuk upload (Windows/Program Files/system). "
            "Pilih file media/dokumen pengguna."
        )

    # Flexible allow: any other local file the user can read (DnD / dialog / F: D: etc.)
    # Keep extra_roots for callers that still pass dialog-granted roots (no-op now).
    _ = extra_roots
    try:
        # Ensure readable (permission check)
        with open(real, "rb") as f:
            f.read(1)
    except OSError as e:
        raise ValueError(f"File tidak bisa dibaca: {os.path.basename(real)} ({e})") from e

    return real


def validate_save_dir(save_dir: str, extra_roots: Optional[Sequence[str]] = None) -> str:
    """Canonical directory allowed for batch download writes."""
    raw = _norm(save_dir)
    if not raw:
        raise ValueError("Folder unduh kosong")
    if is_blocked_sensitive_path(raw):
        raise ValueError("Folder unduh diblokir (sensitif)")
    try:
        os.makedirs(raw, exist_ok=True)
    except OSError as e:
        raise ValueError(f"Tidak bisa membuat folder unduh: {e}") from e
    try:
        real = os.path.realpath(raw)
    except OSError:
        real = os.path.abspath(raw)
    if not os.path.isdir(real):
        raise ValueError(f"Folder unduh tidak valid: {raw}")

    roots = list(allowed_download_roots())
    if extra_roots:
        for r in extra_roots:
            if r and os.path.isdir(r):
                roots.append(os.path.realpath(r))
    # Also allow the directory itself if user picked it (dialog) — trust if under home or temp
    home = _home()
    if home and _is_under_root(real, home):
        return real
    for root in roots:
        if _is_under_root(real, root):
            return real
    # Dialog often returns paths under D:\ etc. — allow any local absolute dir that is not blocked
    # but refuse sessions/secrets. User explicitly chose folder via OS dialog.
    if os.path.isabs(real) and not is_blocked_sensitive_path(real):
        return real
    raise ValueError(f"Folder unduh di luar area aman: {raw}")


def validate_save_path(save_path: str, extra_roots: Optional[Sequence[str]] = None) -> str:
    """Single-file download destination; parent dir must be allowed."""
    raw = _norm(save_path)
    if not raw:
        raise ValueError("Path simpan kosong")
    parent = os.path.dirname(os.path.abspath(raw)) or "."
    base = os.path.basename(raw)
    if not base or base in (".", "..") or ".." in base:
        raise ValueError("Nama file unduh tidak valid")
    if is_blocked_sensitive_path(raw) or is_blocked_sensitive_path(base):
        raise ValueError("Path simpan diblokir (sensitif)")
    safe_parent = validate_save_dir(parent, extra_roots=extra_roots)
    # Re-join under validated parent (prevents path tricks in basename)
    safe_base = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", base)[:180] or "download.bin"
    final = os.path.join(safe_parent, safe_base)
    # Ensure final stays under parent
    if not _is_under_root(final, safe_parent):
        raise ValueError("Path unduh escape folder tujuan")
    return os.path.abspath(final)


def safe_join_download(save_dir: str, filename: str) -> str:
    """Join basename into save_dir with sanitization; raises if escape."""
    root = validate_save_dir(save_dir)
    base = os.path.basename(str(filename or "file").replace("\\", "/"))
    base = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", base)[:180] or "file.bin"
    final = os.path.abspath(os.path.join(root, base))
    if not _is_under_root(final, root):
        raise ValueError("Nama file unduh tidak aman")
    return final
