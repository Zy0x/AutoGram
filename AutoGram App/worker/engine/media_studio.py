"""
Media Studio — multi-file upload/download with quality modes,
ordered-parallel pipeline, album grouping, and Telegram-like options.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import mimetypes
import os
import random
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple  # noqa: F401

from telethon import TelegramClient, functions, types, utils
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
from engine.transfer_journal import TransferJournal

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


def patch_telethon_sqlite_session():
    try:
        from telethon.sessions import SQLiteSession
        if not getattr(SQLiteSession._cursor, '_is_patched', False):
            orig_cursor = SQLiteSession._cursor
            
            def patched_cursor(self):
                cursor = orig_cursor(self)
                try:
                    if self._conn is not None:
                        if not getattr(self._conn, '_patched_wal_timeout', False):
                            # Set the flag first to prevent loop on exceptions
                            setattr(self._conn, '_patched_wal_timeout', True)
                            
                            # These connection-scoped settings can be executed safely at any time
                            self._conn.execute("PRAGMA busy_timeout=15000;")
                            self._conn.execute("PRAGMA synchronous=NORMAL;")
                            
                            # journal_mode=WAL can fail if called inside a transaction
                            try:
                                self._conn.execute("PRAGMA journal_mode=WAL;")
                            except Exception:
                                pass
                except Exception:
                    pass
                return cursor
                
            patched_cursor._is_patched = True
            SQLiteSession._cursor = patched_cursor
    except Exception:
        pass

patch_telethon_sqlite_session()


def _patch_session_wal(session_file: str) -> None:
    """
    Apply WAL journal mode and high busy_timeout to Telethon's session SQLite file
    so concurrent access from drive_serve + media_studio doesn't cause
    'database is locked' errors. Safe to call on non-existent file (no-op).
    """
    db_path = session_file + ".session" if not session_file.endswith(".session") else session_file
    if not os.path.isfile(db_path):
        return
    try:
        import sqlite3 as _sqlite3
        conn = _sqlite3.connect(db_path, timeout=5.0)
        try:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA busy_timeout=15000;")
            conn.execute("PRAGMA synchronous=NORMAL;")
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass


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
    status: str = "pending"  # pending|uploading|done|failed|skipped|needs_verification
    message_id: Optional[int] = None
    error: Optional[str] = None
    duration_s: float = 0.0
    avg_mb_s: float = 0.0
    item_id: str = ""
    fingerprint: str = ""
    original_name: str = ""
    temp_path_to_delete: str = ""


@dataclass
class RegisteredMedia:
    input_media: Any
    media_identity: str
    final_file_name: str
    send_path: str
    random_id: int
    registered_at: float
    thumb_path: Optional[str] = None
    thumb_data_url: Optional[str] = None


class AmbiguousCommitError(RuntimeError):
    """Bytes are registered, but Telegram commit could not be proven."""


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
    duplicate_policy: str = "SKIP"  # SKIP | FORCE_UPLOAD
    # Enhanced duplicate detection options
    scan_mode: str = "smart"              # normal | smart | forensic
    guardrail_enabled: bool = True        # confirm before re-uploading recently deleted files
    guardrail_threshold_days: int = 7     # files deleted within N days require confirmation
    topic_scope: str = "selected_plus_general"  # selected_only | selected_plus_general | all_topics
    max_reupload_per_hour: int = 10       # rate limit for re-uploads


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


def _final_name(original_path_or_item, current_path: str) -> str:
    if hasattr(original_path_or_item, "original_name") and original_path_or_item.original_name:
        orig = original_path_or_item.original_name
        original_path = original_path_or_item.path
    elif hasattr(original_path_or_item, "path"):
        orig = os.path.basename(original_path_or_item.path)
        original_path = original_path_or_item.path
    else:
        orig = os.path.basename(str(original_path_or_item))
        original_path = str(original_path_or_item)

    if current_path and current_path != original_path:
        return os.path.splitext(orig)[0] + _ext(current_path)
    return orig


def _align_caption_with_sent_file(
    caption: str,
    original_path_or_item,
    final_file_name: str,
) -> str:
    """
    Keep Drive display name in sync when HQ re-encode changes container
    (e.g. clip.webm → clip.mp4). UI often uses original basename as caption.
    """
    cap = (caption or "").strip()
    final_base = os.path.basename(final_file_name or "")
    
    if hasattr(original_path_or_item, "original_name") and original_path_or_item.original_name:
        orig_base = original_path_or_item.original_name
    elif hasattr(original_path_or_item, "path"):
        orig_base = os.path.basename(original_path_or_item.path)
    else:
        orig_base = os.path.basename(str(original_path_or_item))
        
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


def _stable_random_id(transfer_id: str, item: StudioItem) -> int:
    seed = f"{transfer_id}|{item.item_id or item.index}|{item.fingerprint}|{item.size}"
    value = int.from_bytes(hashlib.sha256(seed.encode("utf-8", errors="replace")).digest()[:8], "big")
    return max(1, value & ((1 << 63) - 1))


def _session_lease_hash(session_name: str, api_id: int) -> str:
    """Match frontend driveSessionLeaseKey without exposing the raw session."""
    text = f"{session_name}|{api_id}"
    h1 = 0x811C9DC5
    h2 = 0x9E3779B9
    for index, char in enumerate(text):
        h1 = ((h1 ^ ord(char)) * 0x01000193) & 0xFFFFFFFF
        h2 = ((h2 ^ (ord(char) + index)) * 0x85EBCA6B) & 0xFFFFFFFF
    return f"{h1:08x}{h2:08x}"


async def _sha256_file(path: str) -> str:
    def _hash() -> str:
        digest = hashlib.sha256()
        with open(path, "rb") as fh:
            while True:
                chunk = fh.read(4 * 1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        return digest.hexdigest()

    return await asyncio.to_thread(_hash)


def _media_identity(media_or_message: Any) -> str:
    media = getattr(media_or_message, "media", media_or_message)
    document = getattr(media, "document", None)
    photo = getattr(media, "photo", None)
    obj = document or photo
    if obj is None:
        return ""
    kind = "document" if document is not None else "photo"
    return f"{kind}:{int(getattr(obj, 'id', 0) or 0)}"


def _thumb_data_url(path: Optional[str]) -> Optional[str]:
    if not path or not os.path.isfile(path):
        return None
    try:
        if os.path.getsize(path) > 512 * 1024:
            return None
        with open(path, "rb") as fh:
            data = fh.read()
        return f"data:image/jpeg;base64,{base64.b64encode(data).decode('ascii')}"
    except OSError:
        return None


async def _make_video_thumb(client: TelegramClient, send_path: str) -> Tuple[Any, Optional[str]]:
    is_video = send_path.lower().endswith(
        (".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".flv", ".3gp")
    )
    if not is_video:
        return None, None
    thumb_path = send_path + f".{uuid.uuid4().hex[:8]}.thumb.jpg"
    try:
        from engine.drive_fs import _ffmpeg_first_frame_jpeg

        payload = await _ffmpeg_first_frame_jpeg(send_path, thumb_path, max_edge=320)
        if payload or (os.path.isfile(thumb_path) and os.path.getsize(thumb_path) > 0):
            return await client.upload_file(thumb_path), thumb_path
    except Exception as exc:
        emit_event("LogEvent", level="WARNING", message=f"Thumbnail lokal gagal: {exc}")
    try:
        if os.path.isfile(thumb_path):
            os.remove(thumb_path)
    except OSError:
        pass
    return None, None


async def _register_uploaded_handle(
    client: TelegramClient,
    entity,
    item: StudioItem,
    opts: StudioOptions,
    uploaded_handle: Any,
    send_path: str,
    *,
    transfer_id: str,
    journal: TransferJournal,
) -> RegisteredMedia:
    """Turn temporary uploaded parts into reusable Telegram media."""
    final_file_name = _final_name(item, send_path)
    kwargs = resolve_send_kwargs(send_path, opts.quality_mode, spoiler=opts.spoiler)
    force_doc = bool(kwargs.get("force_document"))
    ext = _ext(send_path)
    as_photo = ext in PHOTO_EXTS and not force_doc
    thumb_handle = None
    thumb_path: Optional[str] = None
    if not as_photo:
        thumb_handle, thumb_path = await _make_video_thumb(client, send_path)

    if as_photo:
        uploaded_media = types.InputMediaUploadedPhoto(
            file=uploaded_handle,
            spoiler=bool(opts.spoiler) or None,
        )
    else:
        attrs, mime = build_send_attributes(
            send_path,
            force_document=force_doc,
            supports_streaming=bool(kwargs.get("supports_streaming", True)),
            file_name=final_file_name,
        )
        uploaded_media = types.InputMediaUploadedDocument(
            file=uploaded_handle,
            mime_type=mime or mimetypes.guess_type(final_file_name)[0] or "application/octet-stream",
            attributes=attrs or [],
            thumb=thumb_handle,
            force_file=force_doc or None,
            spoiler=bool(opts.spoiler) or None,
            nosound_video=True if ext in VIDEO_EXTS else None,
        )

    emit_event("StudioItemPhase", index=item.index, phase="media_registering")
    journal.append(
        "media_register_start",
        critical=True,
        index=item.index,
        item_id=item.item_id,
        file_name=final_file_name,
    )
    last_error: Optional[BaseException] = None
    response = None
    for attempt in range(3):
        try:
            if not client.is_connected():
                await client.connect()
            response = await client(functions.messages.UploadMediaRequest(peer=entity, media=uploaded_media))
            break
        except FloodWaitError as exc:
            wait_seconds = max(1, int(exc.seconds))
            emit_event("FloodWait", seconds=wait_seconds, index=item.index, phase="upload_media")
            journal.append("flood_wait", verbose=True, index=item.index, phase="upload_media", seconds=wait_seconds)
            await asyncio.sleep(wait_seconds + 1)
        except Exception as exc:
            last_error = exc
            journal.append(
                "media_register_retry",
                verbose=True,
                index=item.index,
                attempt=attempt + 1,
                error_type=type(exc).__name__,
                error=str(exc),
            )
            if attempt < 2:
                await asyncio.sleep(1.0 + attempt)
    if response is None:
        if thumb_path and os.path.isfile(thumb_path):
            try:
                os.remove(thumb_path)
            except OSError:
                pass
        raise RuntimeError(
            "Byte sudah diunggah tetapi registrasi media Telegram gagal. "
            "AutoGram menghentikan item tanpa mengunggah ulang file."
        ) from last_error

    if getattr(response, "document", None) is not None:
        input_media = utils.get_input_media(
            response.document,
            supports_streaming=bool(kwargs.get("supports_streaming", True)),
        )
    elif getattr(response, "photo", None) is not None:
        input_media = utils.get_input_media(response.photo)
    else:
        if thumb_path and os.path.isfile(thumb_path):
            try:
                os.remove(thumb_path)
            except OSError:
                pass
        raise RuntimeError("Telegram uploadMedia tidak mengembalikan document/photo")

    identity = _media_identity(response)
    random_id = _stable_random_id(transfer_id, item)
    registered = RegisteredMedia(
        input_media=input_media,
        media_identity=identity,
        final_file_name=final_file_name,
        send_path=send_path,
        random_id=random_id,
        registered_at=time.time(),
        thumb_path=thumb_path,
        thumb_data_url=_thumb_data_url(thumb_path),
    )
    item.status = "waiting_commit"
    emit_event(
        "StudioItemPhase",
        index=item.index,
        phase="media_registered",
        media_identity=identity,
    )
    journal.append(
        "media_registered",
        critical=True,
        index=item.index,
        item_id=item.item_id,
        media_identity=identity,
        random_id_hash=hashlib.sha256(str(random_id).encode()).hexdigest()[:16],
    )
    return registered


async def _reconcile_registered_commit(
    client: TelegramClient,
    entity,
    item: StudioItem,
    registered: RegisteredMedia,
    opts: StudioOptions,
    journal: TransferJournal,
):
    """Find an accepted commit without sending bytes or creating a new message."""
    topic = int(opts.topic_id or opts.reply_to or 0) or None
    try:
        async for msg in client.iter_messages(entity, limit=120, reply_to=topic):
            if getattr(msg, "date", None) and msg.date.timestamp() < registered.registered_at - 15:
                break
            identity = _media_identity(msg)
            same_identity = bool(identity and identity == registered.media_identity)
            same_file = False
            try:
                same_file = (
                    bool(msg.file)
                    and str(msg.file.name or "") == registered.final_file_name
                    and (not item.size or int(msg.file.size or 0) == int(item.size))
                )
            except Exception:
                pass
            if same_identity or same_file:
                journal.append(
                    "commit_reconciled",
                    critical=True,
                    index=item.index,
                    message_id=int(msg.id),
                    media_identity=identity,
                )
                return msg
    except FloodWaitError as exc:
        await asyncio.sleep(max(1, int(exc.seconds)) + 1)
    except Exception as exc:
        journal.append(
            "commit_reconcile_error",
            verbose=True,
            index=item.index,
            error_type=type(exc).__name__,
            error=str(exc),
        )
    return None


async def _commit_registered_media(
    client: TelegramClient,
    entity,
    item: StudioItem,
    opts: StudioOptions,
    registered: RegisteredMedia,
    *,
    journal: TransferJournal,
):
    caption = _align_caption_with_sent_file(
        (item.caption or opts.global_caption or "").strip(),
        item,
        registered.final_file_name,
    )
    entities = None
    try:
        caption, entities = await client._parse_message_text(caption, ())  # Telethon 1.44
    except Exception:
        entities = None
    reply_id = int(opts.reply_to or opts.topic_id or 0) or None
    reply_to = types.InputReplyToMessage(reply_to_msg_id=reply_id) if reply_id else None
    request = functions.messages.SendMediaRequest(
        peer=entity,
        media=registered.input_media,
        message=caption,
        silent=bool(opts.silent) or None,
        reply_to=reply_to,
        random_id=registered.random_id,
        entities=entities,
        schedule_date=_parse_schedule(opts.schedule_date),
    )
    item.status = "committing"
    emit_event("StudioItemPhase", index=item.index, phase="committing")
    journal.append("commit_start", critical=True, index=item.index, item_id=item.item_id)
    last_error: Optional[BaseException] = None
    for attempt in range(3):
        try:
            if not client.is_connected():
                await client.connect()
            updates = await client(request)
            msg = client._get_response_message(request, updates, entity)
            if msg is not None:
                return msg
            reconciled = await _reconcile_registered_commit(client, entity, item, registered, opts, journal)
            if reconciled is not None:
                return reconciled
            last_error = RuntimeError("Telegram commit response did not contain a message")
        except FloodWaitError as exc:
            wait_seconds = max(1, int(exc.seconds))
            emit_event("FloodWait", seconds=wait_seconds, index=item.index, phase="commit")
            journal.append("flood_wait", verbose=True, index=item.index, phase="commit", seconds=wait_seconds)
            await asyncio.sleep(wait_seconds + 1)
            continue
        except Exception as exc:
            last_error = exc
            reconciled = await _reconcile_registered_commit(client, entity, item, registered, opts, journal)
            if reconciled is not None:
                return reconciled
            journal.append(
                "commit_retry",
                verbose=True,
                index=item.index,
                attempt=attempt + 1,
                error_type=type(exc).__name__,
                error=str(exc),
            )
            if attempt < 2:
                await asyncio.sleep(1.5 + attempt)
                continue
        break
    raise AmbiguousCommitError(
        "Commit Telegram belum dapat diverifikasi. File tidak diunggah ulang; gunakan verifikasi/retry manual."
    ) from last_error


async def _commit_registered_album(
    client: TelegramClient,
    entity,
    entries: List[Tuple[StudioItem, RegisteredMedia]],
    opts: StudioOptions,
    *,
    journal: TransferJournal,
) -> List[Optional[Any]]:
    """Atomically commit reusable media with stable per-member random IDs."""
    singles: List[Any] = []
    for item, registered in entries:
        caption = _align_caption_with_sent_file(
            (item.caption or opts.global_caption or "").strip(),
            item,
            registered.final_file_name,
        )
        entities = None
        try:
            caption, entities = await client._parse_message_text(caption, ())
        except Exception:
            entities = None
        singles.append(
            types.InputSingleMedia(
                media=registered.input_media,
                message=caption,
                random_id=registered.random_id,
                entities=entities,
            )
        )

    reply_id = int(opts.reply_to or opts.topic_id or 0) or None
    request = functions.messages.SendMultiMediaRequest(
        peer=entity,
        multi_media=singles,
        silent=bool(opts.silent) or None,
        reply_to=(types.InputReplyToMessage(reply_to_msg_id=reply_id) if reply_id else None),
        schedule_date=_parse_schedule(opts.schedule_date),
    )
    random_ids = [registered.random_id for _, registered in entries]
    for item, _ in entries:
        item.status = "committing"
        emit_event("StudioItemPhase", index=item.index, phase="committing")
    journal.append(
        "album_commit_start",
        critical=True,
        indexes=[item.index for item, _ in entries],
        member_count=len(entries),
    )

    known: List[Optional[Any]] = [None] * len(entries)
    last_error: Optional[BaseException] = None
    for attempt in range(3):
        try:
            if not client.is_connected():
                await client.connect()
            updates = await client(request)
            response = client._get_response_message(random_ids, updates, entity)
            if isinstance(response, list):
                for index, message in enumerate(response[: len(known)]):
                    if message is not None:
                        known[index] = message
            if all(message is not None for message in known):
                return known
            last_error = RuntimeError("Telegram album response had missing message mappings")
        except FloodWaitError as exc:
            wait_seconds = max(1, int(exc.seconds))
            emit_event("FloodWait", seconds=wait_seconds, phase="album_commit")
            journal.append("flood_wait", index=-1, phase="album_commit", seconds=wait_seconds)
            await asyncio.sleep(wait_seconds + 1)
        except Exception as exc:
            last_error = exc

        # sendMultiMedia is atomic, but the local response may be lost. Reconcile
        # every stable media identity before retrying the identical request.
        for index, (item, registered) in enumerate(entries):
            if known[index] is not None:
                continue
            known[index] = await _reconcile_registered_commit(
                client, entity, item, registered, opts, journal
            )
        if all(message is not None for message in known):
            return known
        journal.append(
            "album_commit_retry",
            index=-1,
            attempt=attempt + 1,
            unresolved=sum(message is None for message in known),
            error_type=type(last_error).__name__ if last_error else "Unknown",
            error=str(last_error or "missing response"),
        )
        if attempt < 2:
            await asyncio.sleep(1.5 + attempt)

    journal.append(
        "album_commit_ambiguous",
        critical=True,
        unresolved=sum(message is None for message in known),
    )
    return known


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


def _extract_apk_icon(apk_path: str, temp_thumb_path: str) -> bool:
    import zipfile
    if not zipfile.is_zipfile(apk_path):
        return False
    try:
        with zipfile.ZipFile(apk_path, 'r') as z:
            names = z.namelist()
            candidates = []
            for name in names:
                lower_name = name.lower()
                if 'ic_launcher' in lower_name or 'app_icon' in lower_name or 'icon.png' in lower_name or 'icon.webp' in lower_name:
                    if lower_name.endswith(('.png', '.webp', '.jpg', '.jpeg')):
                        try:
                            info = z.getinfo(name)
                            candidates.append((name, info.file_size))
                        except Exception:
                            pass
            if not candidates:
                return False
            
            def score(item):
                name, size = item
                name_lower = name.lower()
                points = 0
                if 'ic_launcher' in name_lower:
                    points += 1000000
                if 'xxxhdpi' in name_lower:
                    points += 100000
                elif 'xxhdpi' in name_lower:
                    points += 10000
                elif 'xhdpi' in name_lower:
                    points += 1000
                elif 'hdpi' in name_lower:
                    points += 100
                return points + size
                
            candidates.sort(key=score, reverse=True)
            best_match = candidates[0][0]
            with open(temp_thumb_path, 'wb') as f_out:
                f_out.write(z.read(best_match))
            return True
    except Exception:
        return False


async def _download_remote_url(item: StudioItem) -> str:
    """
    Download a remote URL to a temporary local file, updating item size and reporting progress.
    """
    import aiohttp
    import urllib.parse
    import tempfile
    import re
    
    url = item.path
    parsed = urllib.parse.urlparse(url)
    filename = os.path.basename(parsed.path)
    if not filename:
        filename = "remote_file"
        
    temp_path = None
    
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        
        total_size = 0
        start_time = time.time()
        last_emit_time = 0
        
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.get(url, timeout=300) as response:
                if response.status != 200:
                    raise Exception(f"Gagal mengambil file dari URL (HTTP {response.status})")
                
                # Extract filename from Content-Disposition header if present
                cd = response.headers.get('Content-Disposition')
                if cd:
                    fname_match = re.findall(r'filename\*=\s*UTF-8\'\'(.+)', cd, re.IGNORECASE)
                    if fname_match:
                        filename = urllib.parse.unquote(fname_match[0])
                    else:
                        fname_match = re.findall(r'filename\s*=\s*["\']?([^"\';]+)["\']?', cd, re.IGNORECASE)
                        if fname_match:
                            filename = fname_match[0]
                
                # Remove any path traversal or invalid characters from filename
                filename = os.path.basename(filename)
                if not filename:
                    filename = "remote_file"
                
                item.original_name = filename
                
                # Create temp file with correct suffix
                os.makedirs(TEMP_DIR, exist_ok=True)
                suffix = os.path.splitext(filename)[1] or ".tmp"
                temp_fd, temp_path = tempfile.mkstemp(dir=TEMP_DIR, suffix=suffix)
                os.close(temp_fd)
                
                emit_event(
                    "StudioItemPrepare",
                    index=item.index,
                    phase="download_start",
                    path=filename,
                )
                
                content_len = response.content_length or 0
                item.size = content_len
                
                with open(temp_path, 'wb') as f:
                    async for chunk in response.content.iter_chunked(1024 * 1024): # 1MB chunks
                        f.write(chunk)
                        total_size += len(chunk)
                        
                        # Adjust content_len if decompressed size exceeds it
                        if content_len > 0 and total_size > content_len:
                            content_len = total_size
                            item.size = content_len
                        
                        now = time.time()
                        if now - last_emit_time > 0.5 or total_size == content_len:
                            last_emit_time = now
                            duration = now - start_time
                            speed = (total_size / (1024 * 1024)) / duration if duration > 0 else 0
                            percent = (total_size / content_len * 100) if content_len > 0 else 0
                            if percent > 99.9 and total_size < content_len:
                                percent = 99.9
                            
                            emit_event(
                                "StudioProgress",
                                index=item.index,
                                item_index=item.index,
                                phase="download",
                                item_current=total_size,
                                item_total=content_len or total_size,
                                speed_mb_s=speed,
                                percent=percent,
                                file_name=filename,
                            )
                            
        emit_event(
            "StudioItemPrepare",
            index=item.index,
            phase="download_complete",
            path=filename,
        )
        item.size = total_size
        return temp_path
    except Exception as e:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass
        emit_event(
            "StudioItemPrepare",
            index=item.index,
            phase="prepare_failed",
            error=str(e),
        )
        raise


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
    is_url = item.path.startswith("http://") or item.path.startswith("https://")
    url_temp_path = item.temp_path_to_delete or None
    if is_url:
        url_temp_path = await _download_remote_url(item)
        item.path = url_temp_path
        item.temp_path_to_delete = url_temp_path

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
                if url_temp_path and os.path.isfile(url_temp_path):
                    try:
                        os.remove(url_temp_path)
                    except Exception:
                        pass
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
        return item.path, url_temp_path
    try:
        emit_event(
            "StudioItemPrepare",
            index=item.index,
            phase="probe",
            path=_final_name(item, item.path),
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
                output=_final_name(item, send_path),
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
                if url_temp_path and os.path.isfile(url_temp_path):
                    try:
                        os.remove(url_temp_path)
                    except Exception:
                        pass
                item.status = "failed"
                item.error = str(e)
                raise
        if info.get("reencoded"):
            if url_temp_path and os.path.isfile(url_temp_path):
                try:
                    os.remove(url_temp_path)
                except Exception:
                    pass
            return send_path, send_path
        return item.path, url_temp_path
    except UploadLimitExceeded:
        if url_temp_path and os.path.isfile(url_temp_path):
            try:
                os.remove(url_temp_path)
            except Exception:
                pass
        raise
    except AccountBudgetError as e:
        if url_temp_path and os.path.isfile(url_temp_path):
            try:
                os.remove(url_temp_path)
            except Exception:
                pass
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
        if url_temp_path and os.path.isfile(url_temp_path):
            try:
                os.remove(url_temp_path)
            except Exception:
                pass
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
        return item.path, url_temp_path


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
    transfer_id: str = "",
    journal: Optional[TransferJournal] = None,
):
    """Parallel stage: multi-part concurrent upload to DC (no chat message yet)."""
    path = upload_path or item.path
    async with sem:
        item.status = "uploading"
        emit_event(
            "StudioItemStarted",
            index=item.index,
            path=_final_name(item, path),
            size=item.size,
            phase="upload_bytes",
        )
        # Immediate UI tick so bar leaves 0% while first part starts
        agg.on_item(item.index, 0, item.size or 1, force=True)

        def cb(cur, tot):
            agg.on_item(item.index, cur, tot or item.size)

        if not client.is_connected():
            emit_event("LogEvent", level="INFO", message="Telegram client disconnected, reconnecting before upload...")
            await client.connect()
        upload_seed = f"{transfer_id}|{item.item_id or item.index}|upload"
        upload_id = max(
            1,
            int.from_bytes(hashlib.sha256(upload_seed.encode()).digest()[:8], "big") & ((1 << 63) - 1),
        )
        if journal:
            journal.append(
                "upload_start",
                critical=True,
                index=item.index,
                item_id=item.item_id,
                file_name=os.path.basename(path),
                size=item.size,
                upload_id_hash=hashlib.sha256(str(upload_id).encode()).hexdigest()[:16],
                part_workers=part_workers,
            )
        resumed_parts = journal.acknowledged_parts(item.index, item.fingerprint) if journal else set()
        if resumed_parts and journal:
            journal.append(
                "upload_resume",
                critical=True,
                index=item.index,
                acknowledged_parts=len(resumed_parts),
            )

        def part_done(part_index: int, part_bytes: int, _file_id: int):
            if journal:
                journal.append(
                    "part_acked",
                    index=item.index,
                    part_index=part_index,
                    part_bytes=part_bytes,
                )

        handle = await fast_upload_file(
            client,
            path,
            workers=part_workers,
            file_name=os.path.basename(path),
            progress_callback=cb,
            upload_policy=upload_policy,
            upload_id=upload_id,
            part_done_callback=part_done,
            acknowledged_parts=resumed_parts,
        )
        if journal:
            journal.append("upload_parts_done", critical=True, index=item.index, size=item.size)
        return handle


async def _send_one(
    client: TelegramClient,
    entity,
    item: StudioItem,
    opts: StudioOptions,
    agg: ProgressAgg,
    uploaded_handle=None,
    part_workers: int = 6,
    upload_path: Optional[str] = None,
    dup_checker: Optional[Any] = None,
    registered_media: Optional[RegisteredMedia] = None,
    transfer_id: str = "",
    journal: Optional[TransferJournal] = None,
    session_key_hash: str = "",
) -> StudioItem:
    """Sequential stage: commit message to chat (order-safe)."""
    t0 = time.time()
    send_path = upload_path or item.path
    final_file_name = _final_name(item, send_path)
    
    item.status = "uploading"
    emit_event(
        "StudioItemStarted",
        index=item.index,
        path=final_file_name,
        size=item.size,
    )

    caption = _align_caption_with_sent_file(
        (item.caption or opts.global_caption or "").strip(),
        item,
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
    if is_video and registered_media is None:
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

    # Always generate APK thumbnails for any APK file to show app icon
    is_apk = send_path.lower().endswith(".apk")
    if is_apk and registered_media is None:
        thumb_path = send_path + ".thumb.png"
        try:
            if os.path.isfile(thumb_path):
                try:
                    os.remove(thumb_path)
                except OSError:
                    pass
            success = await asyncio.to_thread(_extract_apk_icon, send_path, thumb_path)
            if success and os.path.isfile(thumb_path) and os.path.getsize(thumb_path) > 0:
                thumb_handle = await client.upload_file(thumb_path)
                send_kwargs["thumb"] = thumb_handle
        except Exception as e:
            emit_event("LogEvent", level="WARNING", message=f"Failed to generate APK thumbnail: {e}")
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
    async def _check_recent_sent():
        try:
            # Iterate over the last 5 messages in the channel/chat
            async for msg in client.iter_messages(entity, limit=5):
                if msg.date and (time.time() - msg.date.timestamp() < 120):
                    if msg.media and msg.file:
                        m_name = msg.file.name
                        m_size = msg.file.size
                        if m_name == final_file_name:
                            if not item.size or m_size == item.size:
                                emit_event("LogEvent", level="INFO", message=f"Detected duplicate message already sent on Telegram: message_id {msg.id}")
                                return msg
        except Exception as e:
            emit_event("LogEvent", level="DEBUG", message=f"Failed to check recent sent: {e}")
        return None

    try:
        async def _send_with_retry(send_func, *args, **kwargs):
            import sqlite3 as _sqlite3
            db_lock_attempts = 0
            retries = 0
            while True:
                try:
                    if not client.is_connected():
                        emit_event("LogEvent", level="INFO", message="Telegram client disconnected before commit, reconnecting...")
                        await client.connect()
                    return await send_func(*args, **kwargs)
                except FloodWaitError as e:
                    wait_seconds = int(e.seconds)
                    emit_event("FloodWait", seconds=wait_seconds, index=item.index)
                    total_wait = wait_seconds + 2
                    for remaining in range(total_wait, 0, -5):
                        emit_event("FloodWaitTick", remaining=remaining, total=total_wait, index=item.index)
                        await asyncio.sleep(min(5, remaining))
                    emit_event("FloodWaitResolved", status="RESUMING", index=item.index)
                    kwargs.pop("spoiler", None)
                except _sqlite3.OperationalError as e:
                    if "locked" in str(e).lower() and db_lock_attempts < 8:
                        db_lock_attempts += 1
                        await asyncio.sleep(0.5 + db_lock_attempts * 0.4)
                        continue
                    raise
                except (OSError, asyncio.CancelledError, Exception) as e:
                    if isinstance(e, asyncio.CancelledError):
                        raise
                    # Before retrying, check if it was actually already sent
                    recent_msg = await _check_recent_sent()
                    if recent_msg:
                        return recent_msg
                    retries += 1
                    if retries > 3:
                        raise
                    wait_time = 2 * retries
                    emit_event("LogEvent", level="WARNING", message=f"Commit error: {e}. Reconnect & retry {retries}/3 in {wait_time}s...")
                    try:
                        await client.disconnect()
                    except Exception:
                        pass
                    await asyncio.sleep(wait_time)
                    try:
                        await client.connect()
                    except Exception as conn_err:
                        emit_event("LogEvent", level="WARNING", message=f"Reconnect failed: {conn_err}")

        if registered_media is not None:
            if journal is None:
                journal = TransferJournal(transfer_id or f"transfer-{int(time.time())}")
            msg = await _commit_registered_media(
                client,
                entity,
                item,
                opts,
                registered_media,
                journal=journal,
            )
        elif uploaded_handle is not None:
            # Compatibility path: register the existing uploaded handle first.
            # Never fall back to fast_send_file(path), which retransmits all bytes.
            if journal is None:
                journal = TransferJournal(transfer_id or f"transfer-{int(time.time())}")
            registered_media = await _register_uploaded_handle(
                client,
                entity,
                item,
                opts,
                uploaded_handle,
                send_path,
                transfer_id=transfer_id or journal.transfer_id,
                journal=journal,
            )
            msg = await _commit_registered_media(
                client,
                entity,
                item,
                opts,
                registered_media,
                journal=journal,
            )
        else:
            msg = await _send_with_retry(
                fast_send_file,
                client,
                entity,
                send_path,
                workers=part_workers,
                progress_callback=cb,
                **send_kwargs
            )

        mid = _message_id_from_send_result(msg)
        # Terminal success once Telegram accepted the message — never flip to failed
        # because of post-commit bookkeeping (progress emit, thumb cleanup, etc.).
        apply_item_commit_success(item, mid, duration_s=round(time.time() - t0, 3))
        # Copy the still-live generated thumbnail to local cache before cleanup.
        if mid and registered_media is not None and registered_media.thumb_path:
            try:
                from engine.drive_fs import THUMB_DIR, THUMB_LITE_TAG
                import shutil

                raw_peer_id = utils.get_peer_id(entity)
                fk = "home" if raw_peer_id is None else str(int(raw_peer_id))
                cache_key = f"{fk}_{int(mid)}"

                thumb_candidate = registered_media.thumb_path
                if os.path.isfile(thumb_candidate) and os.path.getsize(thumb_candidate) > 0:
                    os.makedirs(THUMB_DIR, exist_ok=True)
                    for q in ["saver", "balanced", "sharp"]:
                        dest_path = os.path.join(THUMB_DIR, f"{cache_key}.{q}.{THUMB_LITE_TAG}.jpg")
                        shutil.copy2(thumb_candidate, dest_path)
            except Exception as cache_err:
                emit_event("LogEvent", level="WARNING", message=f"Failed to cache uploaded thumb: {cache_err}")

        if dup_checker is not None and mid:
            try:
                dup_checker.log(
                    file_unique_id=None,
                    target_message_id=mid,
                    file_hash=None,
                    file_name=final_file_name,
                    file_size=item.size
                )
            except Exception as dup_err:
                emit_event("LogEvent", level="WARNING", message=f"Failed to log duplicate: {dup_err}")
        try:
            agg.on_item(item.index, item.size or 0, item.size or 0, force=True)
        except Exception:
            pass
        try:
            drive_file = None
            try:
                from engine.drive_fs import message_to_drive_file

                drive_file = message_to_drive_file(msg, int(utils.get_peer_id(entity)))
                if drive_file is not None:
                    drive_file["topic_id"] = int(opts.topic_id or opts.reply_to or 0) or None
            except Exception as dto_err:
                emit_event("LogEvent", level="WARNING", message=f"Committed card metadata failed: {dto_err}")
            if journal is not None:
                journal.append(
                    "committed",
                    critical=True,
                    index=item.index,
                    item_id=item.item_id,
                    message_id=mid,
                    media_identity=(registered_media.media_identity if registered_media else ""),
                )
            emit_event(
                "StudioItemDone",
                index=item.index,
                message_id=mid,
                duration_s=item.duration_s,
                avg_mb_s=item.avg_mb_s,
                status="done",
            )
            emit_event(
                "StudioItemCommitted",
                transfer_id=transfer_id,
                item_id=item.item_id,
                index=item.index,
                message_id=mid,
                session_key_hash=session_key_hash,
                peer_id=int(utils.get_peer_id(entity)),
                topic_id=int(opts.topic_id or opts.reply_to or 0) or None,
                file=drive_file,
                thumb_data_url=(registered_media.thumb_data_url if registered_media else None),
                committed_at=int(time.time() * 1000),
                verified=True,
            )
        except Exception as emit_err:
            emit_event(
                "LogEvent",
                level="WARNING",
                message=f"StudioItemDone emit after success: {emit_err}",
            )
    except AmbiguousCommitError as e:
        item.duration_s = round(time.time() - t0, 3)
        item.status = "needs_verification"
        item.error = str(e)
        if journal is not None:
            journal.append(
                "needs_verification",
                critical=True,
                index=item.index,
                item_id=item.item_id,
                error=str(e),
            )
        emit_event(
            "StudioItemDone",
            index=item.index,
            status="needs_verification",
            error=str(e),
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
            try:
                from engine.debug_log import dlog
                dlog(
                    f"Upload failed for {final_file_name}: {e}",
                    level="ERROR",
                    scope="media_studio",
                    phase="upload_file",
                    error=str(e),
                    file_name=final_file_name,
                    index=item.index,
                )
            except Exception:
                pass
            emit_event("StudioItemDone", index=item.index, status="failed", error=str(e))
    finally:
        # thumb may be InputFile handle, not a path — only unlink real files we created
        try:
            for ext_candidate in (".thumb.jpg", ".thumb.png"):
                thumb_candidate = send_path + ext_candidate
                if os.path.isfile(thumb_candidate):
                    os.remove(thumb_candidate)
        except Exception:
            pass
        if registered_media and registered_media.thumb_path:
            try:
                if os.path.isfile(registered_media.thumb_path):
                    os.remove(registered_media.thumb_path)
            except OSError:
                pass
    return item


async def _send_album(
    client: TelegramClient,
    entity,
    items: List[StudioItem],
    opts: StudioOptions,
    agg: ProgressAgg,
    dup_checker: Optional[Any] = None,
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
            path=_final_name(it, it.path),
            size=it.size,
        )
        it.status = "uploading"
        emit_event("StudioItemStarted", index=it.index, path=_final_name(it, it.path), size=it.size)
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
        import sqlite3 as _sqlite3
        _album_db_lock_attempts = 0
        while True:
            try:
                msg = await client.send_file(
                    entity,
                    paths,
                    **{k: v for k, v in send_kwargs.items() if v is not None},
                )
                break
            except TypeError:
                send_kwargs.pop("spoiler", None)
                msg = await client.send_file(
                    entity,
                    paths,
                    **{k: v for k, v in send_kwargs.items() if v is not None},
                )
                break
            except FloodWaitError as e:
                wait_seconds = int(e.seconds)
                emit_event("FloodWait", seconds=wait_seconds)
                total_wait = wait_seconds + 2
                for remaining in range(total_wait, 0, -5):
                    emit_event("FloodWaitTick", remaining=remaining, total=total_wait)
                    await asyncio.sleep(min(5, remaining))
                emit_event("FloodWaitResolved", status="RESUMING")
                send_kwargs.pop("spoiler", None)
            except _sqlite3.OperationalError as e:
                if "locked" in str(e).lower() and _album_db_lock_attempts < 8:
                    _album_db_lock_attempts += 1
                    await asyncio.sleep(0.5 + _album_db_lock_attempts * 0.4)
                    continue
                raise

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
            if dup_checker is not None and mid:
                try:
                    final_file_name = _final_name(it, it.path)
                    up = getattr(it, "_upload_path", None)
                    if up:
                        final_file_name = _final_name(it, up)
                    dup_checker.log(
                        file_unique_id=None,
                        target_message_id=mid,
                        file_hash=None,
                        file_name=final_file_name,
                        file_size=it.size
                    )
                except Exception as dup_err:
                    emit_event("LogEvent", level="WARNING", message=f"Failed to log duplicate: {dup_err}")
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
            try:
                from engine.debug_log import dlog
                album_fn = _final_name(it, it.path)
                dlog(
                    f"Upload failed for album item {album_fn}: {e}",
                    level="ERROR",
                    scope="media_studio",
                    phase="upload_album",
                    error=str(e),
                    file_name=album_fn,
                    index=it.index,
                )
            except Exception:
                pass
            emit_event("StudioItemDone", index=it.index, status="failed", error=str(e))
    return items


async def _run_fastlane_pipeline(
    client: TelegramClient,
    entity,
    items: List[StudioItem],
    opts: StudioOptions,
    agg: ProgressAgg,
    *,
    upload_policy: Optional[UploadPolicy],
    dup_checker: Any,
    tg_exists: Dict[Tuple[str, int], int],
    transfer_id: str,
    session_key_hash: str,
    journal: TransferJournal,
) -> None:
    """Prioritize item zero, then upload concurrently and commit in order."""
    if not items:
        return
    conc = max(1, min(int(opts.concurrency or 4), 8))
    prepare_slots = _adaptive_prepare_slots(opts, len(items))
    prepare_sem = asyncio.Semaphore(prepare_slots)
    file_sem = asyncio.Semaphore(conc)
    max_item = max((it.size for it in items), default=0)
    part_workers = (
        8 if max_item >= 500 * 1024 * 1024
        else 6 if max_item >= 120 * 1024 * 1024
        else 4 if max_item >= 40 * 1024 * 1024
        else 3 if max_item >= 8 * 1024 * 1024
        else 2
    )
    emit_event(
        "StudioInfo",
        message=f"Fast lane file pertama; pipeline berikutnya {prepare_slots} encode / {conc} upload",
    )

    async def prepare_one(it: StudioItem) -> Tuple[str, Optional[str], int]:
        async with prepare_sem:
            await _wait_if_transfer_paused()
            old_size = it.size or 0
            it.status = "preparing"
            emit_event("StudioItemPhase", index=it.index, phase="preflight")
            journal.append("preflight_start", verbose=True, index=it.index, item_id=it.item_id)

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
                it,
                opts,
                progress_cb=reencode_progress,
                upload_policy=upload_policy,
            )
            if os.path.isfile(upath):
                it.size = os.path.getsize(upath)
                it.fingerprint = await _sha256_file(upath)
            journal.append(
                "preflight_done",
                critical=True,
                index=it.index,
                item_id=it.item_id,
                size=it.size,
                fingerprint=it.fingerprint,
            )
            return upath, tmp, old_size

    def duplicate_id(it: StudioItem, upath: str) -> Optional[int]:
        """Check scan index first (O(1)), then DB, then name+size fallback."""
        if opts.duplicate_policy == "FORCE_UPLOAD":
            return None
        final_name = _final_name(it, upath)
        found = None
        try:
            # Priority 1: Scanner fingerprint index (fast, multi-tier)
            if scanner is not None:
                from engine.fingerprint_engine import MediaFingerprint
                fp = MediaFingerprint.from_local_file(
                    upath or it.path,
                    file_name=final_name,
                    file_size=it.size,
                    sha256=it.fingerprint,
                )
                found_mid = scanner.lookup(fp, strict=False)
                if found_mid:
                    return found_mid
            # Priority 2: DB duplicate_history (SHA-256 + name+size)
            found = dup_checker.get_duplicate_message_id(
                file_hash=it.fingerprint or None,
                file_name=final_name,
                file_size=it.size,
            )
        except Exception:
            pass
        # Priority 3: Legacy tg_exists (name+size fallback)
        if not found:
            found = tg_exists.get((final_name.lower(), it.size))
        return int(found) if found else None

    async def prepare_upload_register(it: StudioItem):
        upath: Optional[str] = None
        tmp: Optional[str] = None
        try:
            upath, tmp, old_size = await prepare_one(it)
            if it.size != old_size:
                agg.adjust_total_bytes(it.size - old_size)
            duplicate = duplicate_id(it, upath)
            if duplicate:
                # Verify the destination message still exists + file accessible
                exists = True
                deleted_at = None
                try:
                    if scanner is not None:
                        # Use resilient client for deep verify
                        from engine.telegram_resilient import TelegramResilientClient as _RC
                        _resilient = _RC(client, str(chat_id), emit_event_fn=emit_event)
                        msgs = await _resilient.get_messages_safe(entity, ids=[duplicate])
                    else:
                        msgs = await client.get_messages(entity, ids=[duplicate])
                    if not msgs or not msgs[0] or getattr(msgs[0], "action", None):
                        exists = False
                        deleted_at = int(time.time())
                except Exception as e:
                    emit_event("LogEvent", level="WARNING",
                               message=f"Gagal verifikasi pesan {duplicate}: {e}")

                if not exists:
                    # File hilang dari destination
                    emit_event("LogEvent", level="INFO",
                               message=f"Pesan {duplicate} tidak ditemukan (dihapus). Re-upload otomatis.")
                    dup_checker.delete_duplicate_by_message_id(duplicate)
                    final_name = _final_name(it, upath)
                    tg_exists.pop((final_name.lower(), it.size), None)
                    # Remove from scanner index too
                    if scanner is not None and it.fingerprint:
                        scanner.index.pop(f"sha256:{it.fingerprint}", None)
                    # Mark item as needing re-upload (not guardrail for fastlane)
                    it.reupload_reason = "deleted_from_destination"
                    it.original_message_id = duplicate
                    it.deleted_at = deleted_at
                    duplicate = None

            if duplicate:
                it.status = "done"
                it.message_id = duplicate
                agg.adjust_total_bytes(-(it.size or 0))
                emit_event(
                    "StudioItemDone",
                    index=it.index,
                    message_id=duplicate,
                    status="skipped",
                    reuploaded=False,
                    skipReason="pre_scan_or_db_match",
                    note=f"Duplikat dilewati — sudah ada di tujuan (pesan {duplicate})",
                )
                journal.append(
                    "duplicate_skipped",
                    critical=True,
                    index=it.index,
                    message_id=duplicate,
                    fingerprint=it.fingerprint,
                )
                return it, upath, tmp, None

            handle = await _upload_bytes(
                client,
                it,
                agg,
                file_sem,
                part_workers=part_workers,
                upload_path=upath,
                upload_policy=upload_policy,
                transfer_id=transfer_id,
                journal=journal,
            )
            registered = await _register_uploaded_handle(
                client,
                entity,
                it,
                opts,
                handle,
                upath,
                transfer_id=transfer_id,
                journal=journal,
            )
            return it, upath, tmp, registered
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            it.status = "failed"
            it.error = str(exc)
            journal.append(
                "item_failed_before_commit",
                critical=True,
                index=it.index,
                item_id=it.item_id,
                error_type=type(exc).__name__,
                error=str(exc),
            )
            emit_event("StudioItemDone", index=it.index, status="failed", error=str(exc))
            return it, upath or it.path, tmp, None

    async def commit_result(result) -> None:
        it, upath, tmp, registered = result
        try:
            if registered is not None and it.status not in {"failed", "done"}:
                await _send_one(
                    client,
                    entity,
                    it,
                    opts,
                    agg,
                    registered_media=registered,
                    upload_path=upath,
                    dup_checker=dup_checker,
                    transfer_id=transfer_id,
                    journal=journal,
                    session_key_hash=session_key_hash,
                )
                if it.status == "done" and it.message_id:
                    try:
                        final_name = _final_name(it, upath or it.path)
                        reupload_reason = getattr(it, "reupload_reason", None)
                        orig_mid       = getattr(it, "original_message_id", None)
                        deleted_at_ts  = getattr(it, "deleted_at", None)
                        dup_checker.log(
                            None,
                            it.message_id,
                            file_hash=it.fingerprint or None,
                            file_name=final_name,
                            file_size=it.size,
                            fingerprint_hash=(
                                f"sha256:{it.fingerprint}" if it.fingerprint else None
                            ),
                        )
                        # Emit reuploaded badge if this was a re-upload
                        if reupload_reason:
                            emit_event(
                                "StudioItemReupload",
                                index=it.index,
                                message_id=it.message_id,
                                originalMessageId=orig_mid,
                                reuploadReason=reupload_reason,
                                deletedAt=deleted_at_ts,
                                reuploadedAt=int(time.time()),
                            )
                    except Exception:
                        pass
                await asyncio.sleep(random.uniform(1.5, 3.0))
        finally:
            if tmp and os.path.isfile(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass

    # The first selected item is fully terminal before later upload tasks exist.
    await commit_result(await prepare_upload_register(items[0]))

    tasks = [
        asyncio.create_task(prepare_upload_register(it), name=f"studio-item-{it.index}")
        for it in items[1:]
    ]
    # Ordered cursor: later tasks may finish first, but cannot commit first.
    for task in tasks:
        await commit_result(await task)


async def _run_safe_album_pipeline(
    client: TelegramClient,
    entity,
    items: List[StudioItem],
    opts: StudioOptions,
    agg: ProgressAgg,
    *,
    upload_policy: Optional[UploadPolicy],
    dup_checker: Any,
    tg_exists: Dict[Tuple[str, int], int],
    transfer_id: str,
    session_key_hash: str,
    journal: TransferJournal,
) -> None:
    """Register album members first, then one stable sendMultiMedia commit."""
    batches: List[List[StudioItem]] = []
    current: List[StudioItem] = []
    current_kind: Optional[str] = None
    for item in items:
        ext = _ext(item.path)
        kind = "photo" if ext in PHOTO_EXTS else ("video" if ext in VIDEO_EXTS else "other")
        if kind == "other":
            if current:
                batches.append(current)
                current = []
                current_kind = None
            batches.append([item])
            continue
        if current and (kind != current_kind or len(current) >= 10):
            batches.append(current)
            current = []
        if not current:
            current_kind = kind
        current.append(item)
    if current:
        batches.append(current)

    sem = asyncio.Semaphore(max(1, min(int(opts.concurrency or 4), 8)))
    max_item = max((item.size for item in items), default=0)
    part_workers = 8 if max_item >= 500 * 1024 * 1024 else 6 if max_item >= 120 * 1024 * 1024 else 4

    for batch_number, batch in enumerate(batches):
        if len(batch) == 1:
            await _run_fastlane_pipeline(
                client,
                entity,
                batch,
                opts,
                agg,
                upload_policy=upload_policy,
                dup_checker=dup_checker,
                tg_exists=tg_exists,
                transfer_id=transfer_id,
                session_key_hash=session_key_hash,
                journal=journal,
            )
            continue

        prepared: List[Tuple[StudioItem, str, Optional[str]]] = []
        for item in batch:
            try:
                item.status = "preparing"
                emit_event("StudioItemPhase", index=item.index, phase="preflight")

                def reencode_progress(data: Dict[str, Any], *, _item=item):
                    event = str(data.get("event") or "progress")
                    payload = {key: value for key, value in data.items() if key != "event"}
                    if event == "started":
                        emit_event("StudioReencodeStarted", index=_item.index, **payload)
                    elif event == "done":
                        emit_event("StudioReencodeDone", index=_item.index, **payload)
                    else:
                        emit_event("StudioReencodeProgress", index=_item.index, **payload)

                old_size = item.size or 0
                upload_path, temp_path = await _prepare_item_path(
                    item,
                    opts,
                    progress_cb=reencode_progress,
                    upload_policy=upload_policy,
                )
                if os.path.isfile(upload_path):
                    item.size = os.path.getsize(upload_path)
                    item.fingerprint = await _sha256_file(upload_path)
                if item.size != old_size:
                    agg.adjust_total_bytes(item.size - old_size)
                final_name = _final_name(item, upload_path)
                duplicate = None
                if opts.duplicate_policy != "FORCE_UPLOAD":
                    try:
                        duplicate = dup_checker.get_duplicate_message_id(
                            file_hash=item.fingerprint or None,
                            file_name=final_name,
                            file_size=item.size,
                        )
                    except Exception:
                        duplicate = None
                    duplicate = duplicate or tg_exists.get((final_name.lower(), item.size))
                if duplicate:
                    exists = True
                    try:
                        msg = await client.get_messages(entity, ids=[int(duplicate)])
                        if not msg or not msg[0] or getattr(msg[0], "action", None):
                            exists = False
                    except Exception as e:
                        emit_event("LogEvent", level="WARNING", message=f"Gagal verifikasi pesan {duplicate} di Telegram: {e}")
                    
                    if not exists:
                        emit_event("LogEvent", level="INFO", message=f"Pesan duplikat {duplicate} tidak ditemukan di Telegram (telah dihapus). Menghapus riwayat dan mengunggah ulang.")
                        dup_checker.delete_duplicate_by_message_id(int(duplicate))
                        tg_exists.pop((final_name.lower(), item.size), None)
                        duplicate = None

                if duplicate:
                    item.status = "done"
                    item.message_id = int(duplicate)
                    agg.adjust_total_bytes(-(item.size or 0))
                    emit_event(
                        "StudioItemDone",
                        index=item.index,
                        message_id=int(duplicate),
                        status="skipped",
                        note=f"Duplikat dilewati — sudah ada di tujuan (pesan {duplicate})",
                    )
                    if temp_path and os.path.isfile(temp_path):
                        os.remove(temp_path)
                    continue
                journal.append(
                    "preflight_done",
                    critical=True,
                    index=item.index,
                    item_id=item.item_id,
                    size=item.size,
                    fingerprint=item.fingerprint,
                    album=batch_number,
                )
                prepared.append((item, upload_path, temp_path))
            except Exception as exc:
                item.status = "failed"
                item.error = str(exc)
                journal.append(
                    "album_member_preflight_failed",
                    critical=True,
                    index=item.index,
                    error_type=type(exc).__name__,
                    error=str(exc),
                )
                emit_event("StudioItemDone", index=item.index, status="failed", error=str(exc))

        if not prepared:
            continue
        if len(prepared) == 1:
            item, upload_path, temp_path = prepared[0]
            try:
                handle = await _upload_bytes(
                    client,
                    item,
                    agg,
                    sem,
                    part_workers=part_workers,
                    upload_path=upload_path,
                    upload_policy=upload_policy,
                    transfer_id=transfer_id,
                    journal=journal,
                )
                registered = await _register_uploaded_handle(
                    client,
                    entity,
                    item,
                    opts,
                    handle,
                    upload_path,
                    transfer_id=transfer_id,
                    journal=journal,
                )
                await _send_one(
                    client,
                    entity,
                    item,
                    opts,
                    agg,
                    registered_media=registered,
                    upload_path=upload_path,
                    dup_checker=dup_checker,
                    transfer_id=transfer_id,
                    journal=journal,
                    session_key_hash=session_key_hash,
                )
            except Exception as exc:
                if item.status not in {"done", "needs_verification"}:
                    item.status = "failed"
                    item.error = str(exc)
                    emit_event("StudioItemDone", index=item.index, status="failed", error=str(exc))
            finally:
                if temp_path and os.path.isfile(temp_path):
                    try:
                        os.remove(temp_path)
                    except OSError:
                        pass
            continue

        async def upload_register(entry: Tuple[StudioItem, str, Optional[str]]):
            item, upload_path, temp_path = entry
            try:
                handle = await _upload_bytes(
                    client,
                    item,
                    agg,
                    sem,
                    part_workers=part_workers,
                    upload_path=upload_path,
                    upload_policy=upload_policy,
                    transfer_id=transfer_id,
                    journal=journal,
                )
                registered = await _register_uploaded_handle(
                    client,
                    entity,
                    item,
                    opts,
                    handle,
                    upload_path,
                    transfer_id=transfer_id,
                    journal=journal,
                )
                return item, upload_path, temp_path, registered, None
            except Exception as exc:
                return item, upload_path, temp_path, None, exc

        # Give the first member the first byte lane; once registered, release
        # the remaining members concurrently while retaining one atomic commit.
        first = await upload_register(prepared[0])
        rest = await asyncio.gather(*(upload_register(entry) for entry in prepared[1:]))
        uploaded = [first, *rest]
        failures = [entry for entry in uploaded if entry[4] is not None or entry[3] is None]
        if failures:
            reason = "Album dibatalkan sebelum commit karena satu anggota gagal; byte tidak diunggah ulang."
            for item, _path, _temp, registered, exc in uploaded:
                if registered and registered.thumb_path and os.path.isfile(registered.thumb_path):
                    try:
                        os.remove(registered.thumb_path)
                    except OSError:
                        pass
                if item.status not in {"done", "failed"}:
                    item.status = "failed"
                    item.error = str(exc or reason)
                    emit_event("StudioItemDone", index=item.index, status="failed", error=item.error)
            journal.append(
                "album_cancelled_before_commit",
                critical=True,
                album=batch_number,
                failed_indexes=[entry[0].index for entry in failures],
            )
        else:
            commit_entries = [(entry[0], entry[3]) for entry in uploaded if entry[3] is not None]
            messages = await _commit_registered_album(
                client, entity, commit_entries, opts, journal=journal
            )
            for (item, registered), message in zip(commit_entries, messages):
                if message is None:
                    item.status = "needs_verification"
                    item.error = "Commit album diterima tanpa bukti pesan lokal; tidak diunggah ulang."
                    emit_event(
                        "StudioItemDone",
                        index=item.index,
                        status="needs_verification",
                        error=item.error,
                    )
                    continue
                message_id = _message_id_from_send_result(message)
                if not message_id:
                    item.status = "needs_verification"
                    item.error = "Telegram tidak mengembalikan message_id album."
                    emit_event("StudioItemDone", index=item.index, status="needs_verification", error=item.error)
                    continue
                apply_item_commit_success(item, message_id)
                agg.on_item(item.index, item.size or 0, item.size or 0, force=True)
                try:
                    dup_checker.log(
                        None,
                        message_id,
                        file_hash=item.fingerprint or None,
                        file_name=registered.final_file_name,
                        file_size=item.size,
                    )
                except Exception:
                    pass
                drive_file = None
                try:
                    from engine.drive_fs import message_to_drive_file

                    drive_file = message_to_drive_file(message, int(utils.get_peer_id(entity)))
                    if drive_file is not None:
                        drive_file["topic_id"] = int(opts.topic_id or opts.reply_to or 0) or None
                except Exception:
                    drive_file = None
                journal.append(
                    "album_member_committed",
                    critical=True,
                    album=batch_number,
                    index=item.index,
                    message_id=message_id,
                    media_identity=registered.media_identity,
                )
                emit_event(
                    "StudioItemDone",
                    index=item.index,
                    message_id=message_id,
                    status="done",
                )
                emit_event(
                    "StudioItemCommitted",
                    transfer_id=transfer_id,
                    item_id=item.item_id,
                    index=item.index,
                    message_id=message_id,
                    session_key_hash=session_key_hash,
                    peer_id=int(utils.get_peer_id(entity)),
                    topic_id=int(opts.topic_id or opts.reply_to or 0) or None,
                    file=drive_file,
                    thumb_data_url=registered.thumb_data_url,
                    committed_at=int(time.time() * 1000),
                    verified=True,
                )

        for _item, _path, temp_path, registered, _exc in uploaded:
            if registered and registered.thumb_path and os.path.isfile(registered.thumb_path):
                try:
                    os.remove(registered.thumb_path)
                except OSError:
                    pass
            if temp_path and os.path.isfile(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass
        await asyncio.sleep(random.uniform(1.5, 3.0))


async def run_ordered_upload(
    client: TelegramClient,
    entity,
    items: List[StudioItem],
    opts: StudioOptions,
    chat_id: str,
    *,
    transfer_id: str = "",
    session_key_hash: str = "",
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
    from engine.duplicate_checker import DuplicateChecker
    from engine.telegram_resilient import TelegramResilientClient
    from engine.smart_scanner import SmartScanner
    from engine.transfer_state_manager import TransferStateManager

    dup_checker = DuplicateChecker(
        chat_id,
        guardrail_enabled=opts.guardrail_enabled,
        guardrail_threshold_days=opts.guardrail_threshold_days,
    )
    transfer_id = transfer_id or f"transfer-{uuid.uuid4().hex}"
    journal = TransferJournal(transfer_id)
    journal.append(
        "transfer_started",
        critical=True,
        item_count=len(items),
        destination=str(chat_id),
        topic_id=opts.topic_id or opts.reply_to,
    )

    # Initialize state manager for resume capability
    state_mgr = TransferStateManager(
        job_id=transfer_id,
        source_path="batch",
        target_entity_id=str(chat_id),
        config={
            "duplicate_policy": opts.duplicate_policy,
            "scan_mode": opts.scan_mode,
            "guardrail_enabled": opts.guardrail_enabled,
            "guardrail_threshold_days": opts.guardrail_threshold_days,
            "topic_scope": opts.topic_scope,
            "max_reupload_per_hour": opts.max_reupload_per_hour,
            "target_topic_id": opts.topic_id or opts.reply_to,
        },
    )
    try:
        state_mgr.create(len(items))
    except Exception:
        pass

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
        transfer_id=transfer_id,
        scanMode=opts.scan_mode,
        debug_log_path=os.path.relpath(journal.path, os.path.dirname(os.path.dirname(__file__))),
        upload_hard_max_bytes=getattr(upload_policy, "hard_max_bytes", None),
        upload_premium=bool(getattr(upload_policy, "premium", False)) if upload_policy else None,
    )

    # ── Enhanced Smart Pre-Scan (replaces old 200-msg limit) ──────────────
    # Build scan index using SmartScanner with adaptive depth and topic filtering.
    # tg_exists kept for backward compatibility with _run_fastlane_pipeline.
    tg_exists = {}
    scanner = None
    if opts.duplicate_policy != "FORCE_UPLOAD":
        try:
            topic_id = opts.topic_id or opts.reply_to
            resilient = TelegramResilientClient(
                client,
                str(chat_id),
                emit_event_fn=emit_event,
            )
            state_mgr.save_scan_started()

            scanner = SmartScanner(
                resilient=resilient,
                entity=entity,
                entity_id=str(chat_id),
                topic_id=int(topic_id) if topic_id else None,
                topic_scope=opts.topic_scope,
                scan_mode=opts.scan_mode,
                emit_fn=emit_event,
                db_cache_fn=lambda: dup_checker.load_scan_cache(
                    topic_id=int(topic_id) if topic_id else None
                ),
                save_cache_fn=dup_checker.upsert_scan_cache,
                job_id=transfer_id,
            )
            await scanner.run()

            # Build legacy tg_exists from scanner's name+size index for backward compat
            tg_exists = {
                key: mid for key, mid in scanner.ns_index.items()
            }

            state_mgr.save_scan_complete(
                scanner.index,
                scanner.stats.to_dict(),
            )
            emit_event(
                "StudioInfo",
                message=(
                    f"Pemindaian selesai: {scanner.stats.total_scanned} pesan dipindai, "
                    f"{len(scanner.index)} entri terindeks, "
                    f"{scanner.stats.db_cached_loaded} dari cache DB."
                ),
                scanStats=scanner.stats.to_dict(),
            )
        except Exception as recon_err:
            emit_event(
                "LogEvent",
                level="WARNING",
                message=f"Pemindaian destination gagal (fallback ke DB only): {recon_err}",
            )

    # Safety takes precedence over the legacy client.send_file(album) path,
    # which can retransmit every member after an ambiguous failure. Until the
    # raw sendMultiMedia journal is fully verifiable, album selections use the
    # same reusable-media ordered pipeline as ordinary batches.
    if opts.group_as_album:
        emit_event(
            "StudioInfo",
            message="Mode album aman: commit berurutan tanpa upload ulang otomatis.",
        )

    if opts.group_as_album:
        await _run_safe_album_pipeline(
            client,
            entity,
            items,
            opts,
            agg,
            upload_policy=upload_policy,
            dup_checker=dup_checker,
            tg_exists=tg_exists,
            transfer_id=transfer_id,
            session_key_hash=session_key_hash,
            journal=journal,
        )
    # Legacy album sender retained as reference only; it is intentionally unreachable.
    elif False:
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
                    # CHECK DUPLICATE HERE!
                    final_file_name = _final_name(it, upath)
                    dup_mid = None
                    if opts.duplicate_policy != "FORCE_UPLOAD":
                        try:
                            dup_mid = dup_checker.get_duplicate_message_id(file_name=final_file_name, file_size=it.size)
                        except Exception:
                            pass
                            
                        if not dup_mid and (final_file_name.lower(), it.size) in tg_exists:
                            dup_mid = tg_exists[(final_file_name.lower(), it.size)]
                            try:
                                dup_checker.log(None, dup_mid, file_name=final_file_name, file_size=it.size)
                            except Exception:
                                pass
                    if dup_mid:
                        exists = True
                        try:
                            msg = await client.get_messages(entity, ids=[dup_mid])
                            if not msg or not msg[0] or getattr(msg[0], "action", None):
                                exists = False
                        except Exception as e:
                            emit_event("LogEvent", level="WARNING", message=f"Gagal verifikasi pesan {dup_mid} di Telegram: {e}")
                        
                        if not exists:
                            emit_event("LogEvent", level="INFO", message=f"Pesan duplikat {dup_mid} tidak ditemukan di Telegram (telah dihapus). Menghapus riwayat dan mengunggah ulang.")
                            dup_checker.delete_duplicate_by_message_id(dup_mid)
                            tg_exists.pop((final_file_name.lower(), it.size), None)
                            dup_mid = None

                    if dup_mid:
                        it.status = "done"
                        it.message_id = dup_mid
                        if it.size:
                            agg.adjust_total_bytes(-it.size)
                        emit_event(
                            "StudioItemDone",
                            index=it.index,
                            message_id=dup_mid,
                            status="skipped",
                            note=f"Duplikat dilewati \u2014 sudah ada di tujuan (pesan {dup_mid})"
                        )
                        if tmp and os.path.isfile(tmp):
                            try:
                                os.remove(tmp)
                            except Exception:
                                pass
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
                    client, entity, it0, opts, agg, upload_path=up, dup_checker=dup_checker
                )
                tmp = getattr(it0, "_tmp_path", None)
                if tmp and os.path.isfile(tmp):
                    try:
                        os.remove(tmp)
                    except Exception:
                        pass
                
                # Cooldown delay
                import random
                await asyncio.sleep(random.uniform(1.5, 3.0))
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
                    await _send_album(client, entity, ready_batch, opts, agg, dup_checker=dup_checker)
                finally:
                    for it, op in zip(ready_batch, orig_paths):
                        tmp = getattr(it, "_tmp_path", None)
                        it.path = op
                        if tmp and os.path.isfile(tmp):
                            try:
                                os.remove(tmp)
                            except Exception:
                                pass
                
                # Cooldown delay
                import random
                await asyncio.sleep(random.uniform(1.5, 3.0))
    else:
        await _run_fastlane_pipeline(
            client,
            entity,
            items,
            opts,
            agg,
            upload_policy=upload_policy,
            dup_checker=dup_checker,
            tg_exists=tg_exists,
            transfer_id=transfer_id,
            session_key_hash=session_key_hash,
            journal=journal,
        )
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

        # The fast-lane pipeline above supersedes this legacy scheduler. Keep
        # the old definitions temporarily for compatibility while ensuring it
        # cannot enqueue a second upload/commit pass.
        prepare_tasks = [asyncio.create_task(_prepare_one(it)) for it in []]
        prepared: List[Tuple[StudioItem, str, Optional[str]]] = []

        max_item = max((it.size for it in items), default=0)
        # Dynamic part workers capped at 8 to prevent Telegram connection limits
        part_workers = [
            8 if max_item >= 500 * 1024 * 1024
            else (6 if max_item >= 120 * 1024 * 1024
            else (4 if max_item >= 40 * 1024 * 1024
            else (3 if max_item >= 8 * 1024 * 1024
            else 2)))
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

            # CHECK DUPLICATE HERE!
            final_file_name = _final_name(it, upath)
            dup_mid = None
            if opts.duplicate_policy != "FORCE_UPLOAD":
                try:
                    dup_mid = dup_checker.get_duplicate_message_id(file_name=final_file_name, file_size=it.size)
                except Exception:
                    pass

                if not dup_mid and (final_file_name.lower(), it.size) in tg_exists:
                    dup_mid = tg_exists[(final_file_name.lower(), it.size)]
                    try:
                        dup_checker.log(None, dup_mid, file_name=final_file_name, file_size=it.size)
                    except Exception:
                        pass

            if dup_mid:
                it.status = "done"
                it.message_id = dup_mid
                if it.size:
                    agg.adjust_total_bytes(-it.size)
                emit_event(
                    "StudioItemDone",
                    index=it.index,
                    message_id=dup_mid,
                    status="skipped",
                    note=f"Duplikat dilewati \u2014 sudah ada di tujuan (pesan {dup_mid})"
                )
                prepared.append((it, upath, tmp))
                upload_tasks.append(None)
            else:
                if it.size and it.size != old_sz:
                    agg.adjust_total_bytes(it.size - old_sz)
                prepared.append((it, upath, tmp))
                upload_tasks.append(asyncio.create_task(_upload_adaptive(it, upath)))
        for i, (it, upath, tmp) in enumerate(prepared):
            await _wait_if_transfer_paused()
            if upload_tasks[i] is None:
                # Skipped duplicate! Clean up tmp if it was created
                if tmp and os.path.isfile(tmp):
                    try:
                        os.remove(tmp)
                    except Exception:
                        pass
                continue

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
                dup_checker=dup_checker,
            )
            if tmp and os.path.isfile(tmp):
                try:
                    os.remove(tmp)
                except Exception:
                    pass

            # Cooldown delay
            import random
            await asyncio.sleep(random.uniform(1.5, 3.0))

    done = sum(1 for i in items if i.status == "done")
    failed = sum(1 for i in items if i.status == "failed")
    needs_verification = sum(1 for i in items if i.status == "needs_verification")
    elapsed = max(time.time() - agg.t0, 1e-6)
    result = {
        "status": "ok" if failed == 0 and needs_verification == 0 else ("partial" if done else "error"),
        "transfer_id": transfer_id,
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
        "needs_verification": needs_verification,
        "size_bytes": total_bytes,
        "duration_s": round(elapsed, 3),
        "avg_mb_s": round((total_bytes / (1024 * 1024)) / elapsed, 3),
        "peak_mb_s": round(agg.peak_mb_s, 3),
    }
    emit_event("StudioFinished", **{k: v for k, v in result.items() if k != "items"})
    journal.append(
        "transfer_finished",
        critical=True,
        status=result["status"],
        done=done,
        failed=failed,
        needs_verification=needs_verification,
    )
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

    opts_raw = options or {}
    transfer_id = str(opts_raw.get("transfer_id") or opts_raw.get("transferId") or f"transfer-{uuid.uuid4().hex}")
    session_key_hash = _session_lease_hash(session_name, api_id)
    set_debug_session(transfer_id)
    dlog(
        "media_studio start",
        scope="media_studio",
        phase="start",
        action=action,
        chat_id=str(chat_id),
        files_n=len(files) if isinstance(files, list) else (1 if files else 0),
        debug=is_debug_enabled(),
        transfer_id=transfer_id,
    )
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
        duplicate_policy=str(opts_raw.get("duplicate_policy") or opts_raw.get("duplicatePolicy") or "SKIP"),
        scan_mode=str(opts_raw.get("scan_mode") or opts_raw.get("scanMode") or "smart"),
        guardrail_enabled=bool(opts_raw.get("guardrail_enabled", opts_raw.get("guardrailEnabled", True))),
        guardrail_threshold_days=int(opts_raw.get("guardrail_threshold_days") or opts_raw.get("guardrailThresholdDays") or 7),
        topic_scope=str(opts_raw.get("topic_scope") or opts_raw.get("topicScope") or "selected_plus_general"),
        max_reupload_per_hour=int(opts_raw.get("max_reupload_per_hour") or opts_raw.get("maxReuploadPerHour") or 10),
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

    try:
        # Pre-parse upload items and download URLs BEFORE connecting
        items: List[StudioItem] = []
        if action == "upload":
            if not files:
                raise ValueError("files required for upload")
            # Normalize: single object / path string / list
            if isinstance(files, dict):
                files = [files]
            elif isinstance(files, str):
                files = [{"path": files}]
            elif not isinstance(files, list):
                raise ValueError("files must be a list of {path, caption}")

            for i, f in enumerate(files):
                if isinstance(f, str):
                    path = f
                    caption = ""
                elif isinstance(f, dict):
                    path = f.get("path") or f.get("file") or f.get("Path") or ""
                    caption = str(f.get("caption") or f.get("Caption") or "")
                else:
                    raise ValueError(f"Invalid file entry at index {i}")
                
                path_str = str(path).strip()
                is_url = path_str.startswith("http://") or path_str.startswith("https://")
                if is_url:
                    items.append(
                        StudioItem(
                            index=i,
                            path=path_str,
                            caption=caption,
                            size=0,
                            item_id=f"{transfer_id}:{i}",
                        )
                    )
                else:
                    path = os.path.normpath(path_str)
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
                            item_id=f"{transfer_id}:{i}",
                        )
                    )
            
            # Download remote URLs first (before connecting to Telegram client)
            for it in items:
                if it.path.startswith("http://") or it.path.startswith("https://"):
                    url_temp_path = await _download_remote_url(it)
                    it.path = url_temp_path
                    it.temp_path_to_delete = url_temp_path

        # Connect to Telegram Client
        session_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "sessions")
        session_file = os.path.join(session_dir, session_name)
        # Enable WAL mode + high busy_timeout on Telethon's session SQLite so that
        # concurrent drive-serve reads don't cause "database is locked" during upload.
        _patch_session_wal(session_file)
        # P0: retry connect on SQLite session lock (drive-serve handoff race)
        client = TelegramClient(session_file, int(api_id), str(api_hash), connection_retries=5, auto_reconnect=True)
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
                    _patch_session_wal(session_file)
                    client = TelegramClient(session_file, int(api_id), str(api_hash), connection_retries=5, auto_reconnect=True)
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
            # Speed guard: pure-Python MTProto is extremely slow
            if encryption_backend() == "python":
                emit_event(
                    "StudioWarning",
                    message=(
                        "cryptg/tgcrypto tidak terpasang — enkripsi pure-Python (lambat). "
                        "Jalankan: pip install cryptg"
                    ),
                )
            result = await run_ordered_upload(
                client,
                entity,
                items,
                opts,
                chat_id,
                transfer_id=transfer_id,
                session_key_hash=session_key_hash,
            )
            dlog(
                "media_studio upload finished",
                scope="media_studio",
                phase="done",
                status=result.get("status"),
                done=result.get("done"),
                failed=result.get("failed"),
            )
            return result
        finally:
            try:
                await client.disconnect()
            except Exception:
                pass
    except Exception as e:
        dlog_exc("media_studio failed", e, scope="media_studio", phase="error", action=action)
        err = {"status": "error", "error": str(e), "mode": action}
        emit_event("StudioFailed", error=str(e))
        print(f"[JSON_OUTPUT]{json.dumps(err, default=str)}", flush=True)
        # Cleanup any downloaded temp files if we failed before they got cleaned up
        if action == "upload" and 'items' in locals():
            for it in items:
                if getattr(it, "temp_path_to_delete", None) and os.path.exists(it.temp_path_to_delete):
                    try:
                        os.remove(it.temp_path_to_delete)
                    except Exception:
                        pass
        raise
