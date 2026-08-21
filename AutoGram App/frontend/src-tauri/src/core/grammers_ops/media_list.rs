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
    #[serde(default)]
    pub min_id: i32,
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

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SearchLane {
    #[default]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrontierStep {
    EmitPv,
    EmitDoc,
    EmitBoth,
    FetchPv,
    FetchDoc,
    FetchBoth,
    Finished,
}

/// Evaluates the provably safe next action based on known pending lane heads and fetch frontiers.
pub fn evaluate_frontier_step(
    pending_pv: &[MediaFileRow],
    pending_doc: &[MediaFileRow],
    pv_offset: i32,
    doc_offset: i32,
    pv_exhausted: bool,
    doc_exhausted: bool,
) -> FrontierStep {
    let head_pv = pending_pv.first();
    let head_doc = pending_doc.first();

    match (head_pv, head_doc) {
        // Case 1: Both heads known
        (Some(pv), Some(doc)) => {
            if pv.id > doc.id {
                FrontierStep::EmitPv
            } else if doc.id > pv.id {
                FrontierStep::EmitDoc
            } else {
                FrontierStep::EmitBoth
            }
        }
        // Case 2: PV head known, DOC buffer empty
        (Some(pv), None) => {
            if doc_exhausted {
                // DOC is completely exhausted -> PV is provably safe to emit
                FrontierStep::EmitPv
            } else if doc_offset == 0 {
                // DOC has never been fetched -> frontier is UNKNOWN -> MUST FETCH DOC
                FrontierStep::FetchDoc
            } else if (pv.id as i32) > doc_offset {
                // STRICT inequality: PV is strictly newer than any potential unseen DOC
                FrontierStep::EmitPv
            } else {
                // pv.id <= doc_offset -> unseen DOC could have higher ID -> MUST FETCH DOC
                FrontierStep::FetchDoc
            }
        }
        // Case 3: DOC head known, PV buffer empty
        (None, Some(doc)) => {
            if pv_exhausted {
                // PV is completely exhausted -> DOC is provably safe to emit
                FrontierStep::EmitDoc
            } else if pv_offset == 0 {
                // PV has never been fetched -> frontier is UNKNOWN -> MUST FETCH PV
                FrontierStep::FetchPv
            } else if (doc.id as i32) > pv_offset {
                // STRICT inequality: DOC is strictly newer than any potential unseen PV
                FrontierStep::EmitDoc
            } else {
                // doc.id <= pv_offset -> unseen PV could have higher ID -> MUST FETCH PV
                FrontierStep::FetchPv
            }
        }
        // Case 4: Both buffers empty
        (None, None) => {
            if pv_exhausted && doc_exhausted {
                FrontierStep::Finished
            } else if !pv_exhausted && !doc_exhausted {
                FrontierStep::FetchBoth
            } else if !pv_exhausted {
                FrontierStep::FetchPv
            } else {
                FrontierStep::FetchDoc
            }
        }
    }
}

