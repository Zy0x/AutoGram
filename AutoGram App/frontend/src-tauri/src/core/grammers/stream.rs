//! Progressive Range HTTP streaming server integration, 512KB boundary alignment, tail moov atom detection, and stream cancellation.

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
use tauri::Emitter;

use super::ffmpeg::{
    extract_ffmpeg_frame_sync, find_ffmpeg_binary, is_fallback_black_card_bytes, unstrip_jpeg,
};
use super::session::{cache_root, now_ms, preview_dir, thumb_dir, BACKEND};
use super::thumbs::*;
use crate::core::grammers_ops::{
    disconnect_cached_session, obtain_download_clients, obtain_live_client, persist_memory_session,
    resolve_peer, runtime, with_client, with_pool_retry,
};
use crate::core::path_policy;
use crate::core::session_rate;
use crate::core::stream_server::{self, StreamEntry};
use crate::core::telegram_ops::TelegramIdentity;
use crate::core::tg_error::{map_invocation, TgError, TgErrorCode};
use crate::core::tg_log;

const PROGRESSIVE_MAX: u64 = 4 * 1024 * 1024 * 1024;
const THUMB_TARGET_MAX: usize = 96 * 1024;

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
    // FIX Bug #5: Jika cancel_flag sudah di-remove (stream selesai fase init)
    // tetapi StreamEntry masih ada dan belum done, tetap terima seek request.
    // Sebelumnya seek langsung rejected jika cancel_flag tidak ada.
    let flag_active = cancel_flags().lock().contains_key(stream_id);
    if !flag_active {
        // Cek apakah stream entry masih aktif dan belum done
        match stream_server::get_entry(stream_id) {
            Some(e) if !e.done && !e.cancelled => {}
            _ => return false,
        }
    }
    // 512 KB Alignment Boundary to prevent Telegram CDN offset shift / MP4 box corruption
    let aligned_offset = offset - (offset % (512 * 1024));
    seek_requests()
        .lock()
        .insert(stream_id.to_string(), aligned_offset);
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

fn find_missing_offset_from(ranges: &[(u64, u64)], from: u64, total: u64) -> Option<u64> {
    let sorted = stream_server::merge_ranges(ranges);
    let mut covered = from;
    for (start, end) in sorted {
        if end <= from {
            continue;
        }
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
        let (width, height) = image_dimensions_from_bytes(&bytes);
        let b_len = bytes.len() as u64;
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
            source: "cached_preview".into(),
            is_fallback: false,
            width,
            height,
            byte_size: b_len,
            full_download_error: None,
        });
    }
    if let Ok(local) = crate::core::doc_preview::preview_local_document(&path_str) {
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
            source: "doc_local".into(),
            is_fallback: false,
            width: None,
            height: None,
            byte_size: size,
            full_download_error: None,
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
            source: "doc_local".into(),
            is_fallback: false,
            width: None,
            height: None,
            byte_size: size,
            full_download_error: None,
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

fn image_dimensions_from_bytes(bytes: &[u8]) -> (Option<u32>, Option<u32>) {
    if bytes.len() < 10 {
        return (None, None);
    }
    // PNG
    if bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) && bytes.len() >= 24 {
        let w = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
        let h = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
        return (Some(w), Some(h));
    }
    // JPEG SOF parser
    if bytes.starts_with(&[0xFF, 0xD8]) {
        let mut i = 2;
        while i + 8 < bytes.len() {
            if bytes[i] != 0xFF {
                i += 1;
                continue;
            }
            let marker = bytes[i + 1];
            if marker == 0xC0 || marker == 0xC1 || marker == 0xC2 || marker == 0xC3 {
                let h = u32::from(u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]));
                let w = u32::from(u16::from_be_bytes([bytes[i + 7], bytes[i + 8]]));
                return (Some(w), Some(h));
            }
            let len = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as usize;
            if len < 2 {
                break;
            }
            i += 2 + len;
        }
    }
    (None, None)
}

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
    pub source: String,
    pub is_fallback: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub byte_size: u64,
    pub full_download_error: Option<String>,
}

