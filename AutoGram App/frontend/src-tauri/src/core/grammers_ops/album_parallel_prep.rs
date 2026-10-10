//! Parallel per-item byte upload and `messages.UploadMedia` registration for visual albums.
//!
//! Extracted from `media_transfer.rs` to comply with Rule 17 (< 2,000 lines) while
//! preserving 100% of Telegram visual album collage invariants:
//! - Deterministic item ordering (`0..items.len()`)
//! - FastStart MP4/MOV remuxing and temporary file cleanup via RAII drop guards
//! - Per-item resilient chunk upload with real-time `StudioProgress` emission
//! - Concurrent `messages.UploadMedia` pre-registration with FloodWait/Timeout retry

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use grammers_client::media::{Attribute, Media};
use grammers_client::{tl, Client};
use grammers_session::types::PeerRef;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::core::media_prep::{ensure_faststart_video, probe_audio_metadata, probe_video_metadata};
use crate::core::tg_error::{map_invocation, TgError, TgErrorCode};
use crate::core::tg_log;

use super::media_transfer::{
    document_mime_type, infer_mime_type, is_real_photo, safe_remove_temp_thumbnail,
    upload_thumbnail_path, AlbumUploadFile,
};

const BACKEND: &str = "grammers";

/// RAII guard that removes a temporary file on drop (including task abort/cancellation).
struct TempFileGuard {
    path: Option<PathBuf>,
    is_thumbnail: bool,
}

impl TempFileGuard {
    fn faststart(path: PathBuf, active: bool) -> Self {
        Self {
            path: if active { Some(path) } else { None },
            is_thumbnail: false,
        }
    }

    fn thumbnail(path: PathBuf) -> Self {
        Self {
            path: Some(path),
            is_thumbnail: true,
        }
    }
}

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        if let Some(ref p) = self.path {
            if self.is_thumbnail {
                safe_remove_temp_thumbnail(p);
            } else {
                let _ = std::fs::remove_file(p);
            }
        }
    }
}

/// Resolves the concurrency ceiling for parallel album item uploads.
/// Setting Upload Concurrency to `1` in Transfer Settings acts as a strict sequential kill-switch.
pub(super) fn album_parallel_limit() -> usize {
    let configured = crate::core::traffic_governor::snapshot()
        .upload
        .configured_ceiling;
    compute_parallel_limit(configured)
}

pub(super) fn compute_parallel_limit(configured_ceiling: u32) -> usize {
    if configured_ceiling <= 1 {
        1
    } else {
        (configured_ceiling as usize).max(6).min(10)
    }
}

