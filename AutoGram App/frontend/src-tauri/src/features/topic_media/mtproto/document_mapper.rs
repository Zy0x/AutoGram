//! Converts Grammers TL Message / Media into normalized TopicMediaItem domain models.

use grammers_client::tl;
use std::time::{SystemTime, UNIX_EPOCH};

use super::super::models::{TopicMediaContext, TopicMediaItem};

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn message_to_topic_media_item(
    ctx: &TopicMediaContext,
    msg: &tl::enums::Message,
) -> Option<TopicMediaItem> {
    let m = match msg {
        tl::enums::Message::Message(m) => m,
        tl::enums::Message::Service(s) => {
            crate::core::tg_log::info(
                "grammers",
                "media_list_rejected_no_media",
                format!(
                    "op=media_list_rejected_no_media peer_id={} message_id={} message_variant=MessageService has_media=false raw_media_variant=None",
                    ctx.peer_id, s.id
                ),
            );
            return None;
        }
        tl::enums::Message::Empty(e) => {
            crate::core::tg_log::info(
                "grammers",
                "media_list_rejected_no_media",
                format!(
                    "op=media_list_rejected_no_media peer_id={} message_id={} message_variant=MessageEmpty has_media=false raw_media_variant=None",
                    ctx.peer_id, e.id
                ),
            );
            return None;
        }
    };

    let message_id = m.id as i64;
    let message_date = m.date as i64;
    let text = m.message.trim();
    let caption = if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    };

    let now = now_unix();

    if let Some(ref media) = m.media {
        match media {
            tl::enums::MessageMedia::Photo(photo_media) => {
                let file_name = match caption {
                    Some(ref c) => format!("{c}.jpg"),
                    None => format!("photo_{message_id}.jpg"),
                };
                let mut photo_size = 0u64;
                let mut p_width: Option<i32> = None;
                let mut p_height: Option<i32> = None;
                if let Some(tl::enums::Photo::Photo(photo)) = &photo_media.photo {
                    for s in &photo.sizes {
                        match s {
                            tl::enums::PhotoSize::Size(sz) => {
                                photo_size = photo_size.max(sz.size as u64);
                                if sz.w > 0 && sz.h > 0 {
                                    p_width = Some(sz.w);
                                    p_height = Some(sz.h);
                                }
                            }
                            tl::enums::PhotoSize::Progressive(pr) => {
                                if let Some(&max_sz) = pr.sizes.iter().max() {
                                    photo_size = photo_size.max(max_sz as u64);
                                }
                                if pr.w > 0 && pr.h > 0 {
                                    p_width = Some(pr.w);
                                    p_height = Some(pr.h);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                Some(TopicMediaItem {
                    account_id: ctx.account_id.clone(),
                    peer_id: ctx.peer_id.clone(),
                    topic_id: ctx.topic_id,
                    message_id,
                    message_date,
                    edit_date: None,
                    grouped_id: m.grouped_id,
                    sender_id: None,
                    caption,
                    media_type: "photo".to_string(),
                    mime_type: Some("image/jpeg".to_string()),
                    file_name,
                    file_size: photo_size,
                    document_id: None,
                    access_hash: None,
                    dc_id: None,
                    file_reference: None,
                    width: p_width,
                    height: p_height,
                    duration_ms: None,
                    has_server_thumb: true,
                    has_video_thumb: false,
                    thumb_url: None,
                    is_deleted: false,
                    created_at: now,
                    updated_at: now,
                })
            }
            tl::enums::MessageMedia::Document(doc_media) => {
                let doc = match &doc_media.document {
                    Some(tl::enums::Document::Document(d)) => d,
                    _ => return None,
                };

                let mut raw_name: Option<String> = None;
                let mut mime: Option<String> = Some(doc.mime_type.clone());

                for attr in &doc.attributes {
                    if let tl::enums::DocumentAttribute::Filename(f) = attr {
                        raw_name = Some(f.file_name.clone());
                    }
                }

                let file_name = raw_name
                    .or_else(|| caption.clone())
                    .unwrap_or_else(|| format!("file_{message_id}"));

                let mime_l = mime.as_deref().unwrap_or("").to_ascii_lowercase();
                let name_l = file_name.to_ascii_lowercase();

                let is_video = mime_l.starts_with("video/")
                    || name_l.ends_with(".mp4")
                    || name_l.ends_with(".mov")
                    || name_l.ends_with(".mkv")
                    || name_l.ends_with(".webm")
                    || name_l.ends_with(".avi");

                let is_audio = mime_l.starts_with("audio/")
                    || name_l.ends_with(".mp3")
                    || name_l.ends_with(".wav")
                    || name_l.ends_with(".flac")
                    || name_l.ends_with(".m4a");

                let is_image = mime_l.starts_with("image/")
                    || name_l.ends_with(".jpg")
                    || name_l.ends_with(".png")
                    || name_l.ends_with(".webp")
                    || name_l.ends_with(".gif");

                let media_type = if is_video {
                    "video"
                } else if is_audio {
                    "audio"
                } else if is_image {
                    "photo"
                } else {
                    "document"
                };

                let has_thumb = doc.thumbs.as_ref().map(|t| !t.is_empty()).unwrap_or(false);

                Some(TopicMediaItem {
                    account_id: ctx.account_id.clone(),
                    peer_id: ctx.peer_id.clone(),
                    topic_id: ctx.topic_id,
                    message_id,
                    message_date,
                    edit_date: None,
                    grouped_id: m.grouped_id,
                    sender_id: None,
                    caption,
                    media_type: media_type.to_string(),
                    mime_type: mime,
                    file_name,
                    file_size: doc.size as u64,
                    document_id: Some(doc.id),
                    access_hash: Some(doc.access_hash),
                    dc_id: Some(doc.dc_id as i32),
                    file_reference: Some(doc.file_reference.clone()),
                    width: None,
                    height: None,
                    duration_ms: None,
                    has_server_thumb: has_thumb,
                    has_video_thumb: is_video,
                    thumb_url: None,
                    is_deleted: false,
                    created_at: now,
                    updated_at: now,
                })
            }
            _ => {
                crate::core::tg_log::info(
                    "grammers",
                    "media_list_rejected_no_media",
                    format!(
                        "op=media_list_rejected_no_media peer_id={} message_id={} message_variant=Message has_media=false raw_media_variant=OtherOrNone",
                        ctx.peer_id, message_id
                    ),
                );
                None
            }
        }
    } else {
        crate::core::tg_log::info(
            "grammers",
            "media_list_rejected_no_media",
            format!(
                "op=media_list_rejected_no_media peer_id={} message_id={} message_variant=Message has_media=false raw_media_variant=None",
                ctx.peer_id, message_id
            ),
        );
        None
    }
}
