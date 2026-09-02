//! Topic Media Service Orchestrator.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;

use super::error::TopicMediaError;
use super::events::emit_delta_event;
use super::models::{
    OpenTopicMediaRequest, OpenTopicMediaResult, TopicMediaContext, TopicMediaCursor,
    TopicMediaDeltaEvent, TopicMediaItem,
};
use super::mtproto::search::search_topic_media;
use super::repository::{get_cached_page, mark_topic_media_deleted, upsert_topic_media_batch};
use super::scheduler::cancellation::ScopedCancellationManager;
use super::scheduler::flood_wait::FloodWaitGateController;
use crate::core::telegram_ops::TelegramIdentity;

pub struct TopicMediaService {
    generation_counter: AtomicU64,
    cancellations: ScopedCancellationManager,
    flood_gates: FloodWaitGateController,
    active_contexts: Arc<Mutex<HashMap<String, TopicMediaContext>>>,
}

/// Return cached message ids that are absent from a successful authoritative
/// Telegram page. This is deliberately scoped to the page/filter that was
/// requested: a partial historical page must never delete rows outside its
/// visible window.
fn stale_cached_message_ids(
    cached_items: &[TopicMediaItem],
    server_items: &[TopicMediaItem],
) -> Vec<i64> {
    let server_ids: HashSet<i64> = server_items.iter().map(|item| item.message_id).collect();
    cached_items
        .iter()
        .map(|item| item.message_id)
        .filter(|id| *id > 0 && !server_ids.contains(id))
        .collect()
}

impl TopicMediaService {
    pub fn new() -> Self {
        Self {
            generation_counter: AtomicU64::new(1),
            cancellations: ScopedCancellationManager::new(),
            flood_gates: FloodWaitGateController::new(),
            active_contexts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn next_generation_id(&self) -> u64 {
        self.generation_counter.fetch_add(1, Ordering::SeqCst)
    }

    pub async fn open_topic_media(
        &self,
        app: AppHandle,
        req: OpenTopicMediaRequest,
        identity: TelegramIdentity,
    ) -> Result<OpenTopicMediaResult, TopicMediaError> {
        let scope_key = format!("{}:{}", req.window_label, req.context.account_id);

        // Cancel previous scope tasks
        self.cancellations.cancel_scope(&scope_key).await;
        let cancel_token = self.cancellations.get_or_create_token(&scope_key).await;

        // Register active context
        {
            let mut contexts = self.active_contexts.lock().await;
            contexts.insert(scope_key.clone(), req.context.clone());
        }

        // 1. Local-First: Load SQLite Cache instantly
        let cached_items = get_cached_page(&req.context, &req.filter_types, None, req.page_size)?;

        let has_cached = !cached_items.is_empty();
        let last_cursor = cached_items.last().map(|item| TopicMediaCursor {
            message_date: item.message_date,
            message_id: item.message_id,
        });

        let initial_source = if has_cached { "cache" } else { "empty" };

        // 2. Spawn Asynchronous Reconciliation via MTProto Server Search
        let service_ctx = req.context.clone();
        let filter_types = req.filter_types.clone();
        let page_size = req.page_size;
        let gen_id = req.generation_id;
        let win_label = req.window_label.clone();
        let cached_items_for_reconcile = cached_items.clone();
        let sessions_dir = crate::core::telegram_ops::sessions_dir_from_env();

        tokio::spawn(async move {
            if cancel_token.is_cancelled() {
                return;
            }

            // Perform MTProto server search via Grammers
            let search_res =
                crate::core::grammers_ops::with_client(&sessions_dir, &identity, true, |client| {
                    let ctx = service_ctx.clone();
                    let filter = filter_types
                        .first()
                        .cloned()
                        .unwrap_or_else(|| "all".to_string());
                    Box::pin(async move {
                        search_topic_media(client, &ctx, &filter, None, page_size)
                            .await
                            .map_err(|e| {
                                crate::core::tg_error::TgError::new(
                                    crate::core::tg_error::TgErrorCode::Internal,
                                    e.to_string(),
                                )
                            })
                    })
                })
                .await;

            if cancel_token.is_cancelled() {
                return;
            }

            if let Ok((server_items, cursor, has_more)) = search_res {
                // A successful Telegram response is authoritative for the
                // requested head page, including an empty page. Reconcile
                // rows that disappeared so deleted Telegram messages cannot
                // leak back through the local-first cache on the next open.
                let stale_ids = stale_cached_message_ids(&cached_items_for_reconcile, &server_items);
                if !stale_ids.is_empty() {
                    let _ = mark_topic_media_deleted(&service_ctx, &stale_ids);
                }
                let cached_ids: HashSet<i64> = cached_items_for_reconcile.iter().map(|item| item.message_id).collect();
                let inserted = server_items
                    .iter()
                    .filter(|item| !cached_ids.contains(&item.message_id))
                    .cloned()
                    .collect();
                let updated = server_items
                    .iter()
                    .filter(|item| cached_ids.contains(&item.message_id))
                    .cloned()
                    .collect();
                let _ = upsert_topic_media_batch(&server_items);

                // Emit even when the server page is empty: the UI needs the
                // ready/deletion event to clear stale cards immediately.
                let event_payload = TopicMediaDeltaEvent {
                    schema_version: 1,
                    window_label: win_label,
                    account_id: service_ctx.account_id,
                    peer_id: service_ctx.peer_id,
                    topic_id: service_ctx.topic_id,
                    generation_id: gen_id,
                    inserted,
                    updated,
                    deleted_message_ids: stale_ids,
                    cursor,
                    has_more,
                    sync_status: "ready".to_string(),
                };

                let _ = emit_delta_event(&app, &event_payload);
            }
        });

        Ok(OpenTopicMediaResult {
            context: req.context,
            generation_id: req.generation_id,
            source: initial_source.to_string(),
            items: cached_items,
            cursor: last_cursor,
            has_more_local: has_cached,
            reconciliation_scheduled: true,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::stale_cached_message_ids;
    use crate::features::topic_media::models::TopicMediaItem;

    fn item(message_id: i64) -> TopicMediaItem {
        TopicMediaItem {
            account_id: "a".into(),
            peer_id: "p".into(),
            topic_id: Some(1),
            message_id,
            message_date: 0,
            edit_date: None,
            grouped_id: None,
            sender_id: None,
            caption: None,
            media_type: "video".into(),
            mime_type: Some("video/mp4".into()),
            file_name: format!("{message_id}.mp4"),
            file_size: 1,
            document_id: None,
            access_hash: None,
            dc_id: None,
            file_reference: None,
            width: None,
            height: None,
            duration_ms: None,
            has_server_thumb: false,
            has_video_thumb: false,
            thumb_url: None,
            is_deleted: false,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn only_missing_ids_in_authoritative_page_are_deleted() {
        let cached = vec![item(1), item(2), item(3)];
        let server = vec![item(1), item(3)];
        assert_eq!(stale_cached_message_ids(&cached, &server), vec![2]);
    }

    #[test]
    fn empty_authoritative_page_deletes_visible_cache_page() {
        let cached = vec![item(10), item(11)];
        assert_eq!(stale_cached_message_ids(&cached, &[]), vec![10, 11]);
    }
}
