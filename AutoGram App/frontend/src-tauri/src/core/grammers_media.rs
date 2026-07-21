//! Grammers media helpers — progressive stream fill, thumbnails, forum topics.
//!
//! Dual-path companions to Python drive-serve / media_stream. Not full multi-DC
//! seek parity yet: sequential progressive fill + registry updates for Rust Range HTTP.

use std::collections::HashMap;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use grammers_client::media::{Downloadable, Media, PhotoSize};
use grammers_client::tl;
use grammers_client::Client;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use super::grammers_ops::{
    connect_client, persist_memory_session, resolve_peer, runtime, with_client,
};
use super::path_policy;
use super::stream_server::{self, StreamEntry};
use super::telegram_ops::TelegramIdentity;
use super::tg_error::{map_invocation, TgError, TgErrorCode};
use super::tg_log;

const BACKEND: &str = "grammers";
/// Sequential progressive fill caps at this size; larger files still stream but take longer.
const PROGRESSIVE_MAX: u64 = 2 * 1024 * 1024 * 1024; // 2 GiB soft cap for background fill
/// Prefer thumbs under this size for grid.
const THUMB_TARGET_MAX: usize = 96 * 1024;

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn cache_root(sessions_dir: &Path) -> PathBuf {
    // worker/sessions → worker/cache
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

// ── Cancel map for progressive jobs ───────────────────────────────────────

fn cancel_flags() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static MAP: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
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

// ── Topics ────────────────────────────────────────────────────────────────

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
                        // Not a forum / no permission — honest empty pack (not hard error)
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
        .await
    })
}

// ── Thumbnails ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbsBatchResult {
    pub status: String,
    pub thumbs: HashMap<String, Option<String>>,
    pub backend: String,
}

fn pick_thumb(sizes: &[PhotoSize]) -> Option<PhotoSize> {
    // Prefer inlined data (no network)
    for s in sizes {
        if s.to_data().is_some() {
            match s {
                PhotoSize::Cached(_) | PhotoSize::Stripped(_) => return Some(s.clone()),
                _ => {}
            }
        }
    }
    // Prefer mid-size downloadable thumbs
    let mut downloadable: Vec<&PhotoSize> = sizes
        .iter()
        .filter(|s| matches!(s, PhotoSize::Size(_) | PhotoSize::Progressive(_)))
        .collect();
    if downloadable.is_empty() {
        return None;
    }
    downloadable.sort_by_key(|s| s.size());
    // Pick largest under target, else smallest
    let under: Vec<_> = downloadable
        .iter()
        .copied()
        .filter(|s| s.size() > 0 && s.size() <= THUMB_TARGET_MAX)
        .collect();
    if let Some(best) = under.last() {
        return Some((*best).clone());
    }
    downloadable.first().map(|s| (*s).clone())
}

fn media_thumbs(media: &Media) -> Vec<PhotoSize> {
    match media {
        Media::Photo(p) => p.thumbs(),
        Media::Document(d) => d.thumbs(),
        Media::Sticker(s) => s.document.thumbs(),
        _ => vec![],
    }
}

async fn download_thumb_bytes(client: &Client, thumb: &PhotoSize) -> Result<Vec<u8>, TgError> {
    if let Some(data) = thumb.to_data() {
        // Stripped sizes may not be valid JPEG; still return for caller filter
        return Ok(data);
    }
    let mut out = Vec::new();
    let mut iter = client.iter_download(thumb).chunk_size(64 * 1024);
    while let Some(chunk) = iter.next().await.map_err(|e| map_invocation(&e))? {
        out.extend_from_slice(&chunk);
        if out.len() > 512 * 1024 {
            break; // safety
        }
    }
    Ok(out)
}

