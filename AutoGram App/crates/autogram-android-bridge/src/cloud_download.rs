//! Real durable downloads; legacy Android metadata task rows are never executed.
use crate::auth::engine;
use autogram_core::{telegram::{auth::AccountId, download_source::TelegramDownloadSource},
    transfer::cloud_download::*};
use std::{path::PathBuf, sync::OnceLock};
use tokio_util::sync::CancellationToken;

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum NativeDownloadError {
    #[error("{code}")]
    RequestFailed { code: String, retry_after_ms: u64 },
}
fn error(code: &str) -> NativeDownloadError {
    NativeDownloadError::RequestFailed { code: code.into(), retry_after_ms: 0 }
}
impl From<DownloadError> for NativeDownloadError {
    fn from(value: DownloadError) -> Self {
        let retry_after_ms = match &value {
            DownloadError::Source(SourceFailure::FloodWait { retry_after_ms }) => *retry_after_ms,
            _ => 0,
        };
        Self::RequestFailed { code: value.code().into(), retry_after_ms }
    }
}
impl From<SourceFailure> for NativeDownloadError {
    fn from(value: SourceFailure) -> Self { DownloadError::Source(value).into() }
}

pub(super) fn store() -> Result<&'static DownloadStore, NativeDownloadError> {
    static STORE: OnceLock<DownloadStore> = OnceLock::new();
    if let Some(store) = STORE.get() { return Ok(store); }
    let path = crate::database_path().map_err(|_| error("runtime_not_initialized"))?;
    let candidate = DownloadStore::open(&path)?;
    let _ = STORE.set(candidate);
    STORE.get().ok_or_else(|| error("database"))
}
fn scope(account: String) -> Result<AccountScope, NativeDownloadError> {
    let user = account.strip_prefix("tg_").and_then(|v| v.parse::<i64>().ok())
        .filter(|user| format!("tg_{user}") == account).ok_or_else(|| error("wrong_scope"))?;
    Ok(AccountScope::new(account, user)?)
}
fn root() -> Result<PathBuf, NativeDownloadError> {
    let root = crate::STORAGE_DIR.read().clone().ok_or_else(|| error("runtime_not_initialized"))?;
    let directory = root.join("cloudtransfer").join("staging");
    std::fs::create_dir_all(&directory).map_err(|_| error("io"))?;
    std::fs::canonicalize(directory).map_err(|_| error("io"))
}

#[derive(Clone, uniffi::Record)]
pub struct NativeCloudDownload {
    pub operation_id: String,
    pub account_id: String,
    pub message_id: i32,
    pub state: String,
    pub size: u64,
    pub processed_bytes: u64,
    pub sha256: Option<String>,
    pub completed_file: Option<String>,
    pub error_code: Option<String>,
    pub retry_not_before_ms: Option<u64>,
}
fn record(value: DownloadRecord) -> NativeCloudDownload {
    NativeCloudDownload {
        operation_id: value.request.operation_id().into(),
        account_id: value.request.source().scope().account_id().into(),
        message_id: value.request.source().message_id(),
        state: value.state.as_str().into(), size: value.request.expected_size(),
        processed_bytes: value.checkpoint_bytes, sha256: value.actual_sha256.clone(),
        completed_file: (value.state == DownloadState::Completed)
            .then(|| value.request.output_path().to_string_lossy().into_owned()),
        error_code: value.error_code.clone(), retry_not_before_ms: value.retry_not_before_ms(),
    }
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn enqueue_cloud_download(account_id: String, peer_id: String, topic_id: Option<i32>,
    message_id: i32) -> Result<NativeCloudDownload, NativeDownloadError> {
    let auth = engine().map_err(|_| error("auth_not_initialized"))?;
    // Stale interactive requests cannot create a job for a different selected account.
    auth.validate_selected_account(&AccountId(account_id.clone())).await
        .map_err(|e| error(&e.code))?;
    let source = TelegramDownloadSource::connect(auth, scope(account_id)?, CancellationToken::new()).await?;
    let target = source.target_dialog(&peer_id, topic_id, message_id).await?;
    let operation = uuid::Uuid::new_v4().simple().to_string();
    let directory = root()?;
    let request = DownloadRequest::new(operation.clone(), target.clone(), target.expected_size(), None,
        directory.join(format!("{operation}.part")), directory.join(format!("{operation}.verified")))?;
    Ok(record(store()?.enqueue(request)?))
}

#[uniffi::export]
pub fn list_cloud_downloads(account_id: String) -> Result<Vec<NativeCloudDownload>, NativeDownloadError> {
    Ok(store()?.list(&scope(account_id)?, "", 1000)?.into_iter().map(record).collect())
}
#[uniffi::export]
pub fn pending_cloud_downloads() -> Result<Vec<NativeCloudDownload>, NativeDownloadError> {
    Ok(store()?.pending(100)?.into_iter().map(record).collect())
}
#[uniffi::export]
pub fn has_recoverable_cloud_downloads() -> Result<bool, NativeDownloadError> {
    Ok(store()?.has_recoverable_jobs()?)
}
#[uniffi::export]
pub fn get_cloud_download(account_id: String, operation_id: String) -> Result<NativeCloudDownload, NativeDownloadError> {
    Ok(record(store()?.get(&operation_id, &scope(account_id)?)?))
}
#[uniffi::export]
pub fn control_cloud_download(account_id: String, operation_id: String, action: String) -> Result<(), NativeDownloadError> {
    let scope = scope(account_id)?;
    match action.as_str() {
        "pause" => store()?.pause(&operation_id, &scope)?,
        "cancel" => store()?.cancel(&operation_id, &scope)?,
        "retry" => store()?.retry(&operation_id, &scope)?,
        _ => return Err(error("invalid_request")),
    }
    Ok(())
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn run_cloud_download(account_id: String, operation_id: String) -> Result<NativeCloudDownload, NativeDownloadError> {
    let scope = scope(account_id)?;
    let saved = store()?.get(&operation_id, &scope)?;
    let auth = engine().map_err(|_| error("auth_not_initialized"))?;
    let executor = DownloadExecutor::new(store()?.clone());
    let source = match TelegramDownloadSource::connect(auth, scope.clone(), CancellationToken::new()).await {
        Ok(source) => source,
        Err(failure) => {
            executor.fail_source_preflight(&operation_id, &scope, failure).await?;
            return Err(failure.into());
        }
    };
    let result = if matches!(saved.state, DownloadState::Running | DownloadState::Publishing) {
        executor.recover(&operation_id, &scope, &source).await?
    } else { executor.run(&operation_id, &scope, &source).await? };
    Ok(record(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scope_is_exact_not_inventory_authorization() {
        assert!(scope("tg_123".into()).is_ok());
        assert!(scope("tg_00123".into()).is_err());
        assert!(scope("tg_-1".into()).is_err());
        assert!(scope("old_local_account".into()).is_err());
    }
}
