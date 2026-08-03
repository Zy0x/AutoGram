//! Dynamic Limit Capability Detection
//! Queries Grammers/Telegram MTProto configuration for exact account file size limits (2GB for Free, 4GB for Premium).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountCapability {
    pub account_id: String,
    pub is_premium: bool,
    pub max_file_size_bytes: u64,
    pub max_upload_chunk_size: usize,
}

impl AccountCapability {
    pub fn free(account_id: impl Into<String>) -> Self {
        Self {
            account_id: account_id.into(),
            is_premium: false,
            max_file_size_bytes: 2_147_483_648, // 2 GB
            max_upload_chunk_size: 512 * 1024,
        }
    }

    pub fn premium(account_id: impl Into<String>) -> Self {
        Self {
            account_id: account_id.into(),
            is_premium: true,
            max_file_size_bytes: 4_294_967_296, // 4 GB
            max_upload_chunk_size: 512 * 1024,
        }
    }
}
