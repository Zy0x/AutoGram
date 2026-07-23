"""Regression: size-tier streaming config covers all product buckets."""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.media_stream import first_play_bytes, get_streaming_config  # noqa: E402


MB = 1024 * 1024

# User-requested buckets (upper bounds in MB)
BUCKETS_MB = [10, 20, 50, 100, 150, 200, 250, 300, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000]


class StreamingTierTests(unittest.TestCase):
    def test_every_bucket_has_config(self):
        prev_fp = 10**12
        for mb in BUCKETS_MB:
            # just under the boundary
            sz = mb * MB - 1
            cfg = get_streaming_config(sz)
            self.assertIn("layer", cfg)
            self.assertGreater(cfg["first_play"], 0)
            self.assertGreaterEqual(cfg["initial_head"], cfg["first_play"])
            self.assertGreaterEqual(cfg["workers"], 8)
            # first_play should not grow as files get larger
            self.assertLessEqual(cfg["first_play"], prev_fp + 64 * 1024)
            prev_fp = cfg["first_play"]
            # first_play stays under 512KB for all tiers (fast open)
            self.assertLessEqual(cfg["first_play"], 512 * 1024)

    def test_over_4gb_tier(self):
        cfg = get_streaming_config(4500 * MB)
        self.assertEqual(cfg["layer"], "u4g_plus")
        self.assertLessEqual(cfg["first_play"], 128 * 1024)
        self.assertGreaterEqual(cfg["workers"], 28)

    def test_tiny_under_10(self):
        cfg = get_streaming_config(5 * MB)
        self.assertEqual(cfg["layer"], "u10")
        self.assertGreaterEqual(cfg["first_play"], 256 * 1024)

    def test_first_play_helper_matches_config(self):
        for mb in (15, 80, 400, 1200, 5000):
            sz = mb * MB
            self.assertEqual(first_play_bytes(sz), get_streaming_config(sz)["first_play"])

    def test_zero_size_safe(self):
        cfg = get_streaming_config(0)
        self.assertGreater(cfg["first_play"], 0)
        self.assertGreater(cfg["workers"], 0)


if __name__ == "__main__":
    unittest.main()
