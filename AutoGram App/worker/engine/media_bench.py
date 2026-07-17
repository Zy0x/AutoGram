"""
Media upload/download speed benchmark against Telegram (Telethon).
Emits BenchProgress / BenchFinished / FloodWait events; ends with [JSON_OUTPUT].
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, Dict, List, Optional

from telethon import TelegramClient
from telethon.errors import FloodWaitError, ChatWriteForbiddenError, UserBannedInChannelError

from engine.events import emit_event, setup_emitter
from engine.fast_transfer import fast_send_file


TEMP_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "temp")
MAX_GENERATE_MB = 50


class ProgressTracker:
    def __init__(self, phase: str, total: int = 0):
        self.phase = phase
        self.total = max(0, int(total or 0))
        self.transferred = 0
        self.peak_mb_s = 0.0
        self._t0 = time.time()
        self._last_emit = 0.0
        self._last_bytes = 0
        self._last_t = self._t0
        self.floodwait_seconds = 0

    def callback(self, current: int, total: int):
        now = time.time()
        self.transferred = int(current or 0)
        if total and total > 0:
            self.total = int(total)
        # Instant speed over short window
        dt = now - self._last_t
        if dt >= 0.15:
            db = self.transferred - self._last_bytes
            if db > 0 and dt > 0:
                inst = (db / (1024 * 1024)) / dt
                if inst > self.peak_mb_s:
                    self.peak_mb_s = inst
            self._last_bytes = self.transferred
            self._last_t = now
        # Throttle emit ~200ms
        if now - self._last_emit < 0.2 and self.transferred < self.total:
            return
        self._last_emit = now
        elapsed = max(now - self._t0, 1e-6)
        avg = (self.transferred / (1024 * 1024)) / elapsed
        pct = (self.transferred / self.total * 100.0) if self.total > 0 else 0.0
        remaining = max(self.total - self.transferred, 0)
        eta = (remaining / (self.transferred / elapsed)) if self.transferred > 0 else None
        emit_event(
            "BenchProgress",
            phase=self.phase,
            transferred=self.transferred,
            total=self.total,
            percent=round(pct, 2),
            speed_mb_s=round(avg, 3),
            peak_mb_s=round(self.peak_mb_s, 3),
            eta_seconds=round(eta, 1) if eta is not None else None,
        )

    def finalize(self) -> Dict[str, Any]:
        elapsed = max(time.time() - self._t0, 1e-6)
        size = self.total or self.transferred
        avg = (size / (1024 * 1024)) / elapsed if size else 0.0
        return {
            "phase": self.phase,
            "size_bytes": size,
            "duration_s": round(elapsed, 3),
            "avg_mb_s": round(avg, 3),
            "peak_mb_s": round(self.peak_mb_s, 3),
            "floodwait_seconds": self.floodwait_seconds,
        }


def _ensure_temp() -> str:
    os.makedirs(TEMP_DIR, exist_ok=True)
    return TEMP_DIR


def generate_dummy_file(mb: float) -> str:
    mb = float(mb)
    if mb <= 0:
        raise ValueError("generate_mb must be > 0")
    if mb > MAX_GENERATE_MB:
        raise ValueError(f"generate_mb max is {MAX_GENERATE_MB}")
    size = int(mb * 1024 * 1024)
    path = os.path.join(_ensure_temp(), f"bench_{int(time.time())}_{size}.bin")
    chunk = b"\0" * (1024 * 1024)
    written = 0
    with open(path, "wb") as f:
        while written < size:
            n = min(len(chunk), size - written)
            f.write(chunk[:n])
            written += n
    return path


def _parse_chat_id(chat_id: str):
    s = str(chat_id or "").strip()
    if not s:
        raise ValueError("chat_id required")
    if "_" in s:
        base = s.split("_")[0]
        if base.lstrip("-").isdigit():
            return int(base)
    if s.lstrip("-").isdigit():
        return int(s)
    return s  # @username


async def _resolve_entity(client: TelegramClient, chat_id: str):
    ref = _parse_chat_id(chat_id)
    try:
        return await client.get_input_entity(ref)
    except Exception:
        await client.get_dialogs(limit=200)
        return await client.get_input_entity(ref)


async def run_upload(
    client: TelegramClient,
    entity,
    file_path: str,
) -> Dict[str, Any]:
    size = os.path.getsize(file_path)
    tracker = ProgressTracker("upload", total=size)
    emit_event("BenchPhaseStarted", phase="upload", size_bytes=size, file=os.path.basename(file_path))
    workers = 8 if size >= 40 * 1024 * 1024 else 6
    try:
        msg = await fast_send_file(
            client,
            entity,
            file_path,
            workers=workers,
            caption=f"AutoGram speed test {size} bytes",
            force_document=True,
            progress_callback=tracker.callback,
        )
    except FloodWaitError as e:
        tracker.floodwait_seconds = int(e.seconds)
        emit_event("FloodWait", seconds=e.seconds, phase="upload")
        await asyncio.sleep(int(e.seconds) + 2)
        msg = await fast_send_file(
            client,
            entity,
            file_path,
            workers=workers,
            caption=f"AutoGram speed test {size} bytes",
            force_document=True,
            progress_callback=tracker.callback,
        )
    metrics = tracker.finalize()
    mid = None
    if msg is not None:
        if isinstance(msg, list):
            mid = msg[-1].id if msg else None
        else:
            mid = getattr(msg, "id", None)
    metrics["message_id"] = mid
    metrics["status"] = "ok"
    emit_event("BenchPhaseFinished", **metrics)
    return metrics


async def run_download(
    client: TelegramClient,
    entity,
    message_id: Optional[int] = None,
) -> Dict[str, Any]:
    if message_id:
        msg = await client.get_messages(entity, ids=int(message_id))
        if not msg:
            raise ValueError(f"Message {message_id} not found")
    else:
        # Latest media message in chat
        msg = None
        async for m in client.iter_messages(entity, limit=40):
            if m.media:
                msg = m
                break
        if not msg:
            raise ValueError("No media message found in chat")

    # Estimate size
    size = 0
    media = msg.media
    if hasattr(media, "document") and media.document:
        size = int(getattr(media.document, "size", 0) or 0)
    elif hasattr(media, "photo") and media.photo:
        sizes = getattr(media.photo, "sizes", []) or []
        size = max([getattr(s, "size", 0) or 0 for s in sizes] + [0])

    out_path = os.path.join(_ensure_temp(), f"bench_dl_{msg.id}_{int(time.time())}")
    tracker = ProgressTracker("download", total=size)
    emit_event(
        "BenchPhaseStarted",
        phase="download",
        size_bytes=size,
        message_id=msg.id,
    )
    try:
        path = await client.download_media(
            msg,
            file=out_path,
            progress_callback=tracker.callback,
        )
    except FloodWaitError as e:
        tracker.floodwait_seconds = int(e.seconds)
        emit_event("FloodWait", seconds=e.seconds, phase="download")
        await asyncio.sleep(int(e.seconds) + 2)
        path = await client.download_media(
            msg,
            file=out_path,
            progress_callback=tracker.callback,
        )

    if path and os.path.exists(path):
        tracker.total = os.path.getsize(path)
        tracker.transferred = tracker.total
    metrics = tracker.finalize()
    metrics["message_id"] = msg.id
    metrics["download_path"] = path
    metrics["status"] = "ok"
    emit_event("BenchPhaseFinished", **metrics)
    return metrics


async def run_media_bench(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    chat_id: str,
    mode: str = "upload",
    file_path: Optional[str] = None,
    generate_mb: float = 0,
    message_id: Optional[int] = None,
    cleanup: bool = True,
    delete_message: bool = False,
) -> Dict[str, Any]:
    mode = (mode or "upload").lower().strip()
    if mode not in ("upload", "download", "roundtrip"):
        raise ValueError("bench-mode must be upload|download|roundtrip")

    setup_emitter(None, None)
    emit_event(
        "BenchStarted",
        mode=mode,
        chat_id=str(chat_id),
        session=session_name,
    )

    session_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "sessions")
    session_file = os.path.join(session_dir, session_name)

    created_files: List[str] = []
    uploaded_msg_id = None
    result: Dict[str, Any] = {
        "mode": mode,
        "status": "ok",
        "phases": [],
    }

    client = TelegramClient(session_file, int(api_id), str(api_hash))
    await client.connect()
    try:
        if not await client.is_user_authorized():
            raise RuntimeError("Session not authorized. Login again in Accounts.")

        entity = await _resolve_entity(client, chat_id)

        # Prepare upload file
        upload_path = file_path
        if mode in ("upload", "roundtrip"):
            if not upload_path and generate_mb:
                upload_path = generate_dummy_file(generate_mb)
                created_files.append(upload_path)
            if not upload_path or not os.path.isfile(upload_path):
                raise ValueError("file-path or generate-mb required for upload/roundtrip")

        if mode in ("upload", "roundtrip"):
            try:
                up = await run_upload(client, entity, upload_path)
            except (ChatWriteForbiddenError, UserBannedInChannelError) as e:
                raise RuntimeError(f"Cannot write to chat: {e}") from e
            result["phases"].append(up)
            uploaded_msg_id = up.get("message_id")
            result["upload"] = up

        if mode in ("download", "roundtrip"):
            mid = message_id or uploaded_msg_id
            dl = await run_download(client, entity, message_id=mid)
            result["phases"].append(dl)
            result["download"] = dl
            if dl.get("download_path"):
                created_files.append(dl["download_path"])

        # Optional delete uploaded test message
        if delete_message and uploaded_msg_id:
            try:
                await client.delete_messages(entity, [int(uploaded_msg_id)])
                result["message_deleted"] = True
            except Exception as e:
                result["message_deleted"] = False
                result["delete_error"] = str(e)

        # Aggregate
        total_bytes = sum(p.get("size_bytes", 0) or 0 for p in result["phases"])
        total_dur = sum(p.get("duration_s", 0) or 0 for p in result["phases"])
        result["size_bytes"] = total_bytes
        result["duration_s"] = round(total_dur, 3)
        result["avg_mb_s"] = round(
            (total_bytes / (1024 * 1024)) / total_dur if total_dur > 0 else 0.0,
            3,
        )
        peaks = [p.get("peak_mb_s", 0) or 0 for p in result["phases"]]
        result["peak_mb_s"] = round(max(peaks) if peaks else 0.0, 3)
        result["message_id"] = uploaded_msg_id or (
            result.get("download", {}) or {}
        ).get("message_id")

        emit_event("BenchFinished", **{k: v for k, v in result.items() if k != "phases"})
        print(f"[JSON_OUTPUT]{json.dumps(result, default=str)}", flush=True)
        return result

    except Exception as e:
        err = {"status": "error", "error": str(e), "mode": mode}
        emit_event("BenchFailed", error=str(e), mode=mode)
        print(f"[JSON_OUTPUT]{json.dumps(err, default=str)}", flush=True)
        raise
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass
        if cleanup:
            for p in created_files:
                try:
                    if p and os.path.isfile(p):
                        os.remove(p)
                except Exception:
                    pass
            # also remove generate path if user file not cleaned
            if generate_mb and file_path is None:
                pass
