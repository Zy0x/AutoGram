//! Typed Android admission and execution for Telegram-native visual photo albums.
use crate::{auth::engine, cloud_upload, cloud_upload::NativeUploadError};
use autogram_core::{
    telegram::{auth::AccountId, upload::album_transport::TelegramAlbumUploadTransport},
    transfer::{
        cloud_album::{
            AlbumUploadError, AlbumUploadExecutor, AlbumUploadRecord, AlbumUploadRequest,
            AlbumUploadState, AlbumUploadStore,
        },
        cloud_upload::{snapshot_upload_file_cancellable, UploadProfileBinding},
    },
};
use std::{path::Path, sync::OnceLock};
use tokio_util::sync::CancellationToken;

#[derive(Clone, uniffi::Record)]
pub struct NativeAlbumItemInput {
    pub staged_path: String,
    pub filename: String,
    pub mime_type: String,
}

#[derive(Clone, uniffi::Record)]
pub struct NativeAlbumInput {
    pub operation_id: String,
    pub account_id: String,
    pub peer_id: String,
    pub topic_id: Option<i32>,
    pub summary_caption: String,
    pub items: Vec<NativeAlbumItemInput>,
}

#[derive(Clone, uniffi::Record)]
pub struct NativeCloudAlbum {
    pub operation_id: String,
    pub account_id: String,
    pub peer_id: String,
    pub topic_id: Option<i32>,
    pub state: String,
    pub item_count: u32,
    pub prepared_items: u32,
    pub total_bytes: u64,
    pub uploaded_bytes: u64,
    pub message_ids: Vec<Option<i32>>,
    pub grouped_id: Option<i64>,
    pub error_code: Option<String>,
}

fn store() -> Result<&'static AlbumUploadStore, NativeUploadError> {
    static STORE: OnceLock<AlbumUploadStore> = OnceLock::new();
    if let Some(value) = STORE.get() {
        return Ok(value);
    }
    let candidate = AlbumUploadStore::open(
        &crate::database_path().map_err(|_| cloud_upload::error("runtime_not_initialized"))?,
    )?;
    let _ = STORE.set(candidate);
    STORE.get().ok_or_else(|| cloud_upload::error("database"))
}

fn record(value: AlbumUploadRecord) -> NativeCloudAlbum {
    let total_bytes = value
        .request
        .items
        .iter()
        .map(|item| item.source.size)
        .sum();
    let uploaded_bytes = value
        .request
        .items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            (value.acknowledged_parts[index] as u64 * 512 * 1024).min(item.source.size)
        })
        .sum();
    NativeCloudAlbum {
        operation_id: value.request.operation_id.clone(),
        account_id: value.request.destination.scope.account_id().into(),
        peer_id: value.request.destination.dialog_id(),
        topic_id: value.request.destination.topic_id,
        state: value.state.as_str().into(),
        item_count: value.request.items.len() as u32,
        prepared_items: value.prepared_items as u32,
        total_bytes,
        uploaded_bytes,
        message_ids: value.mapped_message_ids,
        grouped_id: value.receipt.map(|receipt| receipt.grouped_id),
        error_code: value.error_code,
    }
}

impl From<AlbumUploadError> for NativeUploadError {
    fn from(value: AlbumUploadError) -> Self {
        match value {
            AlbumUploadError::Network => cloud_upload::error("network"),
            AlbumUploadError::Cancelled => cloud_upload::error("operation_cancelled"),
            other => cloud_upload::error(&other.to_string()),
        }
    }
}

#[uniffi::export]
pub fn list_cloud_albums(account_id: String) -> Result<Vec<NativeCloudAlbum>, NativeUploadError> {
    Ok(store()?
        .list(&cloud_upload::scope(account_id)?, 1000)?
        .into_iter()
        .map(record)
        .collect())
}

#[uniffi::export]
pub fn pending_cloud_albums() -> Result<Vec<NativeCloudAlbum>, NativeUploadError> {
    Ok(store()?.pending(100)?.into_iter().map(record).collect())
}

#[uniffi::export]
pub fn has_recoverable_cloud_albums() -> Result<bool, NativeUploadError> {
    Ok(store()?.has_recoverable()?)
}

#[uniffi::export]
pub fn get_cloud_album(
    account_id: String,
    operation_id: String,
) -> Result<NativeCloudAlbum, NativeUploadError> {
    Ok(record(
        store()?.get(&operation_id, &cloud_upload::scope(account_id)?)?,
    ))
}

