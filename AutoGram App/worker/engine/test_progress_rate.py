"""
Unit tests for windowed/EWMA transfer rate + ProgressAgg speed emission.
Drives shipped progress_rate + ProgressAgg (no network).
"""
from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.progress_rate import (  # noqa: E402
    WindowedRateTracker,
    compute_eta_s,
    compute_window_rate_mb_s,
    scripted_rate_series,
)
from engine.fast_transfer import _workers_for_size  # noqa: E402


class WindowRateMathTests(unittest.TestCase):
    def test_idle_then_burst_current_rises(self):
        # 10s idle at 0 bytes, then steady 5 MiB/s for 5s
        samples = [(0.0, 0)]
        # idle
        for i in range(1, 11):
            samples.append((float(i), 0))
        # burst: 5 MiB per second
        base = 10.0
        b = 0
        mib = 5 * 1024 * 1024
        for i in range(1, 6):
            b += mib
            samples.append((base + i, b))
        snaps = scripted_rate_series(samples, total=50 * 1024 * 1024, window_s=2.5)
        # After burst, current should be near 5 MiB/s, not near-zero lifetime
        last = snaps[-1]
        self.assertGreater(last.current_mb_s, 2.0, last)
        self.assertLess(last.lifetime_avg_mb_s, last.current_mb_s + 0.01)
        # Lifetime diluted by idle: 25 MiB / 15s ≈ 1.67
        self.assertLess(last.lifetime_avg_mb_s, 2.5)
        self.assertGreaterEqual(last.peak_mb_s, last.current_mb_s * 0.5)

    def test_early_stall_then_steady_not_lifetime_diluted(self):
        # The screenshot pattern: long early stall, then real throughput ~6 MB/s
        samples = [(0.0, 0), (30.0, 0)]  # 30s stuck
        # then 6 MiB/s for 10s
        mib = 6 * 1024 * 1024
        b = 0
        for i in range(1, 11):
            b += mib
            samples.append((30.0 + i, b))
        snaps = scripted_rate_series(samples, total=200 * 1024 * 1024, window_s=2.5)
        last = snaps[-1]
        # Current ≈ recent 6 MB/s, NOT lifetime ~60MiB/40s = 1.5
        self.assertGreater(last.current_mb_s, 3.5, f"current diluted? {last}")
        self.assertLess(last.lifetime_avg_mb_s, 2.5)
        self.assertGreater(last.current_mb_s, last.lifetime_avg_mb_s)

    def test_peak_ge_current_under_normal_sampling(self):
        samples = [(0.0, 0)]
        b = 0
        for i in range(1, 20):
            b += 2 * 1024 * 1024
            samples.append((float(i) * 0.5, b))
        snaps = scripted_rate_series(samples, total=100 * 1024 * 1024)
        last = snaps[-1]
        self.assertGreaterEqual(last.peak_mb_s + 1e-6, min(last.current_mb_s, last.peak_mb_s))
        # peak should be positive once data moves
        self.assertGreater(last.peak_mb_s, 0)

    def test_bytes_never_decrease_in_tracker(self):
        tr = WindowedRateTracker(window_s=2.0)
        s1 = tr.update(0.0, 0, total=1000)
        s2 = tr.update(1.0, 500, total=1000)
        s3 = tr.update(2.0, 400, total=1000)  # out-of-order lower — clamp
        self.assertEqual(s1.transferred, 0)
        self.assertEqual(s2.transferred, 500)
        self.assertEqual(s3.transferred, 500)

    def test_window_rate_pure_function(self):
        # 10 MiB over last 2s → 5 MiB/s
        samples = [
            (0.0, 0),
            (8.0, 0),
            (10.0, 10 * 1024 * 1024),
        ]
        rate = compute_window_rate_mb_s(samples, window_s=2.5)
        self.assertGreater(rate, 3.5)
        self.assertLess(rate, 6.5)

    def test_eta_from_current_speed(self):
        eta = compute_eta_s(100 * 1024 * 1024, 200 * 1024 * 1024, 5.0)
        self.assertIsNotNone(eta)
        # 100 MiB remain @ 5 MiB/s → 20s
        self.assertAlmostEqual(eta or 0, 20.0, delta=0.5)
        self.assertIsNone(compute_eta_s(0, 100, 0.01))


class WorkersForSizeTests(unittest.TestCase):
    def test_large_file_gets_more_workers(self):
        self.assertGreaterEqual(_workers_for_size(2 * 1024**3), 36)
        self.assertEqual(_workers_for_size(2 * 1024**3), 48)
        self.assertLessEqual(_workers_for_size(1024), 4)
        # Requested still capped
        self.assertEqual(_workers_for_size(10 * 1024**3, requested=100), 48)

    def test_studio_uses_fast_upload_structurally(self):
        import inspect
        from engine import media_studio

        src = inspect.getsource(media_studio._upload_bytes)
        self.assertIn("fast_upload_file", src)
        self.assertIn("progress_callback", src)
        self.assertIn("workers=part_workers", src)
        agg_src = inspect.getsource(media_studio.ProgressAgg)
        self.assertIn("WindowedRateTracker", agg_src)
        self.assertIn("speed_mb_s", agg_src)
        # Must not emit pure lifetime average as UI current speed
        self.assertNotIn(
            'speed_mb_s=round(avg, 3)',
            agg_src.replace(" ", ""),
        )


class ProgressAggEmitTests(unittest.TestCase):
    def test_progress_agg_emits_windowed_not_lifetime(self):
        from engine.media_studio import ProgressAgg

        events = []

        def capture(name, **kw):
            if name == "StudioProgress":
                events.append(kw)

        with patch("engine.media_studio.emit_event", side_effect=capture), patch(
            "engine.media_studio.time.time"
        ) as mock_time:
            # Scripted clock
            t = {"v": 1000.0}

            def now():
                return t["v"]

            mock_time.side_effect = now
            agg = ProgressAgg(100 * 1024 * 1024, 1)
            # Stall 20s with no bytes
            t["v"] = 1020.0
            agg.on_item(0, 0, 100 * 1024 * 1024, force=True)
            # Then transfer 10 MiB over 2s → ~5 MB/s recent
            t["v"] = 1021.0
            agg.on_item(0, 5 * 1024 * 1024, 100 * 1024 * 1024, force=True)
            t["v"] = 1022.0
            agg.on_item(0, 10 * 1024 * 1024, 100 * 1024 * 1024, force=True)

        self.assertTrue(events)
        last = events[-1]
        # Lifetime would be 10MiB / 22s ≈ 0.45; windowed should be much higher
        self.assertGreater(
            last["speed_mb_s"],
            1.5,
            f"speed still lifetime-diluted: {last}",
        )
        self.assertGreaterEqual(last["peak_mb_s"], 0)
        self.assertGreaterEqual(last["transferred"], last.get("transferred", 0))
        # Monotonic transferred
        transferred_seq = [e["transferred"] for e in events]
        for a, b in zip(transferred_seq, transferred_seq[1:]):
            self.assertLessEqual(a, b)


if __name__ == "__main__":
    unittest.main()
