use super::{FrozenTransferProfile, ProfileError};
use crate::transfer::EncoderStrategy;

pub(super) fn validate_id(id: &str) -> Result<(), ProfileError> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
    {
        return Err(ProfileError::InvalidProfile);
    }
    Ok(())
}
pub fn validate_profile(config: &FrozenTransferProfile) -> Result<(), ProfileError> {
    let encoder = &config.encoder;
    if config.schema_version != 1
        || config.profile_name.trim().is_empty()
        || config.profile_name.encode_utf16().count() > 128
        || config.profile_name.chars().any(char::is_control)
        || !matches!(
            config.quality_mode.as_str(),
            "HIGH_QUALITY" | "SMART" | "ORIGINAL" | "DOCUMENT"
        )
        || !(1..=10).contains(&config.upload_concurrency)
        || !(1..=10).contains(&config.download_concurrency)
        || !(2..=10).contains(&config.album_group_size)
        || !(1..=64).contains(&encoder.max_parallel_encodes)
        || !(1..=100).contains(&encoder.max_cpu_percent)
        || encoder.max_memory_mb == 0
        || encoder.specific_device.as_ref().is_some_and(|id| {
            id.trim().is_empty() || id.len() > 128 || id.chars().any(char::is_control)
        })
        || (encoder.strategy == EncoderStrategy::SpecificDevice
            && encoder.specific_device.is_none())
    {
        return Err(ProfileError::InvalidProfile);
    }
    Ok(())
}
