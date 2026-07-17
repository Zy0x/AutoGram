"""
Progressive media streaming for AutoGram Drive previews.

Telegram official clients are fast because they use **concurrent GetFile parts**
on the **media DC** — not a different API. We do the same via Telethon:

- Pipeline multi-part download from offset 0 (prefix buffer)
- **Seek-at-offset**: concurrent GetFile around the jump (YouTube-like)
- Local HTTP Range server for <video>

TDLib/Pyrogram talk to the same Telegram servers; speed gains come from
concurrency + DC routing (implemented here), not swapping Telethon alone.

Filled byte ranges are tracked explicitly so sparse seek writes never look like
"full file ready" (Windows extends files with zeros).
"""
from __future__ import annotations

import asyncio
import os
import re
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import unquote

from telethon import utils
from telethon.tl.functions.upload import GetFileRequest

# stream_id -> ProgressiveMedia
_STREAMS: Dict[str, "ProgressiveMedia"] = {}
_LOCK = threading.RLock()
_SERVER: Optional[ThreadingHTTPServer] = None
_SERVER_THREAD: Optional[threading.Thread] = None
_PORT: int = 0

# Seek / pipeline windows (Telegram max part = 512 KiB)
_PART = 512 * 1024
_SEEK_WINDOW = 8 * 1024 * 1024  # ~8 MiB around seek (like client pre-buffer)
_PIPELINE_WINDOW = 8 * 1024 * 1024  # concurrent prefix batches
_SEEK_ALIGN = 64 * 1024
_STREAM_WORKERS = 16
# Document / re-encode MP4 often puts moov at EOF — fetch enough for full atom
_MOOV_TAIL_BUDGET = 2 * 1024 * 1024
_MOOV_TAIL_MIN = 256 * 1024


def _merge_ranges(ranges: List[Tuple[int, int]]) -> List[Tuple[int, int]]:
    """Merge half-open [start, end) intervals."""
    if not ranges:
        return []
    ordered = sorted(ranges, key=lambda x: x[0])
    out: List[Tuple[int, int]] = [ordered[0]]
    for s, e in ordered[1:]:
        ps, pe = out[-1]
        if s <= pe:
            out[-1] = (ps, max(pe, e))
        else:
            out.append((s, e))
    return out


