//! Submodule extracted from grammers_ops.rs

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::task::{Context, Poll};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncRead, AsyncSeekExt, AsyncWriteExt, ReadBuf};

use grammers_client::client::PasswordToken;
use grammers_client::media::{Attribute, InputMedia, Media};
use grammers_client::message::InputMessage;
use grammers_client::{tl, Client, SignInError};
use grammers_mtsender::SenderPool;
use grammers_session::storages::MemorySession;
use grammers_session::SessionData;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::runtime::Runtime;

use crate::core::media_prep::{
    extract_video_thumbnail, probe_audio_metadata, probe_video_metadata,
};
use crate::core::path_policy;
use crate::core::session_guard;
use crate::core::session_rate;
use crate::core::telegram_ops::{
    AuthStatus, DialogEntry, TelegramIdentity, UploadStepResult, UserProfile,
};
use crate::core::telethon_session_import::{
    grammers_session_path, import_telethon_to_grammers_file, probe_telethon_session,
    read_session_data, telethon_session_path, write_session_data, TelethonSessionProbe,
};
use crate::core::tg_error::{map_invocation, TgError, TgErrorCode, TgErrorPublic};
use crate::core::tg_log;

use super::client_pool::*;
use super::media_list::*;
use super::peer_resolver::*;
use super::session_auth::*;

/// Local multi-file album (2–10 items per Telegram limit). Photos preferred; documents when as_document.
/// `topic_id` = forum top message id for reply_to (optional).
/// Stable item indices are preserved even when compatibility bucketing makes a
/// group non-contiguous in the original selection.
async fn try_recover_album_from_history(
    client: &Client,
    peer: grammers_session::types::PeerRef,
    chat_id: &str,
    topic_id: Option<i64>,
    expected_indices: &[usize],
    min_timestamp: i64,
) -> Option<Vec<UploadStepResult>> {
    let expected_count = expected_indices.len();
    let mut best_recovered: Option<Vec<UploadStepResult>> = None;
    for attempt in 1..=5 {
        // Progressive backoff: give Telegram more time to index large albums
        let delay_ms = match attempt {
            1 => 1500,
            2 => 2000,
            3 => 3000,
            4 => 4000,
            _ => 5000,
        };
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;

        tg_log::info(
            BACKEND,
            "album_recovery_check_start",
            format!(
                "Checking history for chat={chat_id} topic={:?} expected_count={expected_count} attempt={attempt} min_ts={min_timestamp}",
                topic_id
            ),
        );

        let mut iter = client.iter_messages(peer).limit(50);
        let mut recent_msgs = Vec::new();

        while let Ok(Some(msg)) = iter.next().await {
            let msg_date = msg.date().timestamp();
            // Accept only messages sent during or after this batch attempt (min_timestamp - 10s margin for clock skew)
            if msg_date < min_timestamp - 10 {
                break;
            }
            recent_msgs.push(msg);
        }

        if recent_msgs.is_empty() {
            continue;
        }

        let target_topic = topic_id.filter(|t| *t > 0);

        // 1. Group recent messages by grouped_id
        // Group entries: (grouped_id -> Vec<(message_id, topic_id_matches)>)
        let mut grouped_map: HashMap<i64, Vec<(i64, bool)>> = HashMap::new();
        for msg in &recent_msgs {
            if let Some(gid) = msg.grouped_id() {
                let msg_tid = message_topic_id(msg);
                let topic_matches = match target_topic {
                    Some(tid) => msg_tid == Some(tid),
                    None => true,
                };
                grouped_map
                    .entry(gid)
                    .or_default()
                    .push((msg.id() as i64, topic_matches));
            }
        }

        // Find the best matching grouped_id (closest to expected_count, or exact)
        let mut best_group_mids: Vec<i64> = Vec::new();

        for (_gid, items) in grouped_map {
            let topic_valid = match target_topic {
                Some(_) => items.iter().any(|(_, matches)| *matches),
                None => true,
            };
            if topic_valid && !items.is_empty() {
                let count = items.len();
                if count <= expected_count && count > best_group_mids.len() {
                    best_group_mids = items.into_iter().map(|(m, _)| m).collect();
                }
            }
        }

        if !best_group_mids.is_empty() {
            best_group_mids.sort();
            let recovered_count = best_group_mids.len();
            tg_log::info(
                BACKEND,
                "album_recovered_by_grouped_id",
                format!(
                    "Recovered {}/{} album items by grouped_id from history (attempt {})",
                    recovered_count, expected_count, attempt
                ),
            );

            // Perfect match — return immediately
            if recovered_count == expected_count {
                let mut out = Vec::new();
                for (i, &mid) in best_group_mids.iter().enumerate() {
                    out.push(UploadStepResult {
                        status: "done".into(),
                        message_id: Some(mid),
                        error: None,
                        index: expected_indices[i],
                        backend: Some(BACKEND.into()),
                    });
                }
                return Some(out);
            }

            // Partial match — keep best result so far, retry for stragglers
            let prev_best = best_recovered.as_ref().map_or(0, |v| {
                v.iter().filter(|r| r.status == "done").count()
            });
            if recovered_count > prev_best {
                let mut out = Vec::new();
                for (i, &mid) in best_group_mids.iter().enumerate() {
                    out.push(UploadStepResult {
                        status: "done".into(),
                        message_id: Some(mid),
                        error: None,
                        index: expected_indices[i],
                        backend: Some(BACKEND.into()),
                    });
                }
                for i in recovered_count..expected_count {
                    out.push(UploadStepResult {
                        status: "failed".into(),
                        message_id: None,
                        error: Some(format!(
                            "Item ke-{} tidak diterima oleh Telegram dalam paket album ini ({} dari {} berhasil).",
                            i + 1,
                            recovered_count,
                            expected_count
                        )),
                        index: expected_indices[i],
                        backend: Some(BACKEND.into()),
                    });
                }
                best_recovered = Some(out);
            }
            // Continue loop — more items may appear in later attempts
        }

        // Never claim arbitrary recent media as this commit. A false positive
        // here can create silent loss or a duplicate on retry; only a matching
        // Telegram grouped_id is accepted for automatic reconciliation.
    }

    best_recovered
}

/// Resolve the message IDs returned by `messages.sendMultiMedia` without
/// relying on nearby chat history. Telegram returns `updateMessageID`
/// entries keyed by the exact random IDs used for this commit.
fn map_album_random_ids(random_ids: &[i64], updates: tl::enums::Updates) -> Vec<Option<i64>> {
    let updates_list = match updates {
        tl::enums::Updates::Updates(value) => value.updates,
        tl::enums::Updates::Combined(value) => value.updates,
        _ => Vec::new(),
    };
    let mut by_random_id: HashMap<i64, i64> = HashMap::new();
    let mut ordered_message_ids: Vec<i64> = Vec::new();

    for update in updates_list {
        match update {
            tl::enums::Update::MessageId(value) => {
                by_random_id.insert(value.random_id, i64::from(value.id));
            }
            tl::enums::Update::NewMessage(value) => {
                if let tl::enums::Message::Message(msg) = value.message {
                    ordered_message_ids.push(i64::from(msg.id));
                }
            }
            tl::enums::Update::NewChannelMessage(value) => {
                if let tl::enums::Message::Message(msg) = value.message {
                    ordered_message_ids.push(i64::from(msg.id));
                }
            }
            _ => {}
        }
    }

    random_ids
        .iter()
        .enumerate()
        .map(|(idx, random_id)| {
            by_random_id
                .get(random_id)
                .copied()
                .or_else(|| ordered_message_ids.get(idx).copied())
        })
        .collect()
}

async fn verify_album_messages(
    client: &Client,
    peer: grammers_session::types::PeerRef,
    message_ids: &[i64],
    topic_id: Option<i64>,
) -> Result<i64, TgError> {
    let ids: Vec<i32> = message_ids
        .iter()
        .map(|value| i32::try_from(*value))
        .collect::<Result<_, _>>()
        .map_err(|_| TgError::new(TgErrorCode::Internal, "album message-id overflow"))?;
    let messages = client
        .get_messages_by_id(peer, &ids)
        .await
        .map_err(|error| map_invocation(&error))?;
    if messages.len() != ids.len() || messages.iter().any(Option::is_none) {
        return Err(TgError::new(
            TgErrorCode::Internal,
            "album verification could not fetch every committed message",
        ));
    }
    let expected_topic = topic_id.filter(|value| *value > 0);
    let mut grouped_id = None;
    for (position, message) in messages.into_iter().flatten().enumerate() {
        if message.id() != ids[position] {
            return Err(TgError::new(
                TgErrorCode::Internal,
                "album verification order mismatch",
            ));
        }
        if expected_topic.is_some() && message_topic_id(&message) != expected_topic {
            return Err(TgError::new(
                TgErrorCode::Internal,
                "album verification topic mismatch",
            ));
        }
        let current_group = message.grouped_id().ok_or_else(|| {
            TgError::new(
                TgErrorCode::Internal,
                "album verification found an ungrouped message",
            )
        })?;
        match grouped_id {
            Some(expected) if expected != current_group => {
                return Err(TgError::new(
                    TgErrorCode::Internal,
                    "album verification grouped-id mismatch",
                ))
            }
            None => grouped_id = Some(current_group),
            _ => {}
        }
    }
    grouped_id.ok_or_else(|| TgError::new(TgErrorCode::Internal, "empty album verification"))
}