/// Drains as many provably ordered items as possible from pending buffers into `emitted`.
/// Stops when `emitted.len() >= limit` OR when a lane must be fetched to prove the next item.
pub fn drain_provably_safe_frontier(
    pending_pv: &mut Vec<MediaFileRow>,
    pending_doc: &mut Vec<MediaFileRow>,
    pv_offset: i32,
    doc_offset: i32,
    pv_exhausted: bool,
    doc_exhausted: bool,
    limit: usize,
    emitted: &mut Vec<MergedMediaRow>,
) -> FrontierStep {
    // Keep pending buffers sorted descending by id
    pending_pv.sort_by(|a, b| b.id.cmp(&a.id));
    pending_doc.sort_by(|a, b| b.id.cmp(&a.id));

    let mut pv_idx = 0usize;
    let mut doc_idx = 0usize;

    let final_step = loop {
        if emitted.len() >= limit {
            break FrontierStep::Finished;
        }

        let head_pv = pending_pv.get(pv_idx);
        let head_doc = pending_doc.get(doc_idx);

        let step = match (head_pv, head_doc) {
            (Some(pv), Some(doc)) => {
                if pv.id > doc.id {
                    FrontierStep::EmitPv
                } else if doc.id > pv.id {
                    FrontierStep::EmitDoc
                } else {
                    FrontierStep::EmitBoth
                }
            }
            (Some(pv), None) => {
                if doc_exhausted {
                    FrontierStep::EmitPv
                } else if doc_offset == 0 {
                    FrontierStep::FetchDoc
                } else if (pv.id as i32) > doc_offset {
                    FrontierStep::EmitPv
                } else {
                    FrontierStep::FetchDoc
                }
            }
            (None, Some(doc)) => {
                if pv_exhausted {
                    FrontierStep::EmitDoc
                } else if pv_offset == 0 {
                    FrontierStep::FetchPv
                } else if (doc.id as i32) > pv_offset {
                    FrontierStep::EmitDoc
                } else {
                    FrontierStep::FetchPv
                }
            }
            (None, None) => {
                if pv_exhausted && doc_exhausted {
                    FrontierStep::Finished
                } else if !pv_exhausted && !doc_exhausted {
                    FrontierStep::FetchBoth
                } else if !pv_exhausted {
                    FrontierStep::FetchPv
                } else {
                    FrontierStep::FetchDoc
                }
            }
        };

        match step {
            FrontierStep::EmitPv => {
                let pv = &pending_pv[pv_idx];
                emitted.push(MergedMediaRow {
                    row: pv.clone(),
                    lane: SearchLane::PhotoVideo,
                });
                pv_idx += 1;
            }
            FrontierStep::EmitDoc => {
                let doc = &pending_doc[doc_idx];
                emitted.push(MergedMediaRow {
                    row: doc.clone(),
                    lane: SearchLane::Document,
                });
                doc_idx += 1;
            }
            FrontierStep::EmitBoth => {
                let pv = &pending_pv[pv_idx];
                emitted.push(MergedMediaRow {
                    row: pv.clone(),
                    lane: SearchLane::Both,
                });
                pv_idx += 1;
                doc_idx += 1;
            }
            fetch_or_finish => break fetch_or_finish,
        }
    };

    if pv_idx > 0 {
        pending_pv.drain(..pv_idx);
    }
    if doc_idx > 0 {
        pending_doc.drain(..doc_idx);
    }

    final_step
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

    let mut pv_idx = 0usize;
    let mut doc_idx = 0usize;
    let pv_len = pending_pv.len();
    let doc_len = pending_doc.len();

    while emitted.len() < limit && (pv_idx < pv_len || doc_idx < doc_len) {
        let pv_item = pending_pv.get(pv_idx);
        let doc_item = pending_doc.get(doc_idx);

        match (pv_item, doc_item) {
            (Some(pv), Some(doc)) if pv.id == doc.id => {
                // Inherent dual-lane pop: consume both heads at once so identical ID is NEVER
                // retained in the secondary buffer across page boundaries!
                emitted.push(MergedMediaRow {
                    row: pv.clone(),
                    lane: SearchLane::Both,
                });
                pv_idx += 1;
                doc_idx += 1;
            }
            (Some(pv), Some(doc)) if pv.id > doc.id => {
                emitted.push(MergedMediaRow {
                    row: pv.clone(),
                    lane: SearchLane::PhotoVideo,
                });
                pv_idx += 1;
            }
            (Some(_), Some(doc)) => {
                emitted.push(MergedMediaRow {
                    row: doc.clone(),
                    lane: SearchLane::Document,
                });
                doc_idx += 1;
            }
            (Some(pv), None) => {
                emitted.push(MergedMediaRow {
                    row: pv.clone(),
                    lane: SearchLane::PhotoVideo,
                });
                pv_idx += 1;
            }
            (None, Some(doc)) => {
                emitted.push(MergedMediaRow {
                    row: doc.clone(),
                    lane: SearchLane::Document,
                });
                doc_idx += 1;
            }
            (None, None) => break,
        }
    }

    if pv_idx > 0 {
        pending_pv.drain(..pv_idx);
    }
    if doc_idx > 0 {
        pending_doc.drain(..doc_idx);
    }

    emitted
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneCounts {
    pub photo_video: Option<usize>,
    pub document: Option<usize>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneDurability {
    pub photo_video_drained: bool,
    pub document_drained: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneRpcObservation {
    pub lane: SearchLane,
    pub latency_ms: u64,          // Pure MTProto network invocation latency
    pub wall_latency_ms: u64,     // Full end-to-end wall latency including queue/pacing
    pub attempts: u32,
    pub rows_received: usize,
    pub candidate_count: Option<usize>,
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
    pub lane_durability: Option<LaneDurability>,
    pub total_count: Option<usize>,
    pub backend: String,
    pub cached: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rpc_observations: Vec<LaneRpcObservation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pv_observation: Option<LaneRpcObservation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_observation: Option<LaneRpcObservation>,
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
            let mime = doc.mime_type().map(|s| s.to_string());
            let native_delivery = match doc.raw.document.as_ref() {
                Some(grammers_client::tl::enums::Document::Document(raw)) => {
                    has_native_delivery(&raw.attributes)
                }
                _ => false,
            };
            let n = doc
                .name()
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| fallback_document_name(id, mime.as_deref(), native_delivery));
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
                !native_delivery,
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
                as_document: !native_delivery,
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
                let native_delivery = has_native_delivery(&doc.attributes);
                let name = raw_name
                    .unwrap_or_else(|| fallback_document_name(id, Some(&doc.mime_type), native_delivery));
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
                    !native_delivery,
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
                    as_document: !native_delivery,
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
            grammers_client::tl::enums::MessageMedia::WebPage(ref wp) => {
                let name = if caption.is_empty() {
                    format!("link_{id}")
                } else {
                    let first_line = caption.lines().next().unwrap_or(caption).trim();
                    if first_line.len() > 60 {
                        format!("{}…", &first_line[..60])
                    } else {
                        first_line.to_string()
                    }
                };
                let mut photo_size = 0u64;
                let mut has_photo = false;
                if let grammers_client::tl::enums::WebPage::Page(ref page) = wp.webpage {
                    if let Some(grammers_client::tl::enums::Photo::Photo(photo)) = &page.photo {
                        has_photo = true;
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
                }
                let cls = crate::core::media_classifier::classify_media_item(
                    &name,
                    Some("text/html"),
                    false,
                    false,
                    false,
                );
                Some(MediaFileRow {
                    id,
                    folder_id,
                    name,
                    size: if photo_size > 0 { photo_size } else { caption.len() as u64 },
                    mime_type: Some("text/html".to_string()),
                    icon_type: if has_photo { "photo".to_string() } else { "link".to_string() },
                    created_at: created,
                    has_thumb: has_photo || thumb_data_url.is_some(),
                    as_document: false,
                    backend: BACKEND.to_string(),
                    thumb_data_url,
                    topic_id,
                    identity_source: Some("telegram_webpage".into()),
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
                    drive_format: Some(caption.to_string()),
                })
            }
            _ => {
                if !caption.is_empty() {
                    let first_line = caption.lines().next().unwrap_or(caption).trim();
                    let name = if first_line.len() > 60 {
                        format!("{}…", &first_line[..60])
                    } else {
                        first_line.to_string()
                    };
                    let is_link = caption.contains("http://") || caption.contains("https://") || caption.contains("t.me/");
                    let icon_type = if is_link { "link".to_string() } else { "file".to_string() };
                    let cls = crate::core::media_classifier::classify_media_item(
                        &name,
                        Some("text/plain"),
                        false,
                        false,
                        false,
                    );
                    Some(MediaFileRow {
                        id,
                        folder_id,
                        name,
                        size: caption.len() as u64,
                        mime_type: Some("text/plain".to_string()),
                        icon_type,
                        created_at: created,
                        has_thumb: thumb_data_url.is_some(),
                        as_document: false,
                        backend: BACKEND.to_string(),
                        thumb_data_url,
                        topic_id,
                        identity_source: Some("telegram_media".into()),
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
                        drive_format: Some(caption.to_string()),
                    })
                } else {
                    None
                }
            }
        }
    } else if !caption.is_empty() {
        let first_line = caption.lines().next().unwrap_or(caption).trim();
        let name = if first_line.len() > 60 {
            format!("{}…", &first_line[..60])
        } else {
            first_line.to_string()
        };
        let is_link = caption.contains("http://") || caption.contains("https://") || caption.contains("t.me/");
        let icon_type = if is_link { "link".to_string() } else { "file".to_string() };
        let cls = crate::core::media_classifier::classify_media_item(
            &name,
            Some("text/plain"),
            false,
            false,
            false,
        );
        Some(MediaFileRow {
            id,
            folder_id,
            name,
            size: caption.len() as u64,
            mime_type: Some("text/plain".to_string()),
            icon_type,
            created_at: created,
            has_thumb: false,
            as_document: false,
            backend: BACKEND.to_string(),
            thumb_data_url: None,
            topic_id,
            identity_source: Some("telegram_text".into()),
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
            drive_format: Some(caption.to_string()),
        })
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

/// Telegram represents both native videos/GIFs and generic files as
/// `MessageMediaDocument`. The presence of native visual attributes—not the
/// MIME extension—determines whether clients render the item as media or FILE.
fn has_native_delivery(
    attributes: &[grammers_client::tl::enums::DocumentAttribute],
) -> bool {
    attributes.iter().any(|attr| matches!(
        attr,
        grammers_client::tl::enums::DocumentAttribute::Video(_)
            | grammers_client::tl::enums::DocumentAttribute::Audio(_)
            | grammers_client::tl::enums::DocumentAttribute::Animated
    ))
}

fn fallback_document_name(id: i64, mime: Option<&str>, native_delivery: bool) -> String {
    let normalized = mime.unwrap_or("").to_ascii_lowercase();
    let (kind, extension) = if normalized.starts_with("video/") {
        (
            if native_delivery { "video" } else { "file" },
            match normalized.as_str() {
                "video/quicktime" => "mov",
                "video/webm" => "webm",
                "video/x-matroska" => "mkv",
                _ => "mp4",
            },
        )
    } else if normalized.starts_with("audio/") {
        (
            if native_delivery { "audio" } else { "file" },
            match normalized.as_str() {
                "audio/ogg" => "ogg",
                "audio/opus" => "opus",
                "audio/flac" => "flac",
                "audio/mp4" | "audio/x-m4a" => "m4a",
                _ => "mp3",
            },
        )
    } else if normalized.starts_with("image/") {
        (
            if native_delivery { "image" } else { "file" },
            match normalized.as_str() {
                "image/png" => "png",
                "image/webp" => "webp",
                "image/gif" => "gif",
                "image/heic" => "heic",
                _ => "jpg",
            },
        )
    } else {
        ("file", "bin")
    };
    format!("{kind}_{id}.{extension}")
}

fn extract_http_urls(text: &str) -> Vec<String> {
    let mut urls = Vec::new();
    for token in text.split_whitespace() {
        let candidate = token
            .trim_matches(|c: char| matches!(c, '(' | ')' | '[' | ']' | '{' | '}' | '<' | '>' | '"' | '\'' | ',' | ';'))
            .trim_end_matches(|c: char| matches!(c, '.' | '!' | '?' | ':'));
        if (candidate.starts_with("https://") || candidate.starts_with("http://"))
            && !urls.iter().any(|existing| existing == candidate)
        {
            urls.push(candidate.to_string());
        }
    }
    urls
}

fn utf16_slice(text: &str, offset: i32, length: i32) -> Option<String> {
    let start = usize::try_from(offset).ok()?;
    let end = start.checked_add(usize::try_from(length).ok()?)?;
    let units = text.encode_utf16().collect::<Vec<_>>();
    if start >= end || end > units.len() {
        return None;
    }
    String::from_utf16(&units[start..end]).ok()
}

fn normalize_entity_url(url: &str) -> Option<String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        None
    } else if trimmed.contains("://") {
        Some(trimmed.to_string())
    } else {
        Some(format!("https://{trimmed}"))
    }
}

fn extract_message_urls(message: &grammers_client::tl::types::Message) -> Vec<String> {
    use grammers_client::tl::enums::MessageEntity;

    let mut urls = extract_http_urls(&message.message);
    for entity in message.entities.iter().flatten() {
        let candidate = match entity {
            MessageEntity::TextUrl(value) => normalize_entity_url(&value.url),
            MessageEntity::Url(value) => utf16_slice(&message.message, value.offset, value.length)
                .and_then(|value| normalize_entity_url(&value)),
            _ => None,
        };
        if let Some(candidate) = candidate {
            if !urls.iter().any(|existing| existing == &candidate) {
                urls.push(candidate);
            }
        }
    }
    urls
}

fn tl_link_to_row(
    msg: &grammers_client::tl::enums::Message,
    folder_id: Option<i64>,
) -> Option<MediaFileRow> {
    let m = match msg {
        grammers_client::tl::enums::Message::Message(m) => m,
        _ => return None,
    };
    let urls = extract_message_urls(m);
    if urls.is_empty() {
        return None;
    }
    let id = m.id as i64;
    let topic_id = match &m.reply_to {
        Some(grammers_client::tl::enums::MessageReplyHeader::Header(header)) => header
            .reply_to_top_id
            .or(header.reply_to_msg_id)
            .map(i64::from),
        _ => None,
    };
    Some(MediaFileRow {
        id,
        folder_id,
        name: urls[0].clone(),
        size: m.message.len() as u64,
        mime_type: Some("text/uri-list".into()),
        icon_type: "link".into(),
        created_at: chrono::DateTime::from_timestamp(m.date as i64, 0).map(|dt| dt.to_rfc3339()),
        has_thumb: false,
        as_document: false,
        backend: BACKEND.into(),
        thumb_data_url: None,
        topic_id,
        identity_source: Some("telegram_search_url".into()),
        peer_id: folder_id
            .map(|value| if value == 0 { "me".into() } else { value.to_string() })
            .or_else(|| Some("me".into())),
        account_id: None,
        peer_kind: None,
        peer_username: None,
        grouped_id: m.grouped_id,
        is_saved_messages: Some(folder_id.map_or(true, |value| value == 0)),
        telegram_category: Some("link".into()),
        telegram_subtype: Some(if urls.len() > 1 { "multiple_links" } else { "single_link" }.into()),
        drive_category: Some("link".into()),
        // The ordinary media rows use this field for a short format token. A
        // link row uses it as a compact newline-separated payload so the UI
        // can render all URLs from one Telegram message without inventing fake
        // message IDs.
        drive_format: Some(urls.join("\n")),
    })
}

/// List Telegram messages containing URLs. This is intentionally a separate
/// server search lane: media-only indexes cannot produce link-only messages.
pub fn list_links_blocking_topic(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    limit: usize,
    offset_id: Option<i64>,
    topic_id: Option<i64>,
) -> Result<ListMediaResult, TgError> {
    let rt = runtime()?;
    let limit = limit.clamp(1, 100);
    let chat = chat_id.to_string();
    let folder_id = if chat.eq_ignore_ascii_case("me") || chat == "0" {
        None
    } else {
        chat.parse().ok()
    };
    let session_name = identity.session.clone();
    rt.block_on(async {
        with_pool_retry(&identity.session, || {
        let chat = chat.clone();
        let session_name = session_name.clone();
        with_client(sessions_dir, identity, true, move |client| {
            Box::pin(async move {
                ensure_authorized(client, &session_name).await?;
                let peer = resolve_peer(client, &chat).await?;
                let request = grammers_client::tl::functions::messages::Search {
                    peer: (&peer).into(),
                    q: String::new(),
                    from_id: None,
                    saved_peer_id: None,
                    saved_reaction: None,
                    top_msg_id: topic_id.filter(|value| *value > 0).map(|value| value as i32),
                    filter: grammers_client::tl::enums::MessagesFilter::InputMessagesFilterUrl,
                    min_date: 0,
                    max_date: 0,
                    offset_id: offset_id.unwrap_or(0) as i32,
                    add_offset: 0,
                    limit: limit as i32,
                    max_id: 0,
                    min_id: 0,
                    hash: 0,
                };
                let guard = crate::core::telegram_rpc_guard::RpcGuardControl::default();
                let started = Instant::now();
                let response = crate::core::telegram_rpc_guard::invoke_guarded_with_control(
                    &session_name,
                    crate::core::session_rate::RpcClass::IndexSearch,
                    "messages.search.url",
                    &guard,
                    || client.invoke(&request),
                )
                .await?;
                let mut total_count = None;
                let messages = match response.value {
                    grammers_client::tl::enums::messages::Messages::Messages(value) => value.messages,
                    grammers_client::tl::enums::messages::Messages::Slice(value) => {
                        total_count = Some(value.count.max(0) as usize);
                        value.messages
                    }
                    grammers_client::tl::enums::messages::Messages::ChannelMessages(value) => {
                        total_count = Some(value.count.max(0) as usize);
                        value.messages
                    }
                    grammers_client::tl::enums::messages::Messages::NotModified(_) => Vec::new(),
                };
                let raw_len = messages.len();
                let lowest_id = messages.iter().filter_map(|message| match message {
                    grammers_client::tl::enums::Message::Message(value) => Some(value.id as i64),
                    _ => None,
                }).min();
                let files = messages.iter().filter_map(|message| tl_link_to_row(message, folder_id)).collect::<Vec<_>>();
                let has_more = raw_len >= limit && lowest_id.unwrap_or(0) > 1;
                let observation = LaneRpcObservation {
                    lane: SearchLane::Both,
                    latency_ms: response.latency_ms,
                    wall_latency_ms: started.elapsed().as_millis() as u64,
                    attempts: response.attempts,
                    rows_received: files.len(),
                    candidate_count: total_count,
                };
                Ok(ListMediaResult {
                    status: "ok".into(),
                    folder_id,
                    total: files.len(),
                    page_size: limit,
                    has_more,
                    next_offset_id: lowest_id,
                    search_cursor: None,
                    lane_counts: None,
                    emitted_watermark: None,
                    lane_durability: None,
                    total_count,
                    backend: BACKEND.into(),
                    cached: false,
                    files,
                    rpc_observations: vec![observation],
                    pv_observation: None,
                    doc_observation: None,
                })
            })
        })
        })
        .await
    })
}

/// List media messages in a chat (newest first). Optional forum `topic_id` filter.
pub fn list_media_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    limit: usize,
    offset_id: Option<i64>,
) -> Result<ListMediaResult, TgError> {
    list_media_blocking_topic_cursor(sessions_dir, identity, chat_id, limit, offset_id, None, None, None)
}

