"""Tests: moov-at-end bootstrap + sparse resume for document-original videos."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.media_stream import (  # noqa: E402
    ProgressiveMedia,
    _mime_is_fragmentable_video,
    _path_region_has_moov,
    _resume_partial_file_ranges,
    _solid_prefix_from_sample,
    register_stream,
    stop_stream,
)


class MoovBootstrapHelpers(unittest.TestCase):
    def test_mime_fragmentable(self):
        self.assertTrue(_mime_is_fragmentable_video("video/mp4", "a.bin"))
        self.assertTrue(_mime_is_fragmentable_video("application/octet-stream", "clip.mp4"))
        self.assertTrue(_mime_is_fragmentable_video("video/quicktime", "x.mov"))
        self.assertTrue(_mime_is_fragmentable_video("", "movie.MP4"))
        self.assertFalse(_mime_is_fragmentable_video("video/webm", "x.webm"))
        self.assertFalse(_mime_is_fragmentable_video("application/pdf", "a.pdf"))
        self.assertFalse(_mime_is_fragmentable_video("application/octet-stream", "a.bin"))

    def test_path_has_moov(self):
        tmp = tempfile.mkdtemp(prefix="ag_moov_")
        path = os.path.join(tmp, "h.mp4")
        # fake ftyp + free + moov fourcc in head
        with open(path, "wb") as f:
            f.write(b"\x00\x00\x00\x18ftypisom")
            f.write(b"\x00" * 32)
            f.write(b"\x00\x00\x00\x20moov")
            f.write(b"\x00" * 28)
        self.assertTrue(_path_region_has_moov(path, 0, 256))

        path2 = os.path.join(tmp, "no.mp4")
        with open(path2, "wb") as f:
            f.write(b"\x00\x00\x00\x18ftypisom" + b"\x00" * 200)
        self.assertFalse(_path_region_has_moov(path2, 0, 256))

    def test_solid_prefix_stops_at_hole(self):
        head = b"A" * (100 * 1024) + (b"\x00" * (80 * 1024)) + b"B" * 10
        solid = _solid_prefix_from_sample(head, zero_run=64 * 1024)
        self.assertGreaterEqual(solid, 90 * 1024)
        self.assertLess(solid, 100 * 1024 + 64 * 1024)

    def test_resume_sequential_partial(self):
        tmp = tempfile.mkdtemp(prefix="ag_moov_")
        path = os.path.join(tmp, "warm.mp4")
        with open(path, "wb") as f:
            f.write(b"H" * (512 * 1024))
        media = ProgressiveMedia(
            path=path, total_size=50 * 1024 * 1024, mime="video/mp4", label="w.mp4"
        )
        _resume_partial_file_ranges(media, 512 * 1024)
        self.assertEqual(media.contiguous_from_zero(), 512 * 1024)
        self.assertFalse(media.done)

    def test_resume_full_download_marked_done(self):
        tmp = tempfile.mkdtemp(prefix="ag_moov_")
        path = os.path.join(tmp, "full.mp4")
        total = 2 * 1024 * 1024
        # Non-zero middle → treated as complete
        with open(path, "wb") as f:
            f.write(os.urandom(total))
        media = ProgressiveMedia(
            path=path, total_size=total, mime="video/mp4", label="f.mp4"
        )
        _resume_partial_file_ranges(media, total)
        self.assertTrue(media.done)
        self.assertEqual(media.contiguous_from_zero(), total)

    def test_resume_sparse_head_tail_not_full(self):
        tmp = tempfile.mkdtemp(prefix="ag_moov_")
        path = os.path.join(tmp, "sparse.mp4")
        total = 8 * 1024 * 1024
        head = b"\x00\x00\x00\x18ftypisom" + (b"X" * (512 * 1024 - 16))
        tail = b"\x00\x00\x01\x00moov" + (b"Y" * (1024 * 1024 - 12))
        with open(path, "wb") as f:
            f.truncate(total)
            f.seek(0)
            f.write(head)
            f.seek(total - len(tail))
            f.write(tail)
        media = ProgressiveMedia(
            path=path, total_size=total, mime="video/mp4", label="s.mp4"
        )
        _resume_partial_file_ranges(media, total)
        self.assertFalse(media.done)
        # Head should be marked; middle hollow so contiguous << total
        self.assertGreaterEqual(media.contiguous_from_zero(), 32 * 1024)
        self.assertLess(media.contiguous_from_zero(), total // 2)
        # Tail island should be present
        self.assertTrue(media.has_byte(total - 100))
        self.assertFalse(media.has_byte(total // 2))

    def test_register_still_works(self):
        tmp = tempfile.mkdtemp(prefix="ag_moov_")
        path = os.path.join(tmp, "r.mp4")
        with open(path, "wb") as f:
            f.write(b"z" * 100)
        info = register_stream(path=path, total_size=1_000_000, mime="video/mp4")
        stop_stream(info["stream_id"], delete_partial=True)


if __name__ == "__main__":
    unittest.main()
