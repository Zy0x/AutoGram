"""
Extract media attributes so Telegram clients (official / Nagram) can play videos.
Telethon's get_attributes often returns duration=0 / 1x1 without ffmpeg.
Also re-encodes non-Telegram-friendly codecs (e.g. AV1) to H.264 for HQ mode.
"""
from __future__ import annotations

import os
import re
import json
import hashlib
import platform
import subprocess
import tempfile
import time
from typing import Any, Dict, List, Optional, Tuple

from telethon.tl.types import (
    DocumentAttributeFilename,
    DocumentAttributeVideo,
    DocumentAttributeAudio,
)

# Codecs Telegram native streaming typically accepts
TELEGRAM_OK_VIDEO = {
    "h264", "avc", "avc1", "x264", "libx264",
    "hevc", "h265", "hev1", "hvc1",  # partial; H.264 safer
}
# Prefer re-encode these for in-app playback
TELEGRAM_BAD_VIDEO = {
    "av1", "av01", "libaom-av1", "libsvtav1", "vp9", "vp8", "theora", "mpeg4", "mpeg2video",
}

TEMP_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "temp")
# Conservative free-tier ceiling (~2 GiB with margin). Prefer live UploadPolicy.safe_max_bytes.
TELEGRAM_SAFE_OUTPUT_BYTES = int(1.90 * 1024 * 1024 * 1024)
# Premium ceiling (~4 GiB with margin) used only when policy is not supplied.
TELEGRAM_PREMIUM_SAFE_OUTPUT_BYTES = int(3.85 * 1024 * 1024 * 1024)

# --- Single-pass encode budget planning (no wasteful full re-encode retry) ---
# Target output uses a safety factor so mux overhead + encoder variance stay under
# the live account safe_max_bytes without a second full pass.
ENCODE_AUDIO_BPS = 192_000
ENCODE_MIN_AUDIO_BPS = 64_000
ENCODE_SAFETY_FACTOR = 0.88
ENCODE_MAXRATE_RATIO = 1.05
# Below this video bitrate the result is considered unusable; fail early instead
# of encoding for hours at unusable quality or applying a floor that overshoots.
ENCODE_MIN_USABLE_VIDEO_BPS = 200_000


class AccountBudgetError(ValueError):
    """
    Media cannot fit the live Telegram account upload budget.

    Media Studio MUST treat this as a hard prepare failure and must never fall
    back to uploading the oversize original. Prefer catching this type over
    substring matching on error text.
    """


def is_account_budget_error(err: BaseException | str) -> bool:
    """True if prepare/encode failed because of account size budget (not codec quirks)."""
    if isinstance(err, AccountBudgetError):
        return True
    text = str(err).lower()
    # Keep markers in sync with AccountBudgetError messages. Studio uses this so
    # "batas unggah akun" (with 'unggah' between words) still matches.
    markers = (
        "batas akun",
        "batas unggah",
        "upload budget",
        "account upload budget",
        "satu pass terencana",
        "tidak dapat menyesuaikan video",
        "melebihi budget",
        "melebihi batas",
    )
    return any(m in text for m in markers)