async fn try_recover_single_file_from_history(
    client: &Client,
    peer: grammers_session::types::PeerRef,
    chat_id: &str,
    topic_id: Option<i64>,
    caption: &str,
    index: usize,
) -> Option<UploadStepResult> {
    for attempt in 1..=3 {
        tokio::time::sleep(Duration::from_secs(2)).await;

        tg_log::info(
            BACKEND,
            "single_upload_recovery_check_start",
            format!("Checking history for chat={chat_id} attempt={attempt}"),
        );

        let mut iter = client.iter_messages(peer).limit(10);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        while let Ok(Some(msg)) = iter.next().await {
            let msg_date = msg.date().timestamp();
            if now - msg_date > 90 {
                break;
            }

            if let Some(tid) = topic_id {
                if tid > 0 {
                    let msg_tid = message_topic_id(&msg);
                    if msg_tid != Some(tid) {
                        continue;
                    }
                }
            }

            if msg.media().is_some() || (!caption.is_empty() && msg.text().contains(caption)) {
                let mid = msg.id() as i64;
                tg_log::info(
                    BACKEND,
                    "single_upload_worker_busy_recovered",
                    format!(
                        "Successfully recovered message_id={mid} from history (attempt {})",
                        attempt
                    ),
                );
                return Some(UploadStepResult {
                    status: "done".into(),
                    message_id: Some(mid),
                    error: None,
                    index,
                    backend: Some(BACKEND.into()),
                });
            }
        }
    }

    None
}

fn is_real_photo(path: &Path, ext: &str) -> bool {
    let matches_ext = matches!(ext, "jpg" | "jpeg" | "png");
    if !matches_ext {
        return false;
    }
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    use std::io::Read;
    let mut header = [0u8; 8];
    let n = file.read(&mut header).unwrap_or(0);
    if n < 3 {
        return false;
    }
    // JPEG magic bytes: 0xFF, 0xD8, 0xFF
    let is_jpeg = header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF;
    // PNG magic bytes: 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
    let is_png = n >= 8
        && header[0] == 0x89
        && header[1] == 0x50
        && header[2] == 0x4E
        && header[3] == 0x47
        && header[4] == 0x0D
        && header[5] == 0x0A
        && header[6] == 0x1A
        && header[7] == 0x0A;

    is_jpeg || is_png
}

fn infer_mime_type(ext: &str, is_image: bool, is_video: bool) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "wav" => "audio/x-wav",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "rar" => "application/x-rar-compressed",
        "7z" => "application/x-7z-compressed",
        "txt" => "text/plain",
        _ => {
            if is_image {
                "image/jpeg"
            } else if is_video {
                "video/mp4"
            } else {
                "application/octet-stream"
            }
        }
    }
}

pub fn upload_album_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    files: &[(String, String)], // path, caption
    as_document: bool,
    silent: bool,
    topic_id: Option<i64>,
    index_base: usize,
) -> Result<Vec<UploadStepResult>, TgError> {
    upload_album_blocking_with_app(
        sessions_dir,
        identity,
        chat_id,
        files,
        as_document,
        silent,
        topic_id,
        index_base,
        None,
        None,
    )
}

pub fn upload_album_blocking_with_app(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    files: &[(String, String)], // path, caption
    as_document: bool,
    silent: bool,
    topic_id: Option<i64>,
    index_base: usize,
    app_handle: Option<tauri::AppHandle>,
    transfer_id: Option<String>,
) -> Result<Vec<UploadStepResult>, TgError> {
    let prepared: Vec<AlbumUploadFile> = files
        .iter()
        .enumerate()
        .map(|(offset, (path, caption))| AlbumUploadFile {
            index: index_base + offset,
            path: path.clone(),
            caption: caption.clone(),
            spoiler: false,
        })
        .collect();
    upload_prepared_album_blocking_with_app(
        sessions_dir,
        identity,
        chat_id,
        &prepared,
        as_document,
        silent,
        topic_id,
        app_handle,
        transfer_id,
        None,
        None,
        None,
        None,
    )
}

#[derive(Debug, Clone)]
pub struct AlbumUploadFile {
    pub index: usize,
    pub path: String,
    pub caption: String,
    pub spoiler: bool,
}

