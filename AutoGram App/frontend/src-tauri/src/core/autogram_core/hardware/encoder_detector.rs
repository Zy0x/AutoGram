//! Encoder Detector Engine
//! Priority: 1. NVENC -> 2. AMF -> 3. QSV -> 4. MediaCodec -> 5. CPU x264/x265

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum HardwareEncoderType {
    Nvenc,
    Amf,
    Qsv,
    MediaCodec,
    CpuX264,
    CpuX265,
}

impl HardwareEncoderType {
    pub fn priority_rank(&self) -> u32 {
        match self {
            HardwareEncoderType::Nvenc => 1,
            HardwareEncoderType::Amf => 2,
            HardwareEncoderType::Qsv => 3,
            HardwareEncoderType::MediaCodec => 4,
            HardwareEncoderType::CpuX264 => 99,
            HardwareEncoderType::CpuX265 => 100,
        }
    }

    pub fn ffmpeg_codec_str(&self) -> &'static str {
        match self {
            HardwareEncoderType::Nvenc => "h264_nvenc",
            HardwareEncoderType::Amf => "h264_amf",
            HardwareEncoderType::Qsv => "h264_qsv",
            HardwareEncoderType::MediaCodec => "h264_mediacodec",
            HardwareEncoderType::CpuX264 => "libx264",
            HardwareEncoderType::CpuX265 => "libx265",
        }
    }
}