async fn prepare_one_album_item(
    client: Client,
    position: usize,
    item: AlbumUploadFile,
    as_document: bool,
    transfer_id: Option<String>,
    app_handle: Option<tauri::AppHandle>,
) -> Result<(usize, tl::enums::InputMedia), TgError> {
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

    let (effective_upload_path, is_temp_faststart) = if !as_document && is_video {
        let p = path.clone();
        tokio::task::spawn_blocking(move || ensure_faststart_video(&p))
            .await
            .unwrap_or_else(|_| (path.clone(), false))
    } else {
        (path.clone(), false)
    };
    let _faststart_guard =
        TempFileGuard::faststart(effective_upload_path.clone(), is_temp_faststart);

    let uploaded = super::uploader::upload_file_resilient(
        &client,
        &effective_upload_path,
        filename.clone(),
        "upload",
        item.index,
        transfer_id.as_deref(),
        app_handle.as_ref(),
    )
    .await?;

    drop(_faststart_guard);

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

    let raw_media = if !as_document && is_photo {
        tl::enums::InputMedia::UploadedPhoto(tl::types::InputMediaUploadedPhoto {
            file: uploaded.raw,
            stickers: None,
            ttl_seconds: None,
            live_photo: false,
            video: None,
            spoiler: item.spoiler,
        })
    } else if !as_document && is_video {
        let (width, height, duration) = probe_video_metadata(path_str);
        let safe_w = if width > 0 { width as i32 } else { 1280 };
        let safe_h = if height > 0 { height as i32 } else { 720 };
        let safe_dur = if duration > 0.0 { duration } else { 1.0 };
        let thumb_path = upload_thumbnail_path(path_str);
        let mut thumb_raw = None;
        if let Some(tp) = thumb_path {
            let _thumb_guard = TempFileGuard::thumbnail(tp.clone());
            if let Ok(thumb_uploaded) = client.upload_file(&tp).await {
                thumb_raw = Some(thumb_uploaded.raw);
            }
        }
        let is_nosound = {
            let analysis =
                crate::core::autogram_core::transfer::analyze_media(Path::new(path_str));
            analysis.probe_available && analysis.audio_codecs().is_empty()
        };
        tl::enums::InputMedia::UploadedDocument(tl::types::InputMediaUploadedDocument {
            nosound_video: is_nosound,
            force_file: false,
            spoiler: item.spoiler,
            file: uploaded.raw,
            thumb: thumb_raw,
            mime_type: "video/mp4".to_string(),
            attributes: vec![Attribute::Video {
                round_message: false,
                supports_streaming: true,
                duration: Duration::from_secs_f64(safe_dur),
                w: safe_w,
                h: safe_h,
            }
            .into()],
            stickers: None,
            video_cover: None,
            video_timestamp: None,
            ttl_seconds: None,
        })
    } else if !as_document && is_audio {
        let (duration, title, artist) = probe_audio_metadata(path_str);
        tl::enums::InputMedia::UploadedDocument(tl::types::InputMediaUploadedDocument {
            nosound_video: false,
            force_file: false,
            spoiler: item.spoiler,
            file: uploaded.raw,
            thumb: None,
            mime_type: mime.to_string(),
            attributes: vec![Attribute::Audio {
                duration: Duration::from_secs_f64(duration.max(0.0)),
                title,
                performer: artist,
            }
            .into()],
            stickers: None,
            video_cover: None,
            video_timestamp: None,
            ttl_seconds: None,
        })
    } else {
        let mut thumb_raw = None;
        let thumb_path = upload_thumbnail_path(path_str);
        if let Some(tp) = thumb_path {
            let _thumb_guard = TempFileGuard::thumbnail(tp.clone());
            if let Ok(thumb_uploaded) = client.upload_file(&tp).await {
                thumb_raw = Some(thumb_uploaded.raw);
            }
        }
        tl::enums::InputMedia::UploadedDocument(tl::types::InputMediaUploadedDocument {
            nosound_video: false,
            force_file: true,
            spoiler: item.spoiler,
            file: uploaded.raw,
            thumb: thumb_raw,
            mime_type: document_mime_type(&ext, mime, as_document).to_string(),
            attributes: vec![Attribute::FileName(filename.clone()).into()],
            stickers: None,
            video_cover: None,
            video_timestamp: None,
            ttl_seconds: None,
        })
    };

    tg_log::info(
        BACKEND,
        "album_upload_part",
        format!(
            "index={} pos={} file={filename} spoiler={}",
            item.index, position, item.spoiler
        ),
    );

    Ok((position, raw_media))
}

/// Uploads all items in an album chunk concurrently (bounded by `parallel_limit`)
/// and returns their `InputMedia` handles ordered strictly by `0..items.len()`.
pub(super) async fn prepare_album_items_parallel(
    client: &Client,
    items: &[AlbumUploadFile],
    as_document: bool,
    transfer_id: Option<String>,
    app_handle: Option<tauri::AppHandle>,
    parallel_limit: usize,
) -> Result<Vec<tl::enums::InputMedia>, TgError> {
    let sem = Arc::new(Semaphore::new(parallel_limit.clamp(1, 10)));
    let mut join_set = JoinSet::new();

    for (position, item) in items.iter().cloned().enumerate() {
        let sem = Arc::clone(&sem);
        let client = client.clone();
        let tid = transfer_id.clone();
        let app = app_handle.clone();
        join_set.spawn(async move {
            let _permit = sem.acquire_owned().await.map_err(|_| {
                TgError::new(TgErrorCode::Internal, "album upload semaphore closed")
            })?;
            prepare_one_album_item(client, position, item, as_document, tid, app).await
        });
    }

    let mut ordered_map: BTreeMap<usize, tl::enums::InputMedia> = BTreeMap::new();
    while let Some(res) = join_set.join_next().await {
        match res {
            Ok(Ok((pos, media))) => {
                ordered_map.insert(pos, media);
            }
            Ok(Err(err)) => {
                join_set.abort_all();
                return Err(err);
            }
            Err(join_err) => {
                join_set.abort_all();
                return Err(TgError::new(
                    TgErrorCode::Internal,
                    format!("album item worker task aborted: {join_err}"),
                ));
            }
        }
    }

    let mut out = Vec::with_capacity(items.len());
    for pos in 0..items.len() {
        let media = ordered_map.remove(&pos).ok_or_else(|| {
            TgError::new(
                TgErrorCode::Internal,
                format!("missing prepared album item at position {pos}"),
            )
        })?;
        out.push(media);
    }
    Ok(out)
}

