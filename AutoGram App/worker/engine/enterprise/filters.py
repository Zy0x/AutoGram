from telethon.tl.types import MessageMediaPhoto, MessageMediaDocument, DocumentAttributeVideo, DocumentAttributeAudio
import re
import datetime
from typing import Any, Optional


def passes_media_filter(media, config) -> bool:
    if not config:
        return True
    f = config.get("media_filter", "all")
    if f in (None, "", "all", "Semua", "All", "ALL"):
        return True

    is_photo = isinstance(media, MessageMediaPhoto)
    is_video = False
    is_audio = False
    is_voice = False
    is_gif = False
    is_doc = False

    if isinstance(media, MessageMediaDocument):
        is_doc = True
        for attr in media.document.attributes:
            if isinstance(attr, DocumentAttributeVideo):
                is_video = True
                is_doc = False
            elif isinstance(attr, DocumentAttributeAudio):
                if attr.voice:
                    is_voice = True
                else:
                    is_audio = True
                is_doc = False
        mime = getattr(media.document, "mime_type", "") or ""
        if mime == "image/gif":
            is_gif = True
            is_doc = False

    fl = str(f).lower()
    if fl in ("photo", "foto") and is_photo:
        return True
    if fl in ("video",) and is_video:
        return True
    if fl in ("document", "dokumen", "doc") and is_doc:
        return True
    if fl in ("audio",) and is_audio:
        return True
    if fl in ("voice",) and is_voice:
        return True
    if fl in ("gif", "animation") and is_gif:
        return True

    # Multi-type filters e.g. "photo,video"
    if "," in fl:
        parts = {p.strip() for p in fl.split(",")}
        if "photo" in parts and is_photo:
            return True
        if "video" in parts and is_video:
            return True
        if "document" in parts and is_doc:
            return True
        if "audio" in parts and is_audio:
            return True
        if "voice" in parts and is_voice:
            return True
        if "gif" in parts and is_gif:
            return True

    return False


def passes_size_filter(media, config) -> bool:
    if not config:
        return True
    min_mb = config.get("size_min_mb") or 0
    max_mb = config.get("size_max_mb") or 0

    try:
        min_mb = float(min_mb)
    except Exception:
        min_mb = 0.0
    try:
        max_mb = float(max_mb)
    except Exception:
        max_mb = 0.0

    # 0/0 = no filter; max 0 = unlimited upper bound
    if min_mb == 0 and max_mb == 0:
        return True

    size_bytes = 0
    if isinstance(media, MessageMediaDocument):
        size_bytes = media.document.size
    elif isinstance(media, MessageMediaPhoto):
        size_bytes = max(
            [sz.size for sz in media.photo.sizes if hasattr(sz, "size")] + [0]
        )

    size_mb = size_bytes / (1024 * 1024)

    if min_mb > 0 and size_mb < min_mb:
        return False
    if max_mb > 0 and size_mb > max_mb:
        return False
    return True


def process_caption(caption_text: str, config: dict) -> str:
    if config is None:
        return caption_text or ""

    rule = config.get("caption_rule", "") or ""
    custom = config.get("custom_caption") or ""
    enable = config.get("enable_caption_rule", True)

    if not enable:
        return caption_text or ""

    # Explicit custom caption overrides body
    if custom and (
        str(rule).lower() in ("custom caption", "custom", "replace")
        or str(rule).lower().startswith("custom:")
    ):
        return str(custom)

    if str(rule).lower().startswith("custom:"):
        return rule.split(":", 1)[1]

    if not caption_text:
        # Allow custom caption when original empty
        if custom and "custom" in str(rule).lower():
            return str(custom)
        return ""

    if rule in ("remove", "Remove Caption"):
        return ""
    if rule in ("strip_links", "Strip Links (Hapus URL)"):
        return re.sub(r"http[s]?://\S+", "", caption_text)

    # Append custom footer if provided with keep original
    if custom and rule in ("Keep Original", "keep", "", "Keep"):
        return f"{caption_text}\n\n{custom}".strip()

    return caption_text


def parse_date_bound(value: Any) -> Optional[datetime.date]:
    if not value:
        return None
    if isinstance(value, datetime.datetime):
        return value.date()
    if isinstance(value, datetime.date):
        return value
    s = str(value).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y"):
        try:
            return datetime.datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    return None


def message_in_date_range(message, config) -> bool:
    """Return False if message is outside configured date range."""
    if not config:
        return True
    start = parse_date_bound(config.get("start_date"))
    end = parse_date_bound(config.get("end_date"))
    if not start and not end:
        return True
    try:
        msg_dt = message.date
        if msg_dt is None:
            return True
        if getattr(msg_dt, "tzinfo", None):
            msg_d = msg_dt.astimezone(datetime.timezone.utc).date()
        else:
            msg_d = msg_dt.date() if hasattr(msg_dt, "date") else msg_dt
    except Exception:
        return True
    if start and msg_d < start:
        return False
    if end and msg_d > end:
        return False
    return True
