//! Submodule extracted from grammers_ops.rs

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::task::{Context, Poll};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncRead, AsyncSeekExt, AsyncWriteExt, ReadBuf};

use grammers_client::client::PasswordToken;
use grammers_client::media::{Attribute, InputMedia, Media, Uploaded};
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
            let prev_best = best_recovered
                .as_ref()
                .map_or(0, |v| v.iter().filter(|r| r.status == "done").count());
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

/// Persist a best-effort history recovery before returning an error. The
/// orchestrator can acknowledge committed messages and retry only missing
/// source items, avoiding duplicate uploads after a partial album commit.
fn persist_partial_album_recovery(
    commit_id: Option<&str>,
    recovered: &[UploadStepResult],
    reason: &str,
) {
    let Some(commit_id) = commit_id else { return };
    // Keep zero placeholders so IDs stay positionally aligned with
    // `ordered_item_indices_json`; filtering would shift later messages onto
    // the wrong source item during targeted retry.
    let message_ids: Vec<i64> = recovered
        .iter()
        .map(|item| item.message_id.unwrap_or(0))
        .collect();
    if message_ids.iter().all(|message_id| *message_id <= 0) {
        return;
    }
    if let Err(error) = crate::core::autogram_core::transfer::update_album_commit(
        commit_id,
        "REVIEW_REQUIRED",
        &message_ids,
        Some(reason),
    ) {
        tg_log::warn(
            BACKEND,
            "album_partial_recovery_persist_failed",
            format!("commit={commit_id} error={error}"),
        );
    } else {
        tg_log::warn(
            BACKEND,
            "album_partial_recovery_persisted",
            format!(
                "commit={commit_id} recovered={} missing={} reason={reason}",
                message_ids.iter().filter(|message_id| **message_id > 0).count(),
                message_ids.iter().filter(|message_id| **message_id <= 0).count()
            ),
        );
    }
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
    
    // Retry get_messages_by_id up to 3 times with progressive backoff to allow DC read replication
    let mut messages: Option<Vec<Option<grammers_client::message::Message>>> = None;
    for attempt in 1..=3 {
        match client.get_messages_by_id(peer, &ids).await {
            Ok(msgs) if msgs.len() == ids.len() && !msgs.iter().any(Option::is_none) => {
                messages = Some(msgs);
                break;
            }
            Ok(msgs) => {
                if attempt == 3 {
                    messages = Some(msgs);
                } else {
                    tokio::time::sleep(Duration::from_millis(350 * attempt as u64)).await;
                }
            }
            Err(e) => {
                if attempt == 3 {
                    tg_log::warn(
                        BACKEND,
                        "album_verify_get_msgs_error",
                        format!("get_messages_by_id failed on attempt 3: {e:?}"),
                    );
                } else {
                    tokio::time::sleep(Duration::from_millis(350 * attempt as u64)).await;
                }
            }
        }
    }

    let expected_topic = topic_id.filter(|value| *value > 0);
    let mut grouped_id = None;
    let mut layout_mismatch = false;
    let mut seen_messages = 0usize;

    if let Some(msgs) = messages {
        for (position, message) in msgs.into_iter().flatten().enumerate() {
            seen_messages += 1;
            if position < ids.len() && message.id() != ids[position] {
                tg_log::warn(
                    BACKEND,
                    "album_verify_order",
                    format!("album verification position {position}: expected {} got {}", ids[position], message.id()),
                );
            }
            if expected_topic.is_some() && message_topic_id(&message) != expected_topic {
                tg_log::warn(
                    BACKEND,
                    "album_verify_topic",
                    format!("album verification topic: expected {:?} got {:?}", expected_topic, message_topic_id(&message)),
                );
            }
            if let Some(current_group) = message.grouped_id() {
                match grouped_id {
                    Some(expected) if expected != current_group => {
                        layout_mismatch = true;
                        tg_log::warn(
                            BACKEND,
                            "album_verify_gid_diff",
                            format!("album verification grouped_id: {expected} vs {current_group}"),
                        );
                    }
                    None => grouped_id = Some(current_group),
                    _ => {}
                }
            } else {
                layout_mismatch = true;
            }
        }
    }
    if seen_messages != message_ids.len() {
        layout_mismatch = true;
    }

    if layout_mismatch {
        return Err(TgError::new(
            TgErrorCode::Internal,
            "album verification found messages outside one grouped_id",
        ));
    }

    // A grouped_id is mandatory evidence that Telegram rendered one album.
    if let Some(gid) = grouped_id {
        Ok(gid)
    } else {
        Err(TgError::new(TgErrorCode::Internal, "empty album verification"))
    }
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
    let matches_ext = matches!(ext, "jpg" | "jpeg" | "jfif" | "png");
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
        "jpg" | "jpeg" | "jfif" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tiff" | "tif" => "image/tiff",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "psd" => "image/vnd.adobe.photoshop",
        "mp4" => "video/mp4",
        "m4v" => "video/x-m4v",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "3gp" | "3gpp" => "video/3gpp",
        "ts" | "m2ts" => "video/mp2t",
        "flv" => "video/x-flv",
        "wmv" => "video/x-ms-wmv",
        "vob" => "video/x-ms-vob",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" => "audio/ogg",
        "opus" => "audio/opus",
        "flac" => "audio/flac",
        "wav" => "audio/x-wav",
        "wma" => "audio/x-ms-wma",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "rar" => "application/x-rar-compressed",
        "7z" => "application/x-7z-compressed",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        "bz2" => "application/x-bzip2",
        "xz" => "application/x-xz",
        "txt" => "text/plain",
        "json" => "application/json",
        "xml" => "application/xml",
        "html" | "htm" => "text/html",
        "csv" => "text/csv",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
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

/// Telegram applies sticker semantics to `image/webp` documents even when the
/// caller sets `force_file`. Raw/lossless WebP delivery therefore uses a
/// neutral MIME while retaining the original `.webp` filename and bytes. The
/// media reader restores the user-facing MIME from the filename/magic bytes.
fn document_mime_type(ext: &str, inferred: &'static str, as_document: bool) -> &'static str {
    if as_document && matches!(ext, "webp" | "tgs") {
        "application/octet-stream"
    } else {
        inferred
    }
}

fn upload_thumbnail_path(path: &str) -> Option<PathBuf> {
    extract_video_thumbnail(path)
}

async fn upload_thumbnail(client: &Client, path: &str) -> Option<Uploaded> {
    let thumbnail_path = upload_thumbnail_path(path)?;
    let upload_result = match client.upload_file(&thumbnail_path).await {
        Ok(uploaded) => Some(uploaded),
        Err(error) => {
            tg_log::warn(
                BACKEND,
                "thumbnail_upload_skip",
                format!("thumbnail upload skipped: {error}"),
            );
            None
        }
    };
    let _ = std::fs::remove_file(&thumbnail_path);
    upload_result
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
        with_pool_once(|| {
            let chat = chat.clone();
            let items = items.clone();
            let app_handle = app_handle.clone();
            let transfer_id = transfer_id.clone();
            let send_as = send_as.clone();
            let random_ids = random_ids.clone();
            let commit_id = commit_id.clone();
            with_client(sessions_dir, identity, true, move |client| {
                let app_handle = app_handle.clone();
                let transfer_id = transfer_id.clone();
                let send_as = send_as.clone();
                let random_ids = random_ids.clone();
                let commit_id = commit_id.clone();
                Box::pin(async move {
                if !client
                    .is_authorized()
                    .await
                    .map_err(|error| map_invocation(&error))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
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
                let mut medias: Vec<grammers_client::media::InputMedia> = Vec::with_capacity(items.len());

                for (position, item) in items.iter().enumerate() {
                    if let Some(tid) = transfer_id.as_deref() {
                        if crate::core::job_queue::is_transfer_cancelled(tid) {
                            return Err(TgError::new(
                                TgErrorCode::Cancelled,
                                "transfer cancelled by user",
                            ));
                        }
                    }
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
                                if transfer_id
                                    .as_deref()
                                    .is_some_and(crate::core::job_queue::is_transfer_cancelled)
                                {
                                    TgError::new(
                                        TgErrorCode::Cancelled,
                                        "transfer cancelled by user",
                                    )
                                } else {
                                    TgError::new(
                                        TgErrorCode::Io,
                                        format!("upload_stream: {error}"),
                                    )
                                }
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
                        "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "3gp" | "3gpp" | "ts" | "flv" | "wmv" | "m2ts" | "vob"
                    );
                    let is_audio = matches!(
                        ext.as_str(),
                        "mp3" | "m4a" | "aac" | "ogg" | "opus" | "flac" | "wav" | "wma"
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
                                | "tiff"
                                | "tif"
                                | "ico"
                                | "psd"
                                | "raw"
                                | "dng"
                                | "cr2"
                                | "nef"
                                | "arw"
                        );
                    let mime = infer_mime_type(&ext, is_image, is_video);
                    let path_str = path.to_str().unwrap_or("");

                    use grammers_client::media::InputMedia;
                    let mut im = InputMedia::new().caption(item.caption.clone());
                    if !as_document && is_photo {
                        im = im.photo(uploaded);
                    } else if !as_document && is_video {
                        let (width, height, duration) = probe_video_metadata(path_str);
                        let safe_w = if width > 0 { width as i32 } else { 1280 };
                        let safe_h = if height > 0 { height as i32 } else { 720 };
                        let safe_dur = if duration > 0.0 { duration } else { 1.0 };
                        im = im.document(uploaded)
                            .mime_type("video/mp4")
                            .attribute(Attribute::Video {
                                round_message: false,
                                supports_streaming: true,
                                duration: std::time::Duration::from_secs_f64(safe_dur),
                                w: safe_w,
                                h: safe_h,
                            });
                        let thumb_path = upload_thumbnail_path(path_str);
                        if let Some(ref tp) = thumb_path {
                            if let Ok(thumb_uploaded) = client.upload_file(tp).await {
                                im = im.thumbnail(thumb_uploaded);
                            }
                            let _ = std::fs::remove_file(tp);
                        }
                    } else if !as_document && is_audio {
                        let (duration, title, artist) = probe_audio_metadata(path_str);
                        im = im.document(uploaded)
                            .mime_type(mime)
                            .attribute(Attribute::Audio {
                                duration: std::time::Duration::from_secs_f64(duration.max(0.0)),
                                title,
                                performer: artist,
                            });
                    } else {
                        im = im.document(uploaded)
                            .mime_type(document_mime_type(&ext, mime, as_document))
                            .attribute(Attribute::FileName(filename.clone()));
                    }

                    if let Some(reply_to_msg_id) = reply_to {
                        im = im.reply_to(Some(reply_to_msg_id as i32));
                    }
                    medias.push(im);

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

                let batch_start_ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64;
                if let Some(tid) = transfer_id.as_deref() {
                    if crate::core::job_queue::is_transfer_cancelled(tid) {
                        return Err(TgError::new(
                            TgErrorCode::Cancelled,
                            "transfer cancelled by user",
                        ));
                    }
                }
                let sent_res = client.send_album(peer, medias).await;
                let sent = match sent_res {
                    Ok(s) => s,
                    Err(e) => {
                        let mapped = map_invocation(&e);
                        if let Some(tid) = transfer_id.as_deref() {
                            let _ = crate::core::job_queue::append_log(
                                tid,
                                "error",
                                "album_send_rpc_error",
                                format!("code={:?} error={}", mapped.code(), mapped.user_message()),
                            );
                            crate::core::transfer_journal::TransferJournal::new(tid).append(
                                "album_send_rpc_error",
                                serde_json::json!({
                                    "level": "error",
                                    "code": format!("{:?}", mapped.code()),
                                    "message": mapped.user_message(),
                                    "item_count": items.len(),
                                }),
                            );
                        }
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
                            if recovered.len() == expected_indices.len()
                                && recovered.iter().all(|item| item.message_id.is_some())
                            {
                                return Ok(recovered);
                            }
                            persist_partial_album_recovery(
                                commit_id.as_deref(),
                                &recovered,
                                "album RPC failed after a partial Telegram commit",
                            );
                        }
                        return Err(mapped);
                    }
                };

                let mut out = Vec::with_capacity(items.len());
                let mut missing_message_ids = false;
                for (position, msg_opt) in sent.iter().enumerate() {
                    let item = &items[position];
                    let message_id = msg_opt.as_ref().map(|m| m.id() as i64);
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
                        persist_partial_album_recovery(
                            commit_id.as_deref(),
                            &recovered,
                            "album response contained missing message IDs",
                        );
                    }
                    return Err(TgError::new(
                        TgErrorCode::Internal,
                        "album commit response is incomplete and reconciliation was inconclusive",
                    ));
                }
                // Telegram can acknowledge every item while silently placing
                // one or more media outside the album (for example when a
                // media shape/size is not accepted by `sendMultiMedia`).
                // Treat those messages as delivered singles instead of
                // reporting a fully grouped album. This preserves the
                // server-side commit and prevents an expensive re-upload.
                let mut album_layout_valid = true;
                if schedule_date.is_none() {
                    let grouped_ids: Vec<Option<i64>> = sent
                        .iter()
                        .map(|message| message.as_ref().and_then(|value| value.grouped_id()))
                        .collect();
                    let expected_grouped_id = grouped_ids.iter().flatten().copied().next();
                    let mut layout_mismatch = Vec::new();
                    if expected_grouped_id.is_none() {
                        layout_mismatch.extend(
                            out.iter()
                                .enumerate()
                                .filter_map(|(position, item)| {
                                    item.message_id.map(|message_id| (position, message_id, None))
                                }),
                        );
                    }
                    for (position, message) in out.iter().enumerate() {
                        let Some(message_id) = message.message_id else {
                            continue;
                        };
                        let grouped_id = grouped_ids.get(position).copied().flatten();
                        if grouped_id != expected_grouped_id {
                            layout_mismatch.push((position, message_id, grouped_id));
                        }
                    }
                    if !layout_mismatch.is_empty() {
                        // Give Telegram a short indexing window before
                        // classifying a message as a true single. A delayed
                        // update can otherwise look ungrouped even though the
                        // server will expose the complete album moments later.
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
                            if recovered.len() == out.len()
                                && recovered.iter().all(|item| {
                                    matches!(item.status.as_str(), "done" | "success")
                                })
                            {
                                out = recovered;
                                layout_mismatch.clear();
                            }
                        }
                    }
                    if !layout_mismatch.is_empty() {
                        album_layout_valid = false;
                        let detail = layout_mismatch
                            .iter()
                            .map(|(position, message_id, grouped_id)| {
                                format!(
                                    "index={} message_id={} grouped_id={:?}",
                                    items[*position].index, message_id, grouped_id
                                )
                            })
                            .collect::<Vec<_>>()
                            .join(", ");
                        if let Some(tid) = transfer_id.as_deref() {
                            let _ = crate::core::job_queue::append_log(
                                tid,
                                "warn",
                                "album_layout_partial",
                                format!(
                                    "Telegram committed {} item(s) outside the album; no re-upload: {}",
                                    layout_mismatch.len(),
                                    detail
                                ),
                            );
                        }
                        tg_log::warn(
                            BACKEND,
                            "album_layout_partial",
                            format!(
                                "Telegram committed {} item(s) outside grouped album; preserving existing messages ({detail})",
                                layout_mismatch.len()
                            ),
                        );
                        for (position, _, _) in layout_mismatch {
                            out[position].status = "delivered_single".into();
                            out[position].error = Some(
                                "Telegram delivered this item as a separate message; upload was not repeated.".into(),
                            );
                        }
                    }
                }
                if schedule_date.is_none() && album_layout_valid {
                    let committed_ids: Vec<i64> = out
                        .iter()
                        .filter_map(|item| item.message_id)
                        .collect();
                    let grouped_id = match verify_album_messages(
                        client,
                        peer,
                        &committed_ids,
                        topic_id,
                    )
                    .await
                    {
                        Ok(value) => value,
                        Err(verification_error) => {
                            // Telegram may return updateMessageID entries in
                            // an order that does not line up with the
                            // NewChannelMessage updates.  The album can still
                            // be committed successfully, but trusting that
                            // provisional mapping used to classify a valid
                            // album as ungrouped and silently re-send every
                            // item as singles.  Reconcile by grouped_id before
                            // allowing the orchestrator's single-message
                            // fallback.
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
                                    let recovered_grouped_id = verify_album_messages(
                                        client,
                                        peer,
                                        &recovered_ids,
                                        topic_id,
                                    )
                                    .await?;
                                    if let Some(commit_id) = commit_id.as_deref() {
                                        crate::core::autogram_core::transfer::verify_album_commit_intent(
                                            commit_id,
                                            Some(recovered_grouped_id),
                                        )
                                        .map_err(|error| TgError::new(TgErrorCode::Io, error))?;
                                    }
                                    return Ok(recovered);
                                }
                                persist_partial_album_recovery(
                                    commit_id.as_deref(),
                                    &recovered,
                                    "album grouped_id verification found a partial commit",
                                );
                            }
                            return Err(verification_error);
                        }
                    };
                    if let Some(commit_id) = commit_id.as_deref() {
                        crate::core::autogram_core::transfer::verify_album_commit_intent(
                            commit_id,
                            Some(grouped_id),
                        )
                        .map_err(|error| TgError::new(TgErrorCode::Io, error))?;
                    }
                }
                tg_log::info(BACKEND, "album_ok", format!("n={} chat={chat}", out.len()));
                if let Some(tid) = transfer_id.as_deref() {
                    let anchor = out
                        .iter()
                        .find_map(|item| item.message_id)
                        .map(|id| id.to_string())
                        .unwrap_or_else(|| "unknown".into());
                    let _ = crate::core::job_queue::append_log(
                        tid,
                        "info",
                        "album_committed",
                        format!("item_count={} anchor_message_id={anchor}", out.len()),
                    );
                }
                Ok(out)
            })
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
                            .upload_stream(&mut progress_reader, size as usize, filename.clone())
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
                                | "tiff"
                                | "tif"
                                | "ico"
                                | "psd"
                                | "raw"
                                | "dng"
                                | "cr2"
                                | "nef"
                                | "arw"
                        );
                    let mime = infer_mime_type(&ext, is_image, is_video);
                    let path_str = path_buf.to_str().unwrap_or("");
                    let im = InputMedia::new().caption(cap.clone());
                    // Forum topic: attach reply_to on all media items so Telegram routes every file to topic
                    let im = im.reply_to(reply_to);
                    let final_media = if as_document {
                        let mut thumb_raw = None;
                        if is_video || is_image || is_audio {
                            let thumb_path = extract_video_thumbnail(path_str);
                            if let Some(ref tp) = thumb_path {
                                if let Ok(thumb_uploaded) = client.upload_file(tp).await {
                                    thumb_raw = Some(thumb_uploaded.raw);
                                    tg_log::info(
                                        BACKEND,
                                        "album_doc_thumb_attached",
                                        format!("i={} thumb={}", i, tp.display()),
                                    );
                                }
                                let _ = std::fs::remove_file(tp);
                            }
                        }
                        im.media(tl::types::InputMediaUploadedDocument {
                            nosound_video: false,
                            force_file: true,
                            spoiler: false,
                            file: uploaded.raw,
                            thumb: thumb_raw,
                            mime_type: document_mime_type(&ext, mime, true).to_string(),
                            attributes: vec![(tl::types::DocumentAttributeFilename {
                                file_name: filename.to_string(),
                            })
                            .into()],
                            stickers: None,
                            video_cover: None,
                            video_timestamp: None,
                            ttl_seconds: None,
                        })
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
                        let mut thumb_raw = None;
                        let thumb_path = extract_video_thumbnail(path_str);
                        if let Some(ref tp) = thumb_path {
                            if let Ok(thumb_uploaded) = client.upload_file(tp).await {
                                thumb_raw = Some(thumb_uploaded.raw);
                            }
                            let _ = std::fs::remove_file(tp);
                        }
                        im.media(tl::types::InputMediaUploadedDocument {
                            nosound_video: false,
                            force_file: true,
                            spoiler: false,
                            file: uploaded.raw,
                            thumb: thumb_raw,
                            mime_type: document_mime_type(&ext, mime, true).to_string(),
                            attributes: vec![(tl::types::DocumentAttributeFilename {
                                file_name: filename.to_string(),
                            })
                            .into()],
                            stickers: None,
                            video_cover: None,
                            video_timestamp: None,
                            ttl_seconds: None,
                        })
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
                            if recovered.len() == expected_indices.len()
                                && recovered.iter().all(|item| item.message_id.is_some())
                            {
                                return Ok(recovered);
                            }
                            tg_log::warn(
                                BACKEND,
                                "album_partial_recovery_rejected",
                                format!(
                                    "recovered={} expected={} action=return_error",
                                    recovered.iter().filter(|item| item.message_id.is_some()).count(),
                                    expected_indices.len()
                                ),
                            );
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
                        if recovered.len() == expected_indices.len()
                            && recovered.iter().all(|item| item.message_id.is_some())
                        {
                            return Ok(recovered);
                        }
                        tg_log::warn(
                            BACKEND,
                            "album_partial_recovery_rejected",
                            format!(
                                "recovered={} expected={} action=return_error",
                                recovered.iter().filter(|item| item.message_id.is_some()).count(),
                                expected_indices.len()
                            ),
                        );
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

pub(crate) const REMOTE_CLOUD_FETCH_MAX_BYTES: u64 = 20 * 1024 * 1024;

/// Bounded in-memory reader for a remote response. `poll_read` performs a small
/// blocking read, but the orchestrator already runs on a dedicated Tokio
/// runtime and this keeps the response out of the filesystem entirely.
struct RemoteUrlReader {
    inner: Box<dyn Read + Send>,
}

impl AsyncRead for RemoteUrlReader {
    fn poll_read(
        mut self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        // `ReadBuf` may expose only a small tail (for example 144 bytes).
        // Reading directly into its unfilled slice guarantees that we never
        // advance beyond the remaining capacity; the previous implementation
        // read a full 128 KiB scratch chunk and then panicked in `put_slice`.
        let unfilled = buf.initialize_unfilled();
        if unfilled.is_empty() {
            return Poll::Ready(Ok(()));
        }
        match self.inner.read(unfilled) {
            Ok(0) => Poll::Ready(Ok(())),
            Ok(n) => {
                buf.advance(n);
                Poll::Ready(Ok(()))
            }
            Err(error) => Poll::Ready(Err(error)),
        }
    }
}

fn remote_engine_choice(value: &str, size: Option<u64>) -> &'static str {
    match value.trim().to_ascii_lowercase().as_str() {
        "cloud_fetch" | "cloud" | "direct" => "cloud_fetch",
        "storage_local" | "local" | "spool" | "disk" => "storage_local",
        _ => match size {
            Some(bytes) if bytes <= REMOTE_CLOUD_FETCH_MAX_BYTES => "cloud_fetch",
            _ => "storage_local",
        },
    }
}

pub(crate) fn remote_head(url: &str) -> Result<(Option<u64>, String), TgError> {
    let agent = crate::core::media_prep::create_resilient_http_agent();
    let mut req = agent.head(url);
    req = req.set(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 AutoGram/4.0",
    );
    req = req.set("Accept", "*/*");
    if url.contains("twimg.com") || url.contains("x.com") || url.contains("twitter.com") {
        req = req.set("Referer", "https://x.com/");
    } else if url.contains("pixiv.net") || url.contains("pximg.net") {
        req = req.set("Referer", "https://www.pixiv.net/");
    } else if url.contains("tiktok.com") || url.contains("tikwm.com") {
        req = req.set("Referer", "https://www.tiktok.com/");
    }

    let response = req.call().or_else(|_| {
        let mut get_req = agent.get(url);
        get_req = get_req.set(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 AutoGram/4.0",
        );
        get_req = get_req.set("Accept", "*/*");
        if url.contains("twimg.com") || url.contains("x.com") || url.contains("twitter.com") {
            get_req = get_req.set("Referer", "https://x.com/");
        } else if url.contains("pixiv.net") || url.contains("pximg.net") {
            get_req = get_req.set("Referer", "https://www.pixiv.net/");
        } else if url.contains("tiktok.com") || url.contains("tikwm.com") {
            get_req = get_req.set("Referer", "https://www.tiktok.com/");
        }
        get_req.call()
    }).map_err(|error| TgError::new(TgErrorCode::Io, format!("remote HEAD/GET failed: {error}")))?;

    let size = response
        .header("content-length")
        .and_then(|value| value.parse::<u64>().ok());
    let content_type = response
        .header("content-type")
        .unwrap_or("application/octet-stream")
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .trim()
        .to_ascii_lowercase();
    Ok((size, content_type))
}

pub(crate) fn remote_extension(url: &str, content_type: &str) -> String {
    let from_url = url::Url::parse(url)
        .ok()
        .and_then(|parsed| {
            parsed
                .path_segments()
                .and_then(|mut segments| segments.next_back())
                .map(|name| name.rsplit_once('.').map(|(_, ext)| ext.to_ascii_lowercase()))
                .flatten()
        })
        .filter(|ext| ext.len() <= 8 && ext.chars().all(|c| c.is_ascii_alphanumeric()));
    if let Some(ext) = from_url {
        return ext;
    }
    match content_type {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "video/mp4" => "mp4",
        "audio/mpeg" => "mp3",
        "audio/ogg" => "ogg",
        _ => "bin",
    }
    .to_string()
}

/// Deliver a direct remote URL without creating a temporary file. Small known
/// objects use Telegram's external-media constructor (zero media bytes on the
/// local link); larger objects use a bounded RAM pipe (zero persistent disk,
/// but necessarily non-zero local network quota).
pub fn upload_remote_url_blocking_topic_with_app(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    url: &str,
    caption: &str,
    as_document: bool,
    silent: bool,
    spoiler: bool,
    index: usize,
    topic_id: Option<i64>,
    schedule_date: Option<i64>,
    app_handle: Option<tauri::AppHandle>,
    transfer_id: Option<String>,
    engine_mode: &str,
    thumbnail_url: Option<&str>,
) -> Result<UploadStepResult, TgError> {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(TgError::new(TgErrorCode::PathRejected, "remote URL must use http or https"));
    }
    let (size, content_type) = remote_head(url)?;
    let selected_engine = remote_engine_choice(engine_mode, size);
    if selected_engine == "cloud_fetch" && size.is_none() {
        return Err(TgError::new(
            TgErrorCode::Io,
            "cloud fetch requires a remote Content-Length; choose RAM stream for unknown-size URLs",
        ));
    }
    if selected_engine == "cloud_fetch" && size.is_some_and(|bytes| bytes > REMOTE_CLOUD_FETCH_MAX_BYTES) {
        return Err(TgError::new(
            TgErrorCode::Io,
            "remote object exceeds 20 MiB cloud-fetch limit; choose RAM stream",
        ));
    }
    if let Some(app) = &app_handle {
        use tauri::Emitter;
        let _ = app.emit(
            "transfer-event",
            serde_json::json!({
                "type": "StudioProgress",
                "index": index,
                "percent": 0.0,
                "transferred": 0,
                "total": size.unwrap_or(0),
                "phase": if selected_engine == "cloud_fetch" { "cloud_fetch" } else { "upload" },
                "engine": selected_engine
            }),
        );
    }

    let ext = remote_extension(url, &content_type);
    let filename = if !caption.trim().is_empty() && !caption.contains("~tplv") && !caption.starts_with("http") {
        let clean = caption.split('\n').next().unwrap_or(caption).trim();
        if clean.ends_with(&format!(".{ext}")) {
            clean.to_string()
        } else {
            format!("{clean}.{ext}")
        }
    } else {
        format!("Remote_Media.{ext}")
    };
    let is_photo = (content_type.starts_with("image/") || ext == "jpg" || ext == "jpeg" || ext == "png" || ext == "webp") && !as_document;
    let is_video = (content_type.starts_with("video/") || ext == "mp4" || ext == "mov" || ext == "mkv" || ext == "webm" || ext == "m4v") && !as_document;
    let is_audio = (content_type.starts_with("audio/") || ext == "mp3" || ext == "m4a" || ext == "aac" || ext == "ogg" || ext == "flac") && !as_document;
    let thumbnail_url_owned = thumbnail_url.map(str::to_string);

    let chat = chat_id.to_string();
    let is_self_chat = matches!(
        chat.to_ascii_lowercase().as_str(),
        "me" | "self" | "saved" | "saved messages" | "saved_messages" | "pesan tersimpan" | "0"
    );
    let reply_to = if is_self_chat {
        None
    } else {
        topic_id.filter(|value| *value > 0).map(|value| value as i32)
    };
    let caption = caption.to_string();
    let url = url.to_string();
    let rt = runtime()?;
    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            let app_handle = app_handle.clone();
            let transfer_id = transfer_id.clone();
            let filename = filename.clone();
            let content_type = content_type.clone();
            let url = url.clone();
            let caption = caption.clone();
            let thumbnail_url_owned = thumbnail_url_owned.clone();
            Box::pin(async move {
                if !client.is_authorized().await.map_err(|error| map_invocation(&error))? {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
                let mut msg = InputMessage::new().text(caption).silent(silent);
                if let Some(reply) = reply_to {
                    msg = msg.reply_to(Some(reply));
                }

                // Download small remote thumbnail (~30-50 KB) if thumbnail_url is present
                let thumb_file = thumbnail_url_owned
                    .as_deref()
                    .and_then(crate::core::media_prep::download_remote_thumbnail);
                let mut thumb_uploaded = None;
                if let Some(ref tf) = thumb_file {
                    if let Ok(t_up) = client.upload_file(tf).await {
                        thumb_uploaded = Some(t_up);
                    }
                    let _ = std::fs::remove_file(tf);
                }

                let sent = if selected_engine == "cloud_fetch" {
                    if is_photo {
                        msg = msg.photo_url(url);
                    } else {
                        let thumb_raw = thumb_uploaded.map(|u| u.raw);
                        msg = msg.media(
                            tl::types::InputMediaDocumentExternal {
                                spoiler,
                                url,
                                ttl_seconds: None,
                                video_cover: None,
                                video_timestamp: None,
                            },
                        );
                    }
                    if let Some(timestamp) = schedule_date {
                        msg = msg.schedule_date(Some(SystemTime::UNIX_EPOCH + Duration::from_secs(timestamp.max(0) as u64)));
                    }
                    client.send_message(peer, msg).await.map_err(|error| map_invocation(&error))?
                } else {
                    let agent = crate::core::media_prep::create_resilient_http_agent();
                    let mut req = agent.get(&url);
                    req = req.set(
                        "User-Agent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 AutoGram/4.0",
                    );
                    req = req.set("Accept", "*/*");
                    if url.contains("twimg.com") || url.contains("x.com") || url.contains("twitter.com") {
                        req = req.set("Referer", "https://x.com/");
                    } else if url.contains("pixiv.net") || url.contains("pximg.net") {
                        req = req.set("Referer", "https://www.pixiv.net/");
                    } else if url.contains("tiktok.com") || url.contains("tikwm.com") {
                        req = req.set("Referer", "https://www.tiktok.com/");
                    }
                    let response = req
                        .call()
                        .map_err(|error| TgError::new(TgErrorCode::Io, format!("remote GET failed: {error}")))?;
                    let total = size
                        .or_else(|| response.header("content-length").and_then(|value| value.parse::<u64>().ok()))
                        .ok_or_else(|| TgError::new(TgErrorCode::Io, "RAM stream requires a remote Content-Length"))?;
                    if total == 0 || total > 4 * 1024 * 1024 * 1024 {
                        return Err(TgError::new(TgErrorCode::Io, "remote object has an invalid or unsupported size"));
                    }
                    let reader = RemoteUrlReader { inner: Box::new(response.into_reader()) };
                    let mut progress = ProgressAsyncReader {
                        inner: reader,
                        stage: "upload".into(),
                        total_bytes: total,
                        current_bytes: 0,
                        last_emit_time: Instant::now(),
                        last_emit_bytes: 0,
                        app_handle: app_handle.clone(),
                        item_index: index,
                        transfer_id: transfer_id.clone(),
                    };
                    let uploaded = client
                        .upload_stream(&mut progress, total as usize, filename.clone())
                        .await
                        .map_err(|error| TgError::new(TgErrorCode::Io, format!("remote upload_stream: {error}")))?;

                    if is_photo {
                        msg = msg.photo(uploaded);
                    } else if is_video {
                        let mut video_msg = msg.mime_type("video/mp4").document(uploaded);
                        video_msg = video_msg.attribute(Attribute::Video {
                            round_message: false,
                            supports_streaming: true,
                            duration: std::time::Duration::from_secs(0),
                            w: 0,
                            h: 0,
                        });
                        if let Some(t_up) = thumb_uploaded {
                            video_msg = video_msg.thumbnail(t_up);
                        }
                        msg = video_msg;
                    } else if is_audio {
                        let mut audio_msg = msg.mime_type(&content_type).document(uploaded);
                        audio_msg = audio_msg.attribute(Attribute::Audio {
                            duration: std::time::Duration::from_secs(0),
                            title: Some(filename.clone()),
                            performer: Some("".to_string()),
                        });
                        if let Some(t_up) = thumb_uploaded {
                            audio_msg = audio_msg.thumbnail(t_up);
                        }
                        msg = audio_msg;
                    } else {
                        let thumb_raw = thumb_uploaded.map(|u| u.raw);
                        msg = msg.media(tl::types::InputMediaUploadedDocument {
                            nosound_video: false,
                            force_file: true,
                            spoiler,
                            file: uploaded.raw,
                            thumb: thumb_raw,
                            mime_type: content_type.clone(),
                            attributes: vec![(tl::types::DocumentAttributeFilename {
                                file_name: filename.clone(),
                            })
                            .into()],
                            stickers: None,
                            video_cover: None,
                            video_timestamp: None,
                            ttl_seconds: None,
                        });
                    }

                    if let Some(timestamp) = schedule_date {
                        msg = msg.schedule_date(Some(SystemTime::UNIX_EPOCH + Duration::from_secs(timestamp.max(0) as u64)));
                    }
                    client.send_message(peer, msg).await.map_err(|error| map_invocation(&error))?
                };
                Ok(UploadStepResult {
                    status: "done".into(),
                    message_id: Some(sent.id() as i64),
                    error: None,
                    index,
                    backend: Some(format!("grammers_remote_{selected_engine}")),
                })
            })
        })
        .await
    })
}