/// Upload and commit a prepared album with the send-operation flags that the
/// high-level Grammers `send_album` helper currently hardcodes. Building the
/// raw request here keeps silent/schedule/send-as and per-item spoilers intact.
#[allow(clippy::too_many_arguments)]
pub fn upload_prepared_album_blocking_with_app(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    files: &[AlbumUploadFile],
    as_document: bool,
    silent: bool,
    topic_id: Option<i64>,
    app_handle: Option<tauri::AppHandle>,
    transfer_id: Option<String>,
    schedule_date: Option<i64>,
    send_as: Option<String>,
    random_ids: Option<Vec<i64>>,
    commit_id: Option<String>,
) -> Result<Vec<UploadStepResult>, TgError> {
    if !(2..=10).contains(&files.len()) {
        return Err(TgError::new(
            TgErrorCode::Internal,
            "album requires 2 to 10 files",
        ));
    }
    for file in files {
        path_policy::assert_safe_transfer_path(&file.path)
            .map_err(|e| TgError::new(TgErrorCode::PathRejected, e))?;
        let path = PathBuf::from(&file.path);
        if !path.is_file() {
            return Err(TgError::new(
                TgErrorCode::Io,
                format!("file not found: {}", file.path),
            ));
        }
        if std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0) == 0 {
            return Err(TgError::new(
                TgErrorCode::Io,
                format!("file is empty (0 bytes): {}", file.path),
            ));
        }
    }

    let rt = runtime()?;
    let chat = chat_id.to_string();
    let items = files.to_vec();
    let reply_to = topic_id
        .filter(|value| *value > 0)
        .map(|value| value as i32);

    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            let app_handle = app_handle.clone();
            let transfer_id = transfer_id.clone();
            Box::pin(async move {
                if !client
                    .is_authorized()
                    .await
                    .map_err(|error| map_invocation(&error))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
                let send_as_peer = match send_as.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
                    Some(value) => resolve_peer(client, value).await.ok().map(|p| p.into()),
                    None => None,
                };
                let expected_indices: Vec<usize> = items.iter().map(|item| item.index).collect();
                let random_ids = match random_ids {
                    Some(values) if values.len() == items.len() => values,
                    Some(_) => {
                        return Err(TgError::new(
                            TgErrorCode::Internal,
                            "persisted album random-id count does not match item count",
                        ))
                    }
                    None => (0..items.len()).map(|_| rand::random()).collect(),
                };
                let mut multi_media = Vec::with_capacity(items.len());

                for (position, item) in items.iter().enumerate() {
                    let path = PathBuf::from(&item.path);
                    let size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
                    let filename = path
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("file.dat")
                        .to_string();
                    if let Some(app) = &app_handle {
                        use tauri::Emitter;
                        let _ = app.emit(
                            "transfer-event",
                            serde_json::json!({
                                "type": "StudioProgress",
                                "index": item.index,
                                "percent": 0.0,
                                "transferred": 0,
                                "total": size,
                                "item_total": size,
                                "phase": "upload"
                            }),
                        );
                    }

                    let uploaded = if let Ok(file) = tokio::fs::File::open(&path).await {
                        let mut reader = ProgressAsyncReader {
                            inner: file,
                            stage: "upload".into(),
                            total_bytes: size,
                            current_bytes: 0,
                            last_emit_time: Instant::now(),
                            last_emit_bytes: 0,
                            app_handle: app_handle.clone(),
                            item_index: item.index,
                            transfer_id: transfer_id.clone(),
                        };
                        client
                            .upload_stream(&mut reader, size as usize, filename.clone())
                            .await
                            .map_err(|error| {
                                TgError::new(TgErrorCode::Io, format!("upload_stream: {error}"))
                            })?
                    } else {
                        client.upload_file(&path).await.map_err(|error| {
                            TgError::new(TgErrorCode::Io, format!("upload_file: {error}"))
                        })?
                    };

                    let ext = path
                        .extension()
                        .and_then(|value| value.to_str())
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    let is_video = matches!(
                        ext.as_str(),
                        "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "3gp" | "ts" | "flv"
                    );
                    let is_audio = matches!(
                        ext.as_str(),
                        "mp3" | "m4a" | "aac" | "ogg" | "opus" | "flac" | "wav" | "wma"
                    );
                    let is_photo = is_real_photo(&path, &ext);
                    let is_image = is_photo
                        || matches!(
                            ext.as_str(),
                            "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "jfif" | "svg" | "heic" | "heif" | "avif"
                        );
                    let mime = infer_mime_type(&ext, is_image, is_video);
                    let path_str = path.to_str().unwrap_or("");

                    let raw_uploaded_media: tl::enums::InputMedia = if !as_document && is_photo {
                        tl::types::InputMediaUploadedPhoto {
                            spoiler: item.spoiler,
                            live_photo: false,
                            file: uploaded.raw,
                            stickers: None,
                            ttl_seconds: None,
                            video: None,
                        }
                        .into()
                    } else {
                        let mut attributes = vec![(tl::types::DocumentAttributeFilename {
                            file_name: filename.clone(),
                        })
                        .into()];
                        if !as_document && is_video {
                            let (width, height, duration) = probe_video_metadata(path_str);
                            attributes.push(
                                Attribute::Video {
                                    round_message: false,
                                    supports_streaming: true,
                                    duration: std::time::Duration::from_secs_f64(duration.max(0.0)),
                                    w: width as i32,
                                    h: height as i32,
                                }
                                .into(),
                            );
                        } else if !as_document && is_audio {
                            let (duration, title, artist) = probe_audio_metadata(path_str);
                            attributes.push(
                                Attribute::Audio {
                                    duration: std::time::Duration::from_secs_f64(duration.max(0.0)),
                                    title,
                                    performer: artist,
                                }
                                .into(),
                            );
                        }
                        let mut thumb = None;
                        if is_video || is_image {
                            if let Some(thumb_path) = extract_video_thumbnail(path_str) {
                                if let Ok(uploaded_thumb) = client.upload_file(&thumb_path).await {
                                    thumb = Some(uploaded_thumb.raw);
                                    tg_log::info(
                                        BACKEND,
                                        "album_thumb_attached",
                                        format!("index={} thumb={}", item.index, thumb_path.display()),
                                    );
                                }
                                let _ = std::fs::remove_file(thumb_path);
                            }
                        }
                        tl::types::InputMediaUploadedDocument {
                            nosound_video: false,
                            force_file: as_document,
                            spoiler: item.spoiler,
                            file: uploaded.raw,
                            thumb,
                            mime_type: if is_video && !as_document {
                                "video/mp4".into()
                            } else {
                                mime.into()
                            },
                            attributes,
                            stickers: None,
                            video_cover: None,
                            video_timestamp: None,
                            ttl_seconds: None,
                        }
                        .into()
                    };

                    let uploaded_media = client
                        .invoke(&tl::functions::messages::UploadMedia {
                            business_connection_id: None,
                            peer: peer.into(),
                            media: raw_uploaded_media,
                        })
                        .await
                        .map_err(|error| map_invocation(&error))?;
                    let mut committed_media = Media::from_raw(uploaded_media)
                        .and_then(|media| media.to_raw_input_media())
                        .ok_or_else(|| {
                            TgError::new(
                                TgErrorCode::Internal,
                                "Telegram uploadMedia returned an unsupported album media type",
                            )
                        })?;
                    match &mut committed_media {
                        tl::enums::InputMedia::Photo(media) => media.spoiler = item.spoiler,
                        tl::enums::InputMedia::Document(media) => media.spoiler = item.spoiler,
                        _ => {}
                    }
                    multi_media.push(tl::enums::InputSingleMedia::Media(
                        tl::types::InputSingleMedia {
                            media: committed_media,
                            random_id: random_ids[position],
                            message: item.caption.clone(),
                            entities: None,
                        },
                    ));
                    tg_log::info(
                        BACKEND,
                        "album_upload_part",
                        format!("index={} file={filename} spoiler={}", item.index, item.spoiler),
                    );
                }

                if let Some(app) = &app_handle {
                    use tauri::Emitter;
                    for item in &items {
                        let _ = app.emit(
                            "transfer-event",
                            serde_json::json!({
                                "type": "StudioItemPhase",
                                "index": item.index,
                                "phase": "committing"
                            }),
                        );
                    }
                }

                let reply_to = reply_to.map(|reply_to_msg_id| {
                    tl::types::InputReplyToMessage {
                        reply_to_msg_id,
                        top_msg_id: Some(reply_to_msg_id),
                        reply_to_peer_id: None,
                        quote_text: None,
                        quote_entities: None,
                        quote_offset: None,
                        monoforum_peer_id: None,
                        todo_item_id: None,
                        poll_option: None,
                    }
                    .into()
                });
                let schedule_date = schedule_date
                    .filter(|value| *value > 0)
                    .and_then(|value| i32::try_from(value).ok());
                let batch_start_ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64;
                let sent = client
                    .invoke(&tl::functions::messages::SendMultiMedia {
                        silent,
                        background: false,
                        clear_draft: false,
                        peer: peer.into(),
                        reply_to,
                        schedule_date,
                        multi_media,
                        send_as: send_as_peer,
                        noforwards: false,
                        update_stickersets_order: false,
                        invert_media: false,
                        quick_reply_shortcut: None,
                        effect: None,
                        allow_paid_floodskip: false,
                        allow_paid_stars: None,
                    })
                    .await;
                let message_ids = match sent {
                    Ok(updates) => map_album_random_ids(&random_ids, updates),
                    Err(error) => {
                        let mapped = map_invocation(&error);
                        tg_log::warn(
                            BACKEND,
                            "album_send_rpc_error",
                            format!(
                                "sendMultiMedia failed: {}. Reconciling grouped history.",
                                mapped.user_message()
                            ),
                        );
                        if let Some(recovered) = try_recover_album_from_history(
                            client,
                            peer,
                            &chat,
                            topic_id,
                            &expected_indices,
                            batch_start_ts,
                        )
                        .await
                        {
                            let recovered_ids: Vec<i64> = recovered
                                .iter()
                                .filter_map(|item| item.message_id)
                                .collect();
                            if recovered_ids.len() == expected_indices.len() {
                                let grouped_id = verify_album_messages(
                                    client,
                                    peer,
                                    &recovered_ids,
                                    topic_id,
                                )
                                .await?;
                                if let Some(commit_id) = commit_id.as_deref() {
                                    crate::core::autogram_core::transfer::verify_album_commit_intent(
                                        commit_id,
                                        Some(grouped_id),
                                    )
                                    .map_err(|error| TgError::new(TgErrorCode::Io, error))?;
                                }
                                return Ok(recovered);
                            }
                        }
                        return Err(mapped);
                    }
                };

                let mut out = Vec::with_capacity(items.len());
                let mut missing_message_ids = false;
                for (position, item) in items.iter().enumerate() {
                    let message_id = message_ids.get(position).copied().flatten();
                    missing_message_ids |= message_id.is_none();
                    out.push(UploadStepResult {
                        status: if message_id.is_some() { "done" } else { "failed" }.into(),
                        message_id,
                        error: message_id.is_none().then(|| "album item missing".into()),
                        index: item.index,
                        backend: Some(BACKEND.into()),
                    });
                }
                if missing_message_ids {
                    if let Some(recovered) = try_recover_album_from_history(
                        client,
                        peer,
                        &chat,
                        topic_id,
                        &expected_indices,
                        batch_start_ts,
                    )
                    .await
                    {
                        let recovered_ids: Vec<i64> = recovered
                            .iter()
                            .filter_map(|item| item.message_id)
                            .collect();
                        if recovered_ids.len() == expected_indices.len() {
                            let grouped_id = verify_album_messages(
                                client,
                                peer,
                                &recovered_ids,
                                topic_id,
                            )
                            .await?;
                            if let Some(commit_id) = commit_id.as_deref() {
                                crate::core::autogram_core::transfer::verify_album_commit_intent(
                                    commit_id,
                                    Some(grouped_id),
                                )
                                .map_err(|error| TgError::new(TgErrorCode::Io, error))?;
                            }
                            return Ok(recovered);
                        }
                    }
                    return Err(TgError::new(
                        TgErrorCode::Internal,
                        "album commit response is incomplete and reconciliation was inconclusive",
                    ));
                }
                if schedule_date.is_none() {
                    let committed_ids: Vec<i64> = out
                        .iter()
                        .filter_map(|item| item.message_id)
                        .collect();
                    let grouped_id = verify_album_messages(client, peer, &committed_ids, topic_id)
                        .await?;
                    if let Some(commit_id) = commit_id.as_deref() {
                        crate::core::autogram_core::transfer::verify_album_commit_intent(
                            commit_id,
                            Some(grouped_id),
                        )
                        .map_err(|error| TgError::new(TgErrorCode::Io, error))?;
                    }
                }
                tg_log::info(BACKEND, "album_ok", format!("n={} chat={chat}", out.len()));
                Ok(out)
            })
        })
        .await
    })
}

