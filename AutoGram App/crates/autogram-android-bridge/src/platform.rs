//! Platform evidence exposed without arbitrary filesystem access or invented defaults.
use super::{AutoGramBridgeError, STORAGE_DIR};

#[uniffi::export]
pub fn get_available_storage_bytes() -> Result<u64, AutoGramBridgeError> {
    let root = STORAGE_DIR.read().clone().ok_or_else(|| AutoGramBridgeError::InternalError {
        msg: "runtime_not_initialized".into(),
    })?;
    let path = root.to_str().ok_or_else(|| AutoGramBridgeError::InternalError {
        msg: "invalid_storage_path".into(),
    })?;
    autogram_core::platform::storage_space::available_storage_bytes(path)
        .map_err(|_| AutoGramBridgeError::InternalError { msg: "storage_capacity_unavailable".into() })
}
