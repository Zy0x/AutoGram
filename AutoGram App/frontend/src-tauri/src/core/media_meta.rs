//! media_meta.rs — Media Attributes & Encode Budget Planner (Rust)
//!
//! Port of Python `media_meta.py`:
//! Validates Telegram supported video codecs (H.264, HEVC) and plans single-pass
//! encode parameters to guarantee media stays strictly within account upload limits.

use serde::{Deserialize, Serialize};

pub const TELEGRAM_SAFE_OUTPUT_BYTES: u64 = 1900 * 1024 * 1024; // 1.90 GiB
pub const ENCODE_AUDIO_BPS: u64 = 192_000;
pub const ENCODE_MIN_AUDIO_BPS: u64 = 64_000;
pub const ENCODE_SAFETY_FACTOR: f64 = 0.88;
pub const ENCODE_MIN_USABLE_VIDEO_BPS: u64 = 200_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodeBudgetPlan {
    pub feasible: bool,
    pub budget_bytes: u64,
    pub duration_s: f64,
    pub audio_bps: u64,
    pub video_bps: u64,
    pub maxrate_bps: u64,
    pub bufsize_bits: u64,
    pub target_output_bytes: u64,
    pub safety_factor: f64,
    pub reason: String,
}

/// Is codec native Telegram streaming friendly (H.264, HEVC)?
pub fn is_telegram_friendly_codec(codec: &str) -> bool {
    let low = codec.to_lowercase();
    matches!(
        low.as_str(),
        "h264" | "avc" | "avc1" | "x264" | "libx264" | "hevc" | "h265" | "hev1" | "hvc1"
    )
}

/// Pure planner mapping account upload budget + video duration to one-shot encode params.
pub fn plan_encode_budget(
    budget_bytes: u64,
    duration_s: f64,
    audio_bps: Option<u64>,
    safety_factor: Option<f64>,
    min_video_bps: Option<u64>,
    min_audio_bps: Option<u64>,
) -> EncodeBudgetPlan {
    let s_factor = safety_factor.unwrap_or(ENCODE_SAFETY_FACTOR).clamp(0.50, 0.98);
    let a_bps = audio_bps.unwrap_or(ENCODE_AUDIO_BPS);
    let min_a_bps = min_audio_bps.unwrap_or(ENCODE_MIN_AUDIO_BPS);
    let min_v_bps = min_video_bps.unwrap_or(ENCODE_MIN_USABLE_VIDEO_BPS);

    if duration_s <= 0.0 {
        return EncodeBudgetPlan {
            feasible: false,
            budget_bytes,
            duration_s,
            audio_bps: a_bps,
            video_bps: 0,
            maxrate_bps: 0,
            bufsize_bits: 0,
            target_output_bytes: 0,
            safety_factor: s_factor,
            reason: "Invalid video duration".into(),
        };
    }

    let target_bytes = (budget_bytes as f64 * s_factor) as u64;
    let total_bits = target_bytes * 8;
    let total_bps = (total_bits as f64 / duration_s) as u64;

    let effective_audio_bps = if total_bps > a_bps + min_v_bps {
        a_bps
    } else if total_bps > min_a_bps + min_v_bps {
        min_a_bps
    } else {
        min_a_bps
    };

    if total_bps <= effective_audio_bps + min_v_bps {
        return EncodeBudgetPlan {
            feasible: false,
            budget_bytes,
            duration_s,
            audio_bps: effective_audio_bps,
            video_bps: 0,
            maxrate_bps: 0,
            bufsize_bits: 0,
            target_output_bytes: target_bytes,
            safety_factor: s_factor,
            reason: format!(
                "Video duration ({duration_s:.1}s) is too long for account upload budget ({budget_bytes} bytes)"
            ),
        };
    }

    let video_bps = total_bps - effective_audio_bps;
    let maxrate_bps = (video_bps as f64 * 1.05) as u64;
    let bufsize_bits = video_bps * 2;

    EncodeBudgetPlan {
        feasible: true,
        budget_bytes,
        duration_s,
        audio_bps: effective_audio_bps,
        video_bps,
        maxrate_bps,
        bufsize_bits,
        target_output_bytes: target_bytes,
        safety_factor: s_factor,
        reason: "Feasible".into(),
    }
}
