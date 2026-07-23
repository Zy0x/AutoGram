"""Tests: preview stream cancel stops progressive fill (no background leak)."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.media_stream import (  # noqa: E402
    ProgressiveMedia,
    register_stream,
    stop_all_streams,
    stop_stream,
    stream_status,
)


class StreamStopTests(unittest.TestCase):
    def test_cancel_flag_and_stop_stream_deletes_partial(self):
        tmp = tempfile.mkdtemp(prefix="ag_stream_")
        path = os.path.join(tmp, "partial.bin")
        with open(path, "wb") as f:
            f.write(b"x" * 4096)
        info = register_stream(
            path=path, total_size=10_000_000, mime="video/mp4", label="t.mp4"
        )
        sid = info["stream_id"]
        st = stream_status(sid)
        self.assertEqual(st["status"], "downloading")
        res = stop_stream(sid, delete_partial=True)
        self.assertEqual(res["status"], "stopped")
        self.assertTrue(res.get("deleted_partial"))
        self.assertFalse(os.path.isfile(path))
        self.assertEqual(stream_status(sid)["status"], "missing")

    def test_stop_keeps_completed_file(self):
        tmp = tempfile.mkdtemp(prefix="ag_stream_")
        path = os.path.join(tmp, "done.bin")
        with open(path, "wb") as f:
            f.write(b"y" * 2048)
        info = register_stream(
            path=path, total_size=2048, mime="video/mp4", label="d.mp4"
        )
        sid = info["stream_id"]
        from engine.media_stream import get_stream

        m = get_stream(sid)
        assert m is not None
        m.mark_done()
        res = stop_stream(sid, delete_partial=True)
        self.assertEqual(res["status"], "stopped")
        self.assertFalse(res.get("deleted_partial"))
        self.assertTrue(os.path.isfile(path))

    def test_fill_respects_cancel(self):
        """Simulate cancel mid-loop: ProgressiveMedia.cancelled short-circuits."""
        media = ProgressiveMedia(
            path=os.path.join(tempfile.gettempdir(), "ag_nopath_x.bin"),
            total_size=1000,
            mime="video/mp4",
        )
        self.assertFalse(media.cancelled)
        media.cancel()
        self.assertTrue(media.cancelled)
        # wait_for_bytes must not hang when cancelled
        n = media.wait_for_bytes(999999, timeout=2.0)
        self.assertIsInstance(n, int)

    def test_stop_all_incomplete(self):
        # Isolate from leftover streams registered by other tests in this process
        stop_all_streams(incomplete_only=False)
        tmp = tempfile.mkdtemp(prefix="ag_stream_")
        paths = []
        sids = []
        for i in range(3):
            p = os.path.join(tmp, f"p{i}.bin")
            with open(p, "wb") as f:
                f.write(b"z" * 100)
            paths.append(p)
            info = register_stream(
                path=p, total_size=5_000_000, mime="video/mp4", label=f"p{i}"
            )
            sids.append(info["stream_id"])
        out = stop_all_streams(incomplete_only=True)
        self.assertEqual(out["stopped"], 3)
        for sid in sids:
            self.assertEqual(stream_status(sid)["status"], "missing")
        for p in paths:
            self.assertFalse(os.path.isfile(p))


if __name__ == "__main__":
    unittest.main()