#[allow(dead_code)]
fn upload_prepared_album_blocking_with_app_legacy(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    files: &[AlbumUploadFile],
    as_document: bool,
    silent: bool,
    topic_id: Option<i64>,
    app_handle: Option<tauri::AppHandle>,
    transfer_id: Option<String>,
) -> Result<Vec<UploadStepResult>, TgError> {
    if files.len() < 2 {
        return Err(TgError::new(
            TgErrorCode::Internal,
            "album requires at least 2 files",
        ));
    }
    if files.len() > 10 {
        return Err(TgError::new(
            TgErrorCode::Internal,
            "album max 10 files per chunk",
        ));
    }
    for file in files {
        path_policy::assert_safe_transfer_path(&file.path)
            .map_err(|e| TgError::new(TgErrorCode::PathRejected, e))?;
        let pbuf = PathBuf::from(&file.path);
        if !pbuf.is_file() {
            return Err(TgError::new(
                TgErrorCode::Io,
                format!("file not found: {}", file.path),
            ));
        }
        let size = std::fs::metadata(&pbuf).map(|m| m.len()).unwrap_or(0);
        if size == 0 {
            return Err(TgError::new(
                TgErrorCode::Io,
                format!("file is empty (0 bytes): {}", file.path),
            ));
        }
    }
    let rt = runtime()?;
    let chat = chat_id.to_string();
    let items: Vec<(usize, PathBuf, String)> = files
        .iter()
        .map(|file| (file.index, PathBuf::from(&file.path), file.caption.clone()))
        .collect();
    let reply_to = topic_id.filter(|t| *t > 0).map(|t| t as i32);

    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            let app_handle_outer = app_handle.clone();
            let tid_outer = transfer_id.clone();
            Box::pin(async move {
                if !client
                    .is_authorized()
                    .await
                    .map_err(|e| map_invocation(&e))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
                let expected_indices: Vec<usize> = items.iter().map(|item| item.0).collect();
                let mut medias = Vec::with_capacity(items.len());
                for (i, (item_index, path_buf, cap)) in items.iter().enumerate() {
                    let item_index = *item_index;
                    let size = std::fs::metadata(path_buf).map(|m| m.len()).unwrap_or(0);
                    let filename = path_buf
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("file.dat")
                        .to_string();

                    let app_handle_inner = app_handle_outer.clone();
                    let tid_inner = tid_outer.clone();

                    if let Some(app) = &app_handle_outer {
                        use tauri::Emitter;
                        let _ = app.emit(
                            "transfer-event",
                            serde_json::json!({
                                "type": "StudioProgress",
                                "index": item_index,
                                "percent": 0.0,
                                "transferred": 0,
                                "total": size,
                                "item_total": size,
                                "phase": "upload"
                            }),
                        );
                    }

                    let uploaded = if let Ok(tokio_file) = tokio::fs::File::open(path_buf).await {
                        let mut progress_reader = ProgressAsyncReader {
                            inner: tokio_file,
                            stage: "upload".to_string(),
                            total_bytes: size,
                            current_bytes: 0,
                            last_emit_time: Instant::now(),
                            last_emit_bytes: 0,
                            app_handle: app_handle_inner,
                            item_index,
                            transfer_id: tid_inner,
                        };
                        client
                            .upload_stream(&mut progress_reader, size as usize, filename)
                            .await
                            .map_err(|e| {
                                TgError::new(TgErrorCode::Io, format!("upload_stream: {e}"))
                            })?
                    } else {
                        client.upload_file(path_buf).await.map_err(|e| {
                            TgError::new(TgErrorCode::Io, format!("upload_file: {e}"))
                        })?
                    };
                    let ext = path_buf
                        .extension()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    let is_video = matches!(
                        ext.as_str(),
                        "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "3gp" | "ts" | "flv"
                    );
                    let is_audio = matches!(
                        ext.as_str(),
                        "mp3" | "m4a" | "aac" | "ogg" | "opus" | "flac" | "wav" | "wma"
                    );
                    let is_photo = is_real_photo(path_buf, &ext);
                    let is_image = is_photo
                        || matches!(
                            ext.as_str(),
                            "jpg"
                                | "jpeg"
                                | "png"
                                | "webp"
                                | "gif"
                                | "bmp"
                                | "jfif"
                                | "svg"
                                | "heic"
                                | "heif"
                                | "avif"
                        );
                    let mime = infer_mime_type(&ext, is_image, is_video);
                    let path_str = path_buf.to_str().unwrap_or("");
                    let im = InputMedia::new().caption(cap.clone());
                    // Forum topic: attach reply_to on all media items so Telegram routes every file to topic
                    let im = im.reply_to(reply_to);
                    let final_media = if as_document {
                        let mut doc_im = im.mime_type(mime).document(uploaded);
                        if is_video || is_image {
                            let thumb_path = extract_video_thumbnail(path_str);
                            if let Some(ref tp) = thumb_path {
                                if let Ok(thumb_uploaded) = client.upload_file(tp).await {
                                    doc_im = doc_im.thumbnail(thumb_uploaded);
                                    tg_log::info(
                                        BACKEND,
                                        "album_doc_thumb_attached",
                                        format!("i={} thumb={}", i, tp.display()),
                                    );
                                }
                                let _ = std::fs::remove_file(tp);
                            }
                        }
                        doc_im
                    } else if is_photo {
                        im.photo(uploaded)
                    } else if is_video {
                        // Video: send as document with thumbnail + video attributes for Telegram preview
                        let (vid_w, vid_h, vid_dur) = probe_video_metadata(path_str);
                        let mut video_im = im.mime_type("video/mp4").document(uploaded);
                        // Add DocumentAttributeVideo for Telegram to show as video (not generic doc)
                        video_im = video_im.attribute(Attribute::Video {
                            round_message: false,
                            supports_streaming: true,
                            duration: std::time::Duration::from_secs_f64(vid_dur.max(0.0)),
                            w: vid_w as i32,
                            h: vid_h as i32,
                        });
                        // Upload & attach thumbnail if available
                        let thumb_path = extract_video_thumbnail(path_str);
                        if let Some(ref tp) = thumb_path {
                            if let Ok(thumb_uploaded) = client.upload_file(tp).await {
                                video_im = video_im.thumbnail(thumb_uploaded);
                                tg_log::info(
                                    BACKEND,
                                    "album_thumb_attached",
                                    format!("i={} thumb={}", i, tp.display()),
                                );
                            }
                            let _ = std::fs::remove_file(tp);
                        }
                        video_im
                    } else if is_audio {
                        let (aud_dur, aud_title, aud_artist) = probe_audio_metadata(path_str);
                        let mut audio_im = im.mime_type(mime).document(uploaded);
                        audio_im = audio_im.attribute(Attribute::Audio {
                            duration: std::time::Duration::from_secs_f64(aud_dur.max(0.0)),
                            title: aud_title,
                            performer: aud_artist,
                        });
                        let thumb_path = extract_video_thumbnail(path_str);
                        if let Some(ref tp) = thumb_path {
                            if let Ok(thumb_uploaded) = client.upload_file(tp).await {
                                audio_im = audio_im.thumbnail(thumb_uploaded);
                            }
                            let _ = std::fs::remove_file(tp);
                        }
                        audio_im
                    } else {
                        let mut doc_im = im.mime_type(mime).document(uploaded);
                        let thumb_path = extract_video_thumbnail(path_str);
                        if let Some(ref tp) = thumb_path {
                            if let Ok(thumb_uploaded) = client.upload_file(tp).await {
                                doc_im = doc_im.thumbnail(thumb_uploaded);
                            }
                            let _ = std::fs::remove_file(tp);
                        }
                        doc_im
                    };
                    let _ = silent;
                    medias.push(final_media);
                    tg_log::info(
                        BACKEND,
                        "album_upload_part",
                        format!(
                            "i={} file={}",
                            item_index,
                            path_buf.file_name().and_then(|s| s.to_str()).unwrap_or("?")
                        ),
                    );
                }

                if let Some(app) = &app_handle_outer {
                    use tauri::Emitter;
                    for i in 0..items.len() {
                        let _ = app.emit(
                            "transfer-event",
                            serde_json::json!({
                                "type": "StudioItemPhase",
                            "index": items[i].0,
                                "phase": "committing"
                            }),
                        );
                    }
                }

                let batch_start_ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64;
                let sent_res = client.send_album(peer, medias).await;
                let sent = match sent_res {
                    Ok(s) => s,
                    Err(e) => {
                        let mapped = map_invocation(&e);
                        tg_log::warn(
                            BACKEND,
                            "album_send_rpc_error",
                            format!(
                                "send_album RPC hit error: {}. Checking chat history...",
                                mapped.user_message()
                            ),
                        );
                        if let Some(recovered) = try_recover_album_from_history(
                            client,
                            peer,
                            &chat,
                            topic_id,
                            &expected_indices,
                            batch_start_ts,
                        )
                        .await
                        {
                            return Ok(recovered);
                        }
                        return Err(mapped);
                    }
                };

                let mut out = Vec::new();
                let mut missing_mids = false;
                for (i, msg) in sent.into_iter().enumerate() {
                    let mid = msg.as_ref().map(|m| m.id() as i64);
                    if mid.is_none() {
                        missing_mids = true;
                    }
                    out.push(UploadStepResult {
                        status: if mid.is_some() {
                            "done".into()
                        } else {
                            "failed".into()
                        },
                        message_id: mid,
                        error: if mid.is_none() {
                            Some("album item missing".into())
                        } else {
                            None
                        },
                        index: items[i].0,
                        backend: Some(BACKEND.into()),
                    });
                }

                if missing_mids {
                    tg_log::warn(
                        BACKEND,
                        "album_send_missing_mids",
                        format!(
                            "send_album returned missing message IDs. Checking grouped history..."
                        ),
                    );
                    if let Some(recovered) = try_recover_album_from_history(
                        client,
                        peer,
                        &chat,
                        topic_id,
                        &expected_indices,
                        batch_start_ts,
                    )
                    .await
                    {
                        return Ok(recovered);
                    }
                }

                tg_log::info(BACKEND, "album_ok", format!("n={} chat={chat}", out.len()));
                Ok(out)
            })
        })
        .await
    })
}

