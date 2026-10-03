//! Actual Telegram cloud reads. No session material or cache rows enter these contracts.
mod contracts;
pub mod metadata;
mod ranges;
mod workspace;

pub use contracts::*;
pub use workspace::CloudWorkspace;
pub(crate) use ranges::fetch_media_range;
