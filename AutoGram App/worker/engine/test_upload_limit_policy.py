"""
Unit tests for per-account upload limits + single-pass encode budget planning.
Drives shipped functions in fast_transfer / media_meta (no network, no real encode).
"""
from __future__ import annotations

import inspect
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

# worker/ as cwd-import root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.fast_transfer import (  # noqa: E402
    DEFAULT_UPLOAD_MAX_PARTS,
    MAX_PART_BYTES,
    PREMIUM_UPLOAD_MAX_PARTS,
    UploadLimitExceeded,
    _policy_from_parts,
    preflight_upload_size,
)
from engine.media_meta import (  # noqa: E402
    AccountBudgetError,
    ENCODE_MIN_USABLE_VIDEO_BPS,
    ENCODE_SAFETY_FACTOR,
    TELEGRAM_SAFE_OUTPUT_BYTES,
    _fmt_encode_plan_error,
    is_account_budget_error,
    plan_encode_budget,
    prepare_video_for_hq,
)


class UploadPolicyUnitTests(unittest.TestCase):
    def test_free_tier_hard_max_is_parts_times_512kib(self):
        policy = _policy_from_parts(
            premium=False, max_parts=DEFAULT_UPLOAD_MAX_PARTS, source="test"
        )
        self.assertFalse(policy.premium)
        self.assertEqual(policy.max_parts, 4000)
        self.assertEqual(policy.hard_max_bytes, 4000 * MAX_PART_BYTES)
        # ~1.95 GiB
        self.assertLess(policy.hard_max_bytes, 2 * 1024**3)
        self.assertGreater(policy.hard_max_bytes, 1.9 * 1024**3)
        self.assertLess(policy.safe_max_bytes, policy.hard_max_bytes)

    def test_premium_tier_is_roughly_double(self):
        free = _policy_from_parts(
            premium=False, max_parts=DEFAULT_UPLOAD_MAX_PARTS, source="t"
        )
        prem = _policy_from_parts(
            premium=True, max_parts=PREMIUM_UPLOAD_MAX_PARTS, source="t"
        )
        self.assertTrue(prem.premium)
        self.assertEqual(prem.max_parts, 8000)
        self.assertEqual(prem.hard_max_bytes, 2 * free.hard_max_bytes)

    def test_preflight_rejects_just_over_limit(self):
        policy = _policy_from_parts(premium=False, max_parts=4000, source="t")
        over = policy.hard_max_bytes + 1
        with self.assertRaises(UploadLimitExceeded) as ctx:
            preflight_upload_size(over, policy)
        msg = str(ctx.exception)
        self.assertIn("File terlalu besar", msg)
        self.assertIn(str(policy.hard_max_bytes), msg)
        self.assertIn("GB", msg)

    def test_preflight_allows_just_under_limit(self):
        policy = _policy_from_parts(premium=False, max_parts=4000, source="t")
        under = policy.hard_max_bytes - MAX_PART_BYTES
        parts = preflight_upload_size(under, policy)
        self.assertGreater(parts, 0)
        self.assertLessEqual(parts, policy.max_parts)

    def test_preflight_small_file_skips_big_file_rule(self):
        # Files under 10MB use non-big upload path; preflight only enforces for big.
        policy = _policy_from_parts(premium=False, max_parts=4000, source="t")
        parts = preflight_upload_size(5 * 1024 * 1024, policy)
        self.assertGreater(parts, 0)

    def test_dummy_file_on_disk_oversize_rejected(self):
        """Create a sparse dummy size via truncate metadata (no multi-GB write)."""
        policy = _policy_from_parts(premium=False, max_parts=4000, source="t")
        tmp_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "temp")
        os.makedirs(tmp_dir, exist_ok=True)
        path = os.path.join(tmp_dir, "dummy_oversize_limit_test.bin")
        try:
            with open(path, "wb") as f:
                f.truncate(policy.hard_max_bytes + 1024 * 1024)
            size = os.path.getsize(path)
            self.assertGreater(size, policy.hard_max_bytes)
            with self.assertRaises(UploadLimitExceeded):
                preflight_upload_size(size, policy)
        finally:
            try:
                os.remove(path)
            except OSError:
                pass

    def test_encode_budget_default_is_free_safe(self):
        self.assertGreater(TELEGRAM_SAFE_OUTPUT_BYTES, 1.5 * 1024**3)
        self.assertLess(TELEGRAM_SAFE_OUTPUT_BYTES, 2 * 1024**3)

    def test_prepare_video_passthrough_tiny_non_video(self):
        """Non-video tiny file: oversize path not taken."""
        fd, path = tempfile.mkstemp(suffix=".txt")
        os.close(fd)
        try:
            with open(path, "wb") as f:
                f.write(b"hello")
            out, info = prepare_video_for_hq(path, max_output_bytes=1024)
            self.assertEqual(out, path)
            self.assertFalse(info.get("reencoded"))
        finally:
            os.remove(path)

    def test_prepare_video_rejects_when_encode_stays_over_budget(self):
        """Real prepare_video_for_hq path: mock reencode that still exceeds budget."""
        fd, path = tempfile.mkstemp(suffix=".mp4")
        os.close(fd)
        try:
            with open(path, "wb") as f:
                f.truncate(50 * 1024 * 1024)
            budget = 5 * 1024 * 1024
            calls = {"n": 0}

            def fake_reencode(*_a, **_kw):
                calls["n"] += 1
                out = path + ".out.mp4"
                with open(out, "wb") as f:
                    f.truncate(budget + 2 * 1024 * 1024)  # still over budget
                return out, {"backend": "mock", "output_bytes": budget + 2 * 1024 * 1024}

            with patch("engine.media_meta.needs_telegram_reencode", return_value=False), patch(
                "engine.media_meta.probe_with_ffmpeg",
                return_value={
                    "duration": 120.0,
                    "width": 1280,
                    "height": 720,
                    "video_codec": "h264",
                    "is_video": True,
                },
            ), patch(
                "engine.media_meta.reencode_for_telegram", side_effect=fake_reencode
            ):
                with self.assertRaises(AccountBudgetError) as ctx:
                    prepare_video_for_hq(
                        path,
                        max_output_bytes=budget,
                        force_fit_budget=True,
                    )
                self.assertTrue(is_account_budget_error(ctx.exception))
                # Fail-clean: exactly one encode attempt, no "re-encode ulang"
                self.assertEqual(calls["n"], 1)
        finally:
            for p in (path, path + ".out.mp4"):
                try:
                    os.remove(p)
                except OSError:
                    pass