pub fn upload_file_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    path: &str,
    caption: &str,
    as_document: bool,
    silent: bool,
    index: usize,
) -> Result<UploadStepResult, TgError> {
    upload_file_blocking_topic(
        sessions_dir,
        identity,
        chat_id,
        path,
        caption,
        as_document,
        silent,
        index,
        None,
    )
}

pub struct ProgressAsyncReader<R> {
    pub inner: R,
    pub stage: String,
    pub total_bytes: u64,
    pub current_bytes: u64,
    pub last_emit_time: Instant,
    pub last_emit_bytes: u64,
    pub app_handle: Option<tauri::AppHandle>,
    pub item_index: usize,
    pub transfer_id: Option<String>,
}

impl<R: AsyncRead + Unpin> AsyncRead for ProgressAsyncReader<R> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        if let Some(tid) = &self.transfer_id {
            if crate::core::job_queue::is_transfer_cancelled(tid) {
                return Poll::Ready(Err(std::io::Error::new(
                    std::io::ErrorKind::Interrupted,
                    "Transfer cancelled by user",
                )));
            }
        }
        let filled_before = buf.filled().len();
        let res = Pin::new(&mut self.inner).poll_read(cx, buf);
        if let Poll::Ready(Ok(())) = &res {
            let newly_read = buf.filled().len() - filled_before;
            if newly_read > 0 {
                let this = &mut *self;
                this.current_bytes += newly_read as u64;

                let elapsed_ms = this.last_emit_time.elapsed().as_millis();
                if elapsed_ms >= 150 || this.current_bytes == this.total_bytes {
                    let elapsed_sec = (elapsed_ms as f64 / 1000.0).max(0.001);
                    let delta_bytes = this.current_bytes.saturating_sub(this.last_emit_bytes);
                    let inst_speed = delta_bytes as f64 / elapsed_sec;

                    this.last_emit_time = Instant::now();
                    this.last_emit_bytes = this.current_bytes;

                    let pct = if this.total_bytes > 0 {
                        (this.current_bytes as f64 / this.total_bytes as f64 * 100.0)
                            .clamp(0.0, 100.0)
                    } else {
                        0.0
                    };
                    let remaining = this.total_bytes.saturating_sub(this.current_bytes);
                    let eta = if inst_speed > 10.0 && remaining > 0 {
                        (remaining as f64 / inst_speed) as u64
                    } else {
                        0
                    };

                    if let Some(app) = &this.app_handle {
                        use tauri::Emitter;
                        let _ = app.emit(
                            "transfer-progress",
                            serde_json::json!({
                                "jobId": format!("item-{}", this.item_index),
                                "stage": &this.stage,
                                "currentBytes": this.current_bytes,
                                "totalBytes": this.total_bytes,
                                "speed": inst_speed,
                                "percentage": pct,
                                "eta": eta
                            }),
                        );
                        let _ = app.emit(
                            "transfer-event",
                            serde_json::json!({
                                "type": "StudioProgress",
                                "index": this.item_index,
                                "percent": pct,
                                "transferred": this.current_bytes,
                                "total": this.total_bytes,
                                "speed_mb_s": inst_speed / (1024.0 * 1024.0),
                                "eta_seconds": eta,
                                "phase": "upload"
                            }),
                        );
                    }
                }
            }
        }
        res
    }
}

pub fn upload_file_blocking_topic(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    path: &str,
    caption: &str,
    as_document: bool,
    silent: bool,
    index: usize,
    topic_id: Option<i64>,
) -> Result<UploadStepResult, TgError> {
    upload_file_blocking_topic_with_app(
        sessions_dir,
        identity,
        chat_id,
        path,
        caption,
        as_document,
        silent,
        index,
        topic_id,
        None,
        None,
    )
}

pub fn upload_file_blocking_topic_with_app(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    path: &str,
    caption: &str,
    as_document: bool,
    silent: bool,
    index: usize,
    topic_id: Option<i64>,
    app_handle: Option<tauri::AppHandle>,
    transfer_id: Option<String>,
) -> Result<UploadStepResult, TgError> {
    path_policy::assert_safe_transfer_path(path)
        .map_err(|e| TgError::new(TgErrorCode::PathRejected, e))?;
    let path_buf = PathBuf::from(path);
    if !path_buf.is_file() {
        return Err(TgError::new(
            TgErrorCode::Io,
            format!(
                "file not found: {}",
                path_buf.file_name().and_then(|s| s.to_str()).unwrap_or("?")
            ),
        ));
    }
    let size = std::fs::metadata(&path_buf).map(|m| m.len()).unwrap_or(0);
    let filename = path_buf
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("file.dat")
        .to_string();

    let rt = runtime()?;
    let chat = chat_id.to_string();
    let cap = caption.to_string();
    let reply_to = topic_id.filter(|t| *t > 0).map(|t| t as i32);

    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            let app_handle_inner = app_handle.clone();
            let tid_inner = transfer_id.clone();
            Box::pin(async move {
                if !client
                    .is_authorized()
                    .await
                    .map_err(|e| map_invocation(&e))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
                tg_log::info(
                    BACKEND,
                    "upload_start",
                    format!(
                        "chat={} size={} file={} as_document={} topic={:?}",
                        chat, size, filename, as_document, reply_to
                    ),
                );

                let uploaded = if let Ok(tokio_file) = tokio::fs::File::open(&path_buf).await {
                    let mut progress_reader = ProgressAsyncReader {
                        inner: tokio_file,
                        stage: "upload".to_string(),
                        total_bytes: size,
                        current_bytes: 0,
                        last_emit_time: Instant::now(),
                        last_emit_bytes: 0,
                        app_handle: app_handle_inner,
                        item_index: index,
                        transfer_id: tid_inner,
                    };
                    client
                        .upload_stream(&mut progress_reader, size as usize, filename)
                        .await
                        .map_err(|e| TgError::new(TgErrorCode::Io, format!("upload_stream: {e}")))?
                } else {
                    client
                        .upload_file(&path_buf)
                        .await
                        .map_err(|e| TgError::new(TgErrorCode::Io, format!("upload_file: {e}")))?
                };

                let ext = path_buf
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                let is_video = matches!(
                    ext.as_str(),
                    "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "3gp" | "ts" | "flv"
                );
                let is_audio = matches!(
                    ext.as_str(),
                    "mp3" | "m4a" | "aac" | "ogg" | "opus" | "flac" | "wav" | "wma"
                );
                let is_photo = is_real_photo(&path_buf, &ext);
                let is_image = is_photo
                    || matches!(
                        ext.as_str(),
                        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "jfif" | "svg" | "heic" | "heif" | "avif"
                    );
                let mime = infer_mime_type(&ext, is_image, is_video);
                let path_str = path_buf.to_str().unwrap_or("");

                let mut msg = InputMessage::new()
                    .text(cap.clone())
                    .silent(silent)
                    .reply_to(reply_to);
                // Prefer document for fidelity; video gets thumbnail + video attributes
                msg = if as_document {
                    let mut doc_msg = msg.mime_type(mime).document(uploaded);
                    if is_video || is_image {
                        let thumb_path = extract_video_thumbnail(path_str);
                        if let Some(ref tp) = thumb_path {
                            if let Ok(thumb_uploaded) = client.upload_file(tp).await {
                                doc_msg = doc_msg.thumbnail(thumb_uploaded);
                                tg_log::info(
                                    BACKEND,
                                    "upload_doc_thumb_attached",
                                    format!("index={index} thumb={}", tp.display()),
                                );
                            }
                            let _ = std::fs::remove_file(tp);
                        }
                    }
                    doc_msg
                } else if is_photo {
                    msg.photo(uploaded)
                } else if is_video {
                    // Video: send as document with thumbnail + video attributes for Telegram preview
                    let (vid_w, vid_h, vid_dur) = probe_video_metadata(path_str);
                    let mut video_msg = msg.mime_type("video/mp4").document(uploaded);
                    // Add DocumentAttributeVideo so Telegram shows it as a video (not generic document)
                    video_msg = video_msg.attribute(Attribute::Video {
                        round_message: false,
                        supports_streaming: true,
                        duration: std::time::Duration::from_secs_f64(vid_dur.max(0.0)),
                        w: vid_w as i32,
                        h: vid_h as i32,
                    });
                    // Generate and upload thumbnail for video preview
                    let thumb_path = extract_video_thumbnail(path_str);
                    if let Some(ref tp) = thumb_path {
                        if let Ok(thumb_uploaded) = client.upload_file(tp).await {
                            video_msg = video_msg.thumbnail(thumb_uploaded);
                            tg_log::info(
                                BACKEND,
                                "upload_thumb_attached",
                                format!("index={index} thumb={}", tp.display()),
                            );
                        }
                        let _ = std::fs::remove_file(tp);
                    }
                    video_msg
                } else if is_audio {
                    let (aud_dur, aud_title, aud_artist) = probe_audio_metadata(path_str);
                    let mut audio_msg = msg.mime_type(mime).document(uploaded);
                    audio_msg = audio_msg.attribute(Attribute::Audio {
                        duration: std::time::Duration::from_secs_f64(aud_dur.max(0.0)),
                        title: aud_title,
                        performer: aud_artist,
                    });
                    let thumb_path = extract_video_thumbnail(path_str);
                    if let Some(ref tp) = thumb_path {
                        if let Ok(thumb_uploaded) = client.upload_file(tp).await {
                            audio_msg = audio_msg.thumbnail(thumb_uploaded);
                        }
                        let _ = std::fs::remove_file(tp);
                    }
                    audio_msg
                } else {
                    let mut doc_msg = msg.mime_type(mime).document(uploaded);
                    let thumb_path = extract_video_thumbnail(path_str);
                    if let Some(ref tp) = thumb_path {
                        if let Ok(thumb_uploaded) = client.upload_file(tp).await {
                            doc_msg = doc_msg.thumbnail(thumb_uploaded);
                        }
                        let _ = std::fs::remove_file(tp);
                    }
                    doc_msg
                };

                let sent = match client.send_message(peer, msg).await {
                    Ok(m) => m,
                    Err(e) => {
                        let mapped = map_invocation(&e);
                        let is_busy = mapped.user_message().contains("WORKER_BUSY")
                            || mapped.user_message().contains("500")
                            || mapped.retryable();

                        if is_busy {
                            tg_log::warn(
                                BACKEND,
                                "single_send_worker_busy",
                                format!(
                                    "send_message RPC 500 / WORKER_BUSY hit: {}. Checking history...",
                                    mapped.user_message()
                                ),
                            );
                            if let Some(recovered) = try_recover_single_file_from_history(
                                client,
                                peer,
                                &chat,
                                topic_id,
                                &cap,
                                index,
                            )
                            .await
                            {
                                return Ok(recovered);
                            }
                        }

                        // Auto-retry once on short flood wait
                        if let Some(secs) = mapped.flood_wait_secs() {
                            if secs <= 45 {
                                tg_log::warn(BACKEND, "flood_wait_sleep", format!("secs={secs}"));
                                tokio::time::sleep(Duration::from_secs(secs as u64 + 1)).await;
                                // re-upload not needed — need new upload? Telegram may expire;
                                // for simplicity fail with flood after wait on second path
                                return Err(mapped);
                            }
                        }
                        return Err(mapped);
                    }
                };

                let mid = sent.id() as i64;
                tg_log::info(
                    BACKEND,
                    "upload_ok",
                    format!("message_id={mid} index={index}"),
                );
                Ok(UploadStepResult {
                    status: "done".into(),
                    message_id: Some(mid),
                    error: None,
                    index,
                    backend: Some(BACKEND.into()),
                })
            })
        })
        .await
    })
}

