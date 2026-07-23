"""Regression: stream_ready / moov_ready for progressive video start."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.media_stream import (  # noqa: E402
    get_stream,
    register_stream,
    stop_stream,
    stream_status,
)


class StreamStatusReadyTests(unittest.TestCase):
    def _write_and_register(self, name: str, total: int, mime: str, write_fn):
        tmp = tempfile.mkdtemp(prefix="ag_status_")
        path = os.path.join(tmp, name)
        with open(path, "wb") as fh:
            fh.truncate(total)
            write_fn(fh, total)
        info = register_stream(path=path, total_size=total, mime=mime, label=name)
        media = get_stream(info["stream_id"])
        assert media is not None
        return info, media

    def test_mp4_head_without_moov_is_not_stream_ready(self):
        def write(fh, total):
            fh.seek(0)
            fh.write(b"\x00\x00\x00\x18ftypisom" + b"H" * (512 * 1024 - 12))

        info, media = self._write_and_register(
            "doc.stream.mp4", 8 * 1024 * 1024, "video/mp4", write
        )
        # Explicit range (in-memory register does not scan disk)
        media.mark_range(0, 512 * 1024)
        st = stream_status(info["stream_id"])
        self.assertEqual(st["status"], "downloading")
        self.assertGreaterEqual(st["prefix_bytes"], 256 * 1024)
        self.assertFalse(st["moov_ready"])
        self.assertFalse(st["stream_ready"])
        stop_stream(info["stream_id"], delete_partial=True)

    def test_mp4_with_moov_at_head_is_stream_ready(self):
        def write(fh, total):
            fh.seek(0)
            fh.write(
                b"\x00\x00\x00\x18ftypisom"
                + b"\x00\x00\x00\x08moov"
                + b"H" * (512 * 1024 - 20)
            )

        info, media = self._write_and_register(
            "fast.stream.mp4", 4 * 1024 * 1024, "video/mp4", write
        )
        media.mark_range(0, 512 * 1024)
        # Keep disk head in sync for moov probe
        with open(media.path, "r+b") as fh:
            fh.seek(0)
            fh.write(
                b"\x00\x00\x00\x18ftypisom"
                + b"\x00\x00\x00\x08moov"
                + b"H" * (512 * 1024 - 20)
            )
        st = stream_status(info["stream_id"])
        self.assertTrue(st["moov_ready"])
        self.assertTrue(st["stream_ready"])
        stop_stream(info["stream_id"], delete_partial=True)

    def test_mp4_with_moov_at_tail_is_stream_ready(self):
        total = 6 * 1024 * 1024

        def write(fh, total_):
            fh.seek(0)
            fh.write(b"\x00\x00\x00\x18ftypisom" + b"H" * (512 * 1024 - 12))
            fh.seek(total_ - 128 * 1024)
            fh.write(b"\x00\x00\x01\x00moov" + b"T" * (128 * 1024 - 8))

        info, media = self._write_and_register(
            "tail.stream.mp4", total, "video/mp4", write
        )
        media.mark_range(0, 512 * 1024)
        media.mark_range(total - 128 * 1024, 128 * 1024)
        st = stream_status(info["stream_id"])
        self.assertTrue(st["moov_ready"])
        self.assertTrue(st["stream_ready"])
        stop_stream(info["stream_id"], delete_partial=True)

    def test_webm_does_not_require_moov(self):
        def write(fh, total):
            fh.seek(0)
            fh.write(b"\x1a\x45\xdf\xa3" + b"W" * (512 * 1024 - 4))

        info, media = self._write_and_register(
            "v.stream.webm", 2 * 1024 * 1024, "video/webm", write
        )
        media.mark_range(0, 512 * 1024)
        st = stream_status(info["stream_id"])
        self.assertTrue(st["moov_ready"])
        self.assertTrue(st["stream_ready"])
        stop_stream(info["stream_id"], delete_partial=True)

    def test_first_range_claims_only_solid_head(self):
        """Regression: do not advertise multi-MB Content-Range when only head is filled."""
        import asyncio
        import urllib.request

        total = 80 * 1024 * 1024  # large-ish file
        solid = 300 * 1024

        def write(fh, total_):
            fh.seek(0)
            fh.write(b"\x00\x00\x00\x18ftypisom" + b"\x00\x00\x00\x08moov" + b"H" * (solid - 20))

        info, media = self._write_and_register(
            "big.stream.mp4", total, "video/mp4", write
        )
        media.mark_range(0, solid)
        with open(media.path, "r+b") as fh:
            fh.seek(0)
            fh.write(b"\x00\x00\x00\x18ftypisom" + b"\x00\x00\x00\x08moov" + b"H" * (solid - 20))

        async def _fetch():
            req = urllib.request.Request(
                info["stream_url"], headers={"Range": "bytes=0-"}
            )
            resp = await asyncio.to_thread(urllib.request.urlopen, req, timeout=6)
            body = await asyncio.to_thread(resp.read)
            return resp, body

        resp, body = asyncio.get_event_loop().run_until_complete(_fetch())
        self.assertEqual(resp.status, 206)
        cr = resp.headers.get("Content-Range") or ""
        # Must not claim the full 80MB window — only solid head
        self.assertIn(f"/{total}", cr)
        self.assertLessEqual(len(body), solid + 64 * 1024)
        self.assertGreaterEqual(len(body), 64 * 1024)
        # Content-Length matches solid slice, not multi-MB pipeline window
        self.assertLessEqual(int(resp.headers.get("Content-Length") or 0), solid + 1024)
        stop_stream(info["stream_id"], delete_partial=True)


if __name__ == "__main__":
    unittest.main()
