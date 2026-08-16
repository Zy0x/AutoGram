//! Transcoding Worker Engine with Encoder Quality Profiles & OutputContract Validation

use crate::platform::EncoderQualityProfile;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

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
        OutputContract {
            expected_container: "mp4".to_string(),
            min_duration_secs: 0.1,
            max_size_bytes: 4_294_967_296, // 4GB
            require_audio_stream: false,
            require_video_stream: true,
        }
    }
}

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

pub fn validate_output_contract(
    output_path: &Path,
    contract: &OutputContract,
) -> Result<(), String> {
    if !output_path.exists() {
        return Err(format!("Validation FAIL: Output file does not exist at {}", output_path.display()));
    }

    let metadata = std::fs::metadata(output_path)
        .map_err(|e| format!("Validation FAIL: Cannot read output metadata: {e}"))?;

    if metadata.len() == 0 {
        return Err(format!("Validation FAIL: Output file is 0 bytes (empty output drop)"));
    }

    if metadata.len() > contract.max_size_bytes {
        return Err(format!(
            "Validation FAIL: Output size {} exceeds contract max size {}",
            metadata.len(), contract.max_size_bytes
        ));
    }

    Ok(())
}

pub fn transcode_with_profile(
    input_path: &Path,
    output_path: &Path,
    profile: &EncoderQualityProfile,
    encoder_codec: &str,
) -> Result<EncoderDecisionReceipt, String> {
    if !input_path.exists() {
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

    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-y")
        .arg("-i")
        .arg(input_path)
        .arg("-c:v")
        .arg(codec)
        .arg("-b:v")
        .arg(format!("{bitrate}"))
        .arg("-preset")
        .arg(preset)
        .arg("-c:a")
        .arg("copy")
        .arg(output_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

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

    match cmd.spawn() {
        Ok(mut child) => {
            let timeout = Duration::from_secs(300);
            let t0 = std::time::Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        if status.success() {
                            let contract = OutputContract::default();
                            match validate_output_contract(output_path, &contract) {
                                Ok(()) => {
                                    receipt.validation_passed = true;
                                    return Ok(receipt);
                                }
                                Err(val_err) => {
                                    receipt.validation_passed = false;
                                    receipt.error_reason = Some(val_err.clone());
                                    return Err(val_err);
                                }
                            }
                        } else {
                            let err_msg = format!("FFmpeg process exited with code {}", status);
                            receipt.error_reason = Some(err_msg.clone());
                            return Err(err_msg);
                        }
                    }
                    Ok(None) => {
                        if t0.elapsed() > timeout {
                            let _ = child.kill();
                            let err_msg = "FFmpeg transcoding timed out after 300 seconds".to_string();
                            receipt.error_reason = Some(err_msg.clone());
                            return Err(err_msg);
                        }
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    Err(e) => {
                        let err_msg = format!("Error waiting on FFmpeg child process: {e}");
                        receipt.error_reason = Some(err_msg.clone());
                        return Err(err_msg);
                    }
                }
            }
        }
        Err(e) => {
            let err_msg = format!("Failed to spawn FFmpeg binary: {e}");
            receipt.error_reason = Some(err_msg.clone());
            Err(err_msg)
        }
    }
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
        let temp_file = temp_dir.join("autogram_test_zero_byte.mp4");
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

