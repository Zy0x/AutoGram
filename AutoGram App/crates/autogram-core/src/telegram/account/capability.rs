//! Dynamic Limit Capability Detection
//! Queries Grammers/Telegram MTProto configuration for exact account file size limits (2GB for Free, 4GB for Premium).

use serde::{Deserialize, Serialize};

pub const MAX_TELEGRAM_PART_SIZE: u32 = 512 * 1024;
pub const CAPABILITY_TTL_MS: i64 = 24 * 60 * 60 * 1_000; // 24 hours (prevents repetitive MTProto capability stalls)

fn default_caption_limit() -> u32 {
    crate::transfer::FALLBACK_CAPTION_LIMIT
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilitySource {
    Live,
    Cached,
    Fallback,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountCapability {
    pub account_id: String,
    pub source: CapabilitySource,
    pub fetched_at_ms: i64,
    pub expires_at_ms: i64,
    pub is_premium: bool,
    pub max_parts: u32,
    pub selected_part_size: u32,
    pub effective_max_bytes: u64,
    #[serde(default = "default_caption_limit")]
    pub caption_limit: u32,
    // Compatibility aliases for older callers.
    pub max_file_size_bytes: u64,
    pub max_upload_chunk_size: usize,
}

impl AccountCapability {
    pub fn from_runtime(
        account_id: impl Into<String>,
        source: CapabilitySource,
        fetched_at_ms: i64,
        is_premium: bool,
        max_parts: u32,
        selected_part_size: u32,
        caption_limit: u32,
    ) -> Result<Self, String> {
        validate_part_size(selected_part_size)?;
        if max_parts == 0 {
            return Err("upload max parts must be greater than zero".into());
        }
        if caption_limit == 0 {
            return Err("caption limit must be greater than zero".into());
        }
        let effective_max_bytes = u64::from(max_parts) * u64::from(selected_part_size);
        Ok(Self {
            account_id: account_id.into(),
            source,
            fetched_at_ms,
            expires_at_ms: fetched_at_ms.saturating_add(CAPABILITY_TTL_MS),
            is_premium,
            max_parts,
            selected_part_size,
            effective_max_bytes,
            caption_limit,
            max_file_size_bytes: effective_max_bytes,
            max_upload_chunk_size: selected_part_size as usize,
        })
    }

    pub fn free(account_id: impl Into<String>) -> Self {
        Self::from_runtime(
            account_id,
            CapabilitySource::Fallback,
            0,
            false,
            4_000,
            MAX_TELEGRAM_PART_SIZE,
            default_caption_limit(),
        )
        .expect("built-in free capability must be valid")
    }

    pub fn premium(account_id: impl Into<String>) -> Self {
        Self::from_runtime(
            account_id,
            CapabilitySource::Fallback,
            0,
            true,
            8_000,
            MAX_TELEGRAM_PART_SIZE,
            default_caption_limit(),
        )
        .expect("built-in premium capability must be valid")
    }
}

pub fn validate_part_size(part_size: u32) -> Result<(), String> {
    if part_size == 0
        || part_size > MAX_TELEGRAM_PART_SIZE
        || part_size % 1024 != 0
        || MAX_TELEGRAM_PART_SIZE % part_size != 0
    {
        return Err(format!("invalid Telegram upload part size: {part_size}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_limit_uses_max_parts_and_selected_part_size() {
        let free = AccountCapability::from_runtime(
            "free",
            CapabilitySource::Live,
            1,
            false,
            4_000,
            MAX_TELEGRAM_PART_SIZE,
            1_024,
        )
        .unwrap();
        let premium = AccountCapability::from_runtime(
            "premium",
            CapabilitySource::Live,
            1,
            true,
            8_000,
            MAX_TELEGRAM_PART_SIZE,
            4_096,
        )
        .unwrap();
        assert_eq!(free.effective_max_bytes, 4_000 * 524_288);
        assert_eq!(premium.effective_max_bytes, 8_000 * 524_288);
        assert_eq!(free.caption_limit, 1_024);
        assert_eq!(premium.caption_limit, 4_096);
    }

    #[test]
    fn part_size_policy_rejects_invalid_values() {
        assert!(validate_part_size(0).is_err());
        assert!(validate_part_size(513 * 1024).is_err());
        assert!(validate_part_size(300 * 1024).is_err());
        assert!(validate_part_size(256 * 1024).is_ok());
    }
}
