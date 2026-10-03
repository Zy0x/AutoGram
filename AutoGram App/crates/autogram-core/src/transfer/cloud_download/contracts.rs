use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountScope {
    account_id: String,
    authorized_user_id: i64,
}

impl AccountScope {
    pub fn new(account_id: String, authorized_user_id: i64) -> Result<Self, DownloadError> {
        let value = Self {
            account_id,
            authorized_user_id,
        };
        value.validate()?;
        Ok(value)
    }
    pub fn account_id(&self) -> &str {
        &self.account_id
    }
    pub fn authorized_user_id(&self) -> i64 {
        self.authorized_user_id
    }
    fn validate(&self) -> Result<(), DownloadError> {
        if self.account_id.is_empty() || self.account_id.len() > 256 || self.authorized_user_id <= 0
        {
            return Err(DownloadError::InvalidRequest);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PeerKind {
    User,
    Chat,
    Channel,
}

/// Contains stable identifiers only, never access hashes, file references or sessions.
/// Saved Messages is User + the concrete authorized user ID, never a sentinel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudDownloadIdentity {
    scope: AccountScope,
    peer_kind: PeerKind,
    peer_id: i64,
    topic_id: Option<i32>,
    message_id: i32,
    media_id: i64,
    rendition: String,
    stable_media_fingerprint: String,
    expected_size: u64,
}

impl CloudDownloadIdentity {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        scope: AccountScope,
        peer_kind: PeerKind,
        peer_id: i64,
        topic_id: Option<i32>,
        message_id: i32,
        media_id: i64,
        rendition: String,
        stable_media_fingerprint: String,
        expected_size: u64,
    ) -> Result<Self, DownloadError> {
        let value = Self {
            scope,
            peer_kind,
            peer_id,
            topic_id,
            message_id,
            media_id,
            rendition,
            stable_media_fingerprint,
            expected_size,
        };
        value.validate()?;
        Ok(value)
    }
    pub fn scope(&self) -> &AccountScope {
        &self.scope
    }
    pub fn peer_kind(&self) -> PeerKind {
        self.peer_kind
    }
    pub fn peer_id(&self) -> i64 {
        self.peer_id
    }
    pub fn topic_id(&self) -> Option<i32> {
        self.topic_id
    }
    pub fn message_id(&self) -> i32 {
        self.message_id
    }
    pub fn media_id(&self) -> i64 {
        self.media_id
    }
    pub fn rendition(&self) -> &str {
        &self.rendition
    }
    pub fn stable_media_fingerprint(&self) -> &str {
        &self.stable_media_fingerprint
    }
    pub fn expected_size(&self) -> u64 {
        self.expected_size
    }
    pub(crate) fn validate(&self) -> Result<(), DownloadError> {
        self.scope.validate()?;
        if self.peer_id <= 0
            || self.message_id <= 0
            || self.media_id == 0
            || self.topic_id.is_some_and(|v| v <= 0)
            || self.rendition.is_empty()
            || self.rendition.len() > 256
            || self.stable_media_fingerprint.is_empty()
            || self.stable_media_fingerprint.len() > 512
            || self.expected_size > i64::MAX as u64
        {
            return Err(DownloadError::InvalidRequest);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DownloadRequest {
    operation_id: String,
    source: CloudDownloadIdentity,
    expected_size: u64,
    expected_sha256: Option<String>,
    temp_path: PathBuf,
    output_path: PathBuf,
}

impl DownloadRequest {
    pub fn new(
        operation_id: String,
        source: CloudDownloadIdentity,
        expected_size: u64,
        expected_sha256: Option<String>,
        temp_path: PathBuf,
        output_path: PathBuf,
    ) -> Result<Self, DownloadError> {
        let value = Self {
            operation_id,
            source,
            expected_size,
            expected_sha256,
            temp_path,
            output_path,
        };
        value.validate()?;
        Ok(value)
    }
    pub fn operation_id(&self) -> &str {
        &self.operation_id
    }
    pub fn source(&self) -> &CloudDownloadIdentity {
        &self.source
    }
    pub fn expected_size(&self) -> u64 {
        self.expected_size
    }
    pub fn expected_sha256(&self) -> Option<&str> {
        self.expected_sha256.as_deref()
    }
    pub fn temp_path(&self) -> &std::path::Path {
        &self.temp_path
    }
    pub fn output_path(&self) -> &std::path::Path {
        &self.output_path
    }
    pub(crate) fn validate(&self) -> Result<(), DownloadError> {
        self.source.validate()?;
        if self.operation_id.is_empty()
            || self.operation_id.len() > 128
            || !self
                .operation_id
                .bytes()
                .all(|v| v.is_ascii_alphanumeric() || b"-_".contains(&v))
            || self.expected_size > i64::MAX as u64
            || self.expected_size != self.source.expected_size()
            || !self.temp_path.is_absolute()
            || !self.output_path.is_absolute()
            || self.temp_path == self.output_path
            || self.expected_sha256.as_ref().is_some_and(|h| {
                h.len() != 64
                    || !h
                        .bytes()
                        .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
            })
        {
            return Err(DownloadError::InvalidRequest);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DownloadState {
    Queued,
    Running,
    Paused,
    Cancelled,
    Failed,
    Publishing,
    Completed,
}
impl DownloadState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Cancelled => "cancelled",
            Self::Failed => "failed",
            Self::Publishing => "publishing",
            Self::Completed => "completed",
        }
    }
    pub(crate) fn parse(value: &str) -> Result<Self, DownloadError> {
        match value {
            "queued" => Ok(Self::Queued),
            "running" => Ok(Self::Running),
            "paused" => Ok(Self::Paused),
            "cancelled" => Ok(Self::Cancelled),
            "failed" => Ok(Self::Failed),
            "publishing" => Ok(Self::Publishing),
            "completed" => Ok(Self::Completed),
            _ => Err(DownloadError::Database),
        }
    }
}

#[derive(Debug, Clone)]
pub struct DownloadRecord {
    pub request: DownloadRequest,
    pub state: DownloadState,
    pub checkpoint_bytes: u64,
    pub checkpoint_sha256: String,
    pub actual_sha256: Option<String>,
    pub attempts: u32,
    pub error_code: Option<String>,
    pub retry_after_ms: Option<u64>,
    pub created_ms: u64,
    pub updated_ms: u64,
    pub(crate) file_identity: Option<String>,
}

impl DownloadRecord {
    pub fn retry_not_before_ms(&self) -> Option<u64> {
        self.retry_after_ms
            .map(|delay| self.updated_ms.saturating_add(delay))
    }
}

/// Adapter must verify account authorization and immutable message/media/rendition on every call.
#[derive(Debug, Clone)]
pub struct RemoteObject {
    pub identity: CloudDownloadIdentity,
    pub size: u64,
}
#[derive(Debug, Clone)]
pub struct RangeChunk {
    pub object: RemoteObject,
    pub offset: u64,
    pub bytes: Vec<u8>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceFailure {
    Unauthorized,
    WrongScope,
    IdentityChanged,
    NotFound,
    Network,
    FloodWait { retry_after_ms: u64 },
}
#[async_trait]
pub trait CloudByteRangeSource: Send + Sync {
    /// A pinned background lease, never the current UI-selected account.
    fn scope(&self) -> &AccountScope;
    async fn describe(
        &self,
        identity: &CloudDownloadIdentity,
    ) -> Result<RemoteObject, SourceFailure>;
    /// Exact [offset, offset + length). Refresh expiring transport references without changing identity.
    /// Futures must be cancellation safe: dropping a read must not publish or mutate local output.
    async fn read_range(
        &self,
        identity: &CloudDownloadIdentity,
        offset: u64,
        length: usize,
    ) -> Result<RangeChunk, SourceFailure>;
}

#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    #[error("invalid download request")]
    InvalidRequest,
    #[error("operation binding conflict")]
    OperationConflict,
    #[error("download operation not found")]
    NotFound,
    #[error("download account scope mismatch")]
    WrongScope,
    #[error("cloud media identity changed")]
    IdentityChanged,
    #[error("download operation is busy")]
    Busy,
    #[error("invalid download state transition")]
    InvalidState,
    #[error("download destination already exists")]
    DestinationExists,
    #[error("download file ownership mismatch")]
    Ownership,
    #[error("download integrity mismatch")]
    Integrity,
    #[error("invalid range response: expected {expected} bytes, received {actual}")]
    ShortRead { expected: usize, actual: usize },
    #[error("download database failure")]
    Database,
    #[error("download file I/O failure during {action}: {kind:?}")]
    Io {
        action: &'static str,
        kind: std::io::ErrorKind,
    },
    #[error("cloud source failed: {0:?}")]
    Source(SourceFailure),
}
impl DownloadError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest => "invalid_request",
            Self::OperationConflict => "operation_conflict",
            Self::NotFound => "not_found",
            Self::WrongScope => "wrong_scope",
            Self::IdentityChanged => "identity_changed",
            Self::Busy => "busy",
            Self::InvalidState => "invalid_state",
            Self::DestinationExists => "destination_exists",
            Self::Ownership => "ownership",
            Self::Integrity => "integrity",
            Self::ShortRead { .. } => "short_read",
            Self::Database => "database",
            Self::Io { .. } => "io",
            Self::Source(SourceFailure::Unauthorized) => "source_unauthorized",
            Self::Source(SourceFailure::WrongScope) => "source_wrong_scope",
            Self::Source(SourceFailure::IdentityChanged) => "source_identity_changed",
            Self::Source(SourceFailure::NotFound) => "source_not_found",
            Self::Source(SourceFailure::Network) => "source_network",
            Self::Source(SourceFailure::FloodWait { .. }) => "source_flood_wait",
        }
    }
    pub(crate) fn io(action: &'static str, error: std::io::Error) -> Self {
        Self::Io {
            action,
            kind: error.kind(),
        }
    }
}
