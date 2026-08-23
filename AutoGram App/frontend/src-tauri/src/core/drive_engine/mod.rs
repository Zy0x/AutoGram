pub mod models;
mod store;

use serde::{Deserialize, Serialize};

pub use models::{
    DriveEngineStatus, DrivePage, DriveRecord, FilePage, FileRecord, FolderPage, FolderRecord,
    IntegrityReport, RecoveryRecord, SnapshotRecord,
};
pub use store::DriveStore;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDriveRequest {
    pub account_id: String,
    pub name: String,
    pub storage_peer_id: Option<String>,
    pub storage_topic_id: Option<i64>,
    pub device_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderMutationRequest {
    pub account_id: String,
    pub drive_id: String,
    pub folder_id: Option<String>,
    pub parent_id: Option<String>,
    pub name: Option<String>,
    pub telegram_chat_id: Option<String>,
    pub telegram_topic_id: Option<i64>,
    pub device_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListChildrenRequest {
    pub account_id: String,
    pub drive_id: String,
    pub parent_id: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveScopeRequest {
    pub account_id: String,
    pub drive_id: String,
    pub device_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDrivesRequest {
    pub account_id: String,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileRequest {
    pub account_id: String,
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
    pub device_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListFilesRequest {
    pub account_id: String,
    pub drive_id: String,
    pub folder_id: String,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub sort_mode: Option<String>,
    pub content_filter: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFilesRequest {
    pub account_id: String,
    pub drive_id: String,
    pub folder_id: String,
    pub telegram_message_ids: Vec<i64>,
    pub device_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveFilesRequest {
    pub account_id: String,
    pub drive_id: String,
    pub source_folder_id: String,
    pub destination_folder_id: String,
    pub telegram_message_ids: Vec<i64>,
    pub device_id: Option<String>,
}

pub fn status() -> Result<DriveEngineStatus, String> {
    DriveStore::open_default()?.status()
}

pub fn create_drive(request: CreateDriveRequest) -> Result<DriveRecord, String> {
    DriveStore::open_default()?.create_drive(
        &request.account_id,
        &request.name,
        request.storage_peer_id.as_deref(),
        request.storage_topic_id,
        request.device_id.as_deref(),
    )
}

pub fn list_drives(request: ListDrivesRequest) -> Result<DrivePage, String> {
    DriveStore::open_default()?.list_drives(&request.account_id, request.limit, request.offset)
}

pub fn create_folder(request: FolderMutationRequest) -> Result<FolderRecord, String> {
    let name = request
        .name
        .as_deref()
        .ok_or("DRIVE_ENGINE_NAME_REQUIRED")?;
    DriveStore::open_default()?.create_folder(
        &request.account_id,
        &request.drive_id,
        request.parent_id.as_deref(),
        name,
        request.telegram_chat_id.as_deref(),
        request.telegram_topic_id,
        request.device_id.as_deref(),
    )
}

pub fn list_children(request: ListChildrenRequest) -> Result<FolderPage, String> {
    DriveStore::open_default()?.list_children(
        &request.account_id,
        &request.drive_id,
        request.parent_id.as_deref(),
        request.limit,
        request.offset,
    )
}

pub fn commit_file(request: CommitFileRequest) -> Result<FileRecord, String> {
    DriveStore::open_default()?.commit_file(
        &request.account_id,
        &request.drive_id,
        &request.folder_id,
        &request.filename,
        request.size,
        request.mime.as_deref(),
        request.content_hash.as_deref(),
        request.telegram_unique_id.as_deref(),
        &request.telegram_chat_id,
        request.telegram_topic_id,
        request.telegram_message_id,
        request.device_id.as_deref(),
    )
}

pub fn list_files(request: ListFilesRequest) -> Result<FilePage, String> {
    DriveStore::open_default()?.list_files(
        &request.account_id,
        &request.drive_id,
        &request.folder_id,
        request.limit,
        request.offset,
        request.sort_mode.as_deref(),
        request.content_filter.as_deref(),
    )
}

pub fn soft_delete_files(request: DeleteFilesRequest) -> Result<usize, String> {
    DriveStore::open_default()?.soft_delete_files(
        &request.account_id,
        &request.drive_id,
        &request.folder_id,
        &request.telegram_message_ids,
        request.device_id.as_deref(),
    )
}

pub fn move_files(request: MoveFilesRequest) -> Result<usize, String> {
    DriveStore::open_default()?.move_files(
        &request.account_id,
        &request.drive_id,
        &request.source_folder_id,
        &request.destination_folder_id,
        &request.telegram_message_ids,
        request.device_id.as_deref(),
    )
}

pub fn rename_folder(request: FolderMutationRequest) -> Result<FolderRecord, String> {
    let folder_id = request
        .folder_id
        .as_deref()
        .ok_or("DRIVE_ENGINE_FOLDER_ID_REQUIRED")?;
    let name = request
        .name
        .as_deref()
        .ok_or("DRIVE_ENGINE_NAME_REQUIRED")?;
    DriveStore::open_default()?.rename_folder(
        &request.account_id,
        &request.drive_id,
        folder_id,
        name,
        request.device_id.as_deref(),
    )
}

pub fn move_folder(request: FolderMutationRequest) -> Result<FolderRecord, String> {
    let folder_id = request
        .folder_id
        .as_deref()
        .ok_or("DRIVE_ENGINE_FOLDER_ID_REQUIRED")?;
    let parent_id = request
        .parent_id
        .as_deref()
        .ok_or("DRIVE_ENGINE_PARENT_ID_REQUIRED")?;
    DriveStore::open_default()?.move_folder(
        &request.account_id,
        &request.drive_id,
        folder_id,
        parent_id,
        request.device_id.as_deref(),
    )
}

pub fn soft_delete_folder(request: FolderMutationRequest) -> Result<usize, String> {
    let folder_id = request
        .folder_id
        .as_deref()
        .ok_or("DRIVE_ENGINE_FOLDER_ID_REQUIRED")?;
    DriveStore::open_default()?.soft_delete_folder(
        &request.account_id,
        &request.drive_id,
        folder_id,
        request.device_id.as_deref(),
    )
}

pub fn soft_delete_drive(request: DriveScopeRequest) -> Result<usize, String> {
    DriveStore::open_default()?.soft_delete_drive(
        &request.account_id,
        &request.drive_id,
        request.device_id.as_deref(),
    )
}

pub fn create_snapshot(request: DriveScopeRequest) -> Result<SnapshotRecord, String> {
    DriveStore::open_default()?.create_snapshot(
        &request.account_id,
        &request.drive_id,
        request.device_id.as_deref(),
    )
}

pub fn restore_latest_snapshot(request: DriveScopeRequest) -> Result<RecoveryRecord, String> {
    DriveStore::open_default()?.restore_latest_snapshot(&request.account_id, &request.drive_id)
}

pub fn integrity_report() -> Result<IntegrityReport, String> {
    DriveStore::open_default()?.integrity_report()
}
