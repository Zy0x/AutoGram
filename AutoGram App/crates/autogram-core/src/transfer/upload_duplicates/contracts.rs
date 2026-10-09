use crate::transfer::{
    cloud_download::{CloudDownloadIdentity, DownloadRecord, DownloadState},
    cloud_upload::{UploadDestination, UploadError, UploadFileSnapshot},
};
use async_trait::async_trait;

pub const MAX_DUPLICATE_CANDIDATES: usize = 1000;

/// Only a completed, hash-checked download may supply message/document provenance.
#[derive(Debug, Clone)]
pub struct VerifiedUploadOrigin(CloudDownloadIdentity);
impl VerifiedUploadOrigin {
    pub fn from_download(
        record: &DownloadRecord,
        source: &UploadFileSnapshot,
    ) -> Result<Self, UploadError> {
        source.validate()?;
        if record.state != DownloadState::Completed
            || record.actual_sha256.as_deref() != Some(source.sha256.as_str())
            || record.request.expected_size() != source.size
            || record.checkpoint_bytes != source.size
            || record.request.source().rendition() != "original"
        {
            return Err(UploadError::SourceChanged);
        }
        Ok(Self(record.request.source().clone()))
    }
    pub(super) fn identity(&self) -> &CloudDownloadIdentity {
        &self.0
    }
}

#[derive(Debug, Clone)]
pub struct DuplicateQuery {
    pub destination: UploadDestination,
    pub source: UploadFileSnapshot,
    pub filename: String,
    pub origin: Option<VerifiedUploadOrigin>,
}
impl DuplicateQuery {
    pub fn validate(&self) -> Result<(), UploadError> {
        self.destination.validate()?;
        self.source.validate()?;
        // The shared ledger has account_id but no user_id: require canonical identity.
        if self.destination.scope.account_id()
            != format!("tg_{}", self.destination.scope.authorized_user_id())
        {
            return Err(UploadError::WrongScope);
        }
        if self.filename.is_empty()
            || self.filename.len() > 255
            || self.filename
                != crate::transfer::download::sanitize_download_filename(&self.filename)
        {
            return Err(UploadError::InvalidRequest);
        }
        if self
            .origin
            .as_ref()
            .is_some_and(|origin| origin.identity().scope() != &self.destination.scope)
        {
            return Err(UploadError::WrongScope);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum DuplicateLevel {
    MessageId,
    DocumentId,
    Sha256,
    FilenameSize,
}
impl DuplicateLevel {
    pub fn exact_content(self) -> bool {
        self != Self::FilenameSize
    }
}

#[derive(Debug, Clone)]
pub struct DuplicateCandidate {
    pub message_id: i32,
    pub document_id: i64,
    pub size: u64,
    pub filename: Option<String>,
    pub level: DuplicateLevel,
}

/// Metadata from an exact Telegram read. No request random_id or invented receipt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExistingCloudDocument {
    pub destination: UploadDestination,
    pub message_id: i32,
    pub document_id: i64,
    pub size: u64,
    pub filename: String,
}
#[async_trait]
pub trait DuplicateDocumentSource: Send + Sync {
    fn scope(&self) -> &crate::transfer::cloud_download::AccountScope;
    async fn read_document(
        &self,
        destination: &UploadDestination,
        message_id: i32,
    ) -> Result<Option<ExistingCloudDocument>, UploadError>;
}

#[derive(Debug, Clone)]
pub struct VerifiedDuplicate {
    pub document: ExistingCloudDocument,
    pub level: DuplicateLevel,
}
#[derive(Debug, Clone)]
pub struct DuplicateInspection {
    pub matches: Vec<VerifiedDuplicate>,
    /// Results cover the local scoped upload ledger plus explicit source provenance.
    /// This never claims an exhaustive destination-history scan.
    pub truncated: bool,
    pub unverified_ledger_rows: usize,
    pub stale_candidates: usize,
}
pub(super) struct CandidateBatch {
    pub candidates: Vec<DuplicateCandidate>,
    pub truncated: bool,
    pub unverified_rows: usize,
}
