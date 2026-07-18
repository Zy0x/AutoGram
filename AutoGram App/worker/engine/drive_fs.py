"""
AutoGram Drive — Telegram as cloud folders (Telegram-Drive model via Telethon).

- Root (folder_id=null): Saved Messages
- Drives [TD]: root private channels titled "{name} [TD]" + about [telegram-drive-folder]
- Folders: nested under a Drive (or Folder) via about parent=-100…
- Any chat/channel can also be opened as a location (list media)
- Files: photo/document messages; id = message_id
"""
from __future__ import annotations

import asyncio
import base64
import json
import mimetypes
import os
import re
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from telethon import TelegramClient, functions, utils
from telethon.errors import FloodWaitError
from telethon.tl.types import (
    DocumentAttributeFilename,
    DocumentAttributeVideo,
    DocumentAttributeAudio,
    MessageMediaPhoto,
    MessageMediaDocument,
    MessageMediaWebPage,
    WebPage,
    MessageEntityUrl,
    MessageEntityTextUrl,
    Channel,
    User,
    Chat,
    InputMessagesFilterPhotoVideo,
    InputMessagesFilterDocument,
    InputMessagesFilterGif,
    InputMessagesFilterMusic,
    InputMessagesFilterRoundVideo,
    InputMessagesFilterVoice,
    InputMessagesFilterUrl,
)

from engine.events import emit_event, setup_emitter
from engine.utf8_io import ensure_utf8_stdio, print_json


def _json_out(obj) -> None:
    """Safe UTF-8 JSON_OUTPUT for Windows (avoids charmap crashes on ¹⁸ etc.)."""
    try:
        ensure_utf8_stdio()
    except Exception:
        pass
    print_json(obj, prefix="[JSON_OUTPUT]")

WORKER_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_ROOT = os.path.join(WORKER_ROOT, "cache")
THUMB_DIR = os.path.join(CACHE_ROOT, "thumbs")
PREVIEW_DIR = os.path.join(CACHE_ROOT, "previews")
AVATAR_DIR = os.path.join(CACHE_ROOT, "avatars")

# Sidebar profile photos — small, clear, quota-friendly
AVATAR_EDGE = 80  # display ~28–36px CSS → 2× retina
AVATAR_JPEG_Q = 82
AVATAR_MAX_BYTES = 28 * 1024
AVATAR_BATCH = 16

# Telegram-Drive authentic markers (no AutoGram [AG] fork)
FOLDER_TITLE_SUFFIX = " [TD]"
FOLDER_ABOUT_TAG = "[telegram-drive-folder]"
TD_TITLE_SUFFIX = FOLDER_TITLE_SUFFIX
TD_ABOUT_TAG = FOLDER_ABOUT_TAG

CHUNK_SIZE = 200
MAX_LIST_MESSAGES = 50_000
# Preview caps — keep low to avoid OOM / force-close when opening media
PREVIEW_MAX_IMAGE_BYTES = 10 * 1024 * 1024   # full image download
PREVIEW_MAX_VIDEO_BYTES = 28 * 1024 * 1024   # full video download for streaming path
PREVIEW_INLINE_MAX_BYTES = 400 * 1024        # only tiny images as base64 data_url
PREVIEW_MAX_BYTES = PREVIEW_MAX_VIDEO_BYTES  # legacy alias

# ── Adaptive grid thumbs (profiles: saver | balanced | sharp) ──
# Video uses a slightly higher edge than photos at the same profile.
# "sharp" must request a LARGE Telegram size — picking the smallest layer
# is what made "Jelas" look soft/blurry on 2:3 cards.
THUMB_PROFILES: Dict[str, Dict[str, int]] = {
    # Slow / metered data
    "saver": {
        "edge": 240,
        "video_edge": 280,
        "q": 70,
        "q_min": 58,
        "target": 22 * 1024,
        "max": 56 * 1024,
        # Static TG photo thumbs only (never full video bytes)
        "video_raw_cap": 200 * 1024,
        "batch": 16,
        "prefer": 0,  # 0=smallest ok, 1=near target, 2=largest
        "concurrency": 2,
    },
    # Default — clearer video stills, still quota-friendly
    "balanced": {
        "edge": 360,
        "video_edge": 440,
        "q": 82,
        "q_min": 70,
        "target": 48 * 1024,
        "max": 120 * 1024,
        "video_raw_cap": 320 * 1024,
        "batch": 16,
        "prefer": 1,
        "concurrency": 4,
    },
    # Jelas LEAN — clear on grid without full-file / multi‑MB downloads.
    # Strategy: largest *Telegram static* layer only (usually << 150 KB),
    # encode at ~640px (covers 288px tiles @2x ≈ 576). Never pull originals.
    "sharp": {
        "edge": 640,
        "video_edge": 560,
        "q": 92,
        "q_min": 86,
        "target": 70 * 1024,
        "max": 130 * 1024,
        "video_raw_cap": 220 * 1024,  # static PhotoSize only
        "batch": 14,
        "prefer": 2,
        "concurrency": 3,
    },
}
# Back-compat constants (balanced defaults)
THUMB_MAX_EDGE = THUMB_PROFILES["balanced"]["edge"]
THUMB_JPEG_QUALITY = THUMB_PROFILES["balanced"]["q"]
THUMB_JPEG_QUALITY_MIN = THUMB_PROFILES["balanced"]["q_min"]
THUMB_TARGET_BYTES = THUMB_PROFILES["balanced"]["target"]
THUMB_MAX_BYTES = THUMB_PROFILES["balanced"]["max"]
THUMB_LITE_TAG = "lite4"  # v4: lean Jelas (TG layers only, no full-file)


def _normalize_thumb_quality(raw: Optional[str]) -> str:
    s = str(raw or "balanced").strip().lower().replace("-", "_")
    aliases = {
        "low": "saver",
        "lite": "saver",
        "hemat": "saver",
        "data_saver": "saver",
        "datasaver": "saver",
        "medium": "balanced",
        "normal": "balanced",
        "default": "balanced",
        "seimbang": "balanced",
        "high": "sharp",
        "hq": "sharp",
        "clear": "sharp",
        "jelas": "sharp",
        "hd": "sharp",
    }
    s = aliases.get(s, s)
    return s if s in THUMB_PROFILES else "balanced"


def _thumb_profile(quality: Optional[str] = None) -> Dict[str, int]:
    return THUMB_PROFILES[_normalize_thumb_quality(quality)]


OPEN_DIR = os.path.join(CACHE_ROOT, "open")
ZIP_DIR = os.path.join(CACHE_ROOT, "zips")


def _ensure_dirs() -> None:
    os.makedirs(THUMB_DIR, exist_ok=True)
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    os.makedirs(AVATAR_DIR, exist_ok=True)
    os.makedirs(OPEN_DIR, exist_ok=True)
    os.makedirs(ZIP_DIR, exist_ok=True)


def _avatar_path(peer_id: int) -> str:
    # peer_id 0 = self (Saved Messages)
    return os.path.join(AVATAR_DIR, f"p{int(peer_id)}.jpg")


def _avatar_empty_path(peer_id: int) -> str:
    return os.path.join(AVATAR_DIR, f"p{int(peer_id)}.empty")


def _disk_avatar_data_url(peer_id: int) -> Optional[str]:
    """Return cached avatar data URL, empty-string marker as '', or None if miss."""
    _ensure_dirs()
    empty = _avatar_empty_path(peer_id)
    if os.path.isfile(empty):
        # Re-check empty after 3 days (user may have set a photo)
        try:
            if time.time() - os.path.getmtime(empty) < 3 * 24 * 3600:
                return ""
            os.remove(empty)
        except OSError:
            return ""
    path = _avatar_path(peer_id)
    if os.path.isfile(path) and os.path.getsize(path) > 16:
        try:
            with open(path, "rb") as f:
                data = f.read()
            if len(data) > AVATAR_MAX_BYTES * 2:
                return None
            return f"data:image/jpeg;base64,{base64.b64encode(data).decode('ascii')}"
        except OSError:
            return None
    return None


def _optimize_avatar_bytes(raw: bytes) -> Optional[bytes]:
    """Resize profile photo to small clear JPEG for sidebar (retina 80px)."""
    if not raw or len(raw) < 16:
        return None
    try:
        from PIL import Image  # type: ignore
        import io

        im = Image.open(io.BytesIO(raw))
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        elif im.mode == "L":
            im = im.convert("RGB")
        # Center-crop to square then scale
        w, h = im.size
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        im = im.crop((left, top, left + side, top + side))
        if side > AVATAR_EDGE:
            try:
                resample = Image.Resampling.LANCZOS  # type: ignore[attr-defined]
            except Exception:
                resample = Image.LANCZOS  # type: ignore[attr-defined]
            im = im.resize((AVATAR_EDGE, AVATAR_EDGE), resample)
        try:
            from PIL import ImageFilter  # type: ignore

            im = im.filter(ImageFilter.UnsharpMask(radius=0.5, percent=110, threshold=2))
        except Exception:
            pass
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=AVATAR_JPEG_Q, optimize=True, progressive=True)
        data = buf.getvalue()
        if data and len(data) <= AVATAR_MAX_BYTES:
            return data
        if data and len(data) > AVATAR_MAX_BYTES:
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=70, optimize=True)
            data = buf.getvalue()
            if data and len(data) <= AVATAR_MAX_BYTES * 1.2:
                return data
        return data if data and len(data) < 48 * 1024 else None
    except Exception:
        # Keep original only if already small
        if len(raw) <= AVATAR_MAX_BYTES:
            return raw
        return None


async def _fetch_avatar_data_url(client: TelegramClient, peer_id: int) -> Optional[str]:
    """
    Download + cache one profile photo as data URL.
    peer_id=0 → current user (Saved Messages).
    Returns data URL, "" if no photo, None on hard failure.
    """
    _ensure_dirs()
    pid = int(peer_id)
    cached = _disk_avatar_data_url(pid)
    if cached is not None:
        return cached or None  # "" → None for API (no photo)

    path = _avatar_path(pid)
    empty = _avatar_empty_path(pid)
    try:
        if pid == 0:
            entity = await client.get_me()
        else:
            try:
                entity = await client.get_entity(pid)
            except Exception:
                entity = await _resolve_peer(client, pid)

        # Prefer SMALL profile photo (download_big=False) — ~160px is enough for 80px retina UI
        raw: Optional[bytes] = None
        try:
            result = await client.download_profile_photo(
                entity, file=bytes, download_big=False
            )
            if isinstance(result, (bytes, bytearray)) and len(result) > 16:
                raw = bytes(result)
        except Exception:
            raw = None

        # Fallback: get_profile_photos + smallest thumb layer
        if raw is None:
            try:
                photos = await client.get_profile_photos(entity, limit=1)
                if photos:
                    # thumb=0 ≈ small; avoid full-res for quota
                    result = await client.download_media(photos[0], file=bytes, thumb=0)
                    if isinstance(result, (bytes, bytearray)) and len(result) > 16:
                        raw = bytes(result)
            except Exception:
                pass

        if not raw:
            try:
                open(empty, "wb").close()
            except OSError:
                pass
            return None

        data = _optimize_avatar_bytes(raw)
        if not data:
            try:
                open(empty, "wb").close()
            except OSError:
                pass
            return None

        try:
            tmp = path + ".tmp"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
            try:
                if os.path.isfile(empty):
                    os.remove(empty)
            except OSError:
                pass
        except OSError:
            pass

        return f"data:image/jpeg;base64,{base64.b64encode(data).decode('ascii')}"
    except FloodWaitError:
        raise
    except Exception as e:
        try:
            print(f"[drive_fs] avatar fail peer={pid}: {e}", flush=True)
        except Exception:
            pass
        return None


async def get_avatars_batch_on_client(
    client: TelegramClient, peer_ids: List[int]
) -> Dict[str, Any]:
    """Batch profile photos for sidebar. peer_id 0 = self."""
    _ensure_dirs()
    ids: List[int] = []
    seen: set = set()
    for x in peer_ids or []:
        try:
            pid = int(x)
        except Exception:
            continue
        if pid in seen:
            continue
        seen.add(pid)
        ids.append(pid)
        if len(ids) >= AVATAR_BATCH:
            break

    avatars: Dict[str, Optional[str]] = {}
    need: List[int] = []
    for pid in ids:
        hit = _disk_avatar_data_url(pid)
        if hit is not None:
            # hit "" means known empty
            avatars[str(pid)] = hit if hit else None
        else:
            need.append(pid)

    for pid in need:
        try:
            url = await _fetch_avatar_data_url(client, pid)
            avatars[str(pid)] = url
        except FloodWaitError as e:
            emit_event("FloodWait", seconds=int(e.seconds))
            avatars[str(pid)] = None
            break
        except Exception:
            avatars[str(pid)] = None
        # Mild pacing — profile photos are light but still rate-limited
        await asyncio.sleep(0.05)

    return {
        "status": "success",
        "avatars": avatars,
        "fetched": len(need),
        "cached": len(ids) - len(need),
    }


async def get_avatars_batch(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    peer_ids: List[int],
) -> Dict[str, Any]:
    """One-shot batch profile photos (daemon path when warm session is down)."""
    setup_emitter(None, None)
    _ensure_dirs()
    ids: List[int] = []
    seen: set = set()
    for x in peer_ids or []:
        try:
            pid = int(x)
        except Exception:
            continue
        if pid in seen:
            continue
        seen.add(pid)
        ids.append(pid)
        if len(ids) >= AVATAR_BATCH:
            break

    avatars: Dict[str, Optional[str]] = {}
    need: List[int] = []
    for pid in ids:
        hit = _disk_avatar_data_url(pid)
        if hit is not None:
            avatars[str(pid)] = hit if hit else None
        else:
            need.append(pid)

    if not need:
        result = {
            "status": "success",
            "avatars": avatars,
            "fetched": 0,
            "cached": len(ids),
        }
        _json_out(result)
        return result

    client = await _connect(session_name, api_id, api_hash)
    try:
        for pid in need:
            try:
                url = await _fetch_avatar_data_url(client, pid)
                avatars[str(pid)] = url
            except FloodWaitError as e:
                emit_event("FloodWait", seconds=int(e.seconds))
                avatars[str(pid)] = None
                break
            except Exception:
                avatars[str(pid)] = None
            await asyncio.sleep(0.05)
        result = {
            "status": "success",
            "avatars": avatars,
            "fetched": len(need),
            "cached": len(ids) - len(need),
        }
        _json_out(result)
        return result
    finally:
        await client.disconnect()


def _thumb_lite_path(
    folder_id: Optional[int], message_id: int, quality: Optional[str] = None
) -> str:
    q = _normalize_thumb_quality(quality)
    return os.path.join(
        THUMB_DIR, f"{_cache_key(folder_id, message_id)}.{q}.{THUMB_LITE_TAG}.jpg"
    )


def _size_long_edge(sz) -> int:
    w = int(getattr(sz, "w", 0) or 0)
    h = int(getattr(sz, "h", 0) or 0)
    return max(w, h)


def _is_photo_thumb_size(sz: Any) -> bool:
    """True for static image, animated video, and vector path thumbnails."""
    if sz is None or isinstance(sz, int):
        return False
    name = type(sz).__name__
    if "Empty" in name:
        return False
    return True


def _collect_telegram_thumbs(msg) -> List[Any]:
    """
    Photo sizes or document thumbs (static only).
    Keeps Cached + Stripped. Skips VideoSize (too heavy for grid tiles).
    """
    out: List[Any] = []
    photo = getattr(msg, "photo", None)
    if photo is not None:
        for s in getattr(photo, "sizes", None) or []:
            if _is_photo_thumb_size(s):
                out.append(s)
    # Check webpage preview photo
    if msg.media and isinstance(msg.media, MessageMediaWebPage):
        webpage = getattr(msg.media, "webpage", None)
        if webpage is not None:
            wphoto = getattr(webpage, "photo", None)
            if wphoto is not None:
                for s in getattr(wphoto, "sizes", None) or []:
                    if _is_photo_thumb_size(s):
                        out.append(s)
    doc = _media_document(msg) or getattr(msg, "document", None)
    if doc is not None:
        for s in getattr(doc, "thumbs", None) or []:
            if _is_photo_thumb_size(s):
                out.append(s)
    return out


def _resolve_thumb_sel(msg, thumb_sel: Any) -> Optional[Any]:
    """
    Map legacy int indices → real PhotoSize objects.
    Returns None if no safe thumb exists (caller must NOT download full media).
    """
    if thumb_sel is None:
        return None
    if not isinstance(thumb_sel, int):
        return thumb_sel if _is_photo_thumb_size(thumb_sel) else None
    sizes = _collect_telegram_thumbs(msg)
    if not sizes:
        return None
    try:
        if thumb_sel < 0:
            return sizes[thumb_sel]  # -1 = last
        if 0 <= thumb_sel < len(sizes):
            return sizes[thumb_sel]
    except Exception:
        return None
    return None




def decode_tg_photo_path(path_bytes: bytes) -> str:
    lookup = "AACAAAAHAAALMAAAQASTAVAAAZaacaaaahaaalmaaaqastava.az0123456789-,"
    bit_str = "".join(f"{b:08b}" for b in path_bytes)
    chars = []
    for i in range(0, len(bit_str) - 5, 6):
        val = int(bit_str[i : i + 6], 2)
        if val < len(lookup):
            chars.append(lookup[val])
    return "".join(chars)


def draw_svg_path_pillow(path_str: str, width: int = 320, height: int = 320) -> bytes:
    from PIL import Image, ImageDraw
    import io
    import re
    
    im = Image.new("RGB", (width, height), (240, 240, 240))
    draw = ImageDraw.Draw(im)
    
    tokens = re.findall(r'[MLCZz]|[+-]?\d*\.\d+|[+-]?\d+', path_str)
    points = []
    curr_point = (0, 0)
    start_point = (0, 0)
    
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t == 'M':
            if i + 2 < len(tokens):
                try:
                    x, y = float(tokens[i+1]), float(tokens[i+2])
                    curr_point = (x, y)
                    start_point = curr_point
                    points.append(curr_point)
                except Exception:
                    pass
            i += 3
        elif t == 'L':
            if i + 2 < len(tokens):
                try:
                    x, y = float(tokens[i+1]), float(tokens[i+2])
                    next_point = (x, y)
                    draw.line([curr_point, next_point], fill=(85, 85, 85), width=2)
                    curr_point = next_point
                    points.append(curr_point)
                except Exception:
                    pass
            i += 3
        elif t == 'C':
            if i + 6 < len(tokens):
                try:
                    x, y = float(tokens[i+5]), float(tokens[i+6])
                    next_point = (x, y)
                    draw.line([curr_point, next_point], fill=(85, 85, 85), width=2)
                    curr_point = next_point
                    points.append(curr_point)
                except Exception:
                    pass
            i += 7
        elif t in ('Z', 'z'):
            draw.line([curr_point, start_point], fill=(85, 85, 85), width=2)
            curr_point = start_point
            if len(points) > 2:
                draw.polygon(points, fill=(200, 200, 200), outline=(85, 85, 85))
            points = []
            i += 1
        else:
            i += 1
            
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


async def _download_thumb_bytes(
    client: TelegramClient,
    msg,
    thumb_sel: Any,
    *,
    max_bytes: int = 400 * 1024,
) -> Optional[bytes]:
    """
    Download ONE Telegram thumb into memory, with support for PhotoPathSize vectors
    and VideoSize animated stickers frame extraction.
    """
    try:
        sel = _resolve_thumb_sel(msg, thumb_sel)
        if sel is None:
            return None

        name = type(sel).__name__
        raw_bytes = getattr(sel, "bytes", None)
        if raw_bytes:
            if "Stripped" in name or "Cached" in name:
                try:
                    if "Stripped" in name:
                        from telethon.utils import stripped_photo_to_jpg
                        data = stripped_photo_to_jpg(raw_bytes)
                    else:
                        data = bytes(raw_bytes)
                    if data and 16 < len(data) <= max_bytes:
                        return data
                except Exception:
                    pass
            elif "Path" in name:
                try:
                    svg_path_str = decode_tg_photo_path(raw_bytes)
                    if svg_path_str:
                        data = draw_svg_path_pillow(svg_path_str)
                        if data and 16 < len(data) <= max_bytes:
                            return data
                except Exception:
                    pass

        # Prefer document target for file-as-video; then message
        targets = []
        doc = _media_document(msg) or getattr(msg, "document", None)
        if doc is not None:
            targets.append(doc)
        targets.append(msg)
        webpage = getattr(msg.media or msg, "webpage", None)
        if webpage is not None:
            targets.append(webpage)
            wphoto = getattr(webpage, "photo", None)
            if wphoto is not None:
                targets.append(wphoto)
        media = getattr(msg, "media", None)
        if media is not None and media is not msg and media not in targets:
            targets.append(media)

        for target in targets:
            try:
                # Always pass concrete size object — NEVER bare int / None
                result = await client.download_media(target, file=bytes, thumb=sel)
            except TypeError:
                result = None
            except Exception:
                result = None

            # If the downloaded result is a video/animation (VideoSize), extract the first frame
            if result and isinstance(result, (bytes, bytearray)):
                if "Video" in name or result[:4] in (b'\x00\x00\x00\x18', b'\x00\x00\x00\x20') or b'ftyp' in result[:12]:
                    try:
                        import tempfile
                        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tf:
                            tf.write(result)
                            tmp_vid_path = tf.name
                        tmp_frame_path = tmp_vid_path + ".jpg"
                        try:
                            extracted = await _ffmpeg_first_frame_jpeg(tmp_vid_path, tmp_frame_path, max_edge=320)
                            if extracted:
                                result = extracted
                        finally:
                            for p in (tmp_vid_path, tmp_frame_path):
                                if os.path.exists(p):
                                    try:
                                        os.remove(p)
                                    except OSError:
                                        pass
                    except Exception:
                        pass

            if isinstance(result, (bytes, bytearray)):
                if 16 < len(result) <= max_bytes:
                    return bytes(result)
                # Reject oversized (would be full video/doc — already wasted; stop retries)
                if len(result) > max_bytes:
                    try:
                        print(
                            f"[drive_fs] thumb download too large ({len(result)} B > {max_bytes}), skip",
                            flush=True,
                        )
                    except Exception:
                        pass
                    return None
            if isinstance(result, str) and os.path.isfile(result):
                try:
                    sz = os.path.getsize(result)
                    if 16 < sz <= max_bytes:
                        with open(result, "rb") as f:
                            data = f.read()
                        try:
                            os.remove(result)
                        except OSError:
                            pass
                        # If download was video, extract frame
                        if "Video" in name or data[:4] in (b'\x00\x00\x00\x18', b'\x00\x00\x00\x20') or b'ftyp' in data[:12]:
                            try:
                                import tempfile
                                with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tf:
                                    tf.write(data)
                                    tmp_vid_path = tf.name
                                tmp_frame_path = tmp_vid_path + ".jpg"
                                try:
                                    extracted = await _ffmpeg_first_frame_jpeg(tmp_vid_path, tmp_frame_path, max_edge=320)
                                    if extracted:
                                        data = extracted
                                finally:
                                    for p in (tmp_vid_path, tmp_frame_path):
                                        if os.path.exists(p):
                                            try:
                                                os.remove(p)
                                            except OSError:
                                                pass
                            except Exception:
                                pass
                        return data
                    try:
                        os.remove(result)
                    except OSError:
                        pass
                    if sz > max_bytes:
                        return None
                except Exception:
                    pass
    except Exception:
        return None
    return None


_ffmpeg_semaphore = asyncio.Semaphore(2)


async def _ffmpeg_first_frame_jpeg(video_path: str, out_path: str, max_edge: int = 420) -> Optional[bytes]:
    """Extract first frame from a local video file via ffmpeg (imageio-ffmpeg) throttled to 2 concurrent runs."""
    async with _ffmpeg_semaphore:
        return await asyncio.to_thread(
            _ffmpeg_frame_from_file_sync, video_path, out_path, max_edge, False
        )


def _render_pdf_first_page_jpeg(pdf_path: str, max_edge: int = 420) -> Optional[bytes]:
    """Render PDF page 0 to JPEG via pypdfium2 (optional dep)."""
    try:
        import pypdfium2 as pdfium  # type: ignore
    except ImportError:
        return None
    try:
        pdf = pdfium.PdfDocument(pdf_path)
        if len(pdf) < 1:
            return None
        page = pdf[0]
        # Scale so long edge ~ max_edge
        w = max(float(page.get_width() or 1), 1.0)
        h = max(float(page.get_height() or 1), 1.0)
        scale = float(max_edge) / max(w, h)
        scale = max(0.4, min(scale, 2.0))
        bitmap = page.render(scale=scale)
        pil = bitmap.to_pil()
        page.close()
        pdf.close()
        from io import BytesIO

        from PIL import Image

        if pil.mode not in ("RGB", "L"):
            pil = pil.convert("RGB")
        elif pil.mode == "L":
            pil = pil.convert("RGB")
        # Fit again if needed
        ow, oh = pil.size
        if max(ow, oh) > max_edge:
            r = max_edge / float(max(ow, oh))
            pil = pil.resize((max(1, int(ow * r)), max(1, int(oh * r))), Image.Resampling.LANCZOS)
        buf = BytesIO()
        pil.save(buf, format="JPEG", quality=82, optimize=True)
        return buf.getvalue()
    except Exception:
        return None


def _render_text_snippet_jpeg(
    text: str,
    *,
    title: str = "",
    max_edge: int = 420,
) -> Optional[bytes]:
    """Draw a dark Google Drive–style text card with first lines of content."""
    try:
        from io import BytesIO

        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return None
    try:
        w = max(220, min(int(max_edge), 480))
        h = int(w * 1.25)
        img = Image.new("RGB", (w, h), (28, 30, 40))
        draw = ImageDraw.Draw(img)
        try:
            font = ImageFont.truetype("segoeui.ttf", 13)
            font_sm = ImageFont.truetype("segoeui.ttf", 11)
            font_t = ImageFont.truetype("segoeuib.ttf", 12)
        except Exception:
            font = ImageFont.load_default()
            font_sm = font
            font_t = font
        # Header bar
        draw.rectangle([0, 0, w, 28], fill=(45, 48, 64))
        label = (title or "Document")[:40]
        draw.text((10, 7), label, fill=(180, 190, 220), font=font_t)
        # Body lines
        body = (text or "").replace("\r\n", "\n").replace("\r", "\n")
        lines = body.split("\n")
        y = 38
        max_chars = max(18, w // 7)
        for line in lines[:28]:
            chunk = line[:max_chars]
            if not chunk.strip():
                y += 14
                continue
            draw.text((10, y), chunk, fill=(210, 214, 228), font=font_sm)
            y += 15
            if y > h - 16:
                break
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=80, optimize=True)
        return buf.getvalue()
    except Exception:
        return None


async def _render_document_thumb(
    client: TelegramClient,
    msg,
    *,
    kind: str,
    max_edge: int = 420,
    quality: Optional[str] = None,
) -> Optional[bytes]:
    """Download document (capped) and render PDF page or text snippet JPEG."""
    size = int(_file_size(msg) or _doc_total_size(msg) or 0)
    name = _file_name_from_message(msg) or f"doc_{getattr(msg, 'id', 0)}"
    ext = _file_ext(name) or _file_ext(_doc_real_filename(msg) or "") or "bin"
    ext = re.sub(r"[^a-z0-9]", "", ext)[:8] or "bin"
    key = f"docthumb_{getattr(msg, 'id', 0)}"
    dest = os.path.join(THUMB_DIR, f"{key}.{ext}")

    if kind == "pdf":
        if size > DOC_THUMB_PDF_MAX_BYTES > 0:
            # Still try if moderate; skip huge PDFs for grid
            if size > DOC_THUMB_PDF_MAX_BYTES * 2:
                return None
        path = await client.download_media(msg, file=dest)
        if not path or not os.path.isfile(str(path)):
            return None
        data = await asyncio.to_thread(
            _render_pdf_first_page_jpeg, str(path), max_edge
        )
        try:
            os.remove(str(path))
        except OSError:
            pass
        return data

    if kind == "text":
        cap = DOC_THUMB_TEXT_MAX_BYTES
        # Prefer small full download
        if size > 0 and size > 2 * 1024 * 1024:
            return _render_text_snippet_jpeg(
                f"({name})\n\nFile teks besar — buka untuk melihat isi.",
                title=ext.upper() or "TXT",
                max_edge=max_edge,
            )
        path = await client.download_media(msg, file=dest)
        if not path or not os.path.isfile(str(path)):
            return None
        try:
            with open(str(path), "rb") as f:
                blob = f.read(cap)
            try:
                text = blob.decode("utf-8")
            except UnicodeDecodeError:
                text = blob.decode("utf-8", errors="replace")
            if ext == "json" or (name or "").lower().endswith(".json"):
                try:
                    import json as _json

                    text = _json.dumps(_json.loads(text), indent=2, ensure_ascii=False)
                except Exception:
                    pass
            data = _render_text_snippet_jpeg(
                text, title=(ext.upper() or "TXT"), max_edge=max_edge
            )
        finally:
            try:
                os.remove(str(path))
            except OSError:
                pass
        return data
    return None


def _media_download_target(msg):
    """Best Telethon target for iter_download (document preferred for file-videos)."""
    doc = _media_document(msg)
    if doc is not None:
        return doc
    if getattr(msg, "media", None) is not None:
        return msg.media
    return msg


def _doc_total_size(msg) -> int:
    doc = _media_document(msg)
    if doc is not None:
        try:
            return int(getattr(doc, "size", 0) or 0)
        except Exception:
            return 0
    return int(_file_size(msg) or 0)


async def _download_media_range(
    client: TelegramClient,
    msg,
    dest: str,
    *,
    offset: int = 0,
    max_bytes: int = 2 * 1024 * 1024,
    request_size: int = 512 * 1024,
    file_size: Optional[int] = None,
) -> int:
    """
    Download a byte range [offset, offset+max_bytes) via iter_download.
    Used for head samples and tail (moov-at-end MP4 re-encodes).
    """
    written = 0
    parent = os.path.dirname(dest)
    if parent:
        os.makedirs(parent, exist_ok=True)
    try:
        if os.path.isfile(dest):
            os.remove(dest)
    except OSError:
        pass

    target = _media_download_target(msg)
    off = max(0, int(offset))
    limit = max(1, int(max_bytes))
    try:
        with open(dest, "wb") as out:
            kwargs = {
                "offset": off,
                "request_size": int(request_size),
                "limit": limit,
            }
            if file_size and file_size > 0:
                kwargs["file_size"] = int(file_size)
            async for chunk in client.iter_download(target, **kwargs):
                if not chunk:
                    continue
                remain = limit - written
                if remain <= 0:
                    break
                if len(chunk) > remain:
                    out.write(chunk[:remain])
                    written += remain
                    break
                out.write(chunk)
                written += len(chunk)
                if written % (request_size * 2) == 0:
                    await asyncio.sleep(0)
    except Exception as e:
        try:
            print(f"[drive_fs] range download fail off={off}: {e}", flush=True)
        except Exception:
            pass
    return written


async def _download_media_prefix(
    client: TelegramClient,
    msg,
    dest: str,
    *,
    max_bytes: int = 2 * 1024 * 1024,
    request_size: int = 256 * 1024,
) -> int:
    """Stream only the first max_bytes of a Telegram media."""
    return await _download_media_range(
        client,
        msg,
        dest,
        offset=0,
        max_bytes=max_bytes,
        request_size=request_size,
        file_size=_doc_total_size(msg) or None,
    )


def _find_mp4_box(data: bytes, name: bytes) -> Optional[tuple]:
    """Return (start, size) of first top-level-ish box named `name` (4cc), or None."""
    if not data or len(name) != 4:
        return None
    # Search with size prefix pattern: [size:4be][type:4]
    i = 0
    n = len(data)
    # Also allow unaligned search for moov inside tail dump
    idx = data.find(name)
    while idx >= 4:
        size = int.from_bytes(data[idx - 4 : idx], "big")
        if size == 0:
            # to EOF
            return idx - 4, n - (idx - 4)
        if size == 1 and idx + 12 <= n:
            # 64-bit largesize
            size = int.from_bytes(data[idx + 4 : idx + 12], "big")
        if 8 <= size <= n - (idx - 4):
            return idx - 4, size
        idx = data.find(name, idx + 4)
    # Sequential scan from start (cleaner for head)
    i = 0
    while i + 8 <= n:
        size = int.from_bytes(data[i : i + 4], "big")
        typ = data[i + 4 : i + 8]
        if size == 1 and i + 16 <= n:
            size = int.from_bytes(data[i + 8 : i + 16], "big")
            hdr = 16
        else:
            hdr = 8
        if size == 0:
            size = n - i
        if size < hdr:
            break
        if typ == name:
            return i, size
        i += size
    return None


