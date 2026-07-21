"""Unit tests for SessionAuthority, GhostSessionView, and MediaSenderPool."""

import sys
import os
import unittest
import asyncio
from pathlib import Path

# Adjust path to import worker modules
WORKER_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if WORKER_ROOT not in sys.path:
    sys.path.insert(0, WORKER_ROOT)

from core.session_authority import SessionAuthority, GhostSessionView


class TestSessionAuthority(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        # Reset authority instance for each test
        SessionAuthority._instance = None

    async def test_singleton(self):
        # Mock values
        sa1 = await SessionAuthority.get_instance(
            canonical_session_path=Path("dummy.session"),
            api_id=12345,
            api_hash="dummy_hash"
        )
        sa2 = await SessionAuthority.get_instance()
        self.assertIs(sa1, sa2)

    async def test_acquire_release_ghost(self):
        sa = await SessionAuthority.get_instance(
            canonical_session_path=Path("dummy.session"),
            api_id=12345,
            api_hash="dummy_hash"
        )
        
        # Mock get_canonical_client to return a dummy client with a dummy session
        class DummySession:
            pass
        class DummyClient:
            def __init__(self):
                self.session = DummySession()
        
        async def mock_get_canonical_client():
            from telethon.sessions import StringSession
            c = DummyClient()
            c.session = StringSession()
            return c
            
        sa.get_canonical_client = mock_get_canonical_client
        
        view = await sa.acquire_ghost("preview")
        self.assertIsInstance(view, GhostSessionView)
        self.assertEqual(view.purpose, "preview")
        self.assertIn(view.view_id, sa._ghost_registry)

        # Release
        await sa.release_ghost(view.view_id)
        self.assertNotIn(view.view_id, sa._ghost_registry)


if __name__ == '__main__':
    unittest.main()
