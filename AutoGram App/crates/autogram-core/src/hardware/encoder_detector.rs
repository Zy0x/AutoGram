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
    let capability = crate::platform::encoder_probe::verified_encoder_capability();
    let primary = if capability.has_nvenc {
        HardwareEncoderType::Nvenc
    } else if capability.has_amf {
        HardwareEncoderType::Amf
    } else if capability.has_qsv {
        HardwareEncoderType::Qsv
    } else if capability.has_mediacodec {
        HardwareEncoderType::MediaCodec
    } else {
        // Legacy enum has no Unknown variant. At L0 this is a policy default,
        // never evidence that a CPU encoder is available.
        HardwareEncoderType::CpuX264
    };
    PhysicalGpuReport {
        highest_probe_level: if capability.primary_encoder.is_empty() {
            GpuProbeLevel::L0BasicStatic
        } else { GpuProbeLevel::L4SmokeEncode },
        hwaccels_found: [(capability.has_nvenc, "h264_nvenc"), (capability.has_amf, "h264_amf"),
            (capability.has_qsv, "h264_qsv"), (capability.has_mediacodec, "h264_mediacodec")]
            .into_iter().filter(|(available, _)| *available).map(|(_, name)| name.to_string()).collect(),
        primary_encoder: primary,
        nvenc_available: capability.has_nvenc,
        amf_available: capability.has_amf,
        qsv_available: capability.has_qsv,
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
