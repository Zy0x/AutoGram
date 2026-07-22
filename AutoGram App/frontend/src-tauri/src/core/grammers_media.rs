//! Grammers media helpers: adaptive progressive fill, thumbnails, documents, and topics.
//! Desktop preview is served by the native Rust Range HTTP registry.

use std::collections::HashMap;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use grammers_client::media::{Downloadable, Media, PhotoSize};
use grammers_client::tl;
use grammers_client::Client;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use super::grammers_ops::{
    obtain_live_client, persist_memory_session, resolve_peer, runtime, with_client, with_pool_retry,
};
use super::path_policy;
use super::session_rate;
use super::stream_server::{self, StreamEntry};
use super::telegram_ops::TelegramIdentity;
use super::tg_error::{map_invocation, TgError, TgErrorCode};
use super::tg_log;

const BACKEND: &str = "grammers";
/// Section
const PROGRESSIVE_MAX: u64 = 4 * 1024 * 1024 * 1024;
/// Section
const THUMB_TARGET_MAX: usize = 96 * 1024;

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn cache_root(sessions_dir: &Path) -> PathBuf {
    // Section
    sessions_dir
        .parent()
        .map(|p| p.join("cache"))
        .unwrap_or_else(|| PathBuf::from("cache"))
}

fn preview_dir(sessions_dir: &Path) -> PathBuf {
    cache_root(sessions_dir).join("preview")
}

fn thumb_dir(sessions_dir: &Path) -> PathBuf {
    cache_root(sessions_dir).join("thumbs")
}

// Section

fn cancel_flags() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static MAP: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Section
/// Section
fn seek_requests() -> &'static Mutex<HashMap<String, u64>> {
    static REQUESTS: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    REQUESTS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn request_progressive_range(stream_id: &str, offset: u64) -> bool {
    if !cancel_flags().lock().contains_key(stream_id) {
        return false;
    }
    seek_requests().lock().insert(stream_id.to_string(), offset);
    true
}

fn take_seek_request(stream_id: &str) -> Option<u64> {
    seek_requests().lock().remove(stream_id)
}

fn first_missing_offset(ranges: &[(u64, u64)], total: u64) -> Option<u64> {
    let mut sorted = ranges.to_vec();
    sorted.sort_unstable_by_key(|range| range.0);
    let mut covered = 0u64;
    for (start, end) in sorted {
        if start > covered {
            return Some(covered);
        }
        covered = covered.max(end);
        if covered >= total {
            return None;
        }
    }
    (covered < total).then_some(covered)
}

fn register_cancel(sid: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    cancel_flags().lock().insert(sid.to_string(), flag.clone());
    flag
}

fn take_cancel(sid: &str) -> Option<Arc<AtomicBool>> {
    cancel_flags().lock().remove(sid)
}

pub fn cancel_progressive(stream_id: &str) -> bool {
    seek_requests().lock().remove(stream_id);
    let mut hit = false;
    if let Some(f) = cancel_flags().lock().get(stream_id) {
        f.store(true, Ordering::SeqCst);
        hit = true;
    }
    if let Some(mut e) = stream_server::get_entry(stream_id) {
        e.cancelled = true;
        e.paused = true;
        stream_server::upsert_entry(e);
        hit = true;
    }
    hit
}

// Section

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicRow {
    pub id: i64,
    pub title: String,
    pub top_message: Option<i64>,
    pub closed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTopicsResult {
    pub status: String,
    pub topics: Vec<TopicRow>,
    pub is_forum: bool,
    pub cached: bool,
    pub backend: String,
}

pub fn list_topics_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: i64,
) -> Result<ListTopicsResult, TgError> {
    let rt = runtime()?;
    let chat = chat_id.to_string();
    rt.block_on(async {
        with_pool_retry(&identity.session, || {
            let chat = chat.clone();
            with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client.is_authorized().await.map_err(|e| map_invocation(&e))? {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
                let input: tl::enums::InputPeer = peer.into();
                let req = tl::functions::messages::GetForumTopics {
                    peer: input,
                    q: None,
                    offset_date: 0,
                    offset_id: 0,
                    offset_topic: 0,
                    limit: 100,
                };
                match client.invoke(&req).await {
                    Ok(tl::enums::messages::ForumTopics::Topics(pack)) => {
                        let mut topics = Vec::new();
                        for t in pack.topics {
                            match t {
                                tl::enums::ForumTopic::Topic(ft) => {
                                    topics.push(TopicRow {
                                        id: ft.id as i64,
                                        title: if ft.title.is_empty() {
                                            format!("Topic {}", ft.id)
                                        } else {
                                            ft.title
                                        },
                                        top_message: if ft.top_message > 0 {
                                            Some(ft.top_message as i64)
                                        } else {
                                            None
                                        },
                                        closed: ft.closed,
                                    });
                                }
                                tl::enums::ForumTopic::Deleted(d) => {
                                    topics.push(TopicRow {
                                        id: d.id as i64,
                                        title: format!("Deleted {}", d.id),
                                        top_message: None,
                                        closed: true,
                                    });
                                }
                            }
                        }
                        topics.sort_by(|a, b| {
                            let ao = if a.id == 1 { 0 } else { 1 };
                            let bo = if b.id == 1 { 0 } else { 1 };
                            ao.cmp(&bo)
                                .then_with(|| a.title.to_ascii_lowercase().cmp(&b.title.to_ascii_lowercase()))
                        });
                        tg_log::info(
                            BACKEND,
                            "list_topics",
                            format!("chat={chat_id} n={}", topics.len()),
                        );
                        Ok(ListTopicsResult {
                            status: "success".into(),
                            topics,
                            is_forum: true,
                            cached: false,
                            backend: BACKEND.into(),
                        })
                    }
                    Err(e) => {
                        // Section
                        let msg = e.to_string().to_ascii_lowercase();
                        if msg.contains("forum")
                            || msg.contains("topic")
                            || msg.contains("chat_id")
                            || msg.contains("channel")
                            || msg.contains("peer")
                        {
                            tg_log::info(
                                BACKEND,
                                "list_topics_not_forum",
                                format!("chat={chat_id}"),
                            );
                            return Ok(ListTopicsResult {
                                status: "success".into(),
                                topics: vec![],
                                is_forum: false,
                                cached: false,
                                backend: BACKEND.into(),
                            });
                        }
                        Err(map_invocation(&e))
                    }
                }
            })
            })
        })
        .await
    })
}

// ----------------------------------------------------------------------------
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbSinglePayload {
    pub chat_id: String,
    pub message_id: i64,
    pub quality: String,
    pub url: String,
    pub is_placeholder: bool,
}

// Thumbnails
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbsBatchResult {
    pub status: String,
    pub thumbs: HashMap<String, Option<String>>,
    pub backend: String,
}

fn thumb_mem_cache() -> &'static Mutex<HashMap<String, String>> {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::with_capacity(10000)))
}

fn unstrip_jpeg(data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < 3 || data[0] != 0x01 {
        return None;
    }
    let w = data[1] as usize;
    let h = data[2] as usize;
    let scan = &data[3..];
    let mut header = vec![
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
        0x00, 0x60, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x28, 0x1c, 0x1e, 0x23, 0x1e, 0x19, 0x28,
        0x23, 0x21, 0x23, 0x2d, 0x2a, 0x28, 0x30, 0x3c, 0x64, 0x41, 0x3c, 0x37, 0x37, 0x3c, 0x7b, 0x58,
        0x5d, 0x49, 0x64, 0x91, 0x80, 0x99, 0x96, 0x8f, 0x80, 0x8c, 0x8a, 0xa0, 0xb4, 0xe6, 0xc3, 0xa0,
        0xaa, 0xda, 0xad, 0x8a, 0x8c, 0xc8, 0xff, 0x8c, 0xdc, 0xf0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0xff, 0xff, 0xdb, 0x00, 0x43, 0x01, 0x2b, 0x2d, 0x2d, 0x3c, 0x35, 0x3c, 0x76, 0x41, 0x41,
        0x76, 0xf8, 0xa5, 0x8c, 0xa5, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8,
        0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8,
        0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8,
        0xff, 0xc0, 0x00, 0x11, 0x08, (h & 0xff) as u8, (w & 0xff) as u8, 0x03, 0x01, 0x21, 0x00, 0x02,
        0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01,
        0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
        0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03, 0x03,
        0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00, 0x04,
        0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81,
        0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82,
        0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36,
        0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56,
        0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76,
        0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95,
        0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3,
        0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca,
        0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7,
        0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xc4, 0x00,
        0x1f, 0x01, 0x00, 0x03, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4,
        0x00, 0xb5, 0x11, 0x00, 0x02, 0x01, 0x02, 0x04, 0x04, 0x03, 0x04, 0x07, 0x05, 0x04, 0x04, 0x00,
        0x01, 0x02, 0x77, 0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51,
        0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23,
        0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18,
        0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
        0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65,
        0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84,
        0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2,
        0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9,
        0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7,
        0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5,
        0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11,
        0x00, 0x3f, 0x00,
    ];
    header.extend_from_slice(scan);
    header.push(0xff);
    header.push(0xd9);
    Some(header)
}

