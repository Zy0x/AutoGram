//! Submodule extracted from grammers_ops.rs

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use grammers_client::client::PasswordToken;
use grammers_client::message::InputMessage;
use grammers_client::{Client, SignInError};
use grammers_mtsender::SenderPool;
use grammers_session::storages::MemorySession;
use grammers_session::SessionData;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::runtime::Runtime;

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
use super::media_transfer::*;
use super::peer_resolver::*;
use super::session_auth::*;

/// Drive-compatible media row (subset of frontend DriveFile).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFileRow {
    pub id: i64,
    pub folder_id: Option<i64>,
    pub name: String,
    pub size: u64,
    pub mime_type: Option<String>,
    pub icon_type: String,
    pub created_at: Option<String>,
    pub has_thumb: bool,
    pub as_document: bool,
    pub backend: String,
    /// Inline stripped thumb (data:image/…) — paints grid without a second RPC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumb_data_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub topic_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peer_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peer_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peer_username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grouped_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_saved_messages: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub telegram_category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub telegram_subtype: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drive_category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drive_format: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchScope {
    pub account_id: String,
    pub peer_id: String,
    pub topic_id: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneCursor {
    #[serde(alias = "offset_id")]
    pub fetch_offset_id: i32,
    pub exhausted: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneWatermark {
    pub photo_video: i32,
    pub document: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SearchLane {
    PhotoVideo,
    Document,
    Both,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedMediaRow {
    pub row: MediaFileRow,
    pub lane: SearchLane,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopedMediaSearchCursor {
    pub scope: SearchScope,
    pub photo_video: LaneCursor,
    pub document: LaneCursor,
    #[serde(default)]
    pub pending_photo_video: Vec<MediaFileRow>,
    #[serde(default)]
    pub pending_document: Vec<MediaFileRow>,
}

pub fn normalize_search_cursor(
    incoming: Option<ScopedMediaSearchCursor>,
    scope: &SearchScope,
    initial_offset: i32,
) -> ScopedMediaSearchCursor {
    match incoming {
        Some(c) if c.scope == *scope => c,
        _ => ScopedMediaSearchCursor {
            scope: scope.clone(),
            photo_video: LaneCursor {
                fetch_offset_id: initial_offset,
                exhausted: false,
            },
            document: LaneCursor {
                fetch_offset_id: initial_offset,
                exhausted: false,
            },
            pending_photo_video: Vec::new(),
            pending_document: Vec::new(),
        },
    }
}

/// Merges two descending streams of `MediaFileRow` (pending_photo_video and pending_document),
/// extracts up to `limit` unique items descending by `message_id`, inherently pops matching
/// duplicates from both lane heads simultaneously to guarantee zero duplicate across page boundaries,
/// and retains any surplus items in their respective pending buffers without losing any data.
pub fn buffered_k_way_merge(
    pending_pv: &mut Vec<MediaFileRow>,
    pending_doc: &mut Vec<MediaFileRow>,
    limit: usize,
) -> Vec<MergedMediaRow> {
    let mut emitted = Vec::with_capacity(limit);

    // Keep pending buffers sorted descending by id
    pending_pv.sort_by(|a, b| b.id.cmp(&a.id));
    pending_doc.sort_by(|a, b| b.id.cmp(&a.id));

    while emitted.len() < limit && (!pending_pv.is_empty() || !pending_doc.is_empty()) {
        match (pending_pv.first(), pending_doc.first()) {
            (Some(pv), Some(doc)) if pv.id == doc.id => {
                // Inherent dual-lane pop: consume both heads at once so identical ID is NEVER
                // retained in the secondary buffer across page boundaries!
                let pv_row = pending_pv.remove(0);
                let _doc_row = pending_doc.remove(0);
                emitted.push(MergedMediaRow {
                    row: pv_row,
                    lane: SearchLane::Both,
                });
            }
            (Some(pv), Some(doc)) if pv.id > doc.id => {
                let pv_row = pending_pv.remove(0);
                emitted.push(MergedMediaRow {
                    row: pv_row,
                    lane: SearchLane::PhotoVideo,
                });
            }
            (Some(_), Some(_)) => {
                let doc_row = pending_doc.remove(0);
                emitted.push(MergedMediaRow {
                    row: doc_row,
                    lane: SearchLane::Document,
                });
            }
            (Some(_), None) => {
                let pv_row = pending_pv.remove(0);
                emitted.push(MergedMediaRow {
                    row: pv_row,
                    lane: SearchLane::PhotoVideo,
                });
            }
            (None, Some(_)) => {
                let doc_row = pending_doc.remove(0);
                emitted.push(MergedMediaRow {
                    row: doc_row,
                    lane: SearchLane::Document,
                });
            }
            (None, None) => break,
        }
    }

    emitted
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneCounts {
    pub photo_video: Option<usize>,
    pub document: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMediaResult {
    pub status: String,
    pub folder_id: Option<i64>,
    pub files: Vec<MediaFileRow>,
    pub total: usize,
    pub page_size: usize,
    pub has_more: bool,
    pub next_offset_id: Option<i64>,
    pub search_cursor: Option<ScopedMediaSearchCursor>,
    pub lane_counts: Option<LaneCounts>,
    pub emitted_watermark: Option<LaneWatermark>,
    pub total_count: Option<usize>,
    pub backend: String,
    pub cached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderChunkPayload {
    pub request_id: String,
    pub folder_id: Option<i64>,
    pub topic_id: Option<i64>,
    pub files: Vec<MediaFileRow>,
    pub next_offset_id: Option<i64>,
    pub has_more: bool,
    pub is_initial_chunk: bool,
    pub total_count: Option<usize>,
}

pub fn media_to_row(
    msg: &grammers_client::message::Message,
    folder_id: Option<i64>,
) -> Option<MediaFileRow> {
    use grammers_client::media::Media;
    let id = msg.id() as i64;
    let created = Some(msg.date().to_rfc3339());
    let caption = msg.text().trim();
    let Some(media) = msg.media() else {
        return None;
    };

    let mut size = media.size().unwrap_or(0) as u64;
    if size == 0 {
        if let Media::Photo(ref p) = media {
            size = p
                .thumbs()
                .iter()
                .map(|s| s.size() as u64)
                .max()
                .unwrap_or(0);
        }
    }
    let thumb_data_url = crate::core::grammers_media::stripped_thumb_data_url(&media);
    let has_thumb = thumb_data_url.is_some()
        || match &media {
            Media::Photo(_) => true,
            Media::Document(d) => {
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
                !d.thumbs().is_empty() || is_video
            }
            Media::Sticker(s) => !s.document.thumbs().is_empty(),
            _ => false,
        };
    match media {
        Media::Photo(_p) => {
            let name = if !caption.is_empty() {
                format!("{caption}.jpg")
            } else {
                format!("photo_{id}.jpg")
            };
            let cls = crate::core::media_classifier::classify_media_item(
                &name,
                Some("image/jpeg"),
                false,
                true,
                false,
            );
            let row = MediaFileRow {
                id,
                folder_id,
                name,
                size,
                mime_type: Some("image/jpeg".into()),
                icon_type: "image".into(),
                created_at: created,
                has_thumb,
                as_document: false,
                backend: BACKEND.into(),
                thumb_data_url,
                topic_id: message_topic_id(msg),
                identity_source: Some("telegram_search".into()),
                peer_id: folder_id
                    .map(|fid| {
                        if fid == 0 {
                            "me".into()
                        } else {
                            fid.to_string()
                        }
                    })
                    .or_else(|| Some("me".into())),
                account_id: None,
                peer_kind: None,
                peer_username: None,
                grouped_id: msg.grouped_id(),
                is_saved_messages: Some(folder_id.map_or(true, |fid| fid == 0)),
                telegram_category: Some(cls.telegram_category),
                telegram_subtype: Some(cls.telegram_subtype),
                drive_category: Some(cls.drive_category),
                drive_format: Some(cls.drive_format),
            };
            crate::core::tg_log::info(
                BACKEND,
                "media_row_created",
                format!("op=media_row_created identity_source=telegram_search peer_id={} telegram_message_id={} topic_id={:?} media_kind=image has_media_metadata=true", folder_id.unwrap_or(0), id, message_topic_id(msg)),
            );
            Some(row)
        }
        Media::Document(doc) => {
            let n = doc
                .name()
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    if !caption.is_empty() {
                        Some(caption.to_string())
                    } else {
                        None
                    }
                })
                .unwrap_or_else(|| format!("file_{id}"));
            let mime = doc.mime_type().map(|s| s.to_string());
            let mime_l = mime.as_deref().unwrap_or("").to_ascii_lowercase();
            let name_l = n.to_ascii_lowercase();

            let is_video_file = mime_l.starts_with("video/")
                || name_l.ends_with(".mp4")
                || name_l.ends_with(".mov")
                || name_l.ends_with(".mkv")
                || name_l.ends_with(".webm")
                || name_l.ends_with(".avi")
                || name_l.ends_with(".m4v")
                || name_l.ends_with(".3gp")
                || name_l.ends_with(".flv")
                || name_l.ends_with(".wmv")
                || name_l.ends_with(".ts")
                || name_l.ends_with(".m2ts")
                || name_l.ends_with(".vob")
                || name_l.ends_with(".ogv");

            let is_image_file = mime_l.starts_with("image/")
                || name_l.ends_with(".jpg")
                || name_l.ends_with(".jpeg")
                || name_l.ends_with(".png")
                || name_l.ends_with(".webp")
                || name_l.ends_with(".gif")
                || name_l.ends_with(".bmp")
                || name_l.ends_with(".tiff");

            let is_audio_file = mime_l.starts_with("audio/")
                || name_l.ends_with(".mp3")
                || name_l.ends_with(".wav")
                || name_l.ends_with(".flac")
                || name_l.ends_with(".m4a")
                || name_l.ends_with(".aac")
                || name_l.ends_with(".ogg")
                || name_l.ends_with(".opus");

            let icon = if is_video_file {
                "video"
            } else if is_audio_file {
                "audio"
            } else if is_image_file {
                "image"
            } else {
                "document"
            };

            let final_mime = if mime.is_none() || mime_l == "application/octet-stream" {
                if is_video_file {
                    Some("video/mp4".to_string())
                } else if is_image_file {
                    Some("image/jpeg".to_string())
                } else if is_audio_file {
                    Some("audio/mpeg".to_string())
                } else {
                    mime
                }
            } else {
                mime
            };

            let doc_has_thumb = has_thumb || !doc.thumbs().is_empty();
            let cls = crate::core::media_classifier::classify_media_item(
                &n,
                final_mime.as_deref(),
                true,
                false,
                false,
            );

            let row = MediaFileRow {
                id,
                folder_id,
                name: n,
                size,
                mime_type: final_mime,
                icon_type: icon.into(),
                created_at: created,
                has_thumb: doc_has_thumb,
                as_document: true,
                backend: BACKEND.into(),
                thumb_data_url,
                topic_id: message_topic_id(msg),
                identity_source: Some("telegram_search".into()),
                peer_id: folder_id
                    .map(|fid| {
                        if fid == 0 {
                            "me".into()
                        } else {
                            fid.to_string()
                        }
                    })
                    .or_else(|| Some("me".into())),
                account_id: None,
                peer_kind: None,
                peer_username: None,
                grouped_id: msg.grouped_id(),
                is_saved_messages: Some(folder_id.map_or(true, |fid| fid == 0)),
                telegram_category: Some(cls.telegram_category),
                telegram_subtype: Some(cls.telegram_subtype),
                drive_category: Some(cls.drive_category),
                drive_format: Some(cls.drive_format),
            };
            crate::core::tg_log::info(
                BACKEND,
                "media_row_created",
                format!("op=media_row_created identity_source=telegram_search peer_id={} telegram_message_id={} topic_id={:?} media_kind={} has_media_metadata={doc_has_thumb} document_id={}", folder_id.unwrap_or(0), id, message_topic_id(msg), icon, doc.id()),
            );
            Some(row)
        }
        Media::Sticker(_) => {
            let sticker_name = format!("sticker_{id}.webp");
            let cls = crate::core::media_classifier::classify_media_item(
                &sticker_name,
                Some("image/webp"),
                true,
                false,
                true,
            );
            Some(MediaFileRow {
                id,
                folder_id,
                name: sticker_name,
                size,
                mime_type: Some("image/webp".into()),
                icon_type: "image".into(),
                created_at: created,
                has_thumb,
                as_document: true,
                backend: BACKEND.into(),
                thumb_data_url,
                topic_id: message_topic_id(msg),
                identity_source: Some("telegram_search".into()),
                peer_id: folder_id
                    .map(|fid| {
                        if fid == 0 {
                            "me".into()
                        } else {
                            fid.to_string()
                        }
                    })
                    .or_else(|| Some("me".into())),
                account_id: None,
                peer_kind: None,
                peer_username: None,
                grouped_id: msg.grouped_id(),
                is_saved_messages: Some(folder_id.map_or(true, |fid| fid == 0)),
                telegram_category: Some(cls.telegram_category),
                telegram_subtype: Some(cls.telegram_subtype),
                drive_category: Some(cls.drive_category),
                drive_format: Some(cls.drive_format),
            })
        }
        _ => None,
    }
}

pub fn tl_message_to_row(
    msg: &grammers_client::tl::enums::Message,
    folder_id: Option<i64>,
) -> Option<MediaFileRow> {
    let m = match msg {
        grammers_client::tl::enums::Message::Message(m) => m,
        _ => return None,
    };

    let id = m.id as i64;
    let created = chrono::DateTime::from_timestamp(m.date as i64, 0).map(|dt| dt.to_rfc3339());
    let caption = m.message.trim();
    let topic_id = match &m.reply_to {
        Some(grammers_client::tl::enums::MessageReplyHeader::Header(h)) => h
            .reply_to_top_id
            .or(h.reply_to_msg_id)
            .map(|top| top as i64),
        _ => None,
    };

    if let Some(ref media) = m.media {
        let thumb_data_url = crate::core::grammers_media::tl_stripped_thumb_data_url(media);
        match media {
            grammers_client::tl::enums::MessageMedia::Photo(photo_media) => {
                let name = if caption.is_empty() {
                    format!("photo_{id}.jpg")
                } else {
                    format!("{caption}.jpg")
                };
                let mut photo_size = 0u64;
                if let Some(grammers_client::tl::enums::Photo::Photo(photo)) = &photo_media.photo {
                    for s in &photo.sizes {
                        match s {
                            grammers_client::tl::enums::PhotoSize::Size(sz) => {
                                photo_size = photo_size.max(sz.size as u64);
                            }
                            grammers_client::tl::enums::PhotoSize::Progressive(pr) => {
                                if let Some(&max_sz) = pr.sizes.iter().max() {
                                    photo_size = photo_size.max(max_sz as u64);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                let cls = crate::core::media_classifier::classify_media_item(
                    &name,
                    Some("image/jpeg"),
                    false,
                    true,
                    false,
                );
                Some(MediaFileRow {
                    id,
                    folder_id,
                    name,
                    size: photo_size,
                    mime_type: Some("image/jpeg".to_string()),
                    icon_type: "photo".to_string(),
                    created_at: created,
                    has_thumb: true,
                    as_document: false,
                    backend: BACKEND.to_string(),
                    thumb_data_url,
                    topic_id,
                    identity_source: Some("telegram_search".into()),
                    peer_id: folder_id
                        .map(|fid| {
                            if fid == 0 {
                                "me".into()
                            } else {
                                fid.to_string()
                            }
                        })
                        .or_else(|| Some("me".into())),
                    account_id: None,
                    peer_kind: None,
                    peer_username: None,
                    grouped_id: m.grouped_id,
                    is_saved_messages: Some(folder_id.map_or(true, |fid| fid == 0)),
                    telegram_category: Some(cls.telegram_category),
                    telegram_subtype: Some(cls.telegram_subtype),
                    drive_category: Some(cls.drive_category),
                    drive_format: Some(cls.drive_format),
                })
            }
            grammers_client::tl::enums::MessageMedia::Document(doc_media) => {
                let doc = match &doc_media.document {
                    Some(grammers_client::tl::enums::Document::Document(d)) => d,
                    _ => return None,
                };
                let mut raw_name: Option<String> = None;
                for attr in &doc.attributes {
                    if let grammers_client::tl::enums::DocumentAttribute::Filename(f) = attr {
                        raw_name = Some(f.file_name.clone());
                    }
                }
                let name = raw_name
                    .or_else(|| {
                        if caption.is_empty() {
                            None
                        } else {
                            Some(caption.to_string())
                        }
                    })
                    .unwrap_or_else(|| format!("file_{id}"));
                let mime = doc.mime_type.clone();
                let mime_l = mime.to_ascii_lowercase();
                let name_l = name.to_ascii_lowercase();

                let is_video = mime_l.starts_with("video/")
                    || name_l.ends_with(".mp4")
                    || name_l.ends_with(".mov")
                    || name_l.ends_with(".mkv")
                    || name_l.ends_with(".webm");

                let is_image = mime_l.starts_with("image/")
                    || name_l.ends_with(".jpg")
                    || name_l.ends_with(".jpeg")
                    || name_l.ends_with(".png")
                    || name_l.ends_with(".webp")
                    || name_l.ends_with(".gif")
                    || name_l.ends_with(".bmp")
                    || name_l.ends_with(".heic");

                let is_audio = mime_l.starts_with("audio/")
                    || name_l.ends_with(".mp3")
                    || name_l.ends_with(".wav")
                    || name_l.ends_with(".flac");

                let icon_type = if is_video {
                    "video".to_string()
                } else if is_image {
                    "photo".to_string()
                } else if is_audio {
                    "audio".to_string()
                } else {
                    "file".to_string()
                };

                let cls = crate::core::media_classifier::classify_media_item(
                    &name,
                    Some(&mime),
                    true,
                    false,
                    false,
                );
                Some(MediaFileRow {
                    id,
                    folder_id,
                    name,
                    size: doc.size as u64,
                    mime_type: Some(mime),
                    icon_type,
                    created_at: created,
                    has_thumb: is_video
                        || mime_l.starts_with("image/")
                        || thumb_data_url.is_some()
                        || doc.thumbs.as_ref().map(|t| !t.is_empty()).unwrap_or(false),
                    as_document: true,
                    backend: BACKEND.to_string(),
                    thumb_data_url,
                    topic_id,
                    identity_source: Some("telegram_search".into()),
                    peer_id: folder_id
                        .map(|fid| {
                            if fid == 0 {
                                "me".into()
                            } else {
                                fid.to_string()
                            }
                        })
                        .or_else(|| Some("me".into())),
                    account_id: None,
                    peer_kind: None,
                    peer_username: None,
                    grouped_id: m.grouped_id,
                    is_saved_messages: Some(folder_id.map_or(true, |fid| fid == 0)),
                    telegram_category: Some(cls.telegram_category),
                    telegram_subtype: Some(cls.telegram_subtype),
                    drive_category: Some(cls.drive_category),
                    drive_format: Some(cls.drive_format),
                })
            }
            _ => None,
        }
    } else {
        None
    }
}

/// Forward messages source → dest (no delete). Returns count forwarded.
pub fn forward_messages_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    source_chat: &str,
    dest_chat: &str,
    message_ids: &[i64],
) -> Result<usize, TgError> {
    let rt = runtime()?;
    let src = source_chat.to_string();
    let dst = dest_chat.to_string();
    let ids: Vec<i32> = message_ids
        .iter()
        .filter(|&&id| id > 0)
        .map(|&id| id as i32)
        .take(100)
        .collect();
    if ids.is_empty() {
        return Ok(0);
    }
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
                let source = resolve_peer(client, &src).await?;
                let dest = resolve_peer(client, &dst).await?;
                let forwarded = client
                    .forward_messages(dest, &ids, source)
                    .await
                    .map_err(|e| map_invocation(&e))?;
                Ok(forwarded.iter().filter(|m| m.is_some()).count())
            })
        })
        .await
    })
}

pub fn message_topic_id(msg: &grammers_client::message::Message) -> Option<i64> {
    use grammers_client::tl::enums::MessageReplyHeader as H;
    match msg.reply_header()? {
        H::Header(h) => {
            if let Some(top) = h.reply_to_top_id {
                return Some(top as i64);
            }
            // Topic root posts often only set reply_to_msg_id == topic id
            if h.forum_topic {
                if let Some(mid) = h.reply_to_msg_id {
                    return Some(mid as i64);
                }
            }
            h.reply_to_msg_id.map(|m| m as i64)
        }
        _ => None,
    }
}

/// List media messages in a chat (newest first). Optional forum `topic_id` filter.
pub fn list_media_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    limit: usize,
    offset_id: Option<i64>,
) -> Result<ListMediaResult, TgError> {
    list_media_blocking_topic_cursor(sessions_dir, identity, chat_id, limit, offset_id, None, None)
}

pub fn list_media_blocking_topic(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    limit: usize,
    offset_id: Option<i64>,
    topic_id: Option<i64>,
) -> Result<ListMediaResult, TgError> {
    list_media_blocking_topic_cursor(sessions_dir, identity, chat_id, limit, offset_id, topic_id, None)
}

pub fn list_media_blocking_topic_cursor(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    limit: usize,
    offset_id: Option<i64>,
    topic_id: Option<i64>,
    search_cursor: Option<ScopedMediaSearchCursor>,
) -> Result<ListMediaResult, TgError> {
    let rt = runtime()?;
    let limit = limit.clamp(1, 100);
    let chat = chat_id.to_string();
    let folder_id: Option<i64> = if chat.eq_ignore_ascii_case("me") || chat == "0" {
        None
    } else {
        chat.parse().ok()
    };
    let top_msg_id = topic_id.filter(|t| *t > 0).map(|t| t as i32);
    let session_name = identity.session.clone();

    rt.block_on(async {
        with_pool_retry(&identity.session, || {
            let chat = chat.clone();
            let session_name = session_name.clone();
            let initial_cursor = search_cursor.clone();
            with_client(sessions_dir, identity, true, |client| {
                Box::pin(async move {
                    ensure_authorized(client, &session_name).await?;
                    let mut peer_res = resolve_peer(client, &chat).await;
                    if let Err(ref e) = peer_res {
                        let err_str = e.to_string();
                        if err_str.contains("CHANNEL_INVALID")
                            || err_str.contains("CHANNEL_PRIVATE")
                            || err_str.contains("PEER_ID_INVALID")
                        {
                            clear_peer_cache_for_all(&chat);
                            peer_res = resolve_peer(client, &chat).await;
                        }
                    }
                    let peer = peer_res?;
                    let input_peer: grammers_client::tl::enums::InputPeer = (&peer).into();

                    let current_scope = SearchScope {
                        account_id: session_name.clone(),
                        peer_id: chat.clone(),
                        topic_id,
                    };

                    let init_offset = offset_id.unwrap_or(0) as i32;
                    let mut cursor = normalize_search_cursor(initial_cursor, &current_scope, init_offset);

                    let mut lane_counts = LaneCounts::default();
                    let mut candidate_estimate = 0usize;

                    // 1. Lane: PhotoVideo (Native Photos & Videos)
                    // Replenish buffer if pending buffer is smaller than limit AND lane is not exhausted
                    if cursor.pending_photo_video.len() < limit && !cursor.photo_video.exhausted {
                        let req = grammers_client::tl::functions::messages::Search {
                            peer: input_peer.clone(),
                            q: String::new(),
                            from_id: None,
                            saved_peer_id: None,
                            saved_reaction: None,
                            top_msg_id,
                            filter: grammers_client::tl::enums::MessagesFilter::InputMessagesFilterPhotoVideo,
                            min_date: 0,
                            max_date: 0,
                            offset_id: cursor.photo_video.fetch_offset_id,
                            add_offset: 0,
                            limit: limit as i32,
                            max_id: 0,
                            min_id: 0,
                            hash: 0,
                        };

                        let res = crate::core::telegram_rpc_guard::invoke_guarded(
                            &session_name,
                            crate::core::session_rate::RpcClass::IndexSearch,
                            "messages.search.photo_video",
                            || client.invoke(&req),
                        )
                        .await?;

                        let raw_msgs = match res.value {
                            grammers_client::tl::enums::messages::Messages::Messages(m) => m.messages,
                            grammers_client::tl::enums::messages::Messages::Slice(m) => {
                                lane_counts.photo_video = Some(m.count as usize);
                                candidate_estimate += m.count as usize;
                                m.messages
                            }
                            grammers_client::tl::enums::messages::Messages::ChannelMessages(m) => {
                                lane_counts.photo_video = Some(m.count as usize);
                                candidate_estimate += m.count as usize;
                                m.messages
                            }
                            grammers_client::tl::enums::messages::Messages::NotModified(_) => Vec::new(),
                        };

                        let raw_len = raw_msgs.len();
                        let mut lowest_id = None;

                        for tl_msg in raw_msgs {
                            if let grammers_client::tl::enums::Message::Message(ref m) = tl_msg {
                                lowest_id = Some(lowest_id.map_or(m.id, |prev: i32| prev.min(m.id)));
                            }
                            if let Some(row) = tl_message_to_row(&tl_msg, folder_id) {
                                cursor.pending_photo_video.push(row);
                            }
                        }

                        if let Some(last_id) = lowest_id {
                            cursor.photo_video.fetch_offset_id = last_id;
                            if raw_len < limit || last_id <= 1 {
                                cursor.photo_video.exhausted = true;
                            }
                        } else {
                            cursor.photo_video.exhausted = true;
                        }
                    }

                    // 2. Lane: Document (Files, Document Videos, Audio, Archives)
                    // Replenish buffer if pending buffer is smaller than limit AND lane is not exhausted
                    if cursor.pending_document.len() < limit && !cursor.document.exhausted {
                        let req = grammers_client::tl::functions::messages::Search {
                            peer: input_peer.clone(),
                            q: String::new(),
                            from_id: None,
                            saved_peer_id: None,
                            saved_reaction: None,
                            top_msg_id,
                            filter: grammers_client::tl::enums::MessagesFilter::InputMessagesFilterDocument,
                            min_date: 0,
                            max_date: 0,
                            offset_id: cursor.document.fetch_offset_id,
                            add_offset: 0,
                            limit: limit as i32,
                            max_id: 0,
                            min_id: 0,
                            hash: 0,
                        };

                        let res = crate::core::telegram_rpc_guard::invoke_guarded(
                            &session_name,
                            crate::core::session_rate::RpcClass::IndexSearch,
                            "messages.search.document",
                            || client.invoke(&req),
                        )
                        .await?;

                        let raw_msgs = match res.value {
                            grammers_client::tl::enums::messages::Messages::Messages(m) => m.messages,
                            grammers_client::tl::enums::messages::Messages::Slice(m) => {
                                lane_counts.document = Some(m.count as usize);
                                candidate_estimate += m.count as usize;
                                m.messages
                            }
                            grammers_client::tl::enums::messages::Messages::ChannelMessages(m) => {
                                lane_counts.document = Some(m.count as usize);
                                candidate_estimate += m.count as usize;
                                m.messages
                            }
                            grammers_client::tl::enums::messages::Messages::NotModified(_) => Vec::new(),
                        };

                        let raw_len = raw_msgs.len();
                        let mut lowest_id = None;

                        for tl_msg in raw_msgs {
                            if let grammers_client::tl::enums::Message::Message(ref m) = tl_msg {
                                lowest_id = Some(lowest_id.map_or(m.id, |prev: i32| prev.min(m.id)));
                            }
                            if let Some(row) = tl_message_to_row(&tl_msg, folder_id) {
                                cursor.pending_document.push(row);
                            }
                        }

                        if let Some(last_id) = lowest_id {
                            cursor.document.fetch_offset_id = last_id;
                            if raw_len < limit || last_id <= 1 {
                                cursor.document.exhausted = true;
                            }
                        } else {
                            cursor.document.exhausted = true;
                        }
                    }

                    // 3. Lossless Buffered K-Way Merge & Exact Page Size
                    let merged_items = buffered_k_way_merge(
                        &mut cursor.pending_photo_video,
                        &mut cursor.pending_document,
                        limit,
                    );

                    let mut emitted_watermark = LaneWatermark {
                        photo_video: 0,
                        document: 0,
                    };
                    let mut emitted_files = Vec::with_capacity(merged_items.len());

                    for item in &merged_items {
                        let id_i32 = item.row.id as i32;
                        match item.lane {
                            SearchLane::PhotoVideo => {
                                if emitted_watermark.photo_video == 0 || id_i32 < emitted_watermark.photo_video {
                                    emitted_watermark.photo_video = id_i32;
                                }
                            }
                            SearchLane::Document => {
                                if emitted_watermark.document == 0 || id_i32 < emitted_watermark.document {
                                    emitted_watermark.document = id_i32;
                                }
                            }
                            SearchLane::Both => {
                                if emitted_watermark.photo_video == 0 || id_i32 < emitted_watermark.photo_video {
                                    emitted_watermark.photo_video = id_i32;
                                }
                                if emitted_watermark.document == 0 || id_i32 < emitted_watermark.document {
                                    emitted_watermark.document = id_i32;
                                }
                            }
                        }
                        emitted_files.push(item.row.clone());
                    }

                    let has_more = !cursor.photo_video.exhausted
                        || !cursor.document.exhausted
                        || !cursor.pending_photo_video.is_empty()
                        || !cursor.pending_document.is_empty();

                    let next_offset_id = emitted_files.last().map(|f| f.id);

                    Ok(ListMediaResult {
                        status: "ok".to_string(),
                        folder_id,
                        total: emitted_files.len(),
                        page_size: limit,
                        has_more,
                        next_offset_id,
                        search_cursor: Some(cursor),
                        lane_counts: Some(lane_counts),
                        emitted_watermark: Some(emitted_watermark),
                        total_count: if candidate_estimate > 0 { Some(candidate_estimate) } else { None },
                        backend: BACKEND.to_string(),
                        cached: false,
                        files: emitted_files,
                    })
                })
            })
        })
        .await
    })
}

pub fn start_folder_stream_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    limit: usize,
    offset_id: Option<i64>,
    topic_id: Option<i64>,
    request_id: String,
    channel: &tauri::ipc::Channel<FolderChunkPayload>,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<bool, TgError> {
    if cancel_flag.load(Ordering::SeqCst) {
        return Ok(false);
    }
    let res =
        list_media_blocking_topic(sessions_dir, identity, chat_id, limit, offset_id, topic_id)?;

    if cancel_flag.load(Ordering::SeqCst) {
        return Ok(false);
    }

    let folder_id: Option<i64> = if chat_id.eq_ignore_ascii_case("me") || chat_id == "0" {
        None
    } else {
        chat_id.parse().ok()
    };

    let payload = FolderChunkPayload {
        request_id,
        folder_id,
        topic_id,
        files: res.files,
        next_offset_id: res.next_offset_id,
        has_more: res.has_more,
        is_initial_chunk: offset_id.is_none(),
        total_count: res.total_count,
    };

    let _ = channel.send(payload);
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_row(id: i64) -> MediaFileRow {
        MediaFileRow {
            id,
            folder_id: None,
            name: format!("file_{}.dat", id),
            size: 1024,
            mime_type: Some("application/octet-stream".to_string()),
            icon_type: "file".to_string(),
            created_at: Some("1700000000".to_string()),
            has_thumb: false,
            as_document: true,
            backend: "grammers".to_string(),
            thumb_data_url: None,
            topic_id: None,
            identity_source: None,
            peer_id: None,
            account_id: None,
            peer_kind: None,
            peer_username: None,
            grouped_id: None,
            is_saved_messages: None,
            telegram_category: None,
            telegram_subtype: None,
            drive_category: None,
            drive_format: None,
        }
    }

    #[test]
    fn test_normalize_search_cursor_scope_rejection_peer() {
        let stale = ScopedMediaSearchCursor {
            scope: SearchScope {
                account_id: "user_a".to_string(),
                peer_id: "100111111".to_string(),
                topic_id: None,
            },
            photo_video: LaneCursor {
                fetch_offset_id: 15000,
                exhausted: false,
            },
            document: LaneCursor {
                fetch_offset_id: 12000,
                exhausted: false,
            },
            pending_photo_video: vec![dummy_row(14999)],
            pending_document: vec![dummy_row(11999)],
        };

        let new_scope = SearchScope {
            account_id: "user_a".to_string(),
            peer_id: "100222222".to_string(),
            topic_id: None,
        };

        let normalized = normalize_search_cursor(Some(stale), &new_scope, 0);
        assert_eq!(normalized.scope.peer_id, "100222222");
        assert_eq!(normalized.photo_video.fetch_offset_id, 0);
        assert_eq!(normalized.document.fetch_offset_id, 0);
        assert!(normalized.pending_photo_video.is_empty());
        assert!(normalized.pending_document.is_empty());
    }

    #[test]
    fn test_normalize_search_cursor_scope_rejection_topic() {
        let stale = ScopedMediaSearchCursor {
            scope: SearchScope {
                account_id: "user_a".to_string(),
                peer_id: "100111111".to_string(),
                topic_id: Some(42),
            },
            photo_video: LaneCursor {
                fetch_offset_id: 9000,
                exhausted: false,
            },
            document: LaneCursor {
                fetch_offset_id: 8000,
                exhausted: false,
            },
            pending_photo_video: vec![],
            pending_document: vec![],
        };

        let new_scope = SearchScope {
            account_id: "user_a".to_string(),
            peer_id: "100111111".to_string(),
            topic_id: Some(99),
        };

        let normalized = normalize_search_cursor(Some(stale), &new_scope, 0);
        assert_eq!(normalized.scope.topic_id, Some(99));
        assert_eq!(normalized.photo_video.fetch_offset_id, 0);
        assert_eq!(normalized.document.fetch_offset_id, 0);
    }

    #[test]
    fn test_normalize_search_cursor_scope_rejection_account() {
        let stale = ScopedMediaSearchCursor {
            scope: SearchScope {
                account_id: "account_1".to_string(),
                peer_id: "100111111".to_string(),
                topic_id: None,
            },
            photo_video: LaneCursor {
                fetch_offset_id: 5000,
                exhausted: false,
            },
            document: LaneCursor {
                fetch_offset_id: 4000,
                exhausted: false,
            },
            pending_photo_video: vec![],
            pending_document: vec![],
        };

        let new_scope = SearchScope {
            account_id: "account_2".to_string(),
            peer_id: "100111111".to_string(),
            topic_id: None,
        };

        let normalized = normalize_search_cursor(Some(stale), &new_scope, 0);
        assert_eq!(normalized.scope.account_id, "account_2");
        assert_eq!(normalized.photo_video.fetch_offset_id, 0);
    }

    #[test]
    fn test_normalize_search_cursor_scope_retain_matching() {
        let valid = ScopedMediaSearchCursor {
            scope: SearchScope {
                account_id: "user_a".to_string(),
                peer_id: "100111111".to_string(),
                topic_id: None,
            },
            photo_video: LaneCursor {
                fetch_offset_id: 901,
                exhausted: false,
            },
            document: LaneCursor {
                fetch_offset_id: 701,
                exhausted: false,
            },
            pending_photo_video: vec![dummy_row(900)],
            pending_document: vec![dummy_row(700)],
        };

        let scope = SearchScope {
            account_id: "user_a".to_string(),
            peer_id: "100111111".to_string(),
            topic_id: None,
        };

        let normalized = normalize_search_cursor(Some(valid), &scope, 0);
        assert_eq!(normalized.photo_video.fetch_offset_id, 901);
        assert_eq!(normalized.document.fetch_offset_id, 701);
        assert_eq!(normalized.pending_photo_video.len(), 1);
        assert_eq!(normalized.pending_document.len(), 1);
    }

    #[test]
    fn test_buffered_k_way_merge_exact_page_size() {
        // Synthetic stream:
        // PV: 1000, 990, 980, 970, 960
        // DOC: 995, 985, 975, 965, 955
        let mut pv = vec![dummy_row(1000), dummy_row(990), dummy_row(980), dummy_row(970), dummy_row(960)];
        let mut doc = vec![dummy_row(995), dummy_row(985), dummy_row(975), dummy_row(965), dummy_row(955)];

        // Page 1 with limit = 4
        let page1 = buffered_k_way_merge(&mut pv, &mut doc, 4);
        let ids1: Vec<i64> = page1.iter().map(|f| f.row.id).collect();
        assert_eq!(ids1, vec![1000, 995, 990, 985]);
        assert_eq!(pv.len(), 3); // 980, 970, 960
        assert_eq!(doc.len(), 3); // 975, 965, 955

        // Page 2 with limit = 4
        let page2 = buffered_k_way_merge(&mut pv, &mut doc, 4);
        let ids2: Vec<i64> = page2.iter().map(|f| f.row.id).collect();
        assert_eq!(ids2, vec![980, 975, 970, 965]);
        assert_eq!(pv.len(), 1); // 960
        assert_eq!(doc.len(), 1); // 955

        // Page 3 with limit = 4
        let page3 = buffered_k_way_merge(&mut pv, &mut doc, 4);
        let ids3: Vec<i64> = page3.iter().map(|f| f.row.id).collect();
        assert_eq!(ids3, vec![960, 955]);
        assert_eq!(pv.len(), 0);
        assert_eq!(doc.len(), 0);

        // Combined verification: zero missing, zero duplicate, sorted descending
        let mut all_ids = Vec::new();
        all_ids.extend(ids1);
        all_ids.extend(ids2);
        all_ids.extend(ids3);
        assert_eq!(all_ids, vec![1000, 995, 990, 985, 980, 975, 970, 965, 960, 955]);
    }

    #[test]
    fn test_buffered_k_way_merge_overlap_deduplication() {
        // PV: 1000, 990, 980
        // DOC: 995, 990, 985
        let mut pv = vec![dummy_row(1000), dummy_row(990), dummy_row(980)];
        let mut doc = vec![dummy_row(995), dummy_row(990), dummy_row(985)];

        let page = buffered_k_way_merge(&mut pv, &mut doc, 10);
        let ids: Vec<i64> = page.iter().map(|f| f.row.id).collect();
        assert_eq!(ids, vec![1000, 995, 990, 985, 980]);
        // Message ID 990 appears only once!
        assert_eq!(ids.iter().filter(|&&id| id == 990).count(), 1);
        assert_eq!(page.iter().find(|item| item.row.id == 990).unwrap().lane, SearchLane::Both);
    }

    #[test]
    fn test_overlap_exactly_at_page_boundary() {
        // PV = [1000, 900]
        // DOC = [1000, 800]
        // limit = 1
        let mut pv = vec![dummy_row(1000), dummy_row(900)];
        let mut doc = vec![dummy_row(1000), dummy_row(800)];

        // Page 1: Must pop both 1000 from PV and DOC simultaneously and emit only once with SearchLane::Both
        let p1 = buffered_k_way_merge(&mut pv, &mut doc, 1);
        assert_eq!(p1.len(), 1);
        assert_eq!(p1[0].row.id, 1000);
        assert_eq!(p1[0].lane, SearchLane::Both);
        assert_eq!(pv.len(), 1); // 900
        assert_eq!(doc.len(), 1); // 800

        // Page 2: Must emit 900 from PV
        let p2 = buffered_k_way_merge(&mut pv, &mut doc, 1);
        assert_eq!(p2.len(), 1);
        assert_eq!(p2[0].row.id, 900);
        assert_eq!(p2[0].lane, SearchLane::PhotoVideo);
        assert_eq!(pv.len(), 0);
        assert_eq!(doc.len(), 1); // 800

        // Page 3: Must emit 800 from DOC
        let p3 = buffered_k_way_merge(&mut pv, &mut doc, 1);
        assert_eq!(p3.len(), 1);
        assert_eq!(p3[0].row.id, 800);
        assert_eq!(p3[0].lane, SearchLane::Document);
        assert_eq!(pv.len(), 0);
        assert_eq!(doc.len(), 0);

        // Page 4: Exhausted
        let p4 = buffered_k_way_merge(&mut pv, &mut doc, 1);
        assert!(p4.is_empty());

        let mut all_ids = Vec::new();
        all_ids.extend(p1.iter().map(|f| f.row.id));
        all_ids.extend(p2.iter().map(|f| f.row.id));
        all_ids.extend(p3.iter().map(|f| f.row.id));
        assert_eq!(all_ids, vec![1000, 900, 800]);
        // 1000 appeared strictly once across page boundaries!
        assert_eq!(all_ids.iter().filter(|&&id| id == 1000).count(), 1);
    }

    #[test]
    fn test_buffered_k_way_merge_uneven_lanes() {
        // PV: 1000, 900, 800, 700, 600
        // DOC: 5000
        let mut pv = vec![dummy_row(1000), dummy_row(900), dummy_row(800), dummy_row(700), dummy_row(600)];
        let mut doc = vec![dummy_row(5000)];

        let page1 = buffered_k_way_merge(&mut pv, &mut doc, 2);
        let ids1: Vec<i64> = page1.iter().map(|f| f.row.id).collect();
        assert_eq!(ids1, vec![5000, 1000]);

        let page2 = buffered_k_way_merge(&mut pv, &mut doc, 10);
        let ids2: Vec<i64> = page2.iter().map(|f| f.row.id).collect();
        assert_eq!(ids2, vec![900, 800, 700, 600]);
    }

    #[test]
    fn test_buffered_k_way_merge_single_item_pages() {
        let mut pv = vec![dummy_row(300), dummy_row(100)];
        let mut doc = vec![dummy_row(200)];

        let p1 = buffered_k_way_merge(&mut pv, &mut doc, 1);
        assert_eq!(p1[0].row.id, 300);

        let p2 = buffered_k_way_merge(&mut pv, &mut doc, 1);
        assert_eq!(p2[0].row.id, 200);

        let p3 = buffered_k_way_merge(&mut pv, &mut doc, 1);
        assert_eq!(p3[0].row.id, 100);

        let p4 = buffered_k_way_merge(&mut pv, &mut doc, 1);
        assert!(p4.is_empty());
    }

    #[test]
    fn test_buffered_k_way_merge_exhaustion_conditions() {
        let cursor_running = ScopedMediaSearchCursor {
            scope: SearchScope {
                account_id: "a".to_string(),
                peer_id: "p".to_string(),
                topic_id: None,
            },
            photo_video: LaneCursor {
                fetch_offset_id: 100,
                exhausted: false,
            },
            document: LaneCursor {
                fetch_offset_id: 1,
                exhausted: true,
            },
            pending_photo_video: vec![],
            pending_document: vec![],
        };

        let has_more = !cursor_running.photo_video.exhausted
            || !cursor_running.document.exhausted
            || !cursor_running.pending_photo_video.is_empty()
            || !cursor_running.pending_document.is_empty();
        assert_eq!(has_more, true);

        let cursor_exhausted = ScopedMediaSearchCursor {
            scope: SearchScope {
                account_id: "a".to_string(),
                peer_id: "p".to_string(),
                topic_id: None,
            },
            photo_video: LaneCursor {
                fetch_offset_id: 1,
                exhausted: true,
            },
            document: LaneCursor {
                fetch_offset_id: 1,
                exhausted: true,
            },
            pending_photo_video: vec![],
            pending_document: vec![],
        };

        let has_more_final = !cursor_exhausted.photo_video.exhausted
            || !cursor_exhausted.document.exhausted
            || !cursor_exhausted.pending_photo_video.is_empty()
            || !cursor_exhausted.pending_document.is_empty();
        assert_eq!(has_more_final, false);
    }
}
