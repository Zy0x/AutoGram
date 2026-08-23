use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriveEngineStatus {
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
    pub telegram_chat_id: Option<String>,
    pub telegram_topic_id: Option<i64>,
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
pub struct FileRecord {
    pub file_id: String,
    pub drive_id: String,
    pub folder_id: String,
    pub filename: String,
    pub size: i64,
    pub mime: Option<String>,
    pub content_hash: Option<String>,
    pub telegram_unique_id: Option<String>,
    pub telegram_chat_id: String,
    pub telegram_topic_id: Option<i64>,
    pub telegram_message_id: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FilePage {
    pub drive_id: String,
    pub folder_id: String,
    pub files: Vec<FileRecord>,
    pub limit: usize,
    pub offset: usize,
    pub has_more: bool,
    pub total_count: i64,
    pub total_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRecord {
    pub snapshot_id: String,
    pub drive_id: String,
    pub payload_hash: String,
    pub created_at: i64,
    pub folder_count: usize,
    pub file_count: usize,
    pub mapping_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryRecord {
    pub snapshot_id: String,
    pub drive_id: String,
    pub payload_hash: String,
    pub restored_folder_count: usize,
    pub restored_file_count: usize,
    pub restored_mapping_count: usize,
    pub restored_at: i64,
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
