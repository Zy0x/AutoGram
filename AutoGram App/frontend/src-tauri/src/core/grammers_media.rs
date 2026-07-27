//! Grammers media helpers: adaptive progressive fill, thumbnails, documents, and topics.
//! Desktop preview is served by the native Rust Range HTTP registry.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
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
    obtain_download_clients, obtain_live_client, persist_memory_session, resolve_peer, runtime, with_client, with_pool_retry,
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
    // 512 KB Alignment Boundary to prevent Telegram CDN offset shift / MP4 box corruption
    let aligned_offset = offset - (offset % (512 * 1024));
    seek_requests().lock().insert(stream_id.to_string(), aligned_offset);
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

pub fn clear_thumb_mem_cache() {
    thumb_mem_cache().lock().clear();
}

pub fn prune_thumb_cache(t_dir: &Path) {
    if !t_dir.is_dir() {
        return;
    }
    let t_dir_buf = t_dir.to_path_buf();
    std::thread::spawn(move || {
        let Ok(entries) = std::fs::read_dir(&t_dir_buf) else { return; };
        let mut files: Vec<(PathBuf, SystemTime, u64)> = Vec::new();

        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let fname = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if fname.ends_with(".part") || fname.ends_with(".nothumb") {
                let _ = std::fs::remove_file(&p);
                continue;
            }
            // Auto-purge solid dark slate/black fallback cards from previous builds
            if fname.ends_with(".jpg") {
                if let Ok(b) = std::fs::read(&p) {
                    if is_fallback_black_card_bytes(&b) {
                        let _ = std::fs::remove_file(&p);
                        continue;
                    }
                }
            }
            if let Ok(meta) = p.metadata() {
                let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                files.push((p, modified, meta.len()));
            }
        }

        files.sort_by_key(|(_, modified, _)| *modified);
        let max_files = 500usize;
        let max_bytes = 256 * 1024 * 1024u64; // 256 MB cap
        let mut total_bytes: u64 = files.iter().map(|(_, _, len)| *len).sum();

        while files.len() > max_files || total_bytes > max_bytes {
            if let Some((path, _, len)) = files.first().cloned() {
                let _ = std::fs::remove_file(&path);
                total_bytes = total_bytes.saturating_sub(len);
                files.remove(0);
            } else {
                break;
            }
        }
    });
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

