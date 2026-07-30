//! Topic Media Service Orchestrator.

use std::collections::HashMap;
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
use super::repository::{get_cached_page, upsert_topic_media_batch};
use super::scheduler::cancellation::ScopedCancellationManager;
use super::scheduler::flood_wait::FloodWaitGateController;
use crate::core::telegram_ops::TelegramIdentity;

pub struct TopicMediaService {
    generation_counter: AtomicU64,
    cancellations: ScopedCancellationManager,
    flood_gates: FloodWaitGateController,
    active_contexts: Arc<Mutex<HashMap<String, TopicMediaContext>>>,
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
        let cached_items = get_cached_page(
            &req.context,
            &req.filter_types,
            None,
            req.page_size,
        )?;

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
        let sessions_dir = crate::core::telegram_ops::sessions_dir_from_env();

        tokio::spawn(async move {
            if cancel_token.is_cancelled() {
                return;
            }

            // Perform MTProto server search via Grammers
            let search_res = crate::core::grammers_ops::with_client(
                &sessions_dir,
                &identity,
                true,
                |client| {
                    let ctx = service_ctx.clone();
                    let filter = filter_types.first().cloned().unwrap_or_else(|| "all".to_string());
                    Box::pin(async move {
                        search_topic_media(client, &ctx, &filter, None, page_size)
                            .await
                            .map_err(|e| crate::core::tg_error::TgError::new(
                                crate::core::tg_error::TgErrorCode::Internal,
                                e.to_string(),
                            ))
                    })
                },
            )
            .await;

            if cancel_token.is_cancelled() {
                return;
            }

            if let Ok((server_items, cursor, has_more)) = search_res {
                if !server_items.is_empty() {
                    // Save to SQLite
                    let _ = upsert_topic_media_batch(&server_items);

                    // Emit context-bound delta event to UI
                    let event_payload = TopicMediaDeltaEvent {
                        schema_version: 1,
                        window_label: win_label,
                        account_id: service_ctx.account_id,
                        peer_id: service_ctx.peer_id,
                        topic_id: service_ctx.topic_id,
                        generation_id: gen_id,
                        inserted: server_items,
                        updated: Vec::new(),
                        deleted_message_ids: Vec::new(),
                        cursor,
                        has_more,
                        sync_status: "ready".to_string(),
                    };

                    let _ = emit_delta_event(&app, &event_payload);
                }
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
