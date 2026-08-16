//! Hardware & Encoder Abstraction Layer (PAL - EncoderProvider)

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EncoderQualityProfile {
    HighQuality { bitrate: u32, preset: String },
    Balanced { bitrate: u32, preset: String },
    HighSpeed { bitrate: u32, preset: String },
}

impl Default for EncoderQualityProfile {
    fn default() -> Self {
        EncoderQualityProfile::Balanced {
            bitrate: 4_000_000,
            preset: "medium".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareCapability {
    pub has_nvenc: bool,
    pub has_amf: bool,
    pub has_qsv: bool,
    pub has_mediacodec: bool,
    pub has_x264: bool,
    pub primary_encoder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EncoderError {
    BinaryNotFound(String),
    EncodingFailed(String),
    UnsupportedFormat(String),
}

impl std::fmt::Display for EncoderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EncoderError::BinaryNotFound(s) => write!(f, "BinaryNotFound: {s}"),
            EncoderError::EncodingFailed(s) => write!(f, "EncodingFailed: {s}"),
            EncoderError::UnsupportedFormat(s) => write!(f, "UnsupportedFormat: {s}"),
        }
    }
}

impl std::error::Error for EncoderError {}

pub trait EncoderProvider: Send + Sync {
    fn detect_capability(&self) -> HardwareCapability;
    fn encode(
        &self,
        input: &Path,
        output: &Path,
        profile: &EncoderQualityProfile,
    ) -> Result<(), EncoderError>;
    fn estimate_output_size(
        &self,
        input_size: u64,
        duration_secs: f64,
        profile: &EncoderQualityProfile,
    ) -> Result<u64, EncoderError>;
}

pub struct DesktopEncoderProvider;

impl DesktopEncoderProvider {
    pub fn new() -> Self {
        Self
    }
}

impl EncoderProvider for DesktopEncoderProvider {
    fn detect_capability(&self) -> HardwareCapability {
        HardwareCapability {
            has_nvenc: true,
            has_amf: false,
            has_qsv: false,
            has_mediacodec: false,
            has_x264: true,
            primary_encoder: "h264_nvenc".to_string(),
        }
    }

    fn encode(
        &self,
        input: &Path,
        output: &Path,
        _profile: &EncoderQualityProfile,
    ) -> Result<(), EncoderError> {
        if !input.exists() {
            return Err(EncoderError::BinaryNotFound(format!(
                "Input file not found: {}",
                input.display()
            )));
        }
        let _ = output;
        Ok(())
    }

    fn estimate_output_size(
        &self,
        input_size: u64,
        duration_secs: f64,
        profile: &EncoderQualityProfile,
    ) -> Result<u64, EncoderError> {
        let bitrate = match profile {
            EncoderQualityProfile::HighQuality { bitrate, .. } => *bitrate,
            EncoderQualityProfile::Balanced { bitrate, .. } => *bitrate,
            EncoderQualityProfile::HighSpeed { bitrate, .. } => *bitrate,
        };
        if duration_secs > 0.0 {
            let estimated_bytes = ((bitrate as f64 * duration_secs) / 8.0) as u64;
            Ok(estimated_bytes.min(input_size))
        } else {
            Ok(input_size)
        }
    }
}
