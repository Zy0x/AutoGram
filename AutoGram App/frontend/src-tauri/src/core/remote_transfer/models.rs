use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteTransferMode {
    Auto,
    DirectCloudFetch,
    StorageLocal,
}

impl Default for RemoteTransferMode {
    fn default() -> Self {
        Self::Auto
    }
}

impl RemoteTransferMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::DirectCloudFetch => "cloud_fetch",
            Self::StorageLocal => "storage_local",
        }
    }

    pub fn from_str_lenient(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "cloud_fetch" | "direct_cloud_fetch" | "direct_cloud" | "cloud" => Self::DirectCloudFetch,
            "storage_local" | "local_storage" | "local" | "disk" => Self::StorageLocal,
            _ => Self::Auto,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageLocalPolicy {
    Telegram,
    CustomDisk,
    DiskAndTelegram,
}

impl Default for StorageLocalPolicy {
    fn default() -> Self {
        Self::Telegram
    }
}

impl StorageLocalPolicy {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Telegram => "telegram",
            Self::CustomDisk => "custom_disk",
            Self::DiskAndTelegram => "disk_and_telegram",
        }
    }

    pub fn from_str_lenient(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "custom_disk" | "disk" | "local_only" => Self::CustomDisk,
            "disk_and_telegram" | "both" => Self::DiskAndTelegram,
            _ => Self::Telegram,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteTransferState {
    Queued,
    Probing,
    ReservingDisk,
    Downloading,
    Staged,
    Verifying,
    Uploading,
    CloudSubmitting,
    CloudProcessing,
    Paused,
    Cancelling,
    Cancelled,
    Recovering,
    CleanupPending,
    Done,
    Failed,
    NeedsAction,
}

impl RemoteTransferState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Probing => "probing",
            Self::ReservingDisk => "reserving_disk",
            Self::Downloading => "downloading",
            Self::Staged => "staged",
            Self::Verifying => "verifying",
            Self::Uploading => "uploading",
            Self::CloudSubmitting => "cloud_submitting",
            Self::CloudProcessing => "cloud_processing",
            Self::Paused => "paused",
            Self::Cancelling => "cancelling",
            Self::Cancelled => "cancelled",
            Self::Recovering => "recovering",
            Self::CleanupPending => "cleanup_pending",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::NeedsAction => "needs_action",
        }
    }

    pub fn from_str_lenient(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "probing" => Self::Probing,
            "reserving_disk" => Self::ReservingDisk,
            "downloading" => Self::Downloading,
            "staged" => Self::Staged,
            "verifying" => Self::Verifying,
            "uploading" => Self::Uploading,
            "cloud_submitting" => Self::CloudSubmitting,
            "cloud_processing" => Self::CloudProcessing,
            "paused" => Self::Paused,
            "cancelling" => Self::Cancelling,
            "cancelled" => Self::Cancelled,
            "recovering" => Self::Recovering,
            "cleanup_pending" => Self::CleanupPending,
            "done" => Self::Done,
            "failed" => Self::Failed,
            "needs_action" => Self::NeedsAction,
            _ => Self::Queued,
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Done | Self::Cancelled | Self::Failed)
    }

    pub fn is_active(&self) -> bool {
        matches!(
            self,
            Self::Probing
                | Self::ReservingDisk
                | Self::Downloading
                | Self::Staged
                | Self::Verifying
                | Self::Uploading
                | Self::CloudSubmitting
                | Self::CloudProcessing
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTransferJob {
    pub job_id: String,
    pub account_id: Option<String>,
    pub source_url: String,
    pub source_filename: Option<String>,
    pub source_mime: Option<String>,
    pub source_size: Option<u64>,
    pub source_etag: Option<String>,
    pub source_last_modified: Option<String>,
    pub thumbnail_url: Option<String>,
    pub mode: RemoteTransferMode,
    pub storage_policy: StorageLocalPolicy,
    pub custom_disk_path: Option<String>,
    pub spool_path: Option<String>,
    pub downloaded_bytes: u64,
    pub uploaded_bytes: u64,
    pub checksum_sha256: Option<String>,
    pub destination_type: Option<String>,
    pub destination_id: Option<String>,
    pub destination_topic_id: Option<i64>,
    pub telegram_message_id: Option<i64>,
    pub state: RemoteTransferState,
    pub cleanup_state: String,
    pub retry_count: u32,
    pub last_error: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub completed_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTransferEvent {
    pub id: Option<i64>,
    pub job_id: String,
    pub event_type: String,
    pub payload: Option<String>,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePreflightRequest {
    pub url: String,
    pub custom_filename: Option<String>,
    pub destination_id: Option<String>,
    pub topic_id: Option<i64>,
    pub mode: Option<String>,
    pub storage_policy: Option<String>,
    pub custom_disk_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePreflightReport {
    pub url: String,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: Option<u64>,
    pub etag: Option<String>,
    pub thumbnail_url: Option<String>,
    pub recommended_mode: String,
    pub resolved_mode: String,
    pub storage_policy: String,
    pub spool_path: String,
    pub required_disk_bytes: u64,
    pub available_disk_bytes: Option<u64>,
    pub has_sufficient_disk: bool,
    pub estimated_download_quota_bytes: u64,
    pub estimated_upload_quota_bytes: u64,
    pub supports_http_range_resume: bool,
    pub cloud_fetch_eligible: bool,
    pub retention_policy_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRecoveryItem {
    pub job_id: String,
    pub source_url: String,
    pub filename: String,
    pub downloaded_bytes: u64,
    pub total_size_bytes: Option<u64>,
    pub part_path: String,
    pub manifest_path: String,
    pub state: String,
    pub created_at_ms: i64,
    pub reason: String,
    pub can_resume: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTransferMetrics {
    pub job_id: String,
    pub state: String,
    pub phase: String,
    pub percent: f64,
    pub downloaded_bytes: u64,
    pub uploaded_bytes: u64,
    pub total_bytes: u64,
    pub download_speed_mb_s: f64,
    pub upload_speed_mb_s: f64,
    pub active_mode: String,
    pub spool_disk_used_bytes: u64,
    pub is_resumable: bool,
}