def plan_encode_budget(
    budget_bytes: int,
    duration_s: float,
    *,
    audio_bps: int = ENCODE_AUDIO_BPS,
    safety_factor: float = ENCODE_SAFETY_FACTOR,
    min_video_bps: int = ENCODE_MIN_USABLE_VIDEO_BPS,
    min_audio_bps: int = ENCODE_MIN_AUDIO_BPS,
) -> Dict[str, Any]:
    """
    Pure planner: map account safe budget + duration → one-shot encode params.

    Returns a dict (always) so unit tests need no ffmpeg:
      feasible, budget_bytes, duration_s, audio_bps, video_bps,
      maxrate_bps, bufsize_bits, target_output_bytes, safety_factor, reason

    Never applies a min-bitrate floor that would force size above budget.
    If even min usable quality cannot fit, feasible=False with reason.
    """
    budget = int(budget_bytes or 0)
    duration = float(duration_s or 0.0)
    safety = float(safety_factor) if safety_factor and safety_factor > 0 else ENCODE_SAFETY_FACTOR
    safety = min(0.98, max(0.50, safety))
    a_bps = max(0, int(audio_bps or 0))
    min_v = max(1, int(min_video_bps or ENCODE_MIN_USABLE_VIDEO_BPS))
    min_a = max(0, int(min_audio_bps or 0))

    base: Dict[str, Any] = {
        "feasible": False,
        "budget_bytes": budget,
        "duration_s": duration,
        "audio_bps": a_bps,
        "video_bps": 0,
        "maxrate_bps": 0,
        "bufsize_bits": 0,
        "target_output_bytes": 0,
        "safety_factor": safety,
        "reason": None,
    }
    if budget <= 0:
        base["reason"] = "budget_bytes must be > 0"
        return base
    if duration <= 0:
        base["reason"] = (
            "Durasi video tidak diketahui; tidak bisa merencanakan bitrate di bawah "
            "batas akun. Perbaiki metadata atau pecah file."
        )
        return base

    # Bits available for A/V after safety margin (leaves headroom under hard budget).
    usable_bits = budget * 8.0 * safety
    total_bps_cap = usable_bits / duration

    # Prefer full audio; if tight, drop audio toward min_audio before failing video.
    if a_bps > 0 and total_bps_cap <= a_bps + min_v:
        # Try reduced audio first
        reduced_a = min(a_bps, max(min_a, int(total_bps_cap * 0.15)))
        if total_bps_cap > reduced_a + min_v:
            a_bps = reduced_a
        elif total_bps_cap > min_a + min_v:
            a_bps = min_a
        else:
            base["audio_bps"] = a_bps
            base["reason"] = (
                f"Video terlalu panjang untuk batas unggah akun "
                f"({budget} byte / {duration:.0f}s). Bahkan bitrate minimum "
                f"({min_v} bps video + audio) masih melebihi budget. "
                "Pecah video atau gunakan akun Premium."
            )
            return base

    video_bps = int(total_bps_cap - a_bps)
    if video_bps < min_v:
        base["audio_bps"] = a_bps
        base["reason"] = (
            f"Video terlalu panjang untuk batas unggah akun "
            f"({budget} byte / {duration:.0f}s → ~{max(0, video_bps)} bps video). "
            f"Minimum usable {min_v} bps. Pecah video atau gunakan akun Premium."
        )
        return base

    maxrate = int(video_bps * ENCODE_MAXRATE_RATIO)
    bufsize = int(video_bps * 2)
    # Conservative implied size (bits / 8) — should stay ≤ budget * safety ≤ budget
    target_bytes = int((video_bps + a_bps) * duration / 8.0)

    base.update(
        {
            "feasible": True,
            "audio_bps": a_bps,
            "video_bps": video_bps,
            "maxrate_bps": maxrate,
            "bufsize_bits": bufsize,
            "target_output_bytes": target_bytes,
            "reason": None,
        }
    )
    # Hard invariant: planned size must not exceed budget
    if target_bytes > budget:
        base["feasible"] = False
        base["reason"] = (
            f"Rencana encode ({target_bytes} byte) melebihi budget ({budget} byte)."
        )
    return base


def _fmt_encode_plan_error(plan: Dict[str, Any]) -> str:
    """Human-readable budget failure; always includes markers Studio can detect."""
    reason = plan.get("reason") or "tidak bisa muat di bawah batas akun"
    # Keep both "batas unggah" and "batas akun" so legacy substring guards match.
    return (
        f"Tidak dapat menyesuaikan video ke batas akun (batas unggah): {reason}"
    )


def _raise_budget_error(message: str) -> None:
    raise AccountBudgetError(message)


def _ffmpeg_exe() -> Optional[str]:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    from shutil import which
    return which("ffmpeg") or which("ffmpeg.exe")


