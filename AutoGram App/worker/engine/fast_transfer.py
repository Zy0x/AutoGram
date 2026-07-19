"""
High-throughput Telegram file transfer helpers.

Telethon's default upload_file / download_media often send/receive parts
strictly sequentially (~one RTT each). For large media this caps speed far
below the link. We transfer many parts concurrently via SaveFilePart /
GetFile while staying Telegram-safe (single file_id / location).
"""
from __future__ import annotations

import asyncio
import hashlib
import mmap
import os
import random
import threading
import time
from engine.media_stream import has_active_streams

class GhostThrottler:
    """
    Throttle adaptif untuk upload saat ghost stream aktif.
    Tidak menggunakan sleep statis - dinamis berdasarkan kondisi.
    """
    def __init__(self):
        self.stream_was_active = False
        self.fast_chunk_streak = 0
        self.last_flood_wait = 0.0
        
    def get_delay(self) -> float:
        """
        Returns: delay dalam detik (0.0 = tidak perlu delay)
        """
        stream_active = has_active_streams()
        
        if not stream_active:
            self.stream_was_active = False
            self.fast_chunk_streak = 0
            return 0.0
        
        # Stream baru saja aktif
        if not self.stream_was_active:
            self.stream_was_active = True
            self.fast_chunk_streak = 0
            return 0.0  # Chunk pertama tanpa delay
        
        self.fast_chunk_streak += 1
        
        # Jika baru kena flood wait (< 30 detik lalu), hati-hati
        if time.time() - self.last_flood_wait < 30.0:
            return 0.12
        
        # Streak-based delay: semakin banyak chunk berturut, semakin lama jeda
        if self.fast_chunk_streak <= 2:
            return 0.0
        elif self.fast_chunk_streak <= 5:
            return 0.03
        elif self.fast_chunk_streak <= 10:
            return 0.06
        else:
            return 0.10  # Max delay 100ms
        
    def record_flood_wait(self, seconds: int):
        self.last_flood_wait = time.time()
        self.fast_chunk_streak = 0
        
    def reset_streak(self):
        self.fast_chunk_streak = 0

_ghost_throttler = GhostThrottler()

def get_ghost_throttler() -> GhostThrottler:
    return _ghost_throttler

from dataclasses import dataclass
from typing import Callable, Optional

from telethon import TelegramClient, utils
from telethon.errors import FloodWaitError
from telethon.tl.functions.upload import (
    GetFileRequest,
    SaveBigFilePartRequest,
    SaveFilePartRequest,
)
from telethon.tl.functions.help import GetAppConfigRequest
from telethon.tl.types import InputFile, InputFileBig

try:
    # FLOOD_PREMIUM_WAIT_X is a sibling of FloodWaitError (both derive from
    # FloodError), not a subclass of it in Telethon 1.44.
    from telethon.errors import FloodPremiumWaitError
except ImportError:  # pragma: no cover - compatibility with older Telethon
    FloodPremiumWaitError = None  # type: ignore[assignment]

_UPLOAD_FLOOD_ERRORS = (FloodWaitError,)
if FloodPremiumWaitError is not None:
    _UPLOAD_FLOOD_ERRORS = (FloodWaitError, FloodPremiumWaitError)

# Telegram hard max part size
MAX_PART_KB = 512
MAX_PART_BYTES = MAX_PART_KB * 1024
# Files larger than this use "big file" upload API
BIG_FILE_THRESHOLD = 10 * 1024 * 1024
# Prefer concurrent multi-part above this size
CONCURRENT_MIN_BYTES = 256 * 1024

ProgressCB = Optional[Callable[[int, int], None]]
PartDoneCB = Optional[Callable[[int, int, int], None]]
_UPLOAD_LIMIT_CACHE = {}
_UPLOAD_LIMIT_CACHE_TTL_SECONDS = 600.0
DEFAULT_UPLOAD_MAX_PARTS = 4000
PREMIUM_UPLOAD_MAX_PARTS = 8000


@dataclass(frozen=True)
class UploadPolicy:
    """Server-derived upload policy for exactly one Telegram account tier."""

    premium: bool
    max_parts: int
    hard_max_bytes: int
    safe_max_bytes: int
    source: str
    account_verified: bool = True


def _fmt_bytes_human(n: int) -> str:
    n = int(n or 0)
    if n >= 1024**3:
        return f"{n / (1024**3):.2f} GB"
    if n >= 1024**2:
        return f"{n / (1024**2):.1f} MB"
    if n >= 1024:
        return f"{n / 1024:.0f} KB"
    return f"{n} B"


class UploadLimitExceeded(ValueError):
    """Raised before any bytes are sent when a file cannot fit the account."""

    def __init__(self, file_size: int, policy: UploadPolicy, part_count: int):
        self.file_size = int(file_size)
        self.policy = policy
        self.part_count = int(part_count)
        tier = "Premium" if policy.premium else "standar (non-Premium)"
        super().__init__(
            "File terlalu besar untuk batas akun Telegram "
            f"{tier} saat ini ({_fmt_bytes_human(self.file_size)} / {self.part_count} part > "
            f"{_fmt_bytes_human(policy.hard_max_bytes)} / {policy.max_parts} part; "
            f"limit={policy.hard_max_bytes} byte). "
            "Video: pilih High Quality/Smart agar AutoGram menekan bitrate encode di bawah limit; "
            "file non-video: pecah file atau unggah dengan akun Premium. "
            f"(sumber limit: {policy.source})"
        )