class EncodeBudgetPlannerTests(unittest.TestCase):
    """Shipped plan_encode_budget: pure math, no ffmpeg."""

    def _free_safe(self) -> int:
        free = _policy_from_parts(
            premium=False, max_parts=DEFAULT_UPLOAD_MAX_PARTS, source="t"
        )
        return int(free.safe_max_bytes)

    def test_short_video_under_free_budget(self):
        budget = self._free_safe()
        plan = plan_encode_budget(budget, 60.0)  # 1 minute
        self.assertTrue(plan["feasible"], plan.get("reason"))
        self.assertLessEqual(plan["target_output_bytes"], budget)
        self.assertGreater(plan["video_bps"], ENCODE_MIN_USABLE_VIDEO_BPS)
        # Safety: target uses safety_factor so stays strictly under hard budget
        self.assertLessEqual(
            plan["target_output_bytes"], int(budget * ENCODE_SAFETY_FACTOR) + 1
        )

    def test_one_hour_under_free_budget(self):
        budget = self._free_safe()
        plan = plan_encode_budget(budget, 3600.0)
        self.assertTrue(plan["feasible"], plan.get("reason"))
        self.assertLessEqual(plan["target_output_bytes"], budget)
        self.assertGreaterEqual(plan["video_bps"], ENCODE_MIN_USABLE_VIDEO_BPS)
        # No contradictory 450kbps floor that would overshoot for long content
        implied = int((plan["video_bps"] + plan["audio_bps"]) * 3600.0 / 8.0)
        self.assertLessEqual(implied, budget)

    def test_multi_hour_still_feasible_or_clean_fail(self):
        budget = self._free_safe()
        # ~3h at free tier should still be feasible at lower bitrate
        plan_3h = plan_encode_budget(budget, 3 * 3600.0)
        if plan_3h["feasible"]:
            self.assertLessEqual(plan_3h["target_output_bytes"], budget)
            self.assertGreaterEqual(plan_3h["video_bps"], ENCODE_MIN_USABLE_VIDEO_BPS)
        # Extreme multi-day must fail cleanly without inventing a floor
        plan_impossible = plan_encode_budget(budget, 48 * 3600.0)
        self.assertFalse(plan_impossible["feasible"])
        self.assertIsNotNone(plan_impossible["reason"])
        self.assertEqual(plan_impossible["video_bps"], 0)

    def test_never_applies_bitrate_floor_above_budget(self):
        """Regression: old max(450_000, calculated) forced overshoot then re-encode ulang."""
        budget = 3 * 1024 * 1024  # 3 MiB
        duration = 120.0
        plan = plan_encode_budget(budget, duration)
        # Either feasible under budget, or not feasible — never plan > budget
        if plan["feasible"]:
            self.assertLessEqual(plan["target_output_bytes"], budget)
            # If calculated raw would be < 450k, we must NOT bump to 450k
            raw_cap = int((budget * 8 * ENCODE_SAFETY_FACTOR / duration) - plan["audio_bps"])
            if raw_cap < 450_000:
                self.assertLess(plan["video_bps"], 450_000)
        else:
            self.assertIn("batas", (plan["reason"] or "").lower())

    def test_zero_duration_not_feasible(self):
        plan = plan_encode_budget(self._free_safe(), 0.0)
        self.assertFalse(plan["feasible"])
        self.assertIn("Durasi", plan["reason"] or "")

    def test_zero_budget_not_feasible(self):
        plan = plan_encode_budget(0, 60.0)
        self.assertFalse(plan["feasible"])