def _stitch_mp4_head_tail(head_path: str, tail_path: str, out_path: str) -> bool:
    """Legacy ftyp+moov+mdat rewrite — often fails (sample offsets wrong). Prefer sparse."""
    return _build_sparse_mp4_sample(head_path, tail_path, out_path, full_size=0)


def _mark_file_sparse_windows(path: str, full_size: int) -> None:
    """Best-effort NTFS sparse so huge middle hole doesn't use full disk."""
    if os.name != "nt" or full_size <= 0:
        return
    try:
        import subprocess

        subprocess.run(
            ["fsutil", "sparse", "setflag", path],
            capture_output=True,
            timeout=5,
            check=False,
        )
        # Zero-range entire file as sparse hole, then we'll rewrite head/tail
        subprocess.run(
            ["fsutil", "sparse", "setrange", path, "0", str(int(full_size))],
            capture_output=True,
            timeout=10,
            check=False,
        )
    except Exception:
        pass


# Cap virtual sparse sample size — huge files waste I/O even with NTFS sparse.
# Above this, use head+tail concat only (may fail moov-at-end; stream sample tiers handle it).
SPARSE_SAMPLE_MAX_BYTES = 256 * 1024 * 1024


def _build_sparse_mp4_sample(
    head_path: str,
    tail_path: str,
    out_path: str,
    *,
    full_size: int,
) -> bool:
    """
    Reconstruct a partial MP4 that keeps ORIGINAL byte offsets.

    moov-at-end files need this: sample offsets in moov point into the real
    layout. Rewriting ftyp+moov+mdat breaks decode. Instead write:
      [head bytes at offset 0] ... hole ... [tail bytes at end]
    with file size = full_size so moov offsets stay valid.
    """
    try:
        with open(head_path, "rb") as f:
            head = f.read()
        with open(tail_path, "rb") as f:
            tail = f.read()
        if len(head) < 32:
            return False
        # Progressive file: moov already in head — just use head
        if b"moov" in head and (full_size <= 0 or full_size <= len(head) * 2):
            with open(out_path, "wb") as out:
                out.write(head)
            return True
        if full_size <= 0:
            # Unknown size: try raw concat (last resort)
            with open(out_path, "wb") as out:
                out.write(head)
                if tail:
                    out.write(tail)
            return os.path.getsize(out_path) > 128
        if len(tail) < 32:
            with open(out_path, "wb") as out:
                out.write(head)
            return True
        # P2: skip multi-hundred-MB sparse prealloc (disk + fsutil cost)
        if int(full_size) > SPARSE_SAMPLE_MAX_BYTES:
            with open(out_path, "wb") as out:
                out.write(head)
                if tail:
                    out.write(tail)
            return os.path.getsize(out_path) > 128
        # Ensure tail doesn't overlap head incorrectly
        if len(head) + len(tail) > full_size:
            # Shrink head prefer keeping tail (moov)
            head = head[: max(64 * 1024, full_size - len(tail))]
        try:
            if os.path.isfile(out_path):
                os.remove(out_path)
        except OSError:
            pass
        with open(out_path, "wb") as out:
            out.truncate(full_size)
        _mark_file_sparse_windows(out_path, full_size)
        with open(out_path, "r+b") as out:
            out.seek(0)
            out.write(head)
            out.seek(full_size - len(tail))
            out.write(tail)
        return os.path.getsize(out_path) == full_size
    except Exception as e:
        try:
            print(f"[drive_fs] sparse mp4 sample fail: {e}", flush=True)
        except Exception:
            pass
        return False


def _ffmpeg_frame_from_file_sync(
    video_path: str,
    out_path: str,
    max_edge: int = 420,
    partial: bool = False,
) -> Optional[bytes]:
    """
    Sync ffmpeg frame extract.
    partial=True: tolerate truncated/stream samples (exotic codecs, moov incomplete).
    """
    try:
        import subprocess

        import imageio_ffmpeg

        if not os.path.isfile(video_path) or os.path.getsize(video_path) < 64:
            return None
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        vf = (
            f"scale='min({int(max_edge)},iw)':-2:force_original_aspect_ratio=decrease,"
            f"format=yuv420p"
        )
        # Sparse samples must fail fast; the grid may request many posters at
        # once. Successful decode keeps the same output edge and JPEG quality.
        probe = "3M" if partial else "12M"
        # -update 1 required for single JPEG (else image2 muxer can write 0 bytes)
        common_out = [
            "-an",
            "-frames:v",
            "1",
            "-update",
            "1",
            "-vf",
            vf,
            "-q:v",
            "5",
            out_path,
        ]
        common_in = [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-probesize",
            probe,
            "-analyzeduration",
            probe,
            "-fflags",
            "+genpts+igndts+discardcorrupt",
            "-err_detect",
            "ignore_err",
        ]
        attempts: List[List[str]] = []
        if partial:
            attempts = [
                # Decode from start (sparse moov-at-end or progressive)
                common_in + ["-i", video_path] + common_out,
                common_in + ["-ss", "0.3", "-i", video_path] + common_out,
            ]
        else:
            attempts = [
                common_in + ["-ss", "0.5", "-i", video_path] + common_out,
                common_in + ["-i", video_path, "-ss", "0.2"] + common_out,
                common_in + ["-i", video_path] + common_out,
            ]

        for args in attempts:
            try:
                if os.path.isfile(out_path):
                    try:
                        os.remove(out_path)
                    except OSError:
                        pass
                # Must include ffmpeg binary as argv[0]
                cmd = [ff, *args]
                subprocess.run(
                    cmd,
                    check=True,
                    timeout=4 if partial else 20,
                    capture_output=True,
                )
                if os.path.isfile(out_path) and os.path.getsize(out_path) > 16:
                    with open(out_path, "rb") as f:
                        data = f.read()
                    if data and len(data) > 16:
                        return data
            except Exception:
                continue
    except Exception:
        return None
    return None


def _thumb_nosample_path(key: str) -> str:
    """Marker: stream-sample already failed recently — do not re-burn data quota."""
    return os.path.join(THUMB_DIR, f"{key}.nosample")


def _thumb_nosample_active(key: str, *, max_age_s: int = 2 * 3600) -> bool:
    """Soft-fail window: 2h (was 24h) so Refresh / later load can retry."""
    path = _thumb_nosample_path(key)
    try:
        if not os.path.isfile(path):
            return False
        age = time.time() - os.path.getmtime(path)
        if age > max_age_s:
            try:
                os.remove(path)
            except OSError:
                pass
            return False
        return True
    except OSError:
        return False


def _mark_thumb_nosample(key: str) -> None:
    try:
        os.makedirs(THUMB_DIR, exist_ok=True)
        open(_thumb_nosample_path(key), "wb").close()
    except OSError:
        pass


def clear_thumb_nosample(key: str) -> None:
    try:
        p = _thumb_nosample_path(_stream_sample_base_key(key))
        if os.path.isfile(p):
            os.remove(p)
    except OSError:
        pass


def _stream_sample_base_key(key: str) -> str:
    """Strip quality suffix so nosample is shared across saver/balanced/sharp."""
    parts = key.rsplit(".", 1)
    if len(parts) == 2 and parts[1] in ("saver", "balanced", "sharp", "lite"):
        return parts[0]
    return key


async def _thumb_from_stream_sample(
    client: TelegramClient,
    msg,
    *,
    key: str,
    max_edge: int,
    quality: str = "balanced",
) -> Optional[bytes]:
    """
    Grid thumb for videos WITHOUT Telegram static thumbs.

    Escalating sample (document / re-encode mp4 often need larger head+tail):
      1. Reuse local preview cache
      2. Lean head (~0.7–1.5 MB) + optional tail (moov-at-end)
      3. Medium pass: larger head+tail (typical for 100MB+ file-as-document)
      4. Tiny whole-file only if total ≤ 6 MB
      5. On total failure: .nosample for 2h (not 24h)
    """
    total = _doc_total_size(msg)
    base_key = _stream_sample_base_key(key)
    sample_key = base_key

    if _thumb_nosample_active(sample_key):
        return None

    # Head + tail budgets. Tail must cover full moov (~1MB on long re-encodes).
    if quality == "saver":
        tiers = [
            (384 * 1024, 1024 * 1024),
            (1536 * 1024, 1536 * 1024),
        ]
    elif quality == "sharp":
        tiers = [
            (768 * 1024, 1536 * 1024),
            (2 * 1024 * 1024, 2 * 1024 * 1024),
        ]
    else:
        tiers = [
            (512 * 1024, 1536 * 1024),
            (2 * 1024 * 1024, 2 * 1024 * 1024),
        ]

    tmp_vid = os.path.join(THUMB_DIR, f"{base_key}.stream_sample.mp4")
    tmp_tail = os.path.join(THUMB_DIR, f"{base_key}.stream_tail.bin")
    tmp_sparse = os.path.join(THUMB_DIR, f"{base_key}.stream_sparse.mp4")
    tmp_frame = os.path.join(THUMB_DIR, f"{base_key}.stream_sample.jpg")
    temps = [tmp_vid, tmp_tail, tmp_sparse, tmp_frame]

    def _cleanup_temps() -> None:
        for p in temps:
            try:
                if os.path.isfile(p):
                    os.remove(p)
            except OSError:
                pass

    # 0) Reuse progressive preview / stream cache — zero extra data
    try:
        if os.path.isdir(PREVIEW_DIR):
            for name in os.listdir(PREVIEW_DIR):
                if not name.startswith(base_key + "."):
                    continue
                if ".tmp" in name:
                    continue
                path = os.path.join(PREVIEW_DIR, name)
                try:
                    sz = os.path.getsize(path)
                except OSError:
                    continue
                if sz < 64 * 1024:
                    continue
                frame = await asyncio.to_thread(
                    _ffmpeg_frame_from_file_sync,
                    path,
                    tmp_frame,
                    max_edge,
                    True,
                )
                if frame:
                    return frame
    except Exception:
        pass

    async def _try_decode(path: str) -> Optional[bytes]:
        if not path or not os.path.isfile(path):
            return None
        try:
            if os.path.getsize(path) < 24 * 1024:
                return None
        except OSError:
            return None
        return await asyncio.to_thread(
            _ffmpeg_frame_from_file_sync, path, tmp_frame, max_edge, True
        )

    async def _pass(head_budget: int, tail_budget: int) -> Optional[bytes]:
        _cleanup_temps()
        hb = head_budget
        tb = tail_budget
        if 0 < total <= hb:
            hb = total
            tb = 0
        written = await _download_media_prefix(
            client,
            msg,
            tmp_vid,
            max_bytes=hb,
            request_size=256 * 1024,
        )
        if written >= 32 * 1024:
            frame = await _try_decode(tmp_vid)
            if frame:
                return frame

        # moov-at-end: keep ORIGINAL offsets via sparse head+tail file
        if total > hb and written >= 24 * 1024 and tb > 0:
            tail_off = max(0, total - tb)
            head_sz = os.path.getsize(tmp_vid) if os.path.isfile(tmp_vid) else 0
            if tail_off < head_sz:
                tail_off = head_sz
            tail_len = min(tb, max(0, total - tail_off))
            if tail_len >= 16 * 1024:
                tw = await _download_media_range(
                    client,
                    msg,
                    tmp_tail,
                    offset=tail_off,
                    max_bytes=tail_len,
                    request_size=256 * 1024,
                    file_size=total,
                )
                if tw >= 16 * 1024 and os.path.isfile(tmp_vid):
                    ok = await asyncio.to_thread(
                        _build_sparse_mp4_sample,
                        tmp_vid,
                        tmp_tail,
                        tmp_sparse,
                        full_size=total,
                    )
                    if ok:
                        frame = await _try_decode(tmp_sparse)
                        if frame:
                            return frame
        return None

    try:
        # Small whole file — best quality thumb
        if 0 < total <= 2 * 1024 * 1024:
            try:
                _cleanup_temps()
                got = await client.download_media(msg, file=tmp_vid)
                if got and os.path.isfile(str(got)):
                    frame = await _try_decode(str(got))
                    if frame:
                        return frame
            except Exception:
                pass

        for i, (hb, tb) in enumerate(tiers):
            try:
                frame = await _pass(hb, tb)
                if frame:
                    return frame
            except FloodWaitError:
                raise
            except Exception as e:
                try:
                    print(
                        f"[drive_fs] stream-sample tier{i + 1} fail: {e}",
                        flush=True,
                    )
                except Exception:
                    pass

        _mark_thumb_nosample(sample_key)
        try:
            print(
                f"[drive_fs] stream-sample exhausted size={total} key={sample_key}",
                flush=True,
            )
        except Exception:
            pass
        return None
    except FloodWaitError:
        raise
    except Exception as e:
        try:
            print(f"[drive_fs] stream-sample fail: {e}", flush=True)
        except Exception:
            pass
        _mark_thumb_nosample(sample_key)
        return None
    finally:
        _cleanup_temps()


def _select_light_thumb(
    msg,
    target_edge: int = THUMB_MAX_EDGE,
    *,
    prefer: int = 0,
) -> Any:
    """
    Pick a Telegram PhotoSize/Document thumb for the grid.

    prefer:
      0 (saver)    — smallest that still meets a soft floor (quota)
      1 (balanced) — closest to target_edge (not the tiniest)
      2 (sharp)    — largest available near/above target (clarity)

    Returns PhotoSize-like object, int index, or None.
    """
    sizes = _collect_telegram_thumbs(msg)
    if not sizes:
        # No static thumbs — never return int indices (would risk full-file download)
        return None
    scored: List[tuple] = []
    for i, s in enumerate(sizes):
        edge = _size_long_edge(s)
        name = type(s).__name__
        # PhotoCachedSize / Stripped often tiny — keep as last resort only
        if edge <= 0 and ("Cached" in name or "Stripped" in name):
            edge = 80 if "Stripped" in name else 160
        if edge <= 0:
            edge = 1  # unknown → deprioritize for sharp
        scored.append((edge, i, s, name))
    scored.sort(key=lambda t: t[0])  # ascending by edge

    floor = max(96, int(target_edge * (0.55 if prefer >= 2 else 0.72)))
    # Exclude stripped/cached when we want sharp unless nothing else exists
    real = [t for t in scored if "Stripped" not in t[3] and "Cached" not in t[3]]
    pool = real if real else scored

    if prefer >= 2:
        # Jelas: always the largest real PhotoSize (never mid/small layer).
        # Floor is only used to warn caller when everything is tiny — still return biggest.
        return pool[-1][2]

    if prefer == 1:
        # Seimbang: closest to target_edge, prefer slightly larger than smaller
        best = min(pool, key=lambda t: (abs(t[0] - target_edge), -t[0]))
        if best[0] >= floor or best[0] >= 200:
            return best[2]
        over = [t for t in pool if t[0] >= floor]
        if over:
            return over[0][2]
        return pool[-1][2]

    # Hemat: smallest that meets floor
    good = [t for t in pool if t[0] >= floor and t[0] <= target_edge * 1.4]
    if good:
        return good[0][2]
    over = [t for t in pool if t[0] >= floor]
    if over:
        return over[0][2]
    return pool[-1][2]


def _image_long_edge_from_bytes(raw: bytes) -> int:
    """Long edge of an image payload, or 0 if unreadable."""
    if not raw or len(raw) < 24:
        return 0
    try:
        from PIL import Image  # type: ignore
        import io

        im = Image.open(io.BytesIO(raw))
        w, h = im.size
        return max(int(w or 0), int(h or 0))
    except Exception:
        return 0


def _robust_decode_image(raw: bytes) -> Any:
    from PIL import Image, UnidentifiedImageError
    import io
    import os
    
    # 1. Try standard PIL decode
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()  # Force load to catch truncated/corrupt files
        return im
    except Exception:
        pass
        
    # 2. Try CMYK JPEG handling
    if raw[:3] == b'\xff\xd8\xff':
        try:
            im = Image.open(io.BytesIO(raw))
            if im.mode == 'CMYK':
                rgb_im = Image.new('RGB', im.size, (255, 255, 255))
                rgb_im.paste(im, mask=im.split()[-1] if len(im.split()) > 3 else None)
                return rgb_im
        except Exception:
            pass
            
    # 3. Try Truncate recovery (corrupt download)
    # JPEG
    if raw[:2] == b'\xff\xd8':
        eoi_pos = raw.rfind(b'\xff\xd9')
        if eoi_pos > 0:
            try:
                fixed = raw[:eoi_pos + 2]
                im = Image.open(io.BytesIO(fixed))
                im.load()
                return im
            except Exception:
                pass
    # PNG
    if raw[:8] == b'\x89PNG\r\n\x1a\n':
        iend_pos = raw.find(b'IEND')
        if iend_pos > 0:
            try:
                fixed = raw[:iend_pos + 8]
                im = Image.open(io.BytesIO(fixed))
                im.load()
                return im
            except Exception:
                pass
                
    # 4. Try FFmpeg decode (exotic formats like WebP, HEIC, etc.)
    try:
        import subprocess
        import tempfile
        import imageio_ffmpeg
        
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        with tempfile.TemporaryDirectory(prefix="ag_dec_") as td:
            src = os.path.join(td, "in.bin")
            dst = os.path.join(td, "out.png")
            with open(src, "wb") as f:
                f.write(raw)
            cmd = [ff, "-y", "-i", src, "-vframes", "1", dst]
            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=10)
            if os.path.isfile(dst) and os.path.getsize(dst) > 0:
                im = Image.open(dst)
                im.load()
                return im
    except Exception:
        pass
        
    # 5. Generate colored placeholder from hash as final fallback
    import hashlib
    h = hashlib.md5(raw[:1024]).hexdigest()[:6]
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return Image.new('RGB', (320, 320), (r, g, b))


def _optimize_thumb_bytes(
    raw: bytes,
    *,
    quality: Optional[str] = None,
    is_video: bool = False,
) -> bytes:
    """
    Resize + re-encode to compact JPEG for grid display.
    Profile-aware: saver / balanced / sharp. Video uses higher edge.
    Robust: decodes CMYK, corrupts, and WebP/HEIC via FFmpeg, with aggressive fallback compression.
    """
    if not raw:
        return raw
    prof = _thumb_profile(quality)
    qname = _normalize_thumb_quality(quality)
    max_edge = int(prof["video_edge"] if is_video else prof["edge"])
    q = int(prof["q"])
    q_min = int(prof["q_min"])
    target = int(prof["target"])
    hard_max = int(prof["max"])
    if is_video:
        target = int(target * 1.2)
        hard_max = int(hard_max * 1.15)
    if qname == "sharp":
        hard_max = int(hard_max * 1.1)

    # 1) Pillow path
    try:
        from PIL import Image  # type: ignore
        import io

        im = _robust_decode_image(raw)
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        elif im.mode == "L":
            im = im.convert("RGB")
        w, h = im.size
        edge = max(w, h)
        is_jpeg = raw[:2] == b"\xff\xd8"

        # Lean Jelas: pass-through compact TG JPEG already near target size
        if qname == "sharp" and is_jpeg and 16 < len(raw) <= hard_max:
            # Good enough if within ~15% of target edge or already small payload
            if edge >= int(max_edge * 0.85) and edge <= max_edge:
                return raw
            if edge >= 280 and len(raw) <= target * 1.15 and edge <= max_edge:
                return raw

        did_downscale = False
        # Never upscale
        if edge > max_edge:
            scale = max_edge / float(edge)
            nw = max(1, int(round(w * scale)))
            nh = max(1, int(round(h * scale)))
            try:
                resample = Image.Resampling.LANCZOS  # type: ignore[attr-defined]
            except Exception:
                resample = Image.LANCZOS  # type: ignore[attr-defined]
            im = im.resize((nw, nh), resample)
            did_downscale = True

        # Mild unsharp: helps TG layers look crisp after re-encode (lean path)
        try:
            from PIL import ImageFilter  # type: ignore

            if qname == "sharp" and (did_downscale or edge >= 240):
                im = im.filter(ImageFilter.UnsharpMask(radius=0.6, percent=115, threshold=2))
            elif is_video and max_edge >= 360 and edge >= 200:
                im = im.filter(ImageFilter.UnsharpMask(radius=0.55, percent=110, threshold=2))
            elif qname != "sharp" and did_downscale and edge >= 280:
                im = im.filter(ImageFilter.UnsharpMask(radius=0.5, percent=100, threshold=3))
        except Exception:
            pass

        buf = io.BytesIO()
        im.save(
            buf,
            format="JPEG",
            quality=q,
            optimize=True,
            progressive=(qname != "sharp"),
            subsampling=0 if qname == "sharp" else 2,
        )
        data = buf.getvalue()

        if qname != "sharp" and len(data) > target * 1.6:
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=q_min, optimize=True, progressive=True)
            data = buf.getvalue()
        elif qname == "sharp" and len(data) > hard_max:
            buf = io.BytesIO()
            im.save(
                buf,
                format="JPEG",
                quality=max(q_min, 84),
                optimize=True,
                progressive=False,
                subsampling=0,
            )
            data = buf.getvalue()
        # Lean: compress toward target if still heavy
        elif qname == "sharp" and len(data) > target * 1.8:
            buf = io.BytesIO()
            im.save(
                buf,
                format="JPEG",
                quality=max(q_min, 86),
                optimize=True,
                progressive=False,
                subsampling=0,
            )
            data2 = buf.getvalue()
            if data2 and len(data2) < len(data):
                data = data2

        # Aggressive compression fallback before giving up (Smart Cache target)
        if data and len(data) > hard_max:
            try:
                # 1. Resize to max 320x320
                w, h = im.size
                if max(w, h) > 320:
                    try:
                        resample = Image.Resampling.LANCZOS
                    except Exception:
                        resample = Image.LANCZOS
                    im.thumbnail((320, 320), resample)
                buf = io.BytesIO()
                rgb_im = im.convert("RGB")
                # 2. Save with quality 60
                rgb_im.save(buf, format="JPEG", quality=60, optimize=True)
                data = buf.getvalue()
                
                # 3. If STILL > hard_max, resize to 160x160 and save with quality 40 (last resort)
                if len(data) > hard_max:
                    try:
                        resample = Image.Resampling.LANCZOS
                    except Exception:
                        resample = Image.LANCZOS
                    im.thumbnail((160, 160), resample)
                    buf = io.BytesIO()
                    rgb_im = im.convert("RGB")
                    rgb_im.save(buf, format="JPEG", quality=40, optimize=True)
                    data = buf.getvalue()
            except Exception:
                pass

        if data and len(data) <= hard_max:
            return data
        if data and len(data) < len(raw) and len(data) <= hard_max * 1.2:
            return data
        if qname == "sharp" and 16 < len(raw) <= hard_max:
            return raw
    except Exception:
        pass

    # 2) ffmpeg path
    if len(raw) > target:
        try:
            import subprocess
            import tempfile

            import imageio_ffmpeg

            ff_q = (
                7
                if qname == "saver"
                else (5 if qname == "balanced" else 4)
            )
            ff = imageio_ffmpeg.get_ffmpeg_exe()
            with tempfile.TemporaryDirectory(prefix="ag_thumb_") as td:
                src = os.path.join(td, "in.bin")
                dst = os.path.join(td, "out.jpg")
                with open(src, "wb") as f:
                    f.write(raw)
                # flags=+accurate_rnd+full_chroma_int for sharper downscale
                vf = (
                    f"scale='min({max_edge},iw)':-2:flags=lanczos+accurate_rnd+full_chroma_int"
                )
                cmd = [
                    ff,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    src,
                    "-vf",
                    vf,
                    "-frames:v",
                    "1",
                    "-q:v",
                    str(ff_q),
                    dst,
                ]
                subprocess.run(cmd, check=True, timeout=25, capture_output=True)
                if os.path.isfile(dst) and os.path.getsize(dst) > 0:
                    with open(dst, "rb") as f:
                        data = f.read()
                    if data and 0 < len(data) <= hard_max:
                        return data
        except Exception:
            pass

    # 3) Keep original if already under hard cap
    if len(raw) <= hard_max:
        return raw
    return raw[:0]  # signal unusable oversized


def _write_lite_thumb(path: str, data: bytes, *, hard_max: Optional[int] = None) -> bool:
    cap = int(hard_max or THUMB_MAX_BYTES)
    if not data or len(data) > cap:
        return False
    try:
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
        return True
    except OSError:
        return False


def _patch_session_wal(session_file: str) -> None:
    """Enable WAL + high busy_timeout on a Telethon .session SQLite."""
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


def _session_client(session_name: str, api_id: int, api_hash: str) -> TelegramClient:
    session_dir = os.path.join(WORKER_ROOT, "sessions")
    os.makedirs(session_dir, exist_ok=True)
    session_file = os.path.join(session_dir, session_name)
    _patch_session_wal(session_file)
    return TelegramClient(session_file, int(api_id), str(api_hash))


async def _connect(session_name: str, api_id: int, api_hash: str) -> TelegramClient:
    """Connect with retries on SQLite session lock (concurrent workers)."""
    last_err: Optional[Exception] = None
    session_dir = os.path.join(WORKER_ROOT, "sessions")
    session_file = os.path.join(session_dir, session_name)
    for attempt in range(8):
        _patch_session_wal(session_file)
        client = _session_client(session_name, api_id, api_hash)
        try:
            await client.connect()
            if not await client.is_user_authorized():
                await client.disconnect()
                raise RuntimeError("Session not authorized")
            return client
        except Exception as e:
            last_err = e
            msg = str(e).lower()
            try:
                await client.disconnect()
            except Exception:
                pass
            if "locked" in msg or "database is locked" in msg:
                await asyncio.sleep(0.4 + attempt * 0.35)
                continue
            raise
    raise RuntimeError(str(last_err) if last_err else "Session connect failed")


async def _resolve_peer(client: TelegramClient, folder_id: Optional[int]):
    """folder_id None → Saved Messages (me). Else channel/chat id.

    Never leave a bare Telethon PeerChannel stack for the UI — walk dialogs
    (with access_hash) when the session cache is cold, then raise a clear error
    if the peer is not in this account (cross-session location bleed).
    """
    if folder_id is None:
        return await client.get_input_entity("me")
    pid = int(folder_id)
    try:
        return await client.get_input_entity(pid)
    except Exception:
        pass
    # Warm entity cache from recent dialogs (cheap), then retry.
    try:
        await client.get_dialogs(limit=80)
        return await client.get_input_entity(pid)
    except Exception:
        pass
    # Deeper walk: match dialog id (covers more of large libraries once).
    try:
        async for dialog in client.iter_dialogs(limit=400):
            try:
                if int(dialog.id) == pid:
                    return await client.get_input_entity(dialog.entity)
            except Exception:
                continue
    except Exception:
        pass
    raise ValueError(
        f"Could not find the input entity for PeerChannel(channel_id={abs(pid) % 10**12}) "
        f"(peer_id={pid}). Not in this Telegram session — open a chat from the active account list."
    )


def _is_drive_folder_entity(entity) -> bool:
    """True if channel/supergroup looks like a Telegram-Drive folder ([TD]).

    Broadcast *and* megagroup are allowed — create falls back to megagroup when
    broadcast CreateChannel is rejected by Telegram.
    """
    if not isinstance(entity, Channel):
        return False
    # Skip pure gigagroups (huge communities) — not TD folders
    if getattr(entity, "gigagroup", False) and not (
        FOLDER_TITLE_SUFFIX in ((getattr(entity, "title", None) or "") or "")
        or ((getattr(entity, "title", None) or "") or "").rstrip().endswith("[TD]")
    ):
        return False
    title = (getattr(entity, "title", None) or "") or ""
    if FOLDER_TITLE_SUFFIX in title or title.rstrip().endswith("[TD]"):
        return True
    return False


def _folder_display_name(title: str) -> str:
    name = title or "Folder"
    if name.endswith(FOLDER_TITLE_SUFFIX):
        return name[: -len(FOLDER_TITLE_SUFFIX)].strip() or name
    if name.rstrip().endswith("[TD]"):
        return name.rsplit("[TD]", 1)[0].strip() or name
    return name


def _dialog_type(dialog) -> str:
    ent = dialog.entity
    if dialog.is_user:
        return "bot" if getattr(ent, "bot", False) else "user"
    if dialog.is_group:
        return "group"
    if dialog.is_channel:
        if getattr(ent, "megagroup", False) or getattr(ent, "gigagroup", False):
            return "group"
        return "channel"
    return "unknown"


