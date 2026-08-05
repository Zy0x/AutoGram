use serde::{Deserialize, Serialize};
use std::process::Command;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GpuProbeLevel {
    L0BasicStatic,
    L1FFmpegHwaccel,
    L2PerCodecEncoder,
    L3VramProbe,
    L4SmokeEncode,
    L5ConcurrentStreamLimit,
    L6ThermalGovernor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhysicalGpuReport {
    pub highest_probe_level: GpuProbeLevel,
    pub hwaccels_found: Vec<String>,
    pub primary_encoder: HardwareEncoderType,
    pub nvenc_available: bool,
    pub amf_available: bool,
    pub qsv_available: bool,
}

pub fn probe_physical_gpu_capabilities() -> PhysicalGpuReport {
    let mut hwaccels = Vec::new();
    let mut nvenc = false;
    let mut amf = false;
    let mut qsv = false;
    let mut level = GpuProbeLevel::L0BasicStatic;

    if let Ok(output) = Command::new("ffmpeg").arg("-hwaccels").output() {
        if output.status.success() {
            level = GpuProbeLevel::L1FFmpegHwaccel;
            let text = String::from_utf8_lossy(&output.stdout).to_lowercase();
            for line in text.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.contains("hardware acceleration") {
                    continue;
                }
                hwaccels.push(trimmed.to_string());
                if trimmed.contains("cuda") || trimmed.contains("nvenc") || trimmed.contains("dxva2") || trimmed.contains("d3d11va") {
                    nvenc = true;
                }
                if trimmed.contains("amf") {
                    amf = true;
                }
                if trimmed.contains("qsv") {
                    qsv = true;
                }
            }
        }
    }

    let primary = if nvenc {
        HardwareEncoderType::Nvenc
    } else if amf {
        HardwareEncoderType::Amf
    } else if qsv {
        HardwareEncoderType::Qsv
    } else {
        HardwareEncoderType::CpuX264
    };

    PhysicalGpuReport {
        highest_probe_level: level,
        hwaccels_found: hwaccels,
        primary_encoder: primary,
        nvenc_available: nvenc,
        amf_available: amf,
        qsv_available: qsv,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_probe_physical_gpu_returns_valid_report() {
        let report = probe_physical_gpu_capabilities();
        assert!(report.primary_encoder.priority_rank() >= 1);
    }
}

