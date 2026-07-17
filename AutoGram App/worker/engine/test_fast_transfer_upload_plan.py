import unittest
import os
import tempfile
from unittest.mock import AsyncMock, patch

from engine.fast_transfer import (
    _is_nonretryable_file_parts_error,
    _json_config_number,
    fast_send_file,
)


class _Value:
    def __init__(self, value):
        self.value = value


class _Pair:
    def __init__(self, key, value):
        self.key = key
        self.value = _Value(value)


class _Config:
    def __init__(self, values):
        self.value = [_Pair(key, value) for key, value in values.items()]


class UploadPlanTests(unittest.TestCase):
    def test_reads_dynamic_account_part_limit(self):
        config = _Config({"upload_max_fileparts_default": 4000})
        self.assertEqual(_json_config_number(config, "upload_max_fileparts_default", 2000), 4000)

    def test_falls_back_when_key_missing(self):
        self.assertEqual(_json_config_number(_Config({}), "missing", 4000), 4000)

    def test_part_limit_errors_never_enter_native_retry(self):
        self.assertTrue(
            _is_nonretryable_file_parts_error(
                ValueError("File terlalu besar untuk batas akun Telegram saat ini")
            )
        )
        self.assertTrue(
            _is_nonretryable_file_parts_error(
                RuntimeError("FILE_PARTS_INVALID caused by SaveBigFilePartRequest")
            )
        )
        self.assertFalse(_is_nonretryable_file_parts_error(TimeoutError("network timeout")))


class UploadFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_part_limit_failure_does_not_retry_native_upload(self):
        client = type("FakeClient", (), {"send_file": AsyncMock()})()
        handle, path = tempfile.mkstemp(suffix=".mp4")
        os.close(handle)
        try:
            with open(path, "r+b") as stream:
                stream.truncate(300 * 1024)
            with patch(
                "engine.fast_transfer.fast_upload_file",
                AsyncMock(
                    side_effect=ValueError(
                        "File terlalu besar untuk batas akun Telegram saat ini"
                    )
                ),
            ), patch(
                "engine.media_meta.build_send_attributes",
                return_value=([], "video/mp4"),
            ):
                with self.assertRaises(ValueError):
                    await fast_send_file(client, object(), path)
            client.send_file.assert_not_awaited()
        finally:
            os.remove(path)


if __name__ == "__main__":
    unittest.main()