def probe_with_ffmpeg(path: str) -> dict:
    """Return duration, width, height, video_codec, has_audio."""
    out = {
        "duration": 0.0,
        "width": 0,
        "height": 0,
        "video_codec": None,
        "audio_codec": None,
        "has_audio": False,
        "is_video": False,
        "is_audio": False,
    }
    exe = _ffmpeg_exe()
    if not exe or not path or not os.path.isfile(path):
        return out
    try:
        r = subprocess.run(
            [exe, "-hide_banner", "-i", path],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=90,
        )
        err = r.stderr or ""
    except Exception:
        return out

    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", err)
    if m:
        h, mi, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
        out["duration"] = h * 3600 + mi * 60 + s

    vm = re.search(
        r"Video:\s*([a-zA-Z0-9_-]+)(?:\s*\([^)]*\))?(?:\s*\([^)]*\))?\s*.*?(\d{2,5})x(\d{2,5})",
        err,
    )
    if not vm:
        # looser: Video: av1 (libaom-av1) (Main) (av01 / 0x...), yuv420p(...), 1440x2560
        vm = re.search(r"Video:\s*([a-zA-Z0-9_-]+).*?(\d{2,5})x(\d{2,5})", err)
    if vm:
        out["is_video"] = True
        out["video_codec"] = vm.group(1).lower()
        out["width"] = int(vm.group(2))
        out["height"] = int(vm.group(3))

    am = re.search(r"Audio:\s*([a-zA-Z0-9_]+)", err)
    if am:
        out["has_audio"] = True
        out["audio_codec"] = am.group(1).lower()
        if not out["is_video"]:
            out["is_audio"] = True

    return out


def needs_telegram_reencode(path: str) -> bool:
    """True if codec is unlikely to play in Telegram/Nagram native player."""
    ext = os.path.splitext(path)[1].lower()
    if ext not in {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"}:
        return False
    meta = probe_with_ffmpeg(path)
    codec = (meta.get("video_codec") or "").lower()
    if not codec:
        return True  # unknown — safer to remux/reencode for HQ
    if codec in TELEGRAM_BAD_VIDEO:
        return True
    # av01 tag sometimes appears as codec name
    if "av1" in codec or codec.startswith("vp"):
        return True
    if codec in TELEGRAM_OK_VIDEO or codec in {"h264", "hevc"}:
        return False
    # default: re-encode unknowns for HQ streaming
    return True


_ENCODER_CAPS: Optional[Dict[str, Dict[str, Any]]] = None
_ENCODER_CAPS_SIGNATURE: Optional[str] = None
_ENCODER_CAPS_CACHE = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "cache", "encoder_caps.json"
)


def _encoder_capability_signature(exe: str) -> str:
    """Stable cache key for the FFmpeg binary plus installed display drivers."""
    parts = [os.path.abspath(exe), platform.platform()]
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        result = subprocess.run(
            [exe, "-version"], capture_output=True, text=True, errors="replace",
            timeout=8, creationflags=creationflags,
        )
        parts.append((result.stdout or "").splitlines()[0][:300])
    except Exception:
        parts.append("ffmpeg-version-unknown")
    if os.name == "nt":
        try:
            result = subprocess.run(
                [
                    "powershell", "-NoProfile", "-NonInteractive", "-Command",
                    "Get-CimInstance Win32_VideoController | "
                    "Select-Object Name,DriverVersion | ConvertTo-Json -Compress",
                ],
                capture_output=True, text=True, errors="replace", timeout=10,
                creationflags=creationflags,
            )
            parts.append((result.stdout or "gpu-driver-unknown").strip()[:1000])
        except Exception:
            parts.append("gpu-driver-unknown")
    return hashlib.sha256("\n".join(parts).encode("utf-8", "replace")).hexdigest()


def _load_encoder_caps_cache(signature: str) -> Optional[Dict[str, Dict[str, Any]]]:
    try:
        with open(_ENCODER_CAPS_CACHE, "r", encoding="utf-8") as handle:
            raw = json.load(handle)
        if raw.get("signature") != signature or not isinstance(raw.get("caps"), dict):
            return None
        return {
            str(key): dict(value)
            for key, value in raw["caps"].items()
            if isinstance(value, dict)
        }
    except Exception:
        return None


