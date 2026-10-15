//! Actual Telegram cloud reads. No session material or cache rows enter these contracts.
mod contracts;
mod delete;
mod pin;
pub mod jpeg;
pub mod metadata;
mod ranges;
pub mod thumbnail;
pub mod topics;
mod workspace;

pub use contracts::*;
pub use jpeg::unstrip_jpeg;
pub(crate) use ranges::fetch_media_range;
pub use thumbnail::{ThumbnailQuality, MAX_THUMBNAIL_BATCH, MAX_THUMBNAIL_BYTES};
pub use workspace::CloudWorkspace;
