"""
fingerprint_engine.py
─────────────────────
Multi-Tier Fingerprinting for Media Studio duplicate detection.

Extracts media attributes from Telegram messages WITHOUT downloading
any file from the destination. Constructs a deterministic "fingerprint
hash" per media type so two copies of the same content match even if
they have slightly different metadata (e.g. re-encoded photos).

Tier ranking (1 = most reliable → 4 = last resort):
    Document  1: sha256_hash (from local source)   or  file_name|file_size
              2: file_unique_id
              3: file_name|file_size (fallback if sha256 not yet available)
    Photo     1: file_unique_id of largest size variant + WxH
              2: file_unique_id only
    Video     1: file_unique_id + duration + size
              2: file_unique_id
    Audio/Voice 1: file_unique_id + duration + size
              2: file_unique_id
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from telethon import types as tl


@dataclass
class MediaFingerprint:
    """Fingerprint extracted from a Telegram message or a local source file."""

    media_type:        str   = "unknown"   # document|photo|video|audio|voice
    tier:              int   = 4           # 1(best)..4(fallback)
    primary_hash:      Optional[str] = None  # main lookup key stored in DB
    secondary_hashes:  List[str] = field(default_factory=list)  # fallback keys
    file_unique_id:    Optional[str] = None
    file_name:         Optional[str] = None
    file_size:         Optional[int] = None
    width:             Optional[int] = None
    height:            Optional[int] = None
    duration:          Optional[int] = None
    mime_type:         Optional[str] = None
    sha256:            Optional[str] = None  # available only for local uploads

    # ── factory helpers ─────────────────────────────────────────────

    @classmethod
    def from_telegram_message(cls, msg) -> Optional["MediaFingerprint"]:
        """
        Build a fingerprint from a Telethon message object.
        Returns None if the message has no usable media.
        No file is downloaded.
        """
        if msg is None:
            return None

        # ── Photo ───────────────────────────────────────────────────
        photo = getattr(msg, "photo", None)
        if photo and hasattr(photo, "sizes"):
            return cls._from_photo(photo)

        # ── Document (video, audio, voice, generic doc) ─────────────
        doc = None
        if hasattr(msg, "media"):
            m = msg.media
            if isinstance(m, tl.MessageMediaDocument):
                doc = getattr(m, "document", None)
        if doc is None:
            doc = getattr(msg, "document", None)
        if doc:
            return cls._from_document(doc)

        return None

    # ── internal factories ──────────────────────────────────────────

    @classmethod
    def _from_photo(cls, photo) -> "MediaFingerprint":
        fp = cls(media_type="photo")

        # Pick the largest thumbnail/size for the unique ID
        sizes = getattr(photo, "sizes", []) or []
        best  = None
        best_area = -1
        for s in sizes:
            w = getattr(s, "w", 0) or 0
            h = getattr(s, "h", 0) or 0
            if w * h > best_area:
                best_area = w * h
                best = s

        fuid = str(getattr(photo, "file_unique_id", "") or "")
        fp.file_unique_id = fuid or None
        if best:
            fp.width  = getattr(best, "w", None)
            fp.height = getattr(best, "h", None)

        if fuid and fp.width and fp.height:
            fp.tier         = 1
            fp.primary_hash = _hash_str(f"photo:{fuid}:{fp.width}x{fp.height}")
            fp.secondary_hashes = [_hash_str(f"photo:{fuid}")]
        elif fuid:
            fp.tier         = 2
            fp.primary_hash = _hash_str(f"photo:{fuid}")
        else:
            fp.tier         = 4
            fp.primary_hash = None

        return fp

    @classmethod
    def _from_document(cls, doc) -> "MediaFingerprint":
        fuid  = str(getattr(doc, "file_unique_id", "") or "")
        fsize = getattr(doc, "size", None)
        mime  = str(getattr(doc, "mime_type", "") or "").lower()

        fname: Optional[str] = None
        dur:   Optional[int] = None
        width: Optional[int] = None
        height:Optional[int] = None

        for attr in (getattr(doc, "attributes", []) or []):
            if isinstance(attr, tl.DocumentAttributeFilename):
                fname = attr.file_name
            elif isinstance(attr, (tl.DocumentAttributeVideo,)):
                dur    = getattr(attr, "duration", None)
                width  = getattr(attr, "w", None)
                height = getattr(attr, "h", None)
            elif isinstance(attr, (tl.DocumentAttributeAudio,)):
                dur = getattr(attr, "duration", None)

        # Determine media type from MIME
        if mime.startswith("video"):
            media_type = "video"
        elif mime == "audio/ogg" or mime.startswith("audio"):
            media_type = "audio"
        elif "voice" in mime:
            media_type = "voice"
        else:
            media_type = "document"

        fp = cls(
            media_type=media_type,
            file_unique_id=fuid or None,
            file_name=fname,
            file_size=fsize,
            mime_type=mime or None,
            duration=dur,
            width=width,
            height=height,
        )

        if media_type in ("video", "audio", "voice"):
            if fuid and dur is not None and fsize:
                fp.tier         = 1
                fp.primary_hash = _hash_str(f"{media_type}:{fuid}:{dur}:{fsize}")
                fp.secondary_hashes = [_hash_str(f"{media_type}:{fuid}")]
            elif fuid:
                fp.tier         = 2
                fp.primary_hash = _hash_str(f"{media_type}:{fuid}")
            else:
                fp.tier         = 4
                fp.primary_hash = None
        else:
            # Document: prefer name+size (portable across re-uploads)
            if fname and fsize:
                fp.tier         = 1
                fp.primary_hash = _hash_str(f"doc:{fname.lower()}:{fsize}")
                if fuid:
                    fp.secondary_hashes = [_hash_str(f"doc_uid:{fuid}")]
            elif fuid:
                fp.tier         = 2
                fp.primary_hash = _hash_str(f"doc_uid:{fuid}")
            else:
                fp.tier         = 4
                fp.primary_hash = None

        return fp

    @classmethod
    def from_local_file(
        cls,
        file_path: str,
        file_name: str,
        file_size: int,
        sha256: Optional[str] = None,
        media_type: str = "document",
        width: Optional[int] = None,
        height: Optional[int] = None,
        duration: Optional[int] = None,
    ) -> "MediaFingerprint":
        """
        Build a fingerprint for a *local source file* about to be uploaded.
        sha256 is the hash of the (possibly re-encoded) upload path.
        """
        fp = cls(
            media_type=media_type,
            file_name=file_name,
            file_size=file_size,
            width=width,
            height=height,
            duration=duration,
            sha256=sha256,
        )

        if sha256:
            fp.tier         = 1
            fp.primary_hash = f"sha256:{sha256}"
            fp.secondary_hashes = [_hash_str(f"doc:{file_name.lower()}:{file_size}")]
        elif file_name and file_size:
            fp.tier         = 2
            fp.primary_hash = _hash_str(f"doc:{file_name.lower()}:{file_size}")
        else:
            fp.tier         = 4
            fp.primary_hash = None

        return fp


def match_fingerprints(
    source: MediaFingerprint,
    dest: MediaFingerprint,
    *,
    strict: bool = True,
    photo_size_tolerance: float = 0.05,
    photo_dim_tolerance_px: int = 10,
) -> Tuple[bool, float]:
    """
    Compare two fingerprints and return (matched, confidence).

    strict=True  → only Tier-1 exact primary match (confidence ≥ 0.95)
    strict=False → Tier-1 or Tier-2 match with tolerance for photos
    """
    if not source.primary_hash or not dest.primary_hash:
        return False, 0.0

    # Exact primary match
    if source.primary_hash == dest.primary_hash:
        conf = 0.99 if source.tier == 1 else 0.90
        return True, conf

    if not strict:
        # SHA-256 cross-check (source has sha256, dest may have it too)
        if source.sha256 and dest.sha256 and source.sha256 == dest.sha256:
            return True, 0.99

        # Secondary hash cross-check
        src_all = {source.primary_hash} | set(source.secondary_hashes)
        dst_all = {dest.primary_hash}   | set(dest.secondary_hashes)
        if src_all & dst_all:
            return True, 0.87

        # Photo fuzzy: same file_unique_id base with dimension tolerance
        if source.media_type == "photo" == dest.media_type:
            if (source.file_unique_id and dest.file_unique_id
                    and source.file_unique_id == dest.file_unique_id):
                sw, sh = source.width or 0, source.height or 0
                dw, dh = dest.width   or 0, dest.height   or 0
                if sw and sh and dw and dh:
                    if (abs(sw - dw) <= photo_dim_tolerance_px
                            and abs(sh - dh) <= photo_dim_tolerance_px):
                        return True, 0.85
                else:
                    return True, 0.80

        # Document: name+size cross-check
        if (source.media_type == "document" == dest.media_type
                and source.file_name and dest.file_name
                and source.file_name.lower() == dest.file_name.lower()
                and source.file_size and dest.file_size):
            size_diff = abs(source.file_size - dest.file_size) / max(source.file_size, dest.file_size)
            if size_diff <= photo_size_tolerance:
                return True, 0.85

    return False, 0.0


# ── helpers ──────────────────────────────────────────────────────────

def _hash_str(s: str) -> str:
    """Short SHA-256 hex of a string (first 32 chars for readability)."""
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:32]
