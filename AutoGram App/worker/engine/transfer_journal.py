"""Crash-tolerant Media Studio transfer journal and verbose per-run log."""
from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any, Dict

from engine.debug_log import is_debug_enabled

_LOCK = threading.Lock()
_MAX_RUN_BYTES = 16 * 1024 * 1024
_MAX_RUNS = 20
_WINDOWS_PATH_RE = re.compile(
    r"(?i)(?:[a-z]:[\\/](?:[^\\/:*?\"<>|\r\n]+[\\/])*)([^\\/:*?\"<>|\r\n]+)"
)
_POSIX_PATH_RE = re.compile(r"(?:/(?:[^/\s:]+/)+)([^/\s:]+)")


def _worker_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _safe_value(key: str, value: Any) -> Any:
    low = str(key).lower()
    if low in {"session", "session_path", "session_file", "session_name"} or any(
        marker in low for marker in ("api_hash", "auth_key", "password")
    ):
        return "***"
    if low in {"path", "file_path", "source_path", "upload_path"}:
        return os.path.basename(str(value or ""))
    if low in {"caption", "thumb_data_url", "thumbnail_data", "media_bytes"}:
        return "[redacted]"
    if isinstance(value, bytes):
        return f"[bytes:{len(value)}]"
    if isinstance(value, str) and low in {"error", "message", "fallback_reason"}:
        # Exceptions can embed an absolute input/temp/session path. Preserve the
        # diagnostic text while reducing every path to its basename.
        value = _WINDOWS_PATH_RE.sub(lambda match: match.group(1), value)
        value = _POSIX_PATH_RE.sub(lambda match: match.group(1), value)
    return value


class TransferJournal:
    """Append-only safety journal; verbose fields are gated by Debug Mode."""

    def __init__(self, transfer_id: str):
        clean = "".join(ch for ch in str(transfer_id) if ch.isalnum() or ch in "-_")[:96]
        self.transfer_id = clean or f"transfer-{int(time.time())}"
        root = os.path.join(_worker_root(), "logs", "transfers")
        os.makedirs(root, exist_ok=True)
        self.path = os.path.join(root, f"{self.transfer_id}.jsonl")
        self._prune(root)

    @staticmethod
    def _prune(root: str) -> None:
        try:
            files = [
                os.path.join(root, name)
                for name in os.listdir(root)
                if name.endswith(".jsonl") and os.path.isfile(os.path.join(root, name))
            ]
            files.sort(key=lambda path: os.path.getmtime(path), reverse=True)
            for stale in files[_MAX_RUNS:]:
                try:
                    os.remove(stale)
                except OSError:
                    pass
        except OSError:
            pass

    def append(
        self,
        event: str,
        *,
        critical: bool = False,
        verbose: bool = False,
        **fields: Any,
    ) -> None:
        if verbose and not is_debug_enabled():
            return
        safe: Dict[str, Any] = {str(k): _safe_value(str(k), v) for k, v in fields.items()}
        record: Dict[str, Any] = {
            "ts": round(time.time(), 3),
            "transfer_id": self.transfer_id,
            "event": str(event),
            **safe,
        }
        line = json.dumps(record, ensure_ascii=False, default=str)
        try:
            with _LOCK:
                if os.path.isfile(self.path) and os.path.getsize(self.path) >= _MAX_RUN_BYTES:
                    return
                with open(self.path, "a", encoding="utf-8", errors="replace") as fh:
                    fh.write(line + "\n")
                    fh.flush()
                    if critical:
                        os.fsync(fh.fileno())
        except OSError:
            pass

    def acknowledged_parts(self, index: int, fingerprint: str) -> set[int]:
        """Recover acknowledged part indexes for the same prepared file."""
        if not fingerprint or not os.path.isfile(self.path):
            return set()
        prepared_matches = False
        acknowledged: set[int] = set()
        try:
            with open(self.path, "r", encoding="utf-8", errors="replace") as fh:
                for raw in fh:
                    try:
                        row = json.loads(raw)
                    except Exception:
                        continue
                    if int(row.get("index", -1)) != int(index):
                        continue
                    event = str(row.get("event") or "")
                    if event == "preflight_done":
                        prepared_matches = str(row.get("fingerprint") or "") == fingerprint
                        acknowledged.clear()
                    elif event == "upload_start" and not prepared_matches:
                        acknowledged.clear()
                    elif event == "part_acked" and prepared_matches:
                        try:
                            acknowledged.add(int(row["part_index"]))
                        except Exception:
                            pass
        except OSError:
            return set()
        return acknowledged
