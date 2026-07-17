"""Lightweight tests for path_policy (run: python -m engine.path_policy_test)."""
from __future__ import annotations

import os
import sys
import tempfile

# Allow running as script from worker/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.path_policy import (  # noqa: E402
    is_blocked_sensitive_path,
    safe_join_download,
    validate_save_dir,
    validate_save_path,
    validate_upload_path,
)


def test_block_session_and_env():
    assert is_blocked_sensitive_path(r"C:\app\worker\sessions\user.session")
    assert is_blocked_sensitive_path(r"C:\app\worker\.env")
    assert is_blocked_sensitive_path("secrets.enc")
    assert not is_blocked_sensitive_path(r"C:\Users\me\Downloads\report.pdf")


def test_reject_session_upload():
    worker = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sess_dir = os.path.join(worker, "sessions")
    os.makedirs(sess_dir, exist_ok=True)
    fake = os.path.join(sess_dir, "_policy_test.session")
    try:
        with open(fake, "w", encoding="utf-8") as f:
            f.write("x")
        try:
            validate_upload_path(fake)
            raise AssertionError("should have blocked session upload")
        except ValueError as e:
            assert "blokir" in str(e).lower() or "session" in str(e).lower() or "sensitif" in str(e).lower()
    finally:
        try:
            os.remove(fake)
        except OSError:
            pass


def test_accept_temp_file_under_worker():
    worker = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    temp = os.path.join(worker, "temp")
    os.makedirs(temp, exist_ok=True)
    p = os.path.join(temp, "_policy_upload_ok.txt")
    with open(p, "w", encoding="utf-8") as f:
        f.write("ok")
    try:
        out = validate_upload_path(p)
        assert os.path.isfile(out)
    finally:
        try:
            os.remove(p)
        except OSError:
            pass


def test_accept_any_local_file():
    """Upload may come from any drive/folder (not only Downloads/Documents)."""
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "video_from_elsewhere.mp4")
        with open(p, "wb") as f:
            f.write(b"\x00\x00fake")
        out = validate_upload_path(p)
        assert os.path.isfile(out)
        assert os.path.samefile(out, p)


def test_block_system32_style_path():
    from engine.path_policy import is_system_critical_path

    assert is_system_critical_path(r"C:\Windows\System32\cmd.exe")
    assert is_system_critical_path(r"C:\Program Files\Foo\bar.dll")
    assert not is_system_critical_path(r"C:\Users\me\Videos\clip.mp4")


def test_download_join_no_escape():
    with tempfile.TemporaryDirectory() as td:
        root = validate_save_dir(td)
        good = safe_join_download(root, "hello.pdf")
        assert good.startswith(root)
        try:
            safe_join_download(root, "..\\..\\Windows\\system.ini")
            # basename strips to system.ini under root — still under root, OK
            # Explicit escape via absolute should fail join
        except ValueError:
            pass
        # basename-only always under root
        p = safe_join_download(root, "../../../evil.exe")
        assert os.path.basename(p) == "evil.exe"
        assert p.startswith(root)


def test_save_path_blocks_empty():
    try:
        validate_save_path("")
        raise AssertionError("empty should fail")
    except ValueError:
        pass


if __name__ == "__main__":
    test_block_session_and_env()
    test_reject_session_upload()
    test_accept_temp_file_under_worker()
    test_accept_any_local_file()
    test_block_system32_style_path()
    test_download_join_no_escape()
    test_save_path_blocks_empty()
    print("path_policy_test: OK")
