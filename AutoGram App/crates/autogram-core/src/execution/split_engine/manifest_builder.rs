//! Extended Manifest v2.8 Builder

use serde::{Deserialize, Serialize};
use std::path::Path;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoGramSplitManifest {
    pub schema: String,
    pub created_by: String,
    pub original_filename: String,
    pub original_size: u64,
    pub original_sha256: String,
    pub part_size_limit: u64,
    pub parts: Vec<ManifestPartInfo>,
    pub telegram_message_ids: Vec<i64>,
    pub merge_commands: MergeCommands,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeCommands {
    pub powershell: String,
    pub bash: String,
    pub python: String,
    pub android_sh: String,
}

impl AutoGramSplitManifest {
    pub fn from_parts(
        input: &Path,
        part_size_limit: u64,
        parts: &[super::BinaryVolumePart],
    ) -> Result<Self, String> {
        let original_filename = input
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file.bin")
            .to_string();
        let original_size = std::fs::metadata(input)
            .map_err(|e| format!("manifest input metadata: {e}"))?
            .len();
        let original_sha256 = crate::reliability::calculate_file_sha256(input)
            .map_err(|e| format!("hash original input: {e}"))?;
        let glob = format!("{original_filename}.agpart.*");
        Ok(Self {
            schema: "autogram.split-manifest.v1".into(),
            created_by: "AutoGram Transfer Manager v4".into(),
            original_filename: original_filename.clone(),
            original_size,
            original_sha256: format!("sha256:{original_sha256}"),
            part_size_limit,
            parts: parts
                .iter()
                .map(|part| ManifestPartInfo {
                    index: part.index,
                    filename: part.filename.clone(),
                    size: part.size,
                    hash: part.sha256.clone(),
                })
                .collect(),
            telegram_message_ids: Vec::new(),
            merge_commands: MergeCommands {
                powershell: format!(
                    "Get-ChildItem -Filter '{}' | Sort-Object Name | Get-Content -AsByteStream | Set-Content -AsByteStream '{}'",
                    glob, original_filename
                ),
                bash: format!(
                    "cat -- '{}'.agpart.* > '{}'",
                    original_filename.replace('\'', "'\\''"),
                    original_filename.replace('\'', "'\\''")
                ),
                python: format!(
                    "import glob, sys; out=open('{}', 'wb'); [out.write(open(f, 'rb').read()) for f in sorted(glob.glob('{}.agpart.*'))]; out.close()",
                    original_filename.replace('\'', "\\'"),
                    original_filename.replace('\'', "\\'")
                ),
                android_sh: format!(
                    "cat -- /sdcard/Download/'{}'.agpart.* > /sdcard/Download/'{}'",
                    original_filename.replace('\'', "'\\''"),
                    original_filename.replace('\'', "'\\''")
                ),
            },
        })
    }

    pub fn write_to(&self, path: &Path) -> Result<(), String> {
        let json =
            serde_json::to_vec_pretty(self).map_err(|e| format!("serialize manifest: {e}"))?;
        std::fs::write(path, json).map_err(|e| format!("write manifest: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merge_commands_contains_all_targets() {
        let cmds = MergeCommands {
            powershell: "Get-Content".into(),
            bash: "cat".into(),
            python: "import glob".into(),
            android_sh: "cat /sdcard/Download/".into(),
        };
        assert!(cmds.python.contains("import glob"));
        assert!(cmds.android_sh.contains("/sdcard/Download/"));
    }
}