class ProgressiveMedia:
    def __init__(
        self,
        *,
        path: str,
        total_size: int,
        mime: str,
        label: str = "",
    ) -> None:
        self.path = path
        self.total_size = max(0, int(total_size or 0))
        self.mime = mime or "application/octet-stream"
        self.label = label
        self.downloaded = 0
        self.done = False
        self.error: Optional[str] = None
        self.created = time.time()
        self.cv = threading.Condition()
        self.refcount = 0
        self.cancelled = False
        # Explicit filled ranges [start, end) — source of truth for seek/serve
        self._ranges: List[Tuple[int, int]] = []
        self._write_lock = threading.Lock()
        # Bound by fill_stream_from_telegram for seek-at-offset tasks
        self._client = None
        self._msg = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._input_loc = None
        self._dc_id: Optional[int] = None
        self._media_api = None  # client or exported media-DC sender
        self._media_sender = None  # must be returned if borrowed
        self._seek_inflight: Dict[int, float] = {}  # aligned_offset -> started_at
        self._seek_lock = threading.Lock()
        from collections import OrderedDict
        self._ram_cache = OrderedDict()  # part_off -> data

    def cancel(self) -> None:
        with self.cv:
            self.cancelled = True
            self.cv.notify_all()

    def read_from_cache(self, pos: int, to_read: int) -> Optional[bytes]:
        part_off = (pos // _PART) * _PART
        intra_off = pos - part_off
        with self.cv:
            if part_off in self._ram_cache:
                self._ram_cache.move_to_end(part_off)
                chunk_data = self._ram_cache[part_off]
                avail = len(chunk_data) - intra_off
                if avail >= to_read:
                    return chunk_data[intra_off : intra_off + to_read]
        return None

    def bind_telegram(
        self,
        client,
        msg,
        loop: asyncio.AbstractEventLoop,
        *,
        input_loc=None,
        dc_id: Optional[int] = None,
        media_api=None,
        media_sender=None,
    ) -> None:
        self._client = client
        self._msg = msg
        self._loop = loop
        if input_loc is not None:
            self._input_loc = input_loc
        if dc_id is not None:
            self._dc_id = int(dc_id)
        if media_api is not None:
            self._media_api = media_api
        if media_sender is not None:
            self._media_sender = media_sender

    def mark_range(self, start: int, length: int) -> None:
        if length <= 0:
            return
        start = max(0, int(start))
        end = start + int(length)
        with self.cv:
            self._ranges = _merge_ranges(self._ranges + [(start, end)])
            self.downloaded = self.filled_bytes()
            self.cv.notify_all()

    def filled_bytes(self) -> int:
        return sum(e - s for s, e in self._ranges)

    def _contiguous_from_zero_unlocked(self) -> int:
        ranges = self._ranges
        if not ranges or ranges[0][0] > 0:
            return 0
        return ranges[0][1]

    def contiguous_from_zero(self) -> int:
        """How many bytes are solidly available from offset 0 (prefix)."""
        with self.cv:
            return self._contiguous_from_zero_unlocked()

    def has_byte(self, pos: int) -> bool:
        with self.cv:
            for s, e in self._ranges:
                if s <= pos < e:
                    return True
        return False

    def _contiguous_end_from_unlocked(self, start: int) -> int:
        for s, e in self._ranges:
            if s <= start < e:
                return e
            if s > start:
                break
        return start

    def contiguous_end_from(self, start: int) -> int:
        """Largest end such that [start, end) is fully filled."""
        with self.cv:
            return self._contiguous_end_from_unlocked(start)

    def wait_for_bytes(self, need: int, timeout: float = 30.0) -> int:
        """Wait until contiguous prefix from 0 reaches `need` (or done/cancel)."""
        deadline = time.time() + max(0.1, timeout)
        with self.cv:
            while True:
                have = self.contiguous_from_zero()
                self.downloaded = self.filled_bytes()
                if self.cancelled or self.error:
                    return have
                if self.done or have >= need:
                    return have
                remaining = deadline - time.time()
                if remaining <= 0:
                    return have
                self.cv.wait(timeout=min(0.35, remaining))

    def wait_for_range(self, start: int, min_len: int, timeout: float = 30.0) -> int:
        """Wait until [start, start+min_len) has any contiguous coverage from start."""
        deadline = time.time() + max(0.1, timeout)
        need_end = start + max(1, min_len)
        with self.cv:
            while True:
                end = self._contiguous_end_from_unlocked(start)
                if self.cancelled or self.error:
                    return end
                if self.done and end <= start:
                    return end
                if end >= need_end:
                    return end
                remaining = deadline - time.time()
                if remaining <= 0:
                    return end
                self.cv.wait(timeout=min(0.35, remaining))

    def _safe_size(self) -> int:
        """Disk size (may include sparse zeros) — prefer range helpers for logic."""
        try:
            if os.path.isfile(self.path):
                return int(os.path.getsize(self.path))
        except OSError:
            pass
        return 0

    def notify(self) -> None:
        with self.cv:
            self.downloaded = self.filled_bytes()
            self.cv.notify_all()

    def mark_done(self) -> None:
        with self.cv:
            self.done = True
            have = self._contiguous_from_zero_unlocked()
            if self.total_size > 0 and have >= self.total_size:
                self._ranges = [(0, self.total_size)]
            self.downloaded = sum(e - s for s, e in self._ranges)
            if self.total_size <= 0:
                self.total_size = max(self.downloaded, self._safe_size())
            self.cv.notify_all()

    def mark_error(self, err: str) -> None:
        with self.cv:
            self.error = err or "stream failed"
            self.done = True
            self.cv.notify_all()

    def schedule_seek(self, byte_offset: int, window: int = _SEEK_WINDOW) -> bool:
        """
        Kick off (or reuse) a Telegram offset-download around byte_offset.
        Safe to call from the HTTP thread.
        """
        if self.cancelled or self.done:
            return False
        if self._loop is None or self._input_loc is None:
            # Not bound yet / location missing — cannot random-access
            return False
        if (self._media_api is None and self._client is None):
            return False
        total = self.total_size or 0
        off = max(0, int(byte_offset))
        off = (off // _SEEK_ALIGN) * _SEEK_ALIGN
        if total > 0 and off >= total:
            return False
        # Already have enough here?
        have = self.contiguous_end_from(off)
        if have >= off + min(256 * 1024, window):
            return True
        with self._seek_lock:
            now = time.time()
            for k, t0 in list(self._seek_inflight.items()):
                if now - t0 > 60:
                    self._seek_inflight.pop(k, None)
                elif abs(k - off) < _SEEK_WINDOW // 2:
                    return True
            self._seek_inflight[off] = now
        length = window if total <= 0 else min(window, total - off)
        try:
            asyncio.run_coroutine_threadsafe(
                _fill_range_from_telegram(self, off, length),
                self._loop,
            )
            return True
        except Exception:
            with self._seek_lock:
                self._seek_inflight.pop(off, None)
            return False


def _ensure_server() -> int:
    global _SERVER, _SERVER_THREAD, _PORT
    with _LOCK:
        if _SERVER is not None and _PORT:
            return _PORT

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, fmt: str, *args) -> None:  # noqa: A003
                return  # quiet

            def _cors(self) -> None:
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Range, Content-Type")
                self.send_header(
                    "Access-Control-Expose-Headers",
                    "Content-Length, Content-Range, Accept-Ranges, Retry-After, "
                    "X-AutoGram-Buffer, X-AutoGram-Available",
                )

            def do_OPTIONS(self) -> None:  # noqa: N802
                self.send_response(204)
                self._cors()
                self.end_headers()

            def do_HEAD(self) -> None:  # noqa: N802
                self._serve(head_only=True)

            def do_GET(self) -> None:  # noqa: N802
                self._serve(head_only=False)

            def _serve(self, head_only: bool) -> None:
                path = unquote(self.path or "")
                m = re.match(r"^/stream/([a-zA-Z0-9_-]+)(?:/.*)?$", path)
                if not m:
                    self.send_error(404, "not found")
                    return
                sid = m.group(1)
                with _LOCK:
                    media = _STREAMS.get(sid)
                if not media:
                    self.send_error(404, "stream expired")
                    return

                # Need moov / file head first (small — open video ASAP)
                first_need = min(64 * 1024, media.total_size or 64 * 1024)
                media.wait_for_bytes(first_need, timeout=8.0)
                if media.contiguous_from_zero() < first_need and not media.done:
                    # Kick head download if idle
                    media.schedule_seek(0, window=min(_PIPELINE_WINDOW, media.total_size or _PIPELINE_WINDOW))
                    media.wait_for_bytes(first_need, timeout=6.0)
                if media.error and media.contiguous_from_zero() <= 0:
                    self.send_error(502, media.error or "stream error")
                    return
                if media.contiguous_from_zero() <= 0 and not media.done:
                    self.send_error(503, "buffering")
                    return

                file_size_known = media.total_size if media.total_size > 0 else None
                range_hdr = self.headers.get("Range") or self.headers.get("range")
                start = 0
                end_req: Optional[int] = None

                if range_hdr and range_hdr.startswith("bytes="):
                    try:
                        spec = range_hdr.replace("bytes=", "").strip()
                        if "," in spec:
                            spec = spec.split(",", 1)[0]
                        a, _, b = spec.partition("-")
                        start = int(a) if a else 0
                        end_req = int(b) if b else None
                    except Exception:
                        start = 0
                        end_req = None

                    # --- YouTube-like: if range is ahead of prefix, pull that offset ---
                    prefix = media.contiguous_from_zero()
                    if start > 0 and not media.done and not media.has_byte(start):
                        # Tail/moov requests (near EOF) need a larger window for document MP4
                        total_sz = media.total_size or 0
                        near_end = total_sz > 0 and start >= max(0, total_sz - _MOOV_TAIL_BUDGET)
                        win = (
                            min(_MOOV_TAIL_BUDGET, total_sz - start)
                            if near_end and total_sz > start
                            else _SEEK_WINDOW
                        )
                        media.schedule_seek(start, window=max(win, 256 * 1024))
                        media.wait_for_range(start, 128 * 1024, timeout=28.0)

                    if not media.has_byte(start) and not media.done:
                        # Still cold — brief tip wait if near sequential prefix
                        if start <= prefix + 512 * 1024:
                            media.wait_for_bytes(start + 64 * 1024, timeout=10.0)
                        if not media.has_byte(start):
                            self.send_response(503)
                            self._cors()
                            self.send_header("Retry-After", "1")
                            self.send_header("Cache-Control", "no-cache")
                            self.send_header("X-AutoGram-Buffer", "seek-loading")
                            self.send_header(
                                "X-AutoGram-Available", str(media.contiguous_from_zero())
                            )
                            self.end_headers()
                            return

                    if not media.has_byte(start) and media.done:
                        self.send_error(416, "range not satisfiable")
                        return

                    # Serve longest contiguous filled span from start
                    filled_end = media.contiguous_end_from(start)
                    window = 2 * 1024 * 1024 if not media.done else 4 * 1024 * 1024
                    chunk_end = filled_end - 1
                    if end_req is not None:
                        chunk_end = min(chunk_end, end_req)
                    else:
                        chunk_end = min(chunk_end, start + window - 1)

                    # Grow a bit if still filling this region
                    if not media.done and chunk_end < start + 256 * 1024:
                        media.schedule_seek(start, window=_SEEK_WINDOW)
                        media.wait_for_range(start, 512 * 1024, timeout=8.0)
                        filled_end = media.contiguous_end_from(start)
                        chunk_end = min(filled_end - 1, start + window - 1)
                        if end_req is not None:
                            chunk_end = min(chunk_end, end_req)

                    length = max(0, chunk_end - start + 1)
                    total_for_range = (
                        file_size_known
                        if file_size_known
                        else max(filled_end, chunk_end + 1)
                    )

                    self.send_response(206)
                    self._cors()
                    self.send_header("Content-Type", media.mime)
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header(
                        "Content-Range", f"bytes {start}-{chunk_end}/{total_for_range}"
                    )
                    self.send_header("Content-Length", str(length))
                    self.send_header("Cache-Control", "no-cache")
                    self.end_headers()
                    if head_only or length <= 0:
                        return
                    self._write_file_range(media, start, length)
                    return

                # Full GET — grow body as contiguous prefix fills (never claim
                # full size while holes exist — that freezes the player at 0:00).
                media.wait_for_bytes(
                    min(256 * 1024, media.total_size or 256 * 1024), timeout=20.0
                )
                prefix = media.contiguous_from_zero()
                if media.done and file_size_known:
                    length = file_size_known
                elif file_size_known and media.done:
                    length = file_size_known
                elif file_size_known:
                    # Progressive: advertise final size; body waits for real bytes
                    length = file_size_known
                else:
                    length = max(prefix, 1)

                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", media.mime)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(length))
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                if head_only or length <= 0:
                    return
                # Stream from 0, blocking until each next byte is *really* filled
                self._write_file_range(media, 0, length, grow=True)

            def _write_file_range(
                self,
                media: ProgressiveMedia,
                start: int,
                length: int,
                grow: bool = False,
            ) -> None:
                sent = 0
                f = None
                try:
                    while sent < length:
                        if media.cancelled:
                            return
                        pos = start + sent
                        filled_end = media.contiguous_end_from(pos)
                        if filled_end <= pos:
                            if media.done:
                                break
                            # Prefer pulling the missing tip (esp. head) instead of spinning
                            if pos == 0 or grow:
                                media.schedule_seek(pos, window=_PIPELINE_WINDOW)
                            media.wait_for_range(pos, 64 * 1024, timeout=15.0)
                            filled_end = media.contiguous_end_from(pos)
                            if filled_end <= pos:
                                if not grow:
                                    break
                                # grow mode: one more wait then exit to avoid infinite hang
                                media.wait_for_range(pos, 1, timeout=10.0)
                                filled_end = media.contiguous_end_from(pos)
                                if filled_end <= pos:
                                    break
                        to_read = min(
                            64 * 1024,
                            length - sent,
                            filled_end - pos,
                        )
                        if to_read <= 0:
                            break
                        
                        # Try RAM cache first
                        chunk = media.read_from_cache(pos, to_read)
                        if chunk is None:
                            if f is None:
                                f = open(media.path, "rb")
                            f.seek(pos)
                            chunk = f.read(to_read)
                        
                        if not chunk:
                            break
                        try:
                            self.wfile.write(chunk)
                        except (
                            BrokenPipeError,
                            ConnectionResetError,
                            ConnectionAbortedError,
                        ):
                            return
                        sent += len(chunk)
                except Exception:
                    return
                finally:
                    if f is not None:
                        try:
                            f.close()
                        except Exception:
                            pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        port = int(server.server_address[1])
        t = threading.Thread(target=server.serve_forever, name="ag-media-stream", daemon=True)
        t.start()
        _SERVER = server
        _SERVER_THREAD = t
        _PORT = port
        return _PORT


def register_stream(
    *,
    path: str,
    total_size: int,
    mime: str,
    label: str = "",
) -> Dict[str, Any]:
    port = _ensure_server()
    sid = uuid.uuid4().hex[:16]
    media = ProgressiveMedia(
        path=path, total_size=total_size, mime=mime, label=label
    )
    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        if not os.path.isfile(path):
            open(path, "wb").close()
        elif total_size > 0 and os.path.getsize(path) >= total_size:
            media.mark_range(0, total_size)
    except OSError:
        pass
    with _LOCK:
        _STREAMS[sid] = media
        now = time.time()
        dead = [k for k, v in _STREAMS.items() if now - v.created > 7200 and v.done]
        for k in dead[:20]:
            _STREAMS.pop(k, None)

    safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", (label or "media"))[:80] or "media"
    url = f"http://127.0.0.1:{port}/stream/{sid}/{safe_name}"
    return {
        "stream_id": sid,
        "stream_url": url,
        "port": port,
        "path": path,
        "mime_type": mime,
        "size": total_size,
    }


def get_stream(stream_id: str) -> Optional[ProgressiveMedia]:
    with _LOCK:
        return _STREAMS.get(stream_id)


def stream_status(stream_id: str) -> Dict[str, Any]:
    media = get_stream(stream_id)
    if not media:
        return {"status": "missing"}
    filled = media.filled_bytes()
    prefix = media.contiguous_from_zero()
    total = media.total_size or 0
    pct = round(100.0 * filled / total, 2) if total > 0 else 0.0
    if media.cancelled:
        st = "cancelled"
    elif media.error:
        st = "error"
    elif media.done:
        st = "done"
    else:
        st = "downloading"
    # Playable % = contiguous from 0 (what <video> can actually start with).
    # Filled % can be higher if seek/moov-tail created islands ahead.
    playable_pct = round(100.0 * prefix / total, 2) if total > 0 else 0.0
    # For UI buffer bar: prefer playable prefix (matches progressive play).
    # Also expose filled so document moov-tail progress is visible as secondary.
    return {
        "status": st,
        "downloaded": prefix,  # playable contiguous — what buffer bar should show
        "downloaded_filled": filled,  # all islands (head+tail+seeks)
        "prefix_bytes": prefix,
        "total": total,
        "percent": playable_pct,
        "filled_percent": pct,
        "error": media.error,
        "path": media.path,
        "mime_type": media.mime,
        "cancelled": bool(media.cancelled),
        "stream_ready": prefix >= min(256 * 1024, total or 256 * 1024),
        "seek_capable": bool(media._input_loc is not None and not media.done),
        "moov_ready": bool(
            prefix >= min(64 * 1024, total or 64 * 1024)
            and (
                _path_region_has_moov(media.path, 0, min(prefix, 1024 * 1024))
                or (
                    total > 512 * 1024
                    and media.has_byte(max(0, total - 64 * 1024))
                )
            )
        ),
    }


def stream_seek(
    stream_id: str,
    *,
    offset: Optional[int] = None,
    time_s: Optional[float] = None,
    duration_s: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Request YouTube-like jump: start Telegram download at estimated byte offset.
    """
    media = get_stream(stream_id)
    if not media:
        return {"status": "missing"}
    if media.done:
        return {"status": "done", "offset": 0}
    off = offset
    if off is None and time_s is not None and media.total_size > 0:
        dur = float(duration_s or 0)
        if dur > 0:
            ratio = max(0.0, min(1.0, float(time_s) / dur))
            off = int(ratio * media.total_size)
        else:
            # No duration: treat time_s as ratio if 0..1 else ignore
            off = 0
    if off is None:
        return {"status": "error", "error": "offset or time_s required"}
    off = max(0, int(off))
    ok = media.schedule_seek(off, window=_SEEK_WINDOW)
    return {
        "status": "ok" if ok else "busy",
        "offset": off,
        "window": _SEEK_WINDOW,
        "seek_capable": media._client is not None,
    }


def stop_stream(
    stream_id: str,
    *,
    delete_partial: bool = True,
) -> Dict[str, Any]:
    sid = str(stream_id or "").strip()
    if not sid:
        return {"status": "missing", "stream_id": sid}
    with _LOCK:
        media = _STREAMS.pop(sid, None)
    if not media:
        return {"status": "missing", "stream_id": sid}
    media.cancel()
    deleted = False
    path = media.path
    if delete_partial and path and not media.done:
        try:
            if os.path.isfile(path):
                os.remove(path)
                deleted = True
        except OSError:
            pass
    return {
        "status": "stopped",
        "stream_id": sid,
        "was_done": bool(media.done),
        "deleted_partial": deleted,
        "path": path,
    }


def stop_all_streams(*, incomplete_only: bool = True) -> Dict[str, Any]:
    with _LOCK:
        ids = list(_STREAMS.keys())
    stopped = []
    for sid in ids:
        media = get_stream(sid)
        if incomplete_only and media and media.done and not media.cancelled:
            continue
        stopped.append(stop_stream(sid, delete_partial=True))
    return {"status": "success", "stopped": len(stopped), "results": stopped}


async def _borrow_media_api(client, dc_id: Optional[int]):
    """Use media DC sender when file lives on another DC (Telegram-client style)."""
    media_sender = None
    try:
        home = getattr(client.session, "dc_id", None)
    except Exception:
        home = None
    if (
        dc_id
        and home
        and int(dc_id) != int(home)
        and hasattr(client, "_borrow_exported_sender")
    ):
        try:
            media_sender = await client._borrow_exported_sender(int(dc_id))
        except Exception:
            media_sender = None
    api = media_sender if media_sender is not None else client
    return api, media_sender


async def _release_media_sender(client, media_sender) -> None:
    if media_sender is None:
        return
    try:
        if hasattr(client, "_return_exported_sender"):
            await client._return_exported_sender(media_sender)
    except Exception:
        pass


async def _getfile_part(api, input_loc, offset: int, need: int) -> bytes:
    """One GetFile part with flood handling (same path as fast_transfer)."""
    from engine.fast_transfer import _call_with_flood, _getfile_limit_candidates

    data = b""
    for limit in _getfile_limit_candidates(need, _PART):
        try:
            result = await _call_with_flood(
                api,
                GetFileRequest(location=input_loc, offset=offset, limit=limit),
            )
            data = getattr(result, "bytes", None) or b""
            if data:
                break
        except Exception as e:
            err = str(e).lower()
            if "limit" in err or "invalid" in err:
                continue
            raise
    return data[:need] if data else b""


async def _download_parts_concurrent(
    media: ProgressiveMedia,
    *,
    start: int,
    length: int,
    workers: int = _STREAM_WORKERS,
    head_first: bool = True,
) -> int:
    """
    Concurrent multi-part GetFile into media.path at [start, start+length).

    head_first=True (default): always finish the first part at `start` before
    parallelizing the rest — prevents "71% filled but 0:00 frozen" when part 0
    loses the race and leaves a hole at the playhead.
    """
    if media.cancelled or length <= 0:
        return 0
    api = media._media_api or media._client
    loc = media._input_loc
    if api is None or loc is None:
        return 0

    total = media.total_size or 0
    end = start + length
    if total > 0:
        end = min(end, total)
    length = max(0, end - start)
    if length <= 0:
        return 0

    # Build part offsets; skip already-filled spans
    offsets: List[int] = []
    off = start
    while off < end:
        filled_to = media.contiguous_end_from(off)
        if filled_to > off:
            off = filled_to
            continue
        offsets.append(off)
        off += _PART

    if not offsets:
        return media.contiguous_end_from(start) - start

    sem = asyncio.Semaphore(max(2, min(int(workers), 24)))
    written = 0
    lock = asyncio.Lock()

    async def one(part_off: int) -> None:
        nonlocal written
        if media.cancelled:
            return
        need = min(_PART, end - part_off)
        if need <= 0:
            return
        if media.contiguous_end_from(part_off) >= part_off + need:
            return
        try:
            async with sem:
                if media.cancelled:
                    return
                data = await _getfile_part(api, loc, part_off, need)
        except Exception:
            return
        if not data:
            return

        def _write():
            os.makedirs(os.path.dirname(media.path) or ".", exist_ok=True)
            # Ensure file exists and is large enough for seek write
            with media._write_lock:
                mode = "r+b" if os.path.isfile(media.path) else "w+b"
                with open(media.path, mode) as out:
                    out.seek(part_off)
                    out.write(data)
                with media.cv:
                    if part_off in media._ram_cache:
                        media._ram_cache.pop(part_off)
                    media._ram_cache[part_off] = data
                    media._ram_cache.move_to_end(part_off)
                    while len(media._ram_cache) > 100:  # 50MB cache limit (100 * 512KB)
                        media._ram_cache.popitem(last=False)
                media.mark_range(part_off, len(data))

        await asyncio.to_thread(_write)
        async with lock:
            written += len(data)

    # Priority loading orchestration
    rest = offsets
    if head_first and offsets:
        # Phase 1: IMMEDIATE (1MB @ seek position)
        first_batch = offsets[:2]
        if len(first_batch) > 1:
            t1 = asyncio.create_task(one(first_batch[0]))
            t2 = asyncio.create_task(one(first_batch[1]))
            await t1
            # If head failed, retry once
            if media.contiguous_end_from(start) <= start and not media.cancelled:
                await one(first_batch[0])
            await t2
        else:
            await one(first_batch[0])
            if media.contiguous_end_from(start) <= start and not media.cancelled:
                await one(first_batch[0])
        
        # Phase 2: BUFFER FILL (Next 2MB)
        phase2_batch = offsets[2:6]
        if phase2_batch and not media.cancelled:
            await asyncio.gather(*(one(o) for o in phase2_batch), return_exceptions=True)
            
        # Phase 3: BACKGROUND PREFETCH (Upcoming chunks)
        rest = offsets[6:]

    if rest and not media.cancelled:
        await asyncio.gather(*(one(o) for o in rest), return_exceptions=True)
    return written


async def _fill_range_from_telegram(
    media: ProgressiveMedia, start: int, length: int
) -> None:
    """Download [start, start+length) with concurrent GetFile — random-access seek."""
    if media.cancelled:
        return
    try:
        await _download_parts_concurrent(
            media, start=start, length=length, workers=_STREAM_WORKERS
        )
    except Exception as e:
        if not media.cancelled:
            try:
                from engine.transfer_log import tlog

                tlog("seek range fill failed", phase="stream_seek", err=str(e)[:200])
            except Exception:
                pass
    finally:
        with media._seek_lock:
            for k in list(media._seek_inflight.keys()):
                if abs(k - start) < _SEEK_WINDOW:
                    media._seek_inflight.pop(k, None)


def _mime_is_fragmentable_video(mime: str, label: str = "") -> bool:
    """
    MP4-family containers that can progressive-play once moov is available.
    Document originals often report application/octet-stream — trust filename too.
    """
    m = (mime or "").lower()
    name = (label or "").lower()
    if m.startswith("video/mp4") or m in (
        "video/quicktime",
        "video/x-m4v",
        "application/mp4",
    ):
        return True
    if m.startswith("video/") and "webm" not in m and "matroska" not in m and "mkv" not in m:
        return True
    # application/octet-stream / empty mime — filename decides
    if any(
        name.endswith(ext) or ext in name
        for ext in (".mp4", ".m4v", ".mov", ".m4a")
    ):
        return True
    return False


def _path_region_has_moov(path: str, start: int = 0, length: int = 512 * 1024) -> bool:
    """True if bytes [start, start+length) contain an MP4 'moov' box fourcc."""
    try:
        if not os.path.isfile(path):
            return False
        size = int(os.path.getsize(path) or 0)
        if size < 32:
            return False
        start = max(0, int(start))
        if start >= size:
            return False
        to_read = min(int(length), size - start)
        with open(path, "rb") as f:
            f.seek(start)
            data = f.read(to_read)
        return b"moov" in data
    except OSError:
        return False


def _solid_prefix_from_sample(data: bytes, zero_run: int = 64 * 1024) -> int:
    """Length of solid (non-hole) prefix: stop after a long all-zero run."""
    if not data:
        return 0
    n = len(data)
    i = 0
    z = 0
    while i < n:
        if data[i] == 0:
            z += 1
            if z >= zero_run and i + 1 >= zero_run:
                # Only treat as hole if we're past some real header bytes
                solid = i + 1 - z
                if solid >= 32 * 1024:
                    return solid
        else:
            z = 0
        i += 1
    return n


def _resume_partial_file_ranges(media: ProgressiveMedia, existing: int) -> None:
    """
    Restore range map after process restart / warm head.

    Never treat getsize==total as fully filled — sparse head+tail files
    (moov-at-end bootstrap) have full size with a hollow middle.
    """
    total = media.total_size or 0
    if existing < 32 * 1024:
        return
    # Caller already registered ranges (warm path in start_preview)
    if media.contiguous_from_zero() > 0:
        return

    # Sequential partial (warm / interrupted): size < declared total
    if total <= 0 or existing < total:
        media.mark_range(0, existing)
        media.notify()
        return

    # File length == total: full download OR sparse head+tail
    try:
        mid = max(0, (total // 2) - 4096)
        with open(media.path, "rb") as f:
            f.seek(mid)
            mid_sample = f.read(8192)
        if mid_sample and any(b != 0 for b in mid_sample):
            media.mark_range(0, total)
            media.mark_done()
            media.notify()
            return

        # Sparse / hollow middle — recover head + tail ranges only
        head_cap = min(2 * 1024 * 1024, total)
        with open(media.path, "rb") as f:
            head = f.read(head_cap)
        solid = _solid_prefix_from_sample(head)
        if solid < 32 * 1024 and (b"ftyp" in head[:128] or b"moov" in head):
            solid = min(len(head), 256 * 1024)
        if solid >= 32 * 1024:
            media.mark_range(0, solid)

        tail_budget = min(_MOOV_TAIL_BUDGET, max(_MOOV_TAIL_MIN, total // 8))
        tail_off = max(solid, total - tail_budget)
        with open(media.path, "rb") as f:
            f.seek(tail_off)
            tail = f.read(total - tail_off)
        if tail and (b"moov" in tail or any(b != 0 for b in tail[:4096])):
            # Skip leading zero padding inside the tail window
            skip = 0
            while skip < len(tail) and tail[skip] == 0:
                skip += 1
            if skip < len(tail):
                media.mark_range(tail_off + skip, len(tail) - skip)
        media.notify()
    except OSError:
        media.mark_range(0, min(existing, 1024 * 1024))
        media.notify()


async def _bootstrap_moov_at_end(media: ProgressiveMedia) -> bool:
    """
    For moov-at-end MP4 (common for document / re-encode originals):
    pull the file tail early so <video> can read duration + enable seek
    without waiting for a full sequential download.

    Middle stays hollow; schedule_seek / progressive fill covers it on demand.
    """
    if media.cancelled or media.done:
        return False
    if not _mime_is_fragmentable_video(media.mime, media.label):
        # Still try when path looks like stream sample for video
        path_l = (media.path or "").lower()
        if not any(x in path_l for x in (".mp4", ".mov", ".m4v", ".stream.")):
            return False
    total = media.total_size or 0
    if total < 256 * 1024:
        return False
    head_have = media.contiguous_from_zero()
    if head_have < 24 * 1024:
        return False

    # Already progressive (moov near start)
    if _path_region_has_moov(media.path, 0, min(head_have, 1024 * 1024)):
        return False

    # Tail budget: large re-encodes can have multi-MB moov
    tail_budget = min(_MOOV_TAIL_BUDGET, max(_MOOV_TAIL_MIN, total // 8))
    if total < 4 * 1024 * 1024:
        tail_budget = max(_MOOV_TAIL_MIN, min(tail_budget, total // 2))
    elif total < tail_budget * 2:
        tail_budget = max(_MOOV_TAIL_MIN, total // 3)
    # Don't require tail_off >= head_have — middle hole is fine; only avoid overlap
    tail_off = max(0, total - tail_budget)
    if head_have > 0 and tail_off < head_have:
        # Tiny file: head already covers most — pull remainder only
        tail_off = head_have
    tail_len = total - tail_off
    if tail_len < 16 * 1024:
        return False
    if media.contiguous_end_from(tail_off) >= total:
        if _path_region_has_moov(media.path, tail_off, tail_len):
            return True
        return False

    await _download_parts_concurrent(
        media,
        start=tail_off,
        length=tail_len,
        workers=min(12, _STREAM_WORKERS),
        head_first=True,
    )
    if media.cancelled:
        return False
    have_tail = media.contiguous_end_from(tail_off) >= min(
        total, tail_off + max(16 * 1024, _MOOV_TAIL_MIN // 4)
    )
    if have_tail or media.filled_bytes() > head_have:
        try:
            print(
                f"[media_stream] moov-at-end bootstrap tail "
                f"off={tail_off} len={tail_len} filled={media.filled_bytes()} "
                f"moov={'yes' if _path_region_has_moov(media.path, tail_off, tail_len) else 'no'}",
                flush=True,
            )
        except Exception:
            pass
        return True
    return False


def _resolve_stream_target(msg):
    """Best Telegram media object for GetFile location (document preferred)."""
    media = getattr(msg, "media", None)
    doc = getattr(msg, "document", None)
    if doc is None and media is not None:
        doc = getattr(media, "document", None)
    photo = getattr(msg, "photo", None)
    if photo is None and media is not None:
        photo = getattr(media, "photo", None)
    return doc or photo or media or msg


async def fill_stream_from_telegram(
    client,
    msg,
    media: ProgressiveMedia,
    *,
    request_size: int = 512 * 1024,  # kept for call-site compat; unused
    stop_after_bytes: int = 0,
) -> None:
    """
    Fast progressive fill: concurrent GetFile parts on media DC (Telegram-like),
    plus bind state so seek-at-offset can use the same path.

    stop_after_bytes > 0: warm mode — stop once contiguous prefix reaches that
    size (do not download the whole file on hover).
    """
    media_sender = None
    warm_only = int(stop_after_bytes or 0) > 0
    try:
        if media.cancelled:
            return

        # Resolve location once — document-as-file lives on media.document
        target = _resolve_stream_target(msg)
        try:
            dc_id, input_loc = utils.get_input_location(target)
        except Exception:
            # Retry with msg.media / msg explicitly
            input_loc = None
            dc_id = None
            for alt in (
                getattr(msg, "document", None),
                getattr(getattr(msg, "media", None), "document", None),
                getattr(msg, "media", None),
                msg,
            ):
                if alt is None:
                    continue
                try:
                    dc_id, input_loc = utils.get_input_location(alt)
                    if input_loc is not None:
                        break
                except Exception:
                    continue
            if input_loc is None:
                # Fallback: slow iter_download path (no random seek)
                try:
                    loop = asyncio.get_running_loop()
                    media.bind_telegram(client, msg, loop)
                except RuntimeError:
                    pass
                await _fill_stream_iter_download_fallback(
                    client,
                    msg,
                    media,
                    start_from=media.contiguous_from_zero(),
                    max_bytes=stop_after_bytes if warm_only else 0,
                )
                return

        api, media_sender = await _borrow_media_api(client, int(dc_id) if dc_id else None)
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop is not None:
            media.bind_telegram(
                client,
                msg,
                loop,
                input_loc=input_loc,
                dc_id=int(dc_id) if dc_id else None,
                media_api=api,
                media_sender=media_sender,
            )

        # Resume warm/partial head if present; never treat sparse full-size as complete
        total = media.total_size or 0
        existing = 0
        try:
            if os.path.isfile(media.path):
                existing = int(os.path.getsize(media.path) or 0)
        except OSError:
            existing = 0
        if existing >= 32 * 1024 and media.contiguous_from_zero() <= 0:
            _resume_partial_file_ranges(media, existing)
        elif media.contiguous_from_zero() <= 0:
            with open(media.path, "wb"):
                pass
            media.notify()

        if warm_only and media.contiguous_from_zero() >= stop_after_bytes:
            return

        # Phase 1: tiny HEAD for instant first frame
        head_quick = min(256 * 1024, total if total > 0 else 256 * 1024)
        if warm_only:
            head_quick = min(head_quick, stop_after_bytes)
        if media.contiguous_from_zero() < head_quick:
            await _download_parts_concurrent(
                media, start=0, length=head_quick, workers=6, head_first=True
            )
        if media.contiguous_from_zero() <= 0 and not media.cancelled:
            await _fill_stream_iter_download_fallback(
                client, msg, media, start_from=0, max_bytes=head_quick
            )
        if warm_only and media.contiguous_from_zero() >= stop_after_bytes:
            return

        # Phase 1.5 EARLY: moov-at-end bootstrap ASAP (document originals).
        # Run in parallel with head expand so duration/seek unlock without waiting 1MB head.
        head_len = min(1536 * 1024, total if total > 0 else 1536 * 1024)
        if warm_only:
            head_len = min(head_len, stop_after_bytes)

        async def _expand_head() -> None:
            if media.contiguous_from_zero() < head_len and not media.cancelled:
                await _download_parts_concurrent(
                    media,
                    start=media.contiguous_from_zero(),
                    length=head_len - media.contiguous_from_zero(),
                    workers=8,
                    head_first=True,
                )

        async def _moov_boot() -> None:
            if warm_only or media.cancelled or total <= head_quick:
                return
            try:
                await _bootstrap_moov_at_end(media)
            except Exception as e:
                try:
                    print(f"[media_stream] moov bootstrap fail: {e}", flush=True)
                except Exception:
                    pass

        if not media.cancelled:
            await asyncio.gather(_expand_head(), _moov_boot())

        if warm_only:
            # Hover warm stops here — leave incomplete for open to resume
            return

        # Phase 2: pipeline concurrent windows from solid prefix tip
        # (middle holes from seek/moov-tail stay valid — only grow playable prefix)
        workers = _STREAM_WORKERS
        while not media.cancelled:
            pos = media.contiguous_from_zero()
            if total > 0 and pos >= total:
                break
            # If next byte is already in a filled island (rare), jump to hole
            window = _PIPELINE_WINDOW
            if total > 0:
                window = min(window, total - pos)
            if window <= 0:
                break
            before = pos
            await _download_parts_concurrent(
                media, start=pos, length=window, workers=workers, head_first=True
            )
            after = media.contiguous_from_zero()
            if after <= before:
                # Hole or stall — try iter_download recovery at tip
                await _fill_stream_iter_download_fallback(
                    client, msg, media, start_from=after, max_bytes=_PART * 8
                )
                after = media.contiguous_from_zero()
                if after <= before:
                    # Skip tiny unfilled gap by seeking one part ahead if bound
                    if media._input_loc is not None and total > 0:
                        skip_to = min(total, before + _PART)
                        if skip_to > before:
                            await _download_parts_concurrent(
                                media,
                                start=skip_to,
                                length=min(_PIPELINE_WINDOW, total - skip_to),
                                workers=workers,
                                head_first=True,
                            )
                            # Still blocked at prefix — cannot invent bytes
                            if media.contiguous_from_zero() <= before:
                                break
                    else:
                        break
            if total <= 0 and after > 64 * 1024 * 1024:
                break

        if media.cancelled:
            return
        have = media.contiguous_from_zero()
        if media.total_size <= 0:
            media.total_size = max(have, media.filled_bytes())
        # Done when prefix covers full file OR every byte is filled (sparse complete)
        filled = media.filled_bytes()
        if media.total_size > 0 and (
            have >= media.total_size or filled >= media.total_size
        ):
            if have >= media.total_size:
                media.mark_done()
            elif filled >= media.total_size:
                # All islands filled — merge to full if no holes... only if filled == total
                media.mark_done()
        elif media.total_size <= 0 and have > 0:
            media.mark_done()
    except Exception as e:
        if media.cancelled:
            return
        media.mark_error(str(e))
    finally:
        # Keep media DC sender alive for mid-stream seek while incomplete.
        # Warm-only leaves stream incomplete — release sender to free DC slot.
        if media.cancelled or media.done or warm_only:
            await _release_media_sender(client, media._media_sender or media_sender)
            media._media_sender = None
            if media.done and not media.cancelled:
                media._media_api = media._client


async def _fill_stream_iter_download_fallback(
    client,
    msg,
    media: ProgressiveMedia,
    *,
    start_from: int = 0,
    max_bytes: int = 0,
) -> None:
    """Legacy single-connection fill (location unresolved / recovery)."""
    try:
        target = _resolve_stream_target(msg)
        pos = max(0, int(start_from))
        written = 0
        kwargs: Dict[str, Any] = {"request_size": _PART}
        if pos > 0:
            kwargs["offset"] = pos
        if media.total_size > 0:
            kwargs["file_size"] = media.total_size
        # Ensure file exists for seek writes
        parent = os.path.dirname(media.path) or "."
        os.makedirs(parent, exist_ok=True)
        if not os.path.isfile(media.path):
            open(media.path, "wb").close()
        async for chunk in client.iter_download(target, **kwargs):
            if media.cancelled:
                return
            if not chunk:
                continue
            if media.contiguous_end_from(pos) >= pos + len(chunk):
                pos += len(chunk)
                continue
            with media._write_lock:
                mode = "r+b" if os.path.isfile(media.path) else "w+b"
                with open(media.path, mode) as out:
                    out.seek(pos)
                    out.write(chunk)
                media.mark_range(pos, len(chunk))
            pos += len(chunk)
            written += len(chunk)
            if max_bytes > 0 and written >= max_bytes:
                return
            await asyncio.sleep(0)
        # Only mark done on full sequential complete from 0 without max_bytes cap
        if (
            start_from == 0
            and max_bytes <= 0
            and not media.cancelled
            and (
                media.total_size <= 0
                or media.contiguous_from_zero() >= media.total_size
            )
        ):
            media.mark_done()
    except Exception as e:
        if start_from == 0 and not media.cancelled and media.contiguous_from_zero() <= 0:
            media.mark_error(str(e))
