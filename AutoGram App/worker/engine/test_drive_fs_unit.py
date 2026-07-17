"""Lightweight unit checks for drive_fs helpers (no network)."""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.drive_fs import (  # noqa: E402
    FOLDER_TITLE_SUFFIX,
    THUMB_MAX_EDGE,
    THUMB_MAX_BYTES,
    _cache_key,
    _folder_display_name,
    _file_ext,
    _fetch_thumb_data_url,
    _icon_type_from_message,
    _is_photo_thumb_size,
    _normalize_thumb_quality,
    _optimize_thumb_bytes,
    _resolve_thumb_sel,
    _select_light_thumb,
    _stream_sample_base_key,
    _thumb_profile,
    _compose_folder_about,
    _would_create_folder_cycle,
    _collect_folder_descendants,
    _enrich_folders_orphan_flags,
    _empty_media_page,
    _media_filter_instances,
    _known_quick_filter_counts,
    FOLDER_ABOUT_TAG,
)


def test_empty_media_page_marks_invalid_topic_without_pagination():
    out = _empty_media_page(
        folder_id=-100123,
        topic_id=99,
        page_size=16,
        invalid_topic=True,
    )
    assert out["invalid_topic"] is True
    assert out["files"] == []
    assert out["has_more"] is False
    assert out["next_offset_id"] is None
    assert out["stats_accurate"] is True
    assert out["stats_pending"] is False


def test_media_filters_cover_audio_and_voice():
    names = {type(item).__name__ for item in _media_filter_instances()}
    assert "InputMessagesFilterMusic" in names
    assert "InputMessagesFilterVoice" in names


def test_quick_count_unknown_sentinel_is_not_empty():
    counts = _known_quick_filter_counts(
        ("photo_video", "document", "voice"), [73, -1, 0]
    )
    assert counts == {"photo_video": 73, "voice": 0}


def test_folder_display_name():
    assert _folder_display_name("Photos [TD]") == "Photos"
    assert _folder_display_name("Plain") == "Plain"
    assert FOLDER_TITLE_SUFFIX == " [TD]"


def test_compose_folder_about():
    a = _compose_folder_about(None)
    assert FOLDER_ABOUT_TAG in a
    assert "parent=" not in a
    b = _compose_folder_about(-100123)
    assert "parent=-100123" in b


def test_would_create_folder_cycle():
    parent_map = {1: None, 2: 1, 3: 2, 4: None}
    assert _would_create_folder_cycle(1, 3, parent_map) is True
    assert _would_create_folder_cycle(3, 4, parent_map) is False
    assert _would_create_folder_cycle(2, 2, parent_map) is True
    assert _would_create_folder_cycle(2, None, parent_map) is False


def test_collect_folder_descendants():
    parent_map = {1: None, 2: 1, 3: 2, 4: 1, 5: None}
    desc = set(_collect_folder_descendants(1, parent_map))
    assert desc == {2, 3, 4}


def test_enrich_orphan_flags():
    folders = [
        {"id": 1, "name": "A", "parent_id": None},
        {"id": 2, "name": "B", "parent_id": 999},
        {"id": 3, "name": "C", "parent_id": 1},
    ]
    out = _enrich_folders_orphan_flags(folders)
    assert out[1]["is_orphan"] is True
    assert out[0]["is_orphan"] is False
    assert out[2]["is_orphan"] is False


def test_cache_key():
    assert _cache_key(None, 42) == "home_42"
    assert _cache_key(-100123, 7) == "-100123_7"


def test_file_ext():
    assert _file_ext("a.JPG") == "jpg"
    assert _file_ext("noext") is None


def test_pagination_defaults():
    # has_more logic mirror (page full => more)
    page_size, scanned, budget, n_files = 80, 80, 500, 80
    has_more = n_files >= page_size or (scanned >= budget)
    if scanned < budget and n_files < page_size:
        has_more = False
    assert has_more is True
    page_size, scanned, budget, n_files = 80, 12, 500, 3
    has_more = n_files >= page_size or (scanned >= budget)
    if scanned < budget and n_files < page_size:
        has_more = False
    assert has_more is False


class _FakeSize:
    def __init__(self, w, h):
        self.w = w
        self.h = h


class _FakePhoto:
    def __init__(self, sizes):
        self.sizes = sizes


class _FakeMsg:
    def __init__(self, sizes):
        self.photo = _FakePhoto(sizes)
        self.document = None


def test_select_light_thumb_prefers_medium():
    sizes = [_FakeSize(100, 100), _FakeSize(320, 240), _FakeSize(1280, 960), _FakeSize(2560, 1440)]
    msg = _FakeMsg(sizes)
    picked = _select_light_thumb(msg, target_edge=288)
    assert picked.w == 320 and picked.h == 240


def test_select_light_thumb_none_when_no_sizes():
    msg = _FakeMsg([])
    assert _select_light_thumb(msg, target_edge=288) is None


def test_photo_thumb_accepts_video_size():
    class VideoSize:
        w = 320
        h = 240

    class PhotoSize:
        w = 100
        h = 100

    assert _is_photo_thumb_size(PhotoSize()) is True
    assert _is_photo_thumb_size(VideoSize()) is True
    assert _is_photo_thumb_size(0) is False


