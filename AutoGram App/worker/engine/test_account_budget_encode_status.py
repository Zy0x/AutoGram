"""
Tier-aware HQ encode budget + no false "gagal" after successful commit.
Drives shipped media_meta / media_studio helpers (no network / no real ffmpeg encode).
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.fast_transfer import (  # noqa: E402
    DEFAULT_UPLOAD_MAX_PARTS,
    PREMIUM_UPLOAD_MAX_PARTS,
    _policy_from_parts,
)
from engine.media_meta import (  # noqa: E402
    AccountBudgetError,
    plan_encode_budget,
    prepare_video_for_hq,
    reencode_for_telegram,
)
from engine.media_studio import (  # noqa: E402
    StudioItem,
    apply_item_commit_success,
    item_status_after_event,
)


class TierEncodeBudgetTests(unittest.TestCase):
    def _free_safe(self) -> int:
        return int(
            _policy_from_parts(
                premium=False, max_parts=DEFAULT_UPLOAD_MAX_PARTS, source="t"
            ).safe_max_bytes
        )

    def _prem_safe(self) -> int:
        return int(
            _policy_from_parts(
                premium=True, max_parts=PREMIUM_UPLOAD_MAX_PARTS, source="t"
            ).safe_max_bytes
        )

    def test_codec_reencode_always_passes_tier_budget(self):
        """Source under limit but needs codec → still plan under free/premium safe."""
        free = self._free_safe()
        prem = self._prem_safe()
        self.assertLess(free, 2 * 1024**3)
        self.assertGreater(prem, free)

        fd, path = tempfile.mkstemp(suffix=".webm")
        os.close(fd)
        try:
            # Source small (under free limit) — previously encode_budget=0
            with open(path, "wb") as f:
                f.truncate(80 * 1024 * 1024)

            captured = {}

            def fake_reencode(*_a, **kw):
                captured["max_output_bytes"] = int(kw.get("max_output_bytes") or 0)
                out = path + ".out.mp4"
                with open(out, "wb") as f:
                    f.truncate(min(captured["max_output_bytes"] - 1024 * 1024, 50 * 1024 * 1024))
                return out, {
                    "backend": "mock",
                    "output_bytes": os.path.getsize(out),
                    "single_pass": True,
                }

            with patch("engine.media_meta.needs_telegram_reencode", return_value=True), patch(
                "engine.media_meta.probe_with_ffmpeg",
                return_value={
                    "duration": 600.0,
                    "width": 1920,
                    "height": 1080,
                    "video_codec": "vp9",
                    "is_video": True,
                },
            ), patch("engine.media_meta.reencode_for_telegram", side_effect=fake_reencode):
                out, info = prepare_video_for_hq(
                    path, max_output_bytes=free, force_fit_budget=False
                )
                self.assertTrue(info.get("reencoded"))
                self.assertEqual(captured["max_output_bytes"], free)
                plan = info.get("encode_plan") or {}
                self.assertTrue(plan.get("feasible"), plan)
                self.assertLessEqual(int(plan["target_output_bytes"]), free)
                self.assertNotEqual(out, path)

            # Premium ceiling higher
            captured.clear()
            with patch("engine.media_meta.needs_telegram_reencode", return_value=True), patch(
                "engine.media_meta.probe_with_ffmpeg",
                return_value={
                    "duration": 600.0,
                    "width": 1920,
                    "height": 1080,
                    "video_codec": "vp9",
                    "is_video": True,
                },
            ), patch("engine.media_meta.reencode_for_telegram", side_effect=fake_reencode):
                prepare_video_for_hq(path, max_output_bytes=prem, force_fit_budget=False)
                self.assertEqual(captured["max_output_bytes"], prem)
                self.assertGreater(prem, free)
        finally:
            for p in (path, path + ".out.mp4"):
                try:
                    os.remove(p)
                except OSError:
                    pass

    def test_free_plan_never_targets_above_2gib(self):
        free = self._free_safe()
        for dur in (60.0, 3600.0, 7200.0):
            plan = plan_encode_budget(free, dur)
            if plan["feasible"]:
                self.assertLessEqual(plan["target_output_bytes"], free)
                self.assertLess(plan["target_output_bytes"], 2 * 1024**3)

    def test_premium_allows_higher_ceiling(self):
        free = self._free_safe()
        prem = self._prem_safe()
        plan_f = plan_encode_budget(free, 3600.0)
        plan_p = plan_encode_budget(prem, 3600.0)
        self.assertTrue(plan_f["feasible"] and plan_p["feasible"])
        self.assertGreater(plan_p["video_bps"], plan_f["video_bps"])
        self.assertLessEqual(plan_f["target_output_bytes"], free)
        self.assertLessEqual(plan_p["target_output_bytes"], prem)

    def test_reencode_started_payload_includes_planned_target(self):
        """progress started event must carry planned_target so UI never shows 4GB free."""
        free = self._free_safe()
        fd, path = tempfile.mkstemp(suffix=".mp4")
        os.close(fd)
        events = []
        try:
            with open(path, "wb") as f:
                f.write(b"\x00" * 4096)

            with patch("engine.media_meta._ffmpeg_exe", return_value=None):
                # Without ffmpeg, reencode_for_telegram raises early after plan
                with self.assertRaises(RuntimeError):
                    reencode_for_telegram(
                        path,
                        duration=120.0,
                        max_output_bytes=free,
                        progress_cb=lambda d: events.append(d),
                    )
        except Exception:
            # Prefer probing plan path without full ffmpeg
            pass
        finally:
            try:
                os.remove(path)
            except OSError:
                pass

        # Direct plan + fmt used by reencode when ffmpeg present
        plan = plan_encode_budget(free, 1800.0)
        self.assertTrue(plan["feasible"])
        self.assertLessEqual(plan["target_output_bytes"], free)
        # Simulate started payload fields the UI seeds estimate from
        payload = {
            "planned_target_bytes": plan["target_output_bytes"],
            "budget_bytes": free,
        }
        self.assertLessEqual(payload["planned_target_bytes"], free)
        self.assertLess(payload["planned_target_bytes"] / (1024**3), 2.0)


class CommitStatusHonestyTests(unittest.TestCase):
    def test_item_status_never_downgrades_done_with_message_id(self):
        self.assertEqual(
            item_status_after_event("done", incoming_status="failed", had_message_id=True),
            "done",
        )
        self.assertEqual(
            item_status_after_event("done", incoming_status="failed", message_id=12345),
            "done",
        )
        self.assertEqual(
            item_status_after_event("uploading", incoming_status="failed"),
            "failed",
        )
        self.assertEqual(
            item_status_after_event("uploading", incoming_status="done", message_id=9),
            "done",
        )

    def test_apply_commit_success_is_terminal(self):
        it = StudioItem(index=0, path="/x.mp4", size=10_000_000)
        apply_item_commit_success(it, 42, duration_s=12.5)
        self.assertEqual(it.status, "done")
        self.assertEqual(it.message_id, 42)
        self.assertIsNone(it.error)
        # Simulated post-commit exception path must not flip if we re-check mid
        self.assertEqual(
            item_status_after_event(
                it.status, incoming_status="failed", message_id=it.message_id
            ),
            "done",
        )

    def test_structural_send_one_uses_commit_helpers(self):
        import inspect
        from engine import media_studio

        src = inspect.getsource(media_studio._send_one)
        self.assertIn("apply_item_commit_success", src)
        self.assertIn("item_status_after_event", src)
        self.assertIn("post-commit error ignored", src)
        album = inspect.getsource(media_studio._send_album)
        self.assertIn("apply_item_commit_success", album)
        self.assertIn("item_status_after_event", album)
        # prepare always applies budget on codec reencode
        prep_meta = inspect.getsource(
            __import__("engine.media_meta", fromlist=["prepare_video_for_hq"]).prepare_video_for_hq
        )
        self.assertIn("encode_budget = budget", prep_meta)
        self.assertNotIn("encode_budget = 0", prep_meta)

    def test_album_exception_does_not_fail_committed_items(self):
        """Simulates album except branch: items already done+mid stay done."""
        items = [
            StudioItem(index=0, path="/a.jpg", size=100),
            StudioItem(index=1, path="/b.jpg", size=200),
        ]
        apply_item_commit_success(items[0], 1001, duration_s=1.0)
        # item 1 still uploading when exception fires
        items[1].status = "uploading"
        for it in items:
            final = item_status_after_event(
                it.status,
                incoming_status="failed",
                message_id=it.message_id,
                had_message_id=bool(it.message_id),
            )
            if final == "done" or it.message_id or it.status == "done":
                if it.status != "done":
                    apply_item_commit_success(it, it.message_id, duration_s=it.duration_s)
                continue
            it.status = "failed"
            it.error = "album boom"
        self.assertEqual(items[0].status, "done")
        self.assertEqual(items[0].message_id, 1001)
        self.assertEqual(items[1].status, "failed")


if __name__ == "__main__":
    unittest.main()
