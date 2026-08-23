pub mod models;
mod store;

use serde::{Deserialize, Serialize};

pub use models::{DriveBetaStatus, DriveRecord, FolderPage, FolderRecord, IntegrityReport, SnapshotRecord};
pub use store::DriveBetaStore;

pub fn enabled() -> bool {
    std::env::var("AUTOGRAM_DRIVE_BETA_ENABLED")
        .ok()
        .map(|value| matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
}

fn require_enabled() -> Result<(), String> {
    if enabled() {
        Ok(())
    } else {
        Err("DRIVE_BETA_DISABLED".into())
    }
}

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

pub fn status() -> Result<DriveBetaStatus, String> {
    DriveBetaStore::open_default()?.status()
}

pub fn create_drive(request: CreateDriveRequest) -> Result<DriveRecord, String> {
    require_enabled()?;
    DriveBetaStore::open_default()?.create_drive(
        &request.account_id,
        &request.name,
        request.storage_peer_id.as_deref(),
        request.storage_topic_id,
        request.device_id.as_deref(),
    )
}

pub fn create_folder(request: FolderMutationRequest) -> Result<FolderRecord, String> {
    require_enabled()?;
    let name = request.name.as_deref().ok_or("DRIVE_BETA_NAME_REQUIRED")?;
    DriveBetaStore::open_default()?.create_folder(
        &request.account_id,
        &request.drive_id,
        request.parent_id.as_deref(),
        name,
        request.device_id.as_deref(),
    )
}

pub fn list_children(request: ListChildrenRequest) -> Result<FolderPage, String> {
    require_enabled()?;
    DriveBetaStore::open_default()?.list_children(
        &request.account_id,
        &request.drive_id,
        request.parent_id.as_deref(),
        request.limit,
        request.offset,
    )
}

pub fn rename_folder(request: FolderMutationRequest) -> Result<FolderRecord, String> {
    require_enabled()?;
    let folder_id = request.folder_id.as_deref().ok_or("DRIVE_BETA_FOLDER_ID_REQUIRED")?;
    let name = request.name.as_deref().ok_or("DRIVE_BETA_NAME_REQUIRED")?;
    DriveBetaStore::open_default()?.rename_folder(
        &request.account_id,
        &request.drive_id,
        folder_id,
        name,
        request.device_id.as_deref(),
    )
}

pub fn move_folder(request: FolderMutationRequest) -> Result<FolderRecord, String> {
    require_enabled()?;
    let folder_id = request.folder_id.as_deref().ok_or("DRIVE_BETA_FOLDER_ID_REQUIRED")?;
    let parent_id = request.parent_id.as_deref().ok_or("DRIVE_BETA_PARENT_ID_REQUIRED")?;
    DriveBetaStore::open_default()?.move_folder(
        &request.account_id,
        &request.drive_id,
        folder_id,
        parent_id,
        request.device_id.as_deref(),
    )
}

pub fn soft_delete_folder(request: FolderMutationRequest) -> Result<usize, String> {
    require_enabled()?;
    let folder_id = request.folder_id.as_deref().ok_or("DRIVE_BETA_FOLDER_ID_REQUIRED")?;
    DriveBetaStore::open_default()?.soft_delete_folder(
        &request.account_id,
        &request.drive_id,
        folder_id,
        request.device_id.as_deref(),
    )
}

pub fn create_snapshot(request: DriveScopeRequest) -> Result<SnapshotRecord, String> {
    require_enabled()?;
    DriveBetaStore::open_default()?.create_snapshot(
        &request.account_id,
        &request.drive_id,
        request.device_id.as_deref(),
    )
}

pub fn integrity_report() -> Result<IntegrityReport, String> {
    DriveBetaStore::open_default()?.integrity_report()
}
