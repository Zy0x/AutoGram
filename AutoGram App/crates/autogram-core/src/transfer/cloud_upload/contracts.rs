use super::super::{
    cloud_download::{AccountScope, PeerKind},
    FrozenTransferProfile, PresentationOverride,
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const UPLOAD_PART_BYTES: usize = 512 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UploadDestination {
    pub scope: AccountScope,
    pub peer_kind: PeerKind,
    pub peer_id: i64,
    pub topic_id: Option<i32>,
}
impl UploadDestination {
    pub fn validate(&self) -> Result<(), UploadError> {
        if self.scope.authorized_user_id() <= 0
            || self.scope.account_id().is_empty()
            || self.peer_id <= 0
            || self.peer_id > i64::MAX - 1_000_000_000_000
            || self.topic_id.is_some_and(|v| v <= 0)
            || (self.topic_id.is_some() && self.peer_kind != PeerKind::Channel)
        {
            return Err(UploadError::InvalidRequest);
        }
        Ok(())
    }
    pub fn dialog_id(&self) -> String {
        match self.peer_kind {
            PeerKind::User => self.peer_id.to_string(),
            PeerKind::Chat => format!("-{}", self.peer_id),
            PeerKind::Channel => (-1_000_000_000_000i64 - self.peer_id).to_string(),
        }
    }
}

/// Digests of every part detect source changes *before* those bytes reach Telegram.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UploadFileSnapshot {
    pub path: PathBuf,
    pub size: u64,
    pub sha256: String,
    pub md5: String,
    pub part_sha256: Vec<String>,
}
impl UploadFileSnapshot {
    pub fn parts(&self) -> usize {
        self.part_sha256.len()
    }
    pub fn validate(&self) -> Result<(), UploadError> {
        if !self.path.is_absolute()
            || self.size == 0
            || self.size > UPLOAD_PART_BYTES as u64 * 8_000
            || self.parts() != self.size.div_ceil(UPLOAD_PART_BYTES as u64) as usize
            || !digest(&self.sha256, 64)
            || !digest(&self.md5, 32)
            || self.part_sha256.iter().any(|v| !digest(v, 64))
        {
            return Err(UploadError::InvalidRequest);
        }
        Ok(())
    }
}
fn digest(value: &str, size: usize) -> bool {
    value.len() == size
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UploadProfileBinding {
    pub profile_id: String,
    pub revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UploadRequest {
    pub operation_id: String,
    pub destination: UploadDestination,
    pub source: UploadFileSnapshot,
    pub filename: String,
    pub mime_type: String,
    pub caption: String,
    pub profile: FrozenTransferProfile,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_binding: Option<UploadProfileBinding>,
    /// MTProto send deduplication ID: immutable through retry/recovery.
    pub random_id: i64,
}
impl UploadRequest {
    pub fn validate(&self) -> Result<(), UploadError> {
        self.destination.validate()?;
        self.source.validate()?;
        if self.profile_binding.as_ref().is_some_and(|binding| binding.revision <= 0
            || binding.profile_id.is_empty() || binding.profile_id.len() > 128
            || !binding.profile_id.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))) {
            return Err(UploadError::InvalidRequest);
        }
        if self.operation_id.is_empty()
            || self.operation_id.len() > 128
            || !self
                .operation_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
            || self.random_id == 0
            || self.filename.is_empty()
            || self.filename.len() > 255
            || self.filename
                != crate::transfer::download::sanitize_download_filename(&self.filename)
            || self.mime_type.is_empty()
            || self.mime_type.len() > 128
            || !self.mime_type.contains('/')
            || self.mime_type.chars().any(char::is_control)
            || self.caption.encode_utf16().count() > 4096
        {
            return Err(UploadError::InvalidRequest);
        }
        // Never silently reinterpret SMART/native/album profiles as document uploads.
        validate_document_profile(&self.profile)
    }
}
pub fn validate_document_profile(profile: &FrozenTransferProfile) -> Result<(), UploadError> {
    if profile.schema_version != 1 || profile.presentation_override != PresentationOverride::ForceDocument
        || profile.group_as_album || profile.group_documents {
        return Err(UploadError::UnsupportedProfile);
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UploadState {
    Queued,
    Running,
    Paused,
    RetryWait,
    Committing,
    ReviewRequired,
    Completed,
    Failed,
    Cancelled,
}
impl UploadState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::RetryWait => "retry_wait",
            Self::Committing => "committing",
            Self::ReviewRequired => "review_required",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
    pub fn parse(value: &str) -> Result<Self, UploadError> {
        match value {
            "queued" => Ok(Self::Queued),
            "running" => Ok(Self::Running),
            "paused" => Ok(Self::Paused),
            "retry_wait" => Ok(Self::RetryWait),
            "committing" => Ok(Self::Committing),
            "review_required" => Ok(Self::ReviewRequired),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err(UploadError::Database),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UploadReceipt {
    pub destination: UploadDestination,
    pub random_id: i64,
    pub message_id: i32,
    pub document_id: i64,
    pub size: u64,
    pub filename: String,
}
impl UploadReceipt {
    pub fn validate(&self, request: &UploadRequest) -> Result<(), UploadError> {
        if self.destination != request.destination
            || self.random_id != request.random_id
            || self.message_id <= 0
            || self.document_id == 0
            || self.size != request.source.size
            || self.filename != request.filename
        {
            return Err(UploadError::ReceiptMismatch);
        }
        Ok(())
    }
}
#[derive(Debug, Clone)]
pub struct UploadRecord {
    pub request: UploadRequest,
    pub state: UploadState,
    pub file_id: i64,
    pub acknowledged_parts: usize,
    pub uploaded_bytes: u64,
    pub epoch: i64,
    pub control: Option<String>,
    pub retry_not_before_ms: Option<i64>,
    pub error_code: Option<String>,
    pub receipt: Option<UploadReceipt>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum UploadError {
    #[error("invalid_request")]
    InvalidRequest,
    #[error("unsupported_profile")]
    UnsupportedProfile,
    #[error("wrong_scope")]
    WrongScope,
    #[error("not_found")]
    NotFound,
    #[error("operation_conflict")]
    Conflict,
    #[error("invalid_state")]
    InvalidState,
    #[error("database")]
    Database,
    #[error("source_changed")]
    SourceChanged,
    #[error("io")]
    Io,
    #[error("busy")]
    Busy,
    #[error("not_authorized")]
    Unauthorized,
    #[error("network")]
    Network,
    #[error("flood_wait")]
    FloodWait { retry_after_ms: u64 },
    #[error("upload_part_rejected")]
    PartRejected,
    #[error("upload_parts_expired")]
    PartsExpired,
    #[error("receipt_mismatch")]
    ReceiptMismatch,
    #[error("review_required")]
    ReviewRequired,
    #[error("operation_cancelled")]
    Cancelled,
    #[error("cloud_write_rejected")]
    Rejected,
}

/// A transport must verify server account identity and retain encrypted peer capabilities.
/// Acknowledgement means the server accepted this exact part, not that it was dispatched.
pub trait UploadCommitJournal: Send + Sync {
    /// Only an exact server UpdateMessageId mapping for this request may be recorded.
    fn record_message_id(&self, message_id: i32) -> Result<(), UploadError>;
}

#[async_trait]
pub trait CloudUploadTransport: Send + Sync {
    fn scope(&self) -> &AccountScope;
    async fn limits(&self) -> Result<UploadLimits, UploadError>;
    async fn validate_destination(
        &self,
        destination: &UploadDestination,
    ) -> Result<(), UploadError>;
    async fn save_part(
        &self,
        request: &UploadRequest,
        file_id: i64,
        part: usize,
        bytes: Vec<u8>,
    ) -> Result<(), UploadError>;
    async fn commit_document(
        &self,
        request: &UploadRequest,
        file_id: i64,
        journal: &dyn UploadCommitJournal,
    ) -> Result<UploadReceipt, UploadError>;
    /// Reads the exact journaled message. This method must never send or search history.
    async fn reconcile_document(
        &self,
        request: &UploadRequest,
        message_id: i32,
    ) -> Result<UploadReceipt, UploadError>;
}

#[derive(Debug, Clone, Copy)]
pub struct UploadLimits {
    pub max_parts: u32,
    pub caption_utf16: u32,
}
impl UploadLimits {
    pub fn validate(&self, request: &UploadRequest) -> Result<(), UploadError> {
        if self.max_parts == 0
            || self.caption_utf16 == 0
            || request.source.parts() > self.max_parts as usize
            || request.caption.encode_utf16().count() > self.caption_utf16 as usize
        {
            return Err(UploadError::InvalidRequest);
        }
        Ok(())
    }
}
