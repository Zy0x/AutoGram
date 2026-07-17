import unittest
from unittest.mock import patch

from engine.media_meta import _encoder_attempts


class EncoderPolicyTests(unittest.TestCase):
    def test_auto_prefers_nvenc_and_keeps_cpu_fallback(self):
        caps = {
            "nvidia": {"usable": True},
            "amd": {"usable": False},
            "intel": {"usable": False},
            "cpu": {"usable": True},
        }
        with patch("engine.media_meta.probe_encoder_capabilities", return_value=caps):
            attempts = _encoder_attempts(
                {"video_codec": "vp9"}, "auto", "speed", 20
            )
        self.assertEqual(attempts[0][0], "nvidia")
        self.assertEqual(attempts[0][1], "CUDA/NVDEC")
        self.assertEqual(attempts[-1][0], "cpu")
        self.assertIn("p1", attempts[0][3])

    def test_forced_unavailable_backend_uses_cpu(self):
        caps = {
            "nvidia": {"usable": False},
            "amd": {"usable": False},
            "intel": {"usable": False},
            "cpu": {"usable": True},
        }
        with patch("engine.media_meta.probe_encoder_capabilities", return_value=caps):
            attempts = _encoder_attempts(
                {"video_codec": "h264"}, "nvidia", "quality", 20
            )
        self.assertEqual([attempt[0] for attempt in attempts], ["cpu"])
        self.assertIn("slow", attempts[0][3])


if __name__ == "__main__":
    unittest.main()