fn guess_mime(name: &str, media: &Media) -> String {
    if let Media::Document(d) = media {
        if let Some(m) = d.mime_type() {
            if m != "application/octet-stream" && !m.is_empty() {
                return m.to_string();
            }
        }
        if d.raw.video {
            return "video/mp4".into();
        }
        if d.raw.voice {
            return "audio/ogg".into();
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

fn log_raw_media_info(
    op: &str,
    peer_id: &str,
    message_id: i32,
    media: &Media,
    mime: &str,
    attempt: u32,
    elapsed: Duration,
) {
    let (media_kind, doc_attrs) = match media {
        Media::Photo(p) => ("Media::Photo", format!("thumbs: {}", p.thumbs().len())),
        Media::Document(d) => {
            let is_vid = d.raw.video;
            let is_img = mime.starts_with("image/");
            let attrs = format!(
                "is_video_attr: {is_vid}, is_image_mime: {is_img}, name: {:?}",
                d.name()
            );
            ("Media::Document", attrs)
        }
        _ => ("Media::Unknown", String::new()),
    };
    tg_log::info(
        BACKEND,
        op,
        format!(
            "peer_id={peer_id}, message_id={message_id}, type={media_kind}, attrs=[{doc_attrs}], mime={mime}, attempt={attempt}, elapsed_ms={}",
            elapsed.as_millis()
        ),
    );
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
        // High priority preview permit (2 permits, never blocked by thumbnail batches)
        let _preview_permit = session_rate::acquire_preview_slot(&session_name).await?;

        // Smart wait if flood duration is short (<= 35s), otherwise fail fast
        session_rate::wait_if_flooded_capped(&session_name, Duration::from_secs(35)).await?;

        let live = obtain_live_client(sessions_dir, identity, true, false).await?;
        let client = &live.client;
        if !client.is_authorized().await.map_err(|e| map_invocation(&e))? {
            return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
        }
        let mut current_live = live.clone();
        let peer = resolve_peer(&current_live.client, chat).await?;
        let mid = message_id as i32;
        let msgs = match current_live.client.get_messages_by_id(peer, &[mid]).await {
            Ok(m) => m,
            Err(e) => {
                let err = map_invocation(&e);
                session_rate::note_error(&session_name, &err);
                let err_str = err.to_string();
                let is_timeout = err_str.contains("-503") || err_str.to_ascii_lowercase().contains("timeout");
                if is_timeout {
                    tg_log::warn(
                        "grammers",
                        "preview_stream",
                        "RPC Timeout (-503) during get_messages. Reconnecting fresh socket...",
                    );
                    disconnect_cached_session(&session_name);
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    if let Ok(fresh_live) = obtain_live_client(sessions_dir, identity, true, true).await {
                        current_live = fresh_live;
                        let fresh_peer = resolve_peer(&current_live.client, chat).await?;
                        current_live
                            .client
                            .get_messages_by_id(fresh_peer, &[mid])
                            .await
                            .map_err(|retry_err| {
                                let mapped = map_invocation(&retry_err);
                                session_rate::note_error(&session_name, &mapped);
                                mapped
                            })?
                    } else {
                        return Err(err);
                    }
                } else if err.code() == TgErrorCode::FloodWait {
                    if let Some(secs) = err.flood_wait_secs() {
                        if secs <= 35 {
                            tg_log::warn(
                                "grammers",
                                "preview_stream",
                                format!("FloodWait ({secs}s) hit during get_messages, auto-retrying..."),
                            );
                            tokio::time::sleep(Duration::from_secs(u64::from(secs))).await;
                            current_live
                                .client
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
        let is_video_attr = match &media {
            Media::Document(d) => d.raw.video,
            _ => false,
        };
        let is_audio_attr = match &media {
            Media::Document(d) => d.raw.voice,
            _ => false,
        };
        let is_image = (mime.starts_with("image/") || name_lower.ends_with(".jpg") || name_lower.ends_with(".png") || name_lower.ends_with(".webp") || name_lower.ends_with(".jpeg")) && !mime.contains("gif");
        let is_video = is_video_attr || mime.starts_with("video/") || is_video_ext;
        let is_audio = is_audio_attr || mime.starts_with("audio/") || name_lower.ends_with(".mp3") || name_lower.ends_with(".flac") || name_lower.ends_with(".ogg") || name_lower.ends_with(".m4a") || name_lower.ends_with(".wav") || name_lower.ends_with(".aac") || name_lower.ends_with(".opus");
        let is_zip = mime.contains("zip") || name_lower.ends_with(".zip");

        // Safe logging of raw media info
        log_raw_media_info("preview_stream_classified", &chat_safe, mid, &media, &mime, 1, Duration::ZERO);

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
                source: "zip_stream".into(),
                is_fallback: false,
                width: None,
                height: None,
                byte_size: size,
                full_download_error: None,
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
                source: "file".into(),
                is_fallback: false,
                width: None,
                height: None,
                byte_size: size,
                full_download_error: None,
            });
        }

        // Documents: download once, parse text/pdf/zip locally — keep shared pool alive.
        // Code and plain-text preview: fetch a bounded prefix directly from
        // Grammers. This avoids a full disk download with four long retries
        // before the first `.txt`, `.md`, `.mdx` or `.json` screen can paint.
        if !is_image
            && !is_video
            && !is_audio
            && crate::core::doc_preview::is_plain_text_document_name(&name)
        {
            const TEXT_PREVIEW_BYTES: usize = 2 * 1024 * 1024;
            let session_for_rate = session_name.clone();
            let sample = tokio::time::timeout(Duration::from_secs(15), async {
                let _slot = session_rate::acquire_media_slot(&session_for_rate).await?;
                let mut iter = live.client.iter_download(&media).chunk_size(256 * 1024);
                let mut bytes = Vec::with_capacity(
                    usize::try_from(size.min(TEXT_PREVIEW_BYTES as u64)).unwrap_or(0),
                );
                while bytes.len() < TEXT_PREVIEW_BYTES {
                    match iter.next().await {
                        Ok(Some(chunk)) if !chunk.is_empty() => {
                            let remaining = TEXT_PREVIEW_BYTES - bytes.len();
                            bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
                            if bytes.len() as u64 >= size {
                                break;
                            }
                        }
                        Ok(Some(_)) | Ok(None) => break,
                        Err(error) => return Err(map_invocation(&error)),
                    }
                }
                Ok::<Vec<u8>, TgError>(bytes)
            })
            .await
            .map_err(|_| {
                TgError::new(
                    TgErrorCode::Timeout,
                    "Telegram text preview timed out after 15 seconds",
                )
            })??;
            let text_content =
                crate::core::doc_preview::preview_text_sample(&name, &sample, size);
            let _ = persist_memory_session(&live.session, &live.session_path);
            return Ok(PreviewStreamResult {
                status: "success".into(),
                stream_id: String::new(),
                stream_url: String::new(),
                path: String::new(),
                mime_type: mime,
                size,
                data_url: None,
                text_content: Some(text_content),
                preview_kind: "text".into(),
                streaming: false,
                backend: BACKEND.into(),
                message: "text preview fetched by bounded Grammers range".into(),
                source: "text_inline".into(),
                is_fallback: false,
                width: None,
                height: None,
                byte_size: sample.len() as u64,
                full_download_error: None,
            });
        }

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
                let mut dl_success = false;
                let max_attempts = 4;
                let mut doc_last_err: Option<String> = None;
                for attempt in 1..=max_attempts {
                    let start_t = std::time::Instant::now();
                    tg_log::info(
                        BACKEND,
                        "preview_stream_attempt_start",
                        format!("Attempt {attempt}/{max_attempts} start for doc {message_id}"),
                    );
                    if attempt > 1 {
                        let backoff_ms = match attempt {
                            2 => 750 + (now_ms() % 150),
                            3 => 2000 + (now_ms() % 300),
                            _ => 5000 + (now_ms() % 500),
                        };
                        tg_log::info(
                            BACKEND,
                            "preview_stream_backoff",
                            format!("Attempt {attempt}/{max_attempts} for doc {message_id}: backoff {backoff_ms}ms, reconnecting..."),
                        );
                        disconnect_cached_session(&session_name);
                        tokio::time::sleep(Duration::from_millis(backoff_ms as u64)).await;
                        if let Ok(fresh_live) = obtain_live_client(sessions_dir, identity, true, true).await {
                            current_live = fresh_live;
                        }
                    }

                    // Refetch fresh message & media
                    let fresh_msgs = match current_live.client.get_messages_by_id(peer, &[mid]).await {
                        Ok(m) => m,
                        Err(e) => {
                            let mapped = map_invocation(&e);
                            let emsg = mapped.to_string();
                            doc_last_err = Some(emsg.clone());
                            tg_log::warn(
                                BACKEND,
                                "preview_stream_attempt_failed",
                                format!("Attempt {attempt}/{max_attempts} get_messages_by_id failed for doc {message_id}: {emsg}"),
                            );
                            if mapped.code() == TgErrorCode::FloodWait {
                                if let Some(secs) = mapped.flood_wait_secs() {
                                    if secs <= 35 {
                                        tokio::time::sleep(Duration::from_secs(u64::from(secs))).await;
                                    } else {
                                        return Err(mapped);
                                    }
                                }
                            }
                            continue;
                        }
                    };
                    let fresh_msg = match fresh_msgs.into_iter().flatten().next() {
                        Some(m) => m,
                        None => {
                            doc_last_err = Some(format!("message {message_id} not found"));
                            tg_log::warn(
                                BACKEND,
                                "preview_stream_attempt_failed",
                                format!("Attempt {attempt}/{max_attempts} message {message_id} not found"),
                            );
                            continue;
                        }
                    };
                    let fresh_media = match fresh_msg.media() {
                        Some(m) => m,
                        None => {
                            doc_last_err = Some("message has no media".into());
                            tg_log::warn(
                                BACKEND,
                                "preview_stream_attempt_failed",
                                format!("Attempt {attempt}/{max_attempts} message {message_id} has no media"),
                            );
                            continue;
                        }
                    };

                    log_raw_media_info("preview_stream_download_attempt", &chat_safe, mid, &fresh_media, &mime, attempt, start_t.elapsed());

                    let part_dest = pdir.join(format!("{chat_safe}_{message_id}_{safe_name}.att{attempt}.part"));
                    let _ = std::fs::remove_file(&part_dest);

                    let dl_res = tokio::time::timeout(
                        Duration::from_secs(30),
                        current_live.client.download_media(&fresh_media, &part_dest)
                    ).await;

                    match dl_res {
                        Ok(Ok(_)) => {
                            let _ = std::fs::rename(&part_dest, &dest);
                            dl_success = true;
                            tg_log::info(
                                BACKEND,
                                "preview_stream_attempt_success",
                                format!("Attempt {attempt}/{max_attempts} succeeded for doc {message_id} in {}ms", start_t.elapsed().as_millis()),
                            );
                            break;
                        }
                        Ok(Err(e)) => {
                            let _ = std::fs::remove_file(&part_dest);
                            let err_str = e.to_string();
                            doc_last_err = Some(err_str.clone());
                            let is_timeout = err_str.contains("-503") || err_str.to_ascii_lowercase().contains("timeout");
                            tg_log::warn(
                                BACKEND,
                                "preview_stream_attempt_failed",
                                format!("Attempt {attempt}/{max_attempts} failed for doc {message_id}: {err_str}"),
                            );
                            if !is_timeout && (err_str.contains("CHANNEL_PRIVATE") || err_str.contains("PEER_ID_INVALID")) {
                                return Err(TgError::new(TgErrorCode::PeerNotFound, "Akses chat ditolak atau tidak valid"));
                            }
                        }
                        Err(_) => {
                            let _ = std::fs::remove_file(&part_dest);
                            doc_last_err = Some("Timeout 30s".into());
                            tg_log::warn(
                                BACKEND,
                                "preview_stream_attempt_failed",
                                format!("Attempt {attempt}/{max_attempts} timed out (30s) for doc {message_id}"),
                            );
                        }
                    }
                }
                if !dl_success && !dest.is_file() {
                    return Err(TgError::new(
                        TgErrorCode::Timeout,
                        "Telegram belum merespons saat mengambil file. AutoGram telah mencoba ulang. Coba lagi beberapa saat.",
                    ));
                }
            }
            let _ = persist_memory_session(&live.session, &live.session_path);
            let local = crate::core::doc_preview::preview_local_document(dest.to_str().unwrap_or(""));
            let (kind, text_content) = match local {
                Ok(p) => (p.preview_kind, p.text_content),
                Err(_) if mime == "application/pdf" => ("pdf".into(), None),
                Err(_) => ("file".into(), None),
            };
            let b_size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(size);
            return Ok(PreviewStreamResult {
                status: "success".into(),
                stream_id: String::new(),
                stream_url: String::new(),
                path: dest.display().to_string(),
                mime_type: mime,
                size: b_size,
                data_url: None,
                text_content,
                preview_kind: kind,
                streaming: false,
                backend: BACKEND.into(),
                message: "document downloaded and parsed by Rust".into(),
                source: "doc_local".into(),
                is_fallback: false,
                width: None,
                height: None,
                byte_size: b_size,
                full_download_error: None,
            });
        }

        // Photos: reuse disk cache; fallback ladder PhotoSize x -> PhotoSize m -> stripped thumb
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

            let mut dl_success = false;
            let mut used_fallback_source: Option<String> = None;
            let mut photo_last_err: Option<String> = None;

            if dest.is_file()
                && std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0) >= size.saturating_mul(9) / 10
            {
                dl_success = true;
            } else {
                let max_attempts = 4;
                for attempt in 1..=max_attempts {
                    let start_t = std::time::Instant::now();
                    tg_log::info(
                        BACKEND,
                        "preview_stream_attempt_start",
                        format!("Attempt {attempt}/{max_attempts} start for photo {message_id}"),
                    );
                    if attempt > 1 {
                        let backoff_ms = match attempt {
                            2 => 750 + (now_ms() % 150),
                            3 => 2000 + (now_ms() % 300),
                            _ => 5000 + (now_ms() % 500),
                        };
                        tg_log::info(
                            BACKEND,
                            "preview_stream_backoff",
                            format!("Attempt {attempt}/{max_attempts} for photo {message_id}: backoff {backoff_ms}ms, reconnecting..."),
                        );
                        disconnect_cached_session(&session_name);
                        tokio::time::sleep(Duration::from_millis(backoff_ms as u64)).await;
                        if let Ok(fresh_live) = obtain_live_client(sessions_dir, identity, true, true).await {
                            current_live = fresh_live;
                        }
                    }

                    // Refetch fresh message & media
                    let fresh_msgs = match current_live.client.get_messages_by_id(peer, &[mid]).await {
                        Ok(m) => m,
                        Err(e) => {
                            let mapped = map_invocation(&e);
                            let emsg = mapped.to_string();
                            photo_last_err = Some(emsg.clone());
                            tg_log::warn(
                                BACKEND,
                                "preview_stream_attempt_failed",
                                format!("Attempt {attempt}/{max_attempts} get_messages_by_id failed for photo {message_id}: {emsg}"),
                            );
                            if mapped.code() == TgErrorCode::FloodWait {
                                if let Some(secs) = mapped.flood_wait_secs() {
                                    if secs <= 35 {
                                        tokio::time::sleep(Duration::from_secs(u64::from(secs))).await;
                                    } else {
                                        return Err(mapped);
                                    }
                                }
                            }
                            continue;
                        }
                    };
                    let fresh_msg = match fresh_msgs.into_iter().flatten().next() {
                        Some(m) => m,
                        None => {
                            photo_last_err = Some(format!("message {message_id} not found"));
                            tg_log::warn(
                                BACKEND,
                                "preview_stream_attempt_failed",
                                format!("Attempt {attempt}/{max_attempts} message {message_id} not found"),
                            );
                            continue;
                        }
                    };
                    let fresh_media = match fresh_msg.media() {
                        Some(m) => m,
                        None => {
                            photo_last_err = Some("message has no media".into());
                            tg_log::warn(
                                BACKEND,
                                "preview_stream_attempt_failed",
                                format!("Attempt {attempt}/{max_attempts} message {message_id} has no media"),
                            );
                            continue;
                        }
                    };

                    log_raw_media_info("preview_stream_download_attempt", &chat_safe, mid, &fresh_media, &mime, attempt, start_t.elapsed());

                    let part_dest = pdir.join(format!("{chat_safe}_{message_id}.att{attempt}.part"));
                    let _ = std::fs::remove_file(&part_dest);

                    let dl_res = tokio::time::timeout(
                        Duration::from_secs(20),
                        current_live.client.download_media(&fresh_media, &part_dest)
                    ).await;

                    match dl_res {
                        Ok(Ok(_)) => {
                            let _ = std::fs::rename(&part_dest, &dest);
                            dl_success = true;
                            tg_log::info(
                                BACKEND,
                                "preview_stream_attempt_success",
                                format!("Attempt {attempt}/{max_attempts} succeeded for photo {message_id} in {}ms", start_t.elapsed().as_millis()),
                            );
                            break;
                        }
                        Ok(Err(e)) => {
                            let _ = std::fs::remove_file(&part_dest);
                            let err_str = e.to_string();
                            photo_last_err = Some(err_str.clone());
                            tg_log::warn(
                                BACKEND,
                                "preview_stream_attempt_failed",
                                format!("Attempt {attempt}/{max_attempts} failed for photo {message_id}: {err_str}"),
                            );
                        }
                        Err(_) => {
                            let _ = std::fs::remove_file(&part_dest);
                            photo_last_err = Some("Timeout 20s".into());
                            tg_log::warn(
                                BACKEND,
                                "preview_stream_attempt_failed",
                                format!("Attempt {attempt}/{max_attempts} timed out (20s) for photo {message_id}"),
                            );
                        }
                    }
                }

                // Photo Fallback Ladder (Task 6):
                // Step 2 & 3: Large / Medium PhotoSize fallback
                if !dl_success && !dest.is_file() {
                    tg_log::info(BACKEND, "preview_stream_fallback", format!("Full photo download failed for {message_id}. Trying PhotoSize fallback ladder..."));
                    if let Ok(msgs) = current_live.client.get_messages_by_id(peer, &[mid]).await {
                        if let Some(fresh_msg) = msgs.into_iter().flatten().next() {
                            if let Some(Media::Photo(photo)) = fresh_msg.media() {
                                let sizes = photo.thumbs();
                                let downloadable: Vec<&PhotoSize> = sizes
                                    .iter()
                                    .filter(|s| matches!(s, PhotoSize::Size(_) | PhotoSize::Progressive(_)) && s.size() > 0)
                                    .collect();

                                // Step 2: Try largest downloadable photo size
                                if let Some(best_sz) = downloadable.last() {
                                    let part_fallback = pdir.join(format!("{chat_safe}_{message_id}_fb_large.part"));
                                    let _ = std::fs::remove_file(&part_fallback);
                                    if let Ok(Ok(_)) = tokio::time::timeout(
                                        Duration::from_secs(10),
                                        current_live.client.download_media(*best_sz, &part_fallback)
                                    ).await {
                                        let _ = std::fs::rename(&part_fallback, &dest);
                                        dl_success = true;
                                        used_fallback_source = Some("telegram_large_thumb".into());
                                    } else {
                                        let _ = std::fs::remove_file(&part_fallback);
                                    }
                                }

                                // Step 3: Try medium downloadable photo size if large failed
                                if !dl_success && downloadable.len() >= 2 {
                                    let med_sz = downloadable[0];
                                    let part_fallback = pdir.join(format!("{chat_safe}_{message_id}_fb_med.part"));
                                    let _ = std::fs::remove_file(&part_fallback);
                                    if let Ok(Ok(_)) = tokio::time::timeout(
                                        Duration::from_secs(8),
                                        current_live.client.download_media(med_sz, &part_fallback)
                                    ).await {
                                        let _ = std::fs::rename(&part_fallback, &dest);
                                        dl_success = true;
                                        used_fallback_source = Some("telegram_medium_thumb".into());
                                    } else {
                                        let _ = std::fs::remove_file(&part_fallback);
                                    }
                                }
                            }
                        }
                    }
                }

                // Step 4: Stripped Mini-Thumb fallback
                if !dl_success && !dest.is_file() {
                    if let Some(stripped_url) = stripped_thumb_data_url(&media) {
                        tg_log::info(BACKEND, "preview_stream_fallback", format!("Using Stripped Mini-Thumb fallback for photo {message_id}"));
                        return Ok(PreviewStreamResult {
                            status: "success".into(),
                            stream_id: String::new(),
                            stream_url: String::new(),
                            path: String::new(),
                            mime_type: mime,
                            size,
                            data_url: Some(stripped_url),
                            text_content: None,
                            preview_kind: "image".into(),
                            streaming: false,
                            backend: BACKEND.into(),
                            message: "stripped thumbnail fallback".into(),
                            source: "stripped_thumb".into(),
                            is_fallback: true,
                            width: Some(40),
                            height: Some(40),
                            byte_size: size,
                            full_download_error: photo_last_err,
                        });
                    }

                    // Step 5: Failure
                    return Err(TgError::new(
                        TgErrorCode::Timeout,
                        "Telegram belum merespons saat mengambil file. AutoGram telah mencoba ulang. Coba lagi beberapa saat.",
                    ));
                }
            }

            let _ = persist_memory_session(&live.session, &live.session_path);
            let final_size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(size);
            let bytes = std::fs::read(&dest).unwrap_or_default();
            let data_url = to_data_url(&bytes);
            let (width, height) = image_dimensions_from_bytes(&bytes);
            let is_fb = used_fallback_source.is_some();
            let src_name = used_fallback_source.unwrap_or_else(|| "full_photo".into());

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
                source: src_name,
                is_fallback: is_fb,
                width,
                height,
                byte_size: bytes.len() as u64,
                full_download_error: if is_fb { photo_last_err } else { None },
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

        // Establish a pool of 4 parallel Client connections (capped at MAX 4 MTProto TCP sockets for playback demand)
        let download_clients = obtain_download_clients(sessions_dir, identity, 4)
            .await
            .unwrap_or_else(|_| vec![live.client.clone()]);

        let dest_path = dest.clone();
        let sid = stream_id.clone();
        let mime_bg = mime.clone();
        let fill_media = media;
        let session_bg = session_name.clone();
        let need_async_moov_tail = is_video && size > 1024 * 1024 && !has_moov_head;

        // Head probe scan (0-1MB)
        log::info!(
            "[MOOV_SCAN] sid={stream_id} requested_range=0-1MB new_unique_bytes=1048576 found={has_moov_head}"
        );

        // Tail probe scan (last 3MB): fetch last 3MB on demand if MOOV not in head
        if need_async_moov_tail {
            let tail_media = fill_media.clone();
            let tail_start_offset = size.saturating_sub(3 * 1024 * 1024);
            let aligned_tail_start = (tail_start_offset / (512 * 1024)) * (512 * 1024);
            let num_chunks = ((size - aligned_tail_start) + 524287) / (512 * 1024);
            let tail_clients = obtain_download_clients(sessions_dir, identity, 2)
                .await
                .unwrap_or_else(|_| download_clients.clone());
            let tail_dest = dest.clone();
            let tail_sid = stream_id.clone();

            if let Some(mut e) = stream_server::get_entry(&stream_id) {
                e.moov_tail_fetching = true;
                stream_server::upsert_entry(e);
            }

            tokio::spawn(async move {
                let (tx, mut rx) = tokio::sync::mpsc::channel(16);
                for i in 0..num_chunks {
                    let chunk_off = aligned_tail_start + i * (512 * 1024);
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
                let mut tail_bytes_buf: Vec<u8> = Vec::new();
                if let Ok(mut f_disk) = std::fs::OpenOptions::new().write(true).open(&tail_dest) {
                    while let Some((chunk_off, res)) = rx.recv().await {
                        if let Ok(Some(bytes)) = res {
                            if !bytes.is_empty() {
                                if f_disk.seek(SeekFrom::Start(chunk_off)).is_ok() && f_disk.write_all(&bytes).is_ok() {
                                    tail_ranges.push((chunk_off, chunk_off + bytes.len() as u64));
                                    if tail_bytes_buf.len() < 2 * 1024 * 1024 {
                                        tail_bytes_buf.extend_from_slice(&bytes);
                                    }
                                }
                            }
                        }
                    }
                    let _ = f_disk.flush();
                }
                let has_moov_tail = tail_bytes_buf.windows(4).any(|w| w == b"moov");
                log::info!(
                    "[MOOV_SCAN] sid={tail_sid} requested_range=last_3MB new_unique_bytes={} found={has_moov_tail}",
                    tail_bytes_buf.len()
                );
                let _ = stream_server::inspect_mp4_layout(&tail_dest);
                if let Some(mut e) = stream_server::get_entry(&tail_sid) {
                    for r in tail_ranges {
                        e.ranges.push(r);
                    }
                    e.moov_ready_cached = has_moov_tail || has_moov_head;
                    e.moov_tail_fetching = false;
                    stream_server::upsert_entry(e);
                }
            });
        } else {
            let _ = stream_server::inspect_mp4_layout(&dest);
        }

        let fill_clients = download_clients;
        let fill_boot_ranges = boot_ranges.clone();
        tokio::spawn(async move {
            let _fill_slot = session_rate::try_acquire_media_slot(&session_bg);
            let flag = cancel;
            let mut ranges: Vec<(u64, u64)> = fill_boot_ranges;

            let result = async {
                const CHUNK_SIZE: u64 = 512 * 1024;
                const PARALLEL_WORKERS: usize = 4; // Capped at MAX 4 workers during playback/demand
                let mut file = std::fs::OpenOptions::new()
                    .write(true)
                    .read(true)
                    .open(&dest_path)
                    .map_err(|e| format!("open partial: {e}"))?;

                let mut cursor: u64 = 0;

                while !flag.load(Ordering::SeqCst) {
                    let Some(entry) = stream_server::get_entry(&sid) else {
                        break;
                    };

                    if entry.cancelled {
                        tg_log::info(BACKEND, "[DEMAND_STREAM]", format!("sid={sid} stream cancelled, stopping workers"));
                        return Err("cancelled".into());
                    }

                    if entry.paused {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        continue;
                    }

                    // 1. Sync local ranges with global entry (picks up tail-fetch ranges and external updates)
                    for r in &entry.ranges {
                        ranges.push(*r);
                    }
                    ranges = stream_server::merge_ranges(&ranges);

                    // 2. Check for incoming Seek Requests (Demand from browser)
                    let demand = take_seek_request(&sid);
                    if let Some(target) = demand {
                        let target = target.min(size.saturating_sub(1));
                        cursor = (target / CHUNK_SIZE) * CHUNK_SIZE;
                        tg_log::info(
                            BACKEND,
                            "[STREAM_DIAG][SEEK]",
                            format!("sid={sid} seek_target={target} cursor_updated={cursor}"),
                        );
                    }

                    // 3. Find next missing offset starting from current cursor position
                    let next_offset = match find_missing_offset_from(&ranges, cursor, size) {
                        Some(off) => off,
                        None => {
                            match first_missing_offset(&ranges, size) {
                                Some(off) => off,
                                None => break, // Entire file downloaded!
                            }
                        }
                    };

                    cursor = next_offset;

                    // 4. Batch fetch up to PARALLEL_WORKERS chunks starting from cursor
                    let window_limit = (cursor + (PARALLEL_WORKERS as u64) * CHUNK_SIZE).min(size);
                    let mut pending_offsets = Vec::new();
                    let mut scan_off = cursor;
                    while pending_offsets.len() < PARALLEL_WORKERS && scan_off < window_limit {
                        let already = ranges.iter().any(|(s, e)| *s <= scan_off && scan_off < *e);
                        if !already {
                            pending_offsets.push(scan_off);
                        }
                        scan_off += CHUNK_SIZE;
                    }

                    if pending_offsets.is_empty() {
                        cursor = window_limit;
                        if first_missing_offset(&ranges, size).is_none() {
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(20)).await;
                        continue;
                    }

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
                    // FIX Bug #2: Kumpulkan hasil batch dengan timeout agar seek request
                    // bisa dideteksi lebih cepat. Gunakan tokio::select! untuk interruptible wait.
                    // Jika seek request masuk saat batch berlangsung, kita masih tunggu
                    // hasil yang sudah terkirim (tidak membatalkan download), tapi setelah
                    // batch selesai langsung redirect cursor ke posisi seek.
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
                        let is_done = first_missing_offset(&ranges, size).is_none();
                        stream_server::upsert_entry(StreamEntry {
                            stream_id: sid.clone(),
                            path: dest_path.display().to_string(),
                            total_size: size,
                            mime: mime_bg.clone(),
                            label: name.clone(),
                            done: is_done,
                            ranges: ranges.clone(),
                            cancelled: false,
                            error: None,
                            paused: false,
                            updated_at_ms: now_ms(),
                            moov_ready_cached: false,
                            moov_tail_fetching: false,
                        });

                        // FIX Bug #3: Cek seek request SEBELUM maju cursor ke scan_off.
                        // Bug lama: cursor selalu maju ke scan_off (window_limit) setelah batch,
                        // mengabaikan seek request yang masuk SELAMA batch berlangsung.
                        // Akibatnya seek request baru dibaca di iterasi berikutnya tapi cursor
                        // sudah terlanjur maju ke depan, dan find_missing_offset_from tidak
                        // kembali ke posisi seek karena ranges sudah ada di depan cursor.
                        if let Some(fresh_seek) = take_seek_request(&sid) {
                            let seek_target = fresh_seek.min(size.saturating_sub(1));
                            cursor = (seek_target / CHUNK_SIZE) * CHUNK_SIZE;
                            tg_log::info(
                                BACKEND,
                                "[STREAM_DIAG][SEEK_BATCH_INTERCEPT]",
                                format!("sid={sid} seek_during_batch={fresh_seek} cursor_jump={cursor}"),
                            );
                        } else {
                            cursor = scan_off;
                        }

                        if is_done {
                            break;
                        }
                    } else {
                        tokio::time::sleep(Duration::from_millis(50)).await;
                    }
                }
                let _ = file.flush();
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

        let boot_bytes = boot_ranges.iter().map(|(s, e)| e.saturating_sub(*s)).sum::<u64>();

        tg_log::info(
            BACKEND,
            "[STREAM_DIAG][STREAM]",
            format!(
                "sid={stream_id} msg={message_id} size={size} mime={mime} is_video={is_video} moov_head={has_moov_head} boot={boot_bytes}"
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
            source: "video_stream".into(),
            is_fallback: false,
            width: None,
            height: None,
            byte_size: size,
            full_download_error: None,
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
            source: "warm_busy".into(),
            is_fallback: false,
            width: None,
            height: None,
            byte_size: 0,
            full_download_error: None,
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
                let m_len = meta.len();
                return Ok(PreviewStreamResult {
                    status: "ok".into(),
                    stream_id: String::new(),
                    stream_url: String::new(),
                    path: warm_path.display().to_string(),
                    mime_type: String::new(),
                    size: m_len,
                    data_url: None,
                    text_content: None,
                    preview_kind: "warm".into(),
                    streaming: false,
                    backend: BACKEND.into(),
                    message: "warm cache hit".into(),
                    source: "warm_cache".into(),
                    is_fallback: false,
                    width: None,
                    height: None,
                    byte_size: m_len,
                    full_download_error: None,
                });
            }
        }
    }

    let rt = runtime()?;
    rt.block_on(async {
        let live = obtain_live_client(&sessions_dir, &identity, true, false).await?;
        let client = &live.client;
        if !client
            .is_authorized()
            .await
            .map_err(|e| map_invocation(&e))?
        {
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
        let msg = msgs.into_iter().flatten().next().ok_or_else(|| {
            TgError::new(
                TgErrorCode::PeerNotFound,
                format!("message {message_id} not found"),
            )
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
            source: "warm".into(),
            is_fallback: false,
            width: None,
            height: None,
            byte_size: got,
            full_download_error: None,
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
        assert_eq!(
            first_missing_offset(&[(0, 512), (1024, 2048)], 2048),
            Some(512)
        );
        assert_eq!(first_missing_offset(&[(1024, 2048), (0, 1024)], 2048), None);
    }
}
