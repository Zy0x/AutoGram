use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriveBetaStatus {
    pub enabled: bool,
    pub schema_version: i64,
    pub drive_count: i64,
    pub pending_event_count: i64,
    pub integrity_ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriveRecord {
    pub drive_id: String,
    pub account_id: String,
    pub name: String,
    pub root_folder_id: String,
    pub storage_peer_id: Option<String>,
    pub storage_topic_id: Option<i64>,
    pub state: String,
    pub version: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DrivePage {
    pub account_id: String,
    pub drives: Vec<DriveRecord>,
    pub limit: usize,
    pub offset: usize,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderRecord {
    pub folder_id: String,
    pub drive_id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub version: i64,
    pub object_hash: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderPage {
    pub drive_id: String,
    pub parent_id: String,
    pub folders: Vec<FolderRecord>,
    pub limit: usize,
    pub offset: usize,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRecord {
    pub snapshot_id: String,
    pub drive_id: String,
    pub payload_hash: String,
    pub created_at: i64,
    pub folder_count: usize,
    pub mapping_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityReport {
    pub ok: bool,
    pub system_integrity: String,
    pub metadata_integrity: String,
    pub orphan_folder_count: i64,
    pub missing_root_count: i64,
    pub dangling_mapping_count: i64,
}