def _save_encoder_caps_cache(signature: str, caps: Dict[str, Dict[str, Any]]) -> None:
    try:
        os.makedirs(os.path.dirname(_ENCODER_CAPS_CACHE), exist_ok=True)
        tmp = f"{_ENCODER_CAPS_CACHE}.tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump({"signature": signature, "caps": caps}, handle, ensure_ascii=True)
        os.replace(tmp, _ENCODER_CAPS_CACHE)
    except Exception:
        # A read-only cache directory must never disable encoding.
        pass


def probe_encoder_capabilities(force: bool = False) -> Dict[str, Dict[str, Any]]:
    """Probe actual encoder usability, not only names advertised by FFmpeg."""
    global _ENCODER_CAPS, _ENCODER_CAPS_SIGNATURE
    exe = _ffmpeg_exe()
    specs = {
        "nvidia": ("h264_nvenc", "cuda"),
        "amd": ("h264_amf", "d3d11va"),
        "intel": ("h264_qsv", "qsv"),
        "cpu": ("libx264", "software"),
    }
    caps: Dict[str, Dict[str, Any]] = {}
    if not exe:
        return caps
    signature = _encoder_capability_signature(exe)
    if _ENCODER_CAPS is not None and _ENCODER_CAPS_SIGNATURE == signature and not force:
        return {key: dict(value) for key, value in _ENCODER_CAPS.items()}
    if not force:
        cached = _load_encoder_caps_cache(signature)
        if cached:
            _ENCODER_CAPS = cached
            _ENCODER_CAPS_SIGNATURE = signature
            return {key: dict(value) for key, value in cached.items()}
    try:
        encoders = subprocess.run(
            [exe, "-hide_banner", "-encoders"], capture_output=True, text=True,
            errors="replace", timeout=20,
        ).stdout
    except Exception:
        encoders = ""
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    for backend, (encoder, decoder) in specs.items():
        advertised = encoder in encoders
        usable = False
        error = "encoder not bundled"
        if advertised:
            try:
                result = subprocess.run(
                    [
                        exe, "-hide_banner", "-loglevel", "error",
                        "-f", "lavfi", "-i", "color=c=black:s=320x180:r=24:d=0.18",
                        "-frames:v", "3", "-an", "-c:v", encoder,
                        "-f", "null", "-",
                    ],
                    capture_output=True, text=True, errors="replace", timeout=15,
                    creationflags=creationflags,
                )
                usable = result.returncode == 0
                error = "" if usable else (result.stderr or "probe failed")[-240:]
            except Exception as exc:
                error = str(exc)[-240:]
        caps[backend] = {
            "backend": backend,
            "encoder": encoder,
            "decoder": decoder,
            "advertised": advertised,
            "usable": usable,
            "error": error,
        }
    _ENCODER_CAPS = caps
    _ENCODER_CAPS_SIGNATURE = signature
    _save_encoder_caps_cache(signature, caps)
    return {key: dict(value) for key, value in caps.items()}