pub fn list_media_blocking_topic(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    limit: usize,
    offset_id: Option<i64>,
    topic_id: Option<i64>,
) -> Result<ListMediaResult, TgError> {
    list_media_blocking_topic_cursor(sessions_dir, identity, chat_id, limit, offset_id, None, topic_id, None)
}

pub fn list_media_blocking_topic_cursor(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    limit: usize,
    offset_id: Option<i64>,
    min_id: Option<i64>,
    topic_id: Option<i64>,
    search_cursor: Option<ScopedMediaSearchCursor>,
) -> Result<ListMediaResult, TgError> {
    let rt = runtime()?;
    rt.block_on(list_media_page_async(
        sessions_dir,
        identity,
        chat_id,
        limit,
        offset_id,
        min_id,
        topic_id,
        search_cursor,
        1,
        None,
    ))
}

/// Fallback primitive using client.iter_messages and direct messages.GetHistory
/// for unjoined public channels or channels where search filters are restricted.
pub async fn fetch_channel_history_page_async(
    client: &grammers_client::Client,
    peer_ref: grammers_session::types::PeerRef,
    offset_id: i32,
    limit: i32,
    min_id: i32,
    folder_id: Option<i64>,
) -> Result<(Vec<MediaFileRow>, Option<i32>, bool, Option<usize>, String), TgError> {
    let mut lowest_id = None;
    let mut rows = Vec::new();
    let mut count = 0;
    let mut total_count = None;
    let mut diag = String::new();

    // Strategy A: Try direct MTProto messages.GetHistory
    let input_peer: grammers_client::tl::enums::InputPeer = (&peer_ref).into();
    let req = grammers_client::tl::functions::messages::GetHistory {
        peer: input_peer,
        offset_id,
        offset_date: 0,
        add_offset: 0,
        limit,
        max_id: 0,
        min_id,
        hash: 0,
    };

    match client.invoke(&req).await {
        Ok(res) => {
            let raw_msgs = match res {
                grammers_client::tl::enums::messages::Messages::Messages(m) => {
                    total_count = Some(m.messages.len());
                    diag = format!("GetHistory:Messages len={}", m.messages.len());
                    m.messages
                }
                grammers_client::tl::enums::messages::Messages::Slice(m) => {
                    total_count = Some(m.count as usize);
                    diag = format!("GetHistory:Slice count={}, len={}", m.count, m.messages.len());
                    m.messages
                }
                grammers_client::tl::enums::messages::Messages::ChannelMessages(m) => {
                    total_count = Some(m.count as usize);
                    diag = format!("GetHistory:ChannelMessages count={}, len={}", m.count, m.messages.len());
                    m.messages
                }
                grammers_client::tl::enums::messages::Messages::NotModified(_) => {
                    diag = "GetHistory:NotModified".to_string();
                    Vec::new()
                }
            };

            for tl_msg in &raw_msgs {
                if let grammers_client::tl::enums::Message::Message(ref m) = tl_msg {
                    count += 1;
                    lowest_id = Some(lowest_id.map_or(m.id, |prev: i32| prev.min(m.id)));
                }
                if let Some(row) = tl_message_to_row(tl_msg, folder_id) {
                    rows.push(row);
                }
            }

            let is_exhausted = count < limit as usize || lowest_id.unwrap_or(0) <= 1;
            diag.push_str(&format!(", parsed_rows={}", rows.len()));
            return Ok((rows, lowest_id, is_exhausted, total_count, diag));
        }
        Err(e) => {
            diag = format!("GetHistory:Err({e})");
            eprintln!("[TG_LIST] messages.GetHistory invoke error: {e}, attempting iter_messages fallback");
        }
    }

    // Strategy B: iter_messages wrapper
    let mut iter = client.iter_messages(peer_ref).limit(limit as usize);
    if offset_id > 0 {
        iter = iter.offset_id(offset_id);
    }

    while let Ok(Some(msg)) = iter.next().await {
        count += 1;
        let id = msg.id();
        lowest_id = Some(lowest_id.map_or(id, |prev: i32| prev.min(id)));
        if min_id > 0 && id <= min_id {
            break;
        }
        if let Some(row) = tl_message_to_row(&msg.raw, folder_id) {
            rows.push(row);
        }
    }

    let is_exhausted = count < limit as usize || lowest_id.unwrap_or(0) <= 1;
    diag.push_str(&format!(", iter_count={count}, rows={}", rows.len()));
    Ok((rows, lowest_id, is_exhausted, total_count, diag))
}