# Extensions for files sent "as document" but that are really photo/video
_IMAGE_EXTS = frozenset(
    {"jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "tif", "tiff", "jfif", "avif"}
)
_VIDEO_EXTS = frozenset(
    {"mp4", "mov", "mkv", "webm", "avi", "m4v", "3gp", "3gpp", "mpeg", "mpg", "ts", "m2ts", "wmv", "flv"}
)
_PDF_EXTS = frozenset({"pdf"})
_TEXT_EXTS = frozenset(
    {
        "txt",
        "json",
        "md",
        "markdown",
        "csv",
        "tsv",
        "log",
        "xml",
        "yaml",
        "yml",
        "ini",
        "cfg",
        "conf",
        "html",
        "htm",
        "css",
        "js",
        "ts",
        "py",
        "rs",
        "go",
        "sql",
        "toml",
        "env",
    }
)
# Caps for document preview / thumb generation (on-demand)
DOC_PREVIEW_MAX_BYTES = 28 * 1024 * 1024
DOC_THUMB_PDF_MAX_BYTES = 12 * 1024 * 1024
DOC_THUMB_TEXT_MAX_BYTES = 256 * 1024


def _media_document(msg):
    """Return document object if message is a document (incl. duck-typed)."""
    media = getattr(msg, "media", None)
    if media is None:
        return None
    if isinstance(media, MessageMediaDocument):
        return getattr(media, "document", None)
    # Duck-type for tests / alternate TL wrappers
    return getattr(media, "document", None)


def _doc_real_filename(msg) -> Optional[str]:
    """Filename from document attributes (not caption)."""
    doc = _media_document(msg)
    if not doc:
        return None
    for attr in getattr(doc, "attributes", []) or []:
        name = getattr(attr, "file_name", None)
        if name:
            return str(name)
    return None


def _doc_has_thumbs(msg) -> bool:
    doc = _media_document(msg)
    if not doc:
        return False
    thumbs = getattr(doc, "thumbs", None) or []
    for t in thumbs:
        name = type(t).__name__
        if "Empty" in name or "Path" in name:
            continue
        return True
    return False


def _icon_type_from_message(msg) -> str:
    """
    Classify media for UI + thumbnails.
    Documents that are actually photos/videos (common when sent "as file")
    are treated as image/video so the grid can show real previews.
    """
    media = getattr(msg, "media", None)
    if media is None:
        if getattr(msg, "message", None) and _extract_url_from_message(msg):
            return "link"
        return "file"
    if isinstance(media, MessageMediaWebPage):
        return "link"
    if isinstance(media, MessageMediaPhoto) or (
        getattr(media, "photo", None) is not None and _media_document(msg) is None
    ):
        return "image"

    doc = _media_document(msg)
    if doc is not None:
        mime = (getattr(doc, "mime_type", None) or "").lower()
        real_name = _doc_real_filename(msg) or ""
        ext = _file_ext(real_name) or ""

        for attr in getattr(doc, "attributes", []) or []:
            # Prefer class name checks + duck-type for video duration field
            if isinstance(attr, DocumentAttributeVideo) or (
                type(attr).__name__ == "DocumentAttributeVideo"
            ):
                return "video"
            if isinstance(attr, DocumentAttributeAudio) or (
                type(attr).__name__ == "DocumentAttributeAudio"
            ):
                return "audio" if not getattr(attr, "voice", False) else "voice"
            # Duck-type: video attrs always have duration + w/h
            if getattr(attr, "round_message", None) is not None and getattr(attr, "duration", None) is not None:
                if getattr(attr, "w", None) is not None:
                    return "video"

        if mime.startswith("image/") or ext in _IMAGE_EXTS:
            return "image"
        if mime.startswith("video/") or ext in _VIDEO_EXTS:
            return "video"
        if mime.startswith("audio/"):
            return "audio"

        # Generic document that still has a Telegram thumb (often image/video file)
        if _doc_has_thumbs(msg) and (
            ext in _IMAGE_EXTS | _VIDEO_EXTS or "image" in mime or "video" in mime
        ):
            return "video" if ext in _VIDEO_EXTS or "video" in mime else "image"

        return "document"
    return "file"


def _message_doc_kind(msg) -> Optional[str]:
    """Return 'pdf' | 'text' | None for document thumbnail / preview classification."""
    doc = _media_document(msg)
    mime = ""
    ext = ""
    if doc is not None:
        mime = (getattr(doc, "mime_type", None) or "").lower()
        ext = (_file_ext(_doc_real_filename(msg) or "") or "").lower()
    else:
        name = _file_name_from_message(msg)
        ext = (_file_ext(name) or "").lower()
        mime = (mimetypes.guess_type(name)[0] or "").lower()
    if mime == "application/pdf" or "pdf" in mime or ext in _PDF_EXTS:
        return "pdf"
    if mime.startswith("text/") or ext in _TEXT_EXTS:
        return "text"
    if any(x in mime for x in ("json", "xml", "yaml", "javascript", "csv")):
        return "text"
    return None


def _message_is_visual(msg) -> bool:
    """True if we should attempt a grid thumbnail (photo / video / PDF page).

    Text/JSON/code are NOT visual for grid — frontend shows FileTypeIcon.
    Content dumps as JPEG look broken on portrait cards and waste quota.
    """
    if msg.media and isinstance(msg.media, MessageMediaWebPage):
        webpage = getattr(msg.media, "webpage", None)
        if webpage and getattr(webpage, "photo", None):
            return True
    icon = _icon_type_from_message(msg)
    if icon in ("image", "video"):
        return True
    # PDF first page only (not raw text snippets)
    if _message_doc_kind(msg) == "pdf":
        return True
    doc = _media_document(msg)
    if not doc:
        return False
    mime = (getattr(doc, "mime_type", None) or "").lower()
    ext = _file_ext(_doc_real_filename(msg) or "") or ""
    if mime.startswith("image/") or mime.startswith("video/"):
        return True
    if ext in _IMAGE_EXTS or ext in _VIDEO_EXTS:
        return True
    if _doc_has_thumbs(msg) and (ext in _IMAGE_EXTS | _VIDEO_EXTS):
        return True
    return False


# Media-ish extensions that must match the real document after re-encode
# (e.g. caption "clip.webm" but DocumentAttributeFilename "clip.mp4")
_MEDIA_EXTS = _IMAGE_EXTS | _VIDEO_EXTS | frozenset(
    {"mp3", "m4a", "ogg", "flac", "wav", "opus", "aac", "wma", "pdf"}
)


def _mime_to_ext(mime: Optional[str]) -> Optional[str]:
    if not mime:
        return None
    m = mime.lower().split(";")[0].strip()
    if m == "image/jpeg" or m == "image/pjpeg":
        return "jpg"
    if m == "image/svg+xml":
        return "svg"
    if m == "video/x-matroska":
        return "mkv"
    if m == "video/quicktime":
        return "mov"
    if m == "audio/mpeg":
        return "mp3"
    guessed = mimetypes.guess_extension(m)
    if not guessed:
        return None
    e = guessed.lstrip(".").lower()
    if e == "jpe":
        e = "jpg"
    return e or None


def _true_file_ext(real_fn: Optional[str], mime: Optional[str], fallback_name: str = "") -> Optional[str]:
    """Authoritative extension: document filename → mime → fallback name."""
    ext = _file_ext(real_fn or "") or None
    if ext:
        return ext
    ext = _mime_to_ext(mime)
    if ext:
        return ext
    return _file_ext(fallback_name) or None


def _reconcile_display_name(
    display: str,
    real_fn: Optional[str],
    mime: Optional[str] = None,
) -> str:
    """
    Fix caption/display names whose extension no longer matches the real file.
    Common after HQ re-encode: caption stays \"video.webm\" while document is .mp4.
    """
    if not display:
        return real_fn or display or ""
    true_ext = _true_file_ext(real_fn, mime, display)
    if not true_ext:
        return display
    disp_ext = _file_ext(display)
    # Caption has no extension → append real one (existing Drive rename model)
    if not disp_ext:
        return f"{display}.{true_ext}"
    # Both media extensions but disagree → trust document / mime
    if (
        disp_ext != true_ext
        and disp_ext in _MEDIA_EXTS
        and true_ext in _MEDIA_EXTS
    ):
        # Replace trailing .old with .true (case-insensitive)
        lower = display.lower()
        suffix = "." + disp_ext
        if lower.endswith(suffix):
            return display[: -len(suffix)] + "." + true_ext
        return f"{display}.{true_ext}"
    return display


def _file_name_from_message(msg) -> str:
    caption = (msg.message or "").strip()
    media = msg.media
    if isinstance(media, MessageMediaPhoto):
        if caption:
            return _reconcile_display_name(caption, None, "image/jpeg")
        return f"Photo_{msg.id}.jpg"
    if isinstance(media, MessageMediaDocument):
        doc = media.document
        filename = _doc_real_filename(msg)
        mime = (getattr(doc, "mime_type", None) or None) if doc else None
        if caption:
            # Prefer caption as display name (Telegram-Drive rename model),
            # but never keep a stale media extension after re-encode.
            return _reconcile_display_name(caption, filename, mime)
        if filename:
            return filename
        mime = mime or "application/octet-stream"
        ext = mimetypes.guess_extension(mime) or ".bin"
        return f"File_{msg.id}{ext}"
    return caption or f"Message_{msg.id}"


def _file_size(msg) -> int:
    media = msg.media
    if isinstance(media, MessageMediaDocument) and media.document:
        return int(getattr(media.document, "size", 0) or 0)
    if isinstance(media, MessageMediaPhoto):
        # Approximate from largest size if available
        try:
            sizes = media.photo.sizes if media.photo else []
            best = 0
            for s in sizes or []:
                best = max(best, int(getattr(s, "size", 0) or 0))
            return best
        except Exception:
            return 0
    return 0


def _file_ext(name: str) -> Optional[str]:
    _, ext = os.path.splitext(name or "")
    return ext.lstrip(".").lower() if ext else None


def _mime_from_message(msg) -> Optional[str]:
    media = msg.media
    if isinstance(media, MessageMediaPhoto):
        return "image/jpeg"
    if isinstance(media, MessageMediaDocument) and media.document:
        return getattr(media.document, "mime_type", None)
    return None


def _play_mime_for_preview(msg, *, is_video: bool, is_image: bool, ext: str) -> str:
    """
    Content-Type for progressive <video>/<img>.

    Telegram document-originals often ship as application/octet-stream.
    Browsers refuse progressive play/seek when Content-Type is not video/*.
    """
    raw = (_mime_from_message(msg) or "").lower().strip()
    guessed = (mimetypes.guess_type(f"x.{ext}")[0] or "").lower()
    if is_video:
        if raw.startswith("video/"):
            return raw
        if guessed.startswith("video/"):
            return guessed
        # Common container by extension
        if ext in ("mov", "qt"):
            return "video/quicktime"
        if ext in ("webm",):
            return "video/webm"
        if ext in ("mkv",):
            return "video/x-matroska"
        return "video/mp4"
    if is_image:
        if raw.startswith("image/"):
            return raw
        if guessed.startswith("image/"):
            return guessed
        return "image/jpeg"
    return raw or guessed or "application/octet-stream"


def _is_complete_media_file(path: str, expected_size: int = 0) -> bool:
    """
    True only if path is a real complete media file — not a sparse progressive
    shell (moov-at-end bootstrap extends size to total with a hollow middle).
    """
    try:
        if not path or not os.path.isfile(path):
            return False
        disk = int(os.path.getsize(path) or 0)
        if disk < 64:
            return False
        if expected_size > 0 and disk < max(64, int(expected_size * 0.98)):
            return False
        # Sparse / hollow middle: file length matches total but mid is zeros
        if disk >= 256 * 1024:
            mid = max(0, (disk // 2) - 4096)
            with open(path, "rb") as f:
                f.seek(0)
                head = f.read(min(64 * 1024, disk))
                f.seek(mid)
                mid_sample = f.read(8192)
            if not head or len(head) < 32:
                return False
            # MP4-ish: need ftyp/moov somewhere; mid must have real payload
            if mid_sample is not None and len(mid_sample) >= 64:
                if not any(b != 0 for b in mid_sample):
                    return False
        return True
    except OSError:
        return False


def _media_duration_seconds(msg) -> Optional[int]:
    """
    Video / audio / voice duration in whole seconds.
    Sources (in order):
      1) Telethon convenience msg.file.duration
      2) DocumentAttributeVideo / DocumentAttributeAudio
      3) Duck-typed attributes with duration + video-like fields
    """
    def _as_secs(raw) -> Optional[int]:
        if raw is None:
            return None
        try:
            v = float(raw)
            if v <= 0 or v > 86400 * 24:  # 0 = missing/unknown for long files
                return None
            return int(round(v))
        except Exception:
            return None

    # 1) Telethon custom Message.file helper
    try:
        f = getattr(msg, "file", None)
        if f is not None:
            s = _as_secs(getattr(f, "duration", None))
            if s is not None:
                return s
    except Exception:
        pass

    # 2–3) Document attributes
    doc = _media_document(msg)
    if not doc:
        return None
    try:
        for attr in getattr(doc, "attributes", []) or []:
            d = getattr(attr, "duration", None)
            if d is None:
                continue
            name = type(attr).__name__
            is_video_attr = (
                isinstance(attr, DocumentAttributeVideo)
                or "Video" in name
                or (
                    getattr(attr, "w", None) is not None
                    and getattr(attr, "h", None) is not None
                )
            )
            is_audio_attr = isinstance(attr, DocumentAttributeAudio) or "Audio" in name
            if is_video_attr or is_audio_attr:
                s = _as_secs(d)
                if s is not None:
                    return s
            # Fallback: positive duration alone on unknown attr (rare)
            s = _as_secs(d)
            if s is not None and s > 0 and (is_video_attr or is_audio_attr):
                return s
    except Exception:
        return None
    return None


def _video_dimensions(msg) -> tuple:
    """Return (width, height) from DocumentAttributeVideo / Telethon file helper."""
    try:
        f = getattr(msg, "file", None)
        if f is not None:
            w = int(getattr(f, "width", 0) or 0)
            h = int(getattr(f, "height", 0) or 0)
            if w > 0 and h > 0:
                return w, h
    except Exception:
        pass
    doc = _media_document(msg)
    if not doc:
        return 0, 0
    for attr in getattr(doc, "attributes", []) or []:
        w = int(getattr(attr, "w", 0) or getattr(attr, "width", 0) or 0)
        h = int(getattr(attr, "h", 0) or getattr(attr, "height", 0) or 0)
        if w > 0 and h > 0:
            return w, h
    return 0, 0


def _doc_supports_streaming(msg) -> Optional[bool]:
    """
    Telegram DocumentAttributeVideo.supports_streaming.
    None = unknown (not a video attr / missing flag).
    False = document-style original (often moov-at-end).
    """
    doc = _media_document(msg)
    if not doc:
        return None
    found_video = False
    streaming = None
    for attr in getattr(doc, "attributes", []) or []:
        name = type(attr).__name__
        is_vid = isinstance(attr, DocumentAttributeVideo) or "Video" in name
        if not is_vid and not (
            getattr(attr, "w", None) is not None
            and getattr(attr, "duration", None) is not None
        ):
            continue
        found_video = True
        if hasattr(attr, "supports_streaming"):
            streaming = bool(getattr(attr, "supports_streaming"))
            break
    if not found_video:
        return None
    return streaming


def _ffmpeg_remux_faststart_sync(src: str, dest: str) -> bool:
    """
    Stream-copy remux with +faststart (moov before mdat).
    Cheap (~seconds) vs re-encode; enables seek without full sequential buffer.
    """
    try:
        import subprocess

        import imageio_ffmpeg

        if not os.path.isfile(src) or os.path.getsize(src) < 64:
            return False
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        parent = os.path.dirname(dest)
        if parent:
            os.makedirs(parent, exist_ok=True)
        tmp = dest + ".tmp.mp4"
        try:
            if os.path.isfile(tmp):
                os.remove(tmp)
        except OSError:
            pass
        cmd = [
            ff,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            src,
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            tmp,
        ]
        r = subprocess.run(
            cmd, timeout=180, capture_output=True, text=True, errors="replace"
        )
        if r.returncode != 0 or not os.path.isfile(tmp) or os.path.getsize(tmp) < 64:
            try:
                if os.path.isfile(tmp):
                    os.remove(tmp)
            except OSError:
                pass
            return False
        os.replace(tmp, dest)
        return os.path.isfile(dest) and os.path.getsize(dest) >= 64
    except Exception as e:
        try:
            print(f"[drive_fs] faststart remux fail: {e}", flush=True)
        except Exception:
            pass
        return False


# Playback quality ladder (Telegram-style resolution menu)
_PLAY_QUALITY_IDS = frozenset({"auto", "original", "p1080", "p720", "p480", "p360"})
_PLAY_QUALITY_HEIGHT = {
    "p1080": 1080,
    "p720": 720,
    "p480": 480,
    "p360": 360,
}


def _normalize_play_quality(raw: Optional[str]) -> str:
    s = str(raw or "auto").strip().lower().replace("-", "_")
    aliases = {
        "high": "original",
        "best": "original",
        "source": "original",
        "full": "original",
        "hd": "original",
        "max": "original",
        "asli": "original",
        "otomatis": "auto",
        "medium": "p480",
        "data_saver": "p480",
        "datasaver": "p480",
        "saver": "p480",
        "low": "p360",
        "lowest": "p360",
        "1080": "p1080",
        "1080p": "p1080",
        "720": "p720",
        "720p": "p720",
        "480": "p480",
        "480p": "p480",
        "360": "p360",
        "360p": "p360",
    }
    s = aliases.get(s, s)
    # p1080 with source already ≤1080 → treat as original
    return s if s in _PLAY_QUALITY_IDS else "auto"


def _label_for_height(h: int) -> str:
    if h <= 0:
        return "Asli"
    for mark in (2160, 1440, 1080, 720, 480, 360, 240):
        if h >= mark - 8:
            return f"{mark}p"
    return f"{h}p"


def build_playback_qualities(
    msg,
    *,
    is_video: bool,
    size: int = 0,
) -> List[Dict[str, Any]]:
    """
    Telegram-style resolution menu for video preview.

    Telegram usually ships one file; we expose:
      - Otomatis / Asli (native progressive stream)
      - 1080p / 720p / 480p / 360p when source is taller (local ffmpeg re-encode)

    When dimensions are unknown, still offer a full ladder for larger videos
    so the UI always has resolution controls like Telegram.
    """
    w, h = _video_dimensions(msg)
    native_label = _label_for_height(h) if h else "Asli"

    if not is_video:
        return [
            {
                "id": "auto",
                "label": "Asli",
                "description": "File original",
                "height": h or None,
                "size": size or None,
                "native": True,
                "transcode": False,
            }
        ]

    qualities: List[Dict[str, Any]] = [
        {
            "id": "auto",
            "label": "Otomatis",
            "description": "Seperti Telegram — stream progressive",
            "height": h or None,
            "size": size or None,
            "native": True,
            "transcode": False,
            "recommended": True,
        },
        {
            "id": "original",
            "label": native_label if h else "Asli",
            "description": "Resolusi penuh dari Telegram",
            "height": h or None,
            "size": size or None,
            "native": True,
            "transcode": False,
        },
    ]

    # Ladder mirrors Telegram: only rungs below (or equal when unknown) source
    ladder = [
        ("p1080", 1080, "1080p", "Full HD · konversi lokal"),
        ("p720", 720, "720p", "HD · konversi lokal"),
        ("p480", 480, "480p", "SD · hemat data"),
        ("p360", 360, "360p", "Data saver"),
    ]

    for qid, qh, lab, desc in ladder:
        if h > 0:
            # Source already at/under this rung → skip (use Asli instead)
            if h <= qh + 24:
                continue
            # Don't offer p1080 if native label is already 1080p and nearly same
            if qid == "p1080" and h <= 1100:
                continue
            est = int(size * ((qh / float(h)) ** 2) * 0.88) if size > 0 else None
        else:
            # Unknown dims: still offer Telegram-like menu for mid/large files
            if size > 0 and size < 2 * 1024 * 1024 and qid in ("p1080", "p720"):
                continue
            if size > 0 and size < 512 * 1024:
                continue
            est = int(size * (0.55 if qh >= 720 else 0.35)) if size > 0 else None

        qualities.append(
            {
                "id": qid,
                "label": lab,
                "description": desc,
                "height": qh,
                "size": est,
                "native": False,
                "transcode": True,
            }
        )

    # Guarantee at least Auto + Asli + one lower rung for any real video file
    if len(qualities) < 3 and (size <= 0 or size >= 256 * 1024):
        for qid, qh, lab, desc in [
            ("p480", 480, "480p", "SD · hemat data"),
            ("p360", 360, "360p", "Data saver"),
        ]:
            if any(q["id"] == qid for q in qualities):
                continue
            qualities.append(
                {
                    "id": qid,
                    "label": lab,
                    "description": desc,
                    "height": qh,
                    "size": int(size * 0.3) if size > 0 else None,
                    "native": False,
                    "transcode": True,
                }
            )
            if len(qualities) >= 4:
                break

    return qualities


def _ffmpeg_transcode_max_height(src: str, dest: str, max_height: int) -> None:
    """Re-encode video to max height (libx264 + aac, faststart for progressive play)."""
    import subprocess

    import imageio_ffmpeg

    ff = imageio_ffmpeg.get_ffmpeg_exe()
    # scale height down, keep aspect; never upscale
    vf = f"scale=-2:'min({int(max_height)},ih)'"
    # Priority: Dedicated NVidia -> Dedicated AMD -> CPU fallback
    encoders = [
        ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "28", "-b:v", "0"],
        ["-c:v", "h264_amf", "-quality", "speed"],
        ["-c:v", "libx264", "-preset", "veryfast", "-crf", "28"],
    ]

    last_err = ""
    for enc_args in encoders:
        cmd = [
            ff, "-hide_banner", "-loglevel", "error", "-y", "-i", src,
            "-vf", vf,
            *enc_args,
            "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart",
            dest,
        ]
        try:
            r = subprocess.run(cmd, timeout=900, capture_output=True, text=True, errors="replace")
            if r.returncode == 0 and os.path.isfile(dest) and os.path.getsize(dest) >= 64:
                return
            last_err = (r.stderr or "")[-500:]
        except subprocess.TimeoutExpired:
            last_err = "timeout"
            
        try:
            if os.path.exists(dest):
                os.remove(dest)
        except Exception:
            pass

    if last_err == "timeout":
        raise RuntimeError("Transcode gagal (timeout)")
    raise RuntimeError(f"Transcode gagal pada semua encoder. Last error: {last_err}")


async def _download_media_complete(
    client: TelegramClient,
    msg,
    dest: str,
    *,
    expected_size: int = 0,
) -> str:
    """Full download into dest (used before local quality transcode)."""
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    if os.path.isfile(dest) and os.path.getsize(dest) > 0:
        if expected_size <= 0 or os.path.getsize(dest) >= expected_size * 0.98:
            return dest
    path = await client.download_media(msg, file=dest)
    if not path or not os.path.isfile(path):
        raise RuntimeError("Download sumber gagal")
    return str(path)


_URL_REGEX = re.compile(
    r'(https?://[^\s]+)',
    re.IGNORECASE
)

def _extract_url_from_message(msg) -> Optional[str]:
    # 1. Check message entities first (highly reliable Telegram parser)
    entities = getattr(msg, "entities", None) or []
    for ent in entities:
        if isinstance(ent, MessageEntityUrl):
            offset = getattr(ent, "offset", 0)
            length = getattr(ent, "length", 0)
            if msg.message:
                url = msg.message[offset : offset + length]
                if url:
                    return url
        elif isinstance(ent, MessageEntityTextUrl):
            url = getattr(ent, "url", "")
            if url:
                return url
                
    # 2. Check webpage preview url
    if msg.media and isinstance(msg.media, MessageMediaWebPage):
        webpage = getattr(msg.media, "webpage", None)
        if webpage and isinstance(webpage, WebPage):
            url = getattr(webpage, "url", "")
            if url:
                return url
                
    # 3. Fallback: regex search in message text
    if msg.message:
        match = _URL_REGEX.search(msg.message)
        if match:
            return match.group(1)
            
    return None


def _get_link_title(msg, url: str) -> str:
    if msg.media and isinstance(msg.media, MessageMediaWebPage):
        webpage = getattr(msg.media, "webpage", None)
        if webpage and isinstance(webpage, WebPage):
            title = getattr(webpage, "title", None)
            if title:
                return title
            site = getattr(webpage, "site_name", None)
            if site:
                return site
                
    # Fallback to message text or domain name from URL
    text = getattr(msg, "message", "") or ""
    first_line = text.strip().split("\n")[0].strip()
    if first_line and len(first_line) < 80 and not first_line.startswith("http"):
        return first_line
        
    # Extract domain as fallback
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        netloc = parsed.netloc
        if netloc:
            return netloc
    except Exception:
        pass
        
    return url


def message_to_drive_file(msg, folder_id: Optional[int]) -> Optional[Dict[str, Any]]:
    if not msg:
        return None

    is_link = False
    link_url = ""
    link_title = ""

    # Check if it is a link first
    link_url = _extract_url_from_message(msg)
    if link_url:
        is_link = True
        link_title = _get_link_title(msg, link_url)

    if not is_link:
        if not msg.media or not isinstance(msg.media, (MessageMediaPhoto, MessageMediaDocument)):
            return None

    if is_link:
        created = msg.date
        if created and created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        created_s = created.isoformat() if created else ""

        has_photo = False
        if msg.media and isinstance(msg.media, MessageMediaWebPage):
            webpage = getattr(msg.media, "webpage", None)
            if webpage and getattr(webpage, "photo", None):
                has_photo = True

        out: Dict[str, Any] = {
            "id": int(msg.id),
            "folder_id": folder_id,
            "name": link_title or link_url,
            "size": 0,
            "mime_type": "text/html",
            "file_ext": "link",
            "duration": None,
            "duration_s": None,
            "created_at": created_s,
            "icon_type": "link",
            "has_thumb": has_photo,
            "as_document": False,
            "original_name": link_url,
        }
        return out

    real_fn = _doc_real_filename(msg)
    mime = _mime_from_message(msg)
    name = _file_name_from_message(msg)
    created = msg.date
    if created and created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    created_s = created.isoformat() if created else ""
    duration = _media_duration_seconds(msg)
    icon = _icon_type_from_message(msg)
    # Authoritative ext: document filename / mime first — never caption-only stale .webm
    ext = _true_file_ext(real_fn, mime, name)
    visual = icon in ("image", "video") or _message_is_visual(msg)
    # Sent as document but is photo/video — expose for UI filters/thumbs
    as_document = _media_document(msg) is not None and icon in ("image", "video") and not isinstance(
        getattr(msg, "media", None), MessageMediaPhoto
    )
    # Also emit duration_s alias for clients that expect seconds field name
    out: Dict[str, Any] = {
        "id": int(msg.id),
        "folder_id": folder_id,
        "name": name,
        "size": _file_size(msg),
        "mime_type": mime,
        "file_ext": ext,
        "duration": duration,
        "duration_s": duration,
        "created_at": created_s,
        "icon_type": icon,
        "has_thumb": visual,
        "as_document": as_document,
        "original_name": real_fn,
    }
    return out


def _cache_key(folder_id: Optional[int], message_id: int) -> str:
    fk = "home" if folder_id is None else str(int(folder_id))
    return f"{fk}_{int(message_id)}"


def invalidate_cache(folder_id: Optional[int], message_id: int) -> None:
    key = _cache_key(folder_id, message_id)
    for root in (THUMB_DIR, PREVIEW_DIR):
        if not os.path.isdir(root):
            continue
        for name in os.listdir(root):
            if name.startswith(key + ".") or name.startswith(key + "_"):
                try:
                    os.remove(os.path.join(root, name))
                except OSError:
                    pass


def _disk_thumb_data_url(
    folder_id: Optional[int],
    message_id: int,
    quality: Optional[str] = None,
) -> Optional[str]:
    """Return data URL from disk cache, '' for cached empty/nosample, or None if miss."""
    _ensure_dirs()
    key = _cache_key(folder_id, message_id)
    
    # 1. Check if lite path exists
    path = _thumb_lite_path(folder_id, message_id, quality)
    if os.path.isfile(path) and os.path.getsize(path) > 0:
        prof = _thumb_profile(quality)
        hard_max = int(prof["max"]) * 2  # allow slightly larger cached lite thumbs
        size = os.path.getsize(path)
        if size > hard_max:
            try:
                os.remove(path)
            except OSError:
                pass
            return None
        with open(path, "rb") as f:
            data = f.read()
        return f"data:image/jpeg;base64,{base64.b64encode(data).decode('ascii')}"
        
    # 2. Honor empty markers within their 30-minute TTL
    import time
    for stale in (f"{key}.empty", f"{key}.empty2"):
        sp = os.path.join(THUMB_DIR, stale)
        if os.path.isfile(sp):
            try:
                if time.time() - os.path.getmtime(sp) < 1800:
                    return ""  # Cached empty marker -> return empty string to indicate "no thumbnail"
            except OSError:
                pass
                
    # 3. Honor nosample markers within their 2-hour TTL
    nsp = _thumb_nosample_path(_stream_sample_base_key(key))
    if os.path.isfile(nsp):
        try:
            if time.time() - os.path.getmtime(nsp) < 2 * 3600:
                return ""  # Cached nosample marker -> return empty string to indicate "no thumbnail"
        except OSError:
            pass
            
    return None


def _mark_thumb_empty(folder_id: Optional[int], message_id: int) -> None:
    _ensure_dirs()
    key = _cache_key(folder_id, message_id)
    try:
        open(os.path.join(THUMB_DIR, f"{key}.empty2"), "wb").close()
    except OSError:
        pass


def _parse_parent_id_from_about(about: Optional[str]) -> Optional[int]:
    """Nested TD folders store parent peer id in channel about: parent=-100…"""
    if not about:
        return None
    m = re.search(r"parent=(-?\d+)", str(about))
    if not m:
        return None
    try:
        return int(m.group(1))
    except Exception:
        return None


def _compose_folder_about(parent_id: Optional[int] = None) -> str:
    """Canonical about text for a Drive [TD] folder channel."""
    about = f"Telegram Drive folder {FOLDER_ABOUT_TAG}"
    if parent_id is not None:
        about = f"{about} parent={int(parent_id)}"
    return about


def _would_create_folder_cycle(
    folder_id: int,
    new_parent_id: Optional[int],
    parent_map: Dict[int, Optional[int]],
) -> bool:
    """
    True if setting folder_id's parent to new_parent_id would create a cycle.
    parent_map: peer_id -> parent_id (may omit folder_id's current parent).
    """
    if new_parent_id is None:
        return False
    fid = int(folder_id)
    pid = int(new_parent_id)
    if pid == fid:
        return True
    seen = {fid}
    cur: Optional[int] = pid
    while cur is not None:
        if cur == fid:
            return True
        if cur in seen:
            break
        seen.add(cur)
        cur = parent_map.get(cur)
    return False


def _folder_children_map(parent_map: Dict[int, Optional[int]]) -> Dict[int, List[int]]:
    kids: Dict[int, List[int]] = {}
    for cid, pid in parent_map.items():
        if pid is None:
            continue
        kids.setdefault(int(pid), []).append(int(cid))
    return kids


def _collect_folder_descendants(folder_id: int, parent_map: Dict[int, Optional[int]]) -> List[int]:
    """All descendant peer ids (not including folder_id), BFS order deepest-last friendly (preorder)."""
    kids = _folder_children_map(parent_map)
    out: List[int] = []
    stack = list(kids.get(int(folder_id), []))
    seen = set()
    while stack:
        cur = stack.pop()
        if cur in seen or cur == int(folder_id):
            continue
        seen.add(cur)
        out.append(cur)
        stack.extend(kids.get(cur, []))
    return out


def _enrich_folders_orphan_flags(folders: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Mark folders whose parent_id is set but parent peer is missing from the list."""
    ids = {int(f["id"]) for f in folders if f.get("id") is not None}
    for f in folders:
        pid = f.get("parent_id")
        orphan = pid is not None and int(pid) not in ids and int(pid) != int(f.get("id") or 0)
        f["is_orphan"] = bool(orphan)
    return folders


# Soft warn before Telegram channel ceiling (~500 joined channels for free accounts)
DRIVE_FOLDER_SOFT_LIMIT = 450


# Cache parent_id per channel peer id for the life of the worker process
_FOLDER_PARENT_CACHE: Dict[int, Optional[int]] = {}


async def _folder_parent_id(client: TelegramClient, ent: Any, peer_id: int) -> Optional[int]:
    if peer_id in _FOLDER_PARENT_CACHE:
        return _FOLDER_PARENT_CACHE[peer_id]
    about = getattr(ent, "about", None)
    pid = _parse_parent_id_from_about(about)
    if pid is not None:
        _FOLDER_PARENT_CACHE[peer_id] = pid
        return pid
    try:
        full = await client(functions.channels.GetFullChannelRequest(channel=ent))
        about = getattr(getattr(full, "full_chat", None), "about", None) or ""
        pid = _parse_parent_id_from_about(about)
    except Exception:
        pid = None
    _FOLDER_PARENT_CACHE[peer_id] = pid
    return pid


# TD folder list cache — full dialog walk is expensive on large accounts
_FOLDERS_CACHE: Dict[str, Any] = {"ts": 0.0, "folders": []}
_FOLDERS_CACHE_TTL_S = 90.0


def invalidate_folders_cache() -> None:
    _FOLDERS_CACHE["ts"] = 0.0
    _FOLDERS_CACHE["folders"] = []


async def _scan_folders_on(
    client: TelegramClient,
    *,
    enrich_parents: bool = True,
    use_cache: bool = True,
) -> List[Dict[str, Any]]:
    """
    Scan [TD] drive folders. Nested hierarchy via about parent=-100…

    enrich_parents=False: skip GetFullChannel (fast first paint; flat list).
    use_cache: return recent scan (~90s) to avoid re-walking all dialogs.
    """
    import asyncio

    if use_cache and _FOLDERS_CACHE["folders"]:
        age = time.time() - float(_FOLDERS_CACHE.get("ts") or 0)
        if age < _FOLDERS_CACHE_TTL_S:
            cached = list(_FOLDERS_CACHE["folders"])
            if enrich_parents or all("parent_id" in f for f in cached):
                return [dict(f) for f in cached]

    candidates: List[Dict[str, Any]] = []
    scanned = 0
    async for dialog in client.iter_dialogs():
        scanned += 1
        ent = dialog.entity
        if not _is_drive_folder_entity(ent):
            # Yield so list_chats / list_files can interleave on warm serve
            if scanned % 40 == 0:
                await asyncio.sleep(0)
            continue
        cid = int(dialog.id)
        title = getattr(ent, "title", None) or dialog.name or "Folder"
        username = getattr(ent, "username", None)
        candidates.append(
            {
                "id": cid,
                "name": _folder_display_name(title),
                "title_raw": title,
                "username": username,
                "is_public": bool(username),
                "is_drive_folder": True,
                "_ent": ent,
            }
        )
        if scanned % 40 == 0:
            await asyncio.sleep(0)

    if not enrich_parents:
        folders_list: List[Dict[str, Any]] = []
        for c in candidates:
            row = dict(c)
            row.pop("_ent", None)
            row.setdefault("parent_id", None)
            folders_list.append(row)
        folders_list.sort(key=lambda f: (f.get("name") or "").lower())
        out = _enrich_folders_orphan_flags(folders_list)
        _FOLDERS_CACHE["folders"] = [dict(f) for f in out]
        _FOLDERS_CACHE["ts"] = time.time()
        return out

    # Parallel parent lookups (bounded) — GetFullChannel for about parent=
    sem = asyncio.Semaphore(5)

    async def enrich(row: Dict[str, Any]) -> Dict[str, Any]:
        ent = row.pop("_ent", None)
        async with sem:
            parent_id = await _folder_parent_id(client, ent, int(row["id"])) if ent is not None else None
        row["parent_id"] = parent_id
        return row

    folders = await asyncio.gather(*(enrich(dict(c)) for c in candidates))
    folders_list = list(folders)
    folders_list.sort(key=lambda f: (f.get("name") or "").lower())
    out = _enrich_folders_orphan_flags(folders_list)
    _FOLDERS_CACHE["folders"] = [dict(f) for f in out]
    _FOLDERS_CACHE["ts"] = time.time()
    return out


async def _list_chats_on(
    client: TelegramClient,
    *,
    limit: int = 100,
    offset: int = 0,
    offset_id: int = 0,
    offset_date: Any = None,
    offset_peer_id: Optional[int] = None,
    chat_folder_id: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Page dialogs for sidebar (scale to 1k–10k+ chats).

    Prefer Telethon *cursor* (offset_date / offset_id / offset_peer) so we do NOT
    re-scan thousands of dialogs on every page (skip-N is O(n²) and freezes UI).
    Legacy `offset` skip is only used when no cursor is provided and offset>0
    (compat); first page and cursor pages are fast.
    """
    # Allow up to 300 per page (UI bulk load uses ~100; never hard-cap library at 100)
    page = max(1, min(int(limit or 100), 300))
    skip = max(0, int(offset or 0))
    oid = int(offset_id or 0)
    chats: List[Dict[str, Any]] = []
    has_more = False
    last_dialog = None
    selected_filter = None
    if chat_folder_id not in (None, 0):
        selected_filter = await _get_chat_filter_on(client, int(chat_folder_id))

    # Sparse custom filters may need several underlying Telegram dialog pages
    # before a visible page is full. Cursor is always based on the last scanned
    # dialog, so no O(n²) skip is introduced.
    scan_limit = page + 1 if selected_filter is None else min(2000, max(page * 12, 240))
    iter_kwargs: Dict[str, Any] = {"limit": scan_limit}
    use_cursor = bool(oid or offset_date is not None or offset_peer_id is not None)
    if use_cursor:
        if oid:
            iter_kwargs["offset_id"] = oid
        if offset_date is not None:
            # Accept ISO string or datetime
            if isinstance(offset_date, str) and offset_date:
                try:
                    from datetime import datetime

                    iter_kwargs["offset_date"] = datetime.fromisoformat(
                        offset_date.replace("Z", "+00:00")
                    )
                except Exception:
                    pass
            else:
                iter_kwargs["offset_date"] = offset_date
        if offset_peer_id is not None:
            try:
                iter_kwargs["offset_peer"] = await client.get_input_entity(
                    int(offset_peer_id)
                )
            except Exception:
                try:
                    iter_kwargs["offset_peer"] = await _resolve_peer(
                        client, int(offset_peer_id)
                    )
                except Exception:
                    pass
    elif skip > 0:
        # Slow path — only for old clients; avoid for large libraries
        pass

    seen_skip = 0
    scanned = 0
    async for dialog in client.iter_dialogs(**iter_kwargs):
        if not use_cursor and skip > 0 and seen_skip < skip:
            seen_skip += 1
            continue
        last_dialog = dialog
        scanned += 1
        if selected_filter is not None and not _dialog_matches_chat_filter(dialog, selected_filter):
            continue
        if len(chats) >= page:
            has_more = True
            break
        try:
            ent = dialog.entity
            cid = int(dialog.id)
            name = (
                dialog.name
                or getattr(ent, "title", None)
                or getattr(ent, "first_name", None)
                or str(cid)
            )
            is_td = _is_drive_folder_entity(ent)
            is_forum = bool(getattr(ent, "forum", False))
            chats.append(
                {
                    "id": cid,
                    "name": _folder_display_name(name) if is_td else name,
                    "title_raw": name,
                    "type": _dialog_type(dialog),
                    "is_drive_folder": is_td,
                    "is_forum": is_forum,
                    "username": getattr(ent, "username", None),
                }
            )
        except Exception:
            continue

    # A sparse Telegram filter can consume the bounded scan window before it
    # fills one UI page. Preserve the underlying cursor so the next request can
    # continue instead of incorrectly declaring the folder exhausted.
    if selected_filter is not None and scanned >= scan_limit and last_dialog is not None:
        has_more = True

    # Build next-page cursor from last dialog (Telethon GetDialogs)
    next_offset_id = 0
    next_offset_date: Optional[str] = None
    next_offset_peer_id: Optional[int] = None
    if last_dialog is not None and has_more:
        try:
            msg = getattr(last_dialog, "message", None)
            next_offset_id = int(getattr(msg, "id", 0) or 0) if msg is not None else 0
        except Exception:
            next_offset_id = 0
        try:
            dt = getattr(last_dialog, "date", None)
            if dt is not None:
                next_offset_date = dt.isoformat()
        except Exception:
            next_offset_date = None
        try:
            next_offset_peer_id = int(last_dialog.id)
        except Exception:
            next_offset_peer_id = None

    next_skip = (skip if not use_cursor else 0) + len(chats)
    return {
        "chats": chats,
        "total": len(chats),
        "page_size": page,
        "offset": skip if not use_cursor else 0,
        "next_offset": next_skip,
        "has_more": has_more,
        # Cursor for O(1) next page (preferred over next_offset skip)
        "next_offset_id": next_offset_id or None,
        "next_offset_date": next_offset_date,
        "next_offset_peer_id": next_offset_peer_id,
        "chat_folder_id": int(chat_folder_id or 0),
    }


_CHAT_FILTERS_CACHE: Dict[str, Any] = {"key": None, "ts": 0.0, "filters": []}
_CHAT_FILTERS_TTL_S = 15.0


def _chat_filter_cache_key(client: TelegramClient) -> str:
    try:
        return str(getattr(client.session, "filename", "") or id(client.session))
    except Exception:
        return str(id(client))


def _peer_ids(peers: Any) -> List[int]:
    out: List[int] = []
    for peer in peers or []:
        try:
            out.append(int(utils.get_peer_id(peer)))
        except Exception:
            continue
    return out


def _filter_title(value: Any) -> str:
    text = getattr(value, "text", None)
    return str(text if text is not None else value or "").strip()


def _serialize_chat_filter(value: Any) -> Dict[str, Any]:
    name = type(value).__name__
    return {
        "id": int(getattr(value, "id", 0) or 0),
        "title": _filter_title(getattr(value, "title", "")),
        "emoticon": getattr(value, "emoticon", None),
        "color": getattr(value, "color", None),
        "kind": "shared" if name == "DialogFilterChatlist" else "custom",
        "pinned_peer_ids": _peer_ids(getattr(value, "pinned_peers", [])),
        "include_peer_ids": _peer_ids(getattr(value, "include_peers", [])),
        "exclude_peer_ids": _peer_ids(getattr(value, "exclude_peers", [])),
        "contacts": bool(getattr(value, "contacts", False)),
        "non_contacts": bool(getattr(value, "non_contacts", False)),
        "groups": bool(getattr(value, "groups", False)),
        "broadcasts": bool(getattr(value, "broadcasts", False)),
        "bots": bool(getattr(value, "bots", False)),
        "exclude_muted": bool(getattr(value, "exclude_muted", False)),
        "exclude_read": bool(getattr(value, "exclude_read", False)),
        "exclude_archived": bool(getattr(value, "exclude_archived", False)),
    }


async def _list_chat_folders_on(
    client: TelegramClient, *, force: bool = False
) -> List[Dict[str, Any]]:
    key = _chat_filter_cache_key(client)
    now = time.time()
    if (
        not force
        and _CHAT_FILTERS_CACHE.get("key") == key
        and now - float(_CHAT_FILTERS_CACHE.get("ts") or 0) < _CHAT_FILTERS_TTL_S
    ):
        return [dict(x) for x in _CHAT_FILTERS_CACHE.get("filters") or []]
    try:
        response = await client(functions.messages.GetDialogFiltersRequest())
    except FloodWaitError as exc:
        emit_event("FloodWait", seconds=int(exc.seconds), scope="chat_folders")
        await asyncio.sleep(min(int(exc.seconds), 30))
        response = await client(functions.messages.GetDialogFiltersRequest())
    out: List[Dict[str, Any]] = [
        {"id": 0, "title": "Semua Chat", "kind": "all", "emoticon": None, "color": None}
    ]
    for value in getattr(response, "filters", []) or []:
        if type(value).__name__ == "DialogFilterDefault":
            continue
        row = _serialize_chat_filter(value)
        if row["id"] and row["title"]:
            out.append(row)
    _CHAT_FILTERS_CACHE.update({"key": key, "ts": now, "filters": [dict(x) for x in out]})
    return out


async def _get_chat_filter_on(client: TelegramClient, folder_id: int) -> Optional[Dict[str, Any]]:
    folders = await _list_chat_folders_on(client)
    return next((x for x in folders if int(x.get("id") or 0) == int(folder_id)), None)


def _dialog_matches_chat_filter(dialog: Any, rule: Dict[str, Any]) -> bool:
    did = int(getattr(dialog, "id", 0) or 0)
    excluded = set(int(x) for x in rule.get("exclude_peer_ids") or [])
    if did in excluded:
        return False
    included = set(int(x) for x in (rule.get("include_peer_ids") or []))
    included.update(int(x) for x in (rule.get("pinned_peer_ids") or []))
    if did in included:
        return True
    if rule.get("exclude_archived") and bool(getattr(dialog, "archived", False)):
        return False
    if rule.get("exclude_muted") and bool(getattr(dialog, "muted", False)):
        return False
    if rule.get("exclude_read") and int(getattr(dialog, "unread_count", 0) or 0) <= 0:
        return False
    entity = getattr(dialog, "entity", None)
    is_bot = bool(getattr(entity, "bot", False))
    if is_bot:
        return bool(rule.get("bots"))
    if bool(getattr(dialog, "is_group", False)):
        return bool(rule.get("groups"))
    if bool(getattr(dialog, "is_channel", False)):
        return bool(rule.get("broadcasts"))
    if bool(getattr(dialog, "is_user", False)):
        is_contact = bool(getattr(entity, "contact", False) or getattr(entity, "mutual_contact", False))
        return bool(rule.get("contacts")) if is_contact else bool(rule.get("non_contacts"))
    return False


# Forum topic list cache — GetForumTopics is one RPC but peer resolve can be slow;
# avoid repeat when user switches topics or re-opens the same group.
_TOPICS_CACHE: Dict[int, Dict[str, Any]] = {}
_TOPICS_CACHE_TTL_S = 180.0


def invalidate_topics_cache(chat_id: Optional[int] = None) -> None:
    if chat_id is None:
        _TOPICS_CACHE.clear()
        return
    _TOPICS_CACHE.pop(int(chat_id), None)


async def _list_topics_on(client: TelegramClient, chat_id: int) -> Dict[str, Any]:
    """
    Forum topics for a group/channel.
    Returns {topics, is_forum}.

    Fast path: single GetForumTopics RPC (no extra get_entity).
    Cached ~3 minutes per chat so re-open / topic filter feels instant.
    """
    cid = int(chat_id)
    hit = _TOPICS_CACHE.get(cid)
    if hit and (time.time() - float(hit.get("_ts") or 0)) < _TOPICS_CACHE_TTL_S:
        return {
            "topics": list(hit.get("topics") or []),
            "is_forum": bool(hit.get("is_forum")),
            "cached": True,
        }

    peer = await _resolve_peer(client, cid)
    topics: List[Dict[str, Any]] = []
    is_forum = False
    try:
        # One RPC — if this succeeds the chat is a forum (even with 0 topics).
        # Skip get_entity: it was an extra round-trip that delayed the topic bar.
        result = await client(
            functions.messages.GetForumTopicsRequest(
                peer=peer,
                offset_date=None,
                offset_id=0,
                offset_topic=0,
                limit=100,
            )
        )
        is_forum = True
        for t in getattr(result, "topics", None) or []:
            tid = int(getattr(t, "id", 0) or 0)
            if tid <= 0:
                continue
            topics.append(
                {
                    "id": tid,
                    "title": getattr(t, "title", None) or f"Topic {tid}",
                    "top_message": getattr(t, "top_message", None),
                    "closed": bool(getattr(t, "closed", False)),
                }
            )
    except Exception:
        # Not a forum / no permission — cache negative briefly to avoid hammering
        pack_neg = {"topics": [], "is_forum": False, "cached": False}
        _TOPICS_CACHE[cid] = {**pack_neg, "_ts": time.time()}
        return pack_neg

    # Stable order: General (1) first if present
    topics.sort(key=lambda x: (0 if x["id"] == 1 else 1, (x["title"] or "").lower()))
    pack = {"topics": topics, "is_forum": is_forum, "cached": False}
    _TOPICS_CACHE[cid] = {**pack, "_ts": time.time()}
    return pack


def _attach_topic_id(msg, item: Dict[str, Any]) -> None:
    try:
        r = getattr(msg, "reply_to", None)
        tid = None
        if r is not None:
            tid = getattr(r, "reply_to_top_id", None) or getattr(r, "forum_topic", None)
            if tid is None and getattr(r, "forum_topic", False):
                tid = getattr(r, "reply_to_msg_id", None)
        if tid:
            item["topic_id"] = int(tid)
    except Exception:
        pass


async def _iter_topic_media(
    client: TelegramClient,
    peer,
    *,
    topic_id: int,
    msg_filter,
    limit: Optional[int] = None,
    offset_id: Optional[int] = None,
):
    """
    Telethon's iter_messages with `reply_to` uses GetRepliesRequest, which ignores
    media filters (downloads all text messages). This manually uses SearchRequest
    with top_msg_id for O(1) server-side filtering inside forum topics.
    """
    from telethon.tl.functions.messages import SearchRequest
    fetched = 0
    oid = int(offset_id or 0)

    while True:
        chunk_size = 100
        if limit is not None:
            chunk_size = min(limit - fetched, 100)
            if chunk_size <= 0:
                break

        req = SearchRequest(
            peer=peer,
            q="",
            filter=msg_filter,
            min_date=None,
            max_date=None,
            offset_id=oid,
            add_offset=0,
            limit=chunk_size,
            max_id=0,
            min_id=0,
            hash=0,
            top_msg_id=topic_id,
        )
        try:
            res = await client(req)
        except Exception:
            break

        msgs = getattr(res, "messages", [])
        if not msgs:
            break

        for m in msgs:
            m._client = client
            yield m
            fetched += 1
            oid = m.id
            if limit is not None and fetched >= limit:
                break

        if len(msgs) < chunk_size:
            break


async def _collect_media_slice(
    client: TelegramClient,
    peer,
    *,
    folder_id: Optional[int],
    page_size: int,
    offset_id: Optional[int],
    topic_id: Optional[int],
    msg_filter,
    fetch_limit: int,
) -> Any:
    """
    One server-side media filter slice. Returns (files, last_id, scanned, exhausted).
    Using Telegram filters avoids scanning text-only messages (huge load-more speedup).

    Collects up to `collect_target` media items (not just page_size) so merge across
    filters has enough headroom; exhausted=True only when the filter is truly drained.
    """
    files: List[Dict[str, Any]] = []
    scanned = 0
    last_id: Optional[int] = None
    # Pull more than one UI page per filter so has_more / merge stay accurate
    collect_target = max(int(page_size), min(int(fetch_limit or page_size), 200))
    rpc_limit = max(collect_target, min(int(fetch_limit or collect_target), 200))
    kwargs: Dict[str, Any] = {
        "limit": rpc_limit,
        "reverse": False,
        "filter": msg_filter,
    }
    if offset_id and int(offset_id) > 0:
        kwargs["offset_id"] = int(offset_id)
    try:
        if topic_id is not None and int(topic_id) > 0:
            generator = _iter_topic_media(
                client, peer, topic_id=int(topic_id), limit=rpc_limit,
                msg_filter=msg_filter, offset_id=offset_id
            )
        else:
            generator = client.iter_messages(peer, **kwargs)

        async for msg in generator:
            scanned += 1
            last_id = int(msg.id)
            item = message_to_drive_file(msg, folder_id)
            if not item:
                continue
            _attach_topic_id(msg, item)
            files.append(item)
            if len(files) >= collect_target:
                break
    except Exception:
        # Filter unsupported for this peer (rare) — empty slice
        return [], last_id, scanned, True
    # Exhausted only if we ran out of messages before filling collect_target
    exhausted = len(files) < collect_target and scanned < rpc_limit
    # If we filled collect_target, there is almost certainly more (or exactly full)
    if len(files) >= collect_target:
        exhausted = False
    return files, last_id, scanned, exhausted


async def _list_files_scan_fallback(
    client: TelegramClient,
    peer,
    *,
    folder_id: Optional[int],
    page_size: int,
    offset_id: Optional[int],
    topic_id: Optional[int],
    scan_budget: int,
) -> Dict[str, Any]:
    """Legacy path: walk history and keep only media (slow on text-heavy chats)."""
    budget = max(page_size, min(int(scan_budget or 350), 1200))
    files: List[Dict[str, Any]] = []
    scanned = 0
    last_id: Optional[int] = None
    kwargs: Dict[str, Any] = {"limit": budget, "reverse": False}
    if offset_id and int(offset_id) > 0:
        kwargs["offset_id"] = int(offset_id)
    if topic_id is not None and int(topic_id) > 0:
        kwargs["reply_to"] = int(topic_id)
    async for msg in client.iter_messages(peer, **kwargs):
        scanned += 1
        last_id = int(msg.id)
        item = message_to_drive_file(msg, folder_id)
        if not item:
            continue
        _attach_topic_id(msg, item)
        files.append(item)
        if len(files) >= page_size:
            break
    files.sort(
        key=lambda f: (f.get("created_at") or "", int(f.get("id") or 0)),
        reverse=True,
    )
    has_more = len(files) >= page_size or (scanned >= budget and last_id is not None)
    if scanned < budget and len(files) < page_size:
        has_more = False
    next_offset = last_id if has_more and last_id else None
    return {
        "folder_id": folder_id,
        "topic_id": int(topic_id) if topic_id is not None else None,
        "files": files,
        "total": len(files),
        "scanned": scanned,
        "page_size": page_size,
        "has_more": has_more,
        "next_offset_id": next_offset,
        "approx_note": "scan_fallback",
        "sort": "newest_first",
        # No unique total in fallback without full walk
        "total_count": None,
        "total_bytes": None,
        "stats_accurate": False,
        "stats_pending": True,
    }


# Cache unique media stats (count + size) per peer/topic — accurate, not just loaded page
_MEDIA_STATS_CACHE: Dict[str, Dict[str, Any]] = {}
_MEDIA_STATS_TTL_S = 120.0
# Completed accurate walks stay warm longer (location totals rarely change mid-session)
_MEDIA_STATS_ACCURATE_TTL_S = 300.0

_MEDIA_FILTERS = (
    InputMessagesFilterPhotoVideo,
    InputMessagesFilterDocument,
    InputMessagesFilterGif,
    InputMessagesFilterRoundVideo,
    InputMessagesFilterMusic,
    InputMessagesFilterVoice,
    InputMessagesFilterUrl,
)


def _media_filter_instances():
    return tuple(cls() for cls in _MEDIA_FILTERS)


def _known_quick_filter_counts(
    filter_names: tuple[str, ...], qvals: List[int]
) -> Dict[str, int]:
    """Keep counter/filter alignment; negative values mean unknown."""
    return {
        name: int(qvals[i])
        for i, name in enumerate(filter_names)
        if i < len(qvals) and int(qvals[i]) >= 0
    }


def _media_stats_cache_key(folder_id: Optional[int], topic_id: Optional[int]) -> str:
    return f"{folder_id if folder_id is not None else 'home'}:{topic_id if topic_id is not None else 'all'}"


async def _quick_media_filter_counts(
    client: TelegramClient,
    peer,
    *,
    topic_id: Optional[int] = None,
) -> List[int]:
    """
    Fast per-filter message totals for a location (or forum topic).

    Uses messages.GetSearchCounters with top_msg_id when topic_id is set so
    counts are scoped to that topic — never the whole chat.
    Falls back to get_messages(limit=1, reply_to=...) per filter.
    """
    filters = _media_filter_instances()
    tid = int(topic_id) if topic_id is not None and int(topic_id) > 0 else None

    # Preferred: one RPC for all filters, topic-aware via top_msg_id
    try:
        kwargs: Dict[str, Any] = {
            "peer": peer,
            "filters": list(filters),
        }
        if tid is not None:
            kwargs["top_msg_id"] = tid
        result = await client(functions.messages.GetSearchCountersRequest(**kwargs))
        vals: List[int] = []
        for c in result or []:
            try:
                vals.append(int(getattr(c, "count", 0) or 0))
            except Exception:
                pass
        if vals:
            return vals
    except Exception:
        pass

    # Fallback: per-filter total (must pass reply_to for topic scope)
    try:
        async def _one(flt):
            kw: Dict[str, Any] = {"limit": 1, "filter": flt}
            if tid is not None:
                kw["reply_to"] = tid
            return await client.get_messages(peer, **kw)

        counts = await asyncio.gather(
            *[_one(f) for f in filters],
            return_exceptions=True,
        )
        vals = []
        for c in counts:
            if isinstance(c, Exception):
                # Preserve positional alignment with `filters`; -1 means the
                # counter is unknown and must not be used to skip a scan.
                vals.append(-1)
                continue
            try:
                vals.append(int(getattr(c, "total", 0) or 0))
            except Exception:
                vals.append(-1)
        return vals
    except Exception:
        return []


def invalidate_media_stats(folder_id: Optional[int] = None, topic_id: Optional[int] = None) -> None:
    """Drop cached stats after upload/delete/move (or wipe all if folder_id is special)."""
    if folder_id is None and topic_id is None:
        # Wipe all when unknown scope
        _MEDIA_STATS_CACHE.clear()
        return
    # Drop exact + all-topics for this peer
    keys = [
        _media_stats_cache_key(folder_id, topic_id),
        _media_stats_cache_key(folder_id, None),
    ]
    for k in keys:
        _MEDIA_STATS_CACHE.pop(k, None)


def _msg_media_size_light(msg) -> Optional[int]:
    """Byte size for storage accounting — metadata only, no download."""
    if not msg or not getattr(msg, "media", None):
        return None
    media = msg.media
    if isinstance(media, MessageMediaDocument) and getattr(media, "document", None):
        try:
            return int(getattr(media.document, "size", 0) or 0)
        except Exception:
            return 0
    if isinstance(media, MessageMediaPhoto):
        return int(_file_size(msg) or 0)
    doc = getattr(media, "document", None)
    if doc is not None:
        try:
            return int(getattr(doc, "size", 0) or 0)
        except Exception:
            return 0
    if getattr(media, "photo", None) is not None:
        return int(_file_size(msg) or 0)
    return None


def _msg_media_kind_light(msg) -> str:
    """
    Coarse type for Storage breakdown: image | video | audio | voice | document | file.
    Matches frontend icon_type buckets used in computeSpaceUsage.
    """
    try:
        icon = _icon_type_from_message(msg)
        if icon in ("image", "video", "audio", "voice", "document", "file"):
            return str(icon)
    except Exception:
        pass
    media = getattr(msg, "media", None)
    if isinstance(media, MessageMediaPhoto):
        return "image"
    if isinstance(media, MessageMediaDocument) and getattr(media, "document", None):
        mime = (getattr(media.document, "mime_type", None) or "").lower()
        if mime.startswith("image/"):
            return "image"
        if mime.startswith("video/"):
            return "video"
        if mime.startswith("audio/"):
            # voice notes usually audio/ogg + voice attribute
            try:
                for a in getattr(media.document, "attributes", None) or []:
                    if type(a).__name__ == "DocumentAttributeAudio" and getattr(
                        a, "voice", False
                    ):
                        return "voice"
            except Exception:
                pass
            return "audio"
        return "document"
    return "file"


def _media_stats_pack(
    *,
    folder_id: Optional[int],
    topic_id: Optional[int],
    sizes: Dict[int, int],
    kinds: Dict[int, str],
    scanned: int,
    incomplete: bool,
    t0: float,
    cached: bool = False,
    estimate: bool = False,
    filter_counts: Optional[Dict[str, int]] = None,
) -> Dict[str, Any]:
    by_type_map: Dict[str, Dict[str, int]] = {}
    for mid, sz in sizes.items():
        kind = kinds.get(mid) or "file"
        row = by_type_map.get(kind) or {"count": 0, "bytes": 0}
        row["count"] += 1
        row["bytes"] += int(sz or 0)
        by_type_map[kind] = row
    by_type = [
        {"type": k, "count": v["count"], "bytes": v["bytes"]}
        for k, v in sorted(by_type_map.items(), key=lambda x: -x[1]["bytes"])
    ]
    total_count = len(sizes)
    total_bytes = int(sum(sizes.values()))
    return {
        "status": "success",
        "folder_id": folder_id,
        "topic_id": int(topic_id) if topic_id is not None else None,
        "total_count": total_count,
        "total_bytes": total_bytes,
        "by_type": by_type,
        "scanned_messages": scanned,
        "incomplete": bool(incomplete),
        "accurate": bool(not incomplete and not estimate and total_count >= 0),
        "unique": True,
        "estimate": bool(estimate),
        "filter_counts": filter_counts or {},
        "elapsed_ms": int((time.time() - t0) * 1000),
        "cached": cached,
        "topic_scoped": topic_id is not None and int(topic_id) > 0,
    }


async def media_stats_on_client(
    client: TelegramClient,
    *,
    folder_id: Optional[int] = None,
    topic_id: Optional[int] = None,
    force: bool = False,
    peek: bool = False,
) -> Dict[str, Any]:
    """
    Accurate media item count + total bytes for a Drive location.

    Walks Telegram media filters and merges by message id (no double-count).
    Does NOT download media — only metadata. Cached ~2 minutes per peer/topic.

    Progressive: while walking, writes incomplete snapshots to cache so the UI can
    poll with peek=True and update the pill without waiting for the full walk, and
    without depending on scroll / load-more.

    peek=True: read cache / incomplete snapshot only — never start a walk.
    """
    key = _media_stats_cache_key(folder_id, topic_id)
    inflight = getattr(media_stats_on_client, "_inflight", None)
    if inflight is None:
        inflight = {}
        media_stats_on_client._inflight = inflight  # type: ignore[attr-defined]

    def _ttl_for(hit: Dict[str, Any]) -> float:
        if hit.get("accurate") and not hit.get("incomplete") and not hit.get("estimate"):
            return _MEDIA_STATS_ACCURATE_TTL_S
        return _MEDIA_STATS_TTL_S

    def _from_cache(allow_stale: bool = False) -> Optional[Dict[str, Any]]:
        hit = _MEDIA_STATS_CACHE.get(key)
        if not hit:
            return None
        age = time.time() - float(hit.get("_ts") or 0)
        ttl = _ttl_for(hit)
        if not allow_stale and age >= ttl and not hit.get("incomplete"):
            return None
        # Always serve incomplete snapshots while a walk is running
        if hit.get("incomplete") and key in inflight:
            pass
        elif not allow_stale and age >= ttl:
            return None
        out = {k: v for k, v in hit.items() if k != "_ts"}
        out["cached"] = True
        return out

    if peek:
        snap = _from_cache(allow_stale=True)
        if snap is not None:
            return snap
        return {
            "status": "success",
            "folder_id": folder_id,
            "topic_id": int(topic_id) if topic_id is not None else None,
            "total_count": None,
            "total_bytes": None,
            "by_type": [],
            "incomplete": True,
            "accurate": False,
            "pending": True,
            "cached": False,
        }

    if not force:
        snap = _from_cache(allow_stale=False)
        if snap is not None:
            return snap

    # Deduplicate concurrent full walks for the same key
    existing = inflight.get(key)
    if existing is not None:
        try:
            return await existing
        except Exception:
            pass

    # Serialize all stats walks globally so topic list_files / list_topics
    # are not starved by two concurrent full-library scans.
    global_lock = getattr(media_stats_on_client, "_global_lock", None)
    if global_lock is None:
        global_lock = asyncio.Lock()
        media_stats_on_client._global_lock = global_lock  # type: ignore[attr-defined]

    async def _walk() -> Dict[str, Any]:
        async with global_lock:
            # Another waiter may have filled the cache while we queued
            if not force:
                snap2 = _from_cache(allow_stale=False)
                if snap2 is not None and snap2.get("accurate") and not snap2.get("incomplete"):
                    return snap2
            peer = await _resolve_peer(client, folder_id)
            filters = _media_filter_instances()
            filter_names = (
                "photo_video",
                "document",
                "gif",
                "round_video",
                "music",
                "voice",
            )
            sizes: Dict[int, int] = {}
            kinds: Dict[int, str] = {}
            scanned = 0
            t0 = time.time()
            last_pub = 0
            filter_counts: Dict[str, int] = {}
            quick_count_known: set[str] = set()
            failed_filters: List[str] = []
            failed_filter_types: Dict[str, str] = {}
            # Topic-scoped lower bound seed (max of per-filter totals — not sum)
            quick_lb = 0
            try:
                qvals = await _quick_media_filter_counts(
                    client, peer, topic_id=topic_id
                )
                if qvals:
                    quick_lb = max(qvals)
                    known_counts = _known_quick_filter_counts(filter_names, qvals)
                    filter_counts.update(known_counts)
                    quick_count_known.update(known_counts)
            except Exception:
                quick_lb = 0

            def _publish(incomplete: bool, *, estimate: bool = False) -> Dict[str, Any]:
                pack = _media_stats_pack(
                    folder_id=folder_id,
                    topic_id=topic_id,
                    sizes=sizes,
                    kinds=kinds,
                    scanned=scanned,
                    incomplete=incomplete,
                    t0=t0,
                    estimate=estimate,
                    filter_counts=dict(filter_counts),
                )
                # Incomplete: raise count lower-bound from Telegram counters only
                # (never use as final — unique walk is source of truth for size+count)
                if incomplete and estimate and quick_lb > int(pack.get("total_count") or 0):
                    pack["total_count"] = quick_lb
                    pack["estimate"] = True
                    pack["accurate"] = False
                if incomplete and not sizes:
                    pack["total_bytes"] = None
                if not incomplete:
                    pack["estimate"] = False
                    pack["accurate"] = True
                _MEDIA_STATS_CACHE[key] = {**pack, "_ts": time.time()}
                return pack

            if quick_lb > 0:
                _publish(incomplete=True, estimate=True)

            for flt, fname in zip(filters, filter_names):
                # Telegram's scoped search counter is authoritative for an
                # empty category. Avoiding redundant empty-history RPCs makes
                # the accurate walk dramatically faster and reduces FloodWait.
                if fname in quick_count_known and filter_counts.get(fname) == 0:
                    _publish(incomplete=True, estimate=False)
                    await asyncio.sleep(0)
                    continue
                kwargs: Dict[str, Any] = {"filter": flt, "reverse": False}
                filt_n = 0
                filter_ok = False
                for attempt in range(2):
                    try:
                        if topic_id is not None and int(topic_id) > 0:
                            generator = _iter_topic_media(
                                client, peer, topic_id=int(topic_id), limit=None,
                                msg_filter=flt, offset_id=None
                            )
                        else:
                            generator = client.iter_messages(peer, **kwargs)

                        async for msg in generator:
                            scanned += 1
                            filt_n += 1
                            mid = int(getattr(msg, "id", 0) or 0)
                            if mid > 0 and mid not in sizes:
                                sz = _msg_media_size_light(msg)
                                if sz is not None:
                                    sizes[mid] = int(sz or 0)
                                    kinds[mid] = _msg_media_kind_light(msg)
                            # Yield often so list_files / list_topics stay responsive
                            if scanned % 20 == 0:
                                await asyncio.sleep(0)
                            if scanned - last_pub >= 80:
                                last_pub = scanned
                                _publish(incomplete=True, estimate=False)
                                await asyncio.sleep(0)
                        filter_ok = True
                        break
                    except FloodWaitError as e:
                        if attempt == 0:
                            await asyncio.sleep(max(1, int(getattr(e, "seconds", 1) or 1)))
                            continue
                        failed_filter_types[fname] = type(e).__name__
                    except Exception as exc:
                        failed_filter_types[fname] = type(exc).__name__
                        if attempt == 0:
                            await asyncio.sleep(1.0)
                            continue
                        break
                if not filter_ok:
                    failed_filters.append(fname)
                    # Safe diagnostics only: category + exception class. Never
                    # print peer ids, filenames, message text, or credentials.
                    print(
                        f"[media_stats] filter failed: {fname} "
                        f"({failed_filter_types.get(fname, 'UnknownError')})",
                        file=sys.stderr,
                        flush=True,
                    )
                filter_counts[fname] = max(int(filter_counts.get(fname) or 0), filt_n)
                # Publish at each filter boundary too. Small/medium locations may
                # never reach the 80-message cadence, but the UI still deserves
                # fresh progress while the remaining filters are being checked.
                _publish(incomplete=True, estimate=False)
                await asyncio.sleep(0)

            pack_final = _publish(incomplete=bool(failed_filters), estimate=False)
            pack_final["failed_filters"] = list(failed_filters)
            pack_final["failed_filter_types"] = dict(failed_filter_types)
            pack_final["accurate"] = not failed_filters
            _MEDIA_STATS_CACHE[key] = {**pack_final, "_ts": time.time()}
            return pack_final

    task = asyncio.create_task(_walk())
    inflight[key] = task
    try:
        return await task
    finally:
        if inflight.get(key) is task:
            inflight.pop(key, None)


def _empty_media_page(
    *,
    folder_id: Optional[int],
    topic_id: Optional[int],
    page_size: int,
    invalid_topic: bool = False,
) -> Dict[str, Any]:
    """Safe empty page; never escalate a stale topic into GetRepliesRequest."""
    return {
        "folder_id": folder_id,
        "topic_id": int(topic_id) if topic_id is not None else None,
        "files": [],
        "total": 0,
        "scanned": 0,
        "page_size": int(page_size),
        "has_more": False,
        "next_offset_id": None,
        "total_count": 0,
        "total_bytes": 0,
        "approx_note": "invalid_topic" if invalid_topic else "empty_topic",
        "sort": "newest_first",
        "topic_scoped": topic_id is not None,
        "stats_pending": False,
        "stats_accurate": True,
        "invalid_topic": bool(invalid_topic),
    }


async def _list_files_on(
    client: TelegramClient,
    *,
    folder_id: Optional[int] = None,
    page_size: int = 40,
    offset_id: Optional[int] = None,
    scan_budget: int = 350,
    topic_id: Optional[int] = None,
    quick_stats: bool = True,
) -> Dict[str, Any]:
    """
    Paginated media list (newest first).

    Fast path: Telegram server-side media filters (photo/video + document + gif/round)
    so we do not walk thousands of text messages between media items.

    topic_id:
      - None  → all media in the chat/group
      - int   → only that forum topic (reply_to)

    quick_stats=False: skip GetSearchCounters on first page (faster bootstrap;
      media_stats still refines totals in background).
    """
    page_size = max(1, min(int(page_size or 40), 200))
    peer = await _resolve_peer(client, folder_id)
    # First page: collect less headroom for faster first paint (still enough to merge)
    if offset_id is None or int(offset_id or 0) == 0:
        fetch_limit = min(120, max(page_size * 2, page_size + 12))
    else:
        fetch_limit = min(200, max(page_size * 3, page_size + 24))

    filters = _media_filter_instances()
    topic_scoped = topic_id is not None and int(topic_id) > 0
    
    # Prefer cached unique stats for THIS peer+topic only (never cross-topic)
    total_count: Optional[int] = None
    total_bytes: Optional[int] = None
    totals_accurate = False
    if offset_id is None or int(offset_id) == 0:
        ck = _media_stats_cache_key(folder_id, topic_id)
        hit = _MEDIA_STATS_CACHE.get(ck)
        if hit and (time.time() - float(hit.get("_ts") or 0)) < _MEDIA_STATS_TTL_S:
            # Reject incomplete estimates only when incomplete+estimate without bytes
            try:
                if not hit.get("incomplete"):
                    total_count = int(hit.get("total_count"))
                    total_bytes = int(hit.get("total_bytes") or 0)
                    totals_accurate = bool(
                        hit.get("accurate") and not hit.get("estimate")
                    )
                elif hit.get("total_count") is not None and not hit.get("estimate"):
                    # Progressive unique walk snapshot — safe lower bound
                    total_count = int(hit.get("total_count"))
                    if hit.get("total_bytes") is not None:
                        total_bytes = int(hit.get("total_bytes") or 0)
            except Exception:
                total_count = None
                total_bytes = None

    try:
        slices = await asyncio.gather(
            *[
                _collect_media_slice(
                    client,
                    peer,
                    folder_id=folder_id,
                    page_size=page_size,
                    offset_id=offset_id,
                    topic_id=topic_id,
                    msg_filter=flt,
                    fetch_limit=fetch_limit,
                )
                for flt in filters
            ]
        )
    except Exception:
        return await _list_files_scan_fallback(
            client,
            peer,
            folder_id=folder_id,
            page_size=page_size,
            offset_id=offset_id,
            topic_id=topic_id,
            scan_budget=scan_budget,
        )

    by_id: Dict[int, Dict[str, Any]] = {}
    scanned = 0
    any_full = False
    all_exhausted = True
    last_ids: List[int] = []
    for files_part, last_id, sc, exhausted in slices:
        scanned += sc
        if not exhausted:
            all_exhausted = False
        if len(files_part) >= page_size:
            any_full = True
        if last_id is not None:
            last_ids.append(int(last_id))
        for item in files_part:
            mid = int(item.get("id") or 0)
            if mid:
                by_id[mid] = item

    if not by_id and scanned == 0:
        if topic_scoped:
            # Never fall through to iter_messages(reply_to=...) for a topic
            # that may belong to a different peer. That path raises
            # MessageIdInvalidError through GetRepliesRequest.
            valid_topic = False
            if folder_id is not None:
                try:
                    topic_pack = await _list_topics_on(client, int(folder_id))
                    valid_topic = int(topic_id) in {
                        int(t.get("id") or 0)
                        for t in (topic_pack.get("topics") or [])
                    }
                except Exception:
                    valid_topic = False
            return _empty_media_page(
                folder_id=folder_id,
                topic_id=topic_id,
                page_size=page_size,
                invalid_topic=not valid_topic,
            )
        # Filters may be unsupported — fall back once
        return await _list_files_scan_fallback(
            client,
            peer,
            folder_id=folder_id,
            page_size=page_size,
            offset_id=offset_id,
            topic_id=topic_id,
            scan_budget=scan_budget,
        )

    files = sorted(
        by_id.values(),
        key=lambda f: (f.get("created_at") or "", int(f.get("id") or 0)),
        reverse=True,
    )
    page = files[:page_size]
    # has_more: any filter still has messages beyond this window
    has_more = not all_exhausted
    # Safety: filled a full page → always allow load-more (self-corrects on empty next page)
    if len(page) >= page_size:
        has_more = True
    if all_exhausted and len(page) < page_size:
        has_more = False
    # Pagination cursor = oldest id in returned page (exclusive upper bound for next offset_id)
    next_offset = int(page[-1]["id"]) if has_more and page else None

    # Only treat as exact total when every filter is drained AND we didn't fill a page
    # (otherwise media_stats must compute the real total — never freeze at page_size).
    exact_tiny = (
        not has_more
        and all_exhausted
        and (offset_id is None or int(offset_id) == 0)
        and len(by_id) < page_size
    )
    if exact_tiny:
        totals_accurate = True
        total_count = len(by_id)
        total_bytes = sum(int(f.get("size") or 0) for f in by_id.values())
        by_type_map: Dict[str, Dict[str, int]] = {}
        for f in by_id.values():
            kind = str(f.get("icon_type") or "file").lower()
            row = by_type_map.get(kind) or {"count": 0, "bytes": 0}
            row["count"] += 1
            row["bytes"] += int(f.get("size") or 0)
            by_type_map[kind] = row
        by_type = [
            {"type": k, "count": v["count"], "bytes": v["bytes"]}
            for k, v in sorted(by_type_map.items(), key=lambda x: -x[1]["bytes"])
        ]
        _MEDIA_STATS_CACHE[_media_stats_cache_key(folder_id, topic_id)] = {
            "status": "success",
            "folder_id": folder_id,
            "topic_id": int(topic_id) if topic_id is not None else None,
            "total_count": total_count,
            "total_bytes": total_bytes,
            "by_type": by_type,
            "scanned_messages": scanned,
            "incomplete": False,
            "accurate": True,
            "unique": True,
            "estimate": False,
            "elapsed_ms": 0,
            "cached": False,
            "topic_scoped": topic_id is not None and int(topic_id) > 0,
            "_ts": time.time(),
        }

    # Immediate lower bounds (first page only) so UI is not stuck at page_size
    # until the user scrolls — full unique totals still refine via media_stats.
    # CRITICAL: when topic_id is set, filter totals MUST be topic-scoped
    # (top_msg_id / reply_to). Unscoped chat totals were wrongly applied before.
    if (offset_id is None or int(offset_id) == 0) and not exact_tiny:
        partial_n = len(by_id)
        partial_b = sum(int(f.get("size") or 0) for f in by_id.values())
        filter_max: Optional[int] = None
        if total_count is None and quick_stats:
            try:
                vals = await _quick_media_filter_counts(
                    client, peer, topic_id=topic_id
                )
                if vals:
                    # max = lower bound unique; do not use sum (overlaps inflate)
                    filter_max = max(vals)
            except Exception:
                filter_max = None
        elif total_count is not None:
            filter_max = int(total_count)
        # Best lower bound without a full unique walk
        lb = max(partial_n, filter_max or 0, len(page))
        if total_count is None or lb > int(total_count):
            total_count = lb
        if total_bytes is None and partial_b > 0:
            # Partial size of collected window only (lower bound)
            total_bytes = partial_b

    return {
        "folder_id": folder_id,
        "topic_id": int(topic_id) if topic_id is not None else None,
        "files": page,
        "total": len(page),
        "scanned": scanned,
        "page_size": page_size,
        "has_more": has_more,
        "next_offset_id": next_offset,
        "total_count": total_count,
        "total_bytes": total_bytes,
        "stats_accurate": bool(totals_accurate),
        "approx_note": "media_filter_topic" if topic_scoped else "media_filter",
        "sort": "newest_first",
        "topic_scoped": topic_scoped,
        # UI must always refine via background media_stats unless tiny exact location
        "stats_pending": bool(not totals_accurate),
    }


async def _fetch_thumb_data_url(
    client: TelegramClient,
    peer,
    folder_id: Optional[int],
    message_id: int,
    quality: Optional[str] = None,
    preloaded_message: Any = None,
    message_preloaded: bool = False,
) -> Optional[str]:
    try:
        res = await _fetch_thumb_data_url_impl(
            client=client,
            peer=peer,
            folder_id=folder_id,
            message_id=message_id,
            quality=quality,
            preloaded_message=preloaded_message,
            message_preloaded=message_preloaded,
        )
        if res is None:
            _mark_thumb_empty(folder_id, message_id)
        return res
    except FloodWaitError:
        raise
    except Exception:
        _mark_thumb_empty(folder_id, message_id)
        return None


async def _fetch_thumb_data_url_impl(
    client: TelegramClient,
    peer,
    folder_id: Optional[int],
    message_id: int,
    quality: Optional[str] = None,
    preloaded_message: Any = None,
    message_preloaded: bool = False,
) -> Optional[str]:
    """
    Grid thumb: Telegram static photo thumbs → compact JPEG.
    Videos without server thumbs: lean stream sample only (~0.5–1.5 MB head/tail,
    ≈1–3s of bitstream) + ffmpeg single frame. NEVER full-download multi‑MB/GB files.
    """
    qname = _normalize_thumb_quality(quality)
    prof = _thumb_profile(qname)
    hard_max = int(prof["max"])
    _ensure_dirs()

    key = _cache_key(folder_id, message_id)
    import time
    for stale in (f"{key}.empty", f"{key}.empty2"):
        sp = os.path.join(THUMB_DIR, stale)
        if os.path.isfile(sp):
            try:
                # Cache empty markers for only 3 minutes — newly uploaded files
                # become available quickly; 30min was causing long thumbnail delays.
                if time.time() - os.path.getmtime(sp) < 180:
                    return None
                else:
                    os.remove(sp)
            except OSError:
                pass

    cached = _disk_thumb_data_url(folder_id, message_id, qname)
    if cached is not None:
        return cached or None

    lite_path = _thumb_lite_path(folder_id, message_id, qname)
    tmp_vid = os.path.join(THUMB_DIR, f"{key}.{qname}.vid.tmp")
    tmp_frame = os.path.join(THUMB_DIR, f"{key}.{qname}.frame.jpg")
    try:
        # Batch callers resolve all message metadata in one Telegram RPC and
        # pass it here. Single-thumbnail callers keep the original lookup path.
        msg = (
            preloaded_message
            if message_preloaded
            else await client.get_messages(peer, ids=int(message_id))
        )
        if not msg or not msg.media:
            return None

        icon = _icon_type_from_message(msg)
        visual = _message_is_visual(msg) or icon in ("image", "video")
        # Always attempt for anything with document thumbs or image/video mime/ext
        doc = _media_document(msg)
        if not visual and doc is not None:
            mime = (getattr(doc, "mime_type", None) or "").lower()
            ext = _file_ext(_doc_real_filename(msg) or "") or ""
            if (
                mime.startswith("image/")
                or mime.startswith("video/")
                or ext in _IMAGE_EXTS
                or ext in _VIDEO_EXTS
                or _doc_has_thumbs(msg)
            ):
                visual = True
        if not visual:
            return None

        is_video_pref = icon == "video" or (
            (_file_ext(_doc_real_filename(msg) or "") or "") in _VIDEO_EXTS
        ) or ((getattr(doc, "mime_type", None) or "").lower().startswith("video/"))
        is_image_pref = icon == "image" or (
            (_file_ext(_doc_real_filename(msg) or "") or "") in _IMAGE_EXTS
        ) or ((getattr(doc, "mime_type", None) or "").lower().startswith("image/"))
        target_edge = int(prof["video_edge"] if is_video_pref else prof["edge"])
        prefer = int(prof.get("prefer", 1 if qname == "balanced" else (2 if qname == "sharp" else 0)))
        # Caps for static TG layers only (Jelas lean: never multi‑MB pulls)
        if qname == "sharp":
            raw_cap = 180 * 1024 if is_video_pref else 280 * 1024
        elif is_video_pref:
            raw_cap = 280 * 1024
        else:
            raw_cap = min(int(prof["video_raw_cap"]), 900 * 1024)
        # Accept medium TG layers for lean Jelas (encode path makes them look clear)
        min_accept_bytes = 1024
        min_accept_edge = 0

        raw: Optional[bytes] = None
        sizes = _collect_telegram_thumbs(msg)
        full_size = int(_file_size(msg) or 0)
        if doc is not None and full_size <= 0:
            try:
                full_size = int(getattr(doc, "size", 0) or 0)
            except Exception:
                full_size = 0

        def _size_edge(s: Any) -> int:
            w = int(getattr(s, "w", 0) or 0)
            h = int(getattr(s, "h", 0) or 0)
            if w and h:
                return max(w, h)
            name = type(s).__name__
            if "Stripped" in name:
                return 80
            if "Cached" in name:
                return 160
            return 1

        def _accept_thumb_payload(data: Optional[bytes]) -> bool:
            if not data or len(data) < 16 or len(data) > raw_cap:
                return False
            if len(data) < min_accept_bytes:
                return False
            if min_accept_edge > 0:
                edge = _image_long_edge_from_bytes(data)
                # Unknown edge (no PIL): accept if payload looks substantial
                if edge > 0 and edge < min_accept_edge:
                    return False
            return True

        # ── VIDEO / DOCUMENT-VIDEO path ──────────────────────────────────
        # Lean: TG static thumbs first. Stream-sample ONLY if no usable TG thumb
        # (never pull multi‑MB just for a sharper grid tile).
        if is_video_pref:
            if sizes:
                candidates: List[Any] = []
                try:
                    picked = _select_light_thumb(msg, target_edge, prefer=prefer)
                    if picked is not None:
                        candidates.append(picked)
                except Exception:
                    pass
                scored = [(_size_edge(s), s) for s in sizes]
                scored.sort(key=lambda t: t[0], reverse=True)  # largest first
                for _, s in scored:
                    if s not in candidates:
                        candidates.append(s)
                attempts = 2 if qname == "sharp" else 2
                best_soft: Optional[bytes] = None
                for sel in candidates[:attempts]:
                    data = await _download_thumb_bytes(
                        client, msg, sel, max_bytes=raw_cap
                    )
                    if _accept_thumb_payload(data):
                        raw = data
                        break
                    if data and 16 <= len(data) <= raw_cap:
                        if best_soft is None or len(data) > len(best_soft):
                            best_soft = data
                # Lean Jelas: use best TG layer even if slightly soft (encode path)
                if raw is None and best_soft is not None:
                    raw = best_soft

            soft_edge = _image_long_edge_from_bytes(raw) if raw else 0
            # Stream-sample only when there is truly no TG thumb (or tiny strip < 160px)
            need_better = raw is None or (
                soft_edge > 0 and soft_edge < 160
            )
            if need_better:
                soft_only = raw
                raw = None
                # Tiny clip only
                tiny_cap = 400 * 1024 if qname == "sharp" else 512 * 1024
                if raw is None and 0 < full_size <= tiny_cap:
                    try:
                        if os.path.isfile(tmp_vid):
                            try:
                                os.remove(tmp_vid)
                            except OSError:
                                pass
                        got = await client.download_media(msg, file=tmp_vid)
                        if got and os.path.isfile(str(got)):
                            try:
                                if os.path.getsize(str(got)) > tiny_cap + 64 * 1024:
                                    os.remove(str(got))
                                else:
                                    frame = await _ffmpeg_first_frame_jpeg(
                                        str(got), tmp_frame, max_edge=target_edge
                                    )
                                    if frame:
                                        raw = frame
                            except OSError:
                                pass
                    except Exception:
                        pass
                    finally:
                        for p in (tmp_vid, tmp_frame):
                            try:
                                if os.path.isfile(p):
                                    os.remove(p)
                            except OSError:
                                pass

                if raw is None:
                    try:
                        # Lean sample edge — smaller encode target
                        sample_edge = (
                            min(target_edge, 480)
                            if qname == "sharp"
                            else min(target_edge, 400)
                        )
                        frame = await _thumb_from_stream_sample(
                            client,
                            msg,
                            key=f"{key}.{qname}",
                            max_edge=sample_edge,
                            quality=qname,
                        )
                        if frame:
                            raw = frame
                    except FloodWaitError:
                        raise
                    except Exception as e:
                        try:
                            print(
                                f"[drive_fs] stream-sample thumb fail msg={message_id}: {e}",
                                flush=True,
                            )
                        except Exception:
                            pass
                # Fall back to soft TG thumb if stream sample failed
                if raw is None and soft_only:
                    raw = soft_only

            if not raw or len(raw) < 16:
                return None
            data = _optimize_thumb_bytes(raw, quality=qname, is_video=True)
            if not data:
                data = raw if len(raw) <= hard_max * 2 else b""
            if not data:
                return None
            _write_lite_thumb(lite_path, data, hard_max=max(hard_max * 2, len(data)))
            return f"data:image/jpeg;base64,{base64.b64encode(data).decode('ascii')}"

        # ── PHOTO / IMAGE path ───────────────────────────────────────────
        # Lean Jelas: ONLY largest Telegram static PhotoSize (no multi‑MB originals).
        if raw is None and sizes:
            candidates = []
            try:
                picked = _select_light_thumb(msg, target_edge, prefer=prefer)
                if picked is not None:
                    candidates.append(picked)
            except Exception:
                pass
            scored = [(_size_edge(s), s) for s in sizes]
            scored.sort(key=lambda t: t[0], reverse=(prefer >= 1))
            for _, s in scored:
                if s not in candidates:
                    candidates.append(s)
            seen: set = set()
            best_soft: Optional[bytes] = None
            max_tries = 2 if qname == "sharp" else 4
            for sel in candidates[:max_tries]:
                sk = id(sel)
                if sk in seen:
                    continue
                seen.add(sk)
                data = await _download_thumb_bytes(client, msg, sel, max_bytes=raw_cap)
                if not data or len(data) < 16 or len(data) > raw_cap:
                    continue
                if _accept_thumb_payload(data):
                    raw = data
                    break
                if best_soft is None or len(data) > len(best_soft):
                    best_soft = data
            # Always allow best TG layer (encode path cleans it for lean Jelas)
            if raw is None and best_soft is not None:
                raw = best_soft

        # Full-image fallback: tiny files only (Jelas ≤350 KB — never multi‑MB)
        if raw is None and is_image_pref:
            try:
                max_full = (
                    500 * 1024
                    if qname == "saver"
                    else (1200 * 1024 if qname == "balanced" else 350 * 1024)
                )
                if 0 < full_size <= max_full:
                    result = await client.download_media(msg, file=bytes)
                    if (
                        isinstance(result, (bytes, bytearray))
                        and 16 < len(result) <= max_full + 64 * 1024
                    ):
                        raw = bytes(result)
            except Exception:
                pass

        # Document that is actually video but icon misclassified
        if raw is None and icon in ("document", "file"):
            mime = (getattr(doc, "mime_type", None) or "").lower() if doc else ""
            ext = _file_ext(_doc_real_filename(msg) or "") or ""
            if mime.startswith("video/") or ext in _VIDEO_EXTS:
                try:
                    sample_edge = min(target_edge, 480 if qname == "sharp" else 400)
                    frame = await _thumb_from_stream_sample(
                        client,
                        msg,
                        key=f"{key}.{qname}",
                        max_edge=sample_edge,
                        quality=qname,
                    )
                    if frame:
                        raw = frame
                        is_video_pref = True
                except Exception:
                    pass

        # ── DOCUMENT thumbs (PDF page 1 only — never text/JSON dumps on grid) ──
        if raw is None:
            dkind = _message_doc_kind(msg)
            if dkind == "pdf":
                try:
                    doc_raw = await _render_document_thumb(
                        client,
                        msg,
                        kind=dkind,
                        max_edge=target_edge,
                        quality=qname,
                    )
                    if doc_raw and len(doc_raw) >= 16:
                        raw = doc_raw
                        is_video_pref = False
                except FloodWaitError:
                    raise
                except Exception as e:
                    try:
                        print(
                            f"[drive_fs] doc-thumb fail msg={message_id}: {e}",
                            flush=True,
                        )
                    except Exception:
                        pass

        if not raw or len(raw) < 16:
            return None

        # Reject accidental multi‑MB payloads (safety)
        if len(raw) > (350 * 1024 if qname == "sharp" else 4 * 1024 * 1024):
            return None

        data = _optimize_thumb_bytes(raw, quality=qname, is_video=is_video_pref)
        if not data:
            data = raw if len(raw) <= hard_max * 2 else b""
        if not data:
            return None

        _write_lite_thumb(lite_path, data, hard_max=max(hard_max * 2, len(data)))
        return f"data:image/jpeg;base64,{base64.b64encode(data).decode('ascii')}"
    except FloodWaitError:
        raise
    except Exception as e:
        try:
            print(f"[drive_fs] thumb fail msg={message_id}: {e}", flush=True)
        except Exception:
            pass
        return None
    finally:
        for p in (tmp_vid, tmp_frame):
            try:
                if os.path.isfile(p):
                    os.remove(p)
            except OSError:
                pass


async def scan_folders(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    include_td: bool = True,  # kept for API compat; always scans [TD]
) -> Dict[str, Any]:
    setup_emitter(None, None)
    client = await _connect(session_name, api_id, api_hash)
    try:
        folders = await _scan_folders_on(client)
        result = {"status": "success", "folders": folders}
        emit_event("DriveFoldersReady", count=len(folders))
        _json_out(result)
        return result
    finally:
        await client.disconnect()


async def bootstrap_drive(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    folder_id: Optional[int] = None,
    file_page_size: int = 28,
    chat_page_size: int = 32,
    topic_id: Optional[int] = None,
) -> Dict[str, Any]:
    """
    One Telethon connection for first paint: TD folders + chats page + files page.

    Priority for latency:
      1) chats page (sidebar)
      2) folders without GetFullChannel parent enrich
      3) files without SearchCounters (media_stats refines later)
    """
    import asyncio

    setup_emitter(None, None)
    client = await _connect(session_name, api_id, api_hash)
    t0 = time.time()
    try:
        emit_event("DriveBootstrapStarted")
        # Chats first — unblocks sidebar even when folder scan is huge
        chats_pack = await _list_chats_on(client, limit=chat_page_size, offset=0)
        emit_event(
            "DriveChatsReady",
            count=len(chats_pack["chats"]),
            has_more=chats_pack["has_more"],
        )
        # Folders: cache-only on first paint. Full dialog walk is O(all chats)
        # and blocked the grid for 30–60s on large accounts. UI refines via scan_folders.
        folders: List[Dict[str, Any]] = []
        if _FOLDERS_CACHE.get("folders") and (
            time.time() - float(_FOLDERS_CACHE.get("ts") or 0)
        ) < _FOLDERS_CACHE_TTL_S:
            folders = [dict(f) for f in _FOLDERS_CACHE["folders"]]
        files_pack = await _list_files_on(
            client,
            folder_id=folder_id,
            page_size=file_page_size,
            offset_id=None,
            scan_budget=min(160, file_page_size * 4),
            topic_id=topic_id,
            quick_stats=False,
        )
        emit_event("DriveFoldersReady", count=len(folders))
        emit_event(
            "DriveFilesDone",
            folder_id=folder_id,
            total=files_pack["total"],
            has_more=files_pack["has_more"],
        )
        result = {
            "status": "success",
            "folders": folders,
            "chats": chats_pack["chats"],
            "chats_has_more": chats_pack["has_more"],
            "chats_next_offset": chats_pack["next_offset"],
            "chats_next_offset_id": chats_pack.get("next_offset_id"),
            "chats_next_offset_date": chats_pack.get("next_offset_date"),
            "chats_next_offset_peer_id": chats_pack.get("next_offset_peer_id"),
            "files": files_pack["files"],
            "files_has_more": files_pack["has_more"],
            "next_offset_id": files_pack["next_offset_id"],
            "total_count": files_pack.get("total_count"),
            "total_bytes": files_pack.get("total_bytes"),
            "stats_accurate": bool(files_pack.get("stats_accurate")),
            "stats_pending": bool(files_pack.get("stats_pending", True)),
            "folder_id": folder_id,
            "topic_id": int(topic_id) if topic_id is not None else None,
            "elapsed_s": round(time.time() - t0, 3),
        }
        _json_out(result)
        return result
    finally:
        await client.disconnect()


async def get_thumbnails_batch(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    message_ids: List[int],
    folder_id: Optional[int] = None,
    quality: Optional[str] = None,
) -> Dict[str, Any]:
    """Batch thumbs in one process/connection — critical for grid scroll performance."""
    setup_emitter(None, None)
    _ensure_dirs()
    qname = _normalize_thumb_quality(quality)
    batch = int(_thumb_profile(qname)["batch"])
    ids = [int(x) for x in (message_ids or [])][:batch]
    thumbs: Dict[str, Optional[str]] = {}
    need: List[int] = []
    for mid in ids:
        hit = _disk_thumb_data_url(folder_id, mid, qname)
        if hit is not None:
            thumbs[str(mid)] = hit or None
        else:
            need.append(mid)
    if not need:
        result = {
            "status": "success",
            "thumbs": thumbs,
            "fetched": 0,
            "cached": len(thumbs),
            "quality": qname,
        }
        _json_out(result)
        return result

    client = await _connect(session_name, api_id, api_hash)
    try:
        peer = await _resolve_peer(client, folder_id)
        preloaded: Dict[int, Any] = {}
        try:
            messages = await client.get_messages(peer, ids=need)
            if not isinstance(messages, (list, tuple)):
                messages = [messages]
            preloaded = {
                int(getattr(message, "id", 0)): message
                for message in messages
                if message is not None and int(getattr(message, "id", 0) or 0) > 0
            }
        except FloodWaitError:
            raise
        except Exception:
            preloaded = {}
        for mid in need:
            try:
                url = await _fetch_thumb_data_url(
                    client,
                    peer,
                    folder_id,
                    mid,
                    quality=qname,
                    preloaded_message=preloaded.get(mid),
                    message_preloaded=mid in preloaded,
                )
                thumbs[str(mid)] = url
            except FloodWaitError as e:
                emit_event("FloodWait", seconds=int(e.seconds))
                thumbs[str(mid)] = None
                break
            except Exception:
                thumbs[str(mid)] = None
        result = {
            "status": "success",
            "thumbs": thumbs,
            "fetched": len(need),
            "cached": len(ids) - len(need),
            "quality": qname,
        }
        _json_out(result)
        return result
    finally:
        await client.disconnect()


async def list_chats(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    limit: int = 100,
    offset: int = 0,
    offset_id: int = 0,
    offset_date: Any = None,
    offset_peer_id: Optional[int] = None,
    chat_folder_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Page of dialogs — use cursor fields for 1k–10k chat libraries."""
    setup_emitter(None, None)
    client = await _connect(session_name, api_id, api_hash)
    try:
        pack = await _list_chats_on(
            client,
            limit=limit,
            offset=offset,
            offset_id=offset_id,
            offset_date=offset_date,
            offset_peer_id=offset_peer_id,
            chat_folder_id=chat_folder_id,
        )
        result = {"status": "success", **pack}
        emit_event("DriveChatsReady", count=len(pack["chats"]), has_more=pack["has_more"])
        _json_out(result)
        return result
    finally:
        await client.disconnect()


def _friendly_create_channel_error(err: BaseException) -> str:
    """Map Telethon/Telegram create-channel failures to clear Indonesian text."""
    name = type(err).__name__
    msg = str(err or "")
    low = f"{name} {msg}".lower()
    if (
        "channelstoomuch" in low
        or "userchannelstoomuch" in low
        or "channels too much" in low
        or "too many channels" in low
        or "joined too many" in low
    ):
        return (
            "Batas channel/grup Telegram tercapai. "
            "Setiap Drive/Folder [TD] = 1 channel privat. "
            "Hapus channel lama di app Telegram (termasuk Drive/Folder TD yang tidak dipakai), lalu coba lagi."
        )
    if "userrestricted" in low or "user is restricted" in low:
        return (
            "Akun Telegram dibatasi membuat channel baru. "
            "Coba buat channel manual di app Telegram; jika gagal, tunggu beberapa jam / cek spam."
        )
    if "floodwait" in low or ("wait of" in low and "seconds" in low):
        return f"Telegram minta jeda (rate limit). {msg}"
    if "cannot create channels" in low or "createchannelrequest" in low:
        return (
            "Telegram menolak CreateChannel (Cannot create channels). "
            "Biasanya: (1) batas channel penuh, (2) akun terbatas, (3) terlalu sering create. "
            "Cek di Telegram apakah masih bisa New Channel manual. "
            "Drive/Folder memerlukan channel baru."
        )
    return msg or "Gagal membuat folder"


async def _create_td_channel(
    client: TelegramClient,
    *,
    title: str,
    about: str,
) -> Any:
    """
    Create private TD folder channel.

    Telegram TL CreateChannelRequest needs an explicit type flag. Older code only
    set megagroup=False which often fails with 'Cannot create channels'.
    Try several legal flag combinations; short sleep between attempts for flood.
    """
    last_err: Optional[BaseException] = None
    # Prefer single-flag forms first (matches official clients more closely)
    attempts = (
        {"broadcast": True},
        {"megagroup": True},
        {"broadcast": True, "megagroup": False},
        {"broadcast": False, "megagroup": True},
    )
    for i, kwargs in enumerate(attempts):
        try:
            if i > 0:
                await asyncio.sleep(0.35)
            result = await client(
                functions.channels.CreateChannelRequest(
                    title=title,
                    about=about or "",
                    **kwargs,
                )
            )
            chats = getattr(result, "chats", None) or []
            if chats:
                return chats[0]
            last_err = RuntimeError("CreateChannel returned no chat")
        except Exception as e:
            last_err = e
            # Hard account limits — no point trying other flags
            en = type(e).__name__
            if en in (
                "ChannelsTooMuchError",
                "UserChannelsTooMuchError",
                "UserRestrictedError",
            ):
                break
            continue
    assert last_err is not None
    raise RuntimeError(_friendly_create_channel_error(last_err)) from last_err


async def _require_drive_folder_entity(client: TelegramClient, folder_id: int):
    """Resolve entity and ensure it is a Drive [TD] channel. Returns (entity, title, peer_id)."""
    fid = int(folder_id)
    try:
        ent = await client.get_entity(fid)
    except Exception as e:
        raise RuntimeError(f"Folder tidak ditemukan: {e}") from e

    if not isinstance(ent, Channel):
        raise RuntimeError("Hanya Drive/Folder [TD] (channel privat) yang bisa diubah dari sini.")

    title = (getattr(ent, "title", None) or "") or ""
    if not _is_drive_folder_entity(ent):
        about = getattr(ent, "about", None) or ""
        if FOLDER_ABOUT_TAG not in str(about):
            try:
                full = await client(functions.channels.GetFullChannelRequest(channel=ent))
                about = getattr(getattr(full, "full_chat", None), "about", None) or ""
            except Exception:
                about = ""
        if FOLDER_ABOUT_TAG not in str(about) and "[TD]" not in title:
            raise RuntimeError(
                "Ini bukan Drive/Folder [TD]. Ubah chat biasa lewat aplikasi Telegram."
            )
    try:
        peer_id = int(await client.get_peer_id(ent))
    except Exception:
        peer_id = fid
    return ent, title, peer_id


async def _parent_map_from_scan(client: TelegramClient) -> Dict[int, Optional[int]]:
    folders = await _scan_folders_on(client)
    return {int(f["id"]): f.get("parent_id") for f in folders if f.get("id") is not None}


async def rename_folder_on_client(
    client: TelegramClient,
    folder_id: int,
    name: str,
) -> Dict[str, Any]:
    """Rename a Drive [TD] folder channel title (keeps [TD] suffix)."""
    clean = re.sub(r"\s+", " ", (name or "").strip())
    if not clean:
        raise ValueError("Nama folder wajib diisi")
    if FOLDER_TITLE_SUFFIX.strip() in clean:
        clean = clean.replace(FOLDER_TITLE_SUFFIX.strip(), "").strip()
    if not clean:
        raise ValueError("Nama folder wajib diisi")
    title = f"{clean}{FOLDER_TITLE_SUFFIX}"

    ent, _old_title, peer_id = await _require_drive_folder_entity(client, folder_id)
    try:
        await client(functions.channels.EditTitleRequest(channel=ent, title=title))
    except Exception as e:
        en = type(e).__name__
        msg = str(e or "")
        low = f"{en} {msg}".lower()
        if "floodwait" in low:
            raise RuntimeError(f"Telegram minta jeda (rate limit). {msg}") from e
        if "chatadminrequired" in low or ("admin" in low and "required" in low):
            raise RuntimeError("Tidak punya izin mengubah nama channel ini.") from e
        raise RuntimeError(f"Gagal ganti nama folder: {msg or en}") from e

    parent_id = _FOLDER_PARENT_CACHE.get(peer_id)
    if parent_id is None:
        parent_id = await _folder_parent_id(client, ent, peer_id)

    folder = {
        "id": peer_id,
        "name": clean,
        "title_raw": title,
        "username": getattr(ent, "username", None),
        "is_public": bool(getattr(ent, "username", None)),
        "parent_id": parent_id,
        "is_drive_folder": True,
        "is_orphan": False,
    }
    return {"status": "success", "folder": folder}


async def set_folder_parent_on_client(
    client: TelegramClient,
    folder_id: int,
    parent_id: Optional[int],
) -> Dict[str, Any]:
    """
    Reparent a Drive folder by rewriting about parent= metadata.
    parent_id=None makes the folder a root.
    """
    ent, title, peer_id = await _require_drive_folder_entity(client, folder_id)
    resolved_parent: Optional[int] = None
    if parent_id is not None:
        raw_p = int(parent_id)
        if raw_p == peer_id:
            raise RuntimeError("Folder tidak bisa menjadi induk dirinya sendiri.")
        _parent_ent, _pt, parent_peer = await _require_drive_folder_entity(client, raw_p)
        resolved_parent = parent_peer
        # Cycle check against current scan map
        parent_map = await _parent_map_from_scan(client)
        parent_map[peer_id] = resolved_parent
        if _would_create_folder_cycle(peer_id, resolved_parent, parent_map):
            raise RuntimeError(
                "Tidak bisa memindahkan Drive/Folder ke dalam turunannya sendiri (siklus)."
            )

    about = _compose_folder_about(resolved_parent)
    try:
        await client(functions.messages.EditChatAboutRequest(peer=ent, about=about))
    except Exception as e:
        en = type(e).__name__
        msg = str(e or "")
        low = f"{en} {msg}".lower()
        if "floodwait" in low:
            raise RuntimeError(f"Telegram minta jeda (rate limit). {msg}") from e
        if "chatadminrequired" in low or ("admin" in low and "required" in low):
            raise RuntimeError("Tidak punya izin mengubah metadata folder ini.") from e
        raise RuntimeError(f"Gagal memindahkan folder: {msg or en}") from e

    _FOLDER_PARENT_CACHE[peer_id] = resolved_parent
    folder = {
        "id": peer_id,
        "name": _folder_display_name(title),
        "title_raw": title,
        "username": getattr(ent, "username", None),
        "is_public": bool(getattr(ent, "username", None)),
        "parent_id": resolved_parent,
        "is_drive_folder": True,
        "is_orphan": False,
    }
    return {"status": "success", "folder": folder}


async def _delete_single_channel(client: TelegramClient, ent: Channel, peer_id: int, title: str) -> None:
    try:
        await client(functions.channels.DeleteChannelRequest(channel=ent))
    except Exception as e:
        name = type(e).__name__
        msg = str(e or "")
        low = f"{name} {msg}".lower()
        if "chatadminrequired" in low or ("admin" in low and "required" in low):
            raise RuntimeError(
                "Tidak punya izin menghapus channel ini (bukan owner/admin)."
            ) from e
        if "floodwait" in low:
            raise RuntimeError(f"Telegram minta jeda (rate limit). {msg}") from e
        raise RuntimeError(f"Gagal menghapus folder: {msg or name}") from e
    try:
        _FOLDER_PARENT_CACHE.pop(peer_id, None)
        for k, v in list(_FOLDER_PARENT_CACHE.items()):
            if v == peer_id:
                _FOLDER_PARENT_CACHE.pop(k, None)
    except Exception:
        pass


async def delete_folder_on_client(
    client: TelegramClient,
    folder_id: int,
    *,
    cascade: bool = False,
    detach_children: bool = False,
) -> Dict[str, Any]:
    """
    Delete a Drive [TD] folder = delete the private Telegram channel.

    - Default: refuse if folder has child folders (HAS_CHILDREN).
    - cascade=True: delete all descendant folders then self (deepest-first).
    - detach_children=True: clear parent= on direct children, then delete self.
    """
    if cascade and detach_children:
        raise ValueError("Pilih cascade ATAU detach_children, bukan keduanya.")
    invalidate_folders_cache()

    try:
        ent, title, peer_id = await _require_drive_folder_entity(client, folder_id)
    except RuntimeError as e:
        if "Folder tidak ditemukan" in str(e) or "private" in str(e).lower():
            try:
                await client.delete_dialog(folder_id)
            except Exception:
                pass
            try:
                _FOLDER_PARENT_CACHE.pop(folder_id, None)
                for k, v in list(_FOLDER_PARENT_CACHE.items()):
                    if v == folder_id:
                        _FOLDER_PARENT_CACHE.pop(k, None)
            except Exception:
                pass
            return {
                "status": "success",
                "folder_id": folder_id,
                "name": f"Folder {folder_id}",
                "deleted": True,
                "deleted_ids": [folder_id],
                "detached_ids": [],
                "cascade": bool(cascade),
                "detach_children": bool(detach_children),
            }
        raise

    parent_map = await _parent_map_from_scan(client)
    # Ensure self is in map
    if peer_id not in parent_map:
        parent_map[peer_id] = await _folder_parent_id(client, ent, peer_id)

    descendants = _collect_folder_descendants(peer_id, parent_map)
    direct_children = [cid for cid, pid in parent_map.items() if pid == peer_id and cid != peer_id]

    if direct_children and not cascade and not detach_children:
        names = []
        for cid in direct_children[:8]:
            try:
                e = await client.get_entity(cid)
                names.append(_folder_display_name(getattr(e, "title", None) or str(cid)))
            except Exception:
                names.append(str(cid))
        extra = f" (+{len(direct_children) - 8})" if len(direct_children) > 8 else ""
        raise RuntimeError(
            f"HAS_CHILDREN:{len(direct_children)}:Item punya {len(direct_children)} folder di dalamnya "
            f"({', '.join(names)}{extra}). "
            "Hapus folder anak dulu, atau pilih cascade / lepas anak (detach)."
        )

    detached: List[int] = []
    deleted_ids: List[int] = []

    if detach_children and direct_children:
        for cid in direct_children:
            try:
                await set_folder_parent_on_client(client, cid, None)
                detached.append(cid)
                await asyncio.sleep(0.25)
            except Exception as e:
                raise RuntimeError(
                    f"Gagal melepaskan subfolder {cid} sebelum hapus: {e}"
                ) from e

    if cascade and descendants:
        # Delete leaves first: reverse BFS order approximated by depth-first reverse
        # Recompute deepest-first: sort by path length descending
        def depth_of(fid: int) -> int:
            d = 0
            cur = fid
            seen = set()
            while True:
                p = parent_map.get(cur)
                if p is None or p in seen:
                    break
                seen.add(p)
                d += 1
                cur = p
            return d

        ordered = sorted(descendants, key=depth_of, reverse=True)
        for cid in ordered:
            try:
                child_ent, child_title, child_peer = await _require_drive_folder_entity(client, cid)
                await _delete_single_channel(client, child_ent, child_peer, child_title)
                deleted_ids.append(child_peer)
                await asyncio.sleep(0.35)
            except Exception as e:
                raise RuntimeError(
                    f"Cascade gagal di subfolder {cid}: {e}. "
                    f"Sudah terhapus: {deleted_ids}"
                ) from e

    await _delete_single_channel(client, ent, peer_id, title)
    deleted_ids.append(peer_id)

    return {
        "status": "success",
        "folder_id": peer_id,
        "name": _folder_display_name(title),
        "deleted": True,
        "deleted_ids": deleted_ids,
        "detached_ids": detached,
        "cascade": bool(cascade),
        "detach_children": bool(detach_children),
    }


async def delete_folder(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    folder_id: int,
    cascade: bool = False,
    detach_children: bool = False,
) -> Dict[str, Any]:
    setup_emitter(None, None)
    client = await _connect(session_name, api_id, api_hash)
    try:
        out = await delete_folder_on_client(
            client,
            int(folder_id),
            cascade=cascade,
            detach_children=detach_children,
        )
        emit_event(
            "DriveFolderDeleted",
            folder_id=int(folder_id),
            **{k: v for k, v in out.items() if k != "status"},
        )
        _json_out(out)
        return out
    finally:
        await client.disconnect()


async def rename_folder(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    folder_id: int,
    name: str,
) -> Dict[str, Any]:
    setup_emitter(None, None)
    client = await _connect(session_name, api_id, api_hash)
    try:
        out = await rename_folder_on_client(client, int(folder_id), name)
        emit_event("DriveFolderRenamed", **(out.get("folder") or {}))
        _json_out(out)
        return out
    finally:
        await client.disconnect()


async def set_folder_parent(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    folder_id: int,
    parent_id: Optional[int] = None,
) -> Dict[str, Any]:
    setup_emitter(None, None)
    client = await _connect(session_name, api_id, api_hash)
    try:
        out = await set_folder_parent_on_client(client, int(folder_id), parent_id)
        emit_event("DriveFolderReparented", **(out.get("folder") or {}))
        _json_out(out)
        return out
    finally:
        await client.disconnect()


async def create_folder(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    name: str,
    parent_id: Optional[int] = None,
) -> Dict[str, Any]:
    setup_emitter(None, None)
    clean = re.sub(r"\s+", " ", (name or "").strip())
    if not clean:
        raise ValueError("Folder name required")
    if FOLDER_TITLE_SUFFIX.strip() in clean:
        clean = clean.replace(FOLDER_TITLE_SUFFIX.strip(), "").strip()
    title = f"{clean}{FOLDER_TITLE_SUFFIX}"
    about = _compose_folder_about(int(parent_id) if parent_id is not None else None)
    client = await _connect(session_name, api_id, api_hash)
    try:
        # Soft limit warning (does not block)
        folder_count_warn = None
        try:
            existing = await _scan_folders_on(client)
            n = len(existing)
            if n >= DRIVE_FOLDER_SOFT_LIMIT:
                folder_count_warn = (
                    f"Sudah ada {n} Drive/Folder [TD]. "
                    f"Mendekati batas channel Telegram (~500). "
                    "Pertimbangkan pindah hierarki/hapus item lama."
                )
        except Exception:
            pass

        ch = await _create_td_channel(client, title=title, about=about)
        folder_id = int(getattr(ch, "id", 0))
        invalidate_folders_cache()
        # Telethon peer id for channels is typically -100xxxxxxxxxx
        entity = None
        try:
            entity = await client.get_entity(ch)
            peer_id = int(await client.get_peer_id(entity))
        except Exception:
            peer_id = -1000000000000 - folder_id if folder_id > 0 else folder_id
        # Ensure parent metadata sticks (some clients ignore about on create)
        if parent_id is not None and entity is not None:
            try:
                await client(
                    functions.messages.EditChatAboutRequest(peer=entity, about=about)
                )
            except Exception:
                pass
        resolved_parent = int(parent_id) if parent_id is not None else None
        folder = {
            "id": peer_id,
            "name": clean,
            "title_raw": title,
            "username": None,
            "is_public": False,
            "parent_id": resolved_parent,
            "is_drive_folder": True,
            "is_orphan": False,
        }
        # Keep scan cache in sync so nested tree shows up without stale parent=None
        _FOLDER_PARENT_CACHE[peer_id] = resolved_parent
        out: Dict[str, Any] = {"status": "success", "folder": folder}
        if folder_count_warn:
            out["warning"] = folder_count_warn
        emit_event("DriveFolderCreated", **folder)
        _json_out(out)
        return out
    finally:
        await client.disconnect()


async def list_files(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    folder_id: Optional[int] = None,
    limit: int = 40,
    offset_id: Optional[int] = None,
    scan_budget: int = 350,
    topic_id: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Paginated media list (newest first).
    Collects up to `limit` media items while scanning at most `scan_budget` messages.
    Use next_offset_id for the following page (Telegram offset_id = exclusive upper bound).
    topic_id=None → all media in the chat; int → only that forum topic.
    """
    setup_emitter(None, None)
    client = await _connect(session_name, api_id, api_hash)
    try:
        emit_event(
            "DriveListStarted",
            folder_id=folder_id,
            page_size=limit,
            offset_id=offset_id,
            topic_id=topic_id,
        )
        pack = await _list_files_on(
            client,
            folder_id=folder_id,
            page_size=int(limit or 40),
            offset_id=offset_id,
            scan_budget=scan_budget,
            topic_id=topic_id,
        )
        emit_event(
            "DriveFilesDone",
            folder_id=folder_id,
            total=pack["total"],
            scanned=pack["scanned"],
            has_more=pack["has_more"],
        )
        result = {"status": "success", **pack}
        _json_out(result)
        return result
    except FloodWaitError as e:
        emit_event("FloodWait", seconds=int(e.seconds))
        raise
    finally:
        await client.disconnect()


async def list_topics(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    chat_id: int,
) -> Dict[str, Any]:
    """Forum topics for a group. Empty list + is_forum=False when not a forum."""
    setup_emitter(None, None)
    client = await _connect(session_name, api_id, api_hash)
    try:
        pack = await _list_topics_on(client, int(chat_id))
        result = {
            "status": "success",
            "chat_id": int(chat_id),
            "is_forum": bool(pack.get("is_forum")),
            "topics": pack.get("topics") or [],
        }
        _json_out(result)
        return result
    finally:
        await client.disconnect()


def _tl_encode_string(s: str) -> bytes:
    """TL-encode a Python str into a TL serialized string (length-prefixed, 4-byte-aligned)."""
    data = s.encode("utf-8")
    length = len(data)
    if length <= 253:
        prefix = bytes([length])
        total = 1 + length
    else:
        import struct as _struct
        prefix = bytes([254]) + _struct.pack("<I", length)[:3]
        total = 4 + length
    padding = (-total) % 4
    return prefix + data + b"\x00" * padding


def _make_create_forum_topic_cls():
    """
    Dynamically build a TLRequest subclass for channels.createForumTopic
    (constructor 0xf40c0224). Required because Telethon 1.44 does not
    include this function in its generated code.
    """
    import struct
    import random as _random
    from telethon.tl.tlobject import TLRequest

    class CreateForumTopicRequest(TLRequest):
        CONSTRUCTOR_ID = 0xF40C0224
        SUBCLASS_OF_ID = 0x8AF52AAC  # Updates

        def __init__(self, channel, title: str, random_id: Optional[int] = None):
            self.channel = channel
            self.title = str(title)
            self.random_id = random_id if random_id is not None else _random.randrange(-(2**63), 2**63)

        def _bytes(self) -> bytes:
            flags = 0  # no optional fields
            return (
                struct.pack("<I", self.CONSTRUCTOR_ID)
                + struct.pack("<I", flags)
                + self.channel._bytes()
                + _tl_encode_string(self.title)
                + struct.pack("<q", self.random_id)
            )

        @classmethod
        def from_reader(cls, reader):  # noqa: F841
            raise NotImplementedError("Read path not needed for client-side requests")

    return CreateForumTopicRequest


# Module-level cache so the class is only built once
_CreateForumTopicRequest = None


def _get_create_forum_topic_cls():
    global _CreateForumTopicRequest
    if _CreateForumTopicRequest is not None:
        return _CreateForumTopicRequest
    # First try the official import (works on future Telethon versions)
    try:
        from telethon.tl.functions.channels import CreateForumTopicRequest
        _CreateForumTopicRequest = CreateForumTopicRequest
    except ImportError:
        _CreateForumTopicRequest = _make_create_forum_topic_cls()
    return _CreateForumTopicRequest


def _make_delete_forum_topic_cls():
    """
    Dynamically build TLRequest subclass for channels.deleteTopicHistory
    (constructor 0x34435f2d). Needed because Telethon 1.44 does not include
    DeleteTopicHistoryRequest.

    TL schema:
        channels.deleteTopicHistory#34435f2d channel:InputChannel top_msg_id:int
            = messages.AffectedHistory
    """
    import struct
    from telethon.tl.tlobject import TLRequest

    class DeleteTopicHistoryRequest(TLRequest):
        CONSTRUCTOR_ID = 0x34435F2D
        SUBCLASS_OF_ID = 0xB45C69D1  # AffectedHistory

        def __init__(self, channel, top_msg_id: int):
            self.channel = channel
            self.top_msg_id = int(top_msg_id)

        def _bytes(self) -> bytes:
            return (
                struct.pack("<I", self.CONSTRUCTOR_ID)
                + self.channel._bytes()
                + struct.pack("<i", self.top_msg_id)
            )

        @classmethod
        def from_reader(cls, reader):
            raise NotImplementedError("Read path not needed")

    return DeleteTopicHistoryRequest


_DeleteTopicHistoryRequest = None


def _get_delete_forum_topic_cls():
    global _DeleteTopicHistoryRequest
    if _DeleteTopicHistoryRequest is not None:
        return _DeleteTopicHistoryRequest
    try:
        from telethon.tl.functions.channels import DeleteTopicHistoryRequest
        _DeleteTopicHistoryRequest = DeleteTopicHistoryRequest
    except ImportError:
        _DeleteTopicHistoryRequest = _make_delete_forum_topic_cls()
    return _DeleteTopicHistoryRequest


def _make_edit_forum_topic_cls():
    """
    Dynamically build TLRequest subclass for messages.editForumTopic
    (constructor 0xef3d34d6). Needed because Telethon 1.44 might not include
    EditForumTopicRequest in older sub-builds.

    TL schema:
        messages.editForumTopic#ef3d34d6 flags:# peer:InputPeer topic_id:int
            [title:string] [icon_emoji_id:long] [closed:Bool] [hidden:Bool] = Updates
    """
    import struct
    from telethon.tl.tlobject import TLRequest

    class EditForumTopicRequest(TLRequest):
        CONSTRUCTOR_ID = 0xEF3D34D6
        SUBCLASS_OF_ID = 0x8AF52AAC  # Updates

        def __init__(
            self,
            peer,
            topic_id: int,
            title: Optional[str] = None,
            icon_emoji_id: Optional[int] = None,
            closed: Optional[bool] = None,
            hidden: Optional[bool] = None,
        ):
            self.peer = peer
            self.topic_id = int(topic_id)
            self.title = title
            self.icon_emoji_id = icon_emoji_id
            self.closed = closed
            self.hidden = hidden

        def _bytes(self) -> bytes:
            flags = 0
            if self.title is not None:
                flags |= 1
            if self.icon_emoji_id is not None:
                flags |= 2
            if self.closed is not None:
                flags |= 4
            if self.hidden is not None:
                flags |= 8

            b = struct.pack("<I", self.CONSTRUCTOR_ID)
            b += struct.pack("<I", flags)
            b += self.peer._bytes()
            b += struct.pack("<i", self.topic_id)

            if self.title is not None:
                b += _tl_encode_string(self.title)
            if self.icon_emoji_id is not None:
                b += struct.pack("<q", int(self.icon_emoji_id))
            if self.closed is not None:
                bool_val = 0x9977035F if self.closed else 0xBC799730
                b += struct.pack("<I", bool_val)
            if self.hidden is not None:
                bool_val = 0x9977035F if self.hidden else 0xBC799730
                b += struct.pack("<I", bool_val)

            return b

        @classmethod
        def from_reader(cls, reader):
            raise NotImplementedError("Read path not needed")

    return EditForumTopicRequest


_EditForumTopicRequest = None


def _get_edit_forum_topic_cls():
    global _EditForumTopicRequest
    if _EditForumTopicRequest is not None:
        return _EditForumTopicRequest
    try:
        from telethon.tl.functions.messages import EditForumTopicRequest
        _EditForumTopicRequest = EditForumTopicRequest
    except ImportError:
        _EditForumTopicRequest = _make_edit_forum_topic_cls()
    return _EditForumTopicRequest


async def rename_topic(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    chat_id: int,
    topic_id: int,
    name: str,
) -> Dict[str, Any]:
    """Rename a forum topic in the given group/channel."""
    setup_emitter(None, None)
    client = await _connect(session_name, api_id, api_hash)
    try:
        peer = await _resolve_peer(client, chat_id)
        EditCls = _get_edit_forum_topic_cls()
        await client(
            EditCls(
                peer=peer,
                topic_id=int(topic_id),
                title=str(name),
            )
        )
        invalidate_topics_cache(chat_id)
        out = {
            "status": "success",
            "chat_id": int(chat_id),
            "topic_id": int(topic_id),
            "name": str(name),
        }
        _json_out(out)
        return out
    except Exception as e:
        out = {"status": "error", "error": str(e)}
        _json_out(out)
        return out
    finally:
        await client.disconnect()


async def delete_topic(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    chat_id: int,
    topic_id: int,
) -> Dict[str, Any]:
    """Delete a forum topic (and its message history) from the group."""
    setup_emitter(None, None)
    client = await _connect(session_name, api_id, api_hash)
    try:
        peer = await _resolve_peer(client, chat_id)
        DeleteCls = _get_delete_forum_topic_cls()
        # top_msg_id is the thread root message ID, which equals the topic_id
        await client(DeleteCls(channel=peer, top_msg_id=int(topic_id)))
        invalidate_topics_cache(chat_id)
        out = {
            "status": "success",
            "chat_id": int(chat_id),
            "topic_id": int(topic_id),
        }
        _json_out(out)
        return out
    except Exception as e:
        out = {"status": "error", "error": str(e)}
        _json_out(out)
        return out
    finally:
        await client.disconnect()


async def create_topic(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    chat_id: int,
    title: str,
) -> Dict[str, Any]:
    """Create a new forum topic in the given group/channel."""
    setup_emitter(None, None)
    client = await _connect(session_name, api_id, api_hash)
    try:
        peer = await _resolve_peer(client, chat_id)

        # Get the CreateForumTopicRequest class (built-in or hand-crafted fallback)
        CreateForumTopicCls = _get_create_forum_topic_cls()
        result = await client(
            CreateForumTopicCls(
                channel=peer,
                title=str(title),
            )
        )

        invalidate_topics_cache(chat_id)

        # Extract new topic ID if possible
        topic_id = None
        for update in getattr(result, "updates", []):
            if type(update).__name__ in ("UpdateNewForumTopic", "UpdateNewForumTopicWrapper"):
                topic = getattr(update, "topic", None)
                if topic:
                    topic_id = getattr(topic, "id", None)
                    break

        if topic_id is None:
            for update in getattr(result, "updates", []):
                if hasattr(update, "id"):
                    topic_id = getattr(update, "id")
                elif hasattr(update, "topic_id"):
                    topic_id = getattr(update, "topic_id")

        out = {
            "status": "success",
            "chat_id": int(chat_id),
            "topic_id": topic_id,
            "title": str(title),
        }
        _json_out(out)
        return out
    except Exception as e:
        out = {
            "status": "error",
            "error": str(e),
        }
        _json_out(out)
        return out
    finally:
        await client.disconnect()



async def get_thumbnail(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    message_id: int,
    folder_id: Optional[int] = None,
    quality: Optional[str] = None,
) -> Dict[str, Any]:
    """Return base64 data URL for image thumb (or photo). Prefer batch API for grids."""
    setup_emitter(None, None)
    qname = _normalize_thumb_quality(quality)
    hit = _disk_thumb_data_url(folder_id, message_id, qname)
    if hit is not None:
        result = {
            "status": "success",
            "data_url": hit or None,
            "cached": True,
            "quality": qname,
        }
        _json_out(result)
        return result
    client = await _connect(session_name, api_id, api_hash)
    try:
        peer = await _resolve_peer(client, folder_id)
        url = await _fetch_thumb_data_url(
            client, peer, folder_id, int(message_id), quality=qname
        )
        result = {
            "status": "success",
            "data_url": url,
            "cached": False,
            "quality": qname,
        }
        _json_out(result)
        return result
    except FloodWaitError as e:
        emit_event("FloodWait", seconds=int(e.seconds))
        raise
    finally:
        await client.disconnect()


async def start_preview_stream_on_client(
    client: TelegramClient,
    *,
    folder_id: Optional[int],
    message_id: int,
    quality: Optional[str] = None,
    skip_poster: bool = True,
) -> Dict[str, Any]:
    """
    Progressive stream (Telegram/YouTube-style):
    returns stream_url immediately after first buffer while download continues.
    quality: auto|original|p720|p480|p360 — lower rungs use local ffmpeg when source allows.
    skip_poster: default True — poster fetch is slow; UI uses grid thumb instead.
    """
    from engine.media_stream import (
        fill_stream_from_telegram,
        get_stream,
        register_stream,
    )

    _ensure_dirs()
    q = _normalize_play_quality(quality)
    peer = await _resolve_peer(client, folder_id)
    msg = await client.get_messages(peer, ids=int(message_id))
    if not msg or not msg.media:
        raise RuntimeError("Message has no media")

    size = int(_file_size(msg) or 0)
    icon = _icon_type_from_message(msg)
    is_video = icon == "video" or (
        (_file_ext(_doc_real_filename(msg) or "") or "") in _VIDEO_EXTS
    )
    is_image = icon == "image" or (
        (_file_ext(_doc_real_filename(msg) or "") or "") in _IMAGE_EXTS
    )
    dkind = _message_doc_kind(msg)  # "pdf" | "text" | None
    name = _file_name_from_message(msg)
    ext = _file_ext(name) or _file_ext(_doc_real_filename(msg) or "") or "bin"
    ext = re.sub(r"[^a-z0-9]", "", ext)[:8] or "bin"
    mime = _play_mime_for_preview(
        msg, is_video=is_video, is_image=is_image, ext=ext
    )
    vw, vh = _video_dimensions(msg)
    qualities = build_playback_qualities(msg, is_video=is_video, size=size)
    # If requested rung not in list, fall back to auto/original
    q_ids = {x["id"] for x in qualities}
    if q not in q_ids:
        q = "auto"

    key = _cache_key(folder_id, message_id)
    # Prefer complete document/image cache (non-stream) when present
    if os.path.isdir(PREVIEW_DIR):
        for fname in os.listdir(PREVIEW_DIR):
            if not fname.startswith(key + "."):
                continue
            if ".stream." in fname or fname.endswith(".tmp"):
                continue
            fpath = os.path.join(PREVIEW_DIR, fname)
            if os.path.isfile(fpath) and os.path.getsize(fpath) > 0:
                fext = _file_ext(fname) or ext
                fmime = mimetypes.guess_type(fpath)[0] or mime
                fkind = "file"
                if fmime == "application/pdf" or fext == "pdf" or dkind == "pdf":
                    fkind = "pdf"
                elif (
                    fmime.startswith("text/")
                    or fext in _TEXT_EXTS
                    or dkind == "text"
                ):
                    fkind = "text"
                elif fmime.startswith("image/"):
                    fkind = "image"
                return _preview_result(fpath, cached=True, kind=fkind, emit=False)

    orig_dest = os.path.join(PREVIEW_DIR, f"{key}.stream.{ext}")

    async def _poster() -> Optional[str]:
        if skip_poster:
            return None
        try:
            return await _fetch_thumb_data_url(
                client, peer, folder_id, int(message_id), quality="saver"
            )
        except Exception:
            return None

    def _pack(
        *,
        info: Dict[str, Any],
        play_mime: str,
        play_size: int,
        cached: bool,
        buffered: int,
        message: str,
        poster: Optional[str],
        quality_id: str,
        data_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        # Never label images as generic "stream" only — frontend must pick <img> vs <video>
        if is_video:
            kind = "video"
        elif is_image:
            kind = "image"
        else:
            kind = "stream"
        return {
            "status": "success",
            "stream_url": info["stream_url"],
            "stream_id": info["stream_id"],
            "path": info["path"],
            "mime_type": play_mime,
            "size": play_size,
            "data_url": data_url
            if data_url
            else (poster if (is_image and not is_video and poster) else None),
            "poster_url": poster,
            "cached": cached,
            "preview_kind": kind,
            "too_large": False,
            "streaming": True,
            "buffered": buffered,
            "message": message,
            "quality": quality_id,
            "qualities": qualities if is_video else [
                {
                    "id": "auto",
                    "label": "Original",
                    "description": "File asli",
                    "native": True,
                    "transcode": False,
                }
            ],
            "video_width": vw or None,
            "video_height": vh or None,
        }

    # ── Small / normal images: full download (fast) + stream local file ──
    if is_image and not is_video:
        img_dest = orig_dest
        try:
            if not (
                os.path.isfile(img_dest)
                and os.path.getsize(img_dest) > 0
                and (size <= 0 or os.path.getsize(img_dest) >= size * 0.98)
            ):
                path = await client.download_media(msg, file=img_dest)
                if not path or not os.path.isfile(str(path)):
                    raise RuntimeError("Download gambar gagal")
                img_dest = str(path)
            disk = os.path.getsize(img_dest)
            play_mime = mime if mime.startswith("image/") else (
                mimetypes.guess_type(img_dest)[0] or "image/jpeg"
            )
            info = register_stream(
                path=os.path.abspath(img_dest),
                total_size=disk,
                mime=play_mime,
                label=name,
            )
            media = get_stream(info["stream_id"])
            if media:
                media.mark_done()
            # Tiny images also get data_url for reliability (Tauri asset quirks)
            data_url = None
            if disk <= PREVIEW_INLINE_MAX_BYTES:
                try:
                    with open(img_dest, "rb") as f:
                        b64 = base64.b64encode(f.read()).decode("ascii")
                    data_url = f"data:{play_mime};base64,{b64}"
                except Exception:
                    data_url = None
            return _pack(
                info=info,
                play_mime=play_mime,
                play_size=disk,
                cached=True,
                buffered=disk,
                message="Preview gambar",
                poster=None,
                quality_id="original",
                data_url=data_url,
            )
        except Exception as e:
            # Fall through to progressive path
            if not str(e):
                pass

    # ── PDF / text: full download for in-app viewer (drive-serve uses this path) ──
    if dkind in ("pdf", "text") and not is_video and not is_image:
        if size > DOC_PREVIEW_MAX_BYTES > 0:
            return {
                "status": "success",
                "path": None,
                "mime_type": mime,
                "size": size,
                "data_url": None,
                "stream_url": None,
                "stream_id": None,
                "cached": False,
                "preview_kind": dkind,
                "streaming": False,
                "too_large": True,
                "message": (
                    f"Dokumen terlalu besar untuk pratinjau in-app "
                    f"(>{DOC_PREVIEW_MAX_BYTES // (1024 * 1024)} MB). Gunakan Buka / Unduh."
                ),
                "quality": "original",
                "qualities": [],
            }
        doc_ext = ext if ext and ext not in ("bin", "") else ("pdf" if dkind == "pdf" else "txt")
        if dkind == "pdf":
            doc_ext = "pdf"
        doc_dest = os.path.join(PREVIEW_DIR, f"{key}.{doc_ext}")
        try:
            if not (
                os.path.isfile(doc_dest)
                and os.path.getsize(doc_dest) > 0
                and (size <= 0 or os.path.getsize(doc_dest) >= max(size * 0.95, 1))
            ):
                path = await client.download_media(msg, file=doc_dest)
                if not path or not os.path.isfile(str(path)):
                    raise RuntimeError("Download dokumen gagal")
                doc_dest = str(path)
            # emit=False — drive-serve wraps this in RPC JSON
            return _preview_result(doc_dest, cached=True, kind=dkind, emit=False)
        except Exception as e:
            return {
                "status": "error",
                "error": f"Preview dokumen gagal: {e}",
                "preview_kind": dkind,
                "too_large": False,
            }

    # ── Lower quality: download original → ffmpeg transcode → stream ──
    need_h = _PLAY_QUALITY_HEIGHT.get(q)
    if is_video and need_h and q in ("p1080", "p720", "p480", "p360"):
        out_dest = os.path.join(PREVIEW_DIR, f"{key}.q{need_h}.mp4")
        play_mime = "video/mp4"

        if os.path.isfile(out_dest) and os.path.getsize(out_dest) > 64:
            disk = os.path.getsize(out_dest)
            info = register_stream(
                path=os.path.abspath(out_dest),
                total_size=disk,
                mime=play_mime,
                label=f"{name}.{need_h}p",
            )
            media = get_stream(info["stream_id"])
            if media:
                media.mark_done()
            return _pack(
                info=info,
                play_mime=play_mime,
                play_size=disk,
                cached=True,
                buffered=disk,
                message=f"Streaming {need_h}p dari cache",
                poster=await _poster(),
                quality_id=q,
            )

        # Ensure full original on disk
        try:
            await _download_media_complete(
                client, msg, orig_dest, expected_size=size
            )
        except Exception as e:
            raise RuntimeError(f"Unduh sumber untuk {need_h}p gagal: {e}") from e

        tmp_out = out_dest + ".tmp.mp4"
        try:
            if os.path.isfile(tmp_out):
                try:
                    os.remove(tmp_out)
                except OSError:
                    pass
            await asyncio.to_thread(
                _ffmpeg_transcode_max_height, orig_dest, tmp_out, need_h
            )
            os.replace(tmp_out, out_dest)
        except Exception as e:
            try:
                if os.path.isfile(tmp_out):
                    os.remove(tmp_out)
            except OSError:
                pass
            # Fallback: serve original if transcode fails
            info = register_stream(
                path=os.path.abspath(orig_dest),
                total_size=os.path.getsize(orig_dest),
                mime=mime,
                label=name,
            )
            media = get_stream(info["stream_id"])
            if media:
                media.mark_done()
            return _pack(
                info=info,
                play_mime=mime,
                play_size=os.path.getsize(orig_dest),
                cached=True,
                buffered=os.path.getsize(orig_dest),
                message=f"Konversi {need_h}p gagal — putar original ({e})",
                poster=await _poster(),
                quality_id="original",
            )

        disk = os.path.getsize(out_dest)
        info = register_stream(
            path=os.path.abspath(out_dest),
            total_size=disk,
            mime=play_mime,
            label=f"{name}.{need_h}p",
        )
        media = get_stream(info["stream_id"])
        if media:
            media.mark_done()
        return _pack(
            info=info,
            play_mime=play_mime,
            play_size=disk,
            cached=False,
            buffered=disk,
            message=f"Streaming {need_h}p (data saver)",
            poster=await _poster(),
            quality_id=q,
        )

    # ── Auto / Original: progressive stream of Telegram file ──
    dest = orig_dest
    supports_stream = _doc_supports_streaming(msg)
    # Document-original / missing streaming flag → moov-at-end + progressive buffer care.
    # Only explicit supports_streaming=True is treated as normal Telegram video.
    is_doc_video = bool(is_video and supports_stream is not True)
    # Small doc videos: full download + cheap +faststart remux (instant seek/buffer)
    want_faststart = bool(
        is_doc_video
        and size > 0
        and size <= PREVIEW_MAX_VIDEO_BYTES
        and (mime or "").lower().startswith("video/")
    )
    fast_dest = os.path.join(PREVIEW_DIR, f"{key}.faststart.mp4")

    # Cached +faststart remux (instant seek)
    if want_faststart and os.path.isfile(fast_dest) and os.path.getsize(fast_dest) > 64:
        disk = os.path.getsize(fast_dest)
        info = register_stream(
            path=os.path.abspath(fast_dest),
            total_size=disk,
            mime="video/mp4",
            label=name,
        )
        media = get_stream(info["stream_id"])
        if media:
            media.mark_done()
        return _pack(
            info=info,
            play_mime="video/mp4",
            play_size=disk,
            cached=True,
            buffered=disk,
            message="Streaming dokumen (faststart cache)",
            poster=await _poster(),
            quality_id=q if q in ("auto", "original") else "original",
        )

    # If already fully cached original (NOT sparse progressive shell), instant seek
    if _is_complete_media_file(dest, size):
        disk = os.path.getsize(dest)
        # Optional remux for small document-original so scrub is reliable
        play_path = dest
        play_mime = mime
        if want_faststart and not _is_complete_media_file(fast_dest, 0):
            ok = await asyncio.to_thread(
                _ffmpeg_remux_faststart_sync, dest, fast_dest
            )
            if ok:
                play_path = fast_dest
                play_mime = "video/mp4"
                disk = os.path.getsize(fast_dest)
        info = register_stream(
            path=os.path.abspath(play_path),
            total_size=disk,
            mime=play_mime,
            label=name,
        )
        media = get_stream(info["stream_id"])
        if media:
            media.mark_range(0, disk)
            media.mark_done()
        return _pack(
            info=info,
            play_mime=play_mime,
            play_size=disk,
            cached=True,
            buffered=disk,
            message="Streaming dari cache lokal",
            poster=await _poster(),
            quality_id=q if q in ("auto", "original") else "original",
        )

    # Small document-original: full download + faststart remux (bounded size)
    if want_faststart:
        try:
            await _download_media_complete(
                client, msg, dest, expected_size=size
            )
            ok = await asyncio.to_thread(
                _ffmpeg_remux_faststart_sync, dest, fast_dest
            )
            play_path = fast_dest if ok else dest
            play_mime = "video/mp4" if ok else mime
            disk = os.path.getsize(play_path)
            info = register_stream(
                path=os.path.abspath(play_path),
                total_size=disk,
                mime=play_mime,
                label=name,
            )
            media = get_stream(info["stream_id"])
            if media:
                media.mark_done()
            return _pack(
                info=info,
                play_mime=play_mime,
                play_size=disk,
                cached=False,
                buffered=disk,
                message=(
                    "Streaming dokumen (faststart)"
                    if ok
                    else "Streaming dokumen original"
                ),
                poster=await _poster(),
                quality_id=q if q in ("auto", "original") else "original",
            )
        except Exception as e:
            try:
                print(f"[drive_fs] small doc-video faststart skip: {e}", flush=True)
            except Exception:
                pass
            # Fall through to progressive + moov-tail bootstrap

    info = register_stream(
        path=os.path.abspath(dest),
        total_size=size,
        mime=mime,
        label=name,
    )
    media = get_stream(info["stream_id"])
    if not media:
        raise RuntimeError("Gagal membuat stream session")

    # Warm/partial head: only mark sequential prefix (size < total).
    # Full-size sparse files are recovered inside fill_stream_from_telegram.
    pre_bytes = 0
    try:
        if os.path.isfile(dest):
            pre_bytes = int(os.path.getsize(dest) or 0)
    except OSError:
        pre_bytes = 0
    if pre_bytes >= 32 * 1024 and (size <= 0 or pre_bytes < size * 0.98):
        media.mark_range(0, pre_bytes)

    async def _runner():
        await fill_stream_from_telegram(client, msg, media)

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_runner())
    except RuntimeError:
        await _runner()

    # Return stream_url ASAP — UI attaches <video> while head finishes.
    # Tiny first-byte gate (not 18s / hundreds of KB) for cold open after scroll.
    if is_image and not is_video:
        min_buf = 48 * 1024
        wait_s = 3.0
    else:
        min_buf = 64 * 1024
        if size > 0:
            min_buf = max(48 * 1024, min(128 * 1024, max(size // 400, 48 * 1024)))
        wait_s = 3.5 if pre_bytes < min_buf else 0.4
    if pre_bytes < min_buf:
        await asyncio.to_thread(media.wait_for_bytes, min_buf, wait_s)

    # Document / moov-at-end: wait for head + kick tail so duration/seek work ASAP
    if is_video and is_doc_video and size > 512 * 1024 and not media.done:
        # Prefer a solid playable head before returning (smoother first buffer)
        doc_head = min(384 * 1024, size if size > 0 else 384 * 1024)
        if media.contiguous_from_zero() < doc_head:
            try:
                await asyncio.to_thread(media.wait_for_bytes, doc_head, 6.0)
            except Exception:
                pass
        tail_off = max(0, size - min(2 * 1024 * 1024, max(size // 5, 256 * 1024)))
        try:
            await asyncio.to_thread(
                media.wait_for_range, tail_off, 32 * 1024, 8.0
            )
        except Exception:
            pass

    if media.error and media.contiguous_from_zero() <= 0 and media._safe_size() <= 0:
        raise RuntimeError(f"Stream gagal: {media.error}")

    buffered = media.contiguous_from_zero() or media._safe_size()
    qlabel = "Auto" if q == "auto" else (_label_for_height(vh) if vh else "Original")
    seek_ready = media.done or media.filled_bytes() > media.contiguous_from_zero() + 64 * 1024
    msg_stream = (
        f"Streaming {qlabel} — siap cepat"
        if pre_bytes >= min_buf
        else f"Streaming {qlabel} — putar sambil unduh"
    )
    if is_doc_video:
        msg_stream = (
            "Streaming dokumen — buffer progresif"
            if not seek_ready
            else "Streaming dokumen — seek/buffer progresif"
        )
    return _pack(
        info=info,
        play_mime=mime,
        play_size=size,
        cached=pre_bytes >= min_buf,
        buffered=buffered,
        message=msg_stream,
        poster=await _poster(),
        quality_id=q if q in ("auto", "original") else "auto",
    )


def _zip_cache_path(folder_id: Optional[int], message_id: int) -> str:
    fk = "home" if folder_id is None else str(int(folder_id))
    return os.path.join(ZIP_DIR, f"{fk}_{int(message_id)}.zip")


async def warm_preview_head_on_client(
    client: TelegramClient,
    *,
    folder_id: Optional[int],
    message_id: int,
    head_bytes: int = 768 * 1024,
) -> Dict[str, Any]:
    """
    Prefetch only the first ~head_bytes of a video/document into the stream cache
    path so a subsequent open is near-instant. Does NOT wipe existing heads.
    Fire-and-forget friendly (hover / scroll into view).
    """
    from engine.media_stream import (
        fill_stream_from_telegram,
        get_stream,
        register_stream,
    )

    _ensure_dirs()
    peer = await _resolve_peer(client, folder_id)
    msg = await client.get_messages(peer, ids=int(message_id))
    if not msg or not msg.media:
        return {"status": "no_media", "message_id": int(message_id)}

    size = int(_file_size(msg) or 0)
    icon = _icon_type_from_message(msg)
    is_video = icon == "video" or (
        (_file_ext(_doc_real_filename(msg) or "") or "") in _VIDEO_EXTS
    )
    is_image = icon == "image" or (
        (_file_ext(_doc_real_filename(msg) or "") or "") in _IMAGE_EXTS
    )
    # Only warm media that uses progressive stream path
    if not (is_video or is_image):
        return {"status": "skip", "reason": "not_streamable", "message_id": int(message_id)}

    name = _file_name_from_message(msg)
    ext = _file_ext(name) or _file_ext(_doc_real_filename(msg) or "") or "bin"
    ext = re.sub(r"[^a-z0-9]", "", ext)[:8] or "bin"
    mime = _mime_from_message(msg) or mimetypes.guess_type(f"x.{ext}")[0] or (
        "video/mp4" if is_video else "application/octet-stream"
    )
    key = _cache_key(folder_id, message_id)
    dest = os.path.join(PREVIEW_DIR, f"{key}.stream.{ext}")
    want = max(128 * 1024, min(int(head_bytes or 768 * 1024), 2 * 1024 * 1024))
    if size > 0:
        want = min(want, size)

    have = 0
    try:
        if os.path.isfile(dest):
            have = int(os.path.getsize(dest) or 0)
    except OSError:
        have = 0

    if have >= want:
        return {
            "status": "ready",
            "message_id": int(message_id),
            "bytes": have,
            "path": dest,
            "warmed": False,
        }

    # Full cache already? treat as ready
    if size > 0 and have >= size * 0.98:
        return {
            "status": "ready",
            "message_id": int(message_id),
            "bytes": have,
            "path": dest,
            "warmed": False,
            "complete": True,
        }

    info = register_stream(
        path=os.path.abspath(dest),
        total_size=size or want,
        mime=mime,
        label=name or f"msg{message_id}",
    )
    media = get_stream(info["stream_id"])
    if not media:
        return {"status": "error", "error": "register_stream failed"}

    if have >= 32 * 1024:
        media.mark_range(0, have)

    async def _runner():
        # Head-only: do not pull the entire multi-GB file on hover
        await fill_stream_from_telegram(
            client, msg, media, stop_after_bytes=want
        )

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_runner())
    except RuntimeError:
        await _runner()

    # Short wait for head only — caller (hover) should not block long
    await asyncio.to_thread(media.wait_for_bytes, want, 2.5)
    got = media.contiguous_from_zero() or media._safe_size()
    # Drop warm stream registration so open can re-bind; keep partial file on disk
    try:
        from engine.media_stream import stop_stream

        stop_stream(info["stream_id"], delete_partial=False)
    except Exception:
        pass
    return {
        "status": "ok" if got > 0 else "pending",
        "message_id": int(message_id),
        "bytes": got,
        "want": want,
        "path": dest,
        "warmed": True,
    }


def _is_zip_message(msg) -> bool:
    name = (_file_name_from_message(msg) or "").lower()
    real = (_doc_real_filename(msg) or "").lower()
    mime = (_mime_from_message(msg) or "").lower()
    if mime in ("application/zip", "application/x-zip-compressed", "multipart/x-zip"):
        return True
    if name.endswith(".zip") or real.endswith(".zip"):
        return True
    return False


async def _ensure_zip_full_cache(
    client: TelegramClient,
    msg,
    *,
    folder_id: Optional[int],
    message_id: int,
) -> str:
    """Download full ZIP once to disk cache (for extract / small archives)."""
    from engine.zip_browser import SMALL_ZIP_FULL_DOWNLOAD  # noqa: F401 — size hint only

    _ensure_dirs()
    path = _zip_cache_path(folder_id, message_id)
    total = int(_doc_total_size(msg) or _file_size(msg) or 0)
    if os.path.isfile(path):
        try:
            sz = os.path.getsize(path)
            if total <= 0 or sz >= max(total - 32, int(total * 0.995)):
                return path
        except OSError:
            pass
    part = path + ".part"
    try:
        if os.path.isfile(part):
            os.remove(part)
    except OSError:
        pass
    out = await client.download_media(msg, file=part)
    if not out or not os.path.isfile(str(out)):
        raise RuntimeError("Gagal mengunduh arsip ZIP")
    try:
        if os.path.abspath(str(out)) != os.path.abspath(path):
            if os.path.isfile(path):
                os.remove(path)
            os.replace(str(out), path)
    except OSError:
        path = str(out)
    return path


async def zip_list_on_client(
    client: TelegramClient,
    *,
    folder_id: Optional[int],
    message_id: int,
) -> Dict[str, Any]:
    """
    Lightweight ZIP listing — never extracts members.
    Small archives: full download once + ZipFile.infolist().
    Large archives: range-fetch EOCD + central directory only.
    """
    from engine.zip_browser import (
        EOCD_TAIL_BYTES,
        SMALL_ZIP_FULL_DOWNLOAD,
        list_from_central_bytes,
        list_zip_path,
        parse_eocd_from_tail,
    )

    _ensure_dirs()
    peer = await _resolve_peer(client, folder_id)
    msg = await client.get_messages(peer, ids=int(message_id))
    if not msg or not msg.media:
        raise RuntimeError("Message has no media")
    if not _is_zip_message(msg):
        raise RuntimeError("Bukan file ZIP")

    total = int(_doc_total_size(msg) or _file_size(msg) or 0)
    name = _file_name_from_message(msg)
    cache = _zip_cache_path(folder_id, message_id)

    # Reuse full cache if present
    if os.path.isfile(cache):
        try:
            pack = list_zip_path(cache)
            pack["name"] = name
            pack["message_id"] = int(message_id)
            pack["folder_id"] = folder_id
            pack["cached"] = True
            return {"status": "success", **pack}
        except Exception:
            pass

    # Small ZIP — download full (still no extract)
    if total <= 0 or total <= SMALL_ZIP_FULL_DOWNLOAD:
        path = await _ensure_zip_full_cache(
            client, msg, folder_id=folder_id, message_id=int(message_id)
        )
        pack = list_zip_path(path)
        pack["name"] = name
        pack["message_id"] = int(message_id)
        pack["folder_id"] = folder_id
        pack["cached"] = True
        return {"status": "success", **pack}

    # Large ZIP — central directory only (Google Drive style)
    tail_n = min(EOCD_TAIL_BYTES, total)
    tail_path = os.path.join(ZIP_DIR, f"tail_{folder_id or 'home'}_{int(message_id)}.bin")
    written = await _download_media_range(
        client,
        msg,
        tail_path,
        offset=max(0, total - tail_n),
        max_bytes=tail_n,
        request_size=min(512 * 1024, tail_n),
        file_size=total,
    )
    if written < 22:
        # Fallback full download
        path = await _ensure_zip_full_cache(
            client, msg, folder_id=folder_id, message_id=int(message_id)
        )
        pack = list_zip_path(path)
        pack["name"] = name
        pack["message_id"] = int(message_id)
        pack["folder_id"] = folder_id
        pack["cached"] = True
        pack["note"] = "fallback_full"
        return {"status": "success", **pack}

    with open(tail_path, "rb") as f:
        tail = f.read()
    try:
        cd_off, cd_size, n_entries = parse_eocd_from_tail(tail, total)
    except Exception:
        path = await _ensure_zip_full_cache(
            client, msg, folder_id=folder_id, message_id=int(message_id)
        )
        pack = list_zip_path(path)
        pack["name"] = name
        pack["message_id"] = int(message_id)
        pack["folder_id"] = folder_id
        pack["cached"] = True
        pack["note"] = "fallback_full_eocd"
        return {"status": "success", **pack}

    # Cap CD size (pathological zips)
    if cd_size > 64 * 1024 * 1024:
        raise RuntimeError("Central directory ZIP terlalu besar untuk pratinjau ringan")

    cd_path = os.path.join(ZIP_DIR, f"cd_{folder_id or 'home'}_{int(message_id)}.bin")
    cd_written = await _download_media_range(
        client,
        msg,
        cd_path,
        offset=cd_off,
        max_bytes=cd_size,
        request_size=min(512 * 1024, max(cd_size, 1)),
        file_size=total,
    )
    if cd_written < min(cd_size, 46):
        path = await _ensure_zip_full_cache(
            client, msg, folder_id=folder_id, message_id=int(message_id)
        )
        pack = list_zip_path(path)
        pack["name"] = name
        pack["message_id"] = int(message_id)
        pack["folder_id"] = folder_id
        pack["cached"] = True
        pack["note"] = "fallback_full_cd"
        return {"status": "success", **pack}

    with open(cd_path, "rb") as f:
        cd = f.read(cd_size)
    pack = list_from_central_bytes(cd, archive_size=total, total_entries_hint=n_entries)
    pack["name"] = name
    pack["message_id"] = int(message_id)
    pack["folder_id"] = folder_id
    pack["cached"] = False
    pack["needs_full_for_extract"] = True
    return {"status": "success", **pack}


async def zip_read_entry_on_client(
    client: TelegramClient,
    *,
    folder_id: Optional[int],
    message_id: int,
    entry_name: str,
    password: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Extract ONE entry only (after ensuring full ZIP is cached).
    Returns text body or base64 for small binary; never unpacks whole archive.
    """
    from engine.zip_browser import MAX_ENTRY_PREVIEW_BYTES, read_zip_entry_path

    _ensure_dirs()
    peer = await _resolve_peer(client, folder_id)
    msg = await client.get_messages(peer, ids=int(message_id))
    if not msg or not msg.media:
        raise RuntimeError("Message has no media")
    if not _is_zip_message(msg):
        raise RuntimeError("Bukan file ZIP")

    from engine.zip_browser import MAX_ENTRY_PREVIEW_BYTES, read_zip_entry_path, RangeFile, parse_eocd_from_tail, parse_central_directory, SMALL_ZIP_FULL_DOWNLOAD

    total = int(_doc_total_size(msg) or _file_size(msg) or 0)
    cache = _zip_cache_path(folder_id, message_id)
    
    data = b""
    meta = {}
    
    if total > SMALL_ZIP_FULL_DOWNLOAD and not os.path.isfile(cache):
        cd_path = os.path.join(ZIP_DIR, f"cd_{folder_id or 'home'}_{int(message_id)}.bin")
        tail_path = os.path.join(ZIP_DIR, f"tail_{folder_id or 'home'}_{int(message_id)}.bin")
        
        if not (os.path.isfile(cd_path) and os.path.isfile(tail_path)):
            try:
                await zip_list_on_client(client, folder_id=folder_id, message_id=message_id)
            except Exception:
                pass
                
        if os.path.isfile(cd_path) and os.path.isfile(tail_path) and not os.path.isfile(cache):
            try:
                with open(tail_path, "rb") as f:
                    tail = f.read()
                cd_off, cd_size, n_entries = parse_eocd_from_tail(tail, total)
                with open(cd_path, "rb") as f:
                    cd = f.read(cd_size)
                entries = parse_central_directory(cd)
                
                entry_info = None
                for e in entries:
                    if e["name"] == entry_name:
                        entry_info = e
                        break
                if not entry_info:
                    alt = entry_name.lstrip("./")
                    for e in entries:
                        if e["name"] == alt:
                            entry_info = e
                            entry_name = alt
                            break
                            
                if entry_info:
                    header_offset = entry_info.get("header_offset")
                    if header_offset is not None:
                        comp_size = entry_info["compressed_size"]
                        fetch_size = comp_size + 2048 + len(entry_info["name"]) + 30
                        
                        chunk_path = os.path.join(ZIP_DIR, f"chunk_{folder_id or 'home'}_{int(message_id)}.bin")
                        await _download_media_range(
                            client,
                            msg,
                            chunk_path,
                            offset=header_offset,
                            max_bytes=fetch_size,
                            request_size=min(512 * 1024, fetch_size),
                            file_size=total,
                        )
                        with open(chunk_path, "rb") as cf:
                            chunk_data = cf.read()
                            
                        ranges = [
                            (header_offset, chunk_data),
                            (cd_off, cd),
                            (max(0, total - len(tail)), tail)
                        ]
                        rf = RangeFile(ranges, total)
                        
                        try:
                            data, meta = read_zip_entry_path(
                                rf, entry_name, password=password, max_bytes=MAX_ENTRY_PREVIEW_BYTES
                            )
                        except ValueError as e:
                            msg_e = str(e)
                            if msg_e == "encrypted":
                                return {"status": "encrypted", "message": "File ZIP dienkripsi. Masukkan password."}
                            if msg_e == "bad_password":
                                return {"status": "bad_password", "message": "Password salah."}
                            if msg_e.startswith("entry_too_large:"):
                                parts = msg_e.split(":")
                                return {
                                    "status": "too_large",
                                    "entry": entry_name,
                                    "size": int(parts[1]) if len(parts) > 1 else 0,
                                    "max_bytes": int(parts[2]) if len(parts) > 2 else MAX_ENTRY_PREVIEW_BYTES,
                                    "message": "Isi file terlalu besar untuk pratinjau inline. Unduh arsip penuh.",
                                }
                            raise
            except ValueError:
                raise
            except Exception as e:
                import logging
                logging.warning(f"Range fetch failed for zip_read: {e}")
                data = b""

    if not meta:
        path = await _ensure_zip_full_cache(
            client, msg, folder_id=folder_id, message_id=int(message_id)
        )
        try:
            data, meta = read_zip_entry_path(
                path, entry_name, password=password, max_bytes=MAX_ENTRY_PREVIEW_BYTES
            )
        except ValueError as e:
            msg_e = str(e)
            if msg_e == "encrypted":
                return {"status": "encrypted", "message": "File ZIP dienkripsi. Masukkan password."}
            if msg_e == "bad_password":
                return {"status": "bad_password", "message": "Password salah."}
            if msg_e.startswith("entry_too_large:"):
                parts = msg_e.split(":")
                return {
                    "status": "too_large",
                    "entry": entry_name,
                    "size": int(parts[1]) if len(parts) > 1 else 0,
                    "max_bytes": int(parts[2]) if len(parts) > 2 else MAX_ENTRY_PREVIEW_BYTES,
                    "message": "Isi file terlalu besar untuk pratinjau inline. Unduh arsip penuh.",
                }
            raise

    name = meta.get("name") or entry_name
    lower = name.lower()
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    # Text-like → return body string
    text_exts = (
        ".txt",
        ".md",
        ".json",
        ".csv",
        ".log",
        ".xml",
        ".yml",
        ".yaml",
        ".html",
        ".htm",
        ".css",
        ".js",
        ".ts",
        ".py",
        ".rs",
        ".go",
        ".ini",
        ".cfg",
        ".toml",
        ".svg",
    )
    if any(lower.endswith(x) for x in text_exts) or (mime or "").startswith("text/"):
        try:
            body = data.decode("utf-8")
        except Exception:
            body = data.decode("latin-1", errors="replace")
        # Cap text length in response
        if len(body) > 400_000:
            body = body[:400_000] + "\n… [dipotong]"
        return {
            "status": "success",
            "kind": "text",
            "entry": name,
            "mime": mime,
            "size": meta.get("size"),
            "text": body,
        }

    if (mime or "").startswith("image/") or any(
        lower.endswith(x) for x in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp")
    ):
        b64 = base64.b64encode(data).decode("ascii")
        return {
            "status": "success",
            "kind": "image",
            "entry": name,
            "mime": mime if (mime or "").startswith("image/") else "image/jpeg",
            "size": meta.get("size"),
            "data_url": f"data:{mime or 'image/jpeg'};base64,{b64}",
        }

    if (mime or "").startswith("video/") or any(
        lower.endswith(x) for x in (".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".3gp")
    ):
        b64 = base64.b64encode(data).decode("ascii")
        return {
            "status": "success",
            "kind": "video",
            "entry": name,
            "mime": mime if (mime or "").startswith("video/") else "video/mp4",
            "size": meta.get("size"),
            "data_url": f"data:{mime or 'video/mp4'};base64,{b64}",
        }

    # Other binary — offer as downloadable data URL only if small
    if len(data) <= 2 * 1024 * 1024:
        b64 = base64.b64encode(data).decode("ascii")
        return {
            "status": "success",
            "kind": "binary",
            "entry": name,
            "mime": mime,
            "size": meta.get("size"),
            "data_url": f"data:{mime};base64,{b64}",
        }
    return {
        "status": "success",
        "kind": "meta",
        "entry": name,
        "mime": mime,
        "size": meta.get("size"),
        "message": "Pratinjau binary tidak tersedia. Unduh arsip ZIP untuk membuka file ini.",
    }


async def get_preview(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    message_id: int,
    folder_id: Optional[int] = None,
    quality: Optional[str] = None,
    skip_poster: bool = True,
) -> Dict[str, Any]:
    """
    Preview entry (one-shot process):
    - Video / large media → progressive HTTP stream (play while downloading)
    - Small images → optional tiny data_url + path
    Client stays alive until stream download finishes.
    quality: auto|original|p720|p480|p360
    """
    setup_emitter(None, None)
    _ensure_dirs()
    play_q = _normalize_play_quality(quality)
    key = _cache_key(folder_id, message_id)

    # Complete non-stream cache (images finished earlier)
    if os.path.isdir(PREVIEW_DIR):
        for name in os.listdir(PREVIEW_DIR):
            if name.startswith(key + ".") and ".stream." not in name and not name.endswith(".tmp"):
                path = os.path.join(PREVIEW_DIR, name)
                if os.path.isfile(path) and os.path.getsize(path) > 0:
                    # Prefer streaming complete file for video-capable players
                    mime = mimetypes.guess_type(path)[0] or ""
                    if mime.startswith("video/") or mime.startswith("audio/"):
                        from engine.media_stream import get_stream, register_stream

                        info = register_stream(
                            path=os.path.abspath(path),
                            total_size=os.path.getsize(path),
                            mime=mime,
                            label=os.path.basename(path),
                        )
                        m = get_stream(info["stream_id"])
                        if m:
                            m.mark_done()
                        result = {
                            "status": "success",
                            "stream_url": info["stream_url"],
                            "stream_id": info["stream_id"],
                            "path": info["path"],
                            "mime_type": mime,
                            "size": os.path.getsize(path),
                            "data_url": None,
                            "cached": True,
                            "preview_kind": "stream",
                            "streaming": True,
                            "too_large": False,
                        }
                        _json_out(result)
                        return result
                    fext = _file_ext(path) or ""
                    fmime = mimetypes.guess_type(path)[0] or ""
                    fkind = "file"
                    if fmime == "application/pdf" or fext == "pdf":
                        fkind = "pdf"
                    elif (
                        fmime.startswith("text/")
                        or "json" in fmime
                        or fext in _TEXT_EXTS
                    ):
                        fkind = "text"
                    elif fmime.startswith("image/"):
                        fkind = "image"
                    return _preview_result(path, cached=True, kind=fkind)

    client = await _connect(session_name, api_id, api_hash)
    keep_alive = False
    try:
        peer = await _resolve_peer(client, folder_id)
        msg = await client.get_messages(peer, ids=int(message_id))
        if not msg or not msg.media:
            raise RuntimeError("Message has no media")

        size = int(_file_size(msg) or 0)
        icon = _icon_type_from_message(msg)
        is_video = icon == "video" or (
            (_file_ext(_doc_real_filename(msg) or "") or "") in _VIDEO_EXTS
        )
        is_image = icon == "image" or (
            (_file_ext(_doc_real_filename(msg) or "") or "") in _IMAGE_EXTS
        )

        # Images that are small: download fully (fast), no stream needed
        if is_image and not is_video and size <= PREVIEW_MAX_IMAGE_BYTES:
            name = _file_name_from_message(msg)
            ext = _file_ext(name) or _file_ext(_doc_real_filename(msg) or "") or "jpg"
            ext = re.sub(r"[^a-z0-9]", "", ext)[:8] or "jpg"
            dest = os.path.join(PREVIEW_DIR, f"{key}.{ext}")
            path = await client.download_media(msg, file=dest)
            if not path or not os.path.isfile(path):
                raise RuntimeError("Download preview gagal")
            return _preview_result(path, cached=False, kind="file")

        # PDF / text documents: full download under cap for in-app viewer
        dkind = _message_doc_kind(msg)
        if dkind in ("pdf", "text") and (size <= 0 or size <= DOC_PREVIEW_MAX_BYTES):
            name = _file_name_from_message(msg)
            ext = _file_ext(name) or _file_ext(_doc_real_filename(msg) or "") or (
                "pdf" if dkind == "pdf" else "txt"
            )
            ext = re.sub(r"[^a-z0-9]", "", ext)[:8] or ("pdf" if dkind == "pdf" else "txt")
            dest = os.path.join(PREVIEW_DIR, f"{key}.{ext}")
            path = await client.download_media(msg, file=dest)
            if not path or not os.path.isfile(path):
                raise RuntimeError("Download dokumen gagal")
            return _preview_result(str(path), cached=False, kind=dkind)

        # Video / audio / large docs → progressive stream (+ optional quality)
        result = await start_preview_stream_on_client(
            client,
            folder_id=folder_id,
            message_id=int(message_id),
            quality=play_q,
            skip_poster=skip_poster,
        )
        keep_alive = True  # download task still uses client
        # Detach disconnect: wait for stream completion in background
        from engine.media_stream import get_stream

        media = get_stream(result.get("stream_id") or "")

        async def _hold_client():
            try:
                # Wait until download done or 2h max
                if media:
                    for _ in range(7200):
                        if media.done or media.error:
                            break
                        await asyncio.sleep(1)
            finally:
                try:
                    await client.disconnect()
                except Exception:
                    pass

        try:
            asyncio.get_running_loop().create_task(_hold_client())
        except RuntimeError:
            keep_alive = False

        _json_out(result)
        return result
    except FloodWaitError as e:
        emit_event("FloodWait", seconds=int(e.seconds))
        raise
    finally:
        if not keep_alive:
            try:
                await client.disconnect()
            except Exception:
                pass


def _preview_result(
    path: str, cached: bool, kind: str = "file", *, emit: bool = True
) -> Dict[str, Any]:
    """
    Build preview JSON. Only tiny images get data_url (base64).
    Larger media: path + optional HTTP stream for Tauri player reliability.
    emit=False when returning via drive-serve RPC (must not print [JSON_OUTPUT]).
    """
    abs_path = os.path.abspath(path)
    mime = mimetypes.guess_type(abs_path)[0] or "application/octet-stream"
    size = os.path.getsize(abs_path)
    data_url = None
    # CRITICAL: never base64 large blobs — crashes the app via huge JSON + IPC
    if mime.startswith("image/") and size <= PREVIEW_INLINE_MAX_BYTES:
        try:
            with open(abs_path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("ascii")
            data_url = f"data:{mime};base64,{b64}"
        except Exception:
            data_url = None
    # Also expose progressive HTTP so <img>/<video> can load without asset protocol
    stream_url = None
    stream_id = None
    try:
        from engine.media_stream import get_stream, register_stream

        info = register_stream(
            path=abs_path,
            total_size=size,
            mime=mime,
            label=os.path.basename(abs_path),
        )
        m = get_stream(info["stream_id"])
        if m:
            m.mark_done()
        stream_url = info["stream_url"]
        stream_id = info["stream_id"]
    except Exception:
        pass

    fext = (_file_ext(abs_path) or "").lower()
    if mime.startswith("image/"):
        kind_out = "image"
    elif mime.startswith("video/"):
        kind_out = "video"
    elif mime == "application/pdf" or kind == "pdf" or fext == "pdf":
        kind_out = "pdf"
    elif (
        mime.startswith("text/")
        or kind == "text"
        or "json" in mime
        or "xml" in mime
        or fext in _TEXT_EXTS
    ):
        kind_out = "text"
    else:
        kind_out = kind if kind else ("inline" if data_url else "file")

    result = {
        "status": "success",
        "path": abs_path,
        "mime_type": mime,
        "size": size,
        "data_url": data_url,
        "stream_url": stream_url,
        "stream_id": stream_id,
        "cached": cached,
        "preview_kind": kind_out,
        "streaming": bool(stream_url),
        "too_large": False,
        "quality": "original",
        "qualities": [
            {
                "id": "auto",
                "label": "Original",
                "description": "File asli",
                "native": True,
                "transcode": False,
            }
        ],
    }
    if emit:
        _json_out(result)
    return result


async def delete_file_on_client(
    client: TelegramClient,
    message_id: int,
    folder_id: Optional[int] = None,
) -> Dict[str, Any]:
    peer = await _resolve_peer(client, folder_id)
    await client.delete_messages(peer, [int(message_id)])
    invalidate_cache(folder_id, message_id)
    invalidate_media_stats(folder_id)
    result = {"status": "success", "id": int(message_id)}
    try:
        emit_event("DriveFileDeleted", id=int(message_id), folder_id=folder_id)
    except Exception:
        pass
    return result


async def delete_files_batch_on_client(
    client: TelegramClient,
    message_ids: List[int],
    folder_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Delete many messages in chunks (Telegram allows multi-id delete)."""
    peer = await _resolve_peer(client, folder_id)
    ids = [int(x) for x in (message_ids or []) if x is not None]
    deleted: List[int] = []
    failed: List[Dict[str, Any]] = []
    # Chunk to avoid huge single RPC
    chunk_size = 80
    for i in range(0, len(ids), chunk_size):
        chunk = ids[i : i + chunk_size]
        try:
            await client.delete_messages(peer, chunk)
            for mid in chunk:
                invalidate_cache(folder_id, mid)
                deleted.append(mid)
                try:
                    emit_event("DriveFileDeleted", id=int(mid), folder_id=folder_id)
                except Exception:
                    pass
        except Exception as e:
            # Fallback per-id so one bad id doesn't block the batch
            for mid in chunk:
                try:
                    await client.delete_messages(peer, [mid])
                    invalidate_cache(folder_id, mid)
                    deleted.append(mid)
                except Exception as e2:
                    failed.append({"id": mid, "error": str(e2)})
            if not failed and chunk:
                failed.append({"id": chunk[0], "error": str(e)})
    if deleted:
        invalidate_media_stats(folder_id)
    return {
        "status": "success" if deleted or not failed else "error",
        "deleted": deleted,
        "failed": failed,
        "count": len(deleted),
    }


async def delete_file(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    message_id: int,
    folder_id: Optional[int] = None,
) -> Dict[str, Any]:
    setup_emitter(None, None)
    client = await _connect(session_name, api_id, api_hash)
    try:
        result = await delete_file_on_client(client, int(message_id), folder_id)
        _json_out(result)
        return result
    finally:
        await client.disconnect()


async def rename_file_on_client(
    client: TelegramClient,
    message_id: int,
    new_name: str,
    folder_id: Optional[int] = None,
) -> Dict[str, Any]:
    name = (new_name or "").strip()
    if not name:
        raise ValueError("new_name required")
    peer = await _resolve_peer(client, folder_id)
    msg = await client.get_messages(peer, ids=int(message_id))
    if not msg:
        raise RuntimeError("Message not found")
    await client.edit_message(peer, int(message_id), name)
    result = {"status": "success", "id": int(message_id), "name": name}
    try:
        emit_event("DriveFileRenamed", id=int(message_id), name=name, folder_id=folder_id)
    except Exception:
        pass
    return result


async def rename_file(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    message_id: int,
    new_name: str,
    folder_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Rename by editing message caption/text (Telegram-Drive model)."""
    setup_emitter(None, None)
    client = await _connect(session_name, api_id, api_hash)
    try:
        result = await rename_file_on_client(client, int(message_id), new_name, folder_id)
        _json_out(result)
        return result
    finally:
        await client.disconnect()


def _is_forward_forbidden_error(err: BaseException) -> bool:
    s = str(err).lower()
    name = type(err).__name__.lower()
    needles = (
        "forbid",
        "forbidden",
        "restrict",
        "not allowed",
        "can't write",
        "cannot write",
        "chat_write",
        "chatwrite",
        "user_banned",
        "userisblocked",
        "blocked",
        "privacy",
        "protected",
        "admin",
        "right",
        "channel_private",
        "channelprivate",
        "peer_id_invalid",
        "peeridinvalid",
        "input_user_deactivated",
        "slowmode",
        "send media",
        "send_media",
        "media_empty",
        "message_id_invalid",
    )
    blob = f"{name} {s}"
    return any(n in blob for n in needles)


async def move_file_on_client(
    client: TelegramClient,
    message_id: int,
    from_folder_id: Optional[int],
    to_folder_id: Optional[int],
    *,
    topic_id: Optional[int] = None,
    delete_source: bool = True,
) -> Dict[str, Any]:
    """
    Move/copy media to another chat/folder (warm session / one-shot).
    1) Try forward (fast)
    2) If forbidden/restricted → copy via send_file (re-upload media reference)
    3) Optionally delete source when deliver succeeded (move semantics)
    topic_id: forum topic (reply_to) when destination is a forum group.
    """
    if from_folder_id == to_folder_id and not topic_id:
        raise ValueError("Source and destination are the same")
    # Counts/sizes at both locations will change
    invalidate_media_stats(from_folder_id)
    invalidate_media_stats(to_folder_id)
    src = await _resolve_peer(client, from_folder_id)
    try:
        dst = await _resolve_peer(client, to_folder_id)
    except Exception:
        try:
            await client.get_dialogs(limit=200)
        except Exception:
            pass
        dst = await _resolve_peer(client, to_folder_id)

    msg = await client.get_messages(src, ids=int(message_id))
    if not msg:
        raise RuntimeError("Pesan sumber tidak ditemukan")
    if not getattr(msg, "media", None):
        raise RuntimeError("Pesan tidak berisi media")

    new_id = None
    mode = "forward"
    last_err: Optional[BaseException] = None
    tid = int(topic_id) if topic_id is not None and int(topic_id) > 0 else None
    # Forum: send/forward into topic via reply_to = topic top message id
    topic_kwargs: Dict[str, Any] = {}
    if tid:
        topic_kwargs["reply_to"] = tid

    try:
        try:
            forwarded = await client.forward_messages(
                dst, [int(message_id)], src, **topic_kwargs
            )
        except TypeError:
            # Older Telethon: no reply_to on forward
            forwarded = await client.forward_messages(dst, [int(message_id)], src)
        if forwarded:
            m = forwarded[0] if isinstance(forwarded, list) else forwarded
            new_id = getattr(m, "id", None)
    except Exception as e:
        last_err = e
        if not _is_forward_forbidden_error(e):
            pass
        mode = "copy"
        try:
            caption = (getattr(msg, "message", None) or "") or None
            send_kw: Dict[str, Any] = {
                "caption": caption,
                "force_document": bool(
                    isinstance(msg.media, MessageMediaDocument)
                    and _icon_type_from_message(msg) not in ("image", "video")
                ),
            }
            if tid:
                send_kw["reply_to"] = tid
            sent = await client.send_file(dst, msg.media, **send_kw)
            if isinstance(sent, list):
                sent = sent[0] if sent else None
            new_id = getattr(sent, "id", None) if sent else None
            last_err = None
        except Exception as e2:
            last_err = e2
            try:
                import tempfile

                with tempfile.TemporaryDirectory(prefix="ag_move_") as td:
                    local = await client.download_media(msg, file=os.path.join(td, "media"))
                    if not local or not os.path.isfile(local):
                        raise RuntimeError("Gagal unduh media untuk salin")
                    caption = (getattr(msg, "message", None) or "") or None
                    fname = _doc_real_filename(msg)
                    dest_path = local
                    if fname:
                        dest_path = os.path.join(td, fname)
                        try:
                            if dest_path != local:
                                os.replace(local, dest_path)
                        except OSError:
                            dest_path = local
                    re_kw: Dict[str, Any] = {"caption": caption}
                    if tid:
                        re_kw["reply_to"] = tid
                    sent = await client.send_file(dst, dest_path, **re_kw)
                    if isinstance(sent, list):
                        sent = sent[0] if sent else None
                    new_id = getattr(sent, "id", None) if sent else None
                    mode = "reupload"
                    last_err = None
            except Exception as e3:
                last_err = e3

    if last_err is not None or new_id is None:
        hint = str(last_err) if last_err else "tidak ada id pesan baru"
        raise RuntimeError(
            f"Tidak bisa kirim ke tujuan ({hint}). "
            "Cek: hak kirim media di chat, bot di-block, atau konten dilindungi."
        )

    deleted = False
    if delete_source:
        try:
            await client.delete_messages(src, [int(message_id)])
            deleted = True
            invalidate_cache(from_folder_id, message_id)
        except Exception:
            deleted = False

    result = {
        "status": "success",
        "old_id": int(message_id),
        "new_id": int(new_id) if new_id else None,
        "from_folder_id": from_folder_id,
        "to_folder_id": to_folder_id,
        "topic_id": tid,
        "mode": mode,
        "deleted_source": deleted,
        "delete_source_requested": bool(delete_source),
    }
    try:
        emit_event("DriveFileMoved", **result)
    except Exception:
        pass
    return result


async def move_file(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    message_id: int,
    from_folder_id: Optional[int],
    to_folder_id: Optional[int],
    topic_id: Optional[int] = None,
    delete_source: bool = True,
) -> Dict[str, Any]:
    setup_emitter(None, None)
    client = await _connect(session_name, api_id, api_hash)
    try:
        result = await move_file_on_client(
            client,
            int(message_id),
            from_folder_id,
            to_folder_id,
            topic_id=topic_id,
            delete_source=delete_source,
        )
        _json_out(result)
        return result
    finally:
        await client.disconnect()


async def download_file(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    message_id: int,
    save_path: str,
    folder_id: Optional[int] = None,
) -> Dict[str, Any]:
    setup_emitter(None, None)
    if not save_path:
        raise ValueError("save_path required")
    from engine.path_policy import validate_save_path

    save_path = validate_save_path(save_path)
    parent = os.path.dirname(os.path.abspath(save_path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    from engine.transfer_log import tlog, tlog_exc, log_path, set_transfer_session
    from engine.download_registry import register_download_path, unregister_download_path

    set_transfer_session(f"drive-dl-{int(message_id)}-{int(time.time())}")
    register_download_path(save_path)
    tlog(
        "download_file start",
        phase="drive_download",
        message_id=int(message_id),
        save_path=save_path,
        folder_id=folder_id,
        log_file=log_path(),
    )
    client = await _connect(session_name, api_id, api_hash)
    t0 = time.time()
    last_t = t0
    last_b = 0
    peak = 0.0
    last_log_pct = -1
    try:
        peer = await _resolve_peer(client, folder_id)
        msg = await client.get_messages(peer, ids=int(message_id))
        if not msg or not msg.media:
            raise RuntimeError("Message has no media")
        doc = getattr(msg, "document", None)
        size_hint = int(getattr(doc, "size", 0) or 0) if doc else 0
        tlog(
            "message resolved",
            phase="drive_download",
            message_id=int(message_id),
            has_document=bool(doc),
            size_hint=size_hint,
            file_name=_file_name_from_message(msg) if msg else None,
        )

        def progress(received: int, total: int):
            nonlocal last_t, last_b, peak, last_log_pct
            now = time.time()
            dt = max(now - last_t, 1e-6)
            inst = ((received - last_b) / dt) / (1024 * 1024)
            peak = max(peak, inst)
            last_t, last_b = now, received
            elapsed = max(now - t0, 1e-6)
            avg = (received / elapsed) / (1024 * 1024)
            # Cap <100% until DriveDownloadDone (prevents “100% then re-download” UI)
            pct = round(100.0 * received / total, 2) if total else 0
            if total and pct >= 100.0 and received < total:
                pct = 99.9
            elif total and received >= total:
                pct = 99.9  # true 100% only after finalize event
            cur = received
            if total and cur >= total:
                cur = max(0, total - 1)
            # Milestone logs every ~10%
            bucket = int(pct // 10) * 10 if total else 0
            if total and bucket != last_log_pct and bucket % 10 == 0:
                last_log_pct = bucket
                tlog(
                    "download progress milestone",
                    phase="drive_download",
                    percent=pct,
                    received=received,
                    total=total,
                    speed_mb_s=round(avg, 3),
                )
            emit_event(
                "DriveProgress",
                phase="download",
                message_id=int(message_id),
                transferred=received,
                total=total or 0,
                percent=pct,
                speed_mb_s=round(avg, 3),
                peak_mb_s=round(peak, 3),
                item_index=0,
                items_total=1,
                item_current=cur,
                item_total=total or 0,
                path=save_path,
            )

        from engine.fast_transfer import fast_download_media

        emit_event(
            "DriveItemStarted",
            index=0,
            message_id=int(message_id),
            path=save_path,
            file_name=os.path.basename(save_path),
        )

        path = await fast_download_media(
            client,
            msg,
            save_path,
            workers=0,
            progress_callback=progress,
        )
        result = {
            "status": "success",
            "path": os.path.abspath(path or save_path),
            "message_id": int(message_id),
            "size": os.path.getsize(path) if path and os.path.isfile(path) else 0,
            "duration_s": round(time.time() - t0, 3),
        }
        unregister_download_path(save_path)
        tlog("download_file SUCCESS", phase="drive_download", **result)
        emit_event("DriveDownloadDone", **result)
        _json_out(result)
        return result
    except FloodWaitError as e:
        tlog("FloodWait", level="WARN", phase="drive_download", seconds=int(e.seconds))
        emit_event("FloodWait", seconds=int(e.seconds))
        raise
    except Exception as e:
        tlog_exc("download_file FAILED", e, phase="drive_download", save_path=save_path)
        # Leave registry entry so cancel/cleanup can wipe partials
        raise
    finally:
        await client.disconnect()


async def download_batch(
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    message_ids: List[int],
    save_dir: str,
    folder_id: Optional[int] = None,
    concurrency: int = 4,
) -> Dict[str, Any]:
    """Parallel download of multiple messages into save_dir (concurrent files + parts)."""
    setup_emitter(None, None)
    if not message_ids:
        raise ValueError("message_ids required")
    if not save_dir:
        raise ValueError("save_dir required")
    from engine.path_policy import safe_join_download, validate_save_dir
    from engine.transfer_log import tlog, tlog_exc, log_path, set_transfer_session

    save_dir = validate_save_dir(save_dir)
    os.makedirs(save_dir, exist_ok=True)
    # Higher file-level concurrency; FloodWait still handled per item
    conc = max(1, min(int(concurrency or 4), 8))
    set_transfer_session(f"drive-batch-{int(time.time())}")
    tlog(
        "download_batch start",
        phase="drive_batch",
        items=len(message_ids),
        concurrency=conc,
        save_dir=save_dir,
        folder_id=folder_id,
        log_file=log_path(),
    )
    client = await _connect(session_name, api_id, api_hash)
    sem = asyncio.Semaphore(conc)
    items: List[Dict[str, Any]] = []
    total_bytes = 0
    t0 = time.time()
    peak = 0.0
    done_count = 0
    n = len(message_ids)
    flood_hits = {"n": 0}

    try:
        from engine.fast_transfer import fast_download_media

        peer = await _resolve_peer(client, folder_id)
        emit_event("DriveListStarted", mode="download_batch", items=n, concurrency=conc)

        async def _wait_pause():
            from engine.path_policy import is_transfer_paused

            announced = False
            while is_transfer_paused():
                if not announced:
                    emit_event("DrivePaused", message="Paused between files")
                    announced = True
                await asyncio.sleep(0.4)
            if announced:
                emit_event("DriveResumed", message="Resumed")

        async def one(idx: int, mid: int):
            nonlocal total_bytes, peak, done_count
            async with sem:
                await _wait_pause()
                dest = None
                try:
                    msg = await client.get_messages(peer, ids=int(mid))
                    if not msg or not msg.media:
                        items.append({"id": mid, "status": "failed", "error": "no media"})
                        emit_event(
                            "DriveItemDone",
                            index=idx,
                            message_id=int(mid),
                            status="failed",
                            error="no media",
                        )
                        return
                    name = _file_name_from_message(msg)
                    safe = re.sub(r'[<>:"/\\|?*]', "_", name)[:180]
                    dest = safe_join_download(save_dir, f"{idx + 1:03d}_{safe}")
                    from engine.download_registry import (
                        register_download_path,
                        unregister_download_path,
                    )

                    register_download_path(dest)
                    size_hint = 0
                    try:
                        doc = getattr(msg, "document", None) or getattr(
                            getattr(msg, "media", None), "document", None
                        )
                        if doc is not None:
                            size_hint = int(getattr(doc, "size", 0) or 0)
                    except Exception:
                        size_hint = 0
                    emit_event(
                        "DriveItemStarted",
                        index=idx,
                        message_id=int(mid),
                        file_name=name,
                        path=dest,
                        size=size_hint,
                    )
                    tlog(
                        "batch item start",
                        phase="drive_batch",
                        index=idx,
                        message_id=int(mid),
                        file_name=name,
                        size_hint=size_hint,
                        dest=dest,
                    )
                    last_t = time.time()
                    last_b = 0

                    def progress(received: int, total: int):
                        nonlocal last_t, last_b, peak
                        now = time.time()
                        dt = max(now - last_t, 1e-6)
                        inst = ((received - last_b) / dt) / (1024 * 1024)
                        peak = max(peak, inst)
                        last_t, last_b = now, received
                        elapsed = max(now - t0, 1e-6)
                        avg = ((total_bytes + received) / elapsed) / (1024 * 1024)
                        item_tot = total or size_hint or 0
                        # Overall: completed files + current fraction
                        # Cap below 100% until DriveItemDone — avoids “100% then restart” UX
                        # when a part path falls back mid-file.
                        frac = (received / max(item_tot, 1)) if item_tot else 0.0
                        frac = min(frac, 0.99)
                        overall_pct = round(
                            100.0 * (done_count + min(1.0, frac)) / max(n, 1), 2
                        )
                        if overall_pct >= 100.0 and done_count + 1 < n:
                            overall_pct = 99.0
                        elif overall_pct >= 100.0:
                            overall_pct = 99.0
                        item_cur = received
                        if item_tot > 0 and item_cur >= item_tot:
                            item_cur = max(0, item_tot - 1)
                        emit_event(
                            "DriveProgress",
                            phase="download",
                            message_id=int(mid),
                            file_name=name,
                            transferred=total_bytes + received,
                            total=0,
                            percent=overall_pct,
                            speed_mb_s=round(avg, 3),
                            peak_mb_s=round(peak, 3),
                            item_index=idx,
                            items_total=n,
                            item_current=item_cur,
                            item_total=item_tot,
                        )

                    # Adaptive part workers after FloodWait storms
                    pw = 0 if flood_hits["n"] == 0 else max(2, 8 // (1 + flood_hits["n"]))
                    path = await fast_download_media(
                        client,
                        msg,
                        dest,
                        workers=pw,
                        progress_callback=progress,
                    )
                    size = os.path.getsize(path) if path and os.path.isfile(path) else 0
                    total_bytes += size
                    done_count += 1
                    items.append({"id": mid, "status": "done", "path": path, "size": size})
                    unregister_download_path(dest)
                    tlog(
                        "batch item done",
                        phase="drive_batch",
                        index=idx,
                        message_id=int(mid),
                        path=path,
                        size=size,
                        file_name=name,
                    )
                    emit_event(
                        "DriveItemDone",
                        index=idx,
                        message_id=int(mid),
                        status="done",
                        path=path,
                        size=size,
                        file_name=name,
                    )
                except FloodWaitError as e:
                    flood_hits["n"] = min(flood_hits["n"] + 1, 4)
                    emit_event("FloodWait", seconds=int(e.seconds))
                    await asyncio.sleep(int(e.seconds) + 1)
                    # Clean partial + unregister
                    from engine.download_registry import cleanup_paths, unregister_download_path

                    if dest:
                        cleanup_paths([dest])
                        unregister_download_path(dest)
                    items.append({"id": mid, "status": "failed", "error": f"FloodWait {e.seconds}"})
                    emit_event(
                        "DriveItemDone",
                        index=idx,
                        message_id=int(mid),
                        status="failed",
                        error=f"FloodWait {e.seconds}",
                    )
                except Exception as e:
                    from engine.download_registry import cleanup_paths, unregister_download_path

                    if dest:
                        cleanup_paths([dest])
                        unregister_download_path(dest)
                    items.append({"id": mid, "status": "failed", "error": str(e)})
                    emit_event(
                        "DriveItemDone",
                        index=idx,
                        message_id=int(mid),
                        status="failed",
                        error=str(e),
                    )

        await asyncio.gather(*[one(i, mid) for i, mid in enumerate(message_ids)])
        elapsed = max(time.time() - t0, 1e-6)
        result = {
            "status": "success",
            "items": items,
            "save_dir": os.path.abspath(save_dir),
            "size_bytes": total_bytes,
            "duration_s": round(elapsed, 3),
            "avg_mb_s": round((total_bytes / (1024 * 1024)) / elapsed, 3) if total_bytes else 0,
            "peak_mb_s": round(peak, 3),
        }
        emit_event("DriveDownloadDone", **{k: v for k, v in result.items() if k != "items"})
        _json_out(result)
        return result
    finally:
        await client.disconnect()


async def run_drive_action(
    action: str,
    *,
    session_name: str,
    api_id: int,
    api_hash: str,
    folder_id: Optional[int] = None,
    to_folder_id: Optional[int] = None,
    message_id: Optional[int] = None,
    message_ids: Optional[List[int]] = None,
    name: Optional[str] = None,
    save_path: Optional[str] = None,
    include_td: bool = True,
    limit: int = 80,
    page_size: Optional[int] = None,
    offset_id: Optional[int] = None,
    chat_offset: int = 0,
    files: Optional[List[Dict[str, Any]]] = None,
    options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Dispatch table used by daemon."""
    act = (action or "").strip().lower().replace("_", "-")
    opts = options or {}

    def _opt_topic_id() -> Optional[int]:
        raw = opts.get("topic_id", opts.get("topicId"))
        if raw in (None, "", "null", "None", "all", "ALL", 0, "0"):
            return None
        try:
            v = int(raw)
            return v if v > 0 else None
        except Exception:
            return None

    try:
        if act in ("scan-folders", "drive-scan-folders"):
            return await scan_folders(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                include_td=True,
            )
        if act in ("bootstrap", "drive-bootstrap"):
            ps = int(page_size or limit or 40)
            return await bootstrap_drive(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                folder_id=folder_id,
                file_page_size=ps,
                chat_page_size=int(opts.get("chat_page_size") or 60),
                topic_id=_opt_topic_id(),
            )
        if act in ("list-chats", "drive-list-chats"):
            ps = int(page_size or limit or 100)
            op = opts.get("offset_peer_id") or opts.get("offsetPeerId")
            oi = opts.get("offset_id") or opts.get("offsetId") or 0
            od = opts.get("offset_date") or opts.get("offsetDate")
            cf = opts.get("chat_folder_id") or opts.get("chatFolderId")
            return await list_chats(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                limit=ps,
                offset=int(chat_offset or 0),
                offset_id=int(oi or 0),
                offset_date=od,
                offset_peer_id=int(op) if op not in (None, "", 0, "0") else None,
                chat_folder_id=int(cf) if cf not in (None, "", 0, "0") else None,
            )
        if act in ("list-chat-folders", "drive-list-chat-folders"):
            client = await _connect(session_name, api_id, api_hash)
            try:
                folders = await _list_chat_folders_on(client, force=bool(opts.get("force")))
                result = {"status": "success", "folders": folders}
                _json_out(result)
                return result
            finally:
                await client.disconnect()
        if act in ("create-folder", "drive-create-folder"):
            # Only nest when parent_id/parentId is explicit — never treat list folder_id as parent
            raw_parent = opts.get("parent_id", opts.get("parentId"))
            parent_arg: Optional[int] = None
            if raw_parent not in (None, "", "null", "None", 0, "0"):
                try:
                    parent_arg = int(raw_parent)
                except Exception:
                    parent_arg = None
            return await create_folder(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                name=name or "",
                parent_id=parent_arg,
            )
        if act in ("delete-folder", "drive-delete-folder"):
            if folder_id is None:
                raise ValueError("folder_id required to delete Drive folder")
            cascade = bool(opts.get("cascade") or opts.get("Cascade"))
            detach = bool(
                opts.get("detach_children")
                or opts.get("detachChildren")
                or opts.get("detach")
            )
            return await delete_folder(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                folder_id=int(folder_id),
                cascade=cascade,
                detach_children=detach,
            )
        if act in ("rename-folder", "drive-rename-folder"):
            if folder_id is None:
                raise ValueError("folder_id required to rename Drive folder")
            return await rename_folder(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                folder_id=int(folder_id),
                name=name or str(opts.get("name") or ""),
            )
        if act in ("set-folder-parent", "reparent-folder", "drive-set-folder-parent"):
            if folder_id is None:
                raise ValueError("folder_id required to reparent Drive folder")
            raw_parent = opts.get("parent_id", opts.get("parentId", to_folder_id))
            parent_arg: Optional[int] = None
            if raw_parent not in (None, "", "null", "None"):
                try:
                    parent_arg = int(raw_parent)
                except Exception:
                    parent_arg = None
            return await set_folder_parent(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                folder_id=int(folder_id),
                parent_id=parent_arg,
            )
        if act in ("create-topic", "drive-create-topic"):
            title = opts.get("title")
            if folder_id is None or not title:
                out = {"status": "error", "error": "Folder ID (chat_id) and title are required"}
                _json_out(out)
                return out
            return await create_topic(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                chat_id=int(folder_id),
                title=str(title),
            )
        if act in ("delete-topic", "drive-delete-topic"):
            raw_tid = opts.get("topic_id") or opts.get("topicId") or message_id
            if folder_id is None or raw_tid is None:
                out = {"status": "error", "error": "folder_id and topic_id are required"}
                _json_out(out)
                return out
            return await delete_topic(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                chat_id=int(folder_id),
                topic_id=int(raw_tid),
            )
        if act in ("rename-topic", "drive-rename-topic", "edit-topic", "drive-edit-topic"):
            raw_tid = opts.get("topic_id") or opts.get("topicId") or message_id
            title = opts.get("title") or name or str(opts.get("name") or "")
            if folder_id is None or raw_tid is None or not title:
                out = {"status": "error", "error": "folder_id, topic_id, and new title are required"}
                _json_out(out)
                return out
            return await rename_topic(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                chat_id=int(folder_id),
                topic_id=int(raw_tid),
                name=str(title),
            )
        if act in ("list-topics", "drive-list-topics"):
            if folder_id is None:
                out = {"status": "success", "topics": [], "is_forum": False, "chat_id": None}
                _json_out(out)
                return out
            return await list_topics(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                chat_id=int(folder_id),
            )
        if act in ("list-files", "drive-list-files"):
            ps = int(page_size or limit or 40)
            return await list_files(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                folder_id=folder_id,
                limit=ps,
                offset_id=offset_id,
                topic_id=_opt_topic_id(),
            )
        if act in ("media-stats", "media_stats", "drive-media-stats", "stats"):
            client = await _connect(session_name, api_id, api_hash)
            try:
                force = bool(opts.get("force") or opts.get("refresh"))
                peek = bool(opts.get("peek") or opts.get("cache_only"))
                result = await media_stats_on_client(
                    client,
                    folder_id=folder_id,
                    topic_id=_opt_topic_id(),
                    force=force,
                    peek=peek,
                )
                _json_out(result)
                return result
            finally:
                try:
                    await client.disconnect()
                except Exception:
                    pass
        if act in ("thumbnails", "drive-thumbnails", "thumbnails-batch"):
            ids = message_ids or ([int(message_id)] if message_id is not None else [])
            tq = opts.get("quality") or opts.get("thumb_quality") or opts.get("thumbQuality")
            return await get_thumbnails_batch(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                message_ids=ids,
                folder_id=folder_id,
                quality=str(tq) if tq is not None else None,
            )
        if act in ("avatars", "avatars-batch", "drive-avatars", "profile-photos"):
            raw_ids = opts.get("peer_ids") or opts.get("peerIds") or message_ids or []
            pids = [int(x) for x in (raw_ids or [])]
            return await get_avatars_batch(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                peer_ids=pids,
            )
        if act in ("download-batch", "drive-download-batch"):
            ids = message_ids or ([int(message_id)] if message_id is not None else [])
            opts = options or {}
            save_dir = save_path or opts.get("save_dir") or ""
            return await download_batch(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                message_ids=[int(x) for x in ids],
                save_dir=str(save_dir),
                folder_id=folder_id,
                concurrency=int(opts.get("concurrency") or 4),
            )
        if act in ("thumbnail", "drive-thumbnail"):
            if message_id is None:
                raise ValueError("message_id required")
            tq = opts.get("quality") or opts.get("thumb_quality") or opts.get("thumbQuality")
            return await get_thumbnail(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                message_id=int(message_id),
                folder_id=folder_id,
                quality=str(tq) if tq is not None else None,
            )
        if act in ("zip-list", "drive-zip-list", "zip_list"):
            if message_id is None:
                raise ValueError("message_id required")
            client = await _connect(session_name, api_id, api_hash)
            try:
                result = await zip_list_on_client(
                    client, folder_id=folder_id, message_id=int(message_id)
                )
                _json_out(result)
                return result
            finally:
                try:
                    await client.disconnect()
                except Exception:
                    pass
        if act in ("zip-read", "drive-zip-read", "zip_read", "zip-entry"):
            if message_id is None:
                raise ValueError("message_id required")
            entry = str(opts.get("entry") or opts.get("entry_name") or opts.get("path") or "")
            if not entry:
                raise ValueError("entry required")
            client = await _connect(session_name, api_id, api_hash)
            try:
                result = await zip_read_entry_on_client(
                    client,
                    folder_id=folder_id,
                    message_id=int(message_id),
                    entry_name=entry,
                )
                _json_out(result)
                return result
            finally:
                try:
                    await client.disconnect()
                except Exception:
                    pass
        if act in ("preview", "drive-preview"):
            if message_id is None:
                raise ValueError("message_id required")
            pq = opts.get("quality") or opts.get("play_quality") or opts.get("playQuality")
            sp = opts.get("skip_poster")
            if sp is None:
                sp = opts.get("skipPoster")
            skip_p = True if sp is None else bool(sp)
            return await get_preview(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                message_id=int(message_id),
                folder_id=folder_id,
                quality=str(pq) if pq is not None else None,
                skip_poster=skip_p,
            )
        if act in ("delete", "drive-delete"):
            if message_id is None:
                raise ValueError("message_id required")
            return await delete_file(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                message_id=int(message_id),
                folder_id=folder_id,
            )
        if act in ("delete-batch", "drive-delete-batch"):
            ids = message_ids or ([int(message_id)] if message_id is not None else [])
            if not ids:
                raise ValueError("message_ids required")
            client = await _connect(session_name, api_id, api_hash)
            try:
                result = await delete_files_batch_on_client(
                    client, [int(x) for x in ids], folder_id
                )
                _json_out(result)
                return result
            finally:
                await client.disconnect()
        if act in ("rename", "drive-rename"):
            if message_id is None:
                raise ValueError("message_id required")
            return await rename_file(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                message_id=int(message_id),
                new_name=name or "",
                folder_id=folder_id,
            )
        if act in ("move", "drive-move"):
            if message_id is None:
                raise ValueError("message_id required")
            raw_tid = opts.get("topic_id", opts.get("topicId"))
            try:
                m_tid = int(raw_tid) if raw_tid not in (None, "", 0, "0") else None
            except Exception:
                m_tid = None
            del_src = opts.get("delete_source", opts.get("deleteSource"))
            if del_src is None:
                del_src = True
            return await move_file(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                message_id=int(message_id),
                from_folder_id=folder_id,
                to_folder_id=to_folder_id,
                topic_id=m_tid,
                delete_source=bool(del_src),
            )
        if act in ("download", "drive-download"):
            if message_id is None:
                raise ValueError("message_id required")
            return await download_file(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                message_id=int(message_id),
                save_path=save_path or "",
                folder_id=folder_id,
            )
        if act in ("upload", "drive-upload"):
            # Reuse media_studio pipeline into Saved Messages or folder
            from engine.media_studio import run_media_studio

            chat_id = "me" if folder_id is None else str(folder_id)
            return await run_media_studio(
                session_name=session_name,
                api_id=api_id,
                api_hash=api_hash,
                chat_id=chat_id,
                action="upload",
                files=files,
                options=opts,
            )
        raise ValueError(f"Unknown drive action: {action}")
    except Exception as e:
        err = {"status": "error", "error": str(e)}
        try:
            emit_event("DriveFailed", error=str(e), action=act)
        except Exception:
            pass
        _json_out(err)
        return err
