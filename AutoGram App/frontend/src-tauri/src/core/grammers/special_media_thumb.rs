//! Specialized Async Background Thumbnail Processor for Special/Edge-Case Media.
//!
//! Operates on Tier-2 background priority: when a video lacks a static Telegram thumbnail,
//! the main engine immediately renders a Smart Card to maintain 60 FPS scrolling.
//! This module quietly processes edge-case media in the background (using HTTP Range Bridge
//! to fetch head + tail MP4 moov atoms) and emits a Tauri event to update the card smoothly.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tokio::sync::mpsc;

use super::ffmpeg::{
    extract_ffmpeg_frame_sync, get_ffmpeg_capabilities, is_fallback_black_card_bytes,
};
use super::thumbnail_range_bridge::fetch_range_bytes;
use super::thumbs::{make_faststart_mp4, to_data_url};
use crate::core::tg_log;

const BACKEND: &str = "special_media_thumb";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialThumbResolvedPayload {
    pub session: String,
    pub peer_id: String,
    pub telegram_message_id: i32,
    pub url: String,
}

#[derive(Clone)]
pub struct SpecialThumbItem {
    pub session: String,
    pub peer_id: String,
    pub telegram_message_id: i32,
    pub q_mode: String,
    pub client: grammers_client::Client,
    pub media: grammers_client::media::Media,
}

static PENDING_ITEMS: Mutex<Option<mpsc::Sender<SpecialThumbItem>>> = Mutex::new(None);
static PROCESSED_KEYS: Mutex<Option<HashSet<String>>> = Mutex::new(None);
static RESOLVED_CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
static FAILED_UNTIL: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);

fn processed_keys() -> &'static Mutex<Option<HashSet<String>>> {
    &PROCESSED_KEYS
}

fn resolved_cache() -> &'static Mutex<Option<HashMap<String, String>>> {
    &RESOLVED_CACHE
}

fn failed_until() -> &'static Mutex<Option<HashMap<String, Instant>>> {
    &FAILED_UNTIL
}

