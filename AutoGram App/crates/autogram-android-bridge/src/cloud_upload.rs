//! Original-document queue adapter. Only app-owned SAF spool files are accepted.
use crate::auth::engine;
use autogram_core::{
    telegram::{
        auth::AuthError,
        upload::transport::TelegramUploadTransport,
    },
    transfer::{
        cloud_download::{AccountScope, PeerKind},
        cloud_upload::*,
    },
};
use grammers_session::types::PeerId;
use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};
use tokio_util::sync::CancellationToken;

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum NativeUploadError {
    #[error("{code}")]
    RequestFailed { code: String, retry_after_ms: u64 },
}
pub(super) fn error(code: &str) -> NativeUploadError {
    NativeUploadError::RequestFailed {
        code: code.into(),
        retry_after_ms: 0,
    }
}
impl From<UploadError> for NativeUploadError {
    fn from(value: UploadError) -> Self {
        let retry_after_ms = match value {
            UploadError::FloodWait { retry_after_ms } => retry_after_ms,
            _ => 0,
        };
        Self::RequestFailed {
            code: value.to_string(),
            retry_after_ms,
        }
    }
}
impl From<AuthError> for NativeUploadError {
    fn from(value: AuthError) -> Self {
        Self::RequestFailed {
            code: value.code,
            retry_after_ms: u64::from(value.retry_after_seconds) * 1000,
        }
    }
}
pub(super) fn scope(account: String) -> Result<AccountScope, NativeUploadError> {
    let user = account
        .strip_prefix("tg_")
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|user| format!("tg_{user}") == account)
        .ok_or_else(|| error("wrong_scope"))?;
    AccountScope::new(account, user).map_err(|_| error("wrong_scope"))
}
pub(super) fn store() -> Result<&'static UploadStore, NativeUploadError> {
    static STORE: OnceLock<UploadStore> = OnceLock::new();
    if let Some(value) = STORE.get() {
        return Ok(value);
    }
    let candidate =
        UploadStore::open(&crate::database_path().map_err(|_| error("runtime_not_initialized"))?)?;
    let _ = STORE.set(candidate);
    STORE.get().ok_or_else(|| error("database"))
}
pub(super) fn staging_root() -> Result<PathBuf, NativeUploadError> {
    let root = crate::STORAGE_DIR
        .read()
        .clone()
        .ok_or_else(|| error("runtime_not_initialized"))?
        .join("cloudtransfer")
        .join("upload-staging");
    std::fs::create_dir_all(&root).map_err(|_| error("io"))?;
    std::fs::canonicalize(root).map_err(|_| error("io"))
}
pub(super) fn staging_source(root: &Path, path: &Path) -> Result<PathBuf, NativeUploadError> {
    let resolved = std::fs::canonicalize(path).map_err(|_| error("io"))?;
    if path != resolved
        || resolved.parent() != Some(root)
        || resolved.extension().and_then(|v| v.to_str()) != Some("staged")
    {
        return Err(error("invalid_source"));
    }
    Ok(resolved)
}
pub(super) fn destination(
    scope: AccountScope,
    dialog: &str,
    topic_id: Option<i32>,
) -> Result<UploadDestination, NativeUploadError> {
    let peer = if dialog == "me" {
        PeerId::user(scope.authorized_user_id())
    } else {
        dialog.parse().ok().and_then(PeerId::from_bot_api_dialog_id)
    }
    .ok_or_else(|| error("invalid_request"))?;
    let peer_kind = match peer.kind() {
        grammers_session::types::PeerKind::User => PeerKind::User,
        grammers_session::types::PeerKind::Chat => PeerKind::Chat,
        grammers_session::types::PeerKind::Channel => PeerKind::Channel,
    };
    let value = UploadDestination {
        scope,
        peer_kind,
        peer_id: peer.bare_id_unchecked(),
        topic_id,
    };
    value.validate()?;
    Ok(value)
}
#[derive(Clone, uniffi::Record)]
pub struct NativeCloudUpload {
    pub operation_id: String,
    pub account_id: String,
    pub peer_id: String,
    pub topic_id: Option<i32>,
    pub filename: String,
    pub state: String,
    pub size: u64,
    pub uploaded_bytes: u64,
    pub message_id: Option<i32>,
    pub error_code: Option<String>,
    pub retry_not_before_ms: Option<i64>,
}
pub(super) fn record(value: UploadRecord) -> NativeCloudUpload {
    NativeCloudUpload {
        operation_id: value.request.operation_id.clone(),
        account_id: value.request.destination.scope.account_id().into(),
        peer_id: value.request.destination.dialog_id(),
        topic_id: value.request.destination.topic_id,
        filename: value.request.filename.clone(),
        state: value.state.as_str().into(),
        size: value.request.source.size,
        uploaded_bytes: value.uploaded_bytes,
        message_id: value.receipt.map(|r| r.message_id),
        error_code: value.error_code,
        retry_not_before_ms: value.retry_not_before_ms,
    }
}
#[uniffi::export]
pub fn cloud_upload_staging_directory() -> Result<String, NativeUploadError> {
    Ok(staging_root()?.to_string_lossy().into_owned())
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn enqueue_cloud_upload(
    operation_id: String,
    account_id: String,
    peer_id: String,
    topic_id: Option<i32>,
    staged_path: String,
    filename: String,
    mime_type: String,
    caption: String,
    silent: bool,
    spoiler: bool,
) -> Result<NativeCloudUpload, NativeUploadError> {
    crate::cloud_upload_enqueue::enqueue(crate::cloud_upload_enqueue::NativeUploadInput {
        operation_id,account_id,peer_id,topic_id,staged_path,filename,mime_type,caption,
    },crate::cloud_upload_enqueue::ProfileChoice::LegacyDocument {silent,spoiler}).await
}
#[uniffi::export]
pub fn list_cloud_uploads(account_id: String) -> Result<Vec<NativeCloudUpload>, NativeUploadError> {
    Ok(store()?
        .list(&scope(account_id)?, 1000)?
        .into_iter()
        .map(record)
        .collect())
}
#[uniffi::export]
pub fn get_cloud_upload(
    account_id: String,
    operation_id: String,
) -> Result<NativeCloudUpload, NativeUploadError> {
    Ok(record(store()?.get(&operation_id, &scope(account_id)?)?))
}
#[uniffi::export]
pub fn recover_cloud_upload(
    account_id: String,
    operation_id: String,
) -> Result<NativeCloudUpload, NativeUploadError> {
    Ok(record(store()?.review_interrupted_commit(
        &operation_id,
        &scope(account_id)?,
    )?))
}
#[uniffi::export]
pub fn pending_cloud_uploads() -> Result<Vec<NativeCloudUpload>, NativeUploadError> {
    Ok(store()?.pending(100)?.into_iter().map(record).collect())
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn reconcile_cloud_upload(account_id: String, operation_id: String) -> Result<NativeCloudUpload, NativeUploadError> {
    let scope = scope(account_id)?;
    let saved = store()?.get(&operation_id, &scope)?;
    if saved.state == UploadState::Completed { return Ok(record(saved)); }
    if saved.state == UploadState::Committing { store()?.review_interrupted_commit(&operation_id, &scope)?; }
    store()?.reconciliation_target(&operation_id, &scope)?;
    let auth = engine().map_err(|_| error("auth_not_initialized"))?;
    let cancel = CancellationToken::new();
    let _cancel_on_drop = cancel.clone().drop_guard();
    let transport = TelegramUploadTransport::connect(auth, scope.clone(), cancel.clone()).await?;
    // Recovery reads a server-mapped message; it does not require the staged source
    // to remain available and cannot enqueue another send.
    Ok(record(UploadExecutor::new(store()?.clone()).reconcile(&operation_id, &scope, &transport, &cancel).await?))
}
#[uniffi::export]
pub fn has_recoverable_cloud_uploads() -> Result<bool, NativeUploadError> {
    Ok(store()?.has_recoverable()?)
}
#[uniffi::export]
pub fn control_cloud_upload(
    account_id: String,
    operation_id: String,
    action: String,
) -> Result<(), NativeUploadError> {
    Ok(store()?.control(&operation_id, &scope(account_id)?, &action)?)
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn start_cloud_upload(
    account_id: String,
    operation_id: String,
) -> Result<NativeCloudUpload, NativeUploadError> {
    let scope = scope(account_id)?;
    let saved = store()?.get(&operation_id, &scope)?;
    if saved.state == UploadState::Completed {
        return Ok(record(saved));
    }
    if saved.state == UploadState::Committing {
        return Ok(record(
            store()?.review_interrupted_commit(&operation_id, &scope)?,
        ));
    }
    if let Err(failure) = staging_source(&staging_root()?, &saved.request.source.path) {
        store()?.fail_preflight(&operation_id, &scope, &UploadError::SourceChanged)?;
        return Err(failure);
    }
    let auth = engine().map_err(|_| error("auth_not_initialized"))?;
    let cancel = CancellationToken::new();
    let _cancel_on_drop = cancel.clone().drop_guard();
    let transport =
        match TelegramUploadTransport::connect(auth, scope.clone(), cancel.clone()).await {
            Ok(transport) => transport,
            Err(failure) => {
                store()?.fail_preflight(&operation_id, &scope, &failure)?;
                return Err(failure.into());
            }
        };
    Ok(record(
        UploadExecutor::new(store()?.clone())
            .run(&operation_id, &scope, &transport, &cancel)
            .await?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn destination_is_exact_and_saved_messages_use_verified_user() {
        let account = scope("tg_123".into()).unwrap();
        assert_eq!(
            destination(account.clone(), "me", None).unwrap().peer_id,
            123
        );
        assert_eq!(
            destination(account.clone(), "-1000000000321", Some(17))
                .unwrap()
                .peer_id,
            321
        );
        assert!(destination(account, "-321", Some(17)).is_err());
        assert!(scope("tg_00123".into()).is_err());
    }
}
