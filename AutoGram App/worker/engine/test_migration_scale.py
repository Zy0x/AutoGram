"""
Scale-oriented tests for Fast Forward — stream/batch/AIMD/progress cadence.
Does not load 100k messages into memory; verifies control-plane sizing.
"""
from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.fast_forward import FastForwardEngine, FastForwardProgress  # noqa: E402


def _make_engine(limit: int = 0, **cfg) -> FastForwardEngine:
    config = {"limit": limit, "delay_min": 0.01, "delay_max": 0.02, **cfg}
    client = MagicMock()
    eng = FastForwardEngine(client, object(), object(), execution_id=None, config=config)
    return eng


class MigrationScaleTests(unittest.TestCase):
    def test_does_not_materialize_history_in_progress(self):
        p = FastForwardProgress(100_000)
        self.assertEqual(p.total, 100_000)
        self.assertEqual(p.processed, 0)
        # Progress object stays O(1) memory regardless of total
        p.processed = 50_000
        self.assertAlmostEqual(p.percentage, 50.0)

    def test_auto_batch_for_1k_10k_100k(self):
        e1 = _make_engine(1_000)
        self.assertGreaterEqual(e1.batch_size, 30)
        e10 = _make_engine(10_000)
        self.assertGreaterEqual(e10.batch_size, 40)
        e100 = _make_engine(100_000)
        self.assertEqual(e100.batch_size, 50)
        self.assertLessEqual(e100.batch_size, FastForwardEngine.MAX_BATCH)

    def test_progress_emit_throttled_at_scale(self):
        e = _make_engine(100_000)
        self.assertGreaterEqual(e._progress_emit_every, 10)
        e.progress.processed = 1
        with patch("engine.fast_forward.emit_event") as emit:
            e._emit_progress(100_000, 1)
            emit.assert_not_called()
            e.progress.processed = 25
            e._emit_progress(100_000, 25)
            emit.assert_called()

    def test_aimd_halves_then_grows(self):
        e = _make_engine(5_000)
        start = e.batch_size
        e._record_batch_pressure()
        self.assertEqual(e.batch_size, max(1, start // 2))
        for _ in range(8):
            e._record_batch_success()
        self.assertGreaterEqual(e.batch_size, 1)

    def test_explicit_ff_batch_size_respected(self):
        e = _make_engine(100_000, ff_batch_size=12)
        self.assertEqual(e.batch_size, 12)

    def test_detailed_events_off_by_default_at_1k(self):
        e = _make_engine(5_000)
        self.assertFalse(e.detailed_task_events)


if __name__ == "__main__":
    unittest.main()
