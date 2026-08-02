//! Submodule extracted from grammers_ops.rs

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::task::{Context, Poll};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncRead, ReadBuf};

use grammers_client::client::PasswordToken;
use grammers_client::media::{Attribute, InputMedia};
use grammers_client::message::InputMessage;
use grammers_client::{Client, SignInError};
use grammers_mtsender::SenderPool;
use grammers_session::storages::MemorySession;
use grammers_session::SessionData;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::runtime::Runtime;

use crate::core::media_prep::{extract_video_thumbnail, probe_video_metadata};
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
/// `index_base` offsets result indices when chunking larger albums.
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
    for (p, _) in files {
        path_policy::assert_safe_transfer_path(p)
            .map_err(|e| TgError::new(TgErrorCode::PathRejected, e))?;
        if !PathBuf::from(p).is_file() {
            return Err(TgError::new(
                TgErrorCode::Io,
                format!("file not found: {p}"),
            ));
        }
    }
    let rt = runtime()?;
    let chat = chat_id.to_string();
    let items: Vec<(PathBuf, String)> = files
        .iter()
        .map(|(p, c)| (PathBuf::from(p), c.clone()))
        .collect();
    let reply_to = topic_id.filter(|t| *t > 0).map(|t| t as i32);

    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client
                    .is_authorized()
                    .await
                    .map_err(|e| map_invocation(&e))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
                let mut medias = Vec::with_capacity(items.len());
                for (i, (path_buf, cap)) in items.iter().enumerate() {
                    let uploaded = client
                        .upload_file(path_buf)
                        .await
                        .map_err(|e| TgError::new(TgErrorCode::Io, format!("upload_file: {e}")))?;
                    let ext = path_buf
                        .extension()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    let is_video = matches!(
                        ext.as_str(),
                        "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "3gp" | "ts"
                    );
                    let mut im =
                        InputMedia::new().caption(if i == 0 { cap.clone() } else { String::new() });
                    // Forum topic: only first media carries reply_to
                    if i == 0 {
                        im = im.reply_to(reply_to);
                    }
                    im = if as_document {
                        im.document(uploaded)
                    } else if matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp") {
                        im.photo(uploaded)
                    } else if is_video {
                        // Video: send as document with thumbnail + video attributes for Telegram preview
                        let path_str = path_buf.to_str().unwrap_or("");
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
                    } else {
                        im.document(uploaded)
                    };
                    let _ = silent;
                    medias.push(im);
                    tg_log::info(
                        BACKEND,
                        "album_upload_part",
                        format!(
                            "i={} file={}",
                            index_base + i,
                            path_buf.file_name().and_then(|s| s.to_str()).unwrap_or("?")
                        ),
                    );
                }
                let sent = client
                    .send_album(peer, medias)
                    .await
                    .map_err(|e| map_invocation(&e))?;
                let mut out = Vec::new();
                for (i, msg) in sent.into_iter().enumerate() {
                    let mid = msg.as_ref().map(|m| m.id() as i64);
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
                        index: index_base + i,
                        backend: Some(BACKEND.into()),
                    });
                }
                tg_log::info(
                    BACKEND,
                    "album_ok",
                    format!("n={} chat={chat} base={index_base}", out.len()),
                );
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
                if elapsed_ms >= 150 || this.current_bytes == this.total_bytes {
                    let elapsed_sec = (elapsed_ms as f64 / 1000.0).max(0.001);
                    let delta_bytes = this.current_bytes.saturating_sub(this.last_emit_bytes);
                    let inst_speed = delta_bytes as f64 / elapsed_sec;

                    this.last_emit_time = Instant::now();
                    this.last_emit_bytes = this.current_bytes;

                    let pct = if this.total_bytes > 0 {
                        (this.current_bytes as f64 / this.total_bytes as f64 * 100.0).clamp(0.0, 100.0)
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
                        let _ = app.emit("transfer-progress", serde_json::json!({
                            "jobId": format!("item-{}", this.item_index),
                            "stage": &this.stage,
                            "currentBytes": this.current_bytes,
                            "totalBytes": this.total_bytes,
                            "speed": inst_speed,
                            "percentage": pct,
                            "eta": eta
                        }));
                        let _ = app.emit("transfer-event", serde_json::json!({
                            "type": "StudioProgress",
                            "index": this.item_index,
                            "percent": pct,
                            "transferred": this.current_bytes,
                            "total": this.total_bytes,
                            "speed_mb_s": inst_speed / (1024.0 * 1024.0),
                            "eta_seconds": eta,
                            "phase": "upload"
                        }));
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
                    "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "3gp" | "ts"
                );

                let mut msg = InputMessage::new()
                    .text(cap)
                    .silent(silent)
                    .reply_to(reply_to);
                // Prefer document for fidelity; video gets thumbnail + video attributes
                msg = if as_document {
                    msg.document(uploaded)
                } else if matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp") {
                    msg.photo(uploaded)
                } else if is_video {
                    // Video: send as document with thumbnail + video attributes for Telegram preview
                    let path_str = path_buf.to_str().unwrap_or("");
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
                } else {
                    msg.document(uploaded)
                };

                let sent = match client.send_message(peer, msg).await {
                    Ok(m) => m,
                    Err(e) => {
                        let mapped = map_invocation(&e);
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
}

/// Download media of a single message into `dest_path` (parent dirs created).
/// Caps at ~200MB to avoid hanging UI on multi-GB files (those stay on Telethon progressive stream).
pub fn download_file_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    message_id: i64,
    dest_path: &str,
) -> Result<DownloadFileResult, TgError> {
    if message_id <= 0 {
        return Err(TgError::new(TgErrorCode::Internal, "message_id required"));
    }
    path_policy::assert_safe_transfer_path(dest_path)
        .map_err(|e| TgError::new(TgErrorCode::PathRejected, e))?;
    let dest = PathBuf::from(dest_path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| TgError::new(TgErrorCode::Io, format!("create dest dir: {e}")))?;
    }
    let rt = runtime()?;
    let chat = chat_id.to_string();
    let mid = message_id as i32;

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
                let media = msg.media().ok_or_else(|| {
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
                            "file too large for full Grammers download ({size} bytes); use progressive stream"
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
                    format!("chat={chat} mid={message_id} size={size}"),
                );
                client
                    .download_media(&media, &dest)
                    .await
                    .map_err(|e| {
                        TgError::new(TgErrorCode::Io, format!("download_media: {e}"))
                    })?;
                let final_size = std::fs::metadata(&dest)
                    .map(|m| m.len())
                    .unwrap_or(size);
                tg_log::info(
                    BACKEND,
                    "download_ok",
                    format!("mid={message_id} bytes={final_size}"),
                );
                Ok(DownloadFileResult {
                    status: "done".into(),
                    path: dest.display().to_string(),
                    message_id,
                    size: final_size,
                    name,
                    mime_type: mime,
                    backend: BACKEND.into(),
                })
            })
        })
        .await
    })
}