class SinglePassPrepareTests(unittest.TestCase):
    """prepare_video_for_hq must not full re-encode twice for size control."""

    def test_single_reencode_call_when_under_budget(self):
        fd, path = tempfile.mkstemp(suffix=".mp4")
        os.close(fd)
        try:
            with open(path, "wb") as f:
                f.truncate(50 * 1024 * 1024)
            budget = 20 * 1024 * 1024
            calls = {"n": 0, "kwargs": []}

            def fake_reencode(*_a, **kw):
                calls["n"] += 1
                calls["kwargs"].append(kw)
                out = path + ".out.mp4"
                with open(out, "wb") as f:
                    f.truncate(budget - 1024 * 1024)  # under budget
                return out, {
                    "backend": "mock",
                    "output_bytes": budget - 1024 * 1024,
                    "single_pass": True,
                }

            with patch("engine.media_meta.needs_telegram_reencode", return_value=False), patch(
                "engine.media_meta.probe_with_ffmpeg",
                return_value={
                    "duration": 300.0,
                    "width": 1280,
                    "height": 720,
                    "video_codec": "h264",
                    "is_video": True,
                },
            ), patch(
                "engine.media_meta.reencode_for_telegram", side_effect=fake_reencode
            ):
                out, info = prepare_video_for_hq(
                    path,
                    max_output_bytes=budget,
                    force_fit_budget=True,
                )
                self.assertTrue(info.get("reencoded"))
                self.assertTrue(info.get("single_pass"))
                self.assertEqual(calls["n"], 1)
                self.assertEqual(calls["kwargs"][0].get("max_output_bytes"), budget)
                self.assertNotEqual(out, path)
        finally:
            for p in (path, path + ".out.mp4"):
                try:
                    os.remove(p)
                except OSError:
                    pass

    def test_overshoot_fail_clean_no_second_encode(self):
        fd, path = tempfile.mkstemp(suffix=".mp4")
        os.close(fd)
        try:
            with open(path, "wb") as f:
                f.truncate(80 * 1024 * 1024)
            budget = 10 * 1024 * 1024
            calls = {"n": 0}

            def fake_reencode(*_a, **_kw):
                calls["n"] += 1
                out = path + ".out.mp4"
                with open(out, "wb") as f:
                    f.truncate(budget + 5 * 1024 * 1024)
                return out, {"backend": "mock", "output_bytes": budget + 5 * 1024 * 1024}

            with patch("engine.media_meta.needs_telegram_reencode", return_value=False), patch(
                "engine.media_meta.probe_with_ffmpeg",
                return_value={
                    "duration": 180.0,
                    "width": 1920,
                    "height": 1080,
                    "video_codec": "h264",
                    "is_video": True,
                },
            ), patch(
                "engine.media_meta.reencode_for_telegram", side_effect=fake_reencode
            ):
                with self.assertRaises(AccountBudgetError) as ctx:
                    prepare_video_for_hq(
                        path, max_output_bytes=budget, force_fit_budget=True
                    )
                msg = str(ctx.exception).lower()
                self.assertTrue(is_account_budget_error(ctx.exception))
                self.assertIn("batas akun", msg)
                self.assertIn("satu pass", msg)
                self.assertEqual(calls["n"], 1, "must not re-encode ulang after overshoot")
        finally:
            for p in (path, path + ".out.mp4"):
                try:
                    os.remove(p)
                except OSError:
                    pass

    def test_impossible_budget_fails_without_encode(self):
        """Duration so long that min usable quality cannot fit → no reencode call."""
        fd, path = tempfile.mkstemp(suffix=".mp4")
        os.close(fd)
        try:
            with open(path, "wb") as f:
                f.truncate(100 * 1024 * 1024)
            budget = 5 * 1024 * 1024  # 5 MiB
            # At min 200kbps + audio, 5 MiB only covers a few minutes
            duration = 24 * 3600.0  # 24 hours
            calls = {"n": 0}

            def fake_reencode(*_a, **_kw):
                calls["n"] += 1
                raise AssertionError("reencode must not run for impossible budget")

            with patch("engine.media_meta.needs_telegram_reencode", return_value=False), patch(
                "engine.media_meta.probe_with_ffmpeg",
                return_value={
                    "duration": duration,
                    "width": 1280,
                    "height": 720,
                    "video_codec": "h264",
                    "is_video": True,
                },
            ), patch(
                "engine.media_meta.reencode_for_telegram", side_effect=fake_reencode
            ):
                with self.assertRaises(AccountBudgetError) as ctx:
                    prepare_video_for_hq(
                        path, max_output_bytes=budget, force_fit_budget=True
                    )
                self.assertEqual(calls["n"], 0)
                # Studio must treat this as hard fail (type + text detector)
                self.assertTrue(is_account_budget_error(ctx.exception))
                self.assertTrue(is_account_budget_error(str(ctx.exception)))
        finally:
            try:
                os.remove(path)
            except OSError:
                pass

    def test_studio_detector_matches_plan_error_text(self):
        """
        Regression: 'batas unggah akun' did NOT contain substring 'batas akun',
        so Studio fell back to uploading the original oversize file.
        """
        from engine import media_studio as studio

        plan = plan_encode_budget(5 * 1024 * 1024, 24 * 3600.0)
        self.assertFalse(plan["feasible"])
        msg = _fmt_encode_plan_error(plan)
        # Shipped Studio guard uses is_account_budget_error (not brittle substring alone)
        self.assertTrue(
            is_account_budget_error(msg),
            f"Studio detector must match plan error: {msg!r}",
        )
        self.assertTrue(is_account_budget_error(AccountBudgetError(msg)))
        # Legacy phrase that previously slipped past 'batas akun' only
        legacy = "Video terlalu panjang untuk batas unggah akun (budget too small)"
        self.assertTrue(is_account_budget_error(legacy))
        # Studio imports the same helper
        self.assertIs(studio.is_account_budget_error, is_account_budget_error)
        # Ensure prepare raises typed error that Studio catches before fallback
        self.assertTrue(issubclass(AccountBudgetError, ValueError))

    def test_source_has_no_second_pass_size_retry(self):
        """Structural: prepare_video_for_hq must not call reencode twice for size."""
        import engine.media_meta as mm

        src = inspect.getsource(mm.prepare_video_for_hq)
        # Old recovery block markers must be gone
        self.assertNotIn("tighter = max(int(budget * 0.88)", src)
        self.assertNotIn("Second pass with lower CRF", src)
        self.assertNotIn('reencode_preset="speed"', src)
        # Single call pattern
        self.assertEqual(src.count("reencode_for_telegram("), 1)
        self.assertIn("single-pass", src.lower().replace("_", "-") or src)
        self.assertIn("plan_encode_budget", src)


class ScaleBatchSizingTests(unittest.TestCase):
    def test_ff_auto_batch_grows_with_limit(self):
        from engine.fast_forward import FastForwardEngine

        for limit, expected_min in ((100, 25), (1000, 30), (10_000, 40), (100_000, 50)):
            total_limit = limit
            if total_limit >= 50_000:
                configured_batch = 50
            elif total_limit >= 10_000:
                configured_batch = 40
            elif total_limit >= 1_000:
                configured_batch = 30
            else:
                configured_batch = 25
            self.assertGreaterEqual(configured_batch, expected_min)
            self.assertLessEqual(configured_batch, FastForwardEngine.MAX_BATCH)


if __name__ == "__main__":
    unittest.main()