fn photo_size_dimensions(s: &PhotoSize) -> (i32, i32) {
    match s {
        PhotoSize::Size(sz) => (sz.width, sz.height),
        PhotoSize::Progressive(p) => (p.width, p.height),
        PhotoSize::Cached(c) => (c.width, c.height),
        _ => (0, 0),
    }
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

    // Filter static downloadable layers with size() > 0 (ignoring 0-byte stripped mini-thumbs)
    let mut downloadable: Vec<&PhotoSize> = sizes
        .iter()
        .filter(|s| matches!(s, PhotoSize::Size(_) | PhotoSize::Progressive(_)) && s.size() > 0)
        .collect();

    downloadable.sort_by_key(|s| {
        let (w, h) = photo_size_dimensions(s);
        if w > 0 && h > 0 { w * h } else { s.size() as i32 }
    });

    if !downloadable.is_empty() {
        if sharp {
            // Jelas: largest static layer available in Telegram.
            // If static layer max dimension is < 400px, return None to trigger HD photo chunk download or 1080p FFmpeg video frame extraction.
            let best = downloadable.last().copied()?;
            let (w, h) = photo_size_dimensions(best);
            if w > 0 && h > 0 && w.max(h) < 400 {
                return None;
            }
            return Some(best.clone());
        }

        if saver {
            // Hemat downloadable fallback: smallest non-stripped layer
            return downloadable.first().map(|s| (*s).clone());
        }
        // Seimbang: prefer layer closest to ~512px max dim (avoids tiny blur/pixelation while keeping good quality).
        // If no qualifying (>=240px) layer, return None to trigger photo chunk / FFmpeg frame fallback.
        let target = 512i32;
        let mut candidates: Vec<(i32, &PhotoSize)> = downloadable
            .iter()
            .filter_map(|s| {
                let (w, h) = photo_size_dimensions(s);
                let d = w.max(h);
                if d > 0 && d >= 240 {
                    Some(((d - target).abs(), *s))
                } else {
                    None
                }
            })
            .collect();
        if !candidates.is_empty() {
            candidates.sort_by_key(|(dist, _)| *dist);
            let (_, best) = candidates[0];
            return Some(best.clone());
        }
        return downloadable.last().map(|s| (*s).clone());
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

fn media_thumbs(_client: Option<&Client>, media: &Media) -> Vec<PhotoSize> {
    match media {
        Media::Photo(p) => p.thumbs(),
        Media::Document(d) => d.thumbs(),
        Media::Sticker(s) => s.document.thumbs(),
        Media::WebPage(wp) => match &wp.raw.webpage {
            tl::enums::WebPage::Page(page) => {
                let mut out = Vec::new();
                if let Some(photo) = &page.photo {
                    let p = grammers_client::media::Photo::from_raw(photo.clone());
                    out.extend(p.thumbs());
                }
                if let Some(doc) = &page.document {
                    let media_doc = tl::types::MessageMediaDocument {
                        nopremium: false,
                        spoiler: false,
                        video: false,
                        round: false,
                        voice: false,
                        video_cover: None,
                        video_timestamp: None,
                        document: Some(doc.clone()),
                        alt_documents: None,
                        ttl_seconds: None,
                    };
                    let d = grammers_client::media::Document::from_raw_media(media_doc);
                    out.extend(d.thumbs());
                }
                out
            }
            _ => vec![],
        },
        _ => vec![],
    }
}

/// Inline stripped JPEG (Telegram mini-thumb) as data-URL — no network GetFile.
/// Used by list_media so the grid paints like the official app on first paint.
pub fn stripped_thumb_data_url(media: &Media) -> Option<String> {
    let mut best: Option<(usize, PhotoSize)> = None;
    for s in media_thumbs(None, media) {
        if let Some(data) = s.to_data() {
            let bytes = unstrip_jpeg(&data).unwrap_or(data);
            if !bytes.is_empty() {
                let size = bytes.len();
                if best.as_ref().map_or(true, |(b, _)| size > *b) {
                    best = Some((size, s.clone()));
                }
            }
        }
    }
    if let Some((_, s)) = best {
        if let Some(url) = to_data_url(&s.to_data().unwrap()) {
            return Some(url);
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
    let mut iter = client.iter_download(thumb).chunk_size(256 * 1024);
    while let Some(chunk) = iter.next().await.map_err(|e| map_invocation(&e))? {
        out.extend_from_slice(&chunk);
        if out.len() > 512 * 1024 {
            break;
        }
    }
    Ok(out)
}

fn convert_avcc_to_annexb(raw_data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(raw_data.len() + 1024);
    let mut pos = 0;
    while pos + 4 < raw_data.len() {
        let nal_len = u32::from_be_bytes([
            raw_data[pos],
            raw_data[pos + 1],
            raw_data[pos + 2],
            raw_data[pos + 3],
        ]) as usize;
        if nal_len > 0 && nal_len < 16 * 1024 * 1024 && pos + 4 + nal_len <= raw_data.len() {
            out.extend_from_slice(&[0x00, 0x00, 0x00, 0x01]);
            out.extend_from_slice(&raw_data[pos + 4..pos + 4 + nal_len]);
            pos += 4 + nal_len;
        } else {
            break;
        }
    }
    if out.is_empty() {
        raw_data.to_vec()
    } else {
        out
    }
}

fn render_pdf_first_page_winrt(pdf_bytes: &[u8]) -> Option<Vec<u8>> {
    let temp_dir = std::env::temp_dir();
    let rand_id = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let sample_pdf_path = temp_dir.join(format!("autogram_pdf_{rand_id}.pdf"));
    let out_jpg_path = temp_dir.join(format!("autogram_pdf_thumb_{rand_id}.jpg"));

    if std::fs::write(&sample_pdf_path, pdf_bytes).is_err() {
        return None;
    }

    let ps_cmd = format!(
        "[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime] | Out-Null; \
         [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null; \
         $fileTask = [Windows.Storage.StorageFile]::GetFileFromPathAsync('{}'); \
         while ($fileTask.Status -eq [Windows.Foundation.AsyncStatus]::Started) {{ [System.Threading.Thread]::Sleep(10) }} \
         $file = $fileTask.GetResults(); \
         $docTask = [Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file); \
         while ($docTask.Status -eq [Windows.Foundation.AsyncStatus]::Started) {{ [System.Threading.Thread]::Sleep(10) }} \
         $doc = $docTask.GetResults(); \
         if ($doc.PageCount -gt 0) {{ \
             $page = $doc.GetPage(0); \
             $stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new(); \
             $renderTask = $page.RenderToStreamAsync($stream); \
             while ($renderTask.Status -eq [Windows.Foundation.AsyncStatus]::Started) {{ [System.Threading.Thread]::Sleep(10) }} \
             $buf = New-Object byte[] $stream.Size; \
             $reader = [Windows.Storage.Streams.DataReader]::new($stream); \
             $reader.LoadAsync($stream.Size).GetAwaiter().GetResult() | Out-Null; \
             $reader.ReadBytes($buf); \
             [System.IO.File]::WriteAllBytes('{}', $buf); \
         }}",
        sample_pdf_path.to_string_lossy().replace('\\', "\\\\"),
        out_jpg_path.to_string_lossy().replace('\\', "\\\\")
    );

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = std::process::Command::new("powershell")
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-Command")
            .arg(&ps_cmd)
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }

    let res = if out_jpg_path.exists() {
        let b = std::fs::read(&out_jpg_path).ok();
        if let Some(ref data) = b {
            if data.len() >= 512 {
                b
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let _ = std::fs::remove_file(&sample_pdf_path);
    let _ = std::fs::remove_file(&out_jpg_path);

    res
}

async fn download_media_thumb(
    client: &Client,
    media: &Media,
    quality: &str,
) -> Result<Vec<u8>, TgError> {
    let sizes = media_thumbs(Some(client), media);
    let mode = quality.to_lowercase();
    let saver = mode.contains("hemat") || mode.contains("saver");

    // Tier 1: Try selected quality size
    if let Some(pick) = pick_thumb(&sizes, quality) {
        if let Ok(bytes) = download_thumb_bytes(client, &pick).await {
            let min_ok = 64;
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
        let (w, h) = photo_size_dimensions(s);
        let max_dim = w.max(h);
        let mode = quality.to_lowercase();
        let sharp = mode.contains("jelas") || mode.contains("sharp");
        // For jelas mode only, skip tiny static layer (< 400px) so Tier 4 photo chunk or Tier 5 FFmpeg HD frame extraction can run
        if sharp && max_dim > 0 && max_dim < 400 {
            continue;
        }
        if let Ok(bytes) = download_thumb_bytes(client, s).await {
            let min_bytes = 64;
            if bytes.len() >= min_bytes {
                return Ok(bytes);
            }
        }
    }

    // Tier 4: Fallback for photos (download full photo payload up to 2MB)
    if let Media::Photo(p) = media {
        let max_bytes = 2048 * 1024;
        let mut out = Vec::new();
        let mut iter = client.iter_download(p).chunk_size(256 * 1024);
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

    // Tier 5: Fallback for Documents (videos/photos uploaded "as file" without Telegram static thumbs, PDFs, or custom documents like /-1004468191168/73)
    if let Media::Document(d) = media {
        let mime = d.mime_type().unwrap_or("").to_lowercase();
        let name = d.name().unwrap_or("").to_lowercase();
        let has_video_attr = d.raw.video;

        let mut is_video = has_video_attr
            || mime.starts_with("video/")
            || name.ends_with(".mp4")
            || name.ends_with(".mov")
            || name.ends_with(".mkv")
            || name.ends_with(".webm")
            || name.ends_with(".avi")
            || name.ends_with(".m4v")
            || name.ends_with(".3gp")
            || name.ends_with(".ts")
            || name.ends_with(".flv")
            || name.ends_with(".wmv")
            || name.ends_with(".m2ts")
            || name.ends_with(".vob")
            || name.ends_with(".ogv")
            || name.ends_with(".3g2")
            || name.ends_with(".f4v");

        let mut is_image = mime.starts_with("image/")
            || name.ends_with(".jpg")
            || name.ends_with(".jpeg")
            || name.ends_with(".png")
            || name.ends_with(".webp")
            || name.ends_with(".bmp")
            || name.ends_with(".gif")
            || name.ends_with(".heic")
            || name.ends_with(".heif")
            || name.ends_with(".avif")
            || name.ends_with(".tif")
            || name.ends_with(".tiff")
            || name.ends_with(".ico")
            || name.ends_with(".jfif");

        let mut is_pdf = mime == "application/pdf" || mime.contains("pdf") || name.ends_with(".pdf");

        let mut sample_bytes = Vec::new();
        let mut iter = client.iter_download(d).chunk_size(256 * 1024);
        if let Ok(Some(chunk)) = iter.next().await.map_err(|e| map_invocation(&e)) {
            sample_bytes.extend_from_slice(&chunk);
        }

        if !sample_bytes.is_empty() {
            if !is_image && !is_video && !is_pdf && sample_bytes.len() >= 4 {
                // Image magic bytes: JPEG (0xFF 0xD8), PNG (\x89PNG), WebP (RIFF...WEBP), GIF (GIF8), BMP (BM), HEIC/HEIF/AVIF
                if (sample_bytes[0] == 0xff && sample_bytes[1] == 0xd8)
                    || (sample_bytes.starts_with(b"\x89PNG"))
                    || (sample_bytes.starts_with(b"RIFF") && sample_bytes.len() >= 12 && &sample_bytes[8..12] == b"WEBP")
                    || (sample_bytes.starts_with(b"GIF8"))
                    || (sample_bytes.starts_with(b"BM"))
                    || (sample_bytes.len() >= 12 && &sample_bytes[4..8] == b"ftyp" && (
                        &sample_bytes[8..12] == b"heic" || &sample_bytes[8..12] == b"heif" || &sample_bytes[8..12] == b"mif1" || &sample_bytes[8..12] == b"avif"
                    ))
                {
                    is_image = true;
                }
                // Video magic bytes: MP4/MOV (ftyp/moov/mdat at offset 4), MKV/WebM (0x1A 0x45 0xDF 0xA3), AVI (RIFF...AVI ), TS (0x47), FLV (FLV), OGV (OggS), WMV (\x30\x26\xB2\x75)
                else if (sample_bytes.len() >= 8 && (&sample_bytes[4..8] == b"ftyp" || &sample_bytes[4..8] == b"moov" || &sample_bytes[4..8] == b"mdat"))
                    || (sample_bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]))
                    || (sample_bytes.starts_with(b"RIFF") && sample_bytes.len() >= 12 && &sample_bytes[8..12] == b"AVI ")
                    || (sample_bytes.starts_with(b"FLV"))
                    || (sample_bytes.starts_with(b"OggS"))
                    || (sample_bytes.starts_with(&[0x30, 0x26, 0xB2, 0x75]))
                    || (sample_bytes.starts_with(&[0x47]))
                {
                    is_video = true;
                }
                // PDF magic bytes: %PDF-
                else if sample_bytes.starts_with(b"%PDF-") {
                    is_pdf = true;
                }
            }

            if is_image {
                let doc_size = d.size().unwrap_or(0) as usize;
                let max_bytes = if doc_size > 0 && doc_size <= 8 * 1024 * 1024 {
                    doc_size
                } else {
                    2048 * 1024
                };
                while sample_bytes.len() < max_bytes {
                    if let Ok(Some(chunk)) = iter.next().await.map_err(|e| map_invocation(&e)) {
                        sample_bytes.extend_from_slice(&chunk);
                    } else {
                        break;
                    }
                }

                // Check if image format is a standard web image format (JPEG, PNG, WebP, GIF)
                let is_standard_web_image = sample_bytes.len() >= 4 && (
                    (sample_bytes[0] == 0xff && sample_bytes[1] == 0xd8 && sample_bytes[2] == 0xff)
                        || sample_bytes.starts_with(b"\x89PNG")
                        || (sample_bytes.starts_with(b"RIFF") && sample_bytes.len() >= 12 && &sample_bytes[8..12] == b"WEBP")
                        || sample_bytes.starts_with(b"GIF8")
                );

                if is_standard_web_image {
                    return Ok(sample_bytes);
                }

                // If sample_bytes is text/json (e.g. daemon file-json test.jpg), reject immediately without wasting CPU/FFmpeg
                let is_text_or_json = sample_bytes.len() > 0 && (
                    sample_bytes.starts_with(b"{") || sample_bytes.starts_with(b"[") || sample_bytes.starts_with(b"<!--") || sample_bytes.starts_with(b"http")
                );
                if is_text_or_json {
                    let err_msg = format!("file '{name}' is text/json data despite image extension");
                    return Err(TgError::new(TgErrorCode::Internal, err_msg));
                }

                // Non-web image format (HEIC, TIFF, BMP, PSD, etc.): transcode to JPEG frame via FFmpeg
                let ext_hint = if name.contains('.') {
                    name.rsplit('.').next().unwrap_or("jpg")
                } else {
                    "jpg"
                };
                if let Some(frame_bytes) = extract_ffmpeg_frame_sync(&sample_bytes, quality, ext_hint) {
                    return Ok(frame_bytes);
                }

                return Ok(sample_bytes);
            } else if is_pdf {
                // PDF extraction: try embedded cover image stream first, then WinRT PDF page render
                if let Some(img_bytes) = extract_embedded_pdf_image(&sample_bytes) {
                    return Ok(img_bytes);
                }
                if let Some(frame_bytes) = render_pdf_first_page_winrt(&sample_bytes) {
                    return Ok(frame_bytes);
                }

                // If sample_bytes is partial (e.g. 256KB of multi-MB PDF), download additional sample
                // to include trailer/XRef structure so WinRT or embedded image search can succeed
                let doc_size = d.size().unwrap_or(0) as usize;
                if doc_size > 0 && doc_size <= 8 * 1024 * 1024 && sample_bytes.len() < doc_size {
                    let max_pdf_sample = doc_size.min(2048 * 1024);
                    while sample_bytes.len() < max_pdf_sample {
                        if let Ok(Some(chunk)) = iter.next().await.map_err(|e| map_invocation(&e)) {
                            sample_bytes.extend_from_slice(&chunk);
                        } else {
                            break;
                        }
                    }
                    if let Some(img_bytes) = extract_embedded_pdf_image(&sample_bytes) {
                        return Ok(img_bytes);
                    }
                    if let Some(frame_bytes) = render_pdf_first_page_winrt(&sample_bytes) {
                        return Ok(frame_bytes);
                    }
                }
            } else if is_video {
                let doc_size = d.size().unwrap_or(0) as usize;
                let mode = quality.to_lowercase();
                let saver = mode.contains("hemat") || mode.contains("saver");

                // Phase 3: Detect AV1 encoding to apply larger sample budget.
                // AV1 MP4s often store moov at the end and have sparse keyframes;
                // 2 MB from the head is insufficient — 8 MB covers 99% of Telegram AV1 uploads.
                // We check both the MIME type / filename and the actual magic bytes in the first chunk.
                let is_av1_video = mime.contains("av1")
                    || name.ends_with(".av1")
                    || sample_bytes.windows(4).any(|w| w == b"av1C")
                    || sample_bytes.windows(4).any(|w| w == b"av01");

                // Apply 8 MB sample budget for AV1 / 2K MP4 video documents to handle sparse keyframes.

                // In Saver (Hemat) mode: fetch up to 768KB sample (3 chunks) for fast frame extraction without heavy bandwidth waste.
                // In Seimbang/Jelas mode: fetch up to 2MB sample (non-AV1) or 8MB (AV1) to handle late moov atoms.
                let max_sample = if is_av1_video {
                    // AV1 needs more headroom — saver uses 4 MB, normal uses 8 MB
                    if saver { 4 * 1024 * 1024 } else { 8 * 1024 * 1024 }
                } else if saver {
                    768 * 1024
                } else {
                    2048 * 1024
                };

                let ext_hint = if name.ends_with(".webm") {
                    "webm"
                } else if name.ends_with(".mkv") {
                    "mkv"
                } else if name.ends_with(".mov") {
                    "mov"
                } else if name.ends_with(".avi") {
                    "avi"
                } else if name.ends_with(".ts") {
                    "ts"
                } else if name.ends_with(".flv") {
                    "flv"
                } else if name.ends_with(".wmv") {
                    "wmv"
                } else {
                    "mp4"
                };

                while sample_bytes.len() < max_sample {
                    if let Ok(Some(chunk)) = iter.next().await.map_err(|e| map_invocation(&e)) {
                        sample_bytes.extend_from_slice(&chunk);
                    } else {
                        break;
                    }
                }

                if let Some(frame_bytes) = extract_ffmpeg_frame_sync(&sample_bytes, quality, ext_hint) {
                    return Ok(frame_bytes);
                }

                // Try patched mdat header for truncated faststart MP4s
                let patched_sample = patch_head_mp4(&sample_bytes);
                if let Some(frame_bytes) = extract_ffmpeg_frame_sync(&patched_sample, quality, ext_hint) {
                    return Ok(frame_bytes);
                }

                // Progressive multi-pass tail chunk fetch (8 chunks = 2MB, 24 chunks = 6MB, 48 chunks = 12MB)
                // Covers large 2K/4K MP4 video documents where moov atom exceeds 2MB or is offset from EOF.
                let chunk_bytes = 256 * 1024;
                if doc_size > 0 {
                    let total_chunks = (doc_size + chunk_bytes - 1) / chunk_bytes;
                    for tail_count in [8usize, 24usize, 48usize, 96usize, 160usize] {
                        let actual_tail_count = tail_count.min(total_chunks);
                        let skip = total_chunks.saturating_sub(actual_tail_count) as i32;
                        let mut tail_bytes = Vec::new();
                        let mut tail_iter = client.iter_download(d).chunk_size(chunk_bytes as i32).skip_chunks(skip);
                        while let Ok(Some(chunk)) = tail_iter.next().await.map_err(|e| map_invocation(&e)) {
                            tail_bytes.extend_from_slice(&chunk);
                        }
                        if !tail_bytes.is_empty() {
                            if let Some(reconstructed) = make_faststart_mp4(&sample_bytes, &tail_bytes) {
                                if let Some(frame_bytes) = extract_ffmpeg_frame_sync(&reconstructed, quality, ext_hint) {
                                    return Ok(frame_bytes);
                                }
                            }
                            if let Some(frame_bytes) = make_smart_target_mp4(client, d, &sample_bytes, &tail_bytes, quality, ext_hint).await {
                                return Ok(frame_bytes);
                            }
                        }
                        if actual_tail_count >= total_chunks {
                            break;
                        }
                    }
                }

                // Ultimate Rescue Fallback for video documents (up to 25MB head sample for stubborn video files):
                // Download additional head chunks and test FFmpeg progressively every 4MB chunk
                let max_rescue_bytes = if doc_size > 25 * 1024 * 1024 {
                    25 * 1024 * 1024
                } else {
                    doc_size.min(12 * 1024 * 1024)
                };
                if doc_size > 0 && sample_bytes.len() < max_rescue_bytes {
                    while sample_bytes.len() < max_rescue_bytes {
                        if let Ok(Some(chunk)) = iter.next().await.map_err(|e| map_invocation(&e)) {
                            sample_bytes.extend_from_slice(&chunk);
                            if sample_bytes.len() % (4 * 1024 * 1024) == 0 {
                                if let Some(frame_bytes) = extract_ffmpeg_frame_sync(&sample_bytes, quality, ext_hint) {
                                    return Ok(frame_bytes);
                                }
                            }
                        } else {
                            break;
                        }
                    }
                    if let Some(frame_bytes) = extract_ffmpeg_frame_sync(&sample_bytes, quality, ext_hint) {
                        return Ok(frame_bytes);
                    }
                }
            } else {
                // Fallback extraction for general documents
                let ext_hint = if name.contains('.') {
                    name.rsplit('.').next().unwrap_or("bin")
                } else {
                    "bin"
                };

                let is_known_media_ext = matches!(
                    ext_hint,
                    "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "3gp" | "ts" | "flv" | "wmv"
                        | "jpg" | "jpeg" | "png" | "webp" | "bmp" | "gif" | "heic" | "heif" | "avif" | "tiff"
                );

                let is_binary_archive_or_text = sample_bytes.len() > 0 && (
                    sample_bytes.starts_with(b"{")
                        || sample_bytes.starts_with(b"[")
                        || sample_bytes.starts_with(b"<!--")
                        || sample_bytes.starts_with(b"http")
                        || sample_bytes.starts_with(b"PK\x03\x04")
                        || sample_bytes.starts_with(b"Rar!\x1a\x07")
                        || sample_bytes.starts_with(b"7z\xbc\xaf\x27\x1c")
                        || !is_known_media_ext
                );

                if !is_binary_archive_or_text {
                    let test_ext = if ext_hint == "bin" || ext_hint == "dat" { "mp4" } else { ext_hint };
                    if let Some(frame_bytes) = extract_ffmpeg_frame_sync(&sample_bytes, quality, test_ext) {
                        return Ok(frame_bytes);
                    }
                }

                // Ultimate fallback for document media (e.g. msg 73 / image sent as document):
                // If sample_bytes contains JPEG/PNG/WebP/GIF/BMP header anywhere in first 64 bytes,
                // finish downloading image payload and return sample_bytes directly!
                if sample_bytes.len() >= 64 {
                    let head = &sample_bytes[..sample_bytes.len().min(64)];
                    let is_image_data = head.windows(2).any(|w| w == [0xff, 0xd8])
                        || head.windows(4).any(|w| w == b"\x89PNG")
                        || head.windows(4).any(|w| w == b"WEBP")
                        || head.windows(3).any(|w| w == b"GIF")
                        || head.starts_with(b"BM");
                    if is_image_data {
                        let doc_size = d.size().unwrap_or(0) as usize;
                        let max_bytes = if doc_size > 0 && doc_size <= 8 * 1024 * 1024 {
                            doc_size
                        } else {
                            2048 * 1024
                        };
                        while sample_bytes.len() < max_bytes {
                            if let Ok(Some(chunk)) = iter.next().await.map_err(|e| map_invocation(&e)) {
                                sample_bytes.extend_from_slice(&chunk);
                            } else {
                                break;
                            }
                        }
                        return Ok(sample_bytes);
                    }
                }
            }
        }
    }

    // Tier 6: Try downloading ANY available static thumbnail layer from Telegram (no dimension/quality restriction)
    for s in &sizes {
        if matches!(s, PhotoSize::Size(_) | PhotoSize::Progressive(_) | PhotoSize::Cached(_)) {
            if let Ok(bytes) = download_thumb_bytes(client, s).await {
                if bytes.len() >= 64 {
                    return Ok(bytes);
                }
            }
        }
    }

    // Tier 7: Last-resort fallback: return stripped/cached inline JPEG if available (instead of leaving empty card)
    for s in &sizes {
        if let Some(data) = s.to_data() {
            let bytes = unstrip_jpeg(&data).unwrap_or(data);
            if !bytes.is_empty() {
                return Ok(bytes);
            }
        }
    }



    let (media_kind, mime, name, size) = match media {
        Media::Photo(_) => ("Photo", String::new(), String::new(), 0),
        Media::Document(d) => (
            "Document",
            d.mime_type().unwrap_or("").to_string(),
            d.name().unwrap_or("").to_string(),
            d.size().unwrap_or(0),
        ),
        Media::Sticker(_) => ("Sticker", String::new(), String::new(), 0),
        Media::WebPage(_) => ("WebPage", String::new(), String::new(), 0),
        _ => ("UnknownMedia", String::new(), String::new(), 0),
    };
    let ffmpeg_ok = find_ffmpeg_binary().is_some();
    let err_msg = format!(
        "no valid thumb found (kind={media_kind} sizes={} mime='{mime}' name='{name}' size={size} ffmpeg={ffmpeg_ok})",
        sizes.len()
    );

    let is_video_doc = media_kind == "Document" && (
        mime.starts_with("video/")
            || name.ends_with(".mp4")
            || name.ends_with(".mov")
            || name.ends_with(".mkv")
            || name.ends_with(".webm")
            || name.ends_with(".avi")
            || name.ends_with(".m4v")
            || name.ends_with(".3gp")
            || name.ends_with(".ts")
            || name.ends_with(".flv")
            || name.ends_with(".wmv")
    );

    if is_video_doc {
        tg_log::info(BACKEND, "thumb_miss_fallback", &format!("Video document '{name}' had no extractable frame; returning miss"));
    }

    if media_kind == "Document" && !mime.starts_with("video/") && !mime.starts_with("image/") {
        tg_log::info(BACKEND, "thumb_miss_detail", &err_msg);
    } else {
        tg_log::warn(BACKEND, "thumb_miss_detail", &err_msg);
    }
    Err(TgError::new(TgErrorCode::Internal, err_msg))
}

fn extract_embedded_pdf_image(pdf_bytes: &[u8]) -> Option<Vec<u8>> {
    if pdf_bytes.len() < 128 {
        return None;
    }
    // Search for JPEG header \xFF\xD8\xFF in pdf_bytes
    let max_len = pdf_bytes.len().saturating_sub(64);
    for i in 0..max_len {
        if pdf_bytes[i] == 0xff && pdf_bytes[i + 1] == 0xd8 && pdf_bytes[i + 2] == 0xff {
            // Find end of JPEG marker \xFF\xD9
            if let Some(end_rel) = pdf_bytes[i + 3..].windows(2).position(|w| w == [0xff, 0xd9]) {
                let end_pos = i + 3 + end_rel + 2;
                let jpeg_data = &pdf_bytes[i..end_pos];
                if jpeg_data.len() >= 512 {
                    return Some(jpeg_data.to_vec());
                }
            }
        }
        // Search for PNG header \x89PNG
        if pdf_bytes[i..].starts_with(b"\x89PNG\r\n\x1a\n") {
            if let Some(end_rel) = pdf_bytes[i + 8..].windows(4).position(|w| w == b"IEND") {
                let end_pos = i + 8 + end_rel + 8;
                let png_data = &pdf_bytes[i..end_pos.min(pdf_bytes.len())];
                if png_data.len() >= 256 {
                    return Some(png_data.to_vec());
                }
            }
        }
    }
    None
}

fn patch_moov_offsets(moov_buf: &mut [u8], shift_amount: usize) {
    if shift_amount == 0 || moov_buf.len() < 12 {
        return;
    }
    let shift_u32 = shift_amount as u32;
    let shift_u64 = shift_amount as u64;

    // Patch stco (32-bit chunk offset atom)
    let stco_tag = b"stco";
    if moov_buf.len() >= 12 {
        for i in 4..=moov_buf.len() - 12 {
            if &moov_buf[i..i + 4] == stco_tag {
                let entry_count = u32::from_be_bytes([
                    moov_buf[i + 8],
                    moov_buf[i + 9],
                    moov_buf[i + 10],
                    moov_buf[i + 11],
                ]) as usize;
                let mut off = i + 12;
                for _ in 0..entry_count {
                    if off + 4 <= moov_buf.len() {
                        let old_val = u32::from_be_bytes([
                            moov_buf[off],
                            moov_buf[off + 1],
                            moov_buf[off + 2],
                            moov_buf[off + 3],
                        ]);
                        let new_val = old_val.wrapping_add(shift_u32);
                        moov_buf[off..off + 4].copy_from_slice(&new_val.to_be_bytes());
                        off += 4;
                    } else {
                        break;
                    }
                }
            }
        }
    }

    // Patch co64 (64-bit chunk offset atom)
    let co64_tag = b"co64";
    if moov_buf.len() >= 12 {
        for i in 4..=moov_buf.len() - 12 {
            if &moov_buf[i..i + 4] == co64_tag {
                let entry_count = u32::from_be_bytes([
                    moov_buf[i + 8],
                    moov_buf[i + 9],
                    moov_buf[i + 10],
                    moov_buf[i + 11],
                ]) as usize;
                let mut off = i + 12;
                for _ in 0..entry_count {
                    if off + 8 <= moov_buf.len() {
                        let old_val = u64::from_be_bytes([
                            moov_buf[off],
                            moov_buf[off + 1],
                            moov_buf[off + 2],
                            moov_buf[off + 3],
                            moov_buf[off + 4],
                            moov_buf[off + 5],
                            moov_buf[off + 6],
                            moov_buf[off + 7],
                        ]);
                        let new_val = old_val.wrapping_add(shift_u64);
                        moov_buf[off..off + 8].copy_from_slice(&new_val.to_be_bytes());
                        off += 8;
                    } else {
                        break;
                    }
                }
            }
        }
    }
}

fn patch_head_mp4(sample_bytes: &[u8]) -> Vec<u8> {
    let mut patched = sample_bytes.to_vec();
    if patched.len() >= 12 {
        for i in 4..=patched.len() - 8 {
            if &patched[i..i + 4] == b"mdat" {
                let mdat_start = i - 4;
                let new_len = (patched.len() - mdat_start) as u32;
                patched[mdat_start..mdat_start + 4].copy_from_slice(&new_len.to_be_bytes());
                break;
            }
        }
    }
    patched
}

fn parse_first_chunk_offset(moov_buf: &[u8]) -> Option<u64> {
    let stco_tag = b"stco";
    if moov_buf.len() >= 16 {
        for i in 4..=moov_buf.len() - 16 {
            if &moov_buf[i..i + 4] == stco_tag {
                let entry_count = u32::from_be_bytes([
                    moov_buf[i + 8],
                    moov_buf[i + 9],
                    moov_buf[i + 10],
                    moov_buf[i + 11],
                ]);
                if entry_count > 0 {
                    let first_off = u32::from_be_bytes([
                        moov_buf[i + 12],
                        moov_buf[i + 13],
                        moov_buf[i + 14],
                        moov_buf[i + 15],
                    ]) as u64;
                    if first_off > 0 {
                        return Some(first_off);
                    }
                }
            }
        }
    }
    let co64_tag = b"co64";
    if moov_buf.len() >= 20 {
        for i in 4..=moov_buf.len() - 20 {
            if &moov_buf[i..i + 4] == co64_tag {
                let entry_count = u32::from_be_bytes([
                    moov_buf[i + 8],
                    moov_buf[i + 9],
                    moov_buf[i + 10],
                    moov_buf[i + 11],
                ]);
                if entry_count > 0 {
                    let first_off = u64::from_be_bytes([
                        moov_buf[i + 12],
                        moov_buf[i + 13],
                        moov_buf[i + 14],
                        moov_buf[i + 15],
                        moov_buf[i + 16],
                        moov_buf[i + 17],
                        moov_buf[i + 18],
                        moov_buf[i + 19],
                    ]);
                    if first_off > 0 {
                        return Some(first_off);
                    }
                }
            }
        }
    }
    None
}

fn make_faststart_mp4(sample_bytes: &[u8], tail_bytes: &[u8]) -> Option<Vec<u8>> {
    if sample_bytes.len() < 16 || tail_bytes.is_empty() {
        return None;
    }
    let moov_tag = b"moov";
    let mut moov_pos = None;
    let mut target_buf = tail_bytes;

    if tail_bytes.len() >= 8 {
        for i in (4..=tail_bytes.len() - 4).rev() {
            if &tail_bytes[i..i + 4] == moov_tag {
                moov_pos = Some(i - 4);
                break;
            }
        }
    }
    if moov_pos.is_none() && sample_bytes.len() >= 8 {
        for i in (4..=sample_bytes.len() - 4).rev() {
            if &sample_bytes[i..i + 4] == moov_tag {
                moov_pos = Some(i - 4);
                target_buf = sample_bytes;
                break;
            }
        }
    }

    let pos = moov_pos?;
    let raw_sz = if pos + 4 <= target_buf.len() {
        u32::from_be_bytes([
            target_buf[pos],
            target_buf[pos + 1],
            target_buf[pos + 2],
            target_buf[pos + 3],
        ]) as usize
    } else {
        return None;
    };

    let moov_size = if raw_sz == 1 && pos + 16 <= target_buf.len() {
        u64::from_be_bytes([
            target_buf[pos + 8],
            target_buf[pos + 9],
            target_buf[pos + 10],
            target_buf[pos + 11],
            target_buf[pos + 12],
            target_buf[pos + 13],
            target_buf[pos + 14],
            target_buf[pos + 15],
        ]) as usize
    } else if raw_sz >= 8 {
        raw_sz
    } else {
        return None;
    };

    if pos + moov_size > target_buf.len() {
        // moov atom is truncated in current target_buf.
        // Return None so caller fetches a larger tail sample to get the complete moov atom.
        return None;
    }

    let mut moov_slice = target_buf[pos..pos + moov_size].to_vec();
    patch_moov_offsets(&mut moov_slice, moov_size);

    let ftyp_size = if sample_bytes.len() >= 8 && &sample_bytes[4..8] == b"ftyp" {
        u32::from_be_bytes([
            sample_bytes[0],
            sample_bytes[1],
            sample_bytes[2],
            sample_bytes[3],
        ]) as usize
    } else {
        32
    };

    let ftyp_len = ftyp_size.min(sample_bytes.len());
    let mut out = Vec::with_capacity(ftyp_len + moov_size + sample_bytes.len() - ftyp_len);

    out.extend_from_slice(&sample_bytes[0..ftyp_len]);
    out.extend_from_slice(&moov_slice);

    let mut mdat_rem = sample_bytes[ftyp_len..].to_vec();
    if mdat_rem.len() >= 8 && &mdat_rem[4..8] == b"mdat" {
        let new_mdat_len = mdat_rem.len() as u32;
        mdat_rem[0..4].copy_from_slice(&new_mdat_len.to_be_bytes());
    }
    out.extend_from_slice(&mdat_rem);

    Some(out)
}

async fn make_smart_target_mp4(
    client: &grammers_client::Client,
    d: &grammers_client::media::Document,
    sample_bytes: &[u8],
    tail_bytes: &[u8],
    quality: &str,
    ext_hint: &str,
) -> Option<Vec<u8>> {
    if sample_bytes.len() < 16 || tail_bytes.is_empty() {
        return None;
    }
    let moov_tag = b"moov";
    let mut moov_pos = None;
    let mut target_buf = tail_bytes;

    if tail_bytes.len() >= 8 {
        for i in (4..=tail_bytes.len() - 4).rev() {
            if &tail_bytes[i..i + 4] == moov_tag {
                moov_pos = Some(i - 4);
                break;
            }
        }
    }
    if moov_pos.is_none() && sample_bytes.len() >= 8 {
        for i in (4..=sample_bytes.len() - 4).rev() {
            if &sample_bytes[i..i + 4] == moov_tag {
                moov_pos = Some(i - 4);
                target_buf = sample_bytes;
                break;
            }
        }
    }

    let pos = moov_pos?;
    let raw_sz = if pos + 4 <= target_buf.len() {
        u32::from_be_bytes([
            target_buf[pos],
            target_buf[pos + 1],
            target_buf[pos + 2],
            target_buf[pos + 3],
        ]) as usize
    } else {
        return None;
    };

    let moov_size = if raw_sz >= 8 { raw_sz } else { return None; };
    if pos + moov_size > target_buf.len() {
        return None;
    }

    let moov_slice = &target_buf[pos..pos + moov_size];
    let first_off = parse_first_chunk_offset(moov_slice)?;

    let chunk_size = 256 * 1024u64;
    let target_chunk = (first_off / chunk_size) as i32;
    let chunk_start_byte = (target_chunk as u64) * chunk_size;

    let mut target_frame_bytes = Vec::new();
    let mut iter = client.iter_download(d).chunk_size(chunk_size as i32).skip_chunks(target_chunk);
    // Fetch 16 chunks (4 MB) starting at target_chunk to provide enough keyframes for 1s-3s seeking
    for _ in 0..16 {
        if let Ok(Some(chunk)) = iter.next().await.map_err(|e| map_invocation(&e)) {
            target_frame_bytes.extend_from_slice(&chunk);
        } else {
            break;
        }
    }
    if target_frame_bytes.is_empty() {
        return None;
    }

    let ftyp_size = if sample_bytes.len() >= 8 && &sample_bytes[4..8] == b"ftyp" {
        u32::from_be_bytes([
            sample_bytes[0],
            sample_bytes[1],
            sample_bytes[2],
            sample_bytes[3],
        ]) as usize
    } else {
        32
    };
    let ftyp_len = ftyp_size.min(sample_bytes.len());

    let new_first_off = (ftyp_len + moov_size) as u64 + (first_off.saturating_sub(chunk_start_byte));
    let shift_needed = new_first_off.wrapping_sub(first_off);

    let mut patched_moov = moov_slice.to_vec();
    patch_moov_offsets(&mut patched_moov, shift_needed as usize);

    let mut out = Vec::with_capacity(ftyp_len + moov_size + target_frame_bytes.len() + 16);
    out.extend_from_slice(&sample_bytes[0..ftyp_len]);
    out.extend_from_slice(&patched_moov);

    if target_frame_bytes.len() >= 8 && &target_frame_bytes[4..8] == b"mdat" {
        out.extend_from_slice(&target_frame_bytes);
    } else {
        let mdat_hdr_size = (target_frame_bytes.len() + 8) as u32;
        out.extend_from_slice(&mdat_hdr_size.to_be_bytes());
        out.extend_from_slice(b"mdat");
        out.extend_from_slice(&target_frame_bytes);
    }

    extract_ffmpeg_frame_sync(&out, quality, ext_hint)
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
        "../../worker/venv/Lib/site-packages/imageio_ffmpeg/binaries",
        "cache/bin",
        "bin",
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

    // Check common Windows installation & application locations (up to depth 4 for nested software like CapCut, FormatFactory, BlueStacks)
    if cfg!(windows) {
        let mut win_dirs = Vec::new();
        if let Ok(pf) = std::env::var("ProgramFiles") {
            win_dirs.push(std::path::PathBuf::from(pf));
        }
        if let Ok(pfx86) = std::env::var("ProgramFiles(x86)") {
            win_dirs.push(std::path::PathBuf::from(pfx86));
        }
        if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
            win_dirs.push(std::path::PathBuf::from(local_app));
        }
        win_dirs.push(std::path::PathBuf::from("C:\\ffmpeg"));
        win_dirs.push(std::path::PathBuf::from("C:\\Tools"));

        for base in win_dirs {
            if let Some(p) = search_ffmpeg_recursive(&base, 4) {
                return Some(p);
            }
        }
    }

    None
}

fn search_ffmpeg_recursive(dir: &std::path::Path, max_depth: usize) -> Option<std::path::PathBuf> {
    if max_depth == 0 || !dir.is_dir() {
        return None;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        let mut subdirs = Vec::new();
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                let name = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                if name.starts_with("ffmpeg") && (name.ends_with(".exe") || !cfg!(windows)) {
                    return Some(p);
                }
            } else if p.is_dir() {
                subdirs.push(p);
            }
        }
        for sub in subdirs {
            if let Some(found) = search_ffmpeg_recursive(&sub, max_depth - 1) {
                return Some(found);
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

/// Phase 1: Runtime AV1 decoder capability probe.
/// Cached in a OnceLock so the subprocess is only spawned once per app session.
/// Returns true if the bundled FFmpeg binary was compiled with libdav1d, libaom, or any AV1 decoder.
#[allow(dead_code)]
fn ffmpeg_supports_av1(ff_exe: &std::path::Path) -> bool {
    static CACHE: OnceLock<bool> = OnceLock::new();
    *CACHE.get_or_init(|| {
        let Ok(out) = std::process::Command::new(ff_exe)
            .args(&["-hide_banner", "-codecs"])
            .output()
        else {
            return false;
        };
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        let combined = format!("{stdout}{stderr}");
        combined.contains("libdav1d")
            || combined.contains("libaom")
            || combined.contains("av1 ")
            || combined.contains("av1,")
    })
}

fn generate_video_fallback_card() -> Option<Vec<u8>> {
    if let Some(ff_exe) = find_ffmpeg_binary() {
        let temp_dir = std::env::temp_dir();
        let rand_id = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let frame_path = temp_dir.join(format!("autogram_fallback_vidcard_{rand_id}.jpg"));

        let status = std::process::Command::new(&ff_exe)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-y")
            .arg("-f")
            .arg("lavfi")
            .arg("-i")
            .arg("color=c=0x0f172a:s=480x270")
            .arg("-vframes")
            .arg("1")
            .arg("-q:v")
            .arg("3")
            .arg(&frame_path)
            .output();

        if status.is_ok() && frame_path.exists() {
            if let Ok(b) = std::fs::read(&frame_path) {
                let _ = std::fs::remove_file(&frame_path);
                if b.len() >= 256 {
                    return Some(b);
                }
            }
        }
    }
    Some(get_static_fallback_jpeg())
}

fn get_static_fallback_jpeg() -> Vec<u8> {
    vec![
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
        0x00, 0x60, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
        0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
        0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
        0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
        0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xdb, 0x00, 0x43, 0x01, 0x09, 0x09,
        0x09, 0x0c, 0x0b, 0x0c, 0x18, 0x0d, 0x0d, 0x18, 0x32, 0x21, 0x1c, 0x21, 0x32, 0x32, 0x32, 0x32,
        0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32,
        0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32,
        0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x0e, 0x01, 0xe0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01,
        0x03, 0x11, 0x01, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01,
        0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
        0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04,
        0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05,
        0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1,
        0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a,
        0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38,
        0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
        0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78,
        0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97,
        0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5,
        0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3,
        0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9,
        0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xc4, 0x00, 0x1f, 0x01,
        0x00, 0x03, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x11,
        0x00, 0x02, 0x01, 0x02, 0x04, 0x04, 0x03, 0x04, 0x07, 0x05, 0x04, 0x04, 0x00, 0x01, 0x02, 0x77,
        0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
        0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xA1, 0xB1, 0xC1, 0x09, 0x23, 0x33, 0x52, 0xF0,
        0x15, 0x62, 0x72, 0xD1, 0x0A, 0x16, 0x24, 0x34, 0xE1, 0x25, 0xF1, 0x17, 0x18, 0x19, 0x1A, 0x26,
        0x27, 0x28, 0x29, 0x2A, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
        0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
        0x69, 0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
        0x88, 0x89, 0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5,
        0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3,
        0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA,
        0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8,
        0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x0C, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3F, 0x00,
        0xF9, 0xFE, 0x8A, 0x28, 0x00, 0x00, 0xFF, 0xD9,
    ]
}

fn is_fallback_black_card_bytes(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return true;
    }
    if bytes == get_static_fallback_jpeg() {
        return true;
    }
    // Solid dark slate / black fallback JPEG generated by FFmpeg lavfi color=c=0x0f172a
    // Size is typically 400-3200 bytes and starts with JPEG header \xFF\xD8
    if bytes.len() >= 64 && bytes.len() <= 3200 && bytes.starts_with(&[0xff, 0xd8]) {
        if bytes.windows(4).any(|w| w == b"JFIF" || w == b"Exif") {
            if bytes.len() <= 2400 {
                return true;
            }
        }
    }
    false
}

fn extract_ffmpeg_frame_sync(sample_bytes: &[u8], quality: &str, ext_hint: &str) -> Option<Vec<u8>> {
    let ff_exe = find_ffmpeg_binary()?;
    let mode = quality.to_lowercase();
    let sharp = mode.contains("jelas") || mode.contains("sharp");
    let saver = mode.contains("hemat") || mode.contains("saver");

    let (scale_arg, q_val) = if sharp {
        ("scale=-2:720,format=yuv420p", "2")
    } else if saver {
        ("scale=-2:360,format=yuv420p", "6")
    } else {
        ("scale=-2:480,format=yuv420p", "3")
    };

    let is_av1 = ext_hint == "av1"
        || sample_bytes.windows(4).any(|w| w == b"av01")
        || sample_bytes.windows(4).any(|w| w == b"av1C");

    let av1_hwaccel_args: &[&str] = &["-hwaccel", "none"];

    let temp_dir = std::env::temp_dir();
    static FF_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let seq = FF_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let rand_id = format!("{pid}_{seq}_{nanos}");
    let ext = if ext_hint.is_empty() { "mp4" } else { ext_hint };
    let sample_path = temp_dir.join(format!("autogram_vid_sample_{rand_id}.{ext}"));
    let frame_path = temp_dir.join(format!("autogram_vid_frame_{rand_id}.jpg"));

    let _ = std::fs::write(&sample_path, sample_bytes);

    let check_frame_file = || -> Option<Vec<u8>> {
        if frame_path.exists() {
            if let Ok(b) = std::fs::read(&frame_path) {
                if b.len() >= 800 && !is_fallback_black_card_bytes(&b) {
                    return Some(b);
                }
            }
        }
        None
    };

    // Pass 1: Direct start of stream (-ss 0) to extract first keyframe from sample without seeking past EOF
    let status1 = std::process::Command::new(&ff_exe)
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-err_detect")
        .arg("ignore_err")
        .arg("-fflags")
        .arg("+genpts+discardcorrupt")
        .args(av1_hwaccel_args)
        .arg("-ss")
        .arg("0")
        .arg("-i")
        .arg(&sample_path)
        .arg("-an")
        .arg("-vframes")
        .arg("1")
        .arg("-vf")
        .arg(scale_arg)
        .arg("-q:v")
        .arg(q_val)
        .arg(&frame_path)
        .output();

    let (mut result, err1) = match status1 {
        Ok(ref out) => (check_frame_file(), String::from_utf8_lossy(&out.stderr).trim().to_string()),
        Err(ref e) => (None, e.to_string()),
    };

    // Pass 2: Output-level seek (-ss 00:00:00.100 after -i) fallback
    if result.is_none() {
        let _ = std::process::Command::new(&ff_exe)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-y")
            .args(av1_hwaccel_args)
            .arg("-i")
            .arg(&sample_path)
            .arg("-ss")
            .arg("00:00:00.100")
            .arg("-an")
            .arg("-vframes")
            .arg("1")
            .arg("-vf")
            .arg(scale_arg)
            .arg("-q:v")
            .arg(q_val)
            .arg(&frame_path)
            .output();

        result = check_frame_file();
    }

    // Pass 3: Seek to 0.5s (-ss 00:00:00.500)
    if result.is_none() {
        let _ = std::process::Command::new(&ff_exe)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-y")
            .args(av1_hwaccel_args)
            .arg("-ss")
            .arg("00:00:00.500")
            .arg("-i")
            .arg(&sample_path)
            .arg("-an")
            .arg("-vframes")
            .arg("1")
            .arg("-vf")
            .arg(scale_arg)
            .arg("-q:v")
            .arg(q_val)
            .arg(&frame_path)
            .output();

        result = check_frame_file();
    }

    // Pass 4: Seek to 1.0s (-ss 00:00:01)
    if result.is_none() {
        let _ = std::process::Command::new(&ff_exe)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-y")
            .args(av1_hwaccel_args)
            .arg("-ss")
            .arg("00:00:01")
            .arg("-i")
            .arg(&sample_path)
            .arg("-an")
            .arg("-vframes")
            .arg("1")
            .arg("-vf")
            .arg(scale_arg)
            .arg("-q:v")
            .arg(q_val)
            .arg(&frame_path)
            .output();

        result = check_frame_file();
    }

    // Pass 5: Seek to 2.0s (-ss 00:00:02)
    if result.is_none() {
        let _ = std::process::Command::new(&ff_exe)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-y")
            .args(av1_hwaccel_args)
            .arg("-ss")
            .arg("00:00:02")
            .arg("-i")
            .arg(&sample_path)
            .arg("-an")
            .arg("-vframes")
            .arg("1")
            .arg("-vf")
            .arg(scale_arg)
            .arg("-q:v")
            .arg(q_val)
            .arg(&frame_path)
            .output();

        result = check_frame_file();
    }

    // Pass 3: Output-level seek (-ss 00:00:00.100 after -i) fallback
    if result.is_none() {
        let _ = std::process::Command::new(&ff_exe)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-y")
            .args(av1_hwaccel_args)      // Phase 2: disable HW accel for AV1
            .arg("-i")
            .arg(&sample_path)
            .arg("-ss")
            .arg("00:00:00.100")
            .arg("-an")
            .arg("-vframes")
            .arg("1")
            .arg("-vf")
            .arg(scale_arg)
            .arg("-q:v")
            .arg(q_val)
            .arg(&frame_path)
            .output();

        result = check_frame_file();
    }

    // Pass 4: Low-strictness / ignore-err decode for partial AV1/HEVC streams
    if result.is_none() {
        let status4 = std::process::Command::new(&ff_exe)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-probesize")
            .arg("2M")
            .arg("-analyzeduration")
            .arg("2M")
            .arg("-err_detect")
            .arg("ignore_err")
            .arg("-y")
            .args(av1_hwaccel_args)      // Phase 2: disable HW accel for AV1
            .arg("-i")
            .arg(&sample_path)
            .arg("-an")
            .arg("-vframes")
            .arg("1")
            .arg("-vf")
            .arg(scale_arg)
            .arg("-q:v")
            .arg(q_val)
            .arg(&frame_path)
            .output();

        result = check_frame_file();
        if result.is_none() {
            if let Ok(out) = status4 {
                let err2 = String::from_utf8_lossy(&out.stderr).trim().to_string();
                tg_log::warn(
                    BACKEND,
                    "ffmpeg_frame_failed",
                    &format!("size={} ext={ext} av1={is_av1} err1='{err1}' err2='{err2}'", sample_bytes.len()),
                );
            }
        }
    }

    // Pass 5: Direct bitstream / mdat payload snapshot extraction.
    // For AV1: extract raw OBU bytes from mdat and try av1/libdav1d demuxers (do NOT run Annex-B conversion).
    // For H.264/HEVC: convert AVCC length-prefixes to Annex-B start codes, then try h264/hevc/m4v demuxers.
    if result.is_none() && sample_bytes.len() >= 128 {
        if let Some(mdat_pos) = sample_bytes.windows(4).position(|w| w == b"mdat") {
            let stream_start = mdat_pos + 4;
            if stream_start < sample_bytes.len() {
                let raw_slice = &sample_bytes[stream_start..];

                // Phase 4: AV1 OBU path — separate from H.264/HEVC to avoid Annex-B corruption.
                // AV1 OBUs use a completely different framing than NAL units; running
                // convert_avcc_to_annexb on them corrupts the OBU headers.
                if is_av1 {
                    let stream_path = temp_dir.join(format!("autogram_vid_stream_{rand_id}.obu"));
                    if std::fs::write(&stream_path, raw_slice).is_ok() {
                        for (fmt, codec_hint) in [
                            ("av1", "libdav1d"),
                            ("av1", "libaom-av1"),
                            ("av1", "av1"),
                        ] {
                            let mut cmd = std::process::Command::new(&ff_exe);
                            cmd.arg("-hide_banner")
                                .arg("-loglevel").arg("quiet")
                                .arg("-hwaccel").arg("none")
                                .arg("-f").arg(fmt)
                                .arg("-c:v").arg(codec_hint)
                                .arg("-err_detect").arg("ignore_err")
                                .arg("-i").arg(&stream_path)
                                .arg("-an")
                                .arg("-vframes").arg("1")
                                .arg("-vf").arg(scale_arg)
                                .arg("-q:v").arg(q_val)
                                .arg(&frame_path);
                            let _ = cmd.output();
                            result = check_frame_file();
                            if result.is_some() {
                                tg_log::warn(
                                    BACKEND,
                                    "ffmpeg_pass5_av1_success",
                                    &format!("Raw OBU extracted using -f {fmt} -c:v {codec_hint} from mdat offset {stream_start}"),
                                );
                                break;
                            }
                        }
                        let _ = std::fs::remove_file(&stream_path);
                    }
                }

                // Fallback: legacy H.264/HEVC Annex-B rescue (existing logic, not touched for AV1)
                if result.is_none() && !is_av1 {
                    let annexb_bytes = convert_avcc_to_annexb(raw_slice);
                    let stream_path = temp_dir.join(format!("autogram_vid_stream_{rand_id}.bin"));
                    if std::fs::write(&stream_path, &annexb_bytes).is_ok() {
                        for fmt in ["h264", "hevc", "m4v", "mpegts"] {
                            let _ = std::process::Command::new(&ff_exe)
                                .arg("-hide_banner")
                                .arg("-loglevel")
                                .arg("quiet")
                                .arg("-y")
                                .arg("-f")
                                .arg(fmt)
                                .arg("-err_detect")
                                .arg("ignore_err")
                                .arg("-i")
                                .arg(&stream_path)
                                .arg("-an")
                                .arg("-vframes")
                                .arg("1")
                                .arg("-vf")
                                .arg(scale_arg)
                                .arg("-q:v")
                                .arg(q_val)
                                .arg(&frame_path)
                                .output();

                            result = check_frame_file();
                            if result.is_some() {
                                tg_log::warn(
                                    BACKEND,
                                    "ffmpeg_pass5_success",
                                    &format!("Raw bitstream snapshot extracted using -f {fmt} from mdat offset {stream_start}"),
                                );
                                break;
                            }
                        }
                        let _ = std::fs::remove_file(&stream_path);
                    }
                }
            }
        }
    }

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
    let is_svg = bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml");
    let mime = if is_jpeg {
        "image/jpeg"
    } else if is_png {
        "image/png"
    } else if is_webp {
        "image/webp"
    } else if is_svg {
        "image/svg+xml"
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
    prune_thumb_cache(&t_dir);

    // Section
    let mut thumbs: HashMap<String, Option<String>> = HashMap::new();
    let mut uncached_ids: Vec<i32> = Vec::new();

    for &mid in &ids {
        let key = mid.to_string();
        let cache_key = format!("{chat_safe}_{mid}_{q_key}");
        let mut found_url: Option<String> = None;
        let mut is_negative_hit = false;
        {
            let mem = thumb_mem_cache().lock();
            if let Some(url) = mem.get(&cache_key) {
                if url == "NOT_FOUND" {
                    is_negative_hit = true;
                } else if !url.is_empty() {
                    found_url = Some(url.clone());
                }
            }
        }
        if !is_negative_hit && found_url.is_none() {
            let nothumb_file = t_dir.join(format!("{cache_key}.nothumb"));
            if nothumb_file.is_file() {
                let _ = std::fs::remove_file(&nothumb_file);
            }
        }
        if is_negative_hit {
            thumbs.insert(key, None);
            continue;
        }

        if found_url.is_none() {
            // Prefer exact quality file; fall back to hemat (stripped) so grid
            // reopens like Telegram without re-hitting the network.
            // Exact quality file only — never serve hemat blur as seimbang/jelas.
            let cache_file = t_dir.join(format!("{cache_key}.jpg"));
            if cache_file.is_file() {
                if let Ok(bytes) = std::fs::read(&cache_file) {
                    // 64 bytes is the real minimum for any JPEG/PNG/WebP thumbnail.
                    // Do NOT apply a data-URL character-length filter here — small
                    // but valid thumbnails (e.g. stripped 310-byte JPEGs) would be
                    // wrongly discarded and re-downloaded on every grid open.
                    let min_disk = 64;
                    if bytes.len() >= min_disk {
                        if let Some(url) = to_data_url(&bytes) {
                            thumb_mem_cache().lock().insert(cache_key.clone(), url.clone());
                            found_url = Some(url);
                        }
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
            let uncached_ids = uncached_ids.clone();
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
                let peer = match resolve_peer(client, &chat).await {
                    Ok(p) => p,
                    Err(e) => {
                        tg_log::warn(
                            BACKEND,
                            "thumbs_batch_peer_error",
                            format!("chat={chat} error={e}"),
                        );
                        return Err(e);
                    }
                };
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
                for msg_opt in msgs {
                    if let Some(msg) = msg_opt {
                        msg_by_id.insert(msg.id(), msg);
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
                            let sizes = media_thumbs(Some(&client), &media);
                            for s in &sizes {
                                if let Some(data) = s.to_data() {
                                    let bytes = unstrip_jpeg(&data).unwrap_or(data);
                                    if bytes.is_empty() {
                                        continue;
                                    }
                                    if let Some(url) = to_data_url(&bytes) {
                                        // Always keep stripped under hemat only using atomic .part rename
                                        let cache_file = t_dir
                                            .join(format!("{chat_safe}_{mid}_hemat.jpg"));
                                        let rand_id = now_ms();
                                        let part_file = t_dir.join(format!("{chat_safe}_{mid}_hemat.{rand_id}.part"));
                                        if std::fs::write(&part_file, &bytes).is_ok() {
                                            let _ = std::fs::rename(&part_file, &cache_file);
                                        }
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
                let fast_sem = std::sync::Arc::new(tokio::sync::Semaphore::new(12));
                let video_sem = std::sync::Arc::new(tokio::sync::Semaphore::new(2));
                let is_flooded = session_rate::flood_remaining_secs(&session_name).unwrap_or(0) > 0;

                // Sort need_download so fast-path items (photos, image docs, static thumbs) spawn BEFORE heavy video extraction tasks
                let mut sorted_download = need_download.clone();
                sorted_download.sort_by_key(|mid| {
                    if let Some(msg) = msg_by_id.get(mid) {
                        if let Some(media) = msg.media() {
                            match media {
                                Media::Document(ref d) => {
                                    let mime = d.mime_type().unwrap_or("").to_lowercase();
                                    let name = d.name().unwrap_or("").to_lowercase();
                                    let has_video_attr = d.raw.video;
                                    let sizes = media_thumbs(Some(&client), &media);
                                    let is_v = has_video_attr
                                        || mime.starts_with("video/")
                                        || name.ends_with(".mp4")
                                        || name.ends_with(".mov")
                                        || name.ends_with(".mkv")
                                        || name.ends_with(".webm")
                                        || name.ends_with(".avi")
                                        || name.ends_with(".ts");
                                    let has_static = sizes.iter().any(|s| matches!(s, PhotoSize::Size(_) | PhotoSize::Progressive(_)));
                                    is_v && !has_static // Video without static thumb is heavy (key = 1), fast items are key = 0
                                }
                                _ => false,
                            }
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                });

                for mid in sorted_download.iter().copied() {
                    let key = mid.to_string();
                    if is_flooded {
                        tg_log::warn(
                            BACKEND,
                            "thumbs_batch_flooded",
                            format!("chat={chat} session={session_name} skipping mid={mid}"),
                        );
                        thumbs.insert(key, None);
                        continue;
                    }
                    // Disk hit for THIS quality only (never fall back to hemat blur here).
                    // Accept any non-empty cached URL — do NOT apply a character-length
                    // threshold (previously url.len() > 600) which rejected valid small
                    // thumbnails (e.g. 310-byte JPEG → ~437-char data URL).
                    let q_cache = format!("{chat_safe}_{mid}_{q_key}");
                    {
                        let mut mem = thumb_mem_cache().lock();
                        if let Some(url) = mem.get(&q_cache) {
                            if url != "NOT_FOUND" && !url.is_empty() {
                                thumbs.insert(key, Some(url.clone()));
                                continue;
                            } else if url == "NOT_FOUND" {
                                mem.remove(&q_cache);
                            }
                        }
                    }
                    let nothumb_file_check = t_dir.join(format!("{q_cache}.nothumb"));
                    if nothumb_file_check.is_file() {
                        let _ = std::fs::remove_file(&nothumb_file_check);
                    }
                    let q_file = t_dir.join(format!("{q_cache}.jpg"));
                    if q_file.is_file() {
                        if let Ok(bytes) = std::fs::read(&q_file) {
                            let min_ok = 64;
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
                        tg_log::warn(
                            BACKEND,
                            "thumb_msg_not_found",
                            format!("chat={chat} mid={mid} reason=message_id_not_found_in_telegram_response"),
                        );
                        thumbs.insert(key, None);
                        continue;
                    };
                    let Some(media) = msg.media() else {
                        tg_log::warn(
                            BACKEND,
                            "thumb_no_media",
                            format!("chat={chat} mid={mid} reason=message_has_no_media"),
                        );
                        thumbs.insert(key, None);
                        continue;
                    };
                    let media_cloned = media.clone();
                    let client_ref = client.clone();
                    let mid_val = mid;
                    let q_sub = quality_owned.clone();
                    let c_sub = chat_safe.clone();
                    let t_sub = t_dir.clone();

                    let is_heavy_video = match &media {
                        Media::Document(d) => {
                            let mime = d.mime_type().unwrap_or("").to_lowercase();
                            let name = d.name().unwrap_or("").to_lowercase();
                            let has_video_attr = d.raw.video;
                            let sizes = media_thumbs(Some(&client), &media);
                            let is_v = has_video_attr
                                || mime.starts_with("video/")
                                || name.ends_with(".mp4")
                                || name.ends_with(".mov")
                                || name.ends_with(".mkv")
                                || name.ends_with(".webm")
                                || name.ends_with(".avi")
                                || name.ends_with(".ts");
                            let has_static = sizes.iter().any(|s| matches!(s, PhotoSize::Size(_) | PhotoSize::Progressive(_)));
                            is_v && !has_static
                        }
                        _ => false,
                    };

                    let sem_sub = if is_heavy_video {
                        video_sem.clone()
                    } else {
                        fast_sem.clone()
                    };

                    set.spawn(async move {
                        let _permit = sem_sub.acquire_owned().await.ok();
                        let cache_file = t_sub.join(format!("{c_sub}_{mid_val}_{q_sub}.jpg"));
                        let rand_id = now_ms();
                        let part_file = t_sub.join(format!("{c_sub}_{mid_val}_{q_sub}.{rand_id}.part"));
                        match download_media_thumb(&client_ref, &media_cloned, &q_sub).await {
                            Ok(bytes) => {
                                // Accept any valid thumbnail payload (>= 64 bytes)
                                let min_ok = 64;
                                if bytes.len() < min_ok {
                                    let nothumb_file = t_sub.join(format!("{c_sub}_{mid_val}_{q_sub}.nothumb"));
                                    let _ = std::fs::write(&nothumb_file, b"none");
                                    thumb_mem_cache().lock().insert(
                                        format!("{c_sub}_{mid_val}_{q_sub}"),
                                        "NOT_FOUND".to_string(),
                                    );
                                    return (mid_val.to_string(), None);
                                }
                                if std::fs::write(&part_file, &bytes).is_ok() {
                                    let _ = std::fs::rename(&part_file, &cache_file);
                                }
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
                                let nothumb_file = t_sub.join(format!("{c_sub}_{mid_val}_{q_sub}.nothumb"));
                                let _ = std::fs::remove_file(&nothumb_file);

                                let is_media_doc = matches!(&media_cloned, Media::Photo(_)) || matches!(&media_cloned, Media::Document(d) if {
                                    let mime = d.mime_type().unwrap_or("").to_lowercase();
                                    let name = d.name().unwrap_or("").to_lowercase();
                                    mime.starts_with("video/") || mime.starts_with("image/")
                                        || name.ends_with(".mp4") || name.ends_with(".mov") || name.ends_with(".mkv") || name.ends_with(".webm") || name.ends_with(".avi")
                                });

                                if !is_media_doc {
                                    let _ = std::fs::write(&nothumb_file, b"none");
                                    thumb_mem_cache().lock().insert(
                                        format!("{c_sub}_{mid_val}_{q_sub}"),
                                        "NOT_FOUND".to_string(),
                                    );
                                }
                                let err_str = e.to_string();
                                if !err_str.contains("no valid thumb found") {
                                    tg_log::warn(
                                        BACKEND,
                                        "thumb_download_failed",
                                        format!("chat={c_sub} mid={mid_val} quality={q_sub} error={err_str}"),
                                    );
                                } else {
                                    tg_log::info(
                                        BACKEND,
                                        "thumb_not_present",
                                        format!("chat={c_sub} mid={mid_val} quality={q_sub} cached negative result"),
                                    );
                                }
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
    let port = if port > 0 {
        port
    } else {
        let fallback_reg = std::env::temp_dir().join("autogram_stream_registry");
        stream_server::ensure_started(fallback_reg)
    };
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
    format!("http://127.0.0.1:{port}/stream/{stream_id}/{name}")
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
        // Exclude both 'missing' and 'cancelled' streams so cancelled sessions trigger a fresh active stream
        return st.status != "missing" && st.status != "cancelled" && st.error.is_none();
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

    // Fail-fast during active FloodWait window to avoid thread blocking or MTProto hammering.
    if let Some(secs) = session_rate::flood_remaining_secs(&session_name) {
        if secs > 0 {
            let e = TgError::with_flood(secs, "FLOOD_WAIT");
            session_rate::note_error(&session_name, &e);
            return Err(e);
        }
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
        // Smart wait if flood duration is short (<= 35s), otherwise fail fast
        session_rate::wait_if_flooded_capped(&session_name, Duration::from_secs(35)).await?;

        let live = obtain_live_client(sessions_dir, identity, true, false).await?;
        let client = &live.client;
        if !client.is_authorized().await.map_err(|e| map_invocation(&e))? {
            return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
        }
        let peer = resolve_peer(client, chat).await?;
        let mid = message_id as i32;
        let msgs = match client.get_messages_by_id(peer, &[mid]).await {
            Ok(m) => m,
            Err(e) => {
                let err = map_invocation(&e);
                session_rate::note_error(&session_name, &err);
                if err.code() == TgErrorCode::FloodWait {
                    if let Some(secs) = err.flood_wait_secs() {
                        if secs <= 35 {
                            tg_log::warn(
                                "grammers",
                                "preview_stream",
                                format!("FloodWait ({secs}s) hit during get_messages, auto-retrying..."),
                            );
                            tokio::time::sleep(Duration::from_secs(u64::from(secs))).await;
                            client
                                .get_messages_by_id(peer, &[mid])
                                .await
                                .map_err(|retry_err| {
                                    let mapped = map_invocation(&retry_err);
                                    session_rate::note_error(&session_name, &mapped);
                                    mapped
                                })?
                        } else {
                            return Err(err);
                        }
                    } else {
                        return Err(err);
                    }
                } else {
                    return Err(err);
                }
            }
        };
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
        let name_lower = name.to_lowercase();
        let is_video_ext = name_lower.ends_with(".mp4")
            || name_lower.ends_with(".mov")
            || name_lower.ends_with(".mkv")
            || name_lower.ends_with(".webm")
            || name_lower.ends_with(".avi")
            || name_lower.ends_with(".m4v")
            || name_lower.ends_with(".3gp")
            || name_lower.ends_with(".ts")
            || name_lower.ends_with(".flv")
            || name_lower.ends_with(".wmv")
            || name_lower.ends_with(".m2ts")
            || name_lower.ends_with(".vob")
            || name_lower.ends_with(".ogv")
            || name_lower.ends_with(".3g2")
            || name_lower.ends_with(".f4v");
        let is_image = (mime.starts_with("image/") || name_lower.ends_with(".jpg") || name_lower.ends_with(".png") || name_lower.ends_with(".webp") || name_lower.ends_with(".jpeg")) && !mime.contains("gif");
        let is_video = mime.starts_with("video/") || is_video_ext;
        let is_audio = mime.starts_with("audio/") || name_lower.ends_with(".mp3") || name_lower.ends_with(".flac") || name_lower.ends_with(".ogg") || name_lower.ends_with(".m4a") || name_lower.ends_with(".wav") || name_lower.ends_with(".aac") || name_lower.ends_with(".opus");
        let is_zip = mime.contains("zip") || name_lower.ends_with(".zip");

        // ZIP files: 100% MTProto Sparse Reader — zero full-file download for ZIPs of ANY size (1 MB to 5 GB)
        if is_zip {
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
                preview_kind: "zip".into(),
                streaming: false,
                backend: BACKEND.into(),
                message: "Sparse ZIP Range Reader".into(),
            });
        }

        let max_doc_size = 64 * 1024 * 1024;

        // Non-media (apk/binaries): never progressive-stream as if video.
        // Large files > max_doc_size → instant metadata UI (download only).
        if !is_image && !is_video && !is_audio && size > max_doc_size {
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

        // Documents: download once, parse text/pdf/zip locally — keep shared pool alive.
        if !is_image && !is_video && !is_audio && size <= max_doc_size {
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
            moov_ready_cached: false, // computed by upsert_entry once bytes arrive
            moov_tail_fetching: false,
        };
        stream_server::upsert_entry(entry);
        let cancel = register_cancel(&stream_id);
        let stream_url = stream_public_url(&stream_id, &name);

        let mut boot_ranges: Vec<(u64, u64)> = Vec::new();
        let mut has_moov_head = false;
        {
            let _boot_slot = session_rate::acquire_media_slot(&session_name).await?;
            const BOOT_CHUNK: u64 = 512 * 1024;
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
                        if err.code() == TgErrorCode::FloodWait {
                            if let Some(secs) = err.flood_wait_secs() {
                                if secs <= 35 {
                                    tg_log::warn(
                                        "grammers",
                                        "preview_stream",
                                        format!("FloodWait ({secs}s) hit during boot chunk download, auto-retrying..."),
                                    );
                                    tokio::time::sleep(Duration::from_secs(u64::from(secs))).await;
                                    continue;
                                }
                            }
                        }
                        session_rate::untrack_stream(&session_name, &stream_id);
                        return Err(err);
                    }
                }
            }
            let _ = file.flush();

            // Check if moov atom is already in the head 512KB
            has_moov_head = boot_ranges.iter().any(|&(s, e)| {
                if let Ok(mut f) = std::fs::File::open(&dest) {
                    if f.seek(SeekFrom::Start(s)).is_ok() {
                        let mut buf = vec![0u8; (e - s).min(1024 * 1024) as usize];
                        if let Ok(n) = f.read(&mut buf) {
                            return buf[..n].windows(4).any(|w| w == b"moov");
                        }
                    }
                }
                false
            });

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
                    moov_ready_cached: has_moov_head || !is_video,
                    moov_tail_fetching: false,
                });
            }
            // _boot_slot dropped here — UI can open another video without waiting for full fill.
        }

        // Establish a pool of 12 parallel Client connections (12 distinct TCP sockets to Telegram DC)
        let download_clients = obtain_download_clients(sessions_dir, identity, 12)
            .await
            .unwrap_or_else(|_| vec![live.client.clone()]);

        let dest_path = dest.clone();
        let sid = stream_id.clone();
        let mime_bg = mime.clone();
        let fill_media = media;
        let session_bg = session_name.clone();
        let boot_end = first_missing_offset(&boot_ranges, size).unwrap_or(0);
        let need_async_moov_tail = is_video && size > 1024 * 1024 && !has_moov_head;

        // Spawn MOOV tail fetch as a fully INDEPENDENT task so fill loop starts immediately.
        // This is the key fix: tail and fill run in true parallel — no blocking.
        if need_async_moov_tail {
            let tail_media = fill_media.clone();
            // Phase 6: Increased tail depth floor for AV1 safety.
            // AV1 moov atoms can be larger and further from the end; 2 MB was insufficient.
            // Medium (>100MB) and large (>500MB) files already have 4MB and 6MB — only floor changes.
            let tail_depth: u64 = if size > 500 * 1024 * 1024 {
                6 * 1024 * 1024
            } else if size > 100 * 1024 * 1024 {
                4 * 1024 * 1024
            } else {
                3 * 1024 * 1024  // was 2 MB — increased to 3 MB to improve AV1 moov coverage
            };
            let tail_start_offset = (size.saturating_sub(tail_depth) / 4096) * 4096;
            let num_chunks = ((size - tail_start_offset) + 524287) / (512 * 1024);
            let tail_clients = download_clients.clone();
            let tail_dest = dest.clone();
            let tail_sid = stream_id.clone();

            // Mark entry as tail-fetching NOW so moov_ready=true on next status poll
            // This allows the UI to start playback as soon as prefix bytes are ready.
            if let Some(mut e) = stream_server::get_entry(&stream_id) {
                e.moov_tail_fetching = true;
                stream_server::upsert_entry(e);
            }

            tokio::spawn(async move {
                let (tx, mut rx) = tokio::sync::mpsc::channel(16);
                for i in 0..num_chunks {
                    let chunk_off = tail_start_offset + i * (512 * 1024);
                    if chunk_off >= size { break; }
                    let client = tail_clients[(i as usize) % tail_clients.len()].clone();
                    let media_item = tail_media.clone();
                        let skip = (chunk_off / (512 * 1024)) as i32;
                        let tx_clone = tx.clone();
                        tokio::spawn(async move {
                            let mut iter = client
                                .iter_download(&media_item)
                                .chunk_size(512 * 1024)
                                .skip_chunks(skip);
                            let res = iter.next().await;
                            let _ = tx_clone.send((chunk_off, res)).await;
                        });
                    }
                    drop(tx);
                    let mut tail_ranges: Vec<(u64, u64)> = Vec::new();
                    // Phase 6 (moov verification): accumulate tail bytes to scan for moov atom
                    // before marking moov_ready_cached — prevents false-positive stream-ready signals.
                    let mut tail_bytes_buf: Vec<u8> = Vec::new();
                    if let Ok(mut f_disk) = std::fs::OpenOptions::new().write(true).open(&tail_dest) {
                        while let Some((chunk_off, res)) = rx.recv().await {
                            if let Ok(Some(bytes)) = res {
                                if !bytes.is_empty() {
                                    if f_disk.seek(SeekFrom::Start(chunk_off)).is_ok() && f_disk.write_all(&bytes).is_ok() {
                                        tail_ranges.push((chunk_off, chunk_off + bytes.len() as u64));
                                        // Keep tail bytes in memory for moov scan (capped at 8 MB)
                                        if tail_bytes_buf.len() < 8 * 1024 * 1024 {
                                            tail_bytes_buf.extend_from_slice(&bytes);
                                        }
                                    }
                                }
                            }
                        }
                        let _ = f_disk.flush();
                    }
                    // Phase 6 (moov verification): scan actual tail bytes to confirm moov is present.
                    // If tail_depth was insufficient, moov_ready_cached stays false so a larger
                    // rescue fetch can be triggered instead of serving a broken stream.
                    let has_moov = tail_bytes_buf.windows(4).any(|w| w == b"moov");
                    // After tail completes: merge ranges + set moov_ready_cached based on actual scan.
                    if let Some(mut e) = stream_server::get_entry(&tail_sid) {
                        for r in tail_ranges {
                            e.ranges.push(r);
                        }
                        e.moov_ready_cached = has_moov;
                        e.moov_tail_fetching = false;
                        stream_server::upsert_entry(e);
                    }
                    if has_moov {
                        tg_log::info(
                            BACKEND,
                            "moov_tail_done_independent",
                            format!("sid={tail_sid} size={size} moov=found"),
                        );
                    } else {
                        tg_log::warn(
                            BACKEND,
                            "moov_tail_no_moov",
                            format!("sid={tail_sid} size={size} tail_buf_len={} — moov not in tail; stream may need deeper fetch", tail_bytes_buf.len()),
                        );
                    }
                });
        }

        let fill_clients = download_clients;
        tokio::spawn(async move {
            // Optional fill permit — if busy, still try (cancelled old streams free bandwidth).
            let _fill_slot = session_rate::try_acquire_media_slot(&session_bg);
            let flag = cancel;
            let mut offset: u64 = boot_end;
            let mut ranges: Vec<(u64, u64)> = boot_ranges;
            let mut active_seek_target: Option<u64> = None;

            let result = async {
                // grammers GetFile: MIN=4KiB MAX=512KiB (panic outside range)
                const CHUNK_SIZE: u64 = 512 * 1024;
                const PARALLEL_WORKERS: usize = 12; // 12 parallel MTProto TCP sockets
                let skip = if boot_end > 0 {
                    ((boot_end / CHUNK_SIZE).min(i32::MAX as u64)) as i32
                } else {
                    0
                };
                let mut iter = fill_clients[0]
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

                while offset < size {
                    if flag.load(Ordering::SeqCst) {
                        return Err("cancelled".into());
                    }

                    // Check for new incoming seek/range requests from HTTP stream server
                    if let Some(requested) = take_seek_request(&sid) {
                        let requested = requested.min(size.saturating_sub(1));
                        let aligned = (requested / CHUNK_SIZE) * CHUNK_SIZE;
                        let already_available = ranges
                            .iter()
                            .any(|(start, end)| *start <= requested && requested < *end);
                        if !already_available {
                            active_seek_target = Some(aligned);
                            tg_log::info(
                                BACKEND,
                                "progressive_seek_target_locked",
                                format!("sid={sid} target={aligned}"),
                            );
                        }
                    }

                    // If we have an active seek target (e.g. moov tail or user scrub), check if fulfilled
                    if let Some(target) = active_seek_target {
                        let fulfilled = ranges
                            .iter()
                            .any(|(start, end)| *start <= target && target < *end);
                        if fulfilled {
                            active_seek_target = None;
                        } else if offset != target {
                            offset = target;
                            let skip = (offset / CHUNK_SIZE).min(i32::MAX as u64) as i32;
                            iter = fill_clients[0]
                                .iter_download(&fill_media)
                                .chunk_size(CHUNK_SIZE as i32)
                                .skip_chunks(skip);
                        }
                    }

                    // Maximum Speed Multi-Socket Target DC Pipeline: 12 parallel MTProto TCP sockets
                    // Connects directly to the media's target DC (DC 1, 2, 3, 4, 5, or CDN) across 12 distinct TCP connections.
                    if active_seek_target.is_none() {
                        let mut pending_offsets = Vec::new();
                        let mut scan_off = offset;

                        while pending_offsets.len() < PARALLEL_WORKERS && scan_off < size {
                            while let Some(&(_, end)) = ranges.iter().find(|(s, e)| *s <= scan_off && scan_off < *e) {
                                if end > scan_off {
                                    scan_off = end;
                                } else {
                                    break;
                                }
                            }
                            if scan_off >= size { break; }
                            pending_offsets.push(scan_off);
                            scan_off += CHUNK_SIZE;
                        }

                        if !pending_offsets.is_empty() {
                            let (tx, mut rx) = tokio::sync::mpsc::channel(pending_offsets.len());
                            for (idx, chunk_off) in pending_offsets.into_iter().enumerate() {
                                let client = fill_clients[idx % fill_clients.len()].clone();
                                let media_item = fill_media.clone();
                                let skip = (chunk_off / CHUNK_SIZE) as i32;
                                let tx_clone = tx.clone();
                                tokio::spawn(async move {
                                    let mut iter = client
                                        .iter_download(&media_item)
                                        .chunk_size(CHUNK_SIZE as i32)
                                        .skip_chunks(skip);
                                    let res = iter.next().await;
                                    let _ = tx_clone.send((chunk_off, res)).await;
                                });
                            }
                            drop(tx);

                            let mut written_any = false;
                            while let Some((chunk_off, res)) = rx.recv().await {
                                match res {
                                    Ok(Some(bytes)) if !bytes.is_empty() => {
                                        if file.seek(SeekFrom::Start(chunk_off)).is_ok() && file.write_all(&bytes).is_ok() {
                                            ranges.push((chunk_off, chunk_off + bytes.len() as u64));
                                            written_any = true;
                                        }
                                    }
                                    Err(e) => {
                                        let mapped = map_invocation(&e);
                                        session_rate::note_error(&session_bg, &mapped);
                                        if mapped.code() == TgErrorCode::FloodWait {
                                            if let Some(secs) = mapped.flood_wait_secs() {
                                                tg_log::warn(
                                                    BACKEND,
                                                    "progressive_flood",
                                                    format!("sid={sid} FloodWait ({secs}s), auto-waiting..."),
                                                );
                                                tokio::time::sleep(Duration::from_secs(u64::from(secs))).await;
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            if written_any {
                                let _ = file.flush();
                                ranges = stream_server::merge_ranges(&ranges);
                                if let Some(next_gap) = first_missing_offset(&ranges, size) {
                                    offset = next_gap;
                                } else {
                                    offset = size;
                                }
                                stream_server::upsert_entry(StreamEntry {
                                    stream_id: sid.clone(),
                                    path: dest_path.display().to_string(),
                                    total_size: size,
                                    mime: mime_bg.clone(),
                                    label: name.clone(),
                                    done: offset >= size,
                                    ranges: ranges.clone(),
                                    cancelled: false,
                                    error: None,
                                    paused: false,
                                    updated_at_ms: now_ms(),
                                    moov_ready_cached: false,
                                    moov_tail_fetching: false,
                                });
                                continue;
                            }
                        }
                    }

                    // Skip contiguous ranges starting at current offset
                    while let Some(&(_, end)) = ranges.iter().find(|(s, e)| *s <= offset && offset < *e) {
                        if end > offset {
                            offset = end;
                        } else {
                            break;
                        }
                    }

                    // Only advance to first_missing_offset if no active seek target is pending
                    if active_seek_target.is_none() {
                        match first_missing_offset(&ranges, size) {
                            None => {
                                // Entire file 100% downloaded
                                break;
                            }
                            Some(next_gap) => {
                                if next_gap != offset {
                                    offset = next_gap;
                                    let skip = (offset / CHUNK_SIZE).min(i32::MAX as u64) as i32;
                                    iter = live
                                        .client
                                        .iter_download(&fill_media)
                                        .chunk_size(CHUNK_SIZE as i32)
                                        .skip_chunks(skip);
                                }
                            }
                        }
                    }

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

                    // Resilient next-chunk fetch with retry loop
                    let mut retries = 0;
                    let chunk_opt = loop {
                        match iter.next().await {
                            Ok(c) => break Ok(c),
                            Err(e) => {
                                let err_msg = format!("{e}");
                                let mapped = map_invocation(&e);
                                session_rate::note_error(&session_bg, &mapped);

                                if mapped.code() == TgErrorCode::FloodWait {
                                    if let Some(secs) = mapped.flood_wait_secs() {
                                        tg_log::warn(
                                            BACKEND,
                                            "progressive_flood",
                                            format!("sid={sid} FloodWait ({secs}s), auto-waiting..."),
                                        );
                                        tokio::time::sleep(Duration::from_secs(u64::from(secs))).await;
                                    }
                                } else {
                                    tokio::time::sleep(Duration::from_millis(400 * (1 << retries))).await;
                                }

                                retries += 1;
                                if retries > 5 {
                                    break Err(err_msg);
                                }

                                let skip = (offset / CHUNK_SIZE).min(i32::MAX as u64) as i32;
                                iter = live
                                    .client
                                    .iter_download(&fill_media)
                                    .chunk_size(CHUNK_SIZE as i32)
                                    .skip_chunks(skip);
                            }
                        }
                    };

                    let chunk = match chunk_opt {
                        Ok(Some(c)) => c,
                        Ok(None) => break,
                        Err(e) => return Err(format!("GetFile: {e}")),
                    };
                    file.seek(SeekFrom::Start(offset))
                        .map_err(|e| format!("seek: {e}"))?;
                    file.write_all(&chunk)
                        .map_err(|e| format!("write: {e}"))?;
                    let end = offset + chunk.len() as u64;
                    ranges.push((offset, end));
                    offset = end;



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
                        moov_ready_cached: false, // upsert_entry will compute from actual bytes
                        moov_tail_fetching: false,
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
                        moov_ready_cached: true, // done = always ready
                        moov_tail_fetching: false,
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
                        moov_ready_cached: false,
                        moov_tail_fetching: false,
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