#[cfg(test)]
mod remote_engine_tests {
    use super::{remote_engine_choice, remote_extension, RemoteUrlReader, REMOTE_CLOUD_FETCH_MAX_BYTES};
    use std::io::Cursor;
    use tokio::io::AsyncReadExt;

    #[test]
    fn auto_uses_cloud_only_for_known_small_objects() {
        assert_eq!(remote_engine_choice("auto", Some(1)), "cloud_fetch");
        assert_eq!(
            remote_engine_choice("auto", Some(REMOTE_CLOUD_FETCH_MAX_BYTES + 1)),
            "storage_local"
        );
        assert_eq!(remote_engine_choice("auto", None), "storage_local");
    }

    #[test]
    fn explicit_mode_is_respected() {
        assert_eq!(remote_engine_choice("cloud_fetch", Some(99)), "cloud_fetch");
        assert_eq!(remote_engine_choice("storage_local", Some(1)), "storage_local");
    }

    #[test]
    fn extension_ignores_query_string_and_falls_back_to_mime() {
        assert_eq!(
            remote_extension("https://video.example/a/file.mp4?token=abc", "application/octet-stream"),
            "mp4"
        );
        assert_eq!(
            remote_extension("https://example.invalid/no-name", "image/jpeg"),
            "jpg"
        );
    }

