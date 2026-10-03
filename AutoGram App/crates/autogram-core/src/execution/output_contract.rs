//! Confirm media identity from actual output, not its filename or nonzero length.
use crate::platform::{find_ffprobe_binary, media_process::run_media_command};
use serde::{Deserialize, Serialize};
use std::{path::Path, process::Command, time::Duration};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputContract {
    pub expected_container: String,
    pub min_duration_secs: f64,
    pub max_size_bytes: u64,
    pub require_audio_stream: bool,
    pub require_video_stream: bool,
}

impl Default for OutputContract {
    fn default() -> Self {
        Self { expected_container: "mp4".into(), min_duration_secs: 0.1,
            max_size_bytes: 4_294_967_296, require_audio_stream: false, require_video_stream: true }
    }
}

#[derive(Deserialize)]
struct Probe {
    #[serde(default)]
    streams: Vec<Stream>,
    format: Option<Format>,
}
#[derive(Deserialize)]
struct Stream { codec_type: Option<String> }
#[derive(Deserialize)]
struct Format { format_name: Option<String>, duration: Option<String> }

fn validate_probe(bytes: &[u8], contract: &OutputContract) -> Result<(), String> {
    if !contract.min_duration_secs.is_finite() || contract.min_duration_secs < 0.0 {
        return Err("invalid_output_contract".into());
    }
    let probe: Probe = serde_json::from_slice(bytes).map_err(|_| "output_probe_invalid")?;
    let format = probe.format.ok_or("output_format_missing")?;
    let formats = format.format_name.as_deref().ok_or("output_format_missing")?;
    let expected = contract.expected_container.trim().to_ascii_lowercase();
    if expected.is_empty() || !formats.split(',').any(|actual| actual == expected) {
        return Err("output_container_mismatch".into());
    }
    let duration: f64 = format.duration.as_deref().and_then(|value| value.parse().ok())
        .ok_or("output_duration_missing")?;
    if !duration.is_finite() || duration < contract.min_duration_secs {
        return Err("output_duration_mismatch".into());
    }
    for (required, kind) in [(contract.require_video_stream, "video"), (contract.require_audio_stream, "audio")] {
        if required && !probe.streams.iter().any(|stream| stream.codec_type.as_deref() == Some(kind)) {
            return Err(format!("output_{kind}_missing"));
        }
    }
    Ok(())
}

pub fn validate_output_contract(path: &Path, contract: &OutputContract) -> Result<(), String> {
    let metadata = std::fs::metadata(path).map_err(|_| "Validation FAIL: Output file does not exist")?;
    if !metadata.is_file() { return Err("output_not_regular_file".into()); }
    if metadata.len() == 0 { return Err("Validation FAIL: Output file is 0 bytes".into()); }
    if metadata.len() > contract.max_size_bytes { return Err("output_size_exceeded".into()); }
    let tool = find_ffprobe_binary().ok_or("output_probe_unavailable")?;
    let mut command = Command::new(tool);
    command.args(["-v", "error", "-show_entries", "format=format_name,duration:stream=codec_type", "-of", "json"]).arg(path);
    let output = run_media_command(command, Duration::from_secs(15))?;
    if !output.status.success() { return Err("output_probe_failed".into()); }
    validate_probe(&output.stdout, contract)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample(format: &str, duration: &str, streams: &[&str]) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"format":{"format_name":format,"duration":duration},
            "streams":streams.iter().map(|kind| serde_json::json!({"codec_type":kind})).collect::<Vec<_>>() })).unwrap()
    }
    #[test]
    fn validates_container_duration_and_both_stream_requirements() {
        let contract = OutputContract { require_audio_stream: true, ..Default::default() };
        assert!(validate_probe(&sample("mov,mp4,m4a,3gp,3g2,mj2", "1.0", &["video", "audio"]), &contract).is_ok());
        for bytes in [sample("matroska,webm", "1.0", &["video", "audio"]),
            sample("mp4", "0.01", &["video", "audio"]), sample("mp4", "NaN", &["video", "audio"]),
            sample("mp4", "1.0", &["video"]), sample("mp4", "1.0", &["audio"])] {
            assert!(validate_probe(&bytes, &contract).is_err());
        }
        assert!(validate_probe(b"not metadata", &contract).is_err());
        let invalid = OutputContract { min_duration_secs: f64::NAN, ..Default::default() };
        assert!(validate_probe(&sample("mp4", "1.0", &["video"]), &invalid).is_err());
    }
}