def _encoder_attempts(meta: Dict[str, Any], requested: str, preset_name: str, crf: int):
    caps = probe_encoder_capabilities()
    preset_name = preset_name if preset_name in {"speed", "balanced", "quality"} else "balanced"
    presets = {
        "speed": {"nvenc": "p1", "amf": "speed", "qsv": "fast", "x264": "superfast"},
        "balanced": {"nvenc": "p4", "amf": "balanced", "qsv": "medium", "x264": "veryfast"},
        "quality": {"nvenc": "p6", "amf": "quality", "qsv": "slow", "x264": "slow"},
    }[preset_name]
    encode_args = {
        "nvidia": ["-c:v", "h264_nvenc", "-preset", presets["nvenc"], "-tune", "hq", "-rc", "vbr", "-cq", str(crf), "-b:v", "0"],
        "amd": ["-c:v", "h264_amf", "-quality", presets["amf"], "-rc", "cqp", "-qp_i", str(crf), "-qp_p", str(crf)],
        "intel": ["-c:v", "h264_qsv", "-preset", presets["qsv"], "-global_quality", str(crf)],
        "cpu": ["-c:v", "libx264", "-preset", presets["x264"], "-crf", str(crf)],
    }
    order = [requested] if requested in encode_args else ["nvidia", "amd", "intel", "cpu"]
    if requested in encode_args and requested != "cpu":
        order.append("cpu")
    codec = str(meta.get("video_codec") or "").lower()
    nvdec_codecs = {"h264", "hevc", "h265", "av1", "vp8", "vp9", "mpeg2video", "mpeg4", "vc1"}
    attempts = []
    for backend in order:
        if not caps.get(backend, {}).get("usable"):
            continue
        hw_input: List[str] = []
        decoder = "software"
        if backend == "nvidia" and codec in nvdec_codecs:
            hw_input = ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"]
            decoder = "CUDA/NVDEC"
        elif backend == "amd":
            hw_input = ["-hwaccel", "d3d11va", "-hwaccel_output_format", "d3d11"]
            decoder = "D3D11VA"
        elif backend == "intel":
            hw_input = ["-hwaccel", "qsv", "-hwaccel_output_format", "qsv"]
            decoder = "Intel QSV"
        if hw_input:
            attempts.append((backend, decoder, hw_input, encode_args[backend], True))
        attempts.append((backend, "Software Decode", [], encode_args[backend], False))
    return attempts


def _enc_args_for_budget(backend: str, enc_args: List[str], plan: Dict[str, Any]) -> List[str]:
    """
    Rewrite encoder args for a single size-constrained pass.
    Removes CQ/CRF-only unconstrained modes that ignore -b:v / -maxrate.
    """
    video_bps = int(plan["video_bps"])
    maxrate = int(plan["maxrate_bps"])
    bufsize = int(plan["bufsize_bits"])
    codec = list(enc_args[:2]) if len(enc_args) >= 2 else ["-c:v", "libx264"]
    # Keep preset/quality tuning flags that do not fight bitrate mode.
    keep: List[str] = []
    skip_next = False
    drop_keys = {
        "-cq", "-b:v", "-maxrate", "-bufsize", "-crf", "-global_quality",
        "-qp_i", "-qp_p", "-rc",
    }
    i = 2
    while i < len(enc_args):
        tok = enc_args[i]
        if skip_next:
            skip_next = False
            i += 1
            continue
        if tok in drop_keys:
            skip_next = True
            i += 1
            continue
        if tok in {"-preset", "-tune", "-quality"}:
            keep.extend(enc_args[i : i + 2])
            i += 2
            continue
        keep.append(tok)
        i += 1

    rate = ["-b:v", str(video_bps), "-maxrate", str(maxrate), "-bufsize", str(bufsize)]
    if backend == "nvidia":
        return codec + keep + ["-rc", "vbr"] + rate
    if backend == "amd":
        return codec + keep + ["-rc", "vbr_latency"] + rate
    if backend == "intel":
        return codec + keep + rate
    # libx264: ABR + maxrate cap
    return codec + keep + rate