def _policy_from_parts(
    *, premium: bool, max_parts: int, source: str, account_verified: bool = True
) -> UploadPolicy:
    parts = max(1, int(max_parts or 0))
    hard = parts * MAX_PART_BYTES
    # Keep a small deterministic encode margin for mux/bitrate variance while
    # still using >99% of the official limit. Raw passthrough may use `hard`.
    margin = max(8 * 1024 * 1024, int(hard * 0.005))
    margin = ((margin + MAX_PART_BYTES - 1) // MAX_PART_BYTES) * MAX_PART_BYTES
    safe = max(MAX_PART_BYTES, hard - margin)
    return UploadPolicy(
        premium=bool(premium),
        max_parts=parts,
        hard_max_bytes=hard,
        safe_max_bytes=safe,
        source=str(source or "fallback"),
        account_verified=bool(account_verified),
    )


def _is_nonretryable_file_parts_error(exc: BaseException) -> bool:
    if isinstance(exc, UploadLimitExceeded):
        return True
    text = f"{type(exc).__name__} {exc}".lower()
    return any(
        marker in text
        for marker in (
            "filepartsinvalid",
            "file_parts_invalid",
            "file parts is invalid",
            "file terlalu besar untuk batas akun telegram",
            "telegram menolak jumlah part file",
        )
    )


def _json_config_number_optional(config, key: str) -> Optional[int]:
    try:
        for pair in getattr(config, "value", []) or []:
            if getattr(pair, "key", None) != key:
                continue
            value = getattr(getattr(pair, "value", None), "value", None)
            number = int(float(value))
            return number if number > 0 else None
    except Exception:
        pass
    return None


def _json_config_number(config, key: str, fallback: int) -> int:
    value = _json_config_number_optional(config, key)
    return int(value) if value is not None else int(fallback)


async def resolve_upload_policy(
    client: TelegramClient, *, force_refresh: bool = False
) -> UploadPolicy:
    """
    Resolve the live app-config limit for the currently authenticated account.

    Cache keys use the Telegram account id plus Premium state. A session path is
    deliberately not used: a session file can be replaced/re-authorized and must
    never carry the old account's tier into a new login.
    """
    premium = False
    account_id = 0
    account_verified = False
    try:
        me = await client.get_me()
        account_id = int(getattr(me, "id", 0) or 0)
        premium = bool(getattr(me, "premium", False))
        account_verified = account_id > 0
    except _UPLOAD_FLOOD_ERRORS as exc:
        await asyncio.sleep(min(max(int(getattr(exc, "seconds", 1) or 1), 1), 30))
    except Exception:
        # Fail closed to the standard tier. Do not cache an unverified identity.
        pass

    cache_key = (account_id, premium) if account_verified else None
    now = asyncio.get_running_loop().time()
    if cache_key is not None and not force_refresh:
        cached = _UPLOAD_LIMIT_CACHE.get(cache_key)
        if cached and cached[0] > now - _UPLOAD_LIMIT_CACHE_TTL_SECONDS:
            return cached[1]

    fallback = PREMIUM_UPLOAD_MAX_PARTS if premium else DEFAULT_UPLOAD_MAX_PARTS
    key = "upload_max_fileparts_premium" if premium else "upload_max_fileparts_default"
    max_parts = fallback
    source = "fallback-premium" if premium else "fallback-default"
    try:
        app = await client(GetAppConfigRequest(hash=0))
        config = getattr(app, "config", None)
        dynamic = _json_config_number_optional(config, key)
        if dynamic is not None:
            max_parts = dynamic
            source = "app-config"
    except _UPLOAD_FLOOD_ERRORS as exc:
        await asyncio.sleep(min(max(int(getattr(exc, "seconds", 1) or 1), 1), 30))
    except Exception:
        pass

    policy = _policy_from_parts(
        premium=premium,
        max_parts=max_parts,
        source=source,
        account_verified=account_verified,
    )
    if cache_key is not None:
        _UPLOAD_LIMIT_CACHE[cache_key] = (now, policy)
    return policy


async def _telegram_upload_part_limit(client: TelegramClient) -> int:
    """Backward-compatible integer accessor used by older call sites/tests."""
    return int((await resolve_upload_policy(client)).max_parts)


def preflight_upload_size(file_size: int, policy: UploadPolicy) -> int:
    """Return the 512-KiB part count, or fail before any upload request."""
    size = int(file_size or 0)
    if size <= 0:
        raise ValueError("empty file")
    part_count = (size + MAX_PART_BYTES - 1) // MAX_PART_BYTES
    if size >= BIG_FILE_THRESHOLD and part_count > int(policy.max_parts):
        raise UploadLimitExceeded(size, policy, part_count)
    return part_count


def _optimal_part_size(file_size: int) -> int:
    """Largest valid part size (bytes), multiple of 1KB, ≤ 512KB."""
    return MAX_PART_KB * 1024


def _workers_for_size(file_size: int, requested: int = 0) -> int:
    """Concurrent part workers. Cap high enough for high-latency links."""
    # Multi-GB single-file uploads benefit from more in-flight MTProto parts
    # (RTT-bound). Cap at 48 to avoid flooding the DC / client too hard.
    hard_cap = 48
    if requested and requested > 0:
        return max(1, min(int(requested), hard_cap))
    mb = file_size / (1024 * 1024)
    if mb < 0.5:
        return 2
    if mb < 2:
        return 4
    if mb < 8:
        return 8
    if mb < 40:
        return 12
    if mb < 120:
        return 16
    if mb < 500:
        return 24
    if mb < 1500:
        return 36
    return 48


async def _call_with_flood(client_or_sender, request, *, retries: int = 8):
    """
    Invoke MTProto request with FloodWait backoff.
    `client_or_sender` may be TelegramClient or an exported media-DC sender.
    Handles FloodWaitError infinitely and safely, emitting tick events for UI countdown.
    """
    attempt = 0
    while True:
        try:
            return await client_or_sender(request)
        except _UPLOAD_FLOOD_ERRORS as e:
            wait_seconds = int(getattr(e, "seconds", 1) or 1)
            try:
                get_ghost_throttler().record_flood_wait(wait_seconds)
            except Exception:
                pass
            total_wait = wait_seconds + 2
            try:
                from engine.events import emit_event

                emit_event(
                    "FloodWait",
                    seconds=wait_seconds,
                    premium_throttle=bool(
                        FloodPremiumWaitError is not None
                        and isinstance(e, FloodPremiumWaitError)
                    ),
                )
            except Exception:
                pass

            # Countdown sleep loop: emit progress tick every 5 seconds
            for remaining in range(total_wait, 0, -5):
                try:
                    from engine.events import emit_event
                    emit_event(
                        "FloodWaitTick",
                        remaining=remaining,
                        total=total_wait
                    )
                except Exception:
                    pass
                await asyncio.sleep(min(5, remaining))

            try:
                from engine.events import emit_event
                emit_event(
                    "FloodWaitResolved",
                    status="RESUMING"
                )
            except Exception:
                pass
        except Exception as e:
            # Transient network / timeout — short retry
            msg = str(e).lower()
            if attempt < retries - 1 and any(
                x in msg for x in ("timeout", "connection", "reset", "broken pipe", "server closed")
            ):
                attempt += 1
                await asyncio.sleep(0.4 + attempt * 0.35)
                continue
            raise


def encryption_backend() -> str:
    try:
        import cryptg  # noqa: F401

        return "cryptg"
    except Exception:
        pass
    try:
        import tgcrypto  # noqa: F401

        return "tgcrypto"
    except Exception:
        return "python"


async def fast_upload_file(
    client: TelegramClient,
    path: str,
    *,
    workers: int = 0,
    part_size_kb: int = MAX_PART_KB,
    file_name: Optional[str] = None,
    progress_callback: ProgressCB = None,
    upload_policy: Optional[UploadPolicy] = None,
    upload_id: Optional[int] = None,
    part_done_callback: PartDoneCB = None,
    acknowledged_parts: Optional[set[int]] = None,
) -> object:
    """
    Upload a local file with concurrent part workers when beneficial.
    Always prefer multi-part concurrency for files ≥ CONCURRENT_MIN_BYTES
    (even with cryptg) — high-latency links gain more from parallelism than
    from a single native sequential stream.
    """
    if not path or not os.path.isfile(path):
        raise FileNotFoundError(path)

    file_size = os.path.getsize(path)
    if file_size <= 0:
        raise ValueError("empty file")

    part_size_kb = max(32, min(int(part_size_kb or MAX_PART_KB), MAX_PART_KB))
    if file_size >= BIG_FILE_THRESHOLD:
        part_size_kb = MAX_PART_KB

    n_workers = _workers_for_size(file_size, workers)

    # Tiny files: native path has less overhead
    if file_size < CONCURRENT_MIN_BYTES:
        return await client.upload_file(
            path,
            part_size_kb=part_size_kb,
            file_name=file_name or os.path.basename(path),
            progress_callback=progress_callback,
        )

    part_size = part_size_kb * 1024
    part_count = (file_size + part_size - 1) // part_size
    is_big = file_size >= BIG_FILE_THRESHOLD
    if is_big:
        policy = upload_policy or await resolve_upload_policy(client)
        # Big uploads are forced to Telegram's largest legal part size above,
        # so the pure 512-KiB plan is identical to the request plan below.
        part_count = preflight_upload_size(file_size, policy)
    # A stable upload id keeps acknowledged part indexes reusable across
    # reconnects. Callers may persist it in the transfer safety journal.
    file_id = int(upload_id or random.randrange(1, 2**63 - 1))
    name = file_name or os.path.basename(path) or "file"

    acknowledged = {int(i) for i in (acknowledged_parts or set()) if 0 <= int(i) < part_count}
    transferred = sum(
        max(0, min(part_size, file_size - index * part_size)) for index in acknowledged
    )
    lock = asyncio.Lock()
    next_idx = 0
    idx_lock = asyncio.Lock()

    if not is_big:
        # MD5 can take seconds on multi‑MB files — report progress so UI is not stuck at 0%
        def _hash():
            h = hashlib.md5()
            done = 0
            with open(path, "rb") as f:
                while True:
                    chunk = f.read(1024 * 1024)
                    if not chunk:
                        break
                    h.update(chunk)
                    done += len(chunk)
                    if progress_callback and file_size > 0:
                        try:
                            # Cap hash phase under 5% of bar so real upload still dominates
                            pseudo = max(1, int(file_size * 0.05 * (done / file_size)))
                            progress_callback(pseudo, file_size)
                        except Exception:
                            pass
            return h.digest()

        md5_digest = await asyncio.to_thread(_hash)
        if progress_callback:
            try:
                progress_callback(max(1, int(file_size * 0.05)), file_size)
            except Exception:
                pass
    else:
        md5_digest = None

    # Single mmap / file mapping: avoid open+seek per part (major Windows stall).
    # Worker pool (not gather-all-parts) keeps concurrent disk reads ≤ n_workers.
    mm_holder: dict = {"mm": None, "fh": None}
    read_lock = threading.Lock()

    def _open_reader():
        fh = open(path, "rb")
        try:
            mm_holder["mm"] = mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ)
            mm_holder["fh"] = fh
        except Exception:
            # Sparse / empty / unsupported — fall back to plain handle
            mm_holder["mm"] = None
            mm_holder["fh"] = fh

    def _close_reader():
        mm = mm_holder.get("mm")
        fh = mm_holder.get("fh")
        try:
            if mm is not None:
                mm.close()
        except Exception:
            pass
        try:
            if fh is not None:
                fh.close()
        except Exception:
            pass
        mm_holder["mm"] = None
        mm_holder["fh"] = None

    def _read_part(idx: int) -> bytes:
        start = idx * part_size
        end = min(start + part_size, file_size)
        if end <= start:
            return b""
        mm = mm_holder.get("mm")
        if mm is not None:
            # mmap concurrent reads are safe; slice copies the part bytes
            return mm[start:end]
        fh = mm_holder.get("fh")
        if fh is None:
            with open(path, "rb") as f:
                f.seek(start)
                return f.read(end - start)
        with read_lock:
            fh.seek(start)
            return fh.read(end - start)

    await asyncio.to_thread(_open_reader)

    async def worker():
        nonlocal transferred, next_idx
        while True:
            async with idx_lock:
                if next_idx >= part_count:
                    return
                idx = next_idx
                next_idx += 1
            if idx in acknowledged:
                continue
            data = await asyncio.to_thread(_read_part, idx)
            if not data:
                continue

            # Adaptive Ghost Throttler: throttle uploads if user is previewing/streaming media
            try:
                throttler = get_ghost_throttler()
                delay = throttler.get_delay()
                if delay > 0:
                    await asyncio.sleep(delay)
            except Exception:
                pass

            start_time = time.time()
            try:
                if is_big:
                    req = SaveBigFilePartRequest(file_id, idx, part_count, data)
                else:
                    req = SaveFilePartRequest(file_id, idx, data)
                await _call_with_flood(client, req)
                
                # If latency is high (> 2.0s), reset streak to slow down
                if (time.time() - start_time) > 2.0:
                    try:
                        get_ghost_throttler().reset_streak()
                    except Exception:
                        pass
            except Exception:
                try:
                    get_ghost_throttler().reset_streak()
                except Exception:
                    pass
                raise
            if part_done_callback:
                try:
                    part_done_callback(idx, len(data), file_id)
                except Exception:
                    pass
            async with lock:
                transferred += len(data)
                if progress_callback:
                    try:
                        progress_callback(transferred, file_size)
                    except Exception:
                        pass

    try:
        await asyncio.gather(*(worker() for _ in range(max(1, n_workers))))
    except Exception as exc:
        if _is_nonretryable_file_parts_error(exc):
            raise RuntimeError(
                "Telegram menolak jumlah part file. AutoGram menghentikan fallback agar tidak "
                "mengunggah ulang gigabyte yang sama; aktifkan High Quality/Smart untuk video besar."
            ) from exc
        # Never fall back to client.upload_file here: it allocates a new file id
        # and retransmits every acknowledged part, wasting the user's quota.
        raise RuntimeError(
            "Upload part terhenti setelah retry aman. AutoGram tidak mengunggah ulang file dari awal; "
            "silakan retry manual setelah koneksi stabil."
        ) from exc
    finally:
        await asyncio.to_thread(_close_reader)

    if is_big:
        return InputFileBig(id=file_id, parts=part_count, name=name)
    return InputFile(id=file_id, parts=part_count, name=name, md5_checksum=md5_digest.hex())


