"""
Track in-progress download destinations so Stop/cancel can wipe partials.

Registry: worker/temp/drive_active_downloads.json
  { "paths": ["C:\\\\...\\\\file.pdf", ...], "updated": 1234567890.1 }

Only incomplete work is listed. Successful finishes unregister.
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import List, Set

_lock = threading.Lock()


def _worker_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def registry_path() -> str:
    return os.path.join(_worker_root(), "temp", "drive_active_downloads.json")


def _load() -> Set[str]:
    path = registry_path()
    try:
        if not os.path.isfile(path):
            return set()
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        paths = data.get("paths") or []
        return {str(p) for p in paths if p}
    except Exception:
        return set()


def _save(paths: Set[str]) -> None:
    path = registry_path()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        body = {
            "paths": sorted(paths),
            "updated": time.time(),
        }
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(body, f, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception:
        pass


def register_download_path(dest: str) -> None:
    """Mark dest (+ implied .part) as in-progress incomplete download."""
    p = os.path.abspath(str(dest or "").strip())
    if not p:
        return
    with _lock:
        s = _load()
        s.add(p)
        _save(s)


def unregister_download_path(dest: str) -> None:
    """Remove dest after successful complete download."""
    p = os.path.abspath(str(dest or "").strip())
    if not p:
        return
    with _lock:
        s = _load()
        s.discard(p)
        _save(s)


def list_active_download_paths() -> List[str]:
    with _lock:
        return sorted(_load())


def clear_download_registry() -> None:
    with _lock:
        _save(set())
    try:
        p = registry_path()
        if os.path.isfile(p):
            os.remove(p)
    except OSError:
        pass


def cleanup_paths(paths: List[str]) -> dict:
    """
    Delete incomplete download artifacts: dest + dest.part.
    Returns {deleted: [...], failed: [...], count: n}.
    """
    deleted: List[str] = []
    failed: List[str] = []
    for raw in paths:
        p = os.path.abspath(str(raw or "").strip())
        if not p:
            continue
        candidates = [p, p + ".part"]
        # Telethon sometimes uses file.part naming already
        if not p.endswith(".part"):
            candidates.append(p + ".part")
        for c in candidates:
            try:
                if os.path.isfile(c):
                    os.remove(c)
                    deleted.append(c)
            except OSError as e:
                failed.append(f"{c}: {e}")
        with _lock:
            s = _load()
            s.discard(p)
            _save(s)
    return {"deleted": deleted, "failed": failed, "count": len(deleted)}


def cleanup_all_active() -> dict:
    paths = list_active_download_paths()
    result = cleanup_paths(paths)
    clear_download_registry()
    return result
