"""
Lightweight ZIP browser (Google Drive style).

- Listing prefers ZipFile.infolist() on a cached file, or central-directory-only
  range fetch (no full extract / no full inflate of every entry).
- Reading a single entry extracts only that member (with size caps).
"""
from __future__ import annotations

import os
import struct
import zipfile
import io
from typing import Any, Dict, List, Optional, Tuple, Union

# Soft caps — keep UI snappy
MAX_LIST_ENTRIES = 8000
MAX_ENTRY_PREVIEW_BYTES = 12 * 1024 * 1024  # 12 MB single-entry preview
SMALL_ZIP_FULL_DOWNLOAD = 2 * 1024 * 1024  # <2 MB → full download for list+read
EOCD_TAIL_BYTES = 128 * 1024  # last N bytes to locate EOCD


def _is_dir_name(name: str) -> bool:
    return bool(name) and (name.endswith("/") or name.endswith("\\"))


def list_zip_path(path: str, *, max_entries: int = MAX_LIST_ENTRIES) -> Dict[str, Any]:
    """List entries from a local ZIP path (central directory only; no extract)."""
    if not path or not os.path.isfile(path):
        raise FileNotFoundError("ZIP cache missing")
    entries: List[Dict[str, Any]] = []
    total_uncompressed = 0
    with zipfile.ZipFile(path, "r") as zf:
        infos = zf.infolist()
        for i, info in enumerate(infos):
            if i >= max_entries:
                break
            name = info.filename or ""
            is_dir = info.is_dir() if hasattr(info, "is_dir") else _is_dir_name(name)
            sz = int(info.file_size or 0)
            if not is_dir:
                total_uncompressed += sz
            entries.append(
                {
                    "name": name.replace("\\", "/"),
                    "size": sz,
                    "compressed_size": int(info.compress_size or 0),
                    "is_dir": bool(is_dir),
                    "method": int(info.compress_type or 0),
                }
            )
        truncated = len(infos) > max_entries
    return {
        "entries": entries,
        "count": len(entries),
        "truncated": truncated,
        "total_entries": len(infos) if not truncated else len(infos),
        "total_uncompressed": total_uncompressed,
        "archive_size": os.path.getsize(path),
        "source": "local",
    }


class RangeFile(io.RawIOBase):
    def __init__(self, ranges: List[Tuple[int, bytes]], total_size: int):
        self.ranges = ranges
        self.total_size = total_size
        self.pos = 0

    def seek(self, offset: int, whence: int = 0) -> int:
        if whence == 0:
            self.pos = offset
        elif whence == 1:
            self.pos += offset
        elif whence == 2:
            self.pos = self.total_size + offset
        return self.pos

    def tell(self) -> int:
        return self.pos

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            size = self.total_size - self.pos
        if size == 0 or self.pos >= self.total_size:
            return b""
            
        result = bytearray()
        while size > 0 and self.pos < self.total_size:
            found_chunk = False
            for r_start, r_data in sorted(self.ranges, key=lambda x: x[0]):
                r_end = r_start + len(r_data)
                if self.pos < r_start:
                    to_read = min(size, r_start - self.pos)
                    result.extend(b"\x00" * to_read)
                    self.pos += to_read
                    size -= to_read
                    found_chunk = True
                    break
                if r_start <= self.pos < r_end:
                    in_offset = self.pos - r_start
                    available = len(r_data) - in_offset
                    to_read = min(size, available)
                    result.extend(r_data[in_offset : in_offset + to_read])
                    self.pos += to_read
                    size -= to_read
                    found_chunk = True
                    break

            if not found_chunk:
                available = self.total_size - self.pos
                to_read = min(size, available)
                result.extend(b"\x00" * to_read)
                self.pos += to_read
                size -= to_read

        return bytes(result)

    def readable(self) -> bool:
        return True
    
    def seekable(self) -> bool:
        return True


