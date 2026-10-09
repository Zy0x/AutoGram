//! Per-account profiles reuse v4 definitions; queued jobs retain independent snapshots.
mod store;
#[cfg(test)]
mod tests;
mod validation;

use super::{cloud_download::AccountScope, FrozenTransferProfile};
pub use store::ScopedProfileStore;
pub use validation::validate_profile;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopedTransferProfile {
    pub scope: AccountScope,
    pub profile_id: String,
    pub revision: i64,
    pub active: bool,
    pub config: FrozenTransferProfile,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProfileError {
    #[error("invalid_profile")]
    InvalidProfile,
    #[error("profile_not_found")]
    NotFound,
    #[error("profile_conflict")]
    Conflict,
    #[error("profile_database")]
    Database,
}
