"""Regression tests for quota-bounded random-access preview streaming."""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import unittest
import urllib.request
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.media_stream import (  # noqa: E402
    ProgressiveMedia,
    fill_stream_from_telegram,
    get_stream,
    register_stream,
    stop_stream,
)


class RandomSeekTests(unittest.IsolatedAsyncioTestCase):
    def test_sparse_logical_size_is_not_treated_as_complete(self):
        tmp = tempfile.mkdtemp(prefix="ag_seek_sparse_")
        path = os.path.join(tmp, "large.stream.mp4")
        total = 12 * 1024 * 1024
        with open(path, "wb") as fh:
            fh.truncate(total)
            fh.seek(0)
            fh.write(b"\x00\x00\x00\x18ftypisom" + b"H" * (256 * 1024 - 12))
            fh.seek(total - 512 * 1024)
            fh.write(b"\x00\x00\x01\x00moov" + b"T" * (512 * 1024 - 8))
        info = register_stream(path=path, total_size=total, mime="video/mp4", label="large.mp4")
        media = get_stream(info["stream_id"])
        self.assertIsNotNone(media)
        assert media is not None
        self.assertFalse(media.done)
        self.assertLess(media.filled_bytes(), total // 2)
        self.assertFalse(media.has_byte(total // 2))
        stop_stream(info["stream_id"], delete_partial=True)

    async def test_http_range_serves_only_filled_seek_window(self):
        tmp = tempfile.mkdtemp(prefix="ag_seek_http_")
        path = os.path.join(tmp, "range.stream.mp4")
        total = 20 * 1024 * 1024
        start = 11 * 1024 * 1024
        payload = b"R" * (512 * 1024)
        with open(path, "wb") as fh:
            fh.seek(start)
            fh.write(payload)
        info = register_stream(path=path, total_size=total, mime="video/mp4", label="range.mp4")
        media = get_stream(info["stream_id"])
        assert media is not None
        media.mark_range(start, len(payload))

        request = urllib.request.Request(
            info["stream_url"], headers={"Range": f"bytes={start}-{start + 65535}"}
        )
        response = await asyncio.to_thread(urllib.request.urlopen, request, timeout=4)
        body = await asyncio.to_thread(response.read)
        self.assertEqual(response.status, 206)
        self.assertEqual(len(body), 65536)
        self.assertEqual(response.headers.get("Accept-Ranges"), "bytes")
        self.assertEqual(int(response.headers.get("X-AutoGram-Filled") or 0), len(payload))
        self.assertLess(int(response.headers.get("X-AutoGram-Filled") or 0), total)
        stop_stream(info["stream_id"], delete_partial=True)

    async def test_latest_distant_seek_supersedes_old_generation(self):
        media = ProgressiveMedia(
            path=os.path.join(tempfile.gettempdir(), "ag_seek_generation.stream.mp4"),
            total_size=200 * 1024 * 1024,
            mime="video/mp4",
        )
        media.bind_telegram(
            object(), object(), asyncio.get_running_loop(), input_loc=object(), media_api=object()
        )

        gate = asyncio.Event()

        async def slow_fill(*_args, **_kwargs):
            await gate.wait()

        with patch("engine.media_stream._fill_range_from_telegram", side_effect=slow_fill):
            self.assertTrue(media.schedule_seek(40 * 1024 * 1024, priority=2))
            first_generation = media._seek_generation
            self.assertTrue(media.schedule_seek(140 * 1024 * 1024, priority=2))
            self.assertGreater(media._seek_generation, first_generation)
            self.assertEqual(media._active_seek_offset, 140 * 1024 * 1024)
            self.assertEqual(len(media._seek_inflight), 1)
            gate.set()
            await asyncio.sleep(0)
        media.cancel()

    async def test_browser_range_burst_keeps_related_distant_requests(self):
        media = ProgressiveMedia(
            path=os.path.join(tempfile.gettempdir(), "ag_seek_browser_burst.stream.mp4"),
            total_size=200 * 1024 * 1024,
            mime="video/mp4",
        )
        media.bind_telegram(
            object(), object(), asyncio.get_running_loop(), input_loc=object(), media_api=object()
        )
        gate = asyncio.Event()

        async def slow_fill(*_args, **_kwargs):
            await gate.wait()

        with patch("engine.media_stream._fill_range_from_telegram", side_effect=slow_fill):
            self.assertTrue(media.schedule_seek(40 * 1024 * 1024, priority=3))
            generation = media._seek_generation
            self.assertTrue(media.schedule_seek(140 * 1024 * 1024, priority=3))
            self.assertEqual(media._seek_generation, generation)
            self.assertEqual(len(media._seek_inflight), 2)
            gate.set()
            await asyncio.sleep(0)
        media.cancel()

    async def test_open_bootstrap_is_bounded_not_full_download(self):
        total = 150 * 1024 * 1024
        path = os.path.join(tempfile.mkdtemp(prefix="ag_seek_boot_"), "video.stream.mp4")
        media = ProgressiveMedia(path=path, total_size=total, mime="video/mp4", label="video.mp4")
        calls = []

        async def fake_parts(target, *, start, length, **_kwargs):
            calls.append((start, length))
            target.mark_range(start, length)
            return length

        with (
            patch("engine.media_stream.utils.get_input_location", return_value=(1, object())),
            patch("engine.media_stream._borrow_media_api", new=AsyncMock(return_value=(object(), None))),
            patch("engine.media_stream._download_parts_concurrent", side_effect=fake_parts),
            patch("engine.media_stream._bootstrap_moov_at_end", new=AsyncMock(return_value=False)),
        ):
            await fill_stream_from_telegram(object(), object(), media)

        self.assertFalse(media.done)
        self.assertLessEqual(sum(length for _start, length in calls), 2 * 1024 * 1024)
        self.assertLess(media.filled_bytes(), total // 20)


if __name__ == "__main__":
    unittest.main()
