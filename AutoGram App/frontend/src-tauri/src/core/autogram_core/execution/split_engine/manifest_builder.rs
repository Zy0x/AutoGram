//! Extended Manifest v2.8 Builder

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestPartInfo {
    pub index: usize,
    pub filename: String,
    pub size: u64,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestV28 {
    pub manifest_version: String,
    pub created_by_version: String,
    pub original_filename: String,
    pub original_hash: String,
    pub original_size: u64,
    pub split_type: String,
    pub compression_method: String,
    pub encryption_status: String,
    pub total_parts: usize,
    pub parts: Vec<ManifestPartInfo>,
    pub telegram_message_ids: Vec<i64>,
}

impl ManifestV28 {
    pub fn new(
        original_filename: impl Into<String>,
        original_hash: impl Into<String>,
        original_size: u64,
        split_type: impl Into<String>,
        parts: Vec<ManifestPartInfo>,
    ) -> Self {
        let total_parts = parts.len();
        Self {
            manifest_version: "2.8.0".to_string(),
            created_by_version: "v2.8.0-hardened".to_string(),
            original_filename: original_filename.into(),
            original_hash: original_hash.into(),
            original_size,
            split_type: split_type.into(),
            compression_method: "none".to_string(),
            encryption_status: "unencrypted".to_string(),
            total_parts,
            parts,
            telegram_message_ids: Vec::new(),
        }
    }

    pub fn to_json_string(&self) -> Result<String, String> {
        serde_json::to_string_pretty(self).map_err(|e| format!("serialize manifest json: {e}"))
    }
}