fn to_data_url(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }
    // Skip stripped JPEG headerless blobs that are too small / not JFIF
    let is_jpeg = bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8;
    let is_png = bytes.len() >= 8 && &bytes[0..4] == b"\x89PNG";
    let is_webp = bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP";
    let mime = if is_jpeg {
        "image/jpeg"
    } else if is_png {
        "image/png"
    } else if is_webp {
        "image/webp"
    } else if bytes.len() < 64 {
        // likely stripped / path vector — skip
        return None;
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
) -> Result<ThumbsBatchResult, TgError> {
    let ids: Vec<i32> = message_ids
        .iter()
        .filter(|&&id| id > 0)
        .take(24)
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
    let _ = std::fs::create_dir_all(thumb_dir(sessions_dir));

    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client.is_authorized().await.map_err(|e| map_invocation(&e))? {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
                let msgs = client
                    .get_messages_by_id(peer, &ids)
                    .await
                    .map_err(|e| map_invocation(&e))?;
                let mut thumbs: HashMap<String, Option<String>> = HashMap::new();
                for (i, mid) in ids.iter().enumerate() {
                    let key = mid.to_string();
                    let Some(Some(msg)) = msgs.get(i) else {
                        thumbs.insert(key, None);
                        continue;
                    };
                    let Some(media) = msg.media() else {
                        thumbs.insert(key, None);
                        continue;
                    };
                    let sizes = media_thumbs(&media);
                    let Some(pick) = pick_thumb(&sizes) else {
                        thumbs.insert(key, None);
                        continue;
                    };
                    match download_thumb_bytes(client, &pick).await {
                        Ok(bytes) => {
                            thumbs.insert(key, to_data_url(&bytes));
                        }
                        Err(e) => {
                            tg_log::warn(BACKEND, "thumb_fail", format!("mid={mid} {e}"));
                            thumbs.insert(key, None);
                        }
                    }
                }
                tg_log::info(
                    BACKEND,
                    "thumbs_batch",
                    format!(
                        "chat={} n={} ok={}",
                        chat,
                        ids.len(),
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
        .await
    })
}

// ── Progressive stream ────────────────────────────────────────────────────

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

/// Start progressive sequential fill. Returns immediately with stream_url once
/// the first registry entry is published; download continues in a background task.
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
    let rt = runtime()?;

    // Phase A: resolve media metadata + create sparse file + register + spawn fill
    rt.block_on(async {
        let live = connect_client(&sessions_dir, &identity, true).await?;
        let client = live.client.clone();
        if !client.is_authorized().await.map_err(|e| map_invocation(&e))? {
            client.disconnect();
            return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
        }
        let peer = resolve_peer(&client, &chat).await?;
        let mid = message_id as i32;
        let msgs = client
            .get_messages_by_id(peer, &[mid])
            .await
            .map_err(|e| map_invocation(&e))?;
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
            client.disconnect();
            return Err(TgError::new(
                TgErrorCode::Internal,
                "media size unknown / empty",
            ));
        }
        if size > PROGRESSIVE_MAX {
            client.disconnect();
            return Err(TgError::new(
                TgErrorCode::TelethonFallbackRequired,
                format!("media {size} exceeds progressive cap — use Telethon path"),
            ));
        }

        let name = media_name(&msg, &media, message_id);
        let mime = guess_mime(&name, &media);
        let is_image = mime.starts_with("image/") && !mime.contains("gif");
        let is_video = mime.starts_with("video/");
        let is_audio = mime.starts_with("audio/");

        // Small images: full download, no stream
        if is_image && size <= 8 * 1024 * 1024 {
            let pdir = preview_dir(&sessions_dir);
            let _ = std::fs::create_dir_all(&pdir);
            let dest = pdir.join(format!(
                "{}_{}.{}",
                chat.replace(|c: char| !c.is_ascii_alphanumeric(), "_"),
                message_id,
                Path::new(&name)
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("jpg")
            ));
            path_policy::assert_safe_transfer_path(dest.to_str().unwrap_or(""))
                .map_err(|e| TgError::new(TgErrorCode::PathRejected, e))?;
            client
                .download_media(&media, &dest)
                .await
                .map_err(|e| TgError::new(TgErrorCode::Io, format!("download: {e}")))?;
            let _ = persist_memory_session(&live.session, &live.session_path);
            client.disconnect();
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
                preview_kind: "image".into(),
                streaming: false,
                backend: BACKEND.into(),
                message: "image downloaded".into(),
            });
        }

        let pdir = preview_dir(&sessions_dir);
        let _ = std::fs::create_dir_all(&pdir);
        let stream_id = format!(
            "g{}-{}-{}",
            message_id,
            now_ms() % 1_000_000,
            (now_ms() / 7) % 99991
        );
        let dest = pdir.join(format!("{stream_id}.partial"));
        path_policy::assert_safe_transfer_path(dest.to_str().unwrap_or(""))
            .map_err(|e| TgError::new(TgErrorCode::PathRejected, e))?;

        // Preallocate sparse-ish file
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

        // Move live client into fill task (do not disconnect here)
        let dest_path = dest.clone();
        let sid = stream_id.clone();
        let mime_bg = mime.clone();
        let fill_media = media;
        tokio::spawn(async move {
            let flag = cancel;
            let mut offset: u64 = 0;
            let mut ranges: Vec<(u64, u64)> = Vec::new();
            let mut moov_bootstrapped = false;
            let result = async {
                let mut iter = live
                    .client
                    .iter_download(&fill_media)
                    .chunk_size(512 * 1024);
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
                    // Honor pause flag from HTTP /pause
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

                    // MP4 video bootstrap: if moov atom is at end of file, pre-fetch tail
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

                    // Publish registry (throttled lightly by calling upsert each ~512KB)
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
                        break;
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
            let _ = persist_memory_session(&live.session, &live.session_path);
            live.client.disconnect();
            let _ = take_cancel(&sid);
        });

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
            format!("sid={stream_id} size={size} mime={mime}"),
        );

        Ok(PreviewStreamResult {
            status: "success".into(),
            stream_id: stream_id.clone(),
            stream_url,
            path: dest.display().to_string(),
            mime_type: mime,
            size,
            data_url: None,
            preview_kind: kind.into(),
            streaming: true,
            backend: BACKEND.into(),
            message: "progressive fill started (Grammers sequential GetFile)".into(),
        })
    })
}

/// Warm first N bytes via sequential download into registry (best-effort).
pub fn warm_preview_head_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    message_id: i64,
    head_bytes: u64,
) -> Result<PreviewStreamResult, TgError> {
    // Reuse full progressive start — sequential fill warms head first naturally.
    let _ = head_bytes;
    start_preview_stream_blocking(sessions_dir, identity, chat_id, message_id)
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
}
