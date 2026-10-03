//! Transcoding Worker Engine with Encoder Quality Profiles & OutputContract Validation

use crate::platform::EncoderQualityProfile;
use crate::platform::{find_ffmpeg_binary, media_process::run_media_command};
pub use super::output_contract::{validate_output_contract, OutputContract};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncoderDecisionReceipt {
    pub input_path: PathBuf,
    pub output_path: PathBuf,
    pub selected_encoder: String,
    pub profile_used: String,
    pub target_bitrate: u32,
    pub fallback_occurred: bool,
    pub validation_passed: bool,
    pub error_reason: Option<String>,
}

pub fn transcode_with_profile(
    input_path: &Path,
    output_path: &Path,
    profile: &EncoderQualityProfile,
    encoder_codec: &str,
) -> Result<EncoderDecisionReceipt, String> {
    if !input_path.is_file() {
        return Err(format!(
            "Input path does not exist: {}",
            input_path.display()
        ));
    }

    let (bitrate, preset) = match profile {
        EncoderQualityProfile::HighQuality { bitrate, preset } => (*bitrate, preset.as_str()),
        EncoderQualityProfile::Balanced { bitrate, preset } => (*bitrate, preset.as_str()),
        EncoderQualityProfile::HighSpeed { bitrate, preset } => (*bitrate, preset.as_str()),
    };

    let codec = if encoder_codec.is_empty() {
        "libx264"
    } else {
        encoder_codec
    };
    if bitrate == 0 { return Err("invalid_encoder_bitrate".into()); }
    match std::fs::symlink_metadata(output_path) {
        Ok(_) => return Err("media_destination_exists".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
        Err(_) => return Err("media_destination_unavailable".into()),
    }
    let binary = find_ffmpeg_binary().ok_or("encoder_binary_unavailable")?;
    let mut cmd = Command::new(binary);
    cmd.args(["-hide_banner", "-nostdin", "-loglevel", "error", "-n"])
        .arg("-i")
        .arg(input_path)
        .arg("-c:v")
        .arg(codec)
        .arg("-b:v")
        .arg(format!("{bitrate}"));
    // AMF/QSV/MediaCodec do not accept x264 presets. Keep provider-specific options explicit.
    if matches!(codec, "libx264" | "libx265" | "h264_nvenc" | "hevc_nvenc") {
        cmd.arg("-preset").arg(preset);
    }
    cmd.arg("-c:a")
        .arg("copy")
        .arg(output_path);

    let mut receipt = EncoderDecisionReceipt {
        input_path: input_path.to_path_buf(),
        output_path: output_path.to_path_buf(),
        selected_encoder: codec.to_string(),
        profile_used: format!("{profile:?}"),
        target_bitrate: bitrate,
        fallback_occurred: false,
        validation_passed: false,
        error_reason: None,
    };

    let output = run_media_command(cmd, Duration::from_secs(300))?;
    if !output.status.success() { return Err("media_encoding_failed".into()); }
    validate_output_contract(output_path, &OutputContract::default())?;
    receipt.validation_passed = true;
    Ok(receipt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;

    #[test]
    fn test_transcode_missing_input_returns_err() {
        let input = Path::new("non_existent_input_file.mp4");
        let output = Path::new("output.mp4");
        let profile = EncoderQualityProfile::default();
        let res = transcode_with_profile(input, output, &profile, "libx264");
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Input path does not exist"));
    }

    #[test]
    fn test_validate_output_contract_zero_bytes_fails() {
        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join(format!("autogram-zero-byte-{}.mp4", rand::random::<u64>()));
        let _ = File::create(&temp_file);

        let contract = OutputContract::default();
        let res = validate_output_contract(&temp_file, &contract);
        let _ = std::fs::remove_file(&temp_file);

        assert!(res.is_err());
        assert!(res.unwrap_err().contains("0 bytes"));
    }

    #[test]
    fn test_validate_output_contract_non_existent_fails() {
        let file = Path::new("non_existent_validation_target.mp4");
        let contract = OutputContract::default();
        let res = validate_output_contract(file, &contract);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("does not exist"));
    }
}
