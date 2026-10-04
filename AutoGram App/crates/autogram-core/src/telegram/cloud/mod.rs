//! Actual Telegram cloud reads. No session material or cache rows enter these contracts.
mod contracts;
pub mod metadata;
mod ranges;
pub mod thumbnail;
mod workspace;

pub use contracts::*;
pub use thumbnail::{ThumbnailQuality, MAX_THUMBNAIL_BATCH, MAX_THUMBNAIL_BYTES};
pub use workspace::CloudWorkspace;
pub(crate) use ranges::fetch_media_range;
