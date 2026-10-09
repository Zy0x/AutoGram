//! Selected-account guarded mutations; queued jobs consume independent snapshots.
use crate::{auth::engine, cloud_upload::scope, transfer_profile_types::*};
use autogram_core::{
    telegram::auth::{AccountId, AuthError},
    transfer::{
        cloud_download::AccountScope,
        scoped_profiles::{ProfileError, ScopedProfileStore},
    },
};
use std::sync::OnceLock;

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum NativeProfileError {
    #[error("{code}")]
    RequestFailed { code: String },
}
impl From<ProfileError> for NativeProfileError {
    fn from(value: ProfileError) -> Self {
        Self::RequestFailed {
            code: value.to_string(),
        }
    }
}
impl From<AuthError> for NativeProfileError {
    fn from(value: AuthError) -> Self {
        error(&value.code)
    }
}
fn error(code: &str) -> NativeProfileError {
    NativeProfileError::RequestFailed { code: code.into() }
}
pub(super) fn store() -> Result<&'static ScopedProfileStore, NativeProfileError> {
    static STORE: OnceLock<ScopedProfileStore> = OnceLock::new();
    if let Some(value) = STORE.get() {
        return Ok(value);
    }
    let candidate = ScopedProfileStore::open(
        &crate::database_path().map_err(|_| error("runtime_not_initialized"))?,
    )?;
    let _ = STORE.set(candidate);
    STORE.get().ok_or_else(|| error("profile_database"))
}
fn guarded<T>(
    account_id: String,
    action: impl FnOnce(AccountScope) -> Result<T, NativeProfileError>,
) -> Result<T, NativeProfileError> {
    let scope = scope(account_id.clone()).map_err(|_| error("wrong_scope"))?;
    let auth = engine().map_err(|_| error("auth_not_initialized"))?;
    let revision = auth.selected_job_revision();
    auth.commit_selected_job(&AccountId(account_id), revision, || action(scope))
}
#[uniffi::export]
pub fn list_transfer_profiles(
    account_id: String,
) -> Result<Vec<NativeTransferProfile>, NativeProfileError> {
    guarded(account_id, |scope| {
        store()?
            .list(&scope)?
            .into_iter()
            .map(|p| NativeTransferProfile::from_core(p).map_err(Into::into))
            .collect()
    })
}
#[uniffi::export]
pub fn active_transfer_profile(
    account_id: String,
) -> Result<Option<NativeTransferProfile>, NativeProfileError> {
    guarded(account_id, |scope| {
        store()?
            .active(&scope)?
            .map(NativeTransferProfile::from_core)
            .transpose()
            .map_err(Into::into)
    })
}
#[uniffi::export]
pub fn save_transfer_profile(
    account_id: String,
    profile_id: String,
    expected_revision: i64,
    settings: NativeTransferSettings,
) -> Result<NativeTransferProfile, NativeProfileError> {
    let config = settings.into_core()?;
    guarded(account_id, |scope| {
        Ok(NativeTransferProfile::from_core(store()?.save(
            &scope,
            &profile_id,
            expected_revision,
            config,
        )?)?)
    })
}
#[uniffi::export]
pub fn select_transfer_profile(
    account_id: String,
    profile_id: String,
    expected_revision: i64,
) -> Result<(), NativeProfileError> {
    guarded(account_id, |scope| {
        Ok(store()?.select(&scope, &profile_id, expected_revision)?)
    })
}
#[uniffi::export]
pub fn delete_transfer_profile(
    account_id: String,
    profile_id: String,
    expected_revision: i64,
) -> Result<(), NativeProfileError> {
    guarded(account_id, |scope| {
        Ok(store()?.remove(&scope, &profile_id, expected_revision)?)
    })
}