/// Pure independent lane-fetch primitive for P4 multi-lane indexing.
pub async fn fetch_media_lane_page_async(
    client: &grammers_client::Client,
    session_name: &str,
    input_peer: grammers_client::tl::enums::InputPeer,
    lane: SearchLane,
    offset_id: i32,
    limit: i32,
    min_id: i32,
    top_msg_id: Option<i32>,
    folder_id: Option<i64>,
    guard: &crate::core::telegram_rpc_guard::RpcGuardControl,
) -> Result<(Vec<MediaFileRow>, Option<i32>, bool, Option<usize>, LaneRpcObservation), TgError> {
    let (filter, op_name) = match lane {
        SearchLane::PhotoVideo => (
            grammers_client::tl::enums::MessagesFilter::InputMessagesFilterPhotoVideo,
            "messages.search.photo_video",
        ),
        SearchLane::Document => (
            grammers_client::tl::enums::MessagesFilter::InputMessagesFilterDocument,
            "messages.search.document",
        ),
        SearchLane::Both => (
            grammers_client::tl::enums::MessagesFilter::InputMessagesFilterEmpty,
            "messages.search.empty",
        ),
    };

    let req = grammers_client::tl::functions::messages::Search {
        peer: input_peer,
        q: String::new(),
        from_id: None,
        saved_peer_id: None,
        saved_reaction: None,
        top_msg_id,
        filter,
        min_date: 0,
        max_date: 0,
        offset_id,
        add_offset: 0,
        limit,
        max_id: 0,
        min_id,
        hash: 0,
    };

    let start_instant = Instant::now();
    let res = crate::core::telegram_rpc_guard::invoke_guarded_with_control(
        session_name,
        crate::core::session_rate::RpcClass::IndexSearch,
        op_name,
        guard,
        || client.invoke(&req),
    )
    .await?;

    let wall_latency_ms = start_instant.elapsed().as_millis() as u64;

    let mut lane_total_count = None;
    let raw_msgs = match res.value {
        grammers_client::tl::enums::messages::Messages::Messages(m) => m.messages,
        grammers_client::tl::enums::messages::Messages::Slice(m) => {
            lane_total_count = Some(m.count as usize);
            m.messages
        }
        grammers_client::tl::enums::messages::Messages::ChannelMessages(m) => {
            lane_total_count = Some(m.count as usize);
            m.messages
        }
        grammers_client::tl::enums::messages::Messages::NotModified(_) => Vec::new(),
    };

    let raw_len = raw_msgs.len();
    let mut lowest_id = None;
    let mut rows = Vec::with_capacity(raw_len);

    for tl_msg in raw_msgs {
        if let grammers_client::tl::enums::Message::Message(ref m) = tl_msg {
            lowest_id = Some(lowest_id.map_or(m.id, |prev: i32| prev.min(m.id)));
        }
        if let Some(row) = tl_message_to_row(&tl_msg, folder_id) {
            rows.push(row);
        }
    }

    let is_exhausted = if let Some(last_id) = lowest_id {
        raw_len < limit as usize || last_id <= 1
    } else {
        true
    };

    let observation = LaneRpcObservation {
        lane,
        latency_ms: res.latency_ms,
        wall_latency_ms,
        attempts: res.attempts,
        rows_received: rows.len(),
        candidate_count: lane_total_count,
    };

    Ok((rows, lowest_id, is_exhausted, lane_total_count, observation))
}

