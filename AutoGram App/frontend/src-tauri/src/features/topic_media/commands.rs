//! Tauri IPC commands for Topic Media feature.

use std::sync::OnceLock;
use tauri::{AppHandle, State};

use super::error::TopicMediaError;
use super::models::{
    OpenTopicMediaRequest, OpenTopicMediaResult, TopicMediaContext, TopicMediaCursor,
    TopicMediaItem,
};
use super::repository::get_cached_page;
use super::service::TopicMediaService;
use crate::core::telegram_ops::{ok_result, err_result, OpResult, TelegramIdentity};

pub static TOPIC_MEDIA_SERVICE: OnceLock<TopicMediaService> = OnceLock::new();

pub fn get_service() -> &'static TopicMediaService {
    TOPIC_MEDIA_SERVICE.get_or_init(TopicMediaService::new)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTopicMediaIpcPayload {
    pub window_label: String,
    pub session: String,
    pub api_id: i32,
    pub api_hash: String,
    pub account_id: String,
    pub peer_id: String,
    pub topic_id: i64,
    pub filter_types: Option<Vec<String>>,
    pub page_size: Option<usize>,
}

#[tauri::command]
pub async fn tg_open_topic_media(
    app: AppHandle,
    payload: OpenTopicMediaIpcPayload,
) -> Result<OpResult<OpenTopicMediaResult>, String> {
    let service = get_service();
    let gen_id = service.next_generation_id();

    let identity = TelegramIdentity {
        session: payload.session,
        api_id: payload.api_id as i64,
        api_hash: payload.api_hash,
    };

    let req = OpenTopicMediaRequest {
        window_label: payload.window_label,
        generation_id: gen_id,
        context: TopicMediaContext {
            account_id: payload.account_id,
            peer_id: payload.peer_id,
            topic_id: payload.topic_id,
        },
        filter_types: payload.filter_types.unwrap_or_default(),
        page_size: payload.page_size.unwrap_or(40),
    };

    match service.open_topic_media(app, req, identity).await {
        Ok(res) => Ok(ok_result("grammers", res)),
        Err(e) => Ok(err_result("grammers", crate::core::tg_error::TgError::new(
            crate::core::tg_error::TgErrorCode::Internal,
            e.to_string(),
        ))),
    }
}

#[tauri::command]
pub async fn tg_load_more_topic_media(
    account_id: String,
    peer_id: String,
    topic_id: i64,
    cursor: Option<TopicMediaCursor>,
    page_size: Option<usize>,
) -> Result<OpResult<Vec<TopicMediaItem>>, String> {
    let ctx = TopicMediaContext {
        account_id,
        peer_id,
        topic_id,
    };

    match get_cached_page(&ctx, &[], cursor, page_size.unwrap_or(40)) {
        Ok(items) => Ok(ok_result("grammers", items)),
        Err(e) => Ok(err_result("grammers", crate::core::tg_error::TgError::new(
            crate::core::tg_error::TgErrorCode::Internal,
            e.to_string(),
        ))),
    }
}