/// Single-media delivery with the same advanced send flags as album commits.
/// Kept separate from the legacy helper so preview/stream call sites retain
/// their existing behavior while Transfer Manager gets explicit semantics.
#[allow(clippy::too_many_arguments)]
pub fn upload_file_blocking_topic_with_delivery(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    path: &str,
    caption: &str,
    as_document: bool,
    silent: bool,
    spoiler: bool,
    index: usize,
    topic_id: Option<i64>,
    schedule_date: Option<i64>,
    send_as: Option<String>,
    app_handle: Option<tauri::AppHandle>,
    transfer_id: Option<String>,
) -> Result<UploadStepResult, TgError> {
    path_policy::assert_safe_transfer_path(path)
        .map_err(|error| TgError::new(TgErrorCode::PathRejected, error))?;
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err(TgError::new(TgErrorCode::Io, "file not found"));
    }
    let size = std::fs::metadata(&path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file.dat")
        .to_string();
    let chat = chat_id.to_string();
    let caption = caption.to_string();
    let is_self_chat = chat.eq_ignore_ascii_case("me")
        || chat.eq_ignore_ascii_case("self")
        || chat.eq_ignore_ascii_case("saved")
        || chat.eq_ignore_ascii_case("saved messages")
        || chat.eq_ignore_ascii_case("saved_messages")
        || chat.eq_ignore_ascii_case("pesan tersimpan")
        || chat == "0";
    let reply_to = if is_self_chat {
        None
    } else {
        topic_id.filter(|value| *value > 0).map(|value| value as i32)
    };
    let rt = runtime()?;

    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            let app_handle = app_handle.clone();
            let transfer_id = transfer_id.clone();
            Box::pin(async move {
                if !client
                    .is_authorized()
                    .await
                    .map_err(|error| map_invocation(&error))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
                let send_as_peer = match send_as.as_deref().map(str::trim).filter(|v| !v.is_empty())
                {
                    Some(value) => resolve_peer(client, value).await.ok().map(|p| p.into()),
                    None => None,
                };
                let uploaded = if let Ok(file) = tokio::fs::File::open(&path).await {
                    let mut reader = ProgressAsyncReader {
                        inner: file,
                        stage: "upload".into(),
                        total_bytes: size,
                        current_bytes: 0,
                        last_emit_time: Instant::now(),
                        last_emit_bytes: 0,
                        app_handle,
                        item_index: index,
                        transfer_id,
                    };
                    client
                        .upload_stream(&mut reader, size as usize, filename.clone())
                        .await
                        .map_err(|error| {
                            TgError::new(TgErrorCode::Io, format!("upload_stream: {error}"))
                        })?
                } else {
                    client.upload_file(&path).await.map_err(|error| {
                        TgError::new(TgErrorCode::Io, format!("upload_file: {error}"))
                    })?
                };

                let ext = path
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                let is_video = matches!(
                    ext.as_str(),
                    "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "3gp" | "ts" | "flv"
                );
                let is_photo = is_real_photo(&path, &ext);
                let is_image = is_photo
                    || matches!(
                        ext.as_str(),
                        "jpg"
                            | "jpeg"
                            | "png"
                            | "webp"
                            | "gif"
                            | "bmp"
                            | "jfif"
                            | "svg"
                            | "heic"
                            | "heif"
                            | "avif"
                    );
                let mime = infer_mime_type(&ext, is_image, is_video);
                let path_str = path.to_str().unwrap_or("");
                let media: tl::enums::InputMedia = if !as_document && is_photo {
                    tl::types::InputMediaUploadedPhoto {
                        spoiler,
                        live_photo: false,
                        file: uploaded.raw,
                        stickers: None,
                        ttl_seconds: None,
                        video: None,
                    }
                    .into()
                } else {
                    let display_filename = if filename.starts_with("remote_")
                        || filename.starts_with("reenc_")
                        || filename.starts_with("remux_")
                    {
                        if !caption.is_empty() && !caption.contains('\n') && caption.len() <= 60 {
                            if caption.contains('.') {
                                caption.clone()
                            } else {
                                format!("{caption}.{ext}")
                            }
                        } else {
                            format!("Media_Stream.{ext}")
                        }
                    } else {
                        filename.clone()
                    };
                    let mut attributes = vec![(tl::types::DocumentAttributeFilename {
                        file_name: display_filename,
                    })
                    .into()];
                    if !as_document && is_video {
                        let (width, height, duration) = probe_video_metadata(path_str);
                        attributes.push(
                            Attribute::Video {
                                round_message: false,
                                supports_streaming: true,
                                duration: std::time::Duration::from_secs_f64(duration.max(0.0)),
                                w: width as i32,
                                h: height as i32,
                            }
                            .into(),
                        );
                    }
                    let mut thumb = None;
                    if is_video || is_image {
                        if let Some(thumb_path) = extract_video_thumbnail(path_str) {
                            if let Ok(uploaded_thumb) = client.upload_file(&thumb_path).await {
                                thumb = Some(uploaded_thumb.raw);
                            }
                            let _ = std::fs::remove_file(thumb_path);
                        }
                    }
                    tl::types::InputMediaUploadedDocument {
                        nosound_video: false,
                        force_file: false,
                        spoiler,
                        file: uploaded.raw,
                        thumb,
                        mime_type: if is_video && !as_document {
                            "video/mp4".into()
                        } else {
                            mime.into()
                        },
                        attributes,
                        stickers: None,
                        video_cover: None,
                        video_timestamp: None,
                        ttl_seconds: None,
                    }
                    .into()
                };
                let reply_to = reply_to.map(|reply_to_msg_id| {
                    tl::types::InputReplyToMessage {
                        reply_to_msg_id,
                        top_msg_id: Some(reply_to_msg_id),
                        reply_to_peer_id: None,
                        quote_text: None,
                        quote_entities: None,
                        quote_offset: None,
                        monoforum_peer_id: None,
                        todo_item_id: None,
                        poll_option: None,
                    }
                    .into()
                });
                let schedule_date = schedule_date
                    .filter(|value| *value > 0)
                    .and_then(|value| i32::try_from(value).ok());
                let random_id = rand::random::<i64>();
                let sent = match client
                    .invoke(&tl::functions::messages::SendMedia {
                        silent,
                        background: false,
                        clear_draft: false,
                        peer: peer.into(),
                        reply_to: reply_to.clone(),
                        media: media.clone(),
                        message: caption.clone(),
                        random_id,
                        reply_markup: None,
                        entities: None,
                        schedule_date,
                        schedule_repeat_period: None,
                        send_as: send_as_peer.clone(),
                        noforwards: false,
                        update_stickersets_order: false,
                        invert_media: false,
                        quick_reply_shortcut: None,
                        effect: None,
                        allow_paid_floodskip: false,
                        allow_paid_stars: None,
                        suggested_post: None,
                    })
                    .await
                {
                    Ok(res) => Ok(res),
                    Err(e) if send_as_peer.is_some() || reply_to.is_some() => {
                        let err_str = e.to_string();
                        if err_str.contains("CHAT_WRITE_FORBIDDEN")
                            || err_str.contains("FORBIDDEN")
                            || err_str.contains("TOPIC_CLOSED")
                            || err_str.contains("REPLY_TO_INVALID")
                        {
                            tg_log::warn(
                                BACKEND,
                                "send_media_retry_fallback",
                                format!("Retrying SendMedia without send_as / topic reply_to due to: {err_str}"),
                            );
                            let random_id2 = rand::random::<i64>();
                            client
                                .invoke(&tl::functions::messages::SendMedia {
                                    silent,
                                    background: false,
                                    clear_draft: false,
                                    peer: peer.into(),
                                    reply_to: None,
                                    media,
                                    message: caption.clone(),
                                    random_id: random_id2,
                                    reply_markup: None,
                                    entities: None,
                                    schedule_date,
                                    schedule_repeat_period: None,
                                    send_as: None,
                                    noforwards: false,
                                    update_stickersets_order: false,
                                    invert_media: false,
                                    quick_reply_shortcut: None,
                                    effect: None,
                                    allow_paid_floodskip: false,
                                    allow_paid_stars: None,
                                    suggested_post: None,
                                })
                                .await
                        } else {
                            Err(e)
                        }
                    }
                    Err(e) => Err(e),
                };
                let message_id = match sent {
                    Ok(updates) => map_album_random_ids(&[random_id], updates)
                        .into_iter()
                        .next()
                        .flatten(),
                    Err(error) => {
                        let mapped = map_invocation(&error);
                        if let Some(recovered) = try_recover_single_file_from_history(
                            client, peer, &chat, topic_id, &caption, index,
                        )
                        .await
                        {
                            return Ok(recovered);
                        }
                        return Err(mapped);
                    }
                };
                if message_id.is_none() {
                    if let Some(recovered) = try_recover_single_file_from_history(
                        client, peer, &chat, topic_id, &caption, index,
                    )
                    .await
                    {
                        return Ok(recovered);
                    }
                }
                Ok(UploadStepResult {
                    status: if message_id.is_some() {
                        "done"
                    } else {
                        "failed"
                    }
                    .into(),
                    message_id,
                    error: message_id
                        .is_none()
                        .then(|| "single media commit missing".into()),
                    index,
                    backend: Some(BACKEND.into()),
                })
            })
        })
        .await
    })
}