def reencode_for_telegram(path: str, *, crf: int = 20, progress_cb=None, duration: float = 0.0, reencode_hw: str = "auto", reencode_preset: str = "balanced", max_output_bytes: int = 0) -> Tuple[str, Dict[str, Any]]:
    """
    Re-encode to H.264 + AAC MP4 with +faststart for Telegram streaming.
    When max_output_bytes > 0, plans bitrate once via plan_encode_budget and
    applies those constraints for the entire encode (single size-fit pass).
    Returns path to temp mp4 (caller may delete).
    """
    exe = _ffmpeg_exe()
    if not exe:
        raise RuntimeError("ffmpeg not available (pip install imageio-ffmpeg)")

    os.makedirs(TEMP_DIR, exist_ok=True)
    base = os.path.splitext(os.path.basename(path))[0][:80]
    out_path = os.path.join(TEMP_DIR, f"tg_{int(time.time())}_{base}.mp4")

    meta = probe_with_ffmpeg(path)
    dur = float(duration or 0.0) or float(meta.get("duration") or 0.0)

    # Size-fit: plan once before any encoder work. Fail early if impossible.
    encode_plan: Optional[Dict[str, Any]] = None
    if int(max_output_bytes or 0) > 0:
        encode_plan = plan_encode_budget(int(max_output_bytes), dur)
        if not encode_plan.get("feasible"):
            raise AccountBudgetError(_fmt_encode_plan_error(encode_plan))

    attempts = _encoder_attempts(meta, str(reencode_hw or "auto").lower(), reencode_preset, crf)
    if not attempts:
        raise RuntimeError("No usable FFmpeg H.264 encoder found")
    last_err = ""
    fallback_reason = ""
    for backend, decoder, input_args, enc_args, hardware_decode in attempts:
        encoder_name = enc_args[1]
        started_at = time.time()
        if progress_cb:
            progress_cb({
                "event": "started", "backend": backend, "encoder": encoder_name,
                "decoder": decoder, "preset": reencode_preset,
                "duration_s": dur, "input_bytes": os.path.getsize(path),
                "fallback_reason": fallback_reason,
                "planned_video_bps": (encode_plan or {}).get("video_bps"),
                "planned_target_bytes": (encode_plan or {}).get("target_output_bytes"),
                "budget_bytes": int(max_output_bytes or 0) or None,
            })
        audio_bps = int((encode_plan or {}).get("audio_bps") or ENCODE_AUDIO_BPS)
        audio_k = max(32, int(round(audio_bps / 1000.0))) if audio_bps > 0 else 192
        use_enc = (
            _enc_args_for_budget(backend, list(enc_args), encode_plan)
            if encode_plan and encode_plan.get("feasible")
            else list(enc_args)
        )
        cmd = [
            exe, "-y", "-hide_banner", "-nostats", "-stats_period", "0.25",
            *input_args, "-i", path,
            *use_enc,
            "-c:a", "aac",
            "-b:a", f"{audio_k}k",
            "-ac", "2",
            "-movflags", "+faststart",
            "-metadata", "handler_name=",
            "-progress", "pipe:1",
            out_path,
        ]

        if not hardware_decode:
            insert_at = cmd.index("-c:a")
            cmd[insert_at:insert_at] = ["-pix_fmt", "yuv420p"]

        def _run_ffmpeg(cmd_list):
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            with tempfile.TemporaryFile() as err_file:
                p = subprocess.Popen(
                    cmd_list, stdout=subprocess.PIPE, stderr=err_file,
                    text=True, encoding="utf-8", errors="replace",
                    creationflags=creationflags,
                )
                values: Dict[str, str] = {}
                ewma_rate = 0.0
                assert p.stdout is not None
                for raw in p.stdout:
                    line = raw.strip()
                    if "=" not in line:
                        continue
                    key, value = line.split("=", 1)
                    values[key] = value
                    if key != "progress":
                        continue
                    out_time = float(values.get("out_time_us", "0") or 0) / 1_000_000.0
                    total_size = int(float(values.get("total_size", "0") or 0))
                    rate = total_size / out_time if out_time > 0 and total_size > 0 else 0.0
                    if rate > 0:
                        ewma_rate = rate if ewma_rate <= 0 else ewma_rate * 0.72 + rate * 0.28
                    raw_est = int(ewma_rate * dur) if dur > 0 and out_time >= 3 else 0
                    # Account-budget plan: never advertise multi-GB overshoot (free ≤~2GiB).
                    # Early progress uses planned target; later clamp EWMA to budget ceiling.
                    budget_cap = int(max_output_bytes or 0)
                    planned = int((encode_plan or {}).get("target_output_bytes") or 0)
                    if encode_plan and (planned > 0 or budget_cap > 0):
                        ceiling = budget_cap if budget_cap > 0 else planned
                        if raw_est <= 0 or out_time < 3:
                            estimated = planned if planned > 0 else min(ceiling, max(total_size, 1))
                        else:
                            estimated = min(raw_est, ceiling)
                        # Written bytes may briefly lead estimate; still never exceed ceiling
                        estimated = max(estimated, min(total_size, ceiling)) if total_size else estimated
                        if ceiling > 0:
                            estimated = min(estimated, ceiling)
                    else:
                        estimated = raw_est
                    speed_raw = values.get("speed", "0x").rstrip("x")
                    try:
                        speed_x = float(speed_raw)
                    except Exception:
                        speed_x = 0.0
                    percent = min(100.0, out_time / dur * 100.0) if dur > 0 else 0.0
                    eta = max(0.0, (dur - out_time) / speed_x) if speed_x > 0 and dur > 0 else None
                    if progress_cb:
                        progress_cb({
                            "event": "progress", "backend": backend, "encoder": encoder_name,
                            "decoder": decoder, "percent": percent, "media_time_s": out_time,
                            "frame": int(float(values.get("frame", "0") or 0)),
                            "fps": float(values.get("fps", "0") or 0), "speed_x": speed_x,
                            "current_output_bytes": total_size,
                            "estimated_output_bytes": estimated,
                            "elapsed_s": time.time() - started_at, "eta_s": eta,
                        })
                    values = {}
                rc = p.wait()
                err_file.seek(0)
                err_out = err_file.read().decode("utf-8", "replace")[-1200:]
                return rc, err_out

        try:
            rc, err_out = _run_ffmpeg(cmd)
            if rc == 0 and os.path.isfile(out_path) and os.path.getsize(out_path) >= 1000:
                output_bytes = os.path.getsize(out_path)
                info = {
                    "backend": backend, "encoder": encoder_name, "decoder": decoder,
                    "preset": reencode_preset, "output_bytes": output_bytes,
                    "elapsed_s": round(time.time() - started_at, 3),
                    "fallback_reason": fallback_reason,
                    "encode_plan": encode_plan,
                    "single_pass": True,
                }
                if progress_cb:
                    progress_cb({"event": "done", **{k: v for k, v in info.items() if k != "encode_plan"}})
                return out_path, info
            last_err = (err_out or "")[-500:]
            fallback_reason = f"{backend}/{decoder} failed: {last_err[-180:]}"
        except Exception as exc:
            last_err = str(exc)[-500:]
            fallback_reason = f"{backend}/{decoder} failed: {last_err[-180:]}"
        try:
            if os.path.exists(out_path):
                os.remove(out_path)
        except Exception:
            pass

    raise RuntimeError(f"ffmpeg reencode failed on all encoders. Last err: {last_err}")


