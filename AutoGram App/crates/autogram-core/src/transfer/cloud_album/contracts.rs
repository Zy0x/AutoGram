use crate::transfer::{
    cloud_upload::{UploadDestination, UploadFileSnapshot, UploadProfileBinding},
    FrozenTransferProfile, PresentationOverride,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const TELEGRAM_VISUAL_ALBUM_MAX: usize = 10;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AlbumUploadItem {
    pub index: usize,
    pub source: UploadFileSnapshot,
    pub filename: String,
    pub mime_type: String,
    pub random_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AlbumUploadRequest {
    pub operation_id: String,
    pub destination: UploadDestination,
    pub items: Vec<AlbumUploadItem>,
    pub summary_caption: String,
    pub profile: FrozenTransferProfile,
    pub profile_binding: Option<UploadProfileBinding>,
}

impl AlbumUploadRequest {
    pub fn new(
        operation_id: String,
        destination: UploadDestination,
        sources: Vec<(UploadFileSnapshot, String, String)>,
        summary_caption: String,
        profile: FrozenTransferProfile,
        profile_binding: Option<UploadProfileBinding>,
    ) -> Result<Self, AlbumUploadError> {
        if !(2..=TELEGRAM_VISUAL_ALBUM_MAX).contains(&sources.len())
            || summary_caption.encode_utf16().count() > 1024
            || !is_operation_id(&operation_id)
            || !profile.group_as_album
            || profile.presentation_override == PresentationOverride::ForceDocument
            || profile.schema_version != 1
            || profile_binding.as_ref().is_some_and(|binding| {
                binding.revision <= 0
                    || binding.profile_id.is_empty()
                    || binding.profile_id.len() > 128
                    || !binding
                        .profile_id
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
            })
        {
            return Err(AlbumUploadError::InvalidRequest);
        }
        destination
            .validate()
            .map_err(|_| AlbumUploadError::InvalidRequest)?;

        let mut items = Vec::with_capacity(sources.len());
        for (index, (source, filename, mime_type)) in sources.into_iter().enumerate() {
            source
                .validate()
                .map_err(|_| AlbumUploadError::InvalidRequest)?;
            if !source.path.is_absolute()
                || filename.is_empty()
                || filename.len() > 255
                || filename != crate::transfer::download::sanitize_download_filename(&filename)
                || !is_visual_media(&filename, &mime_type)
            {
                return Err(AlbumUploadError::InvalidRequest);
            }
            items.push(AlbumUploadItem {
                index,
                source,
                filename,
                mime_type,
                random_id: random_nonzero_unique(&items),
            });
        }
        let value = Self {
            operation_id,
            destination,
            items,
            summary_caption,
            profile,
            profile_binding,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), AlbumUploadError> {
        if !is_operation_id(&self.operation_id)
            || !(2..=TELEGRAM_VISUAL_ALBUM_MAX).contains(&self.items.len())
            || self.summary_caption.encode_utf16().count() > 1024
            || !self.profile.group_as_album
            || self.profile.presentation_override == PresentationOverride::ForceDocument
            || self.profile.schema_version != 1
            || self.profile_binding.as_ref().is_some_and(|binding| {
                binding.revision <= 0
                    || binding.profile_id.is_empty()
                    || binding.profile_id.len() > 128
                    || !binding
                        .profile_id
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
            })
            || self.items.iter().enumerate().any(|(index, item)| {
                item.index != index
                    || item.random_id == 0
                    || self.items[..index]
                        .iter()
                        .any(|prior| prior.random_id == item.random_id)
                    || item.source.validate().is_err()
                    || !item.source.path.is_absolute()
                    || item.filename.is_empty()
                    || item.filename.len() > 255
                    || item.filename
                        != crate::transfer::download::sanitize_download_filename(&item.filename)
                    || !is_visual_media(&item.filename, &item.mime_type)
            })
        {
            return Err(AlbumUploadError::InvalidRequest);
        }
        self.destination
            .validate()
            .map_err(|_| AlbumUploadError::InvalidRequest)
    }

    /// Native visual albums carry one summary caption on the first surviving item only.
    pub fn item_caption(&self, index: usize) -> Option<&str> {
        self.items.get(index)?;
        Some(if index == 0 {
            self.summary_caption.as_str()
        } else {
            ""
        })
    }
}

fn is_operation_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
}

fn is_visual_media(filename: &str, mime_type: &str) -> bool {
    let ext = Path::new(filename)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match mime_type {
        "image/jpeg" => matches!(ext.as_str(), "jpg" | "jpeg"),
        // The current Android bridge has no verified video probing/attributes adapter.
        // Reject videos until duration, dimensions and streamability come from MediaCodec.
        "video/mp4" => false,
        _ => false,
    }
}

fn random_nonzero_unique(items: &[AlbumUploadItem]) -> i64 {
    loop {
        let candidate: i64 = rand::random();
        if candidate != 0 && items.iter().all(|item| item.random_id != candidate) {
            return candidate;
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlbumUploadState {
    Queued,
    Preparing,
    Committing,
    Paused,
    ReviewRequired,
    Completed,
    Failed,
    Cancelled,
}

impl AlbumUploadState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Preparing => "preparing",
            Self::Committing => "committing",
            Self::Paused => "paused",
            Self::ReviewRequired => "review_required",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
    pub(crate) fn parse(value: &str) -> Result<Self, AlbumUploadError> {
        match value {
            "queued" => Ok(Self::Queued),
            "preparing" => Ok(Self::Preparing),
            "committing" => Ok(Self::Committing),
            "paused" => Ok(Self::Paused),
            "review_required" => Ok(Self::ReviewRequired),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err(AlbumUploadError::Database),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AlbumUploadReceipt {
    pub destination: UploadDestination,
    pub grouped_id: i64,
    pub message_ids: Vec<i32>,
}

#[derive(Debug, Clone)]
pub struct AlbumUploadRecord {
    pub request: AlbumUploadRequest,
    pub state: AlbumUploadState,
    pub prepared_items: usize,
    pub mapped_message_ids: Vec<Option<i32>>,
    pub upload_file_ids: Vec<Option<i64>>,
    pub acknowledged_parts: Vec<usize>,
    pub receipt: Option<AlbumUploadReceipt>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AlbumUploadError {
    #[error("invalid_request")]
    InvalidRequest,
    #[error("database")]
    Database,
    #[error("not_found")]
    NotFound,
    #[error("operation_conflict")]
    Conflict,
    #[error("wrong_scope")]
    WrongScope,
    #[error("invalid_state")]
    InvalidState,
    #[error("review_required")]
    ReviewRequired,
    #[error("operation_cancelled")]
    Cancelled,
    #[error("source_changed")]
    SourceChanged,
    #[error("io")]
    Io,
    #[error("network")]
    Network,
    #[error("rejected")]
    Rejected,
}

impl From<crate::transfer::cloud_upload::UploadError> for AlbumUploadError {
    fn from(value: crate::transfer::cloud_upload::UploadError) -> Self {
        use crate::transfer::cloud_upload::UploadError;
        match value {
            UploadError::Cancelled => Self::Cancelled,
            UploadError::SourceChanged => Self::SourceChanged,
            UploadError::Network => Self::Network,
            UploadError::Io => Self::Io,
            UploadError::WrongScope => Self::WrongScope,
            _ => Self::InvalidRequest,
        }
    }
}

pub fn validate_album_receipt(
    request: &AlbumUploadRequest,
    receipt: &AlbumUploadReceipt,
) -> Result<(), AlbumUploadError> {
    if receipt.destination != request.destination
        || receipt.grouped_id == 0
        || receipt.message_ids.len() != request.items.len()
        || receipt.message_ids.iter().any(|id| *id <= 0)
        || receipt
            .message_ids
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != receipt.message_ids.len()
    {
        return Err(AlbumUploadError::ReviewRequired);
    }
    Ok(())
}