/// Full-file download (not progressive Range stream). Dual-path for open/cache of small-mid media.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadFileResult {
    pub status: String,
    pub path: String,
    pub message_id: i64,
    pub size: u64,
    pub name: Option<String>,
    pub mime_type: Option<String>,
    pub backend: String,
    pub sha256: Option<String>,
    pub integrity: String,
    pub resumed_from: u64,
    pub conflict_resolution: String,
}

#[derive(Debug, Clone, Default)]
pub struct DownloadPolicyRequest {
    pub conflict_policy: Option<String>,
    pub resume_partial: bool,
    pub integrity: Option<String>,
    pub expected_sha256: Option<String>,
    pub transfer_id: Option<String>,
    pub item_index: usize,
}

/// Backward-compatible full-file download. Transfer Manager callers should use
/// `download_file_blocking_with_policy` to freeze conflict/resume/integrity.
pub fn download_file_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    message_id: i64,
    dest_path: &str,
) -> Result<DownloadFileResult, TgError> {
    download_file_blocking_with_policy(
        sessions_dir,
        identity,
        chat_id,
        message_id,
        dest_path,
        DownloadPolicyRequest::default(),
    )
}

/// Resumable full-file Grammers download. This path is intentionally separate
/// from Range streaming and preview caches: it only owns explicit filesystem
/// downloads selected by the user or Transfer Manager.
pub fn download_file_blocking_with_policy(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    message_id: i64,
    dest_path: &str,
    policy_request: DownloadPolicyRequest,
) -> Result<DownloadFileResult, TgError> {
    if message_id <= 0 {
        return Err(TgError::new(TgErrorCode::Internal, "message_id required"));
    }
    path_policy::assert_safe_transfer_path(dest_path)
        .map_err(|e| TgError::new(TgErrorCode::PathRejected, e))?;
    use crate::core::autogram_core::transfer::{
        begin_download_receipt, download_receipt_matches, finalize_partial,
        finish_download_receipt, persist_download_ranges, prepare_partial_for_resume,
        reset_download_ranges, resolve_download_destination, sanitize_download_path, sha256_bytes,
        sha256_file, DownloadConflictPolicy, DownloadDestinationPlan, DownloadIntegrity,
        DownloadRangeCheckpoint, DOWNLOAD_CHUNK_SIZE,
    };

    let requested_dest = sanitize_download_path(&PathBuf::from(dest_path));
    let conflict_policy = DownloadConflictPolicy::parse(policy_request.conflict_policy.as_deref());
    let integrity = DownloadIntegrity::parse(policy_request.integrity.as_deref());
    let destination_plan = resolve_download_destination(&requested_dest, conflict_policy)
        .map_err(|error| TgError::new(TgErrorCode::Io, error))?;
    if let DownloadDestinationPlan::SkipExisting { final_path } = destination_plan {
        let size = std::fs::metadata(&final_path)
            .map(|meta| meta.len())
            .unwrap_or(0);
        return Ok(DownloadFileResult {
            status: "skipped".into(),
            path: final_path.display().to_string(),
            message_id,
            size,
            name: final_path
                .file_name()
                .and_then(|value| value.to_str())
                .map(str::to_string),
            mime_type: None,
            backend: BACKEND.into(),
            sha256: None,
            integrity: "existing_unverified".into(),
            resumed_from: 0,
            conflict_resolution: "skip".into(),
        });
    }
    let DownloadDestinationPlan::Download {
        final_path: dest,
        partial_path,
        replaces_existing,
    } = destination_plan
    else {
        unreachable!();
    };
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| TgError::new(TgErrorCode::Io, format!("create dest dir: {e}")))?;
    }
    let rt = runtime()?;
    let chat = chat_id.to_string();
    let mid = message_id as i32;
    let transfer_id = policy_request
        .transfer_id
        .unwrap_or_else(|| format!("download:{}:{}:{}", identity.session, chat_id, message_id));
    let receipt_id = sha256_bytes(
        format!(
            "{}|{}|{}|{}",
            identity.session,
            chat_id,
            message_id,
            dest.display()
        )
        .as_bytes(),
    );
    let expected_sha256 = policy_request
        .expected_sha256
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());
    let resume_partial = policy_request.resume_partial;
    let item_index = policy_request.item_index;
    crate::core::job_queue::clear_cancel_flag_for(&transfer_id);

    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client.is_authorized().await.map_err(|e| map_invocation(&e))? {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
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
                            format!("message {message_id} not found in chat"),
                        )
                    })?;
                let mut media = msg.media().ok_or_else(|| {
                    TgError::new(
                        TgErrorCode::PeerNotFound,
                        "message has no downloadable media",
                    )
                })?;
                let size = media.size().unwrap_or(0) as u64;
                const MAX_FULL: u64 = 4 * 1024 * 1024 * 1024;
                if size > MAX_FULL {
                    return Err(TgError::new(
                        TgErrorCode::TelethonFallbackRequired,
                        format!(
                            "file too large for this Grammers download policy ({size} bytes)"
                        ),
                    ));
                }
                let name = match &media {
                    grammers_client::media::Media::Document(d) => {
                        d.name().map(|s| s.to_string())
                    }
                    grammers_client::media::Media::Photo(_) => {
                        Some(format!("photo_{message_id}.jpg"))
                    }
                    grammers_client::media::Media::Sticker(_) => {
                        Some(format!("sticker_{message_id}.webp"))
                    }
                    _ => None,
                };
                let mime = match &media {
                    grammers_client::media::Media::Document(d) => {
                        d.mime_type().map(|s| s.to_string())
                    }
                    grammers_client::media::Media::Photo(_) => Some("image/jpeg".into()),
                    grammers_client::media::Media::Sticker(_) => Some("image/webp".into()),
                    _ => None,
                };

                tg_log::info(
                    BACKEND,
                    "download_start",
                    format!(
                        "chat={chat} mid={message_id} size={size} conflict={} resume={} integrity={}",
                        conflict_policy.as_str(),
                        resume_partial,
                        integrity.as_str()
                    ),
                );

                let partial_matches = download_receipt_matches(
                    &receipt_id,
                    partial_path.to_string_lossy().as_ref(),
                    size,
                )
                .map_err(|error| TgError::new(TgErrorCode::Io, error))?;
                let resume_from = prepare_partial_for_resume(
                    &partial_path,
                    size,
                    resume_partial && partial_matches,
                )
                .map_err(|error| TgError::new(TgErrorCode::Io, error))?;
                if resume_from == 0 {
                    reset_download_ranges(&receipt_id)
                        .map_err(|error| TgError::new(TgErrorCode::Io, error))?;
                }
                begin_download_receipt(
                    &receipt_id,
                    &transfer_id,
                    item_index,
                    conflict_policy.as_str(),
                    partial_path.to_string_lossy().as_ref(),
                    dest.to_string_lossy().as_ref(),
                    resume_from,
                    size,
                    expected_sha256.as_deref(),
                )
                .map_err(|error| TgError::new(TgErrorCode::Io, error))?;

                let mut output = tokio::fs::OpenOptions::new()
                    .create(true)
                    .read(true)
                    .write(true)
                    .open(&partial_path)
                    .await
                    .map_err(|error| {
                        TgError::new(TgErrorCode::Io, format!("open partial download: {error}"))
                    })?;
                output.set_len(resume_from).await.map_err(|error| {
                    TgError::new(TgErrorCode::Io, format!("set partial length: {error}"))
                })?;
                output
                    .seek(std::io::SeekFrom::Start(resume_from))
                    .await
                    .map_err(|error| {
                        TgError::new(TgErrorCode::Io, format!("seek partial: {error}"))
                    })?;

                let mut offset = resume_from;
                let mut refresh_attempts = 0usize;
                let mut pending_ranges = Vec::new();
                while offset < size {
                    if crate::core::job_queue::is_transfer_cancelled(&transfer_id) {
                        let _ = finish_download_receipt(
                            &receipt_id,
                            "CANCELLED",
                            offset,
                            None,
                        );
                        return Err(TgError::new(
                            TgErrorCode::Cancelled,
                            "download cancelled by user",
                        ));
                    }
                    let skipped_chunks = i32::try_from(offset / DOWNLOAD_CHUNK_SIZE)
                        .map_err(|_| TgError::new(TgErrorCode::Internal, "download offset overflow"))?;
                    let mut download = client
                        .iter_download(&media)
                        .chunk_size(DOWNLOAD_CHUNK_SIZE as i32)
                        .skip_chunks(skipped_chunks);
                    let mut refresh_reference = false;
                    loop {
                        if crate::core::job_queue::is_transfer_cancelled(&transfer_id) {
                            let _ = finish_download_receipt(
                                &receipt_id,
                                "CANCELLED",
                                offset,
                                None,
                            );
                            return Err(TgError::new(
                                TgErrorCode::Cancelled,
                                "download cancelled by user",
                            ));
                        }
                        let chunk = match download.next().await {
                            Ok(Some(bytes)) => bytes,
                            Ok(None) => break,
                            Err(error) => {
                                let message = error.to_string();
                                if (message.contains("FILE_REFERENCE_EXPIRED")
                                    || message.contains("FILEREF_UPGRADE_NEEDED"))
                                    && refresh_attempts < 3
                                {
                                    refresh_attempts += 1;
                                    refresh_reference = true;
                                    break;
                                }
                                let _ = finish_download_receipt(
                                    &receipt_id,
                                    "FAILED",
                                    offset,
                                    None,
                                );
                                return Err(map_invocation(&error));
                            }
                        };
                        if chunk.is_empty() {
                            break;
                        }
                        let remaining = size.saturating_sub(offset) as usize;
                        let bytes = &chunk[..chunk.len().min(remaining)];
                        output.write_all(bytes).await.map_err(|error| {
                            TgError::new(TgErrorCode::Io, format!("write partial: {error}"))
                        })?;
                        pending_ranges.push(DownloadRangeCheckpoint {
                            offset,
                            length: bytes.len() as u64,
                            sha256: sha256_bytes(bytes),
                        });
                        offset = offset.saturating_add(bytes.len() as u64);
                        if pending_ranges.len() >= 16 || offset == size {
                            persist_download_ranges(&receipt_id, &pending_ranges, offset)
                                .map_err(|error| TgError::new(TgErrorCode::Io, error))?;
                            pending_ranges.clear();
                        }
                        if offset >= size {
                            break;
                        }
                    }
                    if !refresh_reference {
                        break;
                    }
                    let refreshed = client
                        .get_messages_by_id(peer, &[mid])
                        .await
                        .map_err(|error| map_invocation(&error))?
                        .into_iter()
                        .flatten()
                        .next()
                        .and_then(|message| message.media())
                        .ok_or_else(|| {
                            TgError::new(
                                TgErrorCode::PeerNotFound,
                                "source media disappeared while refreshing file reference",
                            )
                        })?;
                    if refreshed.size().unwrap_or(0) as u64 != size {
                        let _ = finish_download_receipt(&receipt_id, "FAILED", offset, None);
                        return Err(TgError::new(
                            TgErrorCode::Io,
                            "source media identity changed during resume",
                        ));
                    }
                    media = refreshed;
                }
                if !pending_ranges.is_empty() {
                    persist_download_ranges(&receipt_id, &pending_ranges, offset)
                        .map_err(|error| TgError::new(TgErrorCode::Io, error))?;
                }
                output.flush().await.map_err(|error| {
                    TgError::new(TgErrorCode::Io, format!("flush partial: {error}"))
                })?;
                output.sync_all().await.map_err(|error| {
                    TgError::new(TgErrorCode::Io, format!("sync partial: {error}"))
                })?;
                drop(output);

                let downloaded_size = std::fs::metadata(&partial_path)
                    .map(|metadata| metadata.len())
                    .unwrap_or(offset);
                if downloaded_size != size {
                    let _ = finish_download_receipt(
                        &receipt_id,
                        "FAILED",
                        downloaded_size,
                        None,
                    );
                    return Err(TgError::new(
                        TgErrorCode::Io,
                        format!(
                            "download size mismatch: expected {size}, got {downloaded_size}"
                        ),
                    ));
                }
                let actual_sha256 = if integrity == DownloadIntegrity::Sha256
                    || expected_sha256.is_some()
                {
                    Some(
                        sha256_file(&partial_path)
                            .map_err(|error| TgError::new(TgErrorCode::Io, error))?,
                    )
                } else {
                    None
                };
                if let (Some(expected), Some(actual)) =
                    (expected_sha256.as_deref(), actual_sha256.as_deref())
                {
                    if !expected.eq_ignore_ascii_case(actual) {
                        let _ = finish_download_receipt(
                            &receipt_id,
                            "FAILED",
                            downloaded_size,
                            Some(actual),
                        );
                        return Err(TgError::new(
                            TgErrorCode::Io,
                            "download SHA-256 mismatch",
                        ));
                    }
                }
                finalize_partial(&partial_path, &dest, replaces_existing)
                    .map_err(|error| TgError::new(TgErrorCode::Io, error))?;
                finish_download_receipt(
                    &receipt_id,
                    "COMPLETED",
                    downloaded_size,
                    actual_sha256.as_deref(),
                )
                .map_err(|error| TgError::new(TgErrorCode::Io, error))?;
                let integrity_state = match (
                    integrity,
                    expected_sha256.is_some(),
                    actual_sha256.is_some(),
                ) {
                    (_, true, true) => "verified_sha256",
                    (DownloadIntegrity::Sha256, false, true) => "computed_sha256",
                    _ => "verified_size",
                };
                tg_log::info(
                    BACKEND,
                    "download_ok",
                    format!(
                        "mid={message_id} bytes={downloaded_size} resumed_from={resume_from} integrity={integrity_state}"
                    ),
                );
                Ok(DownloadFileResult {
                    status: "done".into(),
                    path: dest.display().to_string(),
                    message_id,
                    size: downloaded_size,
                    name,
                    mime_type: mime,
                    backend: BACKEND.into(),
                    sha256: actual_sha256,
                    integrity: integrity_state.into(),
                    resumed_from: resume_from,
                    conflict_resolution: if replaces_existing {
                        "overwrite"
                    } else if dest != requested_dest {
                        "rename"
                    } else {
                        "new"
                    }
                    .into(),
                })
            })
        })
        .await
    })
}