def prepare_video_for_hq(
    path: str,
    progress_cb=None,
    reencode_hw: str = "auto",
    reencode_preset: str = "balanced",
    max_output_bytes: int = 0,
    force_fit_budget: bool = False,
) -> Tuple[str, dict]:
    """
    Ensure path is Telegram-playable for HQ mode and (optionally) under account
    upload budget.

    Size control is **single-pass**: plan bitrate once (plan_encode_budget), encode
    once. No full "re-encode ulang" recovery when the first pass exceeds budget —
    that path wasted GPU/CPU for hours. Residual overshoot → fail-clean.

    max_output_bytes: account safe ceiling (free ~2 GiB / Premium ~4 GiB from
      UploadPolicy.safe_max_bytes). Applied on **every** HQ re-encode — including
      codec-only remux when the source is still under the limit — so unconstrained
      CRF cannot produce a 4 GB free-tier file. 0 → free-tier safe default.
    force_fit_budget: if True and source is over budget, always re-encode to fit
      even when codec is already Telegram-native.
    Returns (path_to_send, info_dict with reencoded flag + meta).
    """
    meta = probe_with_ffmpeg(path)
    info = {
        "source": path,
        "reencoded": False,
        "meta": meta,
        "reason": None,
        "budget_bytes": int(max_output_bytes or 0) or None,
    }
    src_size = os.path.getsize(path) if path and os.path.isfile(path) else 0
    budget = int(max_output_bytes or 0)
    if budget <= 0:
        budget = TELEGRAM_SAFE_OUTPUT_BYTES
    oversize = src_size > budget
    need_codec = needs_telegram_reencode(path)
    must_fit = bool(oversize or force_fit_budget)
    if need_codec or must_fit:
        info["reason"] = (
            f"source exceeds account upload budget ({src_size} > {budget})"
            if oversize
            else f"codec={meta.get('video_codec') or 'unknown'} not Telegram-native"
        )
        dur = float(meta.get("duration") or 0.0)
        # Tier ceiling always applies when we re-encode (codec-only OR oversize).
        # Highest feasible quality under budget via plan_encode_budget bitrate.
        encode_budget = budget

        plan = plan_encode_budget(encode_budget, dur)
        info["encode_plan"] = plan
        if not plan.get("feasible"):
            raise AccountBudgetError(_fmt_encode_plan_error(plan))

        out, encode_info = reencode_for_telegram(
            path, progress_cb=progress_cb, duration=dur,
            reencode_hw=reencode_hw, reencode_preset=reencode_preset,
            max_output_bytes=encode_budget,
        )
        out_size = os.path.getsize(out) if out and os.path.isfile(out) else 0
        # Single-pass only: residual encoder overshoot → fail-clean (no full re-encode).
        if encode_budget > 0 and out_size > budget:
            try:
                if out and os.path.isfile(out) and out != path:
                    os.remove(out)
            except Exception:
                pass
            raise AccountBudgetError(
                f"Hasil encode masih di atas batas akun ({out_size} > {budget} byte) "
                "setelah satu pass terencana. "
                "Pecah video atau gunakan akun Premium."
            )
        info["reencoded"] = True
        info["meta"] = probe_with_ffmpeg(out)
        info["output"] = out
        info["encode"] = encode_info
        info["output_bytes"] = out_size
        info["single_pass"] = True
        return out, info
    return path, info