async fn register_one_album_media(
    client: Client,
    peer: PeerRef,
    position: usize,
    raw_media: tl::enums::InputMedia,
    transfer_id: Option<String>,
) -> Result<(usize, tl::enums::InputMedia), TgError> {
    let server_input_media = match raw_media {
        tl::enums::InputMedia::UploadedPhoto(_)
        | tl::enums::InputMedia::PhotoExternal(_)
        | tl::enums::InputMedia::UploadedDocument(_)
        | tl::enums::InputMedia::DocumentExternal(_) => {
            let mut upload_media_attempts = 0;
            let mut last_err = None;
            let mut converted_media = None;

            while upload_media_attempts < 3 {
                if let Some(tid) = transfer_id.as_deref() {
                    if crate::core::job_queue::is_transfer_cancelled(tid) {
                        return Err(TgError::new(
                            TgErrorCode::Cancelled,
                            "transfer cancelled by user",
                        ));
                    }
                }
                upload_media_attempts += 1;
                match client
                    .invoke(&tl::functions::messages::UploadMedia {
                        business_connection_id: None,
                        peer: peer.into(),
                        media: raw_media.clone(),
                    })
                    .await
                {
                    Ok(uploaded) => {
                        if let Some(m) =
                            Media::from_raw(uploaded).and_then(|m| m.to_raw_input_media())
                        {
                            converted_media = Some(m);
                            break;
                        } else {
                            last_err = Some(TgError::new(
                                TgErrorCode::Internal,
                                "failed to convert uploaded media to InputMedia",
                            ));
                            break;
                        }
                    }
                    Err(e) => {
                        let mapped = map_invocation(&e);
                        match mapped.code() {
                            TgErrorCode::FloodWait => {
                                let wait = mapped.flood_wait_secs().unwrap_or(5);
                                tg_log::warn(
                                    BACKEND,
                                    "upload_media_flood_wait",
                                    format!(
                                        "UploadMedia rate limited at pos={position}, waiting {wait}s..."
                                    ),
                                );
                                tokio::time::sleep(Duration::from_secs(wait.min(60) as u64)).await;
                            }
                            TgErrorCode::Timeout | TgErrorCode::Network | TgErrorCode::Io => {
                                tg_log::warn(
                                    BACKEND,
                                    "upload_media_timeout_retry",
                                    format!(
                                        "UploadMedia server timeout at pos={position} on attempt {upload_media_attempts}, retrying in 3s..."
                                    ),
                                );
                                tokio::time::sleep(Duration::from_secs(3)).await;
                            }
                            _ => {
                                last_err = Some(mapped);
                                break;
                            }
                        }
                        last_err = Some(mapped);
                    }
                }
            }

            converted_media.ok_or_else(|| {
                last_err.unwrap_or_else(|| {
                    TgError::new(
                        TgErrorCode::Internal,
                        "failed to register media on Telegram server",
                    )
                })
            })?
        }
        other => other,
    };

    Ok((position, server_input_media))
}

/// Pre-registers each uploaded media handle via `messages.UploadMedia` concurrently
/// so `SendMultiMedia` receives ready server-side `InputPhoto` / `InputDocument` objects.
pub(super) async fn register_album_media_parallel(
    client: &Client,
    peer: PeerRef,
    raw_medias: Vec<tl::enums::InputMedia>,
    transfer_id: Option<String>,
    parallel_limit: usize,
) -> Result<Vec<tl::enums::InputMedia>, TgError> {
    let total = raw_medias.len();
    let sem = Arc::new(Semaphore::new(parallel_limit.clamp(1, 10)));
    let mut join_set = JoinSet::new();

    for (position, raw_media) in raw_medias.into_iter().enumerate() {
        let sem = Arc::clone(&sem);
        let client = client.clone();
        let tid = transfer_id.clone();
        join_set.spawn(async move {
            let _permit = sem.acquire_owned().await.map_err(|_| {
                TgError::new(TgErrorCode::Internal, "album registration semaphore closed")
            })?;
            register_one_album_media(client, peer, position, raw_media, tid).await
        });
    }

    let mut ordered_map: BTreeMap<usize, tl::enums::InputMedia> = BTreeMap::new();
    while let Some(res) = join_set.join_next().await {
        match res {
            Ok(Ok((pos, server_media))) => {
                ordered_map.insert(pos, server_media);
            }
            Ok(Err(err)) => {
                join_set.abort_all();
                return Err(err);
            }
            Err(join_err) => {
                join_set.abort_all();
                return Err(TgError::new(
                    TgErrorCode::Internal,
                    format!("album registration worker task aborted: {join_err}"),
                ));
            }
        }
    }

    let mut out = Vec::with_capacity(total);
    for pos in 0..total {
        let media = ordered_map.remove(&pos).ok_or_else(|| {
            TgError::new(
                TgErrorCode::Internal,
                format!("missing registered server media at position {pos}"),
            )
        })?;
        out.push(media);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parallel_limit_respects_kill_switch_and_bounds() {
        assert_eq!(compute_parallel_limit(0), 1);
        assert_eq!(compute_parallel_limit(1), 1);
        assert_eq!(compute_parallel_limit(4), 6);
        assert_eq!(compute_parallel_limit(8), 8);
        assert_eq!(compute_parallel_limit(16), 10);
    }
}
