//! Specialized Async Background Thumbnail Processor for Special/Edge-Case Media.
//!
//! Operates on Tier-2 background priority: when a video lacks a static Telegram thumbnail,
//! the main engine immediately renders a Smart Card to maintain 60 FPS scrolling.
//! This module quietly processes edge-case media in the background (using HTTP Range Bridge
//! to fetch head + tail MP4 moov atoms) and emits a Tauri event to update the card smoothly.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::mpsc;

use crate::core::tg_log;
use super::ffmpeg::{extract_ffmpeg_frame_from_url, get_ffmpeg_capabilities, is_fallback_black_card_bytes};
use super::thumbnail_range_bridge::spawn_range_bridge;
use super::thumbs::to_data_url;

const BACKEND: &str = "special_media_thumb";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialThumbResolvedPayload {
    pub peer_id: String,
    pub telegram_message_id: i32,
    pub url: String,
}

#[derive(Clone)]
pub struct SpecialThumbItem {
    pub peer_id: String,
    pub telegram_message_id: i32,
    pub q_mode: String,
    pub client: grammers_client::Client,
    pub media: grammers_client::media::Media,
}

static PENDING_ITEMS: Mutex<Option<mpsc::UnboundedSender<SpecialThumbItem>>> = Mutex::new(None);
static PROCESSED_KEYS: Mutex<Option<HashSet<String>>> = Mutex::new(None);
static RESOLVED_CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn processed_keys() -> &'static Mutex<Option<HashSet<String>>> {
    &PROCESSED_KEYS
}

fn resolved_cache() -> &'static Mutex<Option<HashMap<String, String>>> {
    &RESOLVED_CACHE
}

/// Enqueues a video document for low-priority background keyframe extraction.
/// Returns immediately without blocking the primary loading pipeline.
pub fn enqueue_special_media_item(
    app_handle: Option<tauri::AppHandle>,
    client: grammers_client::Client,
    peer_str: String,
    mid: i32,
    q_mode: String,
    media: grammers_client::media::Media,
) {
    let key = format!("{}:{}", peer_str, mid);

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
        let (tx, mut rx) = mpsc::unbounded_channel::<SpecialThumbItem>();
        *sender_lock = Some(tx);

        let app = app_handle.clone();
        tokio::spawn(async move {
            let rt_handle = tokio::runtime::Handle::current();
            while let Some(item) = rx.recv().await {
                if get_ffmpeg_capabilities().is_none() {
                    continue;
                }

                let total_size = item.media.size().unwrap_or(0) as u64;
                let max_budget = 16 * 1024 * 1024; // 16 MB budget for background tail probing
                let peer_id = item.peer_id.clone();
                let mid = item.telegram_message_id;

                tg_log::info(
                    BACKEND,
                    "special_thumb_bg_start",
                    format!("op=special_thumb_bg_start peer_id={} message_id={}", peer_id, mid),
                );

                let mut resolved_url: Option<String> = None;

                if let Some(bridge) = spawn_range_bridge(&rt_handle, item.client.clone(), item.media.clone(), total_size, max_budget) {
                    let probe_url = bridge.url.clone();
                    let q_mode = item.q_mode.clone();

                    let frame_res = tokio::time::timeout(
                        Duration::from_secs(12),
                        tokio::task::spawn_blocking(move || {
                            extract_ffmpeg_frame_from_url(&probe_url, &q_mode, false)
                        })
                    ).await;

                    if let Ok(Ok(Some(frame_bytes))) = frame_res {
                        if frame_bytes.len() >= 64 && !is_fallback_black_card_bytes(&frame_bytes) {
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

                // Guaranteed Fallback: If FFmpeg range extraction returned None or timed out,
                // generate a high-quality video visual poster data URL so EVERY media item
                // guarantees a visual thumbnail image.
                if resolved_url.is_none() {
                    tg_log::info(
                        BACKEND,
                        "special_thumb_guaranteed_poster",
                        format!("op=special_thumb_guaranteed_poster peer_id={} message_id={}", peer_id, mid),
                    );
                    resolved_url = Some(generate_guaranteed_video_poster_url(&peer_id, mid));
                }

                if let Some(url) = resolved_url {
                    let item_key = format!("{}:{}", peer_id, mid);
                    {
                        let mut cache_lock = resolved_cache().lock();
                        let cache = cache_lock.get_or_insert_with(HashMap::new);
                        cache.insert(item_key, url.clone());
                    }

                    if let Some(ref handle) = app {
                        let payload = SpecialThumbResolvedPayload {
                            peer_id: peer_id.clone(),
                            telegram_message_id: mid,
                            url: url.clone(),
                        };
                        let _ = handle.emit("special-thumb-resolved", payload);
                    }
                }

                // Yield to prevent CPU/IO spikes
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        });
    }

    if let Some(ref tx) = *sender_lock {
        let _ = tx.send(SpecialThumbItem {
            peer_id: peer_str,
            telegram_message_id: mid,
            q_mode,
            client,
            media,
        });
    }
}

/// Retrieves a cached special thumbnail if resolved in the background.
pub fn get_cached_special_thumb(peer_str: &str, mid: i32) -> Option<String> {
    let key = format!("{}:{}", peer_str, mid);
    let lock = resolved_cache().lock();
    lock.as_ref().and_then(|c| c.get(&key).cloned())
}

/// Generates an elegant visual SVG video poster data URL as a guaranteed fallback.
fn generate_guaranteed_video_poster_url(_peer_id: &str, mid: i32) -> String {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#181825"/>
      <stop offset="50%" stop-color="#2a2a3e"/>
      <stop offset="100%" stop-color="#0f0f17"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#89b4fa"/>
      <stop offset="100%" stop-color="#cba6f7"/>
    </linearGradient>
  </defs>
  <rect width="320" height="180" rx="8" fill="url(#bg)"/>
  <circle cx="160" cy="80" r="28" fill="#1e1e2e" stroke="url(#accent)" stroke-width="2.5" opacity="0.9"/>
  <polygon points="153,68 173,80 153,92" fill="#89b4fa"/>
  <g fill="#89b4fa" opacity="0.35">
    <rect x="40" y="130" width="4" height="20" rx="2"/>
    <rect x="50" y="120" width="4" height="30" rx="2"/>
    <rect x="60" y="135" width="4" height="15" rx="2"/>
    <rect x="70" y="125" width="4" height="25" rx="2"/>
    <rect x="240" y="125" width="4" height="25" rx="2"/>
    <rect x="250" y="115" width="4" height="35" rx="2"/>
    <rect x="260" y="130" width="4" height="20" rx="2"/>
    <rect x="270" y="120" width="4" height="30" rx="2"/>
  </g>
  <rect x="108" y="132" width="104" height="18" rx="9" fill="#11111b" opacity="0.75"/>
  <text x="160" y="145" font-family="system-ui, sans-serif" font-size="10" font-weight="600" fill="#cdd6f4" text-anchor="middle">VIDEO PREVIEW #{MID}</text>
</svg>"##.replace("{MID}", &mid.to_string());
    let b64_svg = B64.encode(svg.as_bytes());
    format!("data:image/svg+xml;base64,{}", b64_svg)
}
