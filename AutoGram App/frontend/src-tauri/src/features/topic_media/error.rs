//! Error types for Topic Media Engine.

use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TopicMediaError {
    InvalidContext(String),
    UnsupportedSession(String),
    NotAuthorized,
    PeerUnavailable(String),
    TopicUnavailable(String),
    SearchRejected(String),
    FloodWait { seconds: u64 },
    FileReferenceExpired,
    FileReferenceInvalid,
    FileMigrate { dc_id: i32 },
    CdnRedirect,
    RangeInvalid,
    DownloadCancelled,
    DecodeUnsupported,
    DecodeTimeout,
    DecodeBudgetExceeded,
    CorruptMedia,
    DatabaseBusy,
    DatabaseCorrupt,
    CacheWriteFailed,
    StaleGeneration,
    Internal(String),
}

impl fmt::Display for TopicMediaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidContext(msg) => write!(f, "Invalid context: {msg}"),
            Self::UnsupportedSession(msg) => write!(f, "Unsupported session: {msg}"),
            Self::NotAuthorized => write!(f, "Not authorized"),
            Self::PeerUnavailable(msg) => write!(f, "Peer unavailable: {msg}"),
            Self::TopicUnavailable(msg) => write!(f, "Topic unavailable: {msg}"),
            Self::SearchRejected(msg) => write!(f, "Search rejected: {msg}"),
            Self::FloodWait { seconds } => write!(f, "Flood wait: {seconds}s"),
            Self::FileReferenceExpired => write!(f, "File reference expired"),
            Self::FileReferenceInvalid => write!(f, "File reference invalid"),
            Self::FileMigrate { dc_id } => write!(f, "File migrate to DC {dc_id}"),
            Self::CdnRedirect => write!(f, "CDN redirect required"),
            Self::RangeInvalid => write!(f, "Range invalid"),
            Self::DownloadCancelled => write!(f, "Download cancelled"),
            Self::DecodeUnsupported => write!(f, "Decode unsupported"),
            Self::DecodeTimeout => write!(f, "Decode timeout"),
            Self::DecodeBudgetExceeded => write!(f, "Decode budget exceeded"),
            Self::CorruptMedia => write!(f, "Corrupt media"),
            Self::DatabaseBusy => write!(f, "Database busy"),
            Self::DatabaseCorrupt => write!(f, "Database corrupt"),
            Self::CacheWriteFailed => write!(f, "Cache write failed"),
            Self::StaleGeneration => write!(f, "Stale generation request"),
            Self::Internal(msg) => write!(f, "Internal error: {msg}"),
        }
    }
}

impl std::error::Error for TopicMediaError {}

impl From<rusqlite::Error> for TopicMediaError {
    fn from(err: rusqlite::Error) -> Self {
        Self::Internal(format!("SQLite error: {err}"))
    }
}
