//! Thin desktop adapters for actual shared-platform evidence, not manufactured probes.
use autogram_core::{AccountScore, HardwareEncoderType, HardwareProfileInfo};

pub fn account_scores() -> Result<Vec<AccountScore>, String> {
    // No live account-health adapter yet. Match Android's fail-closed semantics.
    Err("account_health_probe_unavailable".into())
}

pub async fn hardware_profile() -> Result<HardwareProfileInfo, String> {
    tokio::task::spawn_blocking(|| {
        let capability = autogram_core::platform::encoder_probe::verified_encoder_capability();
        let encoder = match capability.primary_encoder.as_str() {
            "h264_nvenc" => HardwareEncoderType::Nvenc,
            "h264_amf" => HardwareEncoderType::Amf,
            "h264_qsv" => HardwareEncoderType::Qsv,
            "h264_mediacodec" => HardwareEncoderType::MediaCodec,
            "libx264" => HardwareEncoderType::CpuX264,
            _ => return Err("verified_encoder_unavailable".into()),
        };
        Ok(autogram_core::select_best_hardware_profile(encoder))
    }).await.map_err(|_| "hardware_probe_failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unmeasured_account_health_is_never_fabricated() {
        assert_eq!(account_scores().unwrap_err(), "account_health_probe_unavailable");
    }
    #[tokio::test]
    async fn profile_is_backed_by_an_executable_encoder_or_a_structured_error() {
        match hardware_profile().await {
            Ok(profile) => assert!(matches!(profile.best_encoder.as_str(),
                "h264_nvenc" | "h264_amf" | "h264_qsv" | "h264_mediacodec" | "libx264")),
            Err(code) => assert_eq!(code, "verified_encoder_unavailable"),
        }
    }
}
