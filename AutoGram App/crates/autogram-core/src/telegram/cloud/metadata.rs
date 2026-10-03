//! Metadata and filename policies shared with desktop. Quality is never inferred from names.
use grammers_client::{
    media::Downloadable,
    media::{Document, Media, PhotoSize},
    message::Message,
    tl,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MediaMetadata {
    pub id: i32,
    pub name: String,
    pub size: u64,
    pub mime_type: String,
    pub modified_ms: i64,
    pub delivery_kind: String,
    pub telegram_category: String,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub duration_seconds: Option<f64>,
    pub thumbnail_bytes: Option<Vec<u8>>,
}

fn inline_thumbnail(thumbs: Vec<PhotoSize>) -> Option<Vec<u8>> {
    // Only bytes already supplied by Telegram; listing never fetches full photos.
    thumbs
        .into_iter()
        .filter(|thumb| matches!(thumb, PhotoSize::Cached(_) | PhotoSize::Stripped(_)))
        .filter_map(|thumb| thumb.to_data())
        .find(|bytes| !bytes.is_empty() && bytes.len() <= 64 * 1024)
}

pub fn has_native_delivery(attributes: &[tl::enums::DocumentAttribute]) -> bool {
    attributes.iter().any(|attr| {
        matches!(
            attr,
            tl::enums::DocumentAttribute::Video(_)
                | tl::enums::DocumentAttribute::Audio(_)
                | tl::enums::DocumentAttribute::Animated
        )
    })
}

pub fn has_sticker_attribute(attributes: &[tl::enums::DocumentAttribute]) -> bool {
    attributes.iter().any(|attr| {
        matches!(
            attr,
            tl::enums::DocumentAttribute::Sticker(_) | tl::enums::DocumentAttribute::CustomEmoji(_)
        )
    })
}

pub fn fallback_document_name(id: i64, mime: Option<&str>, native_delivery: bool) -> String {
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

pub fn canonical_photo_name(message_id: i64) -> String {
    format!("photo_{message_id}.jpg")
}

fn document_metadata(message: &Message, doc: &Document, sticker: bool) -> Option<MediaMetadata> {
    let tl::enums::Document::Document(raw) = doc.raw.document.as_ref()? else {
        return None;
    };
    let native = has_native_delivery(&raw.attributes);
    let sticker = sticker || has_sticker_attribute(&raw.attributes);
    let category = if sticker {
        "sticker"
    } else if raw
        .attributes
        .iter()
        .any(|a| matches!(a, tl::enums::DocumentAttribute::Animated))
    {
        "gif"
    } else if raw
        .attributes
        .iter()
        .any(|a| matches!(a, tl::enums::DocumentAttribute::Video(_)))
    {
        "video"
    } else if raw
        .attributes
        .iter()
        .any(|a| matches!(a, tl::enums::DocumentAttribute::Audio(_)))
    {
        "audio"
    } else {
        "file"
    };
    let resolution = doc.resolution().filter(|(w, h)| *w > 0 && *h > 0);
    Some(MediaMetadata {
        id: message.id(),
        name: doc
            .name()
            .filter(|name| !name.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| {
                fallback_document_name(i64::from(message.id()), doc.mime_type(), native)
            }),
        size: doc.size()? as u64,
        mime_type: doc.mime_type().unwrap_or("application/octet-stream").into(),
        modified_ms: message.date().timestamp_millis(),
        delivery_kind: if native || sticker {
            "native"
        } else {
            "document"
        }
        .into(),
        telegram_category: category.into(),
        width: resolution.map(|(w, _)| w),
        height: resolution.map(|(_, h)| h),
        duration_seconds: doc
            .duration()
            .filter(|value| value.is_finite() && *value >= 0.0),
        thumbnail_bytes: inline_thumbnail(doc.thumbs()),
    })
}

pub fn from_message(message: &Message) -> Option<MediaMetadata> {
    match message.media()? {
        Media::Photo(photo) => Some(MediaMetadata {
            id: message.id(),
            name: canonical_photo_name(i64::from(message.id())),
            size: photo.size()? as u64,
            mime_type: "image/jpeg".into(),
            modified_ms: message.date().timestamp_millis(),
            delivery_kind: "native".into(),
            telegram_category: "photo".into(),
            width: None,
            height: None,
            duration_seconds: None,
            thumbnail_bytes: inline_thumbnail(photo.thumbs()),
        }),
        Media::Document(doc) => document_metadata(message, &doc, false),
        Media::Sticker(sticker) => document_metadata(message, &sticker.document, true),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deterministic_photo_filename_is_not_caption() {
        assert_eq!(canonical_photo_name(321), "photo_321.jpg");
    }
    #[test]
    fn document_delivery_requires_attributes() {
        assert!(!has_native_delivery(&[]));
        assert!(has_native_delivery(&[
            tl::enums::DocumentAttribute::Animated
        ]));
        assert!(!has_sticker_attribute(&[
            tl::enums::DocumentAttribute::Animated
        ]));
    }
    #[test]
    fn filename_fallback_preserves_desktop_rules() {
        assert_eq!(
            fallback_document_name(2, Some("video/webm"), false),
            "file_2.webm"
        );
        assert_eq!(
            fallback_document_name(2, Some("video/webm"), true),
            "video_2.webm"
        );
        assert_eq!(fallback_document_name(3, None, false), "file_3.bin");
    }
}