def test_resolve_thumb_sel_no_int_without_sizes():
    msg = _FakeMsg([])
    assert _resolve_thumb_sel(msg, 0) is None
    assert _resolve_thumb_sel(msg, -1) is None


def test_stream_sample_base_key_strips_quality():
    assert _stream_sample_base_key("home_42.balanced") == "home_42"
    assert _stream_sample_base_key("home_42") == "home_42"


def test_optimize_thumb_shrinks_large_jpeg():
    try:
        from PIL import Image
        import io
    except ImportError:
        print("skip optimize (no Pillow)")
        return
    im = Image.new("RGB", (1200, 800), color=(40, 120, 200))
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=92)
    raw = buf.getvalue()
    out = _optimize_thumb_bytes(raw, quality="balanced")
    assert out and len(out) < len(raw)
    assert len(out) <= THUMB_MAX_BYTES
    im2 = Image.open(io.BytesIO(out))
    assert max(im2.size) <= THUMB_MAX_EDGE + 2


def test_thumb_quality_profiles():
    assert _normalize_thumb_quality("hemat") == "saver"
    assert _normalize_thumb_quality("jelas") == "sharp"
    assert _normalize_thumb_quality(None) == "balanced"
    sav = _thumb_profile("saver")
    bal = _thumb_profile("balanced")
    shp = _thumb_profile("sharp")
    assert sav["video_edge"] < bal["video_edge"] < shp["video_edge"]
    assert sav["max"] < bal["max"] <= shp["max"]


def test_video_thumb_allows_larger_edge():
    try:
        from PIL import Image
        import io
    except ImportError:
        print("skip video edge (no Pillow)")
        return
    im = Image.new("RGB", (900, 500), color=(20, 20, 20))
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=90)
    raw = buf.getvalue()
    out = _optimize_thumb_bytes(raw, quality="balanced", is_video=True)
    assert out
    im2 = Image.open(io.BytesIO(out))
    # video_edge balanced = 440
    assert max(im2.size) <= 442


class _FakeDocAttrName:
    def __init__(self, file_name):
        self.file_name = file_name


class _FakeDoc:
    def __init__(self, mime, filename, thumbs=None):
        self.mime_type = mime
        self.attributes = [_FakeDocAttrName(filename)] if filename else []
        self.thumbs = thumbs or []
        self.size = 1000


class _FakeMediaDoc:
    def __init__(self, doc):
        self.document = doc


class _FakeMsgDoc:
    def __init__(self, mime, filename, thumbs=None):
        self.media = _FakeMediaDoc(_FakeDoc(mime, filename, thumbs))
        self.message = ""
        self.id = 1
        self.date = None


def test_document_as_photo_icon():
    # Sent as document with image mime
    msg = _FakeMsgDoc("image/jpeg", "holiday.jpg")
    assert _icon_type_from_message(msg) == "image"
    # Generic mime but photo extension (common Telegram "send as file")
    msg2 = _FakeMsgDoc("application/octet-stream", "scan.PNG")
    assert _icon_type_from_message(msg2) == "image"
    msg3 = _FakeMsgDoc("application/octet-stream", "clip.mp4")
    assert _icon_type_from_message(msg3) == "video"


class _FakeVideoAttr:
    def __init__(self, duration, w=1280, h=720):
        self.duration = duration
        self.w = w
        self.h = h
        self.round_message = False
        self.supports_streaming = True


def test_media_duration_from_video_attr():
    from engine.drive_fs import _media_duration_seconds

    class Doc:
        mime_type = "video/mp4"
        attributes = [_FakeVideoAttr(125.4)]
        thumbs = []
        size = 9_000_000

    class Media:
        document = Doc()

    class Msg:
        media = Media()
        file = None
        message = ""
        id = 9
        date = None

    assert _media_duration_seconds(Msg()) == 125


def test_preloaded_thumbnail_message_skips_per_item_lookup():
    class Client:
        calls = 0

        async def get_messages(self, *_args, **_kwargs):
            self.calls += 1
            raise AssertionError("batch-preloaded thumbnail repeated get_messages")

    class Msg:
        id = 987_654_321
        media = None

    client = Client()
    result = asyncio.run(
        _fetch_thumb_data_url(
            client,
            object(),
            -100_987_654_321,
            Msg.id,
            quality="balanced",
            preloaded_message=Msg(),
            message_preloaded=True,
        )
    )
    assert result is None
    assert client.calls == 0


if __name__ == "__main__":
    test_empty_media_page_marks_invalid_topic_without_pagination()
    test_media_filters_cover_audio_and_voice()
    test_quick_count_unknown_sentinel_is_not_empty()
    test_folder_display_name()
    test_cache_key()
    test_file_ext()
    test_pagination_defaults()
    test_select_light_thumb_prefers_medium()
    test_select_light_thumb_none_when_no_sizes()
    test_photo_thumb_accepts_video_size()
    test_resolve_thumb_sel_no_int_without_sizes()
    test_stream_sample_base_key_strips_quality()
    test_optimize_thumb_shrinks_large_jpeg()
    test_thumb_quality_profiles()
    test_video_thumb_allows_larger_edge()
    test_document_as_photo_icon()
    test_media_duration_from_video_attr()
    test_preloaded_thumbnail_message_skips_per_item_lookup()
    print("ok")