def _generate_local_thumb(path: str) -> Optional[str]:
    """
    Generate a local thumbnail JPEG for the given file (image or video)
    and return the path to the generated JPEG.
    """
    import os
    import tempfile
    
    ext = os.path.splitext(path)[1].lower()
    IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
    VIDEO_EXTS = {".mp4", ".mkv", ".avi", ".mov", ".flv", ".webm", ".3gp", ".m4v"}
    
    if ext not in IMAGE_EXTS and ext not in VIDEO_EXTS:
        return None
        
    try:
        # Create a temp file for output jpeg
        fd, out_path = tempfile.mkstemp(suffix=".jpg")
        os.close(fd)
        
        # If it's an image, use PIL to resize it under 90KB and max 320px
        if ext in IMAGE_EXTS:
            from PIL import Image
            with Image.open(path) as img:
                img.thumbnail((320, 320))
                if img.mode not in ("RGB", "L"):
                    img = img.convert("RGB")
                img.save(out_path, "JPEG", quality=85)
            return out_path
            
        # If it's a video, use _ffmpeg_frame_from_file_sync to extract first frame
        if ext in VIDEO_EXTS:
            from engine.drive_fs import _ffmpeg_frame_from_file_sync
            res = _ffmpeg_frame_from_file_sync(path, out_path, max_edge=320, partial=False)
            if res and os.path.isfile(out_path) and os.path.getsize(out_path) > 0:
                return out_path
    except Exception as e:
        try:
            print(f"[fast_transfer] _generate_local_thumb failed for {path}: {e}", flush=True)
        except Exception:
            pass
            
    # Cleanup if failed
    try:
        if os.path.isfile(out_path):
            os.remove(out_path)
    except Exception:
        pass
    return None