def read_zip_entry_path(
    path: Union[str, Any],
    entry_name: str,
    *,
    password: Optional[str] = None,
    max_bytes: int = MAX_ENTRY_PREVIEW_BYTES,
) -> Tuple[bytes, Dict[str, Any]]:
    """
    Read a single entry (inflate only that member). Raises if too large / missing.
    """
    name = (entry_name or "").replace("\\", "/")
    if not name or _is_dir_name(name):
        raise ValueError("entry is a directory")
    with zipfile.ZipFile(path, "r") as zf:
        try:
            info = zf.getinfo(name)
        except KeyError:
            # try without leading ./
            alt = name.lstrip("./")
            info = zf.getinfo(alt)
            name = alt
        if info.is_dir() if hasattr(info, "is_dir") else _is_dir_name(info.filename):
            raise ValueError("entry is a directory")
        size = int(info.file_size or 0)
        if size > max_bytes:
            raise ValueError(
                f"entry_too_large:{size}:{max_bytes}"
            )
        pwd_bytes = password.encode("utf-8") if password else None
        try:
            with zf.open(info, "r", pwd=pwd_bytes) as fp:
                data = fp.read(max_bytes + 1)
        except RuntimeError as e:
            msg = str(e).lower()
            if "password required" in msg or "encrypted" in msg:
                raise ValueError("encrypted")
            if "bad password" in msg:
                raise ValueError("bad_password")
            raise
        if len(data) > max_bytes:
            raise ValueError(f"entry_too_large:{size}:{max_bytes}")
        meta = {
            "name": name,
            "size": size,
            "compressed_size": int(info.compress_size or 0),
        }
        return data, meta


def parse_eocd_from_tail(tail: bytes, file_size: int) -> Tuple[int, int, int]:
    """
    Find End of Central Directory in tail buffer.
    Returns (cd_offset, cd_size, entry_count).
    """
    # EOCD signature 0x06054b50
    sig = b"PK\x05\x06"
    idx = tail.rfind(sig)
    if idx < 0:
        raise ValueError("EOCD not found — not a ZIP or truncated")
    # EOCD fixed part is 22 bytes + comment
    if idx + 22 > len(tail):
        raise ValueError("EOCD truncated")
    (
        _sig,
        _disk,
        _cd_disk,
        _disk_entries,
        total_entries,
        cd_size,
        cd_offset,
        comment_len,
    ) = struct.unpack_from("<IHHHHIIH", tail, idx)
    if comment_len < 0 or cd_offset < 0 or cd_size < 0:
        raise ValueError("invalid EOCD")
    if cd_offset + cd_size > file_size:
        raise ValueError("central directory out of range")
    return int(cd_offset), int(cd_size), int(total_entries)


def parse_central_directory(cd: bytes, *, max_entries: int = MAX_LIST_ENTRIES) -> List[Dict[str, Any]]:
    """Parse ZIP central directory records into entry dicts."""
    entries: List[Dict[str, Any]] = []
    pos = 0
    sig = 0x02014B50
    while pos + 46 <= len(cd) and len(entries) < max_entries:
        if struct.unpack_from("<I", cd, pos)[0] != sig:
            break
        (
            _sig,
            _ver_made,
            _ver_need,
            _flag,
            method,
            _time,
            _date,
            _crc,
            comp_size,
            uncomp_size,
            name_len,
            extra_len,
            comment_len,
            _disk_start,
            _int_attr,
            _ext_attr,
            _local_off,
        ) = struct.unpack_from("<IHHHHHHIIIHHHHHII", cd, pos)
        pos += 46
        name_b = cd[pos : pos + name_len]
        pos += name_len + extra_len + comment_len
        try:
            name = name_b.decode("utf-8")
        except Exception:
            name = name_b.decode("cp437", errors="replace")
        name = name.replace("\\", "/")
        is_dir = _is_dir_name(name) or (uncomp_size == 0 and comp_size == 0 and name.endswith("/"))
        entries.append(
            {
                "name": name,
                "size": int(uncomp_size),
                "compressed_size": int(comp_size),
                "is_dir": bool(is_dir),
                "method": int(method),
                "header_offset": int(_local_off),
            }
        )
    return entries


def list_from_central_bytes(
    cd: bytes,
    *,
    archive_size: int,
    total_entries_hint: int = 0,
    max_entries: int = MAX_LIST_ENTRIES,
) -> Dict[str, Any]:
    entries = parse_central_directory(cd, max_entries=max_entries)
    total_u = sum(e["size"] for e in entries if not e["is_dir"])
    truncated = bool(total_entries_hint and total_entries_hint > len(entries))
    return {
        "entries": entries,
        "count": len(entries),
        "truncated": truncated or len(entries) >= max_entries,
        "total_entries": total_entries_hint or len(entries),
        "total_uncompressed": total_u,
        "archive_size": archive_size,
        "source": "central_dir",
    }