fn pick_thumb(sizes: &[PhotoSize], quality: &str) -> Option<PhotoSize> {
    let mode = quality.to_lowercase();
    let saver = mode.contains("hemat") || mode.contains("saver");
    let sharp = mode.contains("jelas") || mode.contains("sharp");

    // Hemat / Saver: prefer free inline stripped/cached (tiny).
    if saver {
        for s in sizes {
            if s.to_data().is_some() {
                match s {
                    PhotoSize::Cached(_) | PhotoSize::Stripped(_) => return Some(s.clone()),
                    _ => {}
                }
            }
        }
        // Fall through to smallest downloadable if no inline
    }

    // Filter static downloadable layers (ordered by Telegram from smallest to largest resolution)
    let downloadable: Vec<&PhotoSize> = sizes
        .iter()
        .filter(|s| matches!(s, PhotoSize::Size(_) | PhotoSize::Progressive(_)))
        .collect();

    if !downloadable.is_empty() {
        if sharp {
            // Jelas: largest static layer available in Telegram
            return downloadable.last().map(|s| (*s).clone());
        }
        if saver {
            // Hemat downloadable fallback: smallest non-stripped layer
            return downloadable.first().map(|s| (*s).clone());
        }
        // Seimbang: upper-mid / clear medium layer (~320px-800px)
        let len = downloadable.len();
        if len <= 2 {
            return downloadable.last().map(|s| (*s).clone());
        }
        // len >= 3: pick upper-mid static layer (e.g. index 2 out of 4)
        let idx = (len * 2 / 3).min(len - 1);
        return downloadable.get(idx).map(|s| (*s).clone());
    }

    // No downloadable static layer: saver accepts stripped as final
    if saver {
        for s in sizes {
            if s.to_data().is_some() {
                return Some(s.clone());
            }
        }
    }

    // For seimbang/jelas, return None so download_media_thumb falls back to photo chunk / FFmpeg frame
    None
}

fn media_thumbs(media: &Media) -> Vec<PhotoSize> {
    match media {
        Media::Photo(p) => p.thumbs(),
        Media::Document(d) => d.thumbs(),
        Media::Sticker(s) => s.document.thumbs(),
        _ => vec![],
    }
}

/// Inline stripped JPEG (Telegram mini-thumb) as data-URL — no network GetFile.
/// Used by list_media so the grid paints like the official app on first paint.
pub fn stripped_thumb_data_url(media: &Media) -> Option<String> {
    for s in media_thumbs(media) {
        if let Some(data) = s.to_data() {
            let bytes = unstrip_jpeg(&data).unwrap_or(data);
            if !bytes.is_empty() {
                if let Some(url) = to_data_url(&bytes) {
                    return Some(url);
                }
            }
        }
    }
    None
}

async fn download_thumb_bytes(client: &Client, thumb: &PhotoSize) -> Result<Vec<u8>, TgError> {
    if let Some(data) = thumb.to_data() {
        if let Some(unstripped) = unstrip_jpeg(&data) {
            return Ok(unstripped);
        }
        return Ok(data);
    }
    let mut out = Vec::new();
    let mut iter = client.iter_download(thumb).chunk_size(64 * 1024);
    while let Some(chunk) = iter.next().await.map_err(|e| map_invocation(&e))? {
        out.extend_from_slice(&chunk);
        if out.len() > 512 * 1024 {
            break;
        }
    }
    Ok(out)
}

async fn download_media_thumb(
    client: &Client,
    media: &Media,
    quality: &str,
) -> Result<Vec<u8>, TgError> {
    let sizes = media_thumbs(media);
    let mode = quality.to_lowercase();
    let saver = mode.contains("hemat") || mode.contains("saver");

    // Tier 1: Try selected quality size
    if let Some(pick) = pick_thumb(&sizes, quality) {
        if let Ok(bytes) = download_thumb_bytes(client, &pick).await {
            // Reject tiny stripped payloads for seimbang/jelas (look blurry on grid)
            let min_ok = if saver { 32 } else { 2_500 };
            if bytes.len() >= min_ok {
                return Ok(bytes);
            }
        }
    }

    // Tier 2: Inline stripped only for Saver mode
    if saver {
        for s in &sizes {
            if let Some(data) = s.to_data() {
                let bytes = unstrip_jpeg(&data).unwrap_or(data);
                if !bytes.is_empty() {
                    return Ok(bytes);
                }
            }
        }
    }

    // Tier 3: Any downloadable size (largest-first for non-saver)
    let mut downloadable: Vec<&PhotoSize> = sizes
        .iter()
        .filter(|s| matches!(s, PhotoSize::Size(_) | PhotoSize::Progressive(_)))
        .collect();
    if !saver {
        downloadable.reverse();
    }
    for s in downloadable {
        if let Ok(bytes) = download_thumb_bytes(client, s).await {
            if bytes.len() >= 2_500 || saver {
                return Ok(bytes);
            }
        }
    }

    // Tier 4: Fallback for photos (download first chunk)
    if let Media::Photo(p) = media {
        let mode = quality.to_lowercase();
        let sharp = mode.contains("jelas") || mode.contains("sharp");
        let max_bytes = if sharp { 512 * 1024 } else if saver { 64 * 1024 } else { 256 * 1024 };
        let mut out = Vec::new();
        let mut iter = client.iter_download(p).chunk_size(64 * 1024);
        while let Some(chunk) = iter.next().await.map_err(|e| map_invocation(&e))? {
            out.extend_from_slice(&chunk);
            if out.len() >= max_bytes {
                break;
            }
        }
        if !out.is_empty() {
            return Ok(out);
        }
    }

    // Tier 5: Fallback for Documents (videos/photos uploaded "as file" without Telegram static thumbs)
    if let Media::Document(d) = media {
        let mime = d.mime_type().unwrap_or("").to_lowercase();
        let name = d.name().unwrap_or("").to_lowercase();
        let is_video = mime.starts_with("video/")
            || name.ends_with(".mp4")
            || name.ends_with(".mov")
            || name.ends_with(".mkv")
            || name.ends_with(".webm")
            || name.ends_with(".avi")
            || name.ends_with(".m4v")
            || name.ends_with(".3gp");
        let is_image = mime.starts_with("image/")
            || name.ends_with(".jpg")
            || name.ends_with(".jpeg")
            || name.ends_with(".png")
            || name.ends_with(".webp")
            || name.ends_with(".bmp");

        if is_image {
            let mode = quality.to_lowercase();
            let sharp = mode.contains("jelas") || mode.contains("sharp");
            let max_bytes = if sharp { 512 * 1024 } else if saver { 64 * 1024 } else { 256 * 1024 };
            let mut out = Vec::new();
            let mut iter = client.iter_download(d).chunk_size(64 * 1024);
            while let Some(chunk) = iter.next().await.map_err(|e| map_invocation(&e))? {
                out.extend_from_slice(&chunk);
                if out.len() >= max_bytes {
                    break;
                }
            }
            if !out.is_empty() {
                return Ok(out);
            }
        } else if is_video {
            let mode = quality.to_lowercase();
            let sharp = mode.contains("jelas") || mode.contains("sharp");
            let max_sample = if sharp { 4096 * 1024 } else if saver { 1536 * 1024 } else { 2560 * 1024 };
            let mut sample_bytes = Vec::new();
            // Download sample bytes (up to 4MB for high-res FFmpeg frame extraction)
            let mut iter = client.iter_download(d).chunk_size(128 * 1024);
            while let Some(chunk) = iter.next().await.map_err(|e| map_invocation(&e))? {
                sample_bytes.extend_from_slice(&chunk);
                if sample_bytes.len() >= max_sample {
                    break;
                }
            }
            if !sample_bytes.is_empty() {
                if let Some(frame_bytes) = extract_ffmpeg_frame_sync(&sample_bytes, quality) {
                    return Ok(frame_bytes);
                }
            }
        }
    }

    Err(TgError::new(TgErrorCode::Internal, "no valid thumb found"))
}

