//! Transfer Policy Engine
//! Manages execution rules based on user preferences and environment constraints.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferPolicy {
    pub wifi_only: bool,
    pub ask_before_large_upload: bool,
    pub large_upload_threshold_bytes: u64,
    pub preserve_quality: bool, // Force direct upload or remux without lossy transcoding
}

impl Default for TransferPolicy {
    fn default() -> Self {
        Self {
            wifi_only: false,
            ask_before_large_upload: true,
            large_upload_threshold_bytes: 10 * 1024 * 1024 * 1024, // 10 GB
            preserve_quality: true,
        }
    }
}