async def fast_send_file(
    client: TelegramClient,
    entity,
    path: str,
    *,
    workers: int = 0,
    progress_callback: ProgressCB = None,
    upload_policy: Optional[UploadPolicy] = None,
    **send_kwargs,
):
    """
    Upload with parallel parts then send_file with the handle (no second upload).
    Falls back to client.send_file if parallel path fails.
    """
    local_thumb = None
    try:
        local_thumb = _generate_local_thumb(path)
    except Exception:
        pass

    try:
        if local_thumb and "thumb" not in send_kwargs:
            send_kwargs["thumb"] = local_thumb

        file_size = os.path.getsize(path)
        if file_size < CONCURRENT_MIN_BYTES:
            return await client.send_file(
                entity,
                path,
                progress_callback=progress_callback,
                **{k: v for k, v in send_kwargs.items() if v is not None},
            )

        try:
            from engine.media_meta import build_send_attributes

            force_doc = bool(send_kwargs.get("force_document"))
            attrs, mime = build_send_attributes(
                path,
                force_document=force_doc,
                supports_streaming=bool(send_kwargs.get("supports_streaming", True)),
            )
            if send_kwargs.get("attributes"):
                attrs = send_kwargs.get("attributes")
            if send_kwargs.get("mime_type"):
                mime = send_kwargs.get("mime_type")

            handle = await fast_upload_file(
                client,
                path,
                workers=workers,
                part_size_kb=MAX_PART_KB,
                file_name=os.path.basename(path),
                progress_callback=progress_callback,
                upload_policy=upload_policy,
            )
            kw = {
                "force_document": send_kwargs.get("force_document"),
                "caption": send_kwargs.get("caption"),
                "silent": send_kwargs.get("silent"),
                "supports_streaming": send_kwargs.get("supports_streaming"),
                "reply_to": send_kwargs.get("reply_to"),
                "schedule": send_kwargs.get("schedule"),
                "spoiler": send_kwargs.get("spoiler"),
                "thumb": send_kwargs.get("thumb"),
                "attributes": attrs or None,
                "mime_type": mime,
                "file_name": send_kwargs.get("file_name", os.path.basename(path)),
            }
            return await client.send_file(
                entity,
                handle,
                **{k: v for k, v in kw.items() if v is not None},
            )
        except TypeError:
            sk = {k: v for k, v in send_kwargs.items() if v is not None and k != "spoiler"}
            handle = await fast_upload_file(
                client,
                path,
                workers=workers,
                progress_callback=progress_callback,
                upload_policy=upload_policy,
            )
            return await client.send_file(entity, handle, file_name=send_kwargs.get("file_name", os.path.basename(path)), **sk)
        except Exception as exc:
            if _is_nonretryable_file_parts_error(exc):
                # A native Telethon retry would calculate the same illegal part
                # count and upload gigabytes again before failing identically.
                raise
            return await client.send_file(
                entity,
                path,
                part_size_kb=MAX_PART_KB,
                progress_callback=progress_callback,
                **{k: v for k, v in send_kwargs.items() if v is not None},
            )
    finally:
        if local_thumb:
            try:
                if os.path.isfile(local_thumb):
                    os.remove(local_thumb)
            except Exception:
                pass


