"""
Media Studio — multi-file upload/download with quality modes,
ordered-parallel pipeline, album grouping, and Telegram-like options.
"""
from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import subprocess
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple  # noqa: F401

from telethon import TelegramClient
from telethon.errors import FloodWaitError, ChatWriteForbiddenError, UserBannedInChannelError

from engine.events import emit_event, setup_emitter
from engine.enterprise.resolver import ExtensionResolver
from engine.enterprise.types import QualityMode
from engine.fast_transfer import (
    fast_upload_file,
    fast_send_file,
    encryption_backend,
    resolve_upload_policy,
    preflight_upload_size,
    UploadLimitExceeded,
    UploadPolicy,
)
from engine.media_meta import (
    AccountBudgetError,
    build_send_attributes,
    is_account_budget_error,
    prepare_video_for_hq,
    probe_with_ffmpeg,
)
from engine.progress_rate import WindowedRateTracker

TEMP_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "temp")
PHOTO_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".bmp"}
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}
AUDIO_EXTS = {".mp3", ".aac", ".flac", ".ogg", ".m4a", ".wav"}
GIF_EXTS = {".gif"}


def _available_ram_bytes() -> int:
    """Windows-safe available RAM probe without an additional dependency."""
    try:
        import ctypes

        class MemoryStatus(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MemoryStatus()
        status.dwLength = ctypes.sizeof(MemoryStatus)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return int(status.ullAvailPhys)
    except Exception:
        pass
    return 0


def _free_nvidia_vram_bytes() -> int:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return int((result.stdout or "0").splitlines()[0].strip()) * 1024 * 1024
    except Exception:
        return 0


def _adaptive_prepare_slots(opts: "StudioOptions", item_count: int) -> int:
    if item_count < 2 or str(opts.reencode_preset).lower() != "speed":
        return 1
    if str(opts.reencode_hw).lower() == "cpu":
        return 1
    ram = _available_ram_bytes()
    vram = _free_nvidia_vram_bytes() if str(opts.reencode_hw).lower() in {"auto", "nvidia"} else 2 * 1024**3
    return 2 if ram >= 4 * 1024**3 and vram >= int(1.5 * 1024**3) else 1


async def _wait_if_transfer_paused(event_name: str = "StudioPaused") -> None:
    """Soft-pause between files: UI writes worker/temp/drive_pause.txt."""
    from engine.path_policy import is_transfer_paused

    announced = False
    while is_transfer_paused():
        if not announced:
            emit_event(event_name, message="Paused between files")
            announced = True
        await asyncio.sleep(0.4)
    if announced:
        emit_event("StudioResumed", message="Resumed")


@dataclass
class StudioItem:
    index: int
    path: str
    caption: str = ""
    size: int = 0
    status: str = "pending"  # pending|uploading|done|failed|skipped
    message_id: Optional[int] = None
    error: Optional[str] = None
    duration_s: float = 0.0
    avg_mb_s: float = 0.0


@dataclass
class StudioOptions:
    quality_mode: str = "HIGH_QUALITY"  # SMART | HIGH_QUALITY | ORIGINAL
    concurrency: int = 4
    group_as_album: bool = False
    silent: bool = False
    spoiler: bool = False
    compress: bool = False  # UI only — no re-encode
    reply_to: Optional[int] = None
    schedule_date: Optional[str] = None  # ISO datetime
    topic_id: Optional[int] = None
    global_caption: str = ""
    reencode_hw: str = "auto"
    reencode_preset: str = "balanced"


def _ensure_temp() -> str:
    os.makedirs(TEMP_DIR, exist_ok=True)
    return TEMP_DIR


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
    return s


async def _resolve_entity(client: TelegramClient, chat_id: str):
    ref = _parse_chat_id(chat_id)
    try:
        return await client.get_input_entity(ref)
    except Exception:
        await client.get_dialogs(limit=200)
        return await client.get_input_entity(ref)


def _ext(path: str) -> str:
    return os.path.splitext(path)[1].lower()


def _final_name(original_path: str, current_path: str) -> str:
    orig = os.path.basename(original_path)
    if current_path and current_path != original_path:
        return os.path.splitext(orig)[0] + _ext(current_path)
    return orig


def _align_caption_with_sent_file(
    caption: str,
    original_path: str,
    final_file_name: str,
) -> str:
    """
    Keep Drive display name in sync when HQ re-encode changes container
    (e.g. clip.webm → clip.mp4). UI often uses original basename as caption.
    """
    cap = (caption or "").strip()
    final_base = os.path.basename(final_file_name or "")
    orig_base = os.path.basename(original_path or "")
    final_ext = _ext(final_base)
    if not final_ext:
        return cap

    # Empty caption → leave empty (Telethon uses DocumentAttributeFilename)
    if not cap:
        return cap

    cap_ext = _ext(cap)
    orig_ext = _ext(orig_base)
    stem_cap = os.path.splitext(cap)[0]
    stem_orig = os.path.splitext(orig_base)[0]

    # Caption is (or was) the original filename / same stem → force final extension
    if (
        cap == orig_base
        or stem_cap == stem_orig
        or (cap_ext and orig_ext and stem_cap.lower() == stem_orig.lower())
    ):
        if cap_ext.lower() != final_ext.lower():
            return stem_cap + final_ext
        return cap

    # Caption ends with a known media ext that differs from what we upload
    media_exts = {
        ".mp4",
        ".mov",
        ".mkv",
        ".webm",
        ".avi",
        ".m4v",
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".webp",
        ".bmp",
        ".heic",
        ".mp3",
        ".m4a",
        ".ogg",
        ".flac",
        ".wav",
    }
    if cap_ext in media_exts and final_ext in media_exts and cap_ext != final_ext:
        return stem_cap + final_ext
    return cap


def resolve_send_kwargs(path: str, quality_mode: str, spoiler: bool = False) -> Dict[str, Any]:
    """Map quality mode + extension → Telethon send_file kwargs."""
    mode = (quality_mode or "HIGH_QUALITY").upper()
    ext = _ext(path)
    kwargs: Dict[str, Any] = {}

    if mode == "ORIGINAL":
        kwargs["force_document"] = True
        return kwargs

    # SMART → resolve via ExtensionResolver
    effective = mode
    if mode == "SMART":
        q = ExtensionResolver.resolve(os.path.basename(path))
        effective = q.value if hasattr(q, "value") else str(q)

    if effective == "ORIGINAL":
        kwargs["force_document"] = True
        return kwargs

    # HIGH_QUALITY path
    if ext in PHOTO_EXTS:
        kwargs["force_document"] = False
        # Telethon treats images as photos when force_document=False
    elif ext in VIDEO_EXTS:
        kwargs["force_document"] = False
        kwargs["supports_streaming"] = True
    elif ext in GIF_EXTS:
        kwargs["force_document"] = False
    elif ext in AUDIO_EXTS:
        kwargs["force_document"] = False
    else:
        kwargs["force_document"] = True

    if spoiler:
        kwargs["spoiler"] = True

    return kwargs


def _parse_schedule(iso: Optional[str]):
    if not iso:
        return None
    try:
        s = iso.strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


class ProgressAgg:
    """
    Aggregate multi-item transfer progress for Transfer Manager.

    `speed_mb_s` is **recent windowed/EWMA throughput** (not lifetime average).
    Lifetime average is diluted by prepare/re-encode idle and early stalls —
    that was the 0.26 MB/s vs puncak 6.5 bug. Peak stays separate.
    """

    def __init__(self, total_bytes: int, n_items: int):
        self.total_bytes = max(total_bytes, 1)
        self.n_items = n_items
        self.done_bytes = 0
        self.item_bytes: Dict[int, int] = {}
        self._original_item_sizes: Dict[int, int] = {}
        self.t0 = time.time()
        self._last_emit = 0.0
        self.peak_mb_s = 0.0
        self._last_pct_bucket = -1
        self._rate = WindowedRateTracker(window_s=2.5, ewma_alpha=0.40)
        self._rate.reset(self.t0, 0)
        self._last_snap_speed = 0.0
        self._last_eta_s: Optional[float] = None

    def adjust_total_bytes(self, delta: int):
        self.total_bytes = max(self.total_bytes + delta, 1)

    def on_item(self, index: int, current: int, total: int, *, phase: str = "upload", force: bool = False):
        prev = int(self.item_bytes.get(index, 0) or 0)
        cur = int(current or 0)
        # Monotonic per-item (and thus aggregate) bytes
        if cur < prev:
            cur = prev
        self.item_bytes[index] = cur
        self.done_bytes = sum(self.item_bytes.values())
        now = time.time()
        snap = self._rate.update(now, self.done_bytes, total=self.total_bytes)
        self.peak_mb_s = max(self.peak_mb_s, snap.peak_mb_s)
        self._last_snap_speed = snap.current_mb_s
        self._last_eta_s = snap.eta_s
        # Emit often enough for UI (was 0.25–0.5s — felt stuck at 0%)
        min_gap = 0.2 if self.total_bytes >= 20 * 1024 * 1024 else 0.12
        pct = min(100.0, self.done_bytes / self.total_bytes * 100.0)
        bucket = int(pct // 2)  # every ~2%
        done = self.done_bytes >= self.total_bytes or (
            total and current >= total
        )
        if (
            not force
            and not done
            and now - self._last_emit < min_gap
            and bucket == self._last_pct_bucket
        ):
            return
        self._last_emit = now
        self._last_pct_bucket = bucket
        # UI current speed = recent sustained rate; peak separate
        speed = snap.current_mb_s
        if speed <= 0 and self.done_bytes > 0:
            # First ticks before window fills: fall back to short EWMA only
            speed = snap.lifetime_avg_mb_s if snap.lifetime_avg_mb_s > 0 else 0.0
        emit_event(
            "StudioProgress",
            phase=phase,
            transferred=self.done_bytes,
            total=self.total_bytes,
            percent=round(pct, 2),
            speed_mb_s=round(speed, 3),
            peak_mb_s=round(self.peak_mb_s, 3),
            eta_s=None if snap.eta_s is None else round(snap.eta_s, 1),
            lifetime_avg_mb_s=round(snap.lifetime_avg_mb_s, 3),
            item_index=index,
            items_total=self.n_items,
            item_current=int(current or 0),
            item_total=int(total or 0) or int(self.item_bytes.get(index, 0) or 0),
        )


async def _prepare_item_path(
    item: StudioItem,
    opts: StudioOptions,
    progress_cb=None,
    upload_policy: Optional[UploadPolicy] = None,
) -> Tuple[str, Optional[str]]:
    """
    For HIGH_QUALITY / SMART video: re-encode AV1/VP9/etc → H.264 so Telegram/Nagram play natively.
    Also shrinks toward the live account upload budget when source is oversize.
    Returns (path_to_upload, temp_to_delete_or_None).
    """
    mode = (opts.quality_mode or "HIGH_QUALITY").upper()
    ext = _ext(item.path)
    budget = int(getattr(upload_policy, "safe_max_bytes", 0) or 0)
    hard = int(getattr(upload_policy, "hard_max_bytes", 0) or 0)

    # ORIGINAL: no re-encode — still fail early if over account hard limit
    if mode == "ORIGINAL" or ext not in VIDEO_EXTS:
        if upload_policy is not None:
            try:
                preflight_upload_size(int(item.size or 0) or os.path.getsize(item.path), upload_policy)
            except UploadLimitExceeded as e:
                item.status = "failed"
                item.error = str(e)
                emit_event(
                    "StudioItemPrepare",
                    index=item.index,
                    phase="rejected_oversize",
                    error=str(e),
                    hard_max_bytes=hard,
                    safe_max_bytes=budget,
                    premium=bool(getattr(upload_policy, "premium", False)),
                )
                raise
        return item.path, None
    try:
        emit_event(
            "StudioItemPrepare",
            index=item.index,
            phase="probe",
            path=os.path.basename(item.path),
            budget_bytes=budget or None,
            premium=bool(getattr(upload_policy, "premium", False)) if upload_policy else None,
        )
        send_path, info = await asyncio.to_thread(
            prepare_video_for_hq,
            item.path,
            progress_cb,
            reencode_hw=opts.reencode_hw,
            reencode_preset=opts.reencode_preset,
            max_output_bytes=budget,
            force_fit_budget=bool(budget and (item.size or 0) > budget),
        )
        if info.get("reencoded"):
            encode = info.get("encode") or {}
            emit_event(
                "StudioItemPrepare",
                index=item.index,
                phase="reencoded",
                reason=info.get("reason"),
                codec=(info.get("meta") or {}).get("video_codec"),
                duration=(info.get("meta") or {}).get("duration"),
                output=_final_name(item.path, send_path),
                encoder_backend=encode.get("backend"),
                encoder_name=encode.get("encoder"),
                decoder_name=encode.get("decoder"),
                output_bytes=encode.get("output_bytes") or info.get("output_bytes"),
            )
            item.size = os.path.getsize(send_path)
        # Final hard-limit preflight (encode or passthrough)
        if upload_policy is not None:
            final_size = os.path.getsize(send_path)
            try:
                preflight_upload_size(final_size, upload_policy)
            except UploadLimitExceeded as e:
                if send_path != item.path and os.path.isfile(send_path):
                    try:
                        os.remove(send_path)
                    except Exception:
                        pass
                item.status = "failed"
                item.error = str(e)
                raise
        if info.get("reencoded"):
            return send_path, send_path
        return item.path, None
    except UploadLimitExceeded:
        raise
    except AccountBudgetError as e:
        # Hard fail: never fall back to uploading the oversize original.
        item.status = "failed"
        item.error = str(e)
        emit_event(
            "StudioItemPrepare",
            index=item.index,
            phase="prepare_failed",
            error=str(e),
            budget_failure=True,
        )
        raise
    except Exception as e:
        # Oversize / budget failures must not silently upload the original.
        # Use shared detector so "batas unggah akun" etc. still match.
        size_fit_required = bool(budget and (int(item.size or 0) or 0) > budget)
        if is_account_budget_error(e) or size_fit_required:
            item.status = "failed"
            item.error = str(e)
            emit_event(
                "StudioItemPrepare",
                index=item.index,
                phase="prepare_failed",
                error=str(e),
                budget_failure=True,
                size_fit_required=size_fit_required,
            )
            raise
        emit_event(
            "StudioItemPrepare",
            index=item.index,
            phase="prepare_failed",
            error=str(e),
            note="falling back to original file (may not play in-app if AV1)",
        )
        if upload_policy is not None:
            try:
                preflight_upload_size(int(item.size or 0) or os.path.getsize(item.path), upload_policy)
            except UploadLimitExceeded:
                raise
        return item.path, None


def _message_id_from_send_result(msg) -> Optional[int]:
    """Extract Telegram message id from send_file result (single or list)."""
    if msg is None:
        return None
    try:
        if isinstance(msg, list):
            if not msg:
                return None
            return int(getattr(msg[-1], "id", None) or 0) or None
        mid = getattr(msg, "id", None)
        return int(mid) if mid is not None else None
    except Exception:
        return None


def apply_item_commit_success(
    item: StudioItem,
    message_id: Optional[int],
    *,
    duration_s: Optional[float] = None,
) -> str:
    """
    Mark item as successfully uploaded. Terminal for that item — callers must
    not overwrite with failed after this if message_id is present.
    """
    if message_id:
        item.message_id = int(message_id)
    item.status = "done"
    item.error = None
    if duration_s is not None:
        item.duration_s = float(duration_s)
    if item.size and item.duration_s:
        try:
            item.avg_mb_s = round((item.size / (1024 * 1024)) / max(item.duration_s, 1e-6), 3)
        except Exception:
            pass
    return "done"


def item_status_after_event(
    current_status: str,
    *,
    incoming_status: str,
    message_id: Optional[int] = None,
    had_message_id: bool = False,
) -> str:
    """
    Pure status transition for StudioItemDone. Once done with a message id,
    never downgrade to failed (false "gagal" after successful upload).
    """
    cur = (current_status or "").lower()
    inc = (incoming_status or "").lower()
    ok_in = inc in ("done", "ok", "success")
    if ok_in:
        return "done"
    if cur == "done" and (had_message_id or message_id):
        return "done"
    if inc in ("failed", "error", "fail"):
        return "failed"
    return cur or "failed"


async def _upload_bytes(
    client: TelegramClient,
    item: StudioItem,
    agg: ProgressAgg,
    sem: asyncio.Semaphore,
    part_workers: int = 8,
    upload_path: Optional[str] = None,
    upload_policy: Optional[UploadPolicy] = None,
):
    """Parallel stage: multi-part concurrent upload to DC (no chat message yet)."""
    path = upload_path or item.path
    async with sem:
        item.status = "uploading"
        emit_event(
            "StudioItemStarted",
            index=item.index,
            path=_final_name(item.path, path),
            size=item.size,
            phase="upload_bytes",
        )
        # Immediate UI tick so bar leaves 0% while first part starts
        agg.on_item(item.index, 0, item.size or 1, force=True)

        def cb(cur, tot):
            agg.on_item(item.index, cur, tot or item.size)

        try:
            return await fast_upload_file(
                client,
                path,
                workers=part_workers,
                file_name=os.path.basename(path),
                progress_callback=cb,
                upload_policy=upload_policy,
            )
        except FloodWaitError as e:
            emit_event("FloodWait", seconds=e.seconds, index=item.index, phase="upload_bytes")
            await asyncio.sleep(int(e.seconds) + 2)
            return await fast_upload_file(
                client,
                path,
                workers=max(2, part_workers // 2),
                file_name=os.path.basename(path),
                progress_callback=cb,
                upload_policy=upload_policy,
            )


async def _send_one(
    client: TelegramClient,
    entity,
    item: StudioItem,
    opts: StudioOptions,
    agg: ProgressAgg,
    uploaded_handle=None,
    part_workers: int = 6,
    upload_path: Optional[str] = None,
) -> StudioItem:
    """Sequential stage: commit message to chat (order-safe)."""
    t0 = time.time()
    send_path = upload_path or item.path
    final_file_name = _final_name(item.path, send_path)
    
    item.status = "uploading"
    emit_event(
        "StudioItemStarted",
        index=item.index,
        path=final_file_name,
        size=item.size,
    )

    caption = _align_caption_with_sent_file(
        (item.caption or opts.global_caption or "").strip(),
        item.path,
        final_file_name,
    )
    kwargs = resolve_send_kwargs(send_path, opts.quality_mode, spoiler=opts.spoiler)

    # Real video attributes (duration/size/streaming) — without these Telegram shows black 0:00
    force_doc = bool(kwargs.get("force_document"))
    attrs, mime = build_send_attributes(
        send_path,
        force_document=force_doc,
        supports_streaming=bool(kwargs.get("supports_streaming", True)),
        file_name=final_file_name,
    )

    send_kwargs = dict(kwargs)
    send_kwargs["caption"] = caption or None
    send_kwargs["silent"] = bool(opts.silent)
    send_kwargs["attributes"] = attrs or None
    send_kwargs["mime_type"] = mime
    
    # Always generate video thumbnails for any video file to prevent empty previews
    is_video = (mime or "").startswith("video/") or send_path.lower().endswith(
        (".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".flv", ".3gp")
    )
    if is_video:
        thumb_path = send_path + ".thumb.jpg"
        try:
            from engine.drive_fs import _ffmpeg_first_frame_jpeg
            if os.path.isfile(thumb_path):
                try:
                    os.remove(thumb_path)
                except OSError:
                    pass
            b = await _ffmpeg_first_frame_jpeg(send_path, thumb_path, max_edge=320)
            if b or (os.path.isfile(thumb_path) and os.path.getsize(thumb_path) > 0):
                thumb_handle = await client.upload_file(thumb_path)
                send_kwargs["thumb"] = thumb_handle
        except Exception as e:
            emit_event("LogEvent", level="WARNING", message=f"Failed to generate video thumbnail: {e}")
        finally:
            if os.path.isfile(thumb_path):
                try:
                    os.remove(thumb_path)
                except OSError:
                    pass

    if opts.reply_to:
        send_kwargs["reply_to"] = int(opts.reply_to)
    sched = _parse_schedule(opts.schedule_date)
    if sched:
        send_kwargs["schedule"] = sched
    if opts.topic_id and not send_kwargs.get("reply_to"):
        send_kwargs["reply_to"] = int(opts.topic_id)

    def cb(cur, tot):
        agg.on_item(item.index, cur, tot or item.size)

    msg = None
    try:
        if uploaded_handle is not None:
            try:
                msg = await client.send_file(
                    entity,
                    uploaded_handle,
                    file_name=final_file_name,
                    **{k: v for k, v in send_kwargs.items() if v is not None},
                )
            except TypeError:
                send_kwargs.pop("spoiler", None)
                msg = await client.send_file(
                    entity,
                    uploaded_handle,
                    file_name=final_file_name,
                    **{k: v for k, v in send_kwargs.items() if v is not None},
                )
            except Exception as commit_err:
                emit_event("LogEvent", level="WARNING", message=f"commit-by-handle failed, retry path: {commit_err}")
                msg = await fast_send_file(
                    client,
                    entity,
                    send_path,
                    workers=part_workers,
                    progress_callback=cb,
                    **send_kwargs,
                )
        else:
            try:
                msg = await fast_send_file(
                    client,
                    entity,
                    send_path,
                    workers=part_workers,
                    progress_callback=cb,
                    **send_kwargs,
                )
            except FloodWaitError as e:
                emit_event("FloodWait", seconds=e.seconds, index=item.index)
                await asyncio.sleep(int(e.seconds) + 2)
                send_kwargs.pop("spoiler", None)
                msg = await fast_send_file(
                    client,
                    entity,
                    send_path,
                    workers=part_workers,
                    progress_callback=cb,
                    **send_kwargs,
                )

        mid = _message_id_from_send_result(msg)
        # Terminal success once Telegram accepted the message — never flip to failed
        # because of post-commit bookkeeping (progress emit, thumb cleanup, etc.).
        apply_item_commit_success(item, mid, duration_s=round(time.time() - t0, 3))
        try:
            agg.on_item(item.index, item.size or 0, item.size or 0, force=True)
        except Exception:
            pass
        try:
            emit_event(
                "StudioItemDone",
                index=item.index,
                message_id=mid,
                duration_s=item.duration_s,
                avg_mb_s=item.avg_mb_s,
                status="done",
            )
        except Exception as emit_err:
            emit_event(
                "LogEvent",
                level="WARNING",
                message=f"StudioItemDone emit after success: {emit_err}",
            )
    except Exception as e:
        item.duration_s = round(time.time() - t0, 3)
        mid = item.message_id or _message_id_from_send_result(msg)
        final = item_status_after_event(
            item.status,
            incoming_status="failed",
            message_id=mid,
            had_message_id=bool(item.message_id or mid),
        )
        # If a message id was already captured / status stays done, keep success
        if final == "done" or mid:
            apply_item_commit_success(item, mid, duration_s=item.duration_s)
            try:
                emit_event(
                    "StudioItemDone",
                    index=item.index,
                    message_id=mid,
                    duration_s=item.duration_s,
                    status="done",
                    note=f"post-commit error ignored: {e}",
                )
            except Exception:
                pass
        else:
            item.status = "failed"
            item.error = str(e)
            emit_event("StudioItemDone", index=item.index, status="failed", error=str(e))
    finally:
        # thumb may be InputFile handle, not a path — only unlink real files we created
        try:
            thumb_candidate = send_path + ".thumb.jpg"
            if os.path.isfile(thumb_candidate):
                os.remove(thumb_candidate)
        except Exception:
            pass
    return item


async def _send_album(
    client: TelegramClient,
    entity,
    items: List[StudioItem],
    opts: StudioOptions,
    agg: ProgressAgg,
) -> List[StudioItem]:
    """Send up to 10 items as one album (photos/videos)."""
    if not items:
        return items
    paths = [i.path for i in items]
    caption = (items[0].caption or opts.global_caption or "").strip()
    # Album: force_document False for HQ look
    force_doc = (opts.quality_mode or "").upper() == "ORIGINAL"

    t0 = time.time()
    # Prepare events so Transfer Manager leaves 0% while album packs
    for it in items:
        emit_event(
            "StudioItemPrepare",
            index=it.index,
            phase="album",
            path=os.path.basename(it.path),
            size=it.size,
        )
        it.status = "uploading"
        emit_event("StudioItemStarted", index=it.index, path=os.path.basename(it.path), size=it.size)
        agg.on_item(it.index, 0, it.size or 1, force=True)

    def cb(cur, tot):
        # attribute progress to first item for simplicity
        agg.on_item(items[0].index, cur, tot or sum(i.size for i in items))

    send_kwargs: Dict[str, Any] = {
        "caption": caption or None,
        "force_document": force_doc,
        "silent": bool(opts.silent),
        "progress_callback": cb,
    }
    if opts.reply_to:
        send_kwargs["reply_to"] = int(opts.reply_to)
    sched = _parse_schedule(opts.schedule_date)
    if sched:
        send_kwargs["schedule"] = sched
    if opts.topic_id and not send_kwargs.get("reply_to"):
        send_kwargs["reply_to"] = int(opts.topic_id)
    if opts.spoiler:
        send_kwargs["spoiler"] = True

    try:
        try:
            msg = await client.send_file(
                entity,
                paths,
                **{k: v for k, v in send_kwargs.items() if v is not None},
            )
        except TypeError:
            send_kwargs.pop("spoiler", None)
            msg = await client.send_file(
                entity,
                paths,
                **{k: v for k, v in send_kwargs.items() if v is not None},
            )
        except FloodWaitError as e:
            emit_event("FloodWait", seconds=e.seconds)
            await asyncio.sleep(int(e.seconds) + 2)
            send_kwargs.pop("spoiler", None)
            msg = await client.send_file(
                entity,
                paths,
                **{k: v for k, v in send_kwargs.items() if v is not None},
            )

        ids: List[Optional[int]] = []
        if isinstance(msg, list):
            ids = [_message_id_from_send_result(m) for m in msg]
        elif msg is not None:
            ids = [_message_id_from_send_result(msg)]
        dur = round(time.time() - t0, 3)
        total_sz = sum(x.size for x in items) or 1
        for i, it in enumerate(items):
            mid = ids[i] if i < len(ids) else (ids[-1] if ids else None)
            # Album send returned → commit success is terminal per item
            apply_item_commit_success(it, mid, duration_s=dur)
            if it.size and dur:
                it.avg_mb_s = round((total_sz / (1024 * 1024)) / dur, 3)
            try:
                agg.on_item(it.index, it.size or 0, it.size or 0, force=True)
            except Exception:
                pass
            try:
                emit_event(
                    "StudioItemDone",
                    index=it.index,
                    message_id=it.message_id,
                    status="done",
                    duration_s=dur,
                )
            except Exception as emit_err:
                emit_event(
                    "LogEvent",
                    level="WARNING",
                    message=f"StudioItemDone album emit after success: {emit_err}",
                )
    except Exception as e:
        # Never flip items that already committed (message_id / done) to failed.
        for it in items:
            final = item_status_after_event(
                it.status,
                incoming_status="failed",
                message_id=it.message_id,
                had_message_id=bool(it.message_id),
            )
            if final == "done" or it.message_id or it.status == "done":
                if it.status != "done":
                    apply_item_commit_success(it, it.message_id, duration_s=it.duration_s)
                try:
                    emit_event(
                        "StudioItemDone",
                        index=it.index,
                        message_id=it.message_id,
                        status="done",
                        note=f"album post-commit error ignored: {e}",
                    )
                except Exception:
                    pass
                continue
            it.status = "failed"
            it.error = str(e)
            emit_event("StudioItemDone", index=it.index, status="failed", error=str(e))
    return items


async def run_ordered_upload(
    client: TelegramClient,
    entity,
    items: List[StudioItem],
    opts: StudioOptions,
) -> Dict[str, Any]:
    """
    Ordered parallel: up to `concurrency` sends in flight, but we only *start*
    item i after enough slots; completion order may vary — to preserve chat order
    we use sequential finalize: wait for each index in order by chaining starts
    with a single-slot publish lock while allowing concurrent I/O preparation.

    Practical approach that preserves order on Telegram:
    - Sequential send when concurrency==1
    - For concurrency>1: pipeline where next send starts only after previous
      *started* (not finished) still risks reordering. True order = sequential send.
    - Hybrid: run concurrent *uploads* only for independent files but **await
      send_file in index order** while next file's open/stat is prefetched.

    We implement: sequential send_file (order-safe) with concurrent *prefetch*
    of file stats + optional album batching. For true multi-connection speed
    on large multi-file, use concurrency as "pipeline depth" of sequential
    queue with asyncio — actually Telegram send_file already parallelizes parts.

    For multi-file throughput: allow N concurrent send_file BUT sort commits:
    only emit/mark done in order; still may reorder in chat.

    Plan requires: Stage B sequential finalize. So we use an asyncio.Queue of
    ready results: workers can only run send for indices that are next-to-send
    OR we simply sequential with asyncio for floodwait. 

    Compromise for "parallel + order":
    - Use semaphore for concurrent sends
    - After all complete, we cannot reorder chat.
    - So: **sequential send** is the only hard order guarantee.
    - Parallelize **within** album (one API call) and **download** batch.

    We'll use sequential send for non-album (order guaranteed) + optional
    limited overlapping: start next upload only after previous completes.
    Concurrency setting still used for **download batch** and for album chunking.
    Additionally for non-album: if concurrency>1, use "windowed sequential"
    documentation that chat order is sequential for safety.

    Implementation: sequential send (reliable order). concurrency used for
    download parallelism and as recommended max album batching workers.
    Emit note in StudioStarted.
    """
    total_bytes = sum(i.size for i in items)
    agg = ProgressAgg(total_bytes, len(items))
    # Live per-account upload ceiling (free ~2GB / Premium ~4GB / app-config).
    try:
        upload_policy = await resolve_upload_policy(client)
    except Exception:
        upload_policy = None
    if upload_policy is not None:
        emit_event(
            "StudioInfo",
            message=(
                f"Batas unggah akun {'Premium' if upload_policy.premium else 'standar'}: "
                f"{upload_policy.hard_max_bytes} byte "
                f"(sumber={upload_policy.source})"
            ),
            premium=upload_policy.premium,
            hard_max_bytes=upload_policy.hard_max_bytes,
            safe_max_bytes=upload_policy.safe_max_bytes,
        )
    emit_event(
        "StudioStarted",
        mode="upload",
        items=len(items),
        total_bytes=total_bytes,
        quality=opts.quality_mode,
        concurrency=opts.concurrency,
        group_as_album=opts.group_as_album,
        order_mode="parallel_upload_sequential_commit",
        upload_hard_max_bytes=getattr(upload_policy, "hard_max_bytes", None),
        upload_premium=bool(getattr(upload_policy, "premium", False)) if upload_policy else None,
    )

    # Album mode: batch by 10 same-kind media
    if opts.group_as_album:
        batches: List[List[StudioItem]] = []
        current: List[StudioItem] = []
        current_kind = None
        for it in items:
            ext = _ext(it.path)
            kind = "photo" if ext in PHOTO_EXTS else ("video" if ext in VIDEO_EXTS else "other")
            if kind == "other":
                if current:
                    batches.append(current)
                    current = []
                    current_kind = None
                batches.append([it])
                continue
            if current_kind is None:
                current_kind = kind
            if kind != current_kind or len(current) >= 10:
                if current:
                    batches.append(current)
                current = [it]
                current_kind = kind
            else:
                current.append(it)
        if current:
            batches.append(current)

        for batch in batches:
            await _wait_if_transfer_paused()
            # Account-limit prepare (encode/preflight) before album commit
            ready_batch: List[StudioItem] = []
            upload_paths: Dict[int, str] = {}
            for it in batch:
                try:
                    upath, tmp = await _prepare_item_path(
                        it, opts, upload_policy=upload_policy
                    )
                    if it.status == "failed":
                        emit_event(
                            "StudioItemDone",
                            index=it.index,
                            status="failed",
                            error=it.error,
                        )
                        continue
                    if tmp and upath != it.path:
                        upload_paths[it.index] = upath
                    ready_batch.append(it)
                    # stash path for album send via item.path swap carefully
                    if upath != it.path:
                        it._upload_path = upath  # type: ignore[attr-defined]
                        it._tmp_path = tmp  # type: ignore[attr-defined]
                except Exception as e:
                    it.status = "failed"
                    it.error = str(e)
                    emit_event(
                        "StudioItemDone", index=it.index, status="failed", error=str(e)
                    )
            if not ready_batch:
                continue
            if len(ready_batch) == 1:
                it0 = ready_batch[0]
                up = getattr(it0, "_upload_path", None)
                await _send_one(
                    client, entity, it0, opts, agg, upload_path=up
                )
                tmp = getattr(it0, "_tmp_path", None)
                if tmp and os.path.isfile(tmp):
                    try:
                        os.remove(tmp)
                    except Exception:
                        pass
            else:
                # Album send uses original paths; rewrite to prepared paths
                orig_paths = []
                for it in ready_batch:
                    orig_paths.append(it.path)
                    up = getattr(it, "_upload_path", None)
                    if up:
                        it.path = up
                        it.size = os.path.getsize(up) if os.path.isfile(up) else it.size
                try:
                    await _send_album(client, entity, ready_batch, opts, agg)
                finally:
                    for it, op in zip(ready_batch, orig_paths):
                        tmp = getattr(it, "_tmp_path", None)
                        it.path = op
                        if tmp and os.path.isfile(tmp):
                            try:
                                os.remove(tmp)
                            except Exception:
                                pass
    else:
        # Adaptive producer-consumer: at most two hardware encodes on capable
        # devices, while completed items immediately enter DC upload. Commit to
        # chat remains ordered.
        conc = max(1, min(int(opts.concurrency or 4), 8))
        prepare_slots = _adaptive_prepare_slots(opts, len(items))
        prepare_sem = asyncio.Semaphore(prepare_slots)
        emit_event("StudioInfo", message=f"Pipeline encode adaptif: {prepare_slots} stream")

        async def _prepare_one(it: StudioItem) -> Tuple[StudioItem, str, Optional[str], int]:
            async with prepare_sem:
                await _wait_if_transfer_paused()
                old_sz = it.size or 0

                def reencode_progress(data: Dict[str, Any]):
                    event = str(data.get("event") or "progress")
                    payload = {key: value for key, value in data.items() if key != "event"}
                    if event == "started":
                        emit_event("StudioReencodeStarted", index=it.index, **payload)
                    elif event == "done":
                        emit_event("StudioReencodeDone", index=it.index, **payload)
                    else:
                        emit_event("StudioReencodeProgress", index=it.index, **payload)

                upath, tmp = await _prepare_item_path(
                    it, opts, progress_cb=reencode_progress, upload_policy=upload_policy
                )
                return it, upath, tmp, old_sz

        prepare_tasks = [asyncio.create_task(_prepare_one(it)) for it in items]
        prepared: List[Tuple[StudioItem, str, Optional[str]]] = []

        max_item = max((it.size for it in items), default=0)
        # More concurrent MTProto parts per file (latency-bound links benefit most).
        # Align with fast_transfer._workers_for_size for multi-GB single files.
        part_workers = [
            48 if max_item >= 1500 * 1024 * 1024
            else (36 if max_item >= 500 * 1024 * 1024
            else (24 if max_item >= 120 * 1024 * 1024
            else (16 if max_item >= 40 * 1024 * 1024
            else (12 if max_item >= 8 * 1024 * 1024
            else 8))))
        ][0]
        # Adaptive: shrink after FloodWait
        flood_hits = {"n": 0}

        async def _upload_adaptive(it, upath):
            await _wait_if_transfer_paused()
            pw = max(2, part_workers // (1 + flood_hits["n"]))
            try:
                return await _upload_bytes(
                    client,
                    it,
                    agg,
                    file_sem,
                    part_workers=pw,
                    upload_path=upath,
                    upload_policy=upload_policy,
                )
            except FloodWaitError:
                flood_hits["n"] = min(flood_hits["n"] + 1, 4)
                emit_event(
                    "StudioInfo",
                    message=f"FloodWait — mengurangi part workers (hits={flood_hits['n']})",
                )
                raise

        file_sem = asyncio.Semaphore(conc)
        upload_tasks = []
        for idx, task in enumerate(prepare_tasks):
            it = items[idx]
            try:
                it, upath, tmp, old_sz = await task
            except Exception as e:
                # Prepare/preflight failed (oversize etc.) — skip upload for this item
                it.status = "failed"
                it.error = str(e)
                emit_event("StudioItemDone", index=it.index, status="failed", error=str(e))
                continue
            if it.status == "failed":
                emit_event("StudioItemDone", index=it.index, status="failed", error=it.error)
                continue
            if it.size and it.size != old_sz:
                agg.adjust_total_bytes(it.size - old_sz)
            prepared.append((it, upath, tmp))
            upload_tasks.append(asyncio.create_task(_upload_adaptive(it, upath)))
        for i, (it, upath, tmp) in enumerate(prepared):
            await _wait_if_transfer_paused()
            try:
                handle = await upload_tasks[i]
            except Exception as e:
                it.status = "failed"
                it.error = str(e)
                emit_event("StudioItemDone", index=it.index, status="failed", error=str(e))
                if tmp and os.path.isfile(tmp):
                    try:
                        os.remove(tmp)
                    except Exception:
                        pass
                continue
            pw = max(2, part_workers // (1 + flood_hits["n"]))
            await _send_one(
                client, entity, it, opts, agg,
                uploaded_handle=handle,
                part_workers=pw,
                upload_path=upath,
            )
            if tmp and os.path.isfile(tmp):
                try:
                    os.remove(tmp)
                except Exception:
                    pass

    done = sum(1 for i in items if i.status == "done")
    failed = sum(1 for i in items if i.status == "failed")
    elapsed = max(time.time() - agg.t0, 1e-6)
    result = {
        "status": "ok" if failed == 0 else ("partial" if done else "error"),
        "mode": "upload",
        "items": [
            {
                "index": i.index,
                "path": i.path,
                "status": i.status,
                "message_id": i.message_id,
                "error": i.error,
                "size": i.size,
                "duration_s": i.duration_s,
                "avg_mb_s": i.avg_mb_s,
            }
            for i in items
        ],
        "done": done,
        "failed": failed,
        "size_bytes": total_bytes,
        "duration_s": round(elapsed, 3),
        "avg_mb_s": round((total_bytes / (1024 * 1024)) / elapsed, 3),
        "peak_mb_s": round(agg.peak_mb_s, 3),
    }
    emit_event("StudioFinished", **{k: v for k, v in result.items() if k != "items"})
    # Counts/sizes on Drive locations must recompute after upload
    try:
        from engine.drive_fs import invalidate_media_stats

        invalidate_media_stats()
    except Exception:
        pass
    print(f"[JSON_OUTPUT]{json.dumps(result, default=str)}", flush=True)
    return result


async def run_download_batch(
    client: TelegramClient,
    entity,
    *,
    last_n: int = 5,
    message_ids: Optional[List[int]] = None,
    concurrency: int = 3,
    out_dir: Optional[str] = None,
) -> Dict[str, Any]:
    out_dir = out_dir or os.path.join(_ensure_temp(), f"dl_{int(time.time())}")
    os.makedirs(out_dir, exist_ok=True)

    messages = []
    if message_ids:
        msgs = await client.get_messages(entity, ids=message_ids)
        if not isinstance(msgs, list):
            msgs = [msgs]
        messages = [m for m in msgs if m and m.media]
    else:
        n = max(1, min(int(last_n or 5), 50))
        async for m in client.iter_messages(entity, limit=n * 3):
            if m.media:
                messages.append(m)
            if len(messages) >= n:
                break
        messages = list(reversed(messages))  # oldest first for stable numbering

    if not messages:
        raise ValueError("No media messages found")

    from engine.fast_transfer import fast_download_media

    emit_event("StudioStarted", mode="download", items=len(messages), out_dir=out_dir)
    sem = asyncio.Semaphore(max(1, min(int(concurrency or 4), 8)))
    results: List[Dict[str, Any]] = [{} for _ in messages]
    t0 = time.time()

    async def one(idx: int, msg):
        async with sem:
            await _wait_if_transfer_paused()
            name = f"{idx + 1:03d}_{msg.id}"
            path = os.path.join(out_dir, name)
            emit_event(
                "StudioItemStarted",
                index=idx,
                message_id=msg.id,
                path=name,
            )
            t1 = time.time()
            try:
                def cb(cur, tot):
                    emit_event(
                        "StudioProgress",
                        phase="download",
                        item_index=idx,
                        items_total=len(messages),
                        transferred=cur,
                        total=tot or 0,
                        percent=round((cur / tot * 100) if tot else 0, 2),
                        item_current=cur,
                        item_total=tot or 0,
                    )

                saved = await fast_download_media(
                    client, msg, path, workers=0, progress_callback=cb
                )
                size = os.path.getsize(saved) if saved and os.path.exists(saved) else 0
                dur = max(time.time() - t1, 1e-6)
                results[idx] = {
                    "index": idx,
                    "message_id": msg.id,
                    "path": saved,
                    "size": size,
                    "status": "done",
                    "duration_s": round(dur, 3),
                    "avg_mb_s": round((size / (1024 * 1024)) / dur, 3),
                }
                emit_event("StudioItemDone", index=idx, status="done", path=saved, size=size)
            except FloodWaitError as e:
                emit_event("FloodWait", seconds=e.seconds, index=idx)
                await asyncio.sleep(int(e.seconds) + 2)
                try:
                    saved = await fast_download_media(client, msg, path, workers=0)
                    size = os.path.getsize(saved) if saved and os.path.exists(saved) else 0
                    results[idx] = {
                        "index": idx,
                        "message_id": msg.id,
                        "path": saved,
                        "size": size,
                        "status": "done",
                    }
                    emit_event("StudioItemDone", index=idx, status="done", path=saved)
                except Exception as e2:
                    results[idx] = {"index": idx, "message_id": msg.id, "status": "failed", "error": str(e2)}
                    emit_event("StudioItemDone", index=idx, status="failed", error=str(e2))
            except Exception as e:
                results[idx] = {"index": idx, "message_id": msg.id, "status": "failed", "error": str(e)}
                emit_event("StudioItemDone", index=idx, status="failed", error=str(e))

    await asyncio.gather(*[one(i, m) for i, m in enumerate(messages)])
    elapsed = max(time.time() - t0, 1e-6)
    total = sum(r.get("size", 0) or 0 for r in results)
    done = sum(1 for r in results if r.get("status") == "done")
    failed = sum(1 for r in results if r.get("status") == "failed")
    result = {
        "status": "ok" if failed == 0 else ("partial" if done else "error"),
        "mode": "download",
        "out_dir": out_dir,
        "items": results,
        "done": done,
        "failed": failed,
        "size_bytes": total,
        "duration_s": round(elapsed, 3),
        "avg_mb_s": round((total / (1024 * 1024)) / elapsed, 3) if total else 0,
    }
    emit_event("StudioFinished", **{k: v for k, v in result.items() if k != "items"})
    print(f"[JSON_OUTPUT]{json.dumps(result, default=str)}", flush=True)
    return result


async def run_media_studio(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    chat_id: str,
    action: str = "upload",  # upload | download
    files: Optional[List[Dict[str, Any]]] = None,
    options: Optional[Dict[str, Any]] = None,
    last_n: int = 5,
    message_ids: Optional[List[int]] = None,
) -> Dict[str, Any]:
    setup_emitter(None, None)
    from engine.debug_log import dlog, dlog_exc, set_debug_session, is_debug_enabled

    set_debug_session(f"studio-{action}-{int(time.time())}")
    dlog(
        "media_studio start",
        scope="media_studio",
        phase="start",
        action=action,
        chat_id=str(chat_id),
        files_n=len(files) if isinstance(files, list) else (1 if files else 0),
        debug=is_debug_enabled(),
    )
    opts_raw = options or {}
    opts = StudioOptions(
        quality_mode=str(opts_raw.get("quality_mode") or opts_raw.get("qualityMode") or "HIGH_QUALITY"),
        concurrency=int(opts_raw.get("concurrency") or 4),
        group_as_album=bool(opts_raw.get("group_as_album") or opts_raw.get("groupAsAlbum")),
        silent=bool(opts_raw.get("silent")),
        spoiler=bool(opts_raw.get("spoiler")),
        compress=bool(opts_raw.get("compress")),
        reply_to=int(opts_raw["reply_to"]) if opts_raw.get("reply_to") else (
            int(opts_raw["replyTo"]) if opts_raw.get("replyTo") else None
        ),
        schedule_date=opts_raw.get("schedule_date") or opts_raw.get("scheduleDate"),
        topic_id=int(opts_raw["topic_id"]) if opts_raw.get("topic_id") else (
            int(opts_raw["topicId"]) if opts_raw.get("topicId") else None
        ),
        global_caption=str(opts_raw.get("global_caption") or opts_raw.get("globalCaption") or ""),
        reencode_hw=str(opts_raw.get("reencode_hw") or opts_raw.get("reencodeHardware") or "auto"),
        reencode_preset=str(opts_raw.get("reencode_preset") or opts_raw.get("reencodePreset") or "balanced"),
    )
    opts.concurrency = max(1, min(opts.concurrency, 8))
    dlog(
        "media_studio options",
        scope="media_studio",
        phase="options",
        quality=opts.quality_mode,
        concurrency=opts.concurrency,
        group_as_album=opts.group_as_album,
        reencode_hw=opts.reencode_hw,
        reencode_preset=opts.reencode_preset,
    )

    session_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "sessions")
    session_file = os.path.join(session_dir, session_name)
    # P0: retry connect on SQLite session lock (drive-serve handoff race)
    client = TelegramClient(session_file, int(api_id), str(api_hash))
    last_conn: Optional[Exception] = None
    for attempt in range(6):
        try:
            await client.connect()
            if not await client.is_user_authorized():
                await client.disconnect()
                raise RuntimeError("Session not authorized")
            last_conn = None
            break
        except Exception as e:
            last_conn = e
            msg = str(e).lower()
            try:
                await client.disconnect()
            except Exception:
                pass
            if "locked" in msg or "database is locked" in msg or "sqlite" in msg:
                dlog(
                    "media_studio connect retry (session lock)",
                    scope="media_studio",
                    phase="connect",
                    attempt=attempt + 1,
                    error=str(e),
                )
                await asyncio.sleep(0.35 + attempt * 0.3)
                client = TelegramClient(session_file, int(api_id), str(api_hash))
                continue
            raise
    if last_conn is not None:
        raise RuntimeError(str(last_conn))
    try:
        enc = encryption_backend()
        dlog("encryption backend", scope="media_studio", phase="crypto", encryption=enc)
        emit_event("StudioInfo", encryption=enc, note="cryptg/tgcrypto greatly improves upload speed")
        if enc == "python":
            emit_event(
                "StudioWarning",
                message="MTProto encryption is pure-Python (slow). Install cryptg: pip install cryptg",
            )
        entity = await _resolve_entity(client, chat_id)

        if action == "download":
            return await run_download_batch(
                client,
                entity,
                last_n=last_n,
                message_ids=message_ids,
                concurrency=opts.concurrency,
            )

        # upload
        if not files:
            raise ValueError("files required for upload")
        # Normalize: single object / path string / list
        if isinstance(files, dict):
            files = [files]
        elif isinstance(files, str):
            files = [{"path": files}]
        elif not isinstance(files, list):
            raise ValueError("files must be a list of {path, caption}")

        items: List[StudioItem] = []
        for i, f in enumerate(files):
            if isinstance(f, str):
                path = f
                caption = ""
            elif isinstance(f, dict):
                path = f.get("path") or f.get("file") or f.get("Path") or ""
                caption = str(f.get("caption") or f.get("Caption") or "")
            else:
                raise ValueError(f"Invalid file entry at index {i}")
            path = os.path.normpath(str(path))
            if not path or not os.path.isfile(path):
                raise ValueError(f"File not found: {path}")
            # P0: never upload sessions/secrets/arbitrary system paths
            from engine.path_policy import validate_upload_path

            path = validate_upload_path(path)
            items.append(
                StudioItem(
                    index=i,
                    path=path,
                    caption=caption,
                    size=os.path.getsize(path),
                )
            )
        # Speed guard: pure-Python MTProto is extremely slow
        if encryption_backend() == "python":
            emit_event(
                "StudioWarning",
                message=(
                    "cryptg/tgcrypto tidak terpasang — enkripsi pure-Python (lambat). "
                    "Jalankan: pip install cryptg"
                ),
            )
        result = await run_ordered_upload(client, entity, items, opts)
        dlog(
            "media_studio upload finished",
            scope="media_studio",
            phase="done",
            status=result.get("status"),
            done=result.get("done"),
            failed=result.get("failed"),
        )
        return result
    except Exception as e:
        dlog_exc("media_studio failed", e, scope="media_studio", phase="error", action=action)
        err = {"status": "error", "error": str(e), "mode": action}
        emit_event("StudioFailed", error=str(e))
        print(f"[JSON_OUTPUT]{json.dumps(err, default=str)}", flush=True)
        raise
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass
