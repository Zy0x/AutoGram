//! Typed Android adapter for shared Telegram cloud reads.
use crate::auth::{engine, NativeAuthError};
use autogram_core::telegram::{auth::AccountId, cloud::*};
use std::sync::OnceLock;

pub(crate) fn workspace() -> &'static CloudWorkspace {
    static WORKSPACE: OnceLock<CloudWorkspace> = OnceLock::new();
    WORKSPACE.get_or_init(CloudWorkspace::default)
}

#[derive(Clone, uniffi::Record)]
pub struct NativeCloudDialog {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub photo_key: Option<String>,
    pub avatar_bytes: Option<Vec<u8>>,
}
#[derive(Clone, uniffi::Record)]
pub struct NativeCloudDialogPage {
    pub account_id: String,
    pub items: Vec<NativeCloudDialog>,
    pub next_cursor: Option<String>,
}
#[derive(Clone, uniffi::Record)]
pub struct NativeCloudMedia {
    pub id: i32,
    pub name: String,
    pub size: u64,
    pub mime_type: String,
    pub modified_ms: i64,
    pub delivery_kind: String,
    pub telegram_category: String,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub duration_seconds: Option<f64>,
    pub thumbnail_bytes: Option<Vec<u8>>,
}
impl From<metadata::MediaMetadata> for NativeCloudMedia {
    fn from(item: metadata::MediaMetadata) -> Self {
        Self {
            id: item.id,
            name: item.name,
            size: item.size,
            mime_type: item.mime_type,
            modified_ms: item.modified_ms,
            delivery_kind: item.delivery_kind,
            telegram_category: item.telegram_category,
            width: item.width,
            height: item.height,
            duration_seconds: item.duration_seconds,
            thumbnail_bytes: item.thumbnail_bytes,
        }
    }
}
#[derive(Clone, uniffi::Record)]
pub struct NativeCloudMediaPage {
    pub account_id: String,
    pub peer_id: String,
    pub items: Vec<NativeCloudMedia>,
    pub next_offset: Option<i32>,
}
#[derive(Clone, uniffi::Record)]
pub struct NativeCloudThumbnail {
    pub message_id: i32,
    pub thumbnail_bytes: Vec<u8>,
}

#[derive(Clone, uniffi::Record)]
pub struct NativeCloudStream {
    pub id: String,
    pub account_id: String,
    pub peer_id: String,
    pub message_id: i32,
    pub size: u64,
    pub mime_type: String,
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn list_cloud_dialogs(
    account_id: String,
    cursor: Option<String>,
) -> Result<NativeCloudDialogPage, NativeAuthError> {
    let page = workspace()
        .list_dialogs(engine()?, AccountId(account_id), cursor)
        .await?;
    Ok(NativeCloudDialogPage {
        account_id: page.account_id,
        next_cursor: page.next_cursor,
        items: page
            .items
            .into_iter()
            .map(|item| NativeCloudDialog {
                id: item.id,
                title: item.title,
                kind: item.kind,
                photo_key: item.photo_key,
                avatar_bytes: item.avatar_bytes,
            })
            .collect(),
    })
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn fetch_cloud_avatar(account_id: String, peer_id: String,
    photo_key: String) -> Result<Vec<u8>, NativeAuthError> {
    Ok(workspace().fetch_avatar(engine()?, AccountId(account_id), peer_id, photo_key).await?)
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn list_cloud_media(
    account_id: String,
    peer_id: String,
    before_message_id: i32,
    query: String,
) -> Result<NativeCloudMediaPage, NativeAuthError> {
    let page = workspace()
        .list_media(
            engine()?,
            AccountId(account_id),
            peer_id,
            before_message_id,
            query,
        )
        .await?;
    Ok(NativeCloudMediaPage {
        account_id: page.account_id,
        peer_id: page.peer_id,
        items: page.items.into_iter().map(Into::into).collect(),
        next_offset: page.next_offset,
    })
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn open_cloud_media_stream(
    account_id: String,
    peer_id: String,
    message_id: i32,
) -> Result<NativeCloudStream, NativeAuthError> {
    let stream = workspace()
        .open_stream(engine()?, AccountId(account_id), peer_id, message_id)
        .await?;
    Ok(NativeCloudStream {
        id: stream.id,
        account_id: stream.account_id,
        peer_id: stream.peer_id,
        message_id: stream.message_id,
        size: stream.size,
        mime_type: stream.mime_type,
    })
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn read_cloud_media_range(
    account_id: String,
    stream_id: String,
    offset: u64,
    length: u32,
) -> Result<Vec<u8>, NativeAuthError> {
    Ok(workspace()
        .read_stream(engine()?, AccountId(account_id), stream_id, offset, length)
        .await?)
}
#[uniffi::export]
pub fn close_cloud_media_stream(
    account_id: String,
    stream_id: String,
) -> Result<(), NativeAuthError> {
    Ok(workspace().close_stream(&AccountId(account_id), &stream_id)?)
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn fetch_cloud_thumbnails(
    account_id: String,
    peer_id: String,
    message_ids: Vec<i32>,
    quality: String,
) -> Result<Vec<NativeCloudThumbnail>, NativeAuthError> {
    let items = workspace()
        .fetch_thumbnails(
            engine()?,
            AccountId(account_id),
            peer_id,
            message_ids,
            &quality,
        )
        .await?;
    Ok(items
        .into_iter()
        .map(|item| NativeCloudThumbnail {
            message_id: item.message_id,
            thumbnail_bytes: item.thumbnail_bytes,
        })
        .collect())
}
