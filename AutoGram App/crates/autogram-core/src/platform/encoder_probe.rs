//! Hardware encoding requires an actual frame, not availability of a decoder API.
use super::{encoder_provider::HardwareCapability, find_ffmpeg_binary, media_process::run_media_command};
use std::{path::Path, process::Command, time::Duration};

fn registered(text: &str, codec: &str) -> bool {
    text.lines().any(|line| line.split_whitespace().nth(1) == Some(codec))
}

fn smoke(tool: &Path, codec: &str) -> bool {
    let mut command = Command::new(tool);
    command.args(["-hide_banner", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i",
        "color=c=black:s=64x64:r=1", "-frames:v", "1", "-c:v", codec, "-f", "null", "-"]);
    run_media_command(command, Duration::from_secs(10)).is_ok_and(|result| result.status.success())
}

pub fn verified_encoder_capability() -> HardwareCapability {
    let mut capability = HardwareCapability { has_nvenc: false, has_amf: false, has_qsv: false,
        has_mediacodec: false, has_x264: false, primary_encoder: String::new() };
    let Some(tool) = find_ffmpeg_binary() else { return capability; };
    let mut command = Command::new(&tool);
    command.args(["-hide_banner", "-encoders"]);
    let Ok(output) = run_media_command(command, Duration::from_secs(10)) else { return capability; };
    if !output.status.success() { return capability; }
    let text = String::from_utf8_lossy(&output.stdout);
    for (codec, present) in [("h264_nvenc", &mut capability.has_nvenc),
        ("h264_amf", &mut capability.has_amf), ("h264_qsv", &mut capability.has_qsv),
        ("h264_mediacodec", &mut capability.has_mediacodec), ("libx264", &mut capability.has_x264)] {
        *present = registered(&text, codec) && smoke(&tool, codec);
        if *present && capability.primary_encoder.is_empty() { capability.primary_encoder = codec.into(); }
    }
    capability
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decoder_acceleration_and_substrings_cannot_advertise_encoders() {
        assert!(!registered("dxva2\nd3d11va\ncuda\n", "h264_nvenc"));
        assert!(!registered(" V....D h264_nvenc_other NVIDIA encoder", "h264_nvenc"));
        assert!(registered(" V....D h264_nvenc NVIDIA encoder", "h264_nvenc"));
        assert!(!smoke(Path::new("autogram-missing-ffmpeg"), "h264_nvenc"));
    }
}
