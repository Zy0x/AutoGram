"""Unit tests for AutoGram Concurrency enhancements."""

import os
import sys
import unittest
import time
from pathlib import Path

# Add worker root to python path
WORKER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WORKER_ROOT))

from core.shared_state import SharedRateLimiter
from core.ghost_session import GhostSessionManager


class TestSharedRateLimiter(unittest.TestCase):

    def setUp(self):
        self.account_id = "test_account_concurrency"
        SharedRateLimiter.clear_account(self.account_id)

    def tearDown(self):
        SharedRateLimiter.clear_account(self.account_id)

    def test_record_and_get_delay(self):
        self.assertFalse(SharedRateLimiter.is_throttled(self.account_id))
        self.assertEqual(SharedRateLimiter.get_delay(self.account_id), 0.0)

        # Record a 20 second wait
        SharedRateLimiter.record_flood_wait(self.account_id, 20)

        self.assertTrue(SharedRateLimiter.is_throttled(self.account_id))
        delay = SharedRateLimiter.get_delay(self.account_id)
        # Remaining should be around 20 + buffer (buffer is 2 + severity * 0.5 = 2.5) -> ~22.5s
        self.assertTrue(15.0 < delay < 25.0)

        # Clear account
        SharedRateLimiter.clear_account(self.account_id)
        self.assertFalse(SharedRateLimiter.is_throttled(self.account_id))
        self.assertEqual(SharedRateLimiter.get_delay(self.account_id), 0.0)


class TestGhostSessionManager(unittest.TestCase):

    def setUp(self):
        self.session_name = "test_session_source"
        self.original_path = WORKER_ROOT / "sessions" / f"{self.session_name}.session"
        self.original_path.parent.mkdir(parents=True, exist_ok=True)
        # Create a dummy original session file
        with open(self.original_path, "w") as f:
            f.write("SQLite format 3\x00DummySessionContent")

    def tearDown(self):
        if self.original_path.exists():
            self.original_path.unlink()
        GhostSessionManager.cleanup_all_ghosts(self.session_name)

    def test_ensure_and_cleanup_ghost(self):
        ghost_name = GhostSessionManager.ensure_ghost(self.session_name)
        self.assertEqual(ghost_name, f"{self.session_name}_migration")

        # In V2, no physical session copy is created on disk
        ghost_file = WORKER_ROOT / "sessions" / f"{ghost_name}.session"
        self.assertFalse(ghost_file.exists())

        # Cleanup should run without error
        GhostSessionManager.cleanup_ghost(self.session_name)


if __name__ == "__main__":
    unittest.main()