def build_send_attributes(
    path: str,
    *,
    force_document: bool = False,
    supports_streaming: bool = True,
    file_name: Optional[str] = None,
) -> Tuple[List[Any], Optional[str]]:
    """
    Returns (attributes, mime_type) for client.send_file.
    Critical for video: real duration + width/height + supports_streaming.
    """
    name = file_name or os.path.basename(path) or "file"
    ext = os.path.splitext(name)[1].lower()
    attrs: List[Any] = [DocumentAttributeFilename(file_name=name)]
    mime = None

    video_exts = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"}
    audio_exts = {".mp3", ".m4a", ".aac", ".flac", ".ogg", ".wav"}
    photo_exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

    if ext in photo_exts and not force_document:
        return [], None

    meta = probe_with_ffmpeg(path) if ext in video_exts or ext in audio_exts else {}

    if (ext in video_exts or meta.get("is_video")) and not force_document:
        dur = int(round(meta.get("duration") or 0))
        w = int(meta.get("width") or 0)
        h = int(meta.get("height") or 0)
        if w < 2:
            w = 720
        if h < 2:
            h = 1280
        if dur < 1:
            dur = 1
        attrs.append(
            DocumentAttributeVideo(
                duration=dur,
                w=w,
                h=h,
                supports_streaming=bool(supports_streaming),
                round_message=False,
            )
        )
        mime = "video/mp4"
        return attrs, mime

    if (ext in audio_exts or meta.get("is_audio")) and not force_document:
        dur = int(round(meta.get("duration") or 0)) or 1
        attrs.append(
            DocumentAttributeAudio(
                duration=dur,
                voice=False,
                title=os.path.splitext(name)[0][:64],
            )
        )
        return attrs, mime

    return attrs, mime