#[uniffi::export]
pub fn control_cloud_album(
    account_id: String,
    operation_id: String,
    action: String,
) -> Result<NativeCloudAlbum, NativeUploadError> {
    let control = match action.as_str() {
        "pause" => Some("pause"),
        "resume" => None,
        "cancel" => Some("cancel"),
        _ => return Err(cloud_upload::error("invalid_request")),
    };
    Ok(record(store()?.set_control(
        &operation_id,
        &cloud_upload::scope(account_id)?,
        control,
    )?))
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn enqueue_cloud_album(
    input: NativeAlbumInput,
    profile_id: Option<String>,
) -> Result<NativeCloudAlbum, NativeUploadError> {
    let scope = cloud_upload::scope(input.account_id.clone())?;
    let destination = cloud_upload::destination(scope.clone(), &input.peer_id, input.topic_id)?;
    let current = store()?;
    match current.get(&input.operation_id, &scope) {
        Ok(existing) => {
            if matches_existing(&existing.request, &input, &destination).await? {
                return Ok(record(existing));
            }
            return Err(cloud_upload::error("operation_conflict"));
        }
        Err(AlbumUploadError::NotFound) => {}
        Err(error) => return Err(error.into()),
    }
    if !(2..=10).contains(&input.items.len()) {
        return Err(cloud_upload::error("invalid_request"));
    }
    let auth = engine().map_err(|_| cloud_upload::error("auth_not_initialized"))?;
    let account = AccountId(input.account_id.clone());
    auth.validate_selected_account(&account).await?;
    let selected_revision = auth.selected_job_revision();
    let profile_store =
        crate::transfer_profiles::store().map_err(|_| cloud_upload::error("profile_database"))?;
    let selected = match profile_id.as_deref() {
        Some(id) => profile_store.get(&scope, id),
        None => profile_store.active(&scope).and_then(|value| {
            value.ok_or(autogram_core::transfer::scoped_profiles::ProfileError::NotFound)
        }),
    }
    .map_err(|error| cloud_upload::error(&error.to_string()))?;
    if !selected.config.group_as_album
        || selected.config.presentation_override
            == autogram_core::transfer::PresentationOverride::ForceDocument
    {
        return Err(cloud_upload::error("unsupported_profile"));
    }
    let profile_binding = Some(UploadProfileBinding {
        profile_id: selected.profile_id.clone(),
        revision: selected.revision,
    });
    let staging_root = cloud_upload::staging_root()?;
    let cancel = CancellationToken::new();
    let _cancel_on_drop = cancel.clone().drop_guard();
    let mut items = Vec::with_capacity(input.items.len());
    for item in &input.items {
        let path = cloud_upload::staging_source(&staging_root, Path::new(&item.staged_path))?;
        let hash_cancel = cancel.clone();
        let snapshot = tokio::task::spawn_blocking(move || {
            snapshot_upload_file_cancellable(&path, &hash_cancel)
        })
        .await
        .map_err(|_| cloud_upload::error("io"))??;
        items.push((snapshot, item.filename.clone(), item.mime_type.clone()));
    }
    let request = AlbumUploadRequest::new(
        input.operation_id,
        destination,
        items,
        input.summary_caption,
        selected.config,
        profile_binding,
    )?;
    let transport =
        TelegramAlbumUploadTransport::connect(auth, scope.clone(), cancel.clone()).await?;
    autogram_core::transfer::cloud_album::AlbumUploadTransport::validate_destination(
        &transport, &request,
    )
    .await?;
    let admitted = auth.commit_selected_job(&account, selected_revision, || {
        current.enqueue(request).map_err(NativeUploadError::from)
    })?;
    Ok(record(admitted))
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn start_cloud_album(
    account_id: String,
    operation_id: String,
) -> Result<NativeCloudAlbum, NativeUploadError> {
    let scope = cloud_upload::scope(account_id)?;
    let saved = store()?.get(&operation_id, &scope)?;
    if matches!(
        saved.state,
        AlbumUploadState::Completed | AlbumUploadState::Paused | AlbumUploadState::Cancelled
    ) {
        return Ok(record(saved));
    }
    if saved.state == AlbumUploadState::Committing {
        return Ok(record(store()?.require_review(
            &operation_id,
            &scope,
            "unknown_commit",
        )?));
    }
    let root = cloud_upload::staging_root()?;
    for item in &saved.request.items {
        let path = cloud_upload::staging_source(&root, &item.source.path)?;
        if path != item.source.path {
            return Err(cloud_upload::error("invalid_source"));
        }
    }
    let auth = engine().map_err(|_| cloud_upload::error("auth_not_initialized"))?;
    let cancel = CancellationToken::new();
    let _cancel_on_drop = cancel.clone().drop_guard();
    let transport =
        TelegramAlbumUploadTransport::connect(auth, scope.clone(), cancel.clone()).await?;
    Ok(record(
        AlbumUploadExecutor::new(store()?.clone())
            .run(&operation_id, &scope, &transport, &cancel)
            .await?,
    ))
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn reconcile_cloud_album(
    account_id: String,
    operation_id: String,
) -> Result<NativeCloudAlbum, NativeUploadError> {
    let scope = cloud_upload::scope(account_id)?;
    let saved = store()?.get(&operation_id, &scope)?;
    if saved.state == AlbumUploadState::Completed {
        return Ok(record(saved));
    }
    if saved.state != AlbumUploadState::ReviewRequired {
        return Err(cloud_upload::error("invalid_state"));
    }
    let auth = engine().map_err(|_| cloud_upload::error("auth_not_initialized"))?;
    let cancel = CancellationToken::new();
    let _cancel_on_drop = cancel.clone().drop_guard();
    let transport = TelegramAlbumUploadTransport::connect(auth, scope.clone(), cancel).await?;
    Ok(record(
        AlbumUploadExecutor::new(store()?.clone())
            .reconcile(&operation_id, &scope, &transport)
            .await?,
    ))
}

async fn matches_existing(
    saved: &AlbumUploadRequest,
    input: &NativeAlbumInput,
    destination: &autogram_core::transfer::cloud_upload::UploadDestination,
) -> Result<bool, NativeUploadError> {
    if saved.destination != *destination
        || saved.summary_caption != input.summary_caption
        || saved.items.len() != input.items.len()
    {
        return Ok(false);
    }
    let root = cloud_upload::staging_root()?;
    for (saved_item, input_item) in saved.items.iter().zip(&input.items) {
        let path = cloud_upload::staging_source(&root, Path::new(&input_item.staged_path))?;
        if saved_item.source.path != path
            || saved_item.filename != input_item.filename
            || saved_item.mime_type != input_item.mime_type
        {
            return Ok(false);
        }
        let hash_cancel = CancellationToken::new();
        let snapshot = tokio::task::spawn_blocking(move || {
            snapshot_upload_file_cancellable(&path, &hash_cancel)
        })
        .await
        .map_err(|_| cloud_upload::error("io"))??;
        if saved_item.source != snapshot {
            return Ok(false);
        }
    }
    Ok(true)
}