/// Enqueues a video document for low-priority background keyframe extraction.
/// Returns immediately without blocking the primary loading pipeline.
pub fn enqueue_special_media_item(
    app_handle: Option<tauri::AppHandle>,
    client: grammers_client::Client,
    session: String,
    peer_str: String,
    mid: i32,
    q_mode: String,
    media: grammers_client::media::Media,
) {
    let key = format!("{}:{}:{}", session, peer_str, mid);

    // A failed range probe is retryable, but use a short cooldown to avoid a
    // remount loop hammering Telegram/FFmpeg while the card remains visible.
    {
        let now = Instant::now();
        let mut failed_lock = failed_until().lock();
        let failed = failed_lock.get_or_insert_with(HashMap::new);
        failed.retain(|_, until| *until > now);
        if failed.contains_key(&key) {
            return;
        }
    }

    // Check if already processed or cached
    {
        let mut p_lock = processed_keys().lock();
        let set = p_lock.get_or_insert_with(HashSet::new);
        if set.contains(&key) {
            return;
        }
        set.insert(key.clone());
    }

    let mut sender_lock = PENDING_ITEMS.lock();
    if sender_lock.is_none() {
        // Bound the queue: loading a large folder must not create an unbounded
        // backlog of FFmpeg/range jobs that survives after cards leave view.
        let (tx, mut rx) = mpsc::channel::<SpecialThumbItem>(24);
        *sender_lock = Some(tx);

        let app = app_handle.clone();
        tokio::spawn(async move {
            while let Some(item) = rx.recv().await {
                if get_ffmpeg_capabilities().is_none() {
                    continue;
                }

                let total_size = item.media.size().unwrap_or(0) as u64;
                let session = item.session.clone();
                let peer_id = item.peer_id.clone();
                let mid = item.telegram_message_id;
                let item_key = format!("{}:{}:{}", session, peer_id, mid);

                tg_log::info(
                    BACKEND,
                    "special_thumb_bg_start",
                    format!(
                        "op=special_thumb_bg_start peer_id={} message_id={}",
                        peer_id, mid
                    ),
                );

                let mut resolved_url: Option<String> = None;

                if let Some(rem) = super::super::session_rate::flood_remaining_secs(&peer_id) {
                    if rem > 0 {
                        tokio::time::sleep(Duration::from_secs(u64::from(rem).min(10))).await;
                    }
                }

                if total_size > 0 {
                    let sample_len = (2 * 1024 * 1024usize).min(total_size as usize);
                    let tail_start = total_size.saturating_sub(sample_len as u64);
                    let head = fetch_range_bytes(
                        &item.client,
                        &item.media,
                        0,
                        sample_len,
                        total_size,
                        &item.peer_id,
                    )
                    .await;
                    let tail = fetch_range_bytes(
                        &item.client,
                        &item.media,
                        tail_start,
                        sample_len,
                        total_size,
                        &item.peer_id,
                    )
                    .await;

                    if let (Ok(head_bytes), Ok(tail_bytes)) = (head, tail) {
                        if let Some(faststart_bytes) = make_faststart_mp4(&head_bytes, &tail_bytes)
                        {
                            let q_mode = item.q_mode.clone();
                            let frame_res = tokio::time::timeout(
                                Duration::from_secs(10),
                                tokio::task::spawn_blocking(move || {
                                    extract_ffmpeg_frame_sync(&faststart_bytes, &q_mode, "mp4")
                                }),
                            )
                            .await;

                            if let Ok(Ok(Some(frame_bytes))) = frame_res {
                                if frame_bytes.len() >= 64
                                    && !is_fallback_black_card_bytes(&frame_bytes)
                                {
                                    if let Some(url) = to_data_url(&frame_bytes) {
                                        tg_log::info(
                                    BACKEND,
                                    "special_thumb_bg_success",
                                    format!("op=special_thumb_bg_success peer_id={} message_id={} bytes={}", peer_id, mid, frame_bytes.len()),
                                );
                                        resolved_url = Some(url);
                                    }
                                }
                            }
                        }
                    }
                }

                if let Some(url) = resolved_url {
                    {
                        let mut cache_lock = resolved_cache().lock();
                        let cache = cache_lock.get_or_insert_with(HashMap::new);
                        cache.insert(item_key.clone(), url.clone());
                    }

                    if let Some(ref handle) = app {
                        let payload = SpecialThumbResolvedPayload {
                            session: session.clone(),
                            peer_id: peer_id.clone(),
                            telegram_message_id: mid,
                            url: url.clone(),
                        };
                        let _ = handle.emit("special-thumb-resolved", payload);
                        let _ = handle.emit(
                            "thumb_single_ready",
                            super::thumbs::ThumbSinglePayload {
                                session: session.clone(),
                                chat_id: peer_id.clone(),
                                message_id: mid as i64,
                                quality: item.q_mode.clone(),
                                url: url.clone(),
                                is_placeholder: false,
                            },
                        );
                    }
                } else {
                    processed_keys()
                        .lock()
                        .get_or_insert_with(HashSet::new)
                        .remove(&item_key);
                    failed_until()
                        .lock()
                        .get_or_insert_with(HashMap::new)
                        .insert(item_key, Instant::now() + Duration::from_secs(30));
                }

                // Yield to prevent CPU/IO spikes
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        });
    }

    if let Some(ref tx) = *sender_lock {
        let send_result = tx.try_send(SpecialThumbItem {
            session,
            peer_id: peer_str,
            telegram_message_id: mid,
            q_mode,
            client,
            media,
        });
        if send_result.is_err() {
            processed_keys()
                .lock()
                .get_or_insert_with(HashSet::new)
                .remove(&key);
        }
    }
}

/// Retrieves a cached special thumbnail if resolved in the background.
pub fn get_cached_special_thumb(session: &str, peer_str: &str, mid: i32) -> Option<String> {
    let key = format!("{}:{}:{}", session, peer_str, mid);
    let lock = resolved_cache().lock();
    lock.as_ref().and_then(|c| c.get(&key).cloned())
}
