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

#[path = "media_list/search_contract.rs"]
mod search_contract;
pub use search_contract::*;

#[path = "media_list/filtered_query.rs"]
mod filtered_query;
pub use filtered_query::*;

pub fn media_to_row(
    msg: &grammers_client::message::Message,
    folder_id: Option<i64>,
) -> Option<MediaFileRow> {
    use grammers_client::media::Media;
    let id = msg.id() as i64;
    let created = Some(msg.date().to_rfc3339());
    let caption = msg.text().trim();
    let caption_opt = (!caption.is_empty()).then(|| caption.to_string());
    let caption_urls = extract_http_urls(caption);
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
            // Telegram photos do not carry a filename. Captions are message
            // text and may contain dates, URLs or dotted sentences, so using
            // them as a filename produces false extensions and stale index
            // identities. Keep identity deterministic and metadata-derived.
            let name = canonical_photo_name(id);
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
                drive_format: Some(if caption_urls.is_empty() {
                    cls.drive_format
                } else {
                    caption_urls.join("\n")
                }),
                caption: caption_opt,
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
            let (native_delivery, is_sticker, is_animated) = match doc.raw.document.as_ref() {
                Some(grammers_client::tl::enums::Document::Document(raw)) => (
                    has_native_delivery(&raw.attributes),
                    has_sticker_attribute(&raw.attributes),
                    raw.attributes.iter().any(|a| matches!(a, grammers_client::tl::enums::DocumentAttribute::Animated)),
                ),
                _ => (false, false, false),
            };
            let n = doc
                .name()
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| {
                    if is_sticker {
                        let alt = match doc.raw.document.as_ref() {
                            Some(grammers_client::tl::enums::Document::Document(raw)) => {
                                raw.attributes.iter().find_map(|attr| {
                                    if let grammers_client::tl::enums::DocumentAttribute::Sticker(s) = attr {
                                        if !s.alt.is_empty() {
                                            return Some(s.alt.clone());
                                        }
                                    } else if let grammers_client::tl::enums::DocumentAttribute::CustomEmoji(c) = attr {
                                        if !c.alt.is_empty() {
                                            return Some(c.alt.clone());
                                        }
                                    }
                                    None
                                })
                            }
                            _ => None,
                        };
                        let ext = match mime.as_deref().unwrap_or("") {
                            "application/x-tgsticker" => "tgs",
                            "video/webm" => "webm",
                            "image/webp" => "webp",
                            "image/gif" => "gif",
                            _ => "webp",
                        };
                        if let Some(emoji) = alt {
                            format!("sticker_{emoji}_{id}.{ext}")
                        } else {
                            format!("sticker_{id}.{ext}")
                        }
                    } else {
                        fallback_document_name(id, mime.as_deref(), native_delivery)
                    }
                });
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

            let icon = if is_animated {
                "gif"
            } else if is_video_file {
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
                is_sticker,
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
                telegram_category: Some(if is_animated { "gif".into() } else { cls.telegram_category }),
                telegram_subtype: Some(if is_animated { "gif".into() } else { cls.telegram_subtype }),
                drive_category: Some(if is_animated { "animation".into() } else { cls.drive_category }),
                drive_format: Some(if is_animated { "GIF".into() } else if caption_urls.is_empty() {
                    cls.drive_format
                } else {
                    caption_urls.join("\n")
                }),
                caption: caption_opt,
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
                caption: caption_opt,
            })
        }
        _ => None,
    }
}
fn truncate_first_line(caption: &str, max_chars: usize) -> String {
    let first_line = caption.lines().next().unwrap_or(caption).trim();
    if let Some((idx, _)) = first_line.char_indices().nth(max_chars) {
        format!("{}…", &first_line[..idx])
    } else {
        first_line.to_string()
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
    let caption_opt = (!caption.is_empty()).then(|| caption.to_string());
    let message_urls = extract_message_urls(m);
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
                let name = canonical_photo_name(id);
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
                    size: if photo_size > 0 { photo_size } else { 0 },
                    mime_type: Some("image/jpeg".to_string()),
                    icon_type: "photo".to_string(),
                    created_at: created,
                    has_thumb: photo_media.photo.is_some() || thumb_data_url.is_some(),
                    as_document: false,
                    backend: BACKEND.to_string(),
                    thumb_data_url,
                    topic_id,
                    identity_source: Some("telegram_photo".into()),
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
                    drive_format: Some(if message_urls.is_empty() {
                        cls.drive_format
                    } else {
                        message_urls.join("\n")
                    }),
                    caption: caption_opt,
                })
            }
            grammers_client::tl::enums::MessageMedia::Document(doc_media) => {
                let doc = match &doc_media.document {
                    Some(grammers_client::tl::enums::Document::Document(d)) => d,
                    _ => return None,
                };
                let mut raw_name = None;
                for attr in &doc.attributes {
                    if let grammers_client::tl::enums::DocumentAttribute::Filename(f) = attr {
                        if !f.file_name.is_empty() {
                            raw_name = Some(f.file_name.clone());
                            break;
                        }
                    }
                }
                let native_delivery = has_native_delivery(&doc.attributes);
                let is_sticker = has_sticker_attribute(&doc.attributes);
                let is_animated = doc.attributes.iter().any(|attr| matches!(attr, grammers_client::tl::enums::DocumentAttribute::Animated));
                let name = raw_name.unwrap_or_else(|| {
                    if is_sticker {
                        let alt = doc.attributes.iter().find_map(|attr| {
                            if let grammers_client::tl::enums::DocumentAttribute::Sticker(s) = attr {
                                if !s.alt.is_empty() {
                                    return Some(s.alt.clone());
                                }
                            } else if let grammers_client::tl::enums::DocumentAttribute::CustomEmoji(c) = attr {
                                if !c.alt.is_empty() {
                                    return Some(c.alt.clone());
                                }
                            }
                            None
                        });
                        let ext = match doc.mime_type.as_str() {
                            "application/x-tgsticker" => "tgs",
                            "video/webm" => "webm",
                            "image/webp" => "webp",
                            "image/gif" => "gif",
                            _ => "webp",
                        };
                        if let Some(emoji) = alt {
                            format!("sticker_{emoji}_{id}.{ext}")
                        } else {
                            format!("sticker_{id}.{ext}")
                        }
                    } else {
                        fallback_document_name(id, Some(&doc.mime_type), native_delivery)
                    }
                });
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

                let icon_type = if is_animated {
                    "gif".to_string()
                } else if is_video {
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
                    is_sticker,
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
                    telegram_category: Some(if is_animated { "gif".to_string() } else { cls.telegram_category }),
                    telegram_subtype: Some(if is_animated { "gif".to_string() } else { cls.telegram_subtype }),
                    drive_category: Some(if is_animated { "animation".to_string() } else { cls.drive_category }),
                    drive_format: Some(if is_animated { "GIF".to_string() } else if message_urls.is_empty() {
                        cls.drive_format
                    } else {
                        message_urls.join("\n")
                    }),
                    caption: caption_opt,
                })
            }
            grammers_client::tl::enums::MessageMedia::WebPage(ref wp) => {
                // Telegram may attach a WebPage-shaped media object to service
                // text and mentions. Only expose it in the media catalogue when
                // the authoritative message actually contains a URL/entity.
                if message_urls.is_empty() {
                    return None;
                }
                let name = if caption.is_empty() {
                    format!("link_{id}")
                } else {
                    truncate_first_line(caption, 60)
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
                    size: if photo_size > 0 {
                        photo_size
                    } else {
                        caption.len() as u64
                    },
                    mime_type: Some("text/html".to_string()),
                    // A WebPage photo decorates a link preview; Telegram does
                    // not count it as a shared-media attachment.
                    icon_type: "link".to_string(),
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
                    drive_format: Some(message_urls.join("\n")),
                    caption: caption_opt,
                })
            }
            _ => {
                if !message_urls.is_empty() {
                    let name = truncate_first_line(caption, 60);
                    let icon_type = "link".to_string();
                    let cls = crate::core::media_classifier::classify_media_item(
                        &name,
                        Some("text/x-url"),
                        false,
                        false,
                        false,
                    );
                    Some(MediaFileRow {
                        id,
                        folder_id,
                        name,
                        size: caption.len() as u64,
                        mime_type: Some("text/x-url".to_string()),
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
                        drive_format: Some(message_urls.join("\n")),
                        caption: caption_opt,
                    })
                } else {
                    None
                }
            }
        }
    } else if !message_urls.is_empty() {
        let name = truncate_first_line(caption, 60);
        let cls = crate::core::media_classifier::classify_media_item(
            &name,
            Some("text/x-url"),
            false,
            false,
            false,
        );
        Some(MediaFileRow {
            id,
            folder_id,
            name,
            size: caption.len() as u64,
            mime_type: Some("text/x-url".to_string()),
            icon_type: "link".to_string(),
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
            drive_format: Some(message_urls.join("\n")),
            caption: caption_opt,
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

use autogram_core::telegram::cloud::metadata::{
    canonical_photo_name, fallback_document_name, has_native_delivery, has_sticker_attribute,
};

fn extract_http_urls(text: &str) -> Vec<String> {
    let mut urls = Vec::new();
    for token in text.split_whitespace() {
        let candidate = token
            .trim_matches(|c: char| {
                matches!(
                    c,
                    '(' | ')' | '[' | ']' | '{' | '}' | '<' | '>' | '"' | '\'' | ',' | ';'
                )
            })
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

pub(super) fn tl_link_to_row(
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
    let caption = m.message.trim();
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
            .map(|value| {
                if value == 0 {
                    "me".into()
                } else {
                    value.to_string()
                }
            })
            .or_else(|| Some("me".into())),
        account_id: None,
        peer_kind: None,
        peer_username: None,
        grouped_id: m.grouped_id,
        is_saved_messages: Some(folder_id.map_or(true, |value| value == 0)),
        telegram_category: Some("link".into()),
        telegram_subtype: Some(
            if urls.len() > 1 {
                "multiple_links"
            } else {
                "single_link"
            }
            .into(),
        ),
        drive_category: Some("link".into()),
        // The ordinary media rows use this field for a short format token. A
        // link row uses it as a compact newline-separated payload so the UI
        // can render all URLs from one Telegram message without inventing fake
        // message IDs.
        drive_format: Some(urls.join("\n")),
        caption: (!caption.is_empty()).then(|| caption.to_string()),
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
    list_media_blocking_topic_cursor(
        sessions_dir,
        identity,
        chat_id,
        limit,
        offset_id,
        None,
        None,
        None,
    )
}

pub fn list_media_blocking_topic(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    limit: usize,
    offset_id: Option<i64>,
    topic_id: Option<i64>,
) -> Result<ListMediaResult, TgError> {
    list_media_blocking_topic_cursor(
        sessions_dir,
        identity,
        chat_id,
        limit,
        offset_id,
        None,
        topic_id,
        None,
    )
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
    let mut diag;

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
                    diag = format!(
                        "GetHistory:Slice count={}, len={}",
                        m.count,
                        m.messages.len()
                    );
                    m.messages
                }
                grammers_client::tl::enums::messages::Messages::ChannelMessages(m) => {
                    total_count = Some(m.count as usize);
                    diag = format!(
                        "GetHistory:ChannelMessages count={}, len={}",
                        m.count,
                        m.messages.len()
                    );
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
) -> Result<
    (
        Vec<MediaFileRow>,
        Option<i32>,
        bool,
        Option<usize>,
        LaneRpcObservation,
    ),
    TgError,
> {
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
                    let is_fresh_cursor = initial_cursor.is_none();
                    let mut cursor = normalize_search_cursor(initial_cursor, &current_scope, init_offset);

                    let mut latest_pv_count: Option<usize> = None;
                    let mut latest_doc_count: Option<usize> = None;
                    let mut rpc_observations: Vec<LaneRpcObservation> = Vec::new();

                    // Telegram MTProto strictly isolates animated GIFs into InputMessagesFilterGif.
                    // Telegram servers exclude GIFs from InputMessagesFilterPhotoVideo and InputMessagesFilterDocument.
                    // When initiating the media stream from the top of the feed (init_offset == 0 and initial_cursor is None),
                    // proactively fetch the initial batch of animated GIFs and place them in pending_document so that
                    // GIFs are chronologically interleaved with photos, videos, and documents under the All media filter.
                    if init_offset == 0 && is_fresh_cursor {
                        let gif_req = grammers_client::tl::functions::messages::Search {
                            peer: input_peer.clone(),
                            q: String::new(),
                            from_id: None,
                            saved_peer_id: None,
                            saved_reaction: None,
                            top_msg_id,
                            filter: grammers_client::tl::enums::MessagesFilter::InputMessagesFilterGif,
                            min_date: 0,
                            max_date: 0,
                            offset_id: 0,
                            add_offset: 0,
                            limit: limit as i32,
                            max_id: 0,
                            min_id: min_id_i32,
                            hash: 0,
                        };
                        if let Ok(res) = crate::core::telegram_rpc_guard::invoke_guarded_with_control(
                            &session_name,
                            crate::core::session_rate::RpcClass::IndexSearch,
                            "messages.search.gif_initial",
                            &active_guard,
                            || client.invoke(&gif_req),
                        )
                        .await
                        {
                            let gif_msgs = match res.value {
                                grammers_client::tl::enums::messages::Messages::Messages(m) => m.messages,
                                grammers_client::tl::enums::messages::Messages::Slice(m) => m.messages,
                                grammers_client::tl::enums::messages::Messages::ChannelMessages(m) => m.messages,
                                grammers_client::tl::enums::messages::Messages::NotModified(_) => Vec::new(),
                            };
                            for tl_msg in gif_msgs {
                                if let Some(row) = tl_message_to_row(&tl_msg, folder_id) {
                                    cursor.pending_document.push(row);
                                }
                            }
                            cursor.pending_document.sort_by(|a, b| b.id.cmp(&a.id));
                            cursor.pending_document.dedup_by_key(|r| r.id);
                        }
                    }

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
#[path = "media_list/tests.rs"]
mod tests;