pub(crate) fn find_ffmpeg_binary() -> Option<std::path::PathBuf> {
    if let Some(path) = which_path("ffmpeg") {
        return Some(path);
    }
    let mut search_dirs = Vec::new();
    if let Ok(cd) = std::env::current_dir() {
        let mut cur = Some(cd.as_path());
        while let Some(dir) = cur {
            search_dirs.push(dir.to_path_buf());
            cur = dir.parent();
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.parent();
        while let Some(dir) = cur {
            search_dirs.push(dir.to_path_buf());
            cur = dir.parent();
        }
    }

    let sub_paths = [
        "worker/venv/Lib/site-packages/imageio_ffmpeg/binaries",
        "AutoGram App/worker/venv/Lib/site-packages/imageio_ffmpeg/binaries",
        "../worker/venv/Lib/site-packages/imageio_ffmpeg/binaries",
    ];

    for base in &search_dirs {
        for sub in &sub_paths {
            let candidate_dir = base.join(sub);
            if candidate_dir.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&candidate_dir) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.is_file() {
                            let name = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                            if name.starts_with("ffmpeg") && (name.ends_with(".exe") || !cfg!(windows)) {
                                return Some(p);
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

fn which_path(cmd: &str) -> Option<std::path::PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let full = if cfg!(windows) { dir.join(format!("{cmd}.exe")) } else { dir.join(cmd) };
        if full.is_file() {
            return Some(full);
        }
    }
    None
}

fn extract_ffmpeg_frame_sync(sample_bytes: &[u8], quality: &str) -> Option<Vec<u8>> {
    let ff_exe = find_ffmpeg_binary()?;
    let mode = quality.to_lowercase();
    let sharp = mode.contains("jelas") || mode.contains("sharp");
    let saver = mode.contains("hemat") || mode.contains("saver");

    let (scale_arg, q_val) = if sharp {
        ("scale='min(1080,iw)':-2:force_original_aspect_ratio=decrease,format=yuv420p", "2")
    } else if saver {
        ("scale='min(360,iw)':-2:force_original_aspect_ratio=decrease,format=yuv420p", "6")
    } else {
        ("scale='min(720,iw)':-2:force_original_aspect_ratio=decrease,format=yuv420p", "3")
    };

    let temp_dir = std::env::temp_dir();
    let rand_id = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let sample_path = temp_dir.join(format!("autogram_vid_sample_{rand_id}.mp4"));
    let frame_path = temp_dir.join(format!("autogram_vid_frame_{rand_id}.jpg"));

    let _ = std::fs::write(&sample_path, sample_bytes);

    let status = std::process::Command::new(&ff_exe)
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-err_detect")
        .arg("ignore_err")
        .arg("-i")
        .arg(&sample_path)
        .arg("-an")
        .arg("-ss")
        .arg("00:00:00.100")
        .arg("-frames:v")
        .arg("1")
        .arg("-update")
        .arg("1")
        .arg("-vf")
        .arg(scale_arg)
        .arg("-q:v")
        .arg(q_val)
        .arg(&frame_path)
        .output();

    let result = if status.map(|o| o.status.success()).unwrap_or(false) && frame_path.exists() {
        std::fs::read(&frame_path).ok()
    } else {
        None
    };

    let _ = std::fs::remove_file(&sample_path);
    let _ = std::fs::remove_file(&frame_path);

    result
}

/// Find an existing full preview file for this chat+message (photo/doc reopen).
fn find_cached_preview_file(pdir: &Path, chat_safe: &str, message_id: i64) -> Option<PathBuf> {
    let prefix = format!("{chat_safe}_{message_id}");
    let rd = std::fs::read_dir(pdir).ok()?;
    let mut best: Option<(u64, PathBuf)> = None;
    for entry in rd.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with(&prefix) {
            continue;
        }
        if name.ends_with(".partial") {
            continue;
        }
        let path = entry.path();
        let len = entry.metadata().map(|m| m.len()).unwrap_or(0);
        if len < 32 {
            continue;
        }
        if best.as_ref().map(|(l, _)| len > *l).unwrap_or(true) {
            best = Some((len, path));
        }
    }
    best.map(|(_, p)| p)
}

fn mime_from_path(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg".into(),
        "png" => "image/png".into(),
        "webp" => "image/webp".into(),
        "gif" => "image/gif".into(),
        "pdf" => "application/pdf".into(),
        "txt" | "md" | "json" | "csv" | "log" | "xml" | "html" | "css" | "js" | "ts" | "py"
        | "rs" => "text/plain".into(),
        _ => "application/octet-stream".into(),
    }
}

fn try_local_preview_fast(path: &Path) -> Option<PreviewStreamResult> {
    let meta = std::fs::metadata(path).ok()?;
    let size = meta.len();
    if size == 0 {
        return None;
    }
    let mime = mime_from_path(path);
    let path_str = path.to_string_lossy().to_string();
    if mime.starts_with("image/") {
        let bytes = std::fs::read(path).ok()?;
        if bytes.len() > 16 * 1024 * 1024 {
            return None;
        }
        return Some(PreviewStreamResult {
            status: "success".into(),
            stream_id: String::new(),
            stream_url: String::new(),
            path: path_str,
            mime_type: mime,
            size,
            data_url: to_data_url(&bytes),
            text_content: None,
            preview_kind: "image".into(),
            streaming: false,
            backend: BACKEND.into(),
            message: "image cache hit".into(),
        });
    }
    if let Ok(local) = super::doc_preview::preview_local_document(&path_str) {
        return Some(PreviewStreamResult {
            status: "success".into(),
            stream_id: String::new(),
            stream_url: String::new(),
            path: path_str,
            mime_type: mime,
            size,
            data_url: None,
            text_content: local.text_content,
            preview_kind: local.preview_kind,
            streaming: false,
            backend: BACKEND.into(),
            message: "document cache hit".into(),
        });
    }
    if mime == "application/pdf" {
        return Some(PreviewStreamResult {
            status: "success".into(),
            stream_id: String::new(),
            stream_url: String::new(),
            path: path_str,
            mime_type: mime,
            size,
            data_url: None,
            text_content: None,
            preview_kind: "pdf".into(),
            streaming: false,
            backend: BACKEND.into(),
            message: "pdf cache hit".into(),
        });
    }
    None
}

fn to_data_url(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }
    let is_jpeg = bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8;
    let is_png = bytes.len() >= 8 && &bytes[0..4] == b"\x89PNG";
    let is_webp = bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP";
    let mime = if is_jpeg {
        "image/jpeg"
    } else if is_png {
        "image/png"
    } else if is_webp {
        "image/webp"
    } else {
        "image/jpeg"
    };
    Some(format!("data:{mime};base64,{}", B64.encode(bytes)))
}

pub fn thumbs_batch_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    message_ids: &[i64],
    quality: &str,
) -> Result<ThumbsBatchResult, TgError> {
    thumbs_batch_blocking_app(sessions_dir, identity, chat_id, message_ids, quality, None)
}

