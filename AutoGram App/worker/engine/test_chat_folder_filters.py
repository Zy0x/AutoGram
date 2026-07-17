import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from engine import drive_fs
from engine.drive_fs import _dialog_matches_chat_filter, _list_chats_on


def dialog(peer_id, *, group=False, channel=False, user=False, bot=False, contact=False, unread=1, muted=False, archived=False):
    return SimpleNamespace(
        id=peer_id,
        is_group=group,
        is_channel=channel,
        is_user=user,
        unread_count=unread,
        muted=muted,
        archived=archived,
        entity=SimpleNamespace(bot=bot, contact=contact, mutual_contact=False),
    )


class ChatFolderFilterTests(unittest.TestCase):
    def test_explicit_include_and_exclude_take_precedence(self):
        rule = {"include_peer_ids": [10], "exclude_peer_ids": [11]}
        self.assertTrue(_dialog_matches_chat_filter(dialog(10, user=True), rule))
        self.assertFalse(_dialog_matches_chat_filter(dialog(11, group=True), rule))

    def test_type_and_visibility_rules(self):
        rule = {
            "groups": True,
            "bots": True,
            "exclude_read": True,
            "exclude_muted": True,
            "exclude_archived": True,
        }
        self.assertTrue(_dialog_matches_chat_filter(dialog(1, group=True, unread=2), rule))
        self.assertTrue(_dialog_matches_chat_filter(dialog(2, user=True, bot=True, unread=2), rule))
        self.assertFalse(_dialog_matches_chat_filter(dialog(3, group=True, unread=0), rule))
        self.assertFalse(_dialog_matches_chat_filter(dialog(4, group=True, muted=True), rule))
        self.assertFalse(_dialog_matches_chat_filter(dialog(5, group=True, archived=True), rule))


class _SparseClient:
    async def iter_dialogs(self, **kwargs):
        for value in range(int(kwargs.get("limit") or 0)):
            yield SimpleNamespace(
                id=10_000 + value,
                is_group=False,
                is_channel=False,
                is_user=True,
                unread_count=1,
                muted=False,
                archived=False,
                entity=SimpleNamespace(bot=False, contact=False, mutual_contact=False),
                message=SimpleNamespace(id=500 + value),
                date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            )


class ChatFolderPaginationTests(unittest.IsolatedAsyncioTestCase):
    async def test_sparse_folder_keeps_cursor_when_scan_window_is_exhausted(self):
        original = drive_fs._get_chat_filter_on

        async def fake_filter(_client, _folder_id):
            return {"id": 7, "groups": True}

        drive_fs._get_chat_filter_on = fake_filter
        try:
            result = await _list_chats_on(
                _SparseClient(), limit=10, chat_folder_id=7
            )
        finally:
            drive_fs._get_chat_filter_on = original

        self.assertEqual(result["chats"], [])
        self.assertTrue(result["has_more"])
        self.assertIsNotNone(result["next_offset_id"])
        self.assertIsNotNone(result["next_offset_peer_id"])


if __name__ == '__main__':
    unittest.main()
