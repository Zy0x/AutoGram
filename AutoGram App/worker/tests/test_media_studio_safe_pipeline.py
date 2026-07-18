import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from telethon import types

from engine.media_studio import (
    AmbiguousCommitError,
    ProgressAgg,
    RegisteredMedia,
    StudioItem,
    StudioOptions,
    _commit_registered_media,
    _commit_registered_album,
    _run_fastlane_pipeline,
    _stable_random_id,
)
from engine.fast_transfer import fast_upload_file
from engine.transfer_journal import _safe_value


class DummyJournal:
    transfer_id = "unit-transfer"

    def __init__(self):
        self.events = []

    def append(self, event, **fields):
        self.events.append((event, fields))


class DummyDuplicateChecker:
    def get_duplicate_message_id(self, **_kwargs):
        return None

    def log(self, *_args, **_kwargs):
        return None


class MediaStudioSafePipelineTests(unittest.IsolatedAsyncioTestCase):
    def test_transfer_journal_redacts_session_and_absolute_error_paths(self):
        self.assertEqual(_safe_value("session", "Lavender.session"), "***")
        self.assertEqual(_safe_value("api_hash", "secret"), "***")
        self.assertEqual(_safe_value("caption", "private caption"), "[redacted]")
        error = _safe_value("error", r"failed F:\Sensitive Folder\clip.mp4: database is locked")
        self.assertNotIn("Sensitive Folder", error)
        self.assertIn("clip.mp4", error)

    def test_stable_random_id_is_repeatable_and_item_scoped(self):
        first = StudioItem(index=0, path="a.mp4", item_id="batch:0", size=123, fingerprint="abc")
        second = StudioItem(index=1, path="b.mp4", item_id="batch:1", size=123, fingerprint="abc")
        self.assertEqual(_stable_random_id("batch", first), _stable_random_id("batch", first))
        self.assertNotEqual(_stable_random_id("batch", first), _stable_random_id("batch", second))

    async def test_first_item_commits_before_later_uploads_and_commits_remain_ordered(self):
        trace = []
        journal = DummyJournal()
        with tempfile.TemporaryDirectory() as tmp:
            items = []
            for index in range(3):
                path = os.path.join(tmp, f"{index}.mp4")
                with open(path, "wb") as fh:
                    fh.write(bytes([index + 1]) * 32)
                items.append(StudioItem(index=index, path=path, item_id=f"batch:{index}", size=32))

            async def prepare(item, _opts, **_kwargs):
                trace.append(("prepare", item.index))
                return item.path, None

            async def upload(_client, item, *_args, **_kwargs):
                trace.append(("upload", item.index))
                return object()

            async def register(_client, _entity, item, _opts, _handle, send_path, **_kwargs):
                trace.append(("register", item.index))
                return RegisteredMedia(
                    input_media=types.InputMediaDocument(types.InputDocument(item.index + 1, 2, b"x")),
                    media_identity=f"document:{item.index + 1}",
                    final_file_name=os.path.basename(send_path),
                    send_path=send_path,
                    random_id=item.index + 100,
                    registered_at=1.0,
                )

            async def send(_client, _entity, item, *_args, **_kwargs):
                trace.append(("commit", item.index))
                item.status = "done"
                item.message_id = 1000 + item.index
                return item

            with (
                patch("engine.media_studio._prepare_item_path", side_effect=prepare),
                patch("engine.media_studio._sha256_file", new=AsyncMock(return_value="hash")),
                patch("engine.media_studio._upload_bytes", side_effect=upload),
                patch("engine.media_studio._register_uploaded_handle", side_effect=register),
                patch("engine.media_studio._send_one", side_effect=send),
                patch("engine.media_studio._adaptive_prepare_slots", return_value=2),
                patch("engine.media_studio.asyncio.sleep", new=AsyncMock()),
            ):
                await _run_fastlane_pipeline(
                    object(),
                    object(),
                    items,
                    StudioOptions(concurrency=3),
                    ProgressAgg(96, 3),
                    upload_policy=None,
                    dup_checker=DummyDuplicateChecker(),
                    tg_exists={},
                    transfer_id="batch",
                    session_key_hash="session-hash",
                    journal=journal,
                )

        self.assertLess(trace.index(("commit", 0)), trace.index(("upload", 1)))
        commits = [index for event, index in trace if event == "commit"]
        self.assertEqual(commits, [0, 1, 2])

    async def test_ambiguous_commit_reuses_random_id_without_upload_fallback(self):
        class TimeoutClient:
            def __init__(self):
                self.requests = []

            def is_connected(self):
                return True

            async def _parse_message_text(self, text, _mode):
                return text, []

            async def __call__(self, request):
                self.requests.append(request)
                raise TimeoutError("response lost")

            async def iter_messages(self, *_args, **_kwargs):
                if False:
                    yield None

        client = TimeoutClient()
        item = StudioItem(index=0, path="ambiguous.mp4", item_id="batch:0", size=12)
        media = RegisteredMedia(
            input_media=types.InputMediaDocument(types.InputDocument(1, 2, b"x")),
            media_identity="document:1",
            final_file_name="ambiguous.mp4",
            send_path="ambiguous.mp4",
            random_id=987654321,
            registered_at=1.0,
        )
        with patch("engine.media_studio.asyncio.sleep", new=AsyncMock()):
            with self.assertRaises(AmbiguousCommitError):
                await _commit_registered_media(
                    client,
                    types.InputPeerSelf(),
                    item,
                    StudioOptions(),
                    media,
                    journal=DummyJournal(),
                )

        self.assertEqual(len(client.requests), 3)
        self.assertEqual({request.random_id for request in client.requests}, {987654321})
        self.assertFalse(hasattr(client, "upload_file"))

    async def test_part_resume_sends_only_unacknowledged_indexes(self):
        class PartClient:
            def __init__(self):
                self.parts = []

            async def __call__(self, request):
                self.parts.append(int(request.file_part))
                return True

        with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as fh:
            path = fh.name
            fh.write(b"x" * (96 * 1024))
        try:
            client = PartClient()
            with patch("engine.fast_transfer.CONCURRENT_MIN_BYTES", 1):
                handle = await fast_upload_file(
                    client,
                    path,
                    workers=2,
                    part_size_kb=32,
                    upload_id=12345,
                    acknowledged_parts={0, 2},
                )
            self.assertEqual(client.parts, [1])
            self.assertEqual(handle.id, 12345)
            self.assertEqual(handle.parts, 3)
        finally:
            os.remove(path)

    async def test_album_commit_is_one_request_with_stable_member_random_ids(self):
        class AlbumClient:
            def __init__(self):
                self.requests = []

            def is_connected(self):
                return True

            async def _parse_message_text(self, text, _mode):
                return text, []

            async def __call__(self, request):
                self.requests.append(request)
                return object()

            def _get_response_message(self, random_ids, _updates, _entity):
                return [SimpleNamespace(id=500 + index) for index, _ in enumerate(random_ids)]

        entries = []
        for index, random_id in enumerate((101, 202, 303)):
            item = StudioItem(index=index, path=f"{index}.mp4", item_id=f"album:{index}", size=12)
            media = RegisteredMedia(
                input_media=types.InputMediaDocument(types.InputDocument(index + 1, 2, b"x")),
                media_identity=f"document:{index + 1}",
                final_file_name=f"{index}.mp4",
                send_path=f"{index}.mp4",
                random_id=random_id,
                registered_at=1.0,
            )
            entries.append((item, media))

        client = AlbumClient()
        messages = await _commit_registered_album(
            client,
            types.InputPeerSelf(),
            entries,
            StudioOptions(topic_id=5),
            journal=DummyJournal(),
        )
        self.assertEqual([message.id for message in messages], [500, 501, 502])
        self.assertEqual(len(client.requests), 1)
        request = client.requests[0]
        self.assertEqual([member.random_id for member in request.multi_media], [101, 202, 303])
        self.assertEqual(request.reply_to.reply_to_msg_id, 5)


if __name__ == "__main__":
    unittest.main()