pub fn thumbs_batch_blocking_app(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    message_ids: &[i64],
    quality: &str,
    app: Option<&tauri::AppHandle>,
) -> Result<ThumbsBatchResult, TgError> {
    let ids: Vec<i32> = message_ids
        .iter()
        .filter(|&&id| id > 0)
        .take(64)
        .map(|&id| id as i32)
        .collect();
    if ids.is_empty() {
        return Ok(ThumbsBatchResult {
            status: "success".into(),
            thumbs: HashMap::new(),
            backend: BACKEND.into(),
        });
    }
    let rt = runtime()?;
    let chat = chat_id.to_string();
    let q_mode = quality.to_lowercase();
    let q_key = if q_mode.contains("hemat") || q_mode.contains("saver") {
        "hemat"
    } else if q_mode.contains("jelas") || q_mode.contains("sharp") {
        "jelas"
    } else {
        "seimbang"
    };
    let chat_safe: String = chat
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let t_dir = thumb_dir(sessions_dir);
    let _ = std::fs::create_dir_all(&t_dir);

    // Section
    let mut thumbs: HashMap<String, Option<String>> = HashMap::new();
    let mut uncached_ids: Vec<i32> = Vec::new();

    for &mid in &ids {
        let key = mid.to_string();
        let cache_key = format!("{chat_safe}_{mid}_{q_key}");
        let mut found_url: Option<String> = None;
        {
            let mem = thumb_mem_cache().lock();
            if let Some(url) = mem.get(&cache_key) {
                found_url = Some(url.clone());
            }
        }
        if found_url.is_none() {
            // Prefer exact quality file; fall back to hemat (stripped) so grid
            // reopens like Telegram without re-hitting the network.
            // Exact quality file only — never serve hemat blur as seimbang/jelas.
            let cache_file = t_dir.join(format!("{cache_key}.jpg"));
            if cache_file.is_file() {
                if let Ok(bytes) = std::fs::read(&cache_file) {
                    let min_disk = if q_key == "hemat" { 32 } else { 2_500 };
                    if bytes.len() >= min_disk {
                        if let Some(url) = to_data_url(&bytes) {
                            thumb_mem_cache().lock().insert(cache_key.clone(), url.clone());
                            found_url = Some(url);
                        }
                    } else {
                        let _ = std::fs::remove_file(&cache_file);
                    }
                }
            }
        }
        if let Some(url) = found_url {
            thumbs.insert(key, Some(url.clone()));
            if let Some(app_handle) = app {
                let _ = app_handle.emit(
                    "thumb_single_ready",
                    ThumbSinglePayload {
                        chat_id: chat.clone(),
                        message_id: mid as i64,
                        quality: q_key.to_string(),
                        url,
                        is_placeholder: false,
                    },
                );
            }
            continue;
        }
        uncached_ids.push(mid);
    }

    if uncached_ids.is_empty() {
        return Ok(ThumbsBatchResult {
            status: "success".into(),
            thumbs,
            backend: BACKEND.into(),
        });
    }

    let app_owned = app.cloned();

    rt.block_on(async {
        with_pool_retry(&identity.session, || {
            let chat = chat.clone();
            let mut uncached_ids = uncached_ids.clone();
            let t_dir = t_dir.clone();
            let chat_safe = chat_safe.clone();
            let mut thumbs = thumbs.clone();
            let ids = ids.clone();
            let app_owned = app_owned.clone();
            let session_name = identity.session.clone();
            with_client(sessions_dir, identity, true, move |client| {
            let app_ref = app_owned.clone();
            let session_name = session_name.clone();
            Box::pin(async move {
                if !super::grammers_ops::session_known_authorized(&session_name)
                    && !client
                        .is_authorized()
                        .await
                        .map_err(|e| map_invocation(&e))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
                // Keep the requested id list so we can index results by id, not by
                // position after the stripped fast-path filters some ids out.
                let fetch_ids = uncached_ids.clone();
                let msgs = client
                    .get_messages_by_id(peer, &fetch_ids)
                    .await
                    .map_err(|e| map_invocation(&e))?;

                // Align messages to message_id. After hemat stripped filtering,
                // enumerating remaining ids with msgs.get(i) would map the wrong
                // media onto the wrong card (missing / swapped thumbs).
                let mut msg_by_id: HashMap<i32, grammers_client::message::Message> =
                    HashMap::with_capacity(fetch_ids.len());
                for (i, mid) in fetch_ids.iter().enumerate() {
                    if let Some(Some(msg)) = msgs.get(i) {
                        msg_by_id.insert(*mid, msg.clone());
                    }
                }

                // Hemat: stripped = final (fast). Seimbang/Jelas: download real
                // layers so quality pills actually change the grid.
                let quality_owned = q_key.to_string();
                let hemat_only = q_key == "hemat";
                let mut need_download: Vec<i32> = Vec::new();

                for mid in fetch_ids.iter().copied() {
                    let key = mid.to_string();
                    let mut got_stripped = false;
                    if let Some(msg) = msg_by_id.get(&mid) {
                        if let Some(media) = msg.media() {
                            let sizes = media_thumbs(&media);
                            for s in &sizes {
                                if let Some(data) = s.to_data() {
                                    let bytes = unstrip_jpeg(&data).unwrap_or(data);
                                    if bytes.is_empty() {
                                        continue;
                                    }
                                    if let Some(url) = to_data_url(&bytes) {
                                        // Always keep stripped under hemat only
                                        let cache_file = t_dir
                                            .join(format!("{chat_safe}_{mid}_hemat.jpg"));
                                        let _ = std::fs::write(&cache_file, &bytes);
                                        thumb_mem_cache().lock().insert(
                                            format!("{chat_safe}_{mid}_hemat"),
                                            url.clone(),
                                        );
                                        got_stripped = true;
                                        if hemat_only {
                                            thumbs.insert(key.clone(), Some(url.clone()));
                                            if let Some(app_handle) = app_ref.as_ref() {
                                                let _ = app_handle.emit(
                                                    "thumb_single_ready",
                                                    ThumbSinglePayload {
                                                        chat_id: chat.clone(),
                                                        message_id: mid as i64,
                                                        quality: "hemat".into(),
                                                        url,
                                                        is_placeholder: false,
                                                    },
                                                );
                                            }
                                        } else {
                                            // Placeholder paint while seimbang/jelas downloads
                                            if let Some(app_handle) = app_ref.as_ref() {
                                                let _ = app_handle.emit(
                                                    "thumb_single_ready",
                                                    ThumbSinglePayload {
                                                        chat_id: chat.clone(),
                                                        message_id: mid as i64,
                                                        quality: q_key.to_string(),
                                                        url,
                                                        is_placeholder: true,
                                                    },
                                                );
                                            }
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    if hemat_only {
                        if !got_stripped {
                            need_download.push(mid);
                        }
                    } else {
                        // seimbang/jelas always need a real download when not on disk
                        need_download.push(mid);
                    }
                }

                let mut set = tokio::task::JoinSet::new();
                for mid in need_download.iter().copied() {
                    let key = mid.to_string();
                    // Disk hit for THIS quality only (never fall back to hemat blur here)
                    let q_cache = format!("{chat_safe}_{mid}_{q_key}");
                    if let Some(url) = thumb_mem_cache().lock().get(&q_cache).cloned() {
                        thumbs.insert(key, Some(url));
                        continue;
                    }
                    let q_file = t_dir.join(format!("{q_cache}.jpg"));
                    if q_file.is_file() {
                        if let Ok(bytes) = std::fs::read(&q_file) {
                            let min_ok = if hemat_only { 32 } else { 2_500 };
                            if bytes.len() >= min_ok {
                                if let Some(url) = to_data_url(&bytes) {
                                    thumb_mem_cache().lock().insert(q_cache, url.clone());
                                    thumbs.insert(key, Some(url));
                                    continue;
                                }
                            }
                        }
                    }
                    let Some(msg) = msg_by_id.get(&mid) else {
                        thumbs.insert(key, None);
                        continue;
                    };
                    let Some(media) = msg.media() else {
                        thumbs.insert(key, None);
                        continue;
                    };
                    let media_cloned = media.clone();
                    let client_ref = client.clone();
                    let mid_val = mid;
                    let q_sub = quality_owned.clone();
                    let c_sub = chat_safe.clone();
                    let t_sub = t_dir.clone();

                    set.spawn(async move {
                        let cache_file = t_sub.join(format!("{c_sub}_{mid_val}_{q_sub}.jpg"));
                        match download_media_thumb(&client_ref, &media_cloned, &q_sub).await {
                            Ok(bytes) => {
                                // Reject tiny stripped payloads for seimbang/jelas
                                let min_ok = if q_sub == "hemat" { 32 } else { 2_500 };
                                if bytes.len() < min_ok {
                                    return (mid_val.to_string(), None);
                                }
                                let _ = std::fs::write(&cache_file, &bytes);
                                let url = to_data_url(&bytes);
                                if let Some(ref u) = url {
                                    thumb_mem_cache().lock().insert(
                                        format!("{c_sub}_{mid_val}_{q_sub}"),
                                        u.clone(),
                                    );
                                }
                                (mid_val.to_string(), url)
                            }
                            Err(e) => {
                                tg_log::debug(
                                    BACKEND,
                                    "thumb_miss",
                                    format!("mid={mid_val} {e}"),
                                );
                                (mid_val.to_string(), None)
                            }
                        }
                    });
                }

                while let Some(res) = set.join_next().await {
                    if let Ok((k, v)) = res {
                        if let (Ok(mid_i64), Some(ref url_str)) = (k.parse::<i64>(), v.as_ref()) {
                            if let Some(app_handle) = app_ref.as_ref() {
                                let _ = app_handle.emit(
                                    "thumb_single_ready",
                                    ThumbSinglePayload {
                                        chat_id: chat.clone(),
                                        message_id: mid_i64,
                                        quality: q_key.to_string(),
                                        url: (*url_str).clone(),
                                        is_placeholder: false,
                                    },
                                );
                            }
                        }
                        thumbs.insert(k, v);
                    }
                }

                tg_log::info(
                    BACKEND,
                    "thumbs_batch",
                    format!(
                        "chat={} q={} total={} download={} ok={}",
                        chat,
                        q_key,
                        ids.len(),
                        need_download.len(),
                        thumbs.values().filter(|v| v.is_some()).count()
                    ),
                );
                Ok(ThumbsBatchResult {
                    status: "success".into(),
                    thumbs,
                    backend: BACKEND.into(),
                })
            })
            })
        })
        .await
    })
}

// Section

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewStreamResult {
    pub status: String,
    pub stream_id: String,
    pub stream_url: String,
    pub path: String,
    pub mime_type: String,
    pub size: u64,
    pub data_url: Option<String>,
    pub text_content: Option<String>,
    pub preview_kind: String,
    pub streaming: bool,
    pub backend: String,
    pub message: String,
}

fn guess_mime(name: &str, media: &Media) -> String {
    if let Media::Document(d) = media {
        if let Some(m) = d.mime_type() {
            return m.to_string();
        }
    }
    let ext = Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "m4v" | "mov" => "video/mp4".into(),
        "webm" => "video/webm".into(),
        "mkv" => "video/x-matroska".into(),
        "mp3" => "audio/mpeg".into(),
        "m4a" | "aac" => "audio/mp4".into(),
        "ogg" | "opus" => "audio/ogg".into(),
        "jpg" | "jpeg" => "image/jpeg".into(),
        "png" => "image/png".into(),
        "webp" => "image/webp".into(),
        "gif" => "image/gif".into(),
        "pdf" => "application/pdf".into(),
        _ => match media {
            Media::Photo(_) => "image/jpeg".into(),
            _ => "application/octet-stream".into(),
        },
    }
}

fn media_name(msg: &grammers_client::message::Message, media: &Media, mid: i64) -> String {
    match media {
        Media::Document(d) => d
            .name()
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("file_{mid}")),
        Media::Photo(_) => format!("photo_{mid}.jpg"),
        Media::Sticker(_) => format!("sticker_{mid}.webp"),
        _ => {
            let t = msg.text().trim();
            if !t.is_empty() {
                format!("{t}_{mid}")
            } else {
                format!("media_{mid}")
            }
        }
    }
}

fn stream_public_url(stream_id: &str, label: &str) -> String {
    let port = stream_server::stream_port();
    let safe: String = label
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(80)
        .collect();
    let name = if safe.is_empty() {
        "media".into()
    } else {
        safe
    };
    if port > 0 {
        format!("http://127.0.0.1:{port}/stream/{stream_id}/{name}")
    } else {
        format!("http://127.0.0.1:0/stream/{stream_id}/{name}")
    }
}

fn media_to_input_location(media: &Media) -> Option<tl::enums::InputFileLocation> {
    match media {
        Media::Document(d) => match &d.raw.document {
            Some(tl::enums::Document::Document(doc)) => {
                Some(tl::enums::InputFileLocation::InputDocumentFileLocation(
                    tl::types::InputDocumentFileLocation {
                        id: doc.id,
                        access_hash: doc.access_hash,
                        file_reference: doc.file_reference.clone(),
                        thumb_size: String::new(),
                    },
                ))
            }
            _ => None,
        },
        Media::Photo(p) => match &p.raw.photo {
            Some(tl::enums::Photo::Photo(photo)) => {
                Some(tl::enums::InputFileLocation::InputPhotoFileLocation(
                    tl::types::InputPhotoFileLocation {
                        id: photo.id,
                        access_hash: photo.access_hash,
                        file_reference: photo.file_reference.clone(),
                        thumb_size: "m".to_string(),
                    },
                ))
            }
            _ => None,
        },
        _ => None,
    }
}

/// Live progressive preview results keyed by session|chat|msg — prevents
/// duplicate progressive_start for the same video (warm + open + prefetch).
fn live_preview_map() -> &'static Mutex<HashMap<String, PreviewStreamResult>> {
    static MAP: OnceLock<Mutex<HashMap<String, PreviewStreamResult>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn preview_key(session: &str, chat: &str, msg: i64) -> String {
    format!("{session}|{chat}|{msg}")
}

/// Shared single-flight for concurrent open/prefetch of the same message.
/// Waiters join the leader instead of failing with "sedang diproses".
struct SharedPreviewFlight {
    done: bool,
    /// Ok payload or error user message
    outcome: Option<Result<PreviewStreamResult, String>>,
}

type SharedPreviewCell = Arc<(Mutex<SharedPreviewFlight>, parking_lot::Condvar)>;

fn preview_inflight() -> &'static Mutex<HashMap<String, SharedPreviewCell>> {
    static MAP: OnceLock<Mutex<HashMap<String, SharedPreviewCell>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn usable_live_preview(r: &PreviewStreamResult) -> bool {
    if r.data_url.as_ref().is_some_and(|u| !u.is_empty()) {
        return true;
    }
    if !r.streaming && !r.path.is_empty() {
        return true;
    }
    if r.streaming && !r.stream_id.is_empty() {
        let st = stream_server::status_of(&r.stream_id);
        return st.status != "missing" && st.error.is_none();
    }
    false
}

/// Section
/// Section
pub fn start_preview_stream_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    message_id: i64,
) -> Result<PreviewStreamResult, TgError> {
    if message_id <= 0 {
        return Err(TgError::new(TgErrorCode::Internal, "message_id required"));
    }
    let sessions_dir = sessions_dir.to_path_buf();
    let identity = identity.clone();
    let chat = chat_id.to_string();
    let session_name = identity.session.clone();
    let key = preview_key(&session_name, &chat, message_id);

    // Fail-fast during FloodWait — do not pile more GetFile on a hot account.
    if let Err(e) = session_rate::ensure_not_flooded(&session_name) {
        session_rate::note_error(&session_name, &e);
        return Err(e);
    }

    // Instant hit: already opened / still streaming this message.
    if let Some(existing) = live_preview_map().lock().get(&key).cloned() {
        if usable_live_preview(&existing) {
            return Ok(existing);
        }
    }

    // Single-flight: one leader runs MTProto; concurrent opens wait for the same result.
    let (cell, is_leader) = {
        let mut map = preview_inflight().lock();
        if let Some(existing) = map.get(&key) {
            (Arc::clone(existing), false)
        } else {
            let cell = Arc::new((
                Mutex::new(SharedPreviewFlight {
                    done: false,
                    outcome: None,
                }),
                parking_lot::Condvar::new(),
            ));
            map.insert(key.clone(), Arc::clone(&cell));
            (cell, true)
        }
    };

    if !is_leader {
        let (lock, cv) = &*cell;
        let mut guard = lock.lock();
        let deadline = std::time::Instant::now() + Duration::from_secs(90);
        while !guard.done {
            if let Some(existing) = live_preview_map().lock().get(&key).cloned() {
                if usable_live_preview(&existing) {
                    return Ok(existing);
                }
            }
            let now = std::time::Instant::now();
            if now >= deadline {
                break;
            }
            cv.wait_for(&mut guard, deadline - now);
        }
        if guard.done {
            return match guard.outcome.clone() {
                Some(Ok(r)) => Ok(r),
                Some(Err(msg)) => Err(TgError::new(TgErrorCode::Internal, msg)),
                None => Err(TgError::new(
                    TgErrorCode::Internal,
                    "preview flight finished without result",
                )),
            };
        }
        // Leader stuck past 90s — drop waiter path and run our own attempt.
        drop(guard);
        preview_inflight().lock().remove(&key);
        let result = start_preview_stream_inner(&sessions_dir, &identity, &chat, message_id);
        if let Ok(r) = &result {
            if usable_live_preview(r) || r.streaming || !r.path.is_empty() {
                live_preview_map().lock().insert(key, r.clone());
            }
        } else if let Err(e) = &result {
            session_rate::note_error(&identity.session, e);
        }
        return result;
    }

    // Leader path — only one MTProto open per message; others wait above.
    let result = start_preview_stream_inner(&sessions_dir, &identity, &chat, message_id);

    match &result {
        Ok(r) if usable_live_preview(r) || r.streaming || !r.path.is_empty() => {
            live_preview_map().lock().insert(key.clone(), r.clone());
        }
        Err(e) => session_rate::note_error(&identity.session, e),
        _ => {}
    }

    {
        let (lock, cv) = &*cell;
        let mut guard = lock.lock();
        guard.done = true;
        guard.outcome = Some(match &result {
            Ok(r) => Ok(r.clone()),
            Err(e) => Err(e.user_message()),
        });
        cv.notify_all();
    }
    preview_inflight().lock().remove(&key);

    result
}

fn start_preview_stream_inner(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat: &str,
    message_id: i64,
) -> Result<PreviewStreamResult, TgError> {
    let rt = runtime()?;
    let pdir = preview_dir(sessions_dir);
    let _ = std::fs::create_dir_all(&pdir);
    let chat_safe = chat.replace(|c: char| !c.is_ascii_alphanumeric(), "_");
    let session_name = identity.session.clone();

    // Instant disk cache hit — no MTProto (reopen same photo/doc feels instant).
    if let Some(cached) = find_cached_preview_file(&pdir, &chat_safe, message_id) {
        if let Some(fast) = try_local_preview_fast(&cached) {
            return Ok(fast);
        }
    }

    // Shared Grammers pool — never dual-open / disconnect the live Studio client.
    rt.block_on(async {
        // Fail-fast if flooded (no multi-second sleep inside open).
        session_rate::ensure_not_flooded(&session_name)?;

        let live = obtain_live_client(sessions_dir, identity, true, false).await?;
        let client = &live.client;
        if !client.is_authorized().await.map_err(|e| map_invocation(&e))? {
            return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
        }
        let peer = resolve_peer(client, chat).await?;
        let mid = message_id as i32;
        let msgs = client
            .get_messages_by_id(peer, &[mid])
            .await
            .map_err(|e| {
                let err = map_invocation(&e);
                session_rate::note_error(&session_name, &err);
                err
            })?;
        let msg = msgs
            .into_iter()
            .flatten()
            .next()
            .ok_or_else(|| {
                TgError::new(
                    TgErrorCode::PeerNotFound,
                    format!("message {message_id} not found"),
                )
            })?;
        let media = msg.media().ok_or_else(|| {
            TgError::new(TgErrorCode::PeerNotFound, "message has no media")
        })?;
        let size = media.size().unwrap_or(0) as u64;
        if size == 0 {
            return Err(TgError::new(
                TgErrorCode::Internal,
                "media size unknown / empty",
            ));
        }
        if size > PROGRESSIVE_MAX {
            return Err(TgError::new(
                TgErrorCode::Internal,
                format!("media {size} melebihi batas sparse preview native 4 GiB"),
            ));
        }

        let name = media_name(&msg, &media, message_id);
        let mime = guess_mime(&name, &media);
        let is_image = mime.starts_with("image/") && !mime.contains("gif");
        let is_video = mime.starts_with("video/");
        let is_audio = mime.starts_with("audio/");

        // Non-media (apk/zip/binaries): never progressive-stream as if video.
        // Large files >64MB → instant metadata UI (download only).
        if !is_image && !is_video && !is_audio && size > 64 * 1024 * 1024 {
            let _ = persist_memory_session(&live.session, &live.session_path);
            return Ok(PreviewStreamResult {
                status: "success".into(),
                stream_id: String::new(),
                stream_url: String::new(),
                path: String::new(),
                mime_type: mime,
                size,
                data_url: None,
                text_content: None,
                preview_kind: "file".into(),
                streaming: false,
                backend: BACKEND.into(),
                message: "File besar — gunakan Download / Buka dengan…".into(),
            });
        }

        // Documents: download once, parse text/pdf locally — keep shared pool alive.
        if !is_image && !is_video && !is_audio && size <= 64 * 1024 * 1024 {
            let safe_name: String = name
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() || ".-_".contains(c) { c } else { '_' })
                .take(120)
                .collect();
            let dest = pdir.join(format!("{chat_safe}_{message_id}_{safe_name}"));
            path_policy::assert_safe_transfer_path(dest.to_str().unwrap_or(""))
                .map_err(|e| TgError::new(TgErrorCode::PathRejected, e))?;
            if !(dest.is_file()
                && std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0) == size)
            {
                client
                    .download_media(&media, &dest)
                    .await
                    .map_err(|e| TgError::new(TgErrorCode::Io, format!("download document: {e}")))?;
            }
            let _ = persist_memory_session(&live.session, &live.session_path);
            let local = super::doc_preview::preview_local_document(dest.to_str().unwrap_or(""));
            let (kind, text_content) = match local {
                Ok(p) => (p.preview_kind, p.text_content),
                Err(_) if mime == "application/pdf" => ("pdf".into(), None),
                Err(_) => ("file".into(), None),
            };
            return Ok(PreviewStreamResult {
                status: "success".into(),
                stream_id: String::new(),
                stream_url: String::new(),
                path: dest.display().to_string(),
                mime_type: mime,
                size,
                data_url: None,
                text_content,
                preview_kind: kind,
                streaming: false,
                backend: BACKEND.into(),
                message: "document downloaded and parsed by Rust".into(),
            });
        }

        // Photos: reuse disk cache; never disconnect shared pool.
        if is_image && size <= 12 * 1024 * 1024 {
            let dest = pdir.join(format!(
                "{chat_safe}_{message_id}.{}",
                Path::new(&name)
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("jpg")
            ));
            path_policy::assert_safe_transfer_path(dest.to_str().unwrap_or(""))
                .map_err(|e| TgError::new(TgErrorCode::PathRejected, e))?;
            if !(dest.is_file()
                && std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0) >= size.saturating_mul(9) / 10)
            {
                client
                    .download_media(&media, &dest)
                    .await
                    .map_err(|e| TgError::new(TgErrorCode::Io, format!("download: {e}")))?;
            }
            let _ = persist_memory_session(&live.session, &live.session_path);
            let final_size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(size);
            let bytes = std::fs::read(&dest).unwrap_or_default();
            let data_url = to_data_url(&bytes);
            return Ok(PreviewStreamResult {
                status: "success".into(),
                stream_id: String::new(),
                stream_url: String::new(),
                path: dest.display().to_string(),
                mime_type: mime,
                size: final_size,
                data_url,
                text_content: None,
                preview_kind: "image".into(),
                streaming: false,
                backend: BACKEND.into(),
                message: "image ready".into(),
            });
        }

        // Video/audio progressive — return stream URL as soon as the first
        // head bytes are on disk. NEVER hold the media slot for the full file
        // (that froze the UI on "Memuat…" for huge MP4s).
        let stream_id = format!(
            "g{}-{}-{}",
            message_id,
            now_ms() % 1_000_000,
            (now_ms() / 7) % 99991
        );
        for old in session_rate::streams_to_cancel(&session_name, &stream_id) {
            cancel_progressive(&old);
        }
        // Brief yield so cancelled fills release GetFile / sockets.
        tokio::time::sleep(Duration::from_millis(30)).await;

        session_rate::track_stream(&session_name, &stream_id);

        let dest = pdir.join(format!("{stream_id}.partial"));
        path_policy::assert_safe_transfer_path(dest.to_str().unwrap_or(""))
            .map_err(|e| TgError::new(TgErrorCode::PathRejected, e))?;

        {
            let f = std::fs::File::create(&dest)
                .map_err(|e| TgError::new(TgErrorCode::Io, format!("create partial: {e}")))?;
            f.set_len(size)
                .map_err(|e| TgError::new(TgErrorCode::Io, format!("set_len: {e}")))?;
        }

        let entry = StreamEntry {
            stream_id: stream_id.clone(),
            path: dest.display().to_string(),
            total_size: size,
            mime: mime.clone(),
            label: name.clone(),
            done: false,
            ranges: vec![],
            cancelled: false,
            error: None,
            paused: false,
            updated_at_ms: now_ms(),
        };
        stream_server::upsert_entry(entry);
        let cancel = register_cancel(&stream_id);
        let stream_url = stream_public_url(&stream_id, &name);

        // Bootstrap ~512 KiB head under a short-lived slot — enough for most
        // players to start; full file fills in background (1–3s open target).
        let mut boot_ranges: Vec<(u64, u64)> = Vec::new();
        {
            let _boot_slot = session_rate::acquire_media_slot(&session_name).await?;
            const BOOT_CHUNK: u64 = 256 * 1024;
            const BOOT_TARGET: u64 = 512 * 1024;
            let mut iter = live
                .client
                .iter_download(&media)
                .chunk_size(BOOT_CHUNK as i32);
            let mut offset: u64 = 0;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .read(true)
                .open(&dest)
                .map_err(|e| TgError::new(TgErrorCode::Io, format!("open partial: {e}")))?;
            while offset < BOOT_TARGET {
                match iter.next().await {
                    Ok(Some(chunk)) if !chunk.is_empty() => {
                        file.seek(SeekFrom::Start(offset))
                            .map_err(|e| TgError::new(TgErrorCode::Io, format!("seek: {e}")))?;
                        file.write_all(&chunk)
                            .map_err(|e| TgError::new(TgErrorCode::Io, format!("write: {e}")))?;
                        let end = offset + chunk.len() as u64;
                        boot_ranges.push((offset, end));
                        offset = end;
                    }
                    Ok(Some(_)) | Ok(None) => break,
                    Err(e) => {
                        let err = map_invocation(&e);
                        session_rate::note_error(&session_name, &err);
                        session_rate::untrack_stream(&session_name, &stream_id);
                        return Err(err);
                    }
                }
            }
            let _ = file.flush();
            if !boot_ranges.is_empty() {
                stream_server::upsert_entry(StreamEntry {
                    stream_id: stream_id.clone(),
                    path: dest.display().to_string(),
                    total_size: size,
                    mime: mime.clone(),
                    label: name.clone(),
                    done: false,
                    ranges: boot_ranges.clone(),
                    cancelled: false,
                    error: None,
                    paused: false,
                    updated_at_ms: now_ms(),
                });
            }
            // _boot_slot dropped here — UI can open another video without waiting for full fill.
        }

        let dest_path = dest.clone();
        let sid = stream_id.clone();
        let mime_bg = mime.clone();
        let fill_media = media;
        let live_bg = Arc::clone(&live);
        let session_bg = session_name.clone();
        let boot_end = boot_ranges.last().map(|r| r.1).unwrap_or(0);
        tokio::spawn(async move {
            // Optional fill permit — if busy, still try (cancelled old streams free bandwidth).
            let _fill_slot = session_rate::try_acquire_media_slot(&session_bg);
            let live = live_bg;
            let flag = cancel;
            let mut offset: u64 = boot_end;
            let mut ranges: Vec<(u64, u64)> = boot_ranges;
            let mut moov_bootstrapped = boot_end > 0;
            let result = async {
                // grammers GetFile: MIN=4KiB MAX=512KiB (panic outside range)
                const CHUNK_SIZE: u64 = 512 * 1024;
                let skip = if boot_end > 0 {
                    ((boot_end / CHUNK_SIZE).min(i32::MAX as u64)) as i32
                } else {
                    0
                };
                let mut iter = live
                    .client
                    .iter_download(&fill_media)
                    .chunk_size(CHUNK_SIZE as i32);
                if skip > 0 {
                    iter = iter.skip_chunks(skip);
                    offset = skip as u64 * CHUNK_SIZE;
                }
                let mut file = std::fs::OpenOptions::new()
                    .write(true)
                    .read(true)
                    .open(&dest_path)
                    .map_err(|e| format!("open partial: {e}"))?;
                while let Some(chunk) = iter
                    .next()
                    .await
                    .map_err(|e| format!("GetFile: {e}"))?
                {
                    if flag.load(Ordering::SeqCst) {
                        return Err("cancelled".into());
                    }
                    // Section
                    loop {
                        if let Some(e) = stream_server::get_entry(&sid) {
                            if e.cancelled || flag.load(Ordering::SeqCst) {
                                return Err("cancelled".into());
                            }
                            if !e.paused {
                                break;
                            }
                        } else {
                            break;
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    }
                    // Section
                    // Section
                    // Section
                    if let Some(requested) = take_seek_request(&sid) {
                        let requested = requested.min(size.saturating_sub(1));
                        let aligned = (requested / CHUNK_SIZE) * CHUNK_SIZE;
                        let already_available = ranges
                            .iter()
                            .any(|(start, end)| *start <= requested && requested < *end);
                        if !already_available && aligned != offset {
                            let skip = (aligned / CHUNK_SIZE).min(i32::MAX as u64) as i32;
                            iter = live
                                .client
                                .iter_download(&fill_media)
                                .chunk_size(CHUNK_SIZE as i32)
                                .skip_chunks(skip);
                            offset = aligned;
                            tg_log::info(
                                BACKEND,
                                "progressive_seek",
                                format!("sid={sid} offset={aligned}"),
                            );
                            continue;
                        }
                    }
                    let len = chunk.len() as u64;
                    if len == 0 {
                        break;
                    }
                    file.seek(SeekFrom::Start(offset))
                        .map_err(|e| format!("seek: {e}"))?;
                    file.write_all(&chunk)
                        .map_err(|e| format!("write: {e}"))?;
                    let end = offset + len;
                    ranges.push((offset, end));
                    offset = end;

                    // Section
                    if is_video && size > 1024 * 1024 && !moov_bootstrapped {
                        moov_bootstrapped = true;
                        let has_moov_in_head = chunk.windows(4).any(|w| w == b"moov");
                        if !has_moov_in_head {
                            if let Some(loc) = media_to_input_location(&fill_media) {
                                let tail_offset = (size.saturating_sub(1024 * 1024) / 4096) * 4096;
                                let tail_req = tl::functions::upload::GetFile {
                                    precise: false,
                                    cdn_supported: false,
                                    location: loc,
                                    offset: tail_offset as i64,
                                    limit: (size - tail_offset).min(1024 * 1024) as i32,
                                };
                                if let Ok(tl::enums::upload::File::File(f)) =
                                    live.client.invoke(&tail_req).await
                                {
                                    if !f.bytes.is_empty() {
                                        if file.seek(SeekFrom::Start(tail_offset)).is_ok() {
                                            if file.write_all(&f.bytes).is_ok() {
                                                let end_tail = tail_offset + f.bytes.len() as u64;
                                                ranges.push((tail_offset, end_tail));
                                                tg_log::info(
                                                    BACKEND,
                                                    "moov_tail_ready",
                                                    format!("sid={sid} offset={tail_offset}"),
                                                );
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Section
                    stream_server::upsert_entry(StreamEntry {
                        stream_id: sid.clone(),
                        path: dest_path.display().to_string(),
                        total_size: size,
                        mime: mime_bg.clone(),
                        label: name.clone(),
                        done: false,
                        ranges: ranges.clone(),
                        cancelled: false,
                        error: None,
                        paused: false,
                        updated_at_ms: now_ms(),
                    });
                    if offset >= size {
                        if let Some(missing) = first_missing_offset(&ranges, size) {
                            let aligned = (missing / CHUNK_SIZE) * CHUNK_SIZE;
                            let skip = (aligned / CHUNK_SIZE).min(i32::MAX as u64) as i32;
                            iter = live
                                .client
                                .iter_download(&fill_media)
                                .chunk_size(CHUNK_SIZE as i32)
                                .skip_chunks(skip);
                            offset = aligned;
                            continue;
                        }
                        break;
                    }
                }
                let _ = file.flush();
                if let Some(missing) = first_missing_offset(&ranges, size) {
                    return Err(format!("download ended with an unfilled range at {missing}"));
                }
                Ok::<(), String>(())
            }
            .await;

            match result {
                Ok(()) => {
                    stream_server::upsert_entry(StreamEntry {
                        stream_id: sid.clone(),
                        path: dest_path.display().to_string(),
                        total_size: size,
                        mime: mime_bg,
                        label: name,
                        done: true,
                        ranges: if ranges.is_empty() {
                            vec![(0, size)]
                        } else {
                            ranges
                        },
                        cancelled: false,
                        error: None,
                        paused: false,
                        updated_at_ms: now_ms(),
                    });
                    tg_log::info(BACKEND, "progressive_done", format!("sid={sid} size={size}"));
                }
                Err(e) => {
                    let cancelled = e.contains("cancel") || flag.load(Ordering::SeqCst);
                    stream_server::upsert_entry(StreamEntry {
                        stream_id: sid.clone(),
                        path: dest_path.display().to_string(),
                        total_size: size,
                        mime: mime_bg,
                        label: name,
                        done: false,
                        ranges,
                        cancelled,
                        error: if cancelled { None } else { Some(e.clone()) },
                        paused: cancelled,
                        updated_at_ms: now_ms(),
                    });
                    if !cancelled {
                        tg_log::error(BACKEND, "progressive_fail", e);
                    }
                }
            }
            // Keep shared pool alive for Studio / Forwarder — do NOT disconnect.
            let _ = persist_memory_session(&live.session, &live.session_path);
            let _ = take_cancel(&sid);
            seek_requests().lock().remove(&sid);
            session_rate::untrack_stream(&session_bg, &sid);
        });

        // Return immediately — head bytes already on disk; fill continues in background.
        let kind = if is_video {
            "stream"
        } else if is_audio {
            "stream"
        } else if mime == "application/pdf" {
            "pdf"
        } else {
            "stream"
        };

        tg_log::info(
            BACKEND,
            "progressive_start",
            format!(
                "sid={stream_id} size={size} mime={mime} boot={}",
                boot_end
            ),
        );

        Ok(PreviewStreamResult {
            status: "success".into(),
            stream_id: stream_id.clone(),
            stream_url,
            path: dest.display().to_string(),
            mime_type: mime,
            size,
            data_url: None,
            text_content: None,
            preview_kind: kind.into(),
            streaming: true,
            backend: BACKEND.into(),
            message: "streaming (head ready)".into(),
        })
    })
}

/// Light warm: download only the first ~head_bytes. Does **not** start a full
/// progressive fill (that was flooding Telegram with parallel GetFile).
pub fn warm_preview_head_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    message_id: i64,
    head_bytes: u64,
) -> Result<PreviewStreamResult, TgError> {
    if message_id <= 0 {
        return Err(TgError::new(TgErrorCode::Internal, "message_id required"));
    }
    let session = identity.session.as_str();
    // Never warm during FloodWait or while a progressive GetFile holds the slot.
    session_rate::ensure_not_flooded(session)?;
    let Some(_slot) = session_rate::try_acquire_media_slot(session) else {
        return Ok(PreviewStreamResult {
            status: "skipped".into(),
            stream_id: String::new(),
            stream_url: String::new(),
            path: String::new(),
            mime_type: String::new(),
            size: 0,
            data_url: None,
            text_content: None,
            preview_kind: "warm_busy".into(),
            streaming: false,
            backend: BACKEND.into(),
            message: "warm skipped — media slot busy".into(),
        });
    };

    let head_bytes = head_bytes.clamp(64 * 1024, 768 * 1024);
    let chat = chat_id.to_string();
    let sessions_dir = sessions_dir.to_path_buf();
    let identity = identity.clone();
    let pdir = preview_dir(&sessions_dir);
    let _ = std::fs::create_dir_all(&pdir);
    let chat_safe = chat.replace(|c: char| !c.is_ascii_alphanumeric(), "_");
    let warm_path = pdir.join(format!("{chat_safe}_{message_id}.warm"));

    // Already warmed enough?
    if warm_path.is_file() {
        if let Ok(meta) = std::fs::metadata(&warm_path) {
            if meta.len() >= head_bytes / 2 {
                return Ok(PreviewStreamResult {
                    status: "ok".into(),
                    stream_id: String::new(),
                    stream_url: String::new(),
                    path: warm_path.display().to_string(),
                    mime_type: String::new(),
                    size: meta.len(),
                    data_url: None,
                    text_content: None,
                    preview_kind: "warm".into(),
                    streaming: false,
                    backend: BACKEND.into(),
                    message: "warm cache hit".into(),
                });
            }
        }
    }

    let rt = runtime()?;
    rt.block_on(async {
        let live = obtain_live_client(&sessions_dir, &identity, true, false).await?;
        let client = &live.client;
        if !client.is_authorized().await.map_err(|e| map_invocation(&e))? {
            return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
        }
        let peer = resolve_peer(client, &chat).await?;
        let msgs = client
            .get_messages_by_id(peer, &[message_id as i32])
            .await
            .map_err(|e| {
                let err = map_invocation(&e);
                session_rate::note_error(&identity.session, &err);
                err
            })?;
        let msg = msgs
            .into_iter()
            .flatten()
            .next()
            .ok_or_else(|| {
                TgError::new(TgErrorCode::PeerNotFound, format!("message {message_id} not found"))
            })?;
        let media = msg
            .media()
            .ok_or_else(|| TgError::new(TgErrorCode::PeerNotFound, "no media"))?;
        let size = media.size().unwrap_or(0) as u64;
        if size == 0 {
            return Err(TgError::new(TgErrorCode::Internal, "empty media"));
        }

        let mut iter = client
            .iter_download(&media)
            .chunk_size((head_bytes.min(256 * 1024)) as i32);
        let mut got: u64 = 0;
        let mut file = std::fs::File::create(&warm_path)
            .map_err(|e| TgError::new(TgErrorCode::Io, format!("warm create: {e}")))?;
        while got < head_bytes {
            match iter.next().await {
                Ok(Some(chunk)) if !chunk.is_empty() => {
                    file.write_all(&chunk)
                        .map_err(|e| TgError::new(TgErrorCode::Io, format!("warm write: {e}")))?;
                    got += chunk.len() as u64;
                }
                Ok(Some(_)) | Ok(None) => break,
                Err(e) => {
                    let err = map_invocation(&e);
                    session_rate::note_error(&identity.session, &err);
                    return Err(err);
                }
            }
        }
        let _ = file.flush();
        let _ = persist_memory_session(&live.session, &live.session_path);
        Ok(PreviewStreamResult {
            status: "ok".into(),
            stream_id: String::new(),
            stream_url: String::new(),
            path: warm_path.display().to_string(),
            mime_type: String::new(),
            size: got,
            data_url: None,
            text_content: None,
            preview_kind: "warm".into(),
            streaming: false,
            backend: BACKEND.into(),
            message: format!("warmed {got} bytes"),
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_url_jpeg_header() {
        let bytes = [0xFFu8, 0xD8, 0xFF, 0x00, 0x11, 0x22];
        let u = to_data_url(&bytes).unwrap();
        assert!(u.starts_with("data:image/jpeg;base64,"));
    }

    #[test]
    fn cancel_unknown_false() {
        assert!(!cancel_progressive("no-such-stream-xyz"));
    }

    #[test]
    fn seek_unknown_stream_is_rejected() {
        assert!(!request_progressive_range("no-such-stream-xyz", 1024));
    }

    #[test]
    fn seek_islands_resume_at_first_gap() {
        assert_eq!(first_missing_offset(&[(0, 512), (1024, 2048)], 2048), Some(512));
        assert_eq!(first_missing_offset(&[(1024, 2048), (0, 1024)], 2048), None);
    }
}