pub async fn list_media_page_async(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    limit: usize,
    offset_id: Option<i64>,
    min_id: Option<i64>,
    topic_id: Option<i64>,
    search_cursor: Option<ScopedMediaSearchCursor>,
    max_inflight: usize,
    guard_control: Option<&crate::core::telegram_rpc_guard::RpcGuardControl>,
) -> Result<ListMediaResult, TgError> {
    let limit = limit.clamp(1, 100);
    let chat = chat_id.to_string();
    let folder_id: Option<i64> = if chat.eq_ignore_ascii_case("me") || chat == "0" {
        None
    } else {
        chat.parse().ok()
    };
    let top_msg_id = topic_id.filter(|t| *t > 0).map(|t| t as i32);
    let session_name = identity.session.clone();
    let min_id_i32 = min_id.unwrap_or(0) as i32;
    let default_guard = crate::core::telegram_rpc_guard::RpcGuardControl::default();
    let active_guard = guard_control.cloned().unwrap_or(default_guard);

    with_pool_retry(&identity.session, || {
        let chat = chat.clone();
        let session_name = session_name.clone();
        let initial_cursor = search_cursor.clone();
        let active_guard = active_guard.clone();
        with_client(sessions_dir, identity, true, move |client| {
            let active_guard = active_guard.clone();
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
                        min_id: min_id_i32,
                    };

                    let init_offset = offset_id.unwrap_or(0) as i32;
                    let mut cursor = normalize_search_cursor(initial_cursor, &current_scope, init_offset);

                    let mut latest_pv_count: Option<usize> = None;
                    let mut latest_doc_count: Option<usize> = None;
                    let mut rpc_observations: Vec<LaneRpcObservation> = Vec::new();

                    // 3. Frontier-Aware Lazy Replenishment Loop (P4.3 RPC Elision)
                    let mut merged_items: Vec<MergedMediaRow> = Vec::with_capacity(limit);

                    while merged_items.len() < limit {
                        let step = drain_provably_safe_frontier(
                            &mut cursor.pending_photo_video,
                            &mut cursor.pending_document,
                            cursor.photo_video.fetch_offset_id,
                            cursor.document.fetch_offset_id,
                            cursor.photo_video.exhausted,
                            cursor.document.exhausted,
                            limit,
                            &mut merged_items,
                        );

                        if merged_items.len() >= limit || step == FrontierStep::Finished {
                            break;
                        }

                        match step {
                            FrontierStep::FetchBoth => {
                                let pv_offset = cursor.photo_video.fetch_offset_id;
                                let doc_offset = cursor.document.fetch_offset_id;

                                if max_inflight >= 2 {
                                    // Concurrent Dual-Lane Inflight (PhotoVideo + Document parallel MTProto search)
                                    let pv_fut = fetch_media_lane_page_async(
                                        client,
                                        &session_name,
                                        input_peer.clone(),
                                        SearchLane::PhotoVideo,
                                        pv_offset,
                                        limit as i32,
                                        min_id_i32,
                                        top_msg_id,
                                        folder_id,
                                        &active_guard,
                                    );

                                    let doc_fut = fetch_media_lane_page_async(
                                        client,
                                        &session_name,
                                        input_peer.clone(),
                                        SearchLane::Document,
                                        doc_offset,
                                        limit as i32,
                                        min_id_i32,
                                        top_msg_id,
                                        folder_id,
                                        &active_guard,
                                    );

                                    let (pv_res, doc_res) = tokio::join!(pv_fut, doc_fut);

                                    let (pv_rows, pv_lowest_id, pv_exhausted, pv_count_opt, pv_obs) = pv_res?;
                                    cursor.pending_photo_video.extend(pv_rows);
                                    cursor.pending_photo_video.sort_by(|a, b| b.id.cmp(&a.id));
                                    cursor.pending_photo_video.dedup_by_key(|r| r.id);
                                    if let Some(last_id) = pv_lowest_id {
                                        cursor.photo_video.fetch_offset_id = last_id;
                                    }
                                    cursor.photo_video.exhausted = pv_exhausted;
                                    if let Some(c) = pv_count_opt {
                                        latest_pv_count = Some(c);
                                    }
                                    rpc_observations.push(pv_obs);

                                    let (doc_rows, doc_lowest_id, doc_exhausted, doc_count_opt, doc_obs) = doc_res?;
                                    cursor.pending_document.extend(doc_rows);
                                    cursor.pending_document.sort_by(|a, b| b.id.cmp(&a.id));
                                    cursor.pending_document.dedup_by_key(|r| r.id);
                                    if let Some(last_id) = doc_lowest_id {
                                        cursor.document.fetch_offset_id = last_id;
                                    }
                                    cursor.document.exhausted = doc_exhausted;
                                    if let Some(c) = doc_count_opt {
                                        latest_doc_count = Some(c);
                                    }
                                    rpc_observations.push(doc_obs);
                                } else {
                                    // Sequential Lane Replenishment
                                    let (pv_rows, pv_lowest_id, pv_exhausted, pv_count_opt, pv_obs) = fetch_media_lane_page_async(
                                        client,
                                        &session_name,
                                        input_peer.clone(),
                                        SearchLane::PhotoVideo,
                                        pv_offset,
                                        limit as i32,
                                        min_id_i32,
                                        top_msg_id,
                                        folder_id,
                                        &active_guard,
                                    )
                                    .await?;

                                    cursor.pending_photo_video.extend(pv_rows);
                                    cursor.pending_photo_video.sort_by(|a, b| b.id.cmp(&a.id));
                                    cursor.pending_photo_video.dedup_by_key(|r| r.id);
                                    if let Some(last_id) = pv_lowest_id {
                                        cursor.photo_video.fetch_offset_id = last_id;
                                    }
                                    cursor.photo_video.exhausted = pv_exhausted;
                                    if let Some(c) = pv_count_opt {
                                        latest_pv_count = Some(c);
                                    }
                                    rpc_observations.push(pv_obs);

                                    let (doc_rows, doc_lowest_id, doc_exhausted, doc_count_opt, doc_obs) = fetch_media_lane_page_async(
                                        client,
                                        &session_name,
                                        input_peer.clone(),
                                        SearchLane::Document,
                                        doc_offset,
                                        limit as i32,
                                        min_id_i32,
                                        top_msg_id,
                                        folder_id,
                                        &active_guard,
                                    )
                                    .await?;

                                    cursor.pending_document.extend(doc_rows);
                                    cursor.pending_document.sort_by(|a, b| b.id.cmp(&a.id));
                                    cursor.pending_document.dedup_by_key(|r| r.id);
                                    if let Some(last_id) = doc_lowest_id {
                                        cursor.document.fetch_offset_id = last_id;
                                    }
                                    cursor.document.exhausted = doc_exhausted;
                                    if let Some(c) = doc_count_opt {
                                        latest_doc_count = Some(c);
                                    }
                                    rpc_observations.push(doc_obs);
                                }
                            }
                            FrontierStep::FetchPv => {
                                let (rows, lowest_id, is_exhausted, count_opt, obs) = fetch_media_lane_page_async(
                                    client,
                                    &session_name,
                                    input_peer.clone(),
                                    SearchLane::PhotoVideo,
                                    cursor.photo_video.fetch_offset_id,
                                    limit as i32,
                                    min_id_i32,
                                    top_msg_id,
                                    folder_id,
                                    &active_guard,
                                )
                                .await?;

                                cursor.pending_photo_video.extend(rows);
                                cursor.pending_photo_video.sort_by(|a, b| b.id.cmp(&a.id));
                                cursor.pending_photo_video.dedup_by_key(|r| r.id);
                                if let Some(last_id) = lowest_id {
                                    cursor.photo_video.fetch_offset_id = last_id;
                                }
                                cursor.photo_video.exhausted = is_exhausted;
                                if let Some(c) = count_opt {
                                    latest_pv_count = Some(c);
                                }
                                rpc_observations.push(obs);
                            }
                            FrontierStep::FetchDoc => {
                                let (rows, lowest_id, is_exhausted, count_opt, obs) = fetch_media_lane_page_async(
                                    client,
                                    &session_name,
                                    input_peer.clone(),
                                    SearchLane::Document,
                                    cursor.document.fetch_offset_id,
                                    limit as i32,
                                    min_id_i32,
                                    top_msg_id,
                                    folder_id,
                                    &active_guard,
                                )
                                .await?;

                                cursor.pending_document.extend(rows);
                                cursor.pending_document.sort_by(|a, b| b.id.cmp(&a.id));
                                cursor.pending_document.dedup_by_key(|r| r.id);
                                if let Some(last_id) = lowest_id {
                                    cursor.document.fetch_offset_id = last_id;
                                }
                                cursor.document.exhausted = is_exhausted;
                                if let Some(c) = count_opt {
                                    latest_doc_count = Some(c);
                                }
                                rpc_observations.push(obs);
                            }
                            _ => break,
                        }
                    }

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

                    let mut fallback_diag = None;
                    if emitted_files.is_empty()
                        && (cursor.photo_video.exhausted || cursor.pending_photo_video.is_empty())
                        && (cursor.document.exhausted || cursor.pending_document.is_empty())
                    {
                        match fetch_channel_history_page_async(
                            client,
                            peer,
                            init_offset,
                            limit as i32,
                            min_id_i32,
                            folder_id,
                        )
                        .await
                        {
                            Ok((hist_rows, hist_lowest_id, hist_exhausted, hist_total, diag)) => {
                                eprintln!("[TG_LIST] History fallback returned {} rows (lowest_id: {:?}, total: {:?}, diag: {})", hist_rows.len(), hist_lowest_id, hist_total, diag);
                                fallback_diag = Some(diag);
                                if !hist_rows.is_empty() || hist_total.is_some() {
                                    emitted_files = hist_rows;
                                    if latest_pv_count.is_none() && latest_doc_count.is_none() {
                                        latest_pv_count = hist_total;
                                    }
                                    cursor.photo_video.exhausted = hist_exhausted;
                                    cursor.document.exhausted = hist_exhausted;
                                    if let Some(last_id) = hist_lowest_id {
                                        cursor.photo_video.fetch_offset_id = last_id;
                                        cursor.document.fetch_offset_id = last_id;
                                    }
                                }
                            }
                            Err(e) => {
                                fallback_diag = Some(format!("fetch_error:{e}"));
                                eprintln!("[TG_LIST] History fallback error: {e}");
                            }
                        }
                    }

                    let lane_durability = LaneDurability {
                        photo_video_drained: cursor.photo_video.exhausted && cursor.pending_photo_video.is_empty(),
                        document_drained: cursor.document.exhausted && cursor.pending_document.is_empty(),
                    };

                    let has_more = !cursor.photo_video.exhausted
                        || !cursor.document.exhausted
                        || !cursor.pending_photo_video.is_empty()
                        || !cursor.pending_document.is_empty();

                    let next_offset_id = emitted_files.last().map(|f| f.id);

                    let lane_counts = if latest_pv_count.is_some() || latest_doc_count.is_some() {
                        Some(LaneCounts {
                            photo_video: latest_pv_count,
                            document: latest_doc_count,
                        })
                    } else {
                        None
                    };

                    let total_count = match (latest_pv_count, latest_doc_count) {
                        (Some(pv), Some(doc)) => Some(pv + doc),
                        (Some(pv), None) => Some(pv),
                        (None, Some(doc)) => Some(doc),
                        (None, None) => None,
                    };

                    let pv_observation = rpc_observations.iter().rev().find(|o| o.lane == SearchLane::PhotoVideo).cloned();
                    let doc_observation = rpc_observations.iter().rev().find(|o| o.lane == SearchLane::Document).cloned();

                    Ok(ListMediaResult {
                        status: fallback_diag
                            .map(|d| format!("history_fallback: {d}"))
                            .unwrap_or_else(|| "ok".to_string()),
                        folder_id,
                        total: emitted_files.len(),
                        page_size: limit,
                        has_more,
                        next_offset_id,
                        search_cursor: Some(cursor),
                        lane_counts,
                        emitted_watermark: Some(emitted_watermark),
                        lane_durability: Some(lane_durability),
                        total_count,
                        backend: BACKEND.to_string(),
                        cached: false,
                        files: emitted_files,
                        rpc_observations,
                        pv_observation,
                        doc_observation,
                    })
                })
            })
        })
        .await
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

    #[test]
    fn extracts_multiple_distinct_urls_without_trailing_punctuation() {
        assert_eq!(
            extract_http_urls("See https://example.com/a, then https://t.me/demo. https://example.com/a"),
            vec!["https://example.com/a".to_string(), "https://t.me/demo".to_string()]
        );
    }

    #[test]
    fn extracts_utf16_entity_ranges_and_normalizes_bare_urls() {
        let text = "😀 visit example.com now";
        assert_eq!(utf16_slice(text, 9, 11).as_deref(), Some("example.com"));
        assert_eq!(
            normalize_entity_url("example.com/path").as_deref(),
            Some("https://example.com/path")
        );
        assert_eq!(
            normalize_entity_url("tg://resolve?domain=telegram").as_deref(),
            Some("tg://resolve?domain=telegram")
        );
    }

    #[test]
    fn native_delivery_uses_telegram_attributes_not_filename_extension() {
        use grammers_client::tl::{enums::DocumentAttribute, types::DocumentAttributeVideo};

        let native_video = DocumentAttribute::Video(DocumentAttributeVideo {
            round_message: false,
            supports_streaming: true,
            nosound: false,
            duration: 1.0,
            w: 1280,
            h: 720,
            preload_prefix_size: None,
            video_start_ts: None,
            video_codec: None,
        });
        assert!(has_native_delivery(&[native_video]));
        assert!(!has_native_delivery(&[
            DocumentAttribute::Filename(grammers_client::tl::types::DocumentAttributeFilename {
                file_name: "sent-as-file.mp4".to_string(),
            }),
        ]));
        assert_eq!(
            fallback_document_name(19024, Some("video/mp4"), true),
            "video_19024.mp4"
        );
        assert_eq!(
            fallback_document_name(19024, Some("video/mp4"), false),
            "file_19024.mp4"
        );
    }

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
                min_id: 0,
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
            min_id: 0,
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
                min_id: 0,
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
            min_id: 0,
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
                min_id: 0,
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
            min_id: 0,
        };

        let normalized = normalize_search_cursor(Some(stale), &new_scope, 0);
        assert_eq!(normalized.scope.account_id, "account_2");
        assert_eq!(normalized.photo_video.fetch_offset_id, 0);
    }

    #[test]
    fn test_normalize_search_cursor_scope_rejection_min_id() {
        // Delta baseline change (e.g. historical min_id 0 -> delta min_id 10000)
        let stale = ScopedMediaSearchCursor {
            scope: SearchScope {
                account_id: "user_a".to_string(),
                peer_id: "100111111".to_string(),
                topic_id: None,
                min_id: 0,
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

        let delta_scope = SearchScope {
            account_id: "user_a".to_string(),
            peer_id: "100111111".to_string(),
            topic_id: None,
            min_id: 10000,
        };

        let normalized = normalize_search_cursor(Some(stale), &delta_scope, 0);
        assert_eq!(normalized.scope.min_id, 10000);
        assert_eq!(normalized.photo_video.fetch_offset_id, 0);
        assert_eq!(normalized.document.fetch_offset_id, 0);
    }

    #[test]
    fn test_normalize_search_cursor_scope_retain_matching() {
        let valid = ScopedMediaSearchCursor {
            scope: SearchScope {
                account_id: "user_a".to_string(),
                peer_id: "100111111".to_string(),
                topic_id: None,
                min_id: 0,
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
            min_id: 0,
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
                min_id: 0,
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
                min_id: 0,
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

    #[test]
    fn test_frontier_scheduler_emits_without_refetch_when_safe() {
        let mut pv = vec![dummy_row(1050), dummy_row(1040), dummy_row(1030), dummy_row(1020)];
        let mut doc = vec![];
        let mut emitted = Vec::new();

        // DOC frontier is 1000, not exhausted. All PV rows > 1000 are provably safe to emit!
        let step = drain_provably_safe_frontier(&mut pv, &mut doc, 1000, 1000, false, false, 4, &mut emitted);
        assert_eq!(emitted.len(), 4);
        let emitted_ids: Vec<i64> = emitted.iter().map(|f| f.row.id).collect();
        assert_eq!(emitted_ids, vec![1050, 1040, 1030, 1020]);
        assert!(pv.is_empty());
        assert_eq!(step, FrontierStep::Finished);
    }

    #[test]
    fn test_frontier_scheduler_fetches_when_candidate_crosses_other_frontier() {
        let mut pv = vec![dummy_row(990)];
        let mut doc = vec![];
        let mut emitted = Vec::new();

        // DOC frontier is 1000, not exhausted. PV item 990 <= 1000 cannot be emitted blindly!
        let step = drain_provably_safe_frontier(&mut pv, &mut doc, 1000, 1000, false, false, 4, &mut emitted);
        assert_eq!(emitted.len(), 0, "Candidate <= other frontier must NOT be emitted blindly");
        assert_eq!(step, FrontierStep::FetchDoc);
        assert_eq!(pv.len(), 1);
    }

    #[test]
    fn test_frontier_equal_boundary_requires_fetch() {
        let mut pv = vec![dummy_row(1000)];
        let mut doc = vec![];
        let mut emitted = Vec::new();

        // Boundary test: PV item 1000 == DOC frontier 1000. Strict inequality (> vs >=) MUST trigger FetchDoc!
        let step = drain_provably_safe_frontier(&mut pv, &mut doc, 1000, 1000, false, false, 1, &mut emitted);
        assert_eq!(emitted.len(), 0);
        assert_eq!(step, FrontierStep::FetchDoc, "Exact equal boundary must require fetching other lane");
    }

    #[test]
    fn test_unknown_initial_frontier_requires_fetch() {
        let mut pv = vec![dummy_row(5000)];
        let mut doc = vec![];
        let mut emitted = Vec::new();

        // doc_offset == 0 represents uninitialized/unknown frontier -> MUST FETCH DOC
        let step = drain_provably_safe_frontier(&mut pv, &mut doc, 5000, 0, false, false, 1, &mut emitted);
        assert_eq!(emitted.len(), 0);
        assert_eq!(step, FrontierStep::FetchDoc);
    }

    #[test]
    fn test_existing_200_buffered_rows_can_serve_next_page_without_rpc() {
        let mut pv: Vec<MediaFileRow> = (101..=200).rev().map(dummy_row).collect();
        let mut doc: Vec<MediaFileRow> = (1..=100).rev().map(dummy_row).collect();

        let mut page1 = Vec::new();
        let step1 = drain_provably_safe_frontier(&mut pv, &mut doc, 100, 1, true, true, 100, &mut page1);
        assert_eq!(page1.len(), 100);
        assert_eq!(page1[0].row.id, 200);
        assert_eq!(page1[99].row.id, 101);
        assert_eq!(step1, FrontierStep::Finished);

        let mut page2 = Vec::new();
        let step2 = drain_provably_safe_frontier(&mut pv, &mut doc, 100, 1, true, true, 100, &mut page2);
        assert_eq!(page2.len(), 100);
        assert_eq!(page2[0].row.id, 100);
        assert_eq!(page2[99].row.id, 1);
        assert_eq!(step2, FrontierStep::Finished);

        assert!(pv.is_empty());
        assert!(doc.is_empty());
    }

    #[test]
    fn test_one_exhausted_lane_never_refetched() {
        let mut pv = vec![];
        let mut doc = vec![];
        let mut emitted = Vec::new();

        // PV is exhausted, DOC is not -> scheduler MUST ONLY request FetchDoc
        let step = drain_provably_safe_frontier(&mut pv, &mut doc, 50, 50, true, false, 10, &mut emitted);
        assert_eq!(step, FrontierStep::FetchDoc);

        // DOC is exhausted, PV is not -> scheduler MUST ONLY request FetchPv
        let step2 = drain_provably_safe_frontier(&mut pv, &mut doc, 50, 50, false, true, 10, &mut emitted);
        assert_eq!(step2, FrontierStep::FetchPv);
    }

    #[test]
    fn test_sparse_doc_lane_cannot_starve() {
        // PV has 100 items (1000..901). DOC has 1 item at 950 (matching PV 950 cross-lane duplicate).
        let mut pv: Vec<MediaFileRow> = (901..=1000).rev().map(dummy_row).collect();
        let mut doc: Vec<MediaFileRow> = vec![dummy_row(950)];
        let mut emitted = Vec::new();

        // 1. First drain: emits 1000..951 (50 items) + 950 (1 item from Both).
        // Since DOC buffer is now empty and doc_offset = 950, next PV candidate (949) <= 950 requires FetchDoc!
        let step1 = drain_provably_safe_frontier(&mut pv, &mut doc, 901, 950, true, false, 100, &mut emitted);
        assert_eq!(step1, FrontierStep::FetchDoc, "Scheduler must pause PV emission and fetch DOC at boundary");
        assert_eq!(emitted.len(), 51); // 1000..951 (50 items) + 950 (1 item via EmitBoth)
        assert_eq!(emitted[0].row.id, 1000);
        assert_eq!(emitted[50].row.id, 950);
        assert_eq!(emitted[50].lane, SearchLane::Both, "Matching cross-lane 950 must be tagged Both and deduplicated");

        // 2. DOC search completes and finds no more items (doc_exhausted = true)
        let step2 = drain_provably_safe_frontier(&mut pv, &mut doc, 901, 950, true, true, 100, &mut emitted);
        assert_eq!(step2, FrontierStep::Finished);
        assert_eq!(emitted.len(), 100); // exactly 100 unique items (950 deduplicated)
        assert_eq!(emitted[51].row.id, 949);
        assert_eq!(emitted[99].row.id, 901);
        assert!(pv.is_empty());
        assert!(doc.is_empty());
    }

    #[test]
    fn test_frontier_scheduler_matches_full_reference_merge_scale() {
        for scale in [1_000, 10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000] {
            // Generate synthetic descending streams for PV and DOC
            let pv_all: Vec<MediaFileRow> = (1..=(scale as i64))
                .filter(|id| id % 2 == 0 || id % 7 == 0)
                .rev()
                .map(dummy_row)
                .collect();
            let doc_all: Vec<MediaFileRow> = (1..=(scale as i64))
                .filter(|id| id % 3 == 0 || id % 7 == 0)
                .rev()
                .map(dummy_row)
                .collect();

            // Reference merge: full concat, sort descending, dedup by ID
            let mut reference = Vec::with_capacity(pv_all.len() + doc_all.len());
            reference.extend(pv_all.iter().map(|r| r.id));
            reference.extend(doc_all.iter().map(|r| r.id));
            reference.sort_unstable_by(|a, b| b.cmp(a));
            reference.dedup();

            // Paginated simulated frontier scheduler merge using O(1) cursor indexing
            let mut emitted_stream = Vec::with_capacity(reference.len());
            let mut pending_pv = Vec::new();
            let mut pending_doc = Vec::new();
            let mut pv_cursor = 0usize;
            let mut doc_cursor = 0usize;
            let mut pv_offset = 0i32;
            let mut doc_offset = 0i32;
            let mut pv_exhausted = false;
            let mut doc_exhausted = false;

            let page_limit = 100usize;

            while emitted_stream.len() < reference.len() {
                let mut page_emitted = Vec::new();

                while page_emitted.len() < page_limit {
                    let step = drain_provably_safe_frontier(
                        &mut pending_pv,
                        &mut pending_doc,
                        pv_offset,
                        doc_offset,
                        pv_exhausted,
                        doc_exhausted,
                        page_limit,
                        &mut page_emitted,
                    );

                    if page_emitted.len() >= page_limit || step == FrontierStep::Finished {
                        break;
                    }

                    match step {
                        FrontierStep::FetchBoth => {
                            // Replenish PV chunk in O(1) via slice
                            if !pv_exhausted {
                                let rem = pv_all.len() - pv_cursor;
                                let take_cnt = 100.min(rem);
                                if take_cnt > 0 {
                                    let chunk = &pv_all[pv_cursor..pv_cursor + take_cnt];
                                    pv_cursor += take_cnt;
                                    if let Some(last) = chunk.last() {
                                        pv_offset = last.id as i32;
                                    }
                                    pending_pv.extend_from_slice(chunk);
                                }
                                if pv_cursor >= pv_all.len() {
                                    pv_exhausted = true;
                                }
                            }
                            // Replenish DOC chunk in O(1) via slice
                            if !doc_exhausted {
                                let rem = doc_all.len() - doc_cursor;
                                let take_cnt = 100.min(rem);
                                if take_cnt > 0 {
                                    let chunk = &doc_all[doc_cursor..doc_cursor + take_cnt];
                                    doc_cursor += take_cnt;
                                    if let Some(last) = chunk.last() {
                                        doc_offset = last.id as i32;
                                    }
                                    pending_doc.extend_from_slice(chunk);
                                }
                                if doc_cursor >= doc_all.len() {
                                    doc_exhausted = true;
                                }
                            }
                        }
                        FrontierStep::FetchPv => {
                            if !pv_exhausted {
                                let rem = pv_all.len() - pv_cursor;
                                let take_cnt = 100.min(rem);
                                if take_cnt > 0 {
                                    let chunk = &pv_all[pv_cursor..pv_cursor + take_cnt];
                                    pv_cursor += take_cnt;
                                    if let Some(last) = chunk.last() {
                                        pv_offset = last.id as i32;
                                    }
                                    pending_pv.extend_from_slice(chunk);
                                }
                                if pv_cursor >= pv_all.len() {
                                    pv_exhausted = true;
                                }
                            }
                        }
                        FrontierStep::FetchDoc => {
                            if !doc_exhausted {
                                let rem = doc_all.len() - doc_cursor;
                                let take_cnt = 100.min(rem);
                                if take_cnt > 0 {
                                    let chunk = &doc_all[doc_cursor..doc_cursor + take_cnt];
                                    doc_cursor += take_cnt;
                                    if let Some(last) = chunk.last() {
                                        doc_offset = last.id as i32;
                                    }
                                    pending_doc.extend_from_slice(chunk);
                                }
                                if doc_cursor >= doc_all.len() {
                                    doc_exhausted = true;
                                }
                            }
                        }
                        _ => break,
                    }
                }

                if page_emitted.is_empty() {
                    break;
                }
                for item in page_emitted {
                    emitted_stream.push(item.row.id);
                }
            }

            assert_eq!(
                emitted_stream.len(),
                reference.len(),
                "Scale {scale}: emitted count must match reference exactly"
            );
            assert_eq!(
                emitted_stream, reference,
                "Scale {scale}: emitted sequence must be 100% identical to reference descending order"
            );
        }
    }

}
