"""
App-wide AutoGram debug logging (gated by Settings toggle / env).

Enable when any of:
  - worker/temp/autogram_debug.txt is truthy (written by UI)
  - env AUTOGRAM_DEBUG=1
  - env AUTOGRAM_TRANSFER_DEBUG=1

Writes to:
  1) stdout [DEBUG] JSON  (job stream / desktop)
  2) emit_event("DebugLog", ...)
  3) worker/temp/autogram_debug.log (rotate ~4 MB)

Never log API hash, session material, or passwords.
"""
from __future__ import annotations

import json
import os
import threading
import time
import traceback
from typing import Any, Optional

_lock = threading.Lock()
_session_id: str = ""
_cache_enabled: Optional[bool] = None
_cache_t: float = 0.0
_CACHE_TTL = 1.0  # re-read flag file at most once per second


def _worker_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def flag_path() -> str:
    return os.path.join(_worker_root(), "temp", "autogram_debug.txt")


def log_path() -> str:
    return os.path.join(_worker_root(), "temp", "autogram_debug.log")


def set_debug_session(session_id: str) -> None:
    global _session_id
    _session_id = str(session_id or "")


def _env_truthy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def _flag_file_enabled() -> bool:
    path = flag_path()
    try:
        if not os.path.isfile(path):
            return False
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            body = (f.read() or "").strip().lower()
        if body in ("", "0", "false", "off", "no"):
            return False
        return True
    except OSError:
        return False


def is_debug_enabled() -> bool:
    """Dynamic gate — Settings toggle updates flag file without worker restart."""
    global _cache_enabled, _cache_t
    now = time.time()
    if _cache_enabled is not None and (now - _cache_t) < _CACHE_TTL:
        return _cache_enabled
    on = (
        _env_truthy("AUTOGRAM_DEBUG")
        or _env_truthy("AUTOGRAM_TRANSFER_DEBUG")
        or _flag_file_enabled()
    )
    _cache_enabled = on
    _cache_t = now
    return on


def invalidate_debug_cache() -> None:
    global _cache_enabled, _cache_t
    _cache_enabled = None
    _cache_t = 0.0


def _rotate_if_needed(path: str, max_bytes: int = 4 * 1024 * 1024) -> None:
    try:
        if os.path.isfile(path) and os.path.getsize(path) > max_bytes:
            bak = path + ".1"
            try:
                if os.path.isfile(bak):
                    os.remove(bak)
            except OSError:
                pass
            os.replace(path, bak)
    except OSError:
        pass


def _redact_fields(fields: dict) -> dict:
    """Drop / mask sensitive keys."""
    blocked = {
        "api_hash",
        "apiHash",
        "session",
        "session_string",
        "password",
        "phone_code_hash",
        "auth_key",
    }
    out = {}
    for k, v in fields.items():
        lk = str(k).lower()
        if k in blocked or lk in blocked or "api_hash" in lk or "session" == lk:
            out[k] = "***"
            continue
        if isinstance(v, str) and len(v) > 500 and ("session" in lk or "token" in lk):
            out[k] = v[:20] + "…***"
            continue
        out[k] = v
    return out


def dlog(
    message: str,
    *,
    level: str = "INFO",
    scope: str = "app",
    phase: str = "",
    force: bool = False,
    **fields: Any,
) -> None:
    """
    Log when debug enabled. force=True logs ERROR-level paths even if off
    is discouraged — prefer force only for critical ops when explicitly needed.
    """
    if not force and not is_debug_enabled():
        return

    rec: dict[str, Any] = {
        "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
        "epoch": round(time.time(), 3),
        "level": (level or "INFO").upper(),
        "scope": scope or "app",
        "session": _session_id or None,
        "phase": phase or None,
        "msg": message,
    }
    safe = _redact_fields(fields)
    for k, v in safe.items():
        if v is None:
            continue
        try:
            json.dumps(v, default=str)
            rec[k] = v
        except Exception:
            rec[k] = str(v)

    line = json.dumps(rec, default=str, ensure_ascii=False)

    try:
        print(f"[DEBUG] {line}", flush=True)
    except Exception:
        pass

    # Also emit [TRANSFER] alias for existing UI parsers on transfer scope
    if (scope or "").startswith("transfer") or (phase or "") in (
        "concurrent",
        "fallback",
        "seq_download",
        "finalize",
        "drive_download",
        "drive_batch",
        "fast_download",
    ):
        try:
            print(f"[TRANSFER] {line}", flush=True)
        except Exception:
            pass

    try:
        from engine.events import emit_event

        emit_event(
            "DebugLog",
            level=rec["level"],
            message=message,
            scope=scope,
            phase=phase or None,
            session=_session_id or None,
            **{k: v for k, v in safe.items() if v is not None},
        )
    except Exception:
        pass

    path = log_path()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with _lock:
            _rotate_if_needed(path)
            with open(path, "a", encoding="utf-8", errors="replace") as f:
                f.write(line + "\n")
    except Exception:
        pass


def dlog_verbose(message: str, *, scope: str = "app", phase: str = "", **fields: Any) -> None:
    if not is_debug_enabled():
        return
    dlog(message, level="DEBUG", scope=scope, phase=phase, **fields)


def dlog_exc(
    message: str,
    exc: BaseException,
    *,
    scope: str = "app",
    phase: str = "",
    **fields: Any,
) -> None:
    # Exceptions always go to log when debug ON; when OFF still emit short stderr
    if is_debug_enabled():
        dlog(
            message,
            level="ERROR",
            scope=scope,
            phase=phase,
            error=str(exc),
            error_type=type(exc).__name__,
            traceback="".join(
                traceback.format_exception(type(exc), exc, exc.__traceback__)
            )[-4000:],
            **fields,
        )
    else:
        try:
            print(f"[ERROR] {scope}/{phase}: {message}: {exc}", flush=True)
        except Exception:
            pass
