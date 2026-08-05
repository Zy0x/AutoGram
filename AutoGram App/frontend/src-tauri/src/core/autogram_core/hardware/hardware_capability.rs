//! Quality Profiles & Hardware Capability Integration

use super::encoder_detector::HardwareEncoderType;
use crate::core::autogram_core::platform::EncoderQualityProfile;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareProfileInfo {
    pub best_encoder: String,
    pub priority: u32,
    pub default_profile: EncoderQualityProfile,
}

pub fn select_best_hardware_profile(encoder: HardwareEncoderType) -> HardwareProfileInfo {
    let default_profile = match encoder {
        HardwareEncoderType::Nvenc | HardwareEncoderType::Amf => {
            EncoderQualityProfile::HighQuality {
                bitrate: 8_000_000,
                preset: "p4".into(),
            }
        }
        HardwareEncoderType::Qsv | HardwareEncoderType::MediaCodec => {
            EncoderQualityProfile::Balanced {
                bitrate: 5_000_000,
                preset: "medium".into(),
            }
        }
        HardwareEncoderType::CpuX264 | HardwareEncoderType::CpuX265 => {
            EncoderQualityProfile::HighSpeed {
                bitrate: 3_000_000,
                preset: "veryfast".into(),
            }
        }
    };

    HardwareProfileInfo {
        best_encoder: encoder.ffmpeg_codec_str().to_string(),
        priority: encoder.priority_rank(),
        default_profile,
    }
}