    #[tokio::test]
    async fn remote_reader_respects_small_readbuf_capacity() {
        let payload = vec![0xA5; 16 * 1024];
        let mut reader = RemoteUrlReader {
            inner: Box::new(Cursor::new(payload.clone())),
        };
        let mut output = Vec::new();
        reader.read_to_end(&mut output).await.unwrap();
        assert_eq!(output, payload);
    }
}

impl<R: AsyncRead + Unpin> AsyncRead for ProgressAsyncReader<R> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let filled_before = buf.filled().len();
        let res = Pin::new(&mut self.inner).poll_read(cx, buf);
        if let Poll::Ready(Ok(())) = &res {
            let newly_read = buf.filled().len() - filled_before;
            if newly_read > 0 {
                let this = &mut *self;
                this.current_bytes += newly_read as u64;

                let elapsed_ms = this.last_emit_time.elapsed().as_millis();
                if elapsed_ms >= 500 || this.current_bytes == this.total_bytes {
                    if let Some(tid) = &this.transfer_id {
                        if crate::core::job_queue::is_transfer_cancelled(tid) {
                            return Poll::Ready(Err(std::io::Error::new(
                                std::io::ErrorKind::Interrupted,
                                "Transfer cancelled by user",
                            )));
                        }
                    }
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
                        .upload_stream(&mut progress_reader, size as usize, filename.clone())
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
                    "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "3gp" | "3gpp" | "ts" | "flv" | "wmv" | "m2ts" | "vob"
                );
                let is_audio = matches!(
                    ext.as_str(),
                    "mp3" | "m4a" | "aac" | "ogg" | "opus" | "flac" | "wav" | "wma"
                );
                let is_photo = is_real_photo(&path_buf, &ext);
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
                            | "tiff"
                            | "tif"
                            | "ico"
                            | "psd"
                            | "raw"
                            | "dng"
                            | "cr2"
                            | "nef"
                            | "arw"
                    );
                let mime = infer_mime_type(&ext, is_image, is_video);
                let path_str = path_buf.to_str().unwrap_or("");

                let mut msg = InputMessage::new()
                    .text(cap.clone())
                    .silent(silent)
                    .reply_to(reply_to);
                // Prefer document for fidelity; video gets thumbnail + video attributes
                // Prefer document for fidelity; video gets thumbnail + video attributes
                msg = if as_document {
                    let mut thumb_raw = None;
                    if is_video || is_image || is_audio {
                        let thumb_path = upload_thumbnail_path(path_str);
                        if let Some(ref tp) = thumb_path {
                            if let Ok(thumb_uploaded) = client.upload_file(tp).await {
                                thumb_raw = Some(thumb_uploaded.raw);
                                tg_log::info(
                                    BACKEND,
                                    "upload_doc_thumb_attached",
                                    format!("index={index} thumb={}", tp.display()),
                                );
                            }
                            let _ = std::fs::remove_file(tp);
                        }
                    }
                    msg.media(tl::types::InputMediaUploadedDocument {
                        nosound_video: false,
                        force_file: true,
                        spoiler: false,
                        file: uploaded.raw,
                        thumb: thumb_raw,
                        mime_type: document_mime_type(&ext, mime, true).to_string(),
                        attributes: vec![(tl::types::DocumentAttributeFilename {
                            file_name: filename.to_string(),
                        })
                        .into()],
                        stickers: None,
                        video_cover: None,
                        video_timestamp: None,
                        ttl_seconds: None,
                    })
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
                    let thumb_path = upload_thumbnail_path(path_str);
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
                    let thumb_path = upload_thumbnail_path(path_str);
                    if let Some(ref tp) = thumb_path {
                        if let Ok(thumb_uploaded) = client.upload_file(tp).await {
                            audio_msg = audio_msg.thumbnail(thumb_uploaded);
                        }
                        let _ = std::fs::remove_file(tp);
                    }
                    audio_msg
                } else {
                    let mut thumb_raw = None;
                    let thumb_path = upload_thumbnail_path(path_str);
                    if let Some(ref tp) = thumb_path {
                        if let Ok(thumb_uploaded) = client.upload_file(tp).await {
                            thumb_raw = Some(thumb_uploaded.raw);
                        }
                        let _ = std::fs::remove_file(tp);
                    }
                    msg.media(tl::types::InputMediaUploadedDocument {
                        nosound_video: false,
                        force_file: true,
                        spoiler: false,
                        file: uploaded.raw,
                        thumb: thumb_raw,
                        mime_type: document_mime_type(&ext, mime, true).to_string(),
                        attributes: vec![(tl::types::DocumentAttributeFilename {
                            file_name: filename.to_string(),
                        })
                        .into()],
                        stickers: None,
                        video_cover: None,
                        video_timestamp: None,
                        ttl_seconds: None,
                    })
                };

                if transfer_id
                    .as_deref()
                    .is_some_and(crate::core::job_queue::is_transfer_cancelled)
                {
                    return Err(TgError::new(
                        TgErrorCode::Cancelled,
                        "transfer cancelled by user",
                    ));
                }
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
                                let deadline = Instant::now()
                                    + Duration::from_secs(secs as u64 + 1);
                                while Instant::now() < deadline {
                                    if transfer_id.as_deref().is_some_and(
                                        crate::core::job_queue::is_transfer_cancelled,
                                    ) {
                                        return Err(TgError::new(
                                            TgErrorCode::Cancelled,
                                            "transfer cancelled by user",
                                        ));
                                    }
                                    let remaining = deadline
                                        .saturating_duration_since(Instant::now());
                                    tokio::time::sleep(remaining.min(Duration::from_millis(100)))
                                        .await;
                                }
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
        topic_id
            .filter(|value| *value > 0)
            .map(|value| value as i32)
    };
    let rt = runtime()?;

    rt.block_on(async {
        with_pool_once(|| {
            let chat = chat.clone();
            let app_handle = app_handle.clone();
            let transfer_id = transfer_id.clone();
            let caption = caption.clone();
            let send_as = send_as.clone();
            let path = path.clone();
            let filename = filename.clone();
            with_client(sessions_dir, identity, true, move |client| {
                let app_handle = app_handle.clone();
                let transfer_id = transfer_id.clone();
                let caption = caption.clone();
                let send_as = send_as.clone();
                let path = path.clone();
                let filename = filename.clone();
                Box::pin(async move {
                if !client
                    .is_authorized()
                    .await
                    .map_err(|error| map_invocation(&error))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
                let _ = send_as;
                let ext = path
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                let is_video = matches!(
                    ext.as_str(),
                    "mp4"
                        | "mov"
                        | "mkv"
                        | "webm"
                        | "avi"
                        | "m4v"
                        | "3gp"
                        | "3gpp"
                        | "ts"
                        | "flv"
                        | "wmv"
                        | "m2ts"
                        | "vob"
                );
                let is_audio = matches!(
                    ext.as_str(),
                    "mp3" | "m4a" | "aac" | "ogg" | "opus" | "flac" | "wav" | "wma"
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
                            | "tiff"
                            | "tif"
                            | "ico"
                            | "psd"
                            | "raw"
                            | "dng"
                            | "cr2"
                            | "nef"
                            | "arw"
                    );
                let mime = infer_mime_type(&ext, is_image, is_video);
                let path_str = path.to_str().unwrap_or("");

                let is_raw_hash_token = caption.contains("~tplv")
                    || caption.contains("photomode")
                    || (caption.len() >= 32
                        && !caption.contains(' ')
                        && caption
                            .chars()
                            .all(|c| c.is_ascii_hexdigit() || c == '-' || c == '_' || c == '~'));

                let display_filename = if filename.starts_with("remote_")
                    || filename.starts_with("reenc_")
                    || filename.starts_with("remux_")
                {
                    if !caption.is_empty()
                        && !caption.contains('\n')
                        && caption.len() <= 60
                        && !is_raw_hash_token
                    {
                        if caption.contains('.') {
                            caption.clone()
                        } else {
                            format!("{caption}.{ext}")
                        }
                    } else if is_video {
                        format!("Media_Stream.{ext}")
                    } else if is_audio {
                        format!("Audio_Track.{ext}")
                    } else if is_image {
                        format!("Photo.{ext}")
                    } else {
                        format!("Document.{ext}")
                    }
                } else {
                    filename.clone()
                };

                let uploaded = if let Ok(file) = tokio::fs::File::open(&path).await {
                    let mut reader = ProgressAsyncReader {
                        inner: file,
                        stage: "upload".into(),
                        total_bytes: size,
                        current_bytes: 0,
                        last_emit_time: Instant::now(),
                        last_emit_bytes: 0,
                        app_handle: app_handle.clone(),
                        item_index: index,
                        transfer_id: transfer_id.clone(),
                    };
                    client
                        .upload_stream(&mut reader, size as usize, display_filename.clone())
                        .await
                        .map_err(|error| {
                            TgError::new(TgErrorCode::Io, format!("upload_stream: {error}"))
                        })?
                } else {
                    client.upload_file(&path).await.map_err(|error| {
                        TgError::new(TgErrorCode::Io, format!("upload_file: {error}"))
                    })?
                };
                let effective_text = if is_raw_hash_token {
                    String::new()
                } else {
                    caption.clone()
                };
                let mut msg = InputMessage::new().text(effective_text).silent(silent);
                if let Some(r) = reply_to {
                    msg = msg.reply_to(Some(r));
                }

                msg = if as_document {
                    let thumb_raw = if is_video || is_image || is_audio {
                        upload_thumbnail(client, path_str)
                            .await
                            .map(|uploaded| uploaded.raw)
                    } else {
                        None
                    };
                    msg.media(tl::types::InputMediaUploadedDocument {
                        nosound_video: false,
                        force_file: true,
                        spoiler,
                        file: uploaded.raw,
                        thumb: thumb_raw,
                        mime_type: document_mime_type(&ext, mime, true).to_string(),
                        attributes: vec![(tl::types::DocumentAttributeFilename {
                            file_name: display_filename.clone(),
                        })
                        .into()],
                        stickers: None,
                        video_cover: None,
                        video_timestamp: None,
                        ttl_seconds: None,
                    })
                } else if is_photo {
                    msg.photo(uploaded)
                } else if is_video {
                    let (mut vid_w, mut vid_h, mut vid_dur) = probe_video_metadata(path_str);
                    if vid_w == 0 || vid_h == 0 {
                        vid_w = 720;
                        vid_h = 1280;
                    }
                    if vid_dur <= 0.0 {
                        vid_dur = 10.0;
                    }
                    let mut video_msg = msg.mime_type("video/mp4").document(uploaded);
                    video_msg = video_msg.attribute(Attribute::Video {
                        round_message: false,
                        supports_streaming: true,
                        duration: std::time::Duration::from_secs_f64(vid_dur),
                        w: vid_w as i32,
                        h: vid_h as i32,
                    });
                    if let Some(thumb_uploaded) = upload_thumbnail(client, path_str).await {
                        video_msg = video_msg.thumbnail(thumb_uploaded);
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
                    if let Some(thumb_uploaded) = upload_thumbnail(client, path_str).await {
                        audio_msg = audio_msg.thumbnail(thumb_uploaded);
                    }
                    audio_msg
                } else {
                    let thumb_raw = if is_video || is_image || is_audio {
                        upload_thumbnail(client, path_str)
                            .await
                            .map(|uploaded| uploaded.raw)
                    } else {
                        None
                    };
                    msg.media(tl::types::InputMediaUploadedDocument {
                        nosound_video: false,
                        force_file: true,
                        spoiler,
                        file: uploaded.raw,
                        thumb: thumb_raw,
                        mime_type: document_mime_type(&ext, mime, true).to_string(),
                        attributes: vec![(tl::types::DocumentAttributeFilename {
                            file_name: display_filename.clone(),
                        })
                        .into()],
                        stickers: None,
                        video_cover: None,
                        video_timestamp: None,
                        ttl_seconds: None,
                    })
                };

                if let Some(app) = app_handle.as_ref() {
                    use tauri::Emitter;
                    let _ = app.emit(
                        "transfer-event",
                        serde_json::json!({
                            "type": "StudioItemPhase",
                            "index": index,
                            "phase": "committing",
                            "transfer_id": transfer_id
                        }),
                    );
                }

                if transfer_id
                    .as_deref()
                    .is_some_and(crate::core::job_queue::is_transfer_cancelled)
                {
                    return Err(TgError::new(
                        TgErrorCode::Cancelled,
                        "transfer cancelled by user",
                    ));
                }
                let sent = match client.send_message(peer, msg).await {
                    Ok(m) => Ok(m.id() as i64),
                    Err(error) => {
                        let mapped = map_invocation(&error);
                        if let Some(recovered) = try_recover_single_file_from_history(
                            client, peer, &chat, topic_id, &caption, index,
                        )
                        .await
                        {
                            return Ok(recovered);
                        }
                        Err(mapped)
                    }
                };

                let mid = match sent {
                    Ok(id) => Some(id),
                    Err(err) => return Err(err),
                };

                Ok(UploadStepResult {
                    status: if mid.is_some() { "done" } else { "failed" }.into(),
                    message_id: mid,
                    error: None,
                    index,
                    backend: Some(BACKEND.into()),
                })
            })
        })
        })
        .await
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_webp_document_uses_neutral_mime_to_avoid_sticker_coercion() {
        assert_eq!(
            document_mime_type("webp", "image/webp", true),
            "application/octet-stream"
        );
        assert_eq!(
            document_mime_type("webp", "image/webp", false),
            "image/webp"
        );
    }

    #[test]
    fn ordinary_document_mime_is_preserved() {
        assert_eq!(document_mime_type("heic", "image/heic", true), "image/heic");
    }

    #[test]
    fn visual_upload_gracefully_handles_missing_thumbnail() {
        let missing = "Z:/autogram-test/nonexistent-visual.webp";
        assert!(upload_thumbnail_path(missing).is_none());
    }
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
