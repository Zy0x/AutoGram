"""
Transfer logging — thin wrapper over engine.debug_log (Settings Debug Mode).

Kept for backward-compatible imports from fast_transfer / drive_fs.
"""
from __future__ import annotations

from typing import Any

from engine.debug_log import (
    dlog,
    dlog_exc,
    dlog_verbose,
    is_debug_enabled,
    log_path as _debug_log_path,
    set_debug_session,
)


def log_path() -> str:
    """Unified app debug log (same file as Debug Mode)."""
    return _debug_log_path()


def set_transfer_session(session_id: str) -> None:
    set_debug_session(session_id)


def is_verbose() -> bool:
    return is_debug_enabled()


def tlog(message: str, *, level: str = "INFO", phase: str = "", **fields: Any) -> None:
    dlog(message, level=level, scope="transfer", phase=phase, **fields)


def tlog_exc(message: str, exc: BaseException, *, phase: str = "", **fields: Any) -> None:
    dlog_exc(message, exc, scope="transfer", phase=phase, **fields)


def tlog_verbose(message: str, *, phase: str = "", **fields: Any) -> None:
    dlog_verbose(message, scope="transfer", phase=phase, **fields)