def _getfile_limit(remain: int, part_size: int) -> int:
    """
    Telegram GetFile `limit` rules (users):
      - divisible by 4096
      - 4096 … 512 KiB inclusive

    Prefer a fixed aligned part_size for every request (including the last
    chunk). Telegram returns fewer bytes when near EOF. Custom mid-size
    limits (e.g. round_up(remain)) have been observed to raise
    LimitInvalidError → last part stuck → full sequential re-download.
    """
    ps = int(part_size or 512 * 1024)
    ps = max(4096, min(ps, 512 * 1024))
    ps = (ps // 4096) * 4096
    if ps < 4096:
        ps = 4096
    return ps


def _getfile_limit_candidates(remain: int, part_size: int) -> list:
    """
    Fallback limits if primary GetFile rejects limit.

    Prefer fixed aligned sizes only (4096…512KiB). Rounded-remain limits
    (e.g. 315392) have been observed to raise LimitInvalidError on some DCs
    even when divisible by 4096 — do not put them first; omit them entirely
    and rely on short reads / hole-fill micro-chunks of 4096.
    """
    primary = _getfile_limit(remain, part_size)
    out = [primary]
    # Classic fixed sizes Telegram accepts (largest → smallest for fewer RTTs)
    for n in (512 * 1024, 256 * 1024, 128 * 1024, 64 * 1024, 32 * 1024, 16 * 1024, 8192, 4096):
        if n not in out and 4096 <= n <= 512 * 1024 and n % 4096 == 0:
            out.append(n)
    return out


async def _seq_download_media(
    client: TelegramClient,
    message,
    file: str,
    progress_callback: ProgressCB = None,
) -> str:
    """Single sequential download — no multi-pass that re-downloads the same file."""
    from engine.transfer_log import tlog, tlog_exc

    import time as _time

    mid = getattr(message, "id", None)
    tlog(
        "sequential download start",
        phase="seq_download",
        dest=file,
        message_id=mid,
        has_document=bool(getattr(message, "document", None)),
    )
    t0 = _time.time()
    doc = getattr(message, "document", None)
    # Prefer download_file for documents (explicit large parts, one pass)
    if doc is not None:
        try:
            tlog("sequential via download_file", phase="seq_download", message_id=mid)
            path = await client.download_file(
                doc,
                file=file,
                part_size_kb=MAX_PART_KB,
                progress_callback=progress_callback,
            )
            if path and os.path.isfile(path):
                tlog(
                    "sequential download_file ok",
                    phase="seq_download",
                    path=path,
                    size=os.path.getsize(path),
                    duration_s=round(_time.time() - t0, 3),
                )
                return path
            if os.path.isfile(file):
                tlog(
                    "sequential download_file ok (dest)",
                    phase="seq_download",
                    path=file,
                    size=os.path.getsize(file),
                    duration_s=round(_time.time() - t0, 3),
                )
                return file
            tlog(
                "download_file returned no file — try download_media",
                level="WARN",
                phase="seq_download",
                path_ret=str(path),
            )
        except Exception as e:
            tlog_exc("download_file failed — try download_media", e, phase="seq_download")
    try:
        tlog("sequential via download_media", phase="seq_download", message_id=mid)
        path = await client.download_media(
            message,
            file=file,
            progress_callback=progress_callback,
        )
    except Exception as e:
        tlog_exc("download_media failed", e, phase="seq_download")
        raise
    if path and os.path.isfile(path):
        tlog(
            "sequential download_media ok",
            phase="seq_download",
            path=path,
            size=os.path.getsize(path),
            duration_s=round(_time.time() - t0, 3),
        )
        return path
    if os.path.isfile(file):
        tlog(
            "sequential download_media ok (dest)",
            phase="seq_download",
            path=file,
            size=os.path.getsize(file),
            duration_s=round(_time.time() - t0, 3),
        )
        return file
    tlog(
        "sequential finished without file on disk",
        level="ERROR",
        phase="seq_download",
        path_ret=str(path),
        dest=file,
    )
    return path or file


def _safe_finalize_part(tmp: str, dest: str) -> None:
    """Atomically promote .part → final path (Windows-safe)."""
    from engine.transfer_log import tlog, tlog_exc

    if not os.path.isfile(tmp):
        raise FileNotFoundError(tmp)
    tmp_size = os.path.getsize(tmp)
    tlog(
        "finalize .part → dest",
        phase="finalize",
        tmp=tmp,
        dest=dest,
        tmp_size=tmp_size,
        dest_exists=os.path.isfile(dest),
    )
    if os.path.isfile(dest):
        try:
            os.remove(dest)
            tlog("removed existing dest before replace", phase="finalize", dest=dest)
        except OSError as e:
            tlog_exc("could not remove existing dest", e, phase="finalize", dest=dest)
    try:
        os.replace(tmp, dest)
        tlog("os.replace ok", phase="finalize", dest=dest, size=os.path.getsize(dest))
        return
    except OSError as e:
        tlog_exc("os.replace failed — copy2 fallback", e, phase="finalize")
        import shutil

        shutil.copy2(tmp, dest)
        try:
            os.remove(tmp)
        except OSError:
            pass
        tlog(
            "copy2 finalize ok",
            phase="finalize",
            dest=dest,
            size=os.path.getsize(dest) if os.path.isfile(dest) else 0,
        )
    if not os.path.isfile(dest):
        raise OSError(f"failed to finalize {tmp} → {dest}")


def _report_progress(cb: ProgressCB, current: int, total: int, *, finalize: bool = False) -> None:
    """Never show 100% until finalize=True (avoids 100% → restart UX)."""
    if not cb or total <= 0:
        return
    try:
        if finalize:
            cb(total, total)
        else:
            # Cap at 99% while still writing/assembling .part
            shown = min(int(current), max(0, int(total) - 1))
            cb(shown, total)
    except Exception:
        pass


async def fast_download_media(
    client: TelegramClient,
    message,
    file: str,
    *,
    workers: int = 0,
    part_size: int = 512 * 1024,
    progress_callback: ProgressCB = None,
) -> str:
    """
    Download message media with concurrent GetFile parts when size warrants it.
    Falls back to sequential only if concurrent path cannot complete.
    """
    import time as _time
    from engine.transfer_log import set_transfer_session, tlog, tlog_exc, tlog_verbose, log_path

    mid = getattr(message, "id", None)
    set_transfer_session(f"dl-{mid or 'x'}-{int(_time.time())}")
    tlog(
        "fast_download_media enter",
        phase="fast_download",
        dest=file,
        message_id=mid,
        log_file=log_path(),
    )

    if not message or not getattr(message, "media", None):
        raise ValueError("message has no media")

    doc = getattr(message, "document", None)
    photo = getattr(message, "photo", None)
    size_hint = 0
    if doc is not None:
        size_hint = int(getattr(doc, "size", 0) or 0)
    elif photo is not None:
        try:
            sizes = getattr(photo, "sizes", None) or []
            if sizes:
                size_hint = max(int(getattr(s, "size", 0) or 0) for s in sizes)
        except Exception:
            size_hint = 0

    # Small / unknown → large-chunk sequential (single pass)
    if size_hint < CONCURRENT_MIN_BYTES or size_hint <= 0:
        tlog(
            "route sequential (small/unknown size)",
            phase="fast_download",
            size_hint=size_hint,
            threshold=CONCURRENT_MIN_BYTES,
        )
        return await _seq_download_media(client, message, file, progress_callback)

    try:
        # Telethon returns (dc_id, Input*FileLocation) — not file size
        target = doc or photo or message.media
        dc_id, input_loc = utils.get_input_location(target)
        file_size = size_hint
        if file_size < CONCURRENT_MIN_BYTES:
            raise ValueError("small file — sequential")
    except Exception as e:
        tlog_exc("get_input_location failed — sequential", e, phase="fast_download")
        return await _seq_download_media(client, message, file, progress_callback)

    # Part size: 512KB max, must be multiple of 4KB
    part_size = max(64 * 1024, min(int(part_size or 512 * 1024), 512 * 1024))
    part_size = (part_size // 4096) * 4096
    if part_size < 4096:
        part_size = 4096

    offsets = list(range(0, file_size, part_size))
    n_workers = _workers_for_size(file_size, workers)
    last_remain = file_size - offsets[-1] if offsets else 0
    last_limit = _getfile_limit(last_remain, part_size) if last_remain else 0
    tlog(
        "concurrent download plan",
        phase="concurrent",
        file_size=file_size,
        part_size=part_size,
        parts=len(offsets),
        workers=n_workers,
        dc_id=int(dc_id) if dc_id else None,
        last_remain=last_remain,
        last_getfile_limit=last_limit,
        tmp=file + ".part",
    )

    sem = asyncio.Semaphore(n_workers)
    lock = asyncio.Lock()
    # Per-offset bytes written (idempotent retries — no double-count progress)
    got: dict[int, int] = {}
    part_stats = {"ok": 0, "empty": 0, "short": 0, "error": 0}
    pending: list[int] = list(offsets)

    parent = os.path.dirname(os.path.abspath(file))
    if parent:
        os.makedirs(parent, exist_ok=True)
    tmp = file + ".part"
    try:
        if os.path.isfile(tmp):
            os.remove(tmp)
            tlog("removed stale .part", phase="concurrent", tmp=tmp)
    except OSError as e:
        tlog_exc("could not remove stale .part", e, phase="concurrent", tmp=tmp)
    with open(tmp, "wb") as f:
        f.truncate(file_size)

    async def _cleanup_part() -> None:
        try:
            if os.path.isfile(tmp):
                sz = os.path.getsize(tmp)
                os.remove(tmp)
                tlog("cleaned .part", phase="cleanup", tmp=tmp, size_was=sz)
        except OSError as e:
            tlog_exc("cleanup .part failed", e, phase="cleanup", tmp=tmp)

    media_sender = None
    try:
        # Hold exported sender for OTHER DCs — warm-and-return alone does not route GetFile
        try:
            home_dc = int(getattr(getattr(client, "session", None), "dc_id", 0) or 0)
        except Exception:
            home_dc = 0
        if (
            dc_id
            and int(dc_id) != home_dc
            and hasattr(client, "_borrow_exported_sender")
        ):
            try:
                media_sender = await client._borrow_exported_sender(int(dc_id))
                tlog(
                    "media DC exported sender borrowed",
                    phase="concurrent",
                    dc_id=int(dc_id),
                    home_dc=home_dc or None,
                )
            except Exception as e:
                media_sender = None
                err_name = type(e).__name__
                err_s = str(e).lower()
                # Same-DC ExportAuthorization → expected; not an error
                if (
                    "dcidinvalid" in err_name.lower()
                    or "same data center" in err_s
                    or "currently connected" in err_s
                ):
                    tlog(
                        "skip DC export (same DC as home)",
                        phase="concurrent",
                        dc_id=int(dc_id) if dc_id else None,
                        home_dc=home_dc or None,
                        note=err_name,
                    )
                else:
                    tlog_exc(
                        "media DC export failed — main DC GetFile",
                        e,
                        phase="concurrent",
                    )
        else:
            tlog(
                "skip DC export (same DC or unknown)",
                phase="concurrent",
                dc_id=int(dc_id) if dc_id else None,
                home_dc=home_dc or None,
            )

        api = media_sender if media_sender is not None else client

        async def download_one(offset: int) -> bool:
            """Fetch one part. Returns True if enough bytes written for this offset."""
            remain = file_size - offset
            if remain <= 0:
                return True
            chunk_need = min(remain, part_size)
            if got.get(offset, 0) >= chunk_need:
                return True

            data = b""
            used_limit = 0
            last_part_err = ""
            for limit in _getfile_limit_candidates(chunk_need, part_size):
                used_limit = limit
                try:
                    async with sem:
                        result = await _call_with_flood(
                            api,
                            GetFileRequest(
                                location=input_loc, offset=offset, limit=limit
                            ),
                        )
                        data = getattr(result, "bytes", None) or b""
                    if data:
                        break
                except Exception as e:
                    last_part_err = str(e)
                    err_l = last_part_err.lower()
                    # Try next candidate limit on LimitInvalid
                    if "limit" in err_l or "invalid" in err_l:
                        tlog(
                            "part GetFile limit rejected — try next",
                            level="WARN",
                            phase="concurrent",
                            offset=offset,
                            remain=remain,
                            limit=limit,
                            error=last_part_err,
                        )
                        continue
                    part_stats["error"] += 1
                    tlog(
                        "part GetFile error",
                        level="WARN",
                        phase="concurrent",
                        offset=offset,
                        remain=remain,
                        limit=limit,
                        error=last_part_err,
                        error_type=type(e).__name__,
                    )
                    return False

            if not data:
                part_stats["error" if last_part_err else "empty"] += 1
                tlog(
                    "part empty / all limits failed",
                    level="WARN",
                    phase="concurrent",
                    offset=offset,
                    remain=remain,
                    limit=used_limit,
                    error=last_part_err or None,
                )
                return False

            # Accept min(returned, need). EOF returns fewer than limit — that's OK.
            raw_len = len(data)
            data = data[:chunk_need]
            if len(data) < chunk_need:
                part_stats["short"] += 1
                tlog(
                    "part short read",
                    level="WARN",
                    phase="concurrent",
                    offset=offset,
                    need=chunk_need,
                    got=len(data),
                    raw=raw_len,
                    limit=used_limit,
                )

                def _write_partial():
                    with open(tmp, "r+b") as f:
                        f.seek(offset)
                        f.write(data)

                await asyncio.to_thread(_write_partial)
                async with lock:
                    prev = got.get(offset, 0)
                    if len(data) > prev:
                        got[offset] = len(data)
                        _report_progress(
                            progress_callback, sum(got.values()), file_size, finalize=False
                        )
                # If Telegram returned EOF short of need, still incomplete
                return False

            def _write():
                with open(tmp, "r+b") as f:
                    f.seek(offset)
                    f.write(data)

            await asyncio.to_thread(_write)
            async with lock:
                prev = got.get(offset, 0)
                got[offset] = len(data)
                if len(data) > prev:
                    _report_progress(
                        progress_callback, sum(got.values()), file_size, finalize=False
                    )
            part_stats["ok"] += 1
            tlog_verbose(
                "part ok",
                phase="concurrent",
                offset=offset,
                bytes=len(data),
                limit=used_limit,
            )
            return True

        last_err = ""
        t0 = _time.time()
        for _round in range(4):
            if not pending:
                break
            tlog(
                f"concurrent round {_round + 1}/4",
                phase="concurrent",
                pending_parts=len(pending),
                transferred=sum(got.values()),
                file_size=file_size,
                pct=round(100.0 * sum(got.values()) / max(file_size, 1), 2),
            )
            results = await asyncio.gather(
                *(download_one(o) for o in pending), return_exceptions=True
            )
            next_pending: list[int] = []
            for o, res in zip(pending, results):
                if res is True:
                    continue
                if isinstance(res, Exception):
                    last_err = str(res)
                    next_pending.append(o)
                    continue
                need = min(part_size, file_size - o)
                if got.get(o, 0) >= need:
                    continue
                next_pending.append(o)
            if next_pending:
                tlog(
                    "parts still missing after round",
                    level="WARN",
                    phase="concurrent",
                    round=_round + 1,
                    missing=len(next_pending),
                    sample_offsets=next_pending[:8],
                    sample_got={str(o): got.get(o, 0) for o in next_pending[:8]},
                )
            pending = next_pending
            if pending:
                await asyncio.sleep(0.2 * (_round + 1))

        # Hole-fill: only missing offsets — do NOT wipe .part / redownload all
        if pending:
            tlog(
                "hole-fill missing parts (no full re-download)",
                phase="concurrent",
                missing=len(pending),
                transferred=sum(got.values()),
                file_size=file_size,
            )
            for o in list(pending):
                ok = await download_one(o)
                if ok or got.get(o, 0) >= min(part_size, file_size - o):
                    pending = [x for x in pending if x != o]
                else:
                    # Micro-chunks of 4096 from this offset until filled
                    need = min(part_size, file_size - o)
                    pos = o + got.get(o, 0)
                    while pos < o + need:
                        try:
                            async with sem:
                                result = await _call_with_flood(
                                    api,
                                    GetFileRequest(
                                        location=input_loc, offset=pos, limit=4096
                                    ),
                                )
                                chunk = getattr(result, "bytes", None) or b""
                        except Exception as e:
                            last_err = str(e)
                            break
                        if not chunk:
                            break
                        take = min(len(chunk), o + need - pos)

                        def _w(p=pos, c=chunk[:take]):
                            with open(tmp, "r+b") as f:
                                f.seek(p)
                                f.write(c)

                        await asyncio.to_thread(_w)
                        pos += take
                        async with lock:
                            got[o] = pos - o
                            _report_progress(
                                progress_callback,
                                sum(got.values()),
                                file_size,
                                finalize=False,
                            )
                    if got.get(o, 0) >= need:
                        pending = [x for x in pending if x != o]

        transferred = sum(got.values())
        # Tail-fill: if only the last incomplete range remains, walk 4KB steps
        # from transferred offset without wiping concurrent progress.
        if transferred < file_size and not pending:
            # Sparse map can under-count contiguous prefix — rebuild from tmp size
            try:
                on_disk = os.path.getsize(tmp) if os.path.isfile(tmp) else 0
            except OSError:
                on_disk = 0
            # Prefer contiguous prefix estimate from filled offsets
            prefix = 0
            for o in sorted(got.keys()):
                if o > prefix:
                    break
                prefix = max(prefix, o + got[o])
            start = max(prefix, min(on_disk, file_size))
            if 0 < start < file_size:
                tlog(
                    "tail-fill remaining bytes after concurrent",
                    phase="concurrent",
                    start=start,
                    remain=file_size - start,
                )
                pos = start
                while pos < file_size:
                    try:
                        async with sem:
                            result = await _call_with_flood(
                                api,
                                GetFileRequest(
                                    location=input_loc,
                                    offset=pos,
                                    limit=4096,
                                ),
                            )
                            chunk = getattr(result, "bytes", None) or b""
                    except Exception as e:
                        last_err = str(e)
                        break
                    if not chunk:
                        break
                    take = min(len(chunk), file_size - pos)

                    def _wt(p=pos, c=chunk[:take]):
                        with open(tmp, "r+b") as f:
                            f.seek(p)
                            f.write(c)

                    await asyncio.to_thread(_wt)
                    pos += take
                    async with lock:
                        # attribute to nearest part start for progress
                        part_o = (pos - take) // part_size * part_size
                        got[part_o] = max(got.get(part_o, 0), pos - part_o)
                        _report_progress(
                            progress_callback, pos, file_size, finalize=False
                        )
                transferred = pos if pos > transferred else sum(got.values())

        if pending or transferred < file_size:
            raise RuntimeError(
                f"concurrent download incomplete: {transferred}/{file_size} bytes, "
                f"{len(pending)} parts missing"
                + (f" ({last_err})" if last_err else "")
            )

        tlog(
            "concurrent parts complete — finalizing",
            phase="concurrent",
            transferred=transferred,
            file_size=file_size,
            duration_s=round(_time.time() - t0, 3),
            part_stats=dict(part_stats),
        )
        _safe_finalize_part(tmp, file)
        final_sz = os.path.getsize(file) if os.path.isfile(file) else 0
        if not os.path.isfile(file) or final_sz < file_size:
            raise RuntimeError(
                f"finalize size mismatch: {final_sz}/{file_size}"
            )
        _report_progress(progress_callback, file_size, file_size, finalize=True)
        tlog(
            "concurrent download SUCCESS",
            phase="concurrent",
            path=file,
            size=final_sz,
            duration_s=round(_time.time() - t0, 3),
        )
        return file
    except Exception as e:
        # Prefer residual fill when we already have most of the file — avoid
        # wiping .part and re-downloading 99% just for the last LimitInvalid chunk.
        have = sum(got.values()) if got else 0
        try:
            on_disk = os.path.getsize(tmp) if os.path.isfile(tmp) else 0
        except OSError:
            on_disk = 0
        have = max(have, on_disk)
        almost = file_size > 0 and have >= int(file_size * 0.85)
        if almost and os.path.isfile(tmp):
            tlog(
                "concurrent incomplete but ≥85% on disk — sequential residual only",
                level="WARN",
                phase="fallback",
                transferred=have,
                file_size=file_size,
                pending_count=len(pending),
                error=str(e),
            )
            try:
                # Resize/preallocate .part then fill from `have` with 4KB steps
                pos = min(have, file_size)
                # Align down to 4096 for GetFile offset rules when mid-file
                if pos % 4096 and pos > 4096:
                    pos = (pos // 4096) * 4096
                api2 = media_sender if media_sender is not None else client
                while pos < file_size:
                    try:
                        result = await _call_with_flood(
                            api2,
                            GetFileRequest(
                                location=input_loc, offset=pos, limit=4096
                            ),
                        )
                        chunk = getattr(result, "bytes", None) or b""
                    except Exception as e2:
                        tlog_exc("residual GetFile failed", e2, phase="fallback", offset=pos)
                        break
                    if not chunk:
                        break
                    take = min(len(chunk), file_size - pos)

                    def _wr(p=pos, c=chunk[:take]):
                        with open(tmp, "r+b") as f:
                            f.seek(p)
                            f.write(c)

                    await asyncio.to_thread(_wr)
                    pos += take
                    _report_progress(progress_callback, pos, file_size, finalize=False)
                if pos >= file_size:
                    _safe_finalize_part(tmp, file)
                    final_sz = os.path.getsize(file) if os.path.isfile(file) else 0
                    if final_sz >= file_size:
                        _report_progress(
                            progress_callback, file_size, file_size, finalize=True
                        )
                        tlog(
                            "residual fill SUCCESS — avoided full re-download",
                            phase="fallback",
                            path=file,
                            size=final_sz,
                        )
                        return file
            except Exception as e3:
                tlog_exc("residual fill failed — full sequential", e3, phase="fallback")

        tlog_exc(
            "concurrent FAILED — FALLBACK sequential (this is the re-download)",
            e,
            phase="fallback",
            transferred=have,
            file_size=file_size,
            part_stats=dict(part_stats),
            pending_sample=pending[:12],
            pending_count=len(pending),
        )
        await _cleanup_part()
        tlog("starting sequential fallback after concurrent failure", phase="fallback")
        return await _seq_download_media(client, message, file, progress_callback)
    finally:
        if media_sender is not None:
            try:
                await client._return_exported_sender(media_sender)
                tlog("media DC exported sender returned", phase="concurrent")
            except Exception as e:
                try:
                    tlog_exc("return exported sender failed", e, phase="concurrent")
                except Exception:
                    pass
