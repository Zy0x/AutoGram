"""
Force UTF-8 stdout/stderr on Windows so Telegram titles (e.g. ¹⁸ / emoji)
do not crash with: 'charmap' codec can't encode character...
"""
from __future__ import annotations

import json
import sys
from typing import Any


def ensure_utf8_stdio() -> None:
    for name in ("stdout", "stderr"):
        stream = getattr(sys, name, None)
        if stream is None:
            continue
        try:
            if hasattr(stream, "reconfigure"):
                stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    # Hard wrap on Windows if still not utf-8
    if sys.platform == "win32":
        for name in ("stdout", "stderr"):
            stream = getattr(sys, name, None)
            if stream is None:
                continue
            enc = (getattr(stream, "encoding", None) or "").lower()
            if enc in ("utf-8", "utf8"):
                continue
            try:
                buf = getattr(stream, "buffer", None)
                if buf is None:
                    continue
                import io

                wrapper = io.TextIOWrapper(
                    buf,
                    encoding="utf-8",
                    errors="replace",
                    line_buffering=True,
                    write_through=True,
                )
                setattr(sys, name, wrapper)
            except Exception:
                pass


def write_line(text: str, stream=None) -> None:
    """Write a line that must not fail on Windows code pages."""
    stream = stream or sys.stdout
    if not text.endswith("\n"):
        text = text + "\n"
    try:
        stream.write(text)
        stream.flush()
        return
    except UnicodeEncodeError:
        pass
    try:
        buf = getattr(stream, "buffer", None)
        if buf is not None:
            buf.write(text.encode("utf-8", errors="replace"))
            buf.flush()
            return
    except Exception:
        pass
    # Last resort: strip non-ascii
    try:
        stream.write(text.encode("ascii", errors="replace").decode("ascii"))
        stream.flush()
    except Exception:
        pass


def print_json(obj: Any, *, prefix: str = "") -> None:
    """JSON to stdout with UTF-8; ensure_ascii=False for readable names."""
    try:
        payload = json.dumps(obj, default=str, ensure_ascii=False)
    except Exception:
        payload = json.dumps({"error": "json_encode_failed"}, ensure_ascii=True)
    write_line(f"{prefix}{payload}")
