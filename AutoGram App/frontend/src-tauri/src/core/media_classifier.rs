//! media_classifier.rs — Dual-Perspective Media Intelligence Classifier (Rust)
//!
//! Classifies media messages into two distinct perspectives:
//! 1. Telegram View: How Telegram / Nekogram / Nagram categorize messages (Media, Files, Links, GIFs, Audio, Stickers).
//! 2. Drive View: Actual file content / MIME perspective (Images, Videos, Audio, Documents, Archives, Web).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaCategory {
    ImageConsumer,
    ImageProfessional,
    VideoConsumer,
    VideoProduction,
    AudioConsumer,
    AudioLossless,
    BinaryAsset,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationResult {
    pub telegram_category: String, // "media" | "file" | "link" | "gif" | "audio" | "sticker"
    pub telegram_subtype: String,  // "photo" | "video" | "doc_photo" | "doc_video" | "archive" | "pdf" | "docx" | "url" | "music" | "voice" | "other"
    pub drive_category: String,    // "image" | "video" | "audio" | "document" | "archive" | "web"
    pub drive_format: String,      // "MP4" | "MKV" | "JPG" | "PNG" | "PDF" | "ZIP" | "URL" | etc.
    pub media_category: MediaCategory, // Spec v4.3 typed media category
}

pub fn classify_media_category(file_name: &str, mime_type: Option<&str>) -> MediaCategory {
    let name_l = file_name.to_lowercase();
    let mime_l = mime_type.unwrap_or("").to_lowercase();

    if name_l.ends_with(".cr2")
        || name_l.ends_with(".nef")
        || name_l.ends_with(".arw")
        || name_l.ends_with(".dng")
        || name_l.ends_with(".psd")
        || name_l.ends_with(".tiff")
    {
        MediaCategory::ImageProfessional
    } else if mime_l.starts_with("image/")
        || name_l.ends_with(".jpg")
        || name_l.ends_with(".jpeg")
        || name_l.ends_with(".png")
        || name_l.ends_with(".webp")
    {
        MediaCategory::ImageConsumer
    } else if name_l.ends_with(".prores")
        || name_l.ends_with(".dnxhd")
        || name_l.ends_with(".r3d")
        || name_l.ends_with(".m2ts")
    {
        MediaCategory::VideoProduction
    } else if mime_l.starts_with("video/")
        || name_l.ends_with(".mp4")
        || name_l.ends_with(".mov")
        || name_l.ends_with(".mkv")
        || name_l.ends_with(".webm")
    {
        MediaCategory::VideoConsumer
    } else if name_l.ends_with(".flac") || name_l.ends_with(".wav") || name_l.ends_with(".alac") {
        MediaCategory::AudioLossless
    } else if mime_l.starts_with("audio/")
        || name_l.ends_with(".mp3")
        || name_l.ends_with(".m4a")
        || name_l.ends_with(".aac")
        || name_l.ends_with(".ogg")
    {
        MediaCategory::AudioConsumer
    } else if name_l.ends_with(".exe")
        || name_l.ends_with(".zip")
        || name_l.ends_with(".iso")
        || name_l.ends_with(".bin")
        || name_l.ends_with(".pdf")
    {
        MediaCategory::BinaryAsset
    } else {
        MediaCategory::Unknown
    }
}

pub fn classify_media_item(
    file_name: &str,
    mime_type: Option<&str>,
    as_document: bool,
    is_photo_msg: bool,
    is_sticker: bool,
) -> ClassificationResult {
    let name_l = file_name.to_lowercase();
    let mime_l = mime_type.unwrap_or("").to_lowercase();
    let media_category = classify_media_category(file_name, mime_type);

    let ext = name_l
        .rfind('.')
        .map(|idx| name_l[idx + 1..].to_uppercase())
        .unwrap_or_else(|| {
            if is_photo_msg {
                "JPG".to_string()
            } else if mime_l.starts_with("image/") {
                "IMG".to_string()
            } else if mime_l.starts_with("video/") {
                "MP4".to_string()
            } else if mime_l.starts_with("audio/") {
                "MP3".to_string()
            } else {
                "FILE".to_string()
            }
        });

    // 0. Check if Restricted / Inaccessible Notice
    let is_restricted_notice = name_l.contains("can't be displayed")
        || name_l.contains("can’t be displayed")
        || name_l.contains("cannot be displayed")
        || name_l.contains("can not be displayed")
        || name_l.contains("tidak dapat ditampilkan")
        || name_l.contains("is not available")
        || name_l.contains("tidak tersedia")
        || name_l.contains("channel blocked")
        || name_l.contains("banned channel")
        || name_l.contains("saluran diblokir");

    if is_restricted_notice {
        return ClassificationResult {
            telegram_category: "restricted".into(),
            telegram_subtype: "notice".into(),
            drive_category: "restricted".into(),
            drive_format: "RESTRICTED".into(),
            media_category: MediaCategory::Unknown,
        };
    }

    // 1. Check if this row is an actual URL-only message. A native Telegram
    // photo/video can have a caption that starts with a URL; in that case the
    // payload remains media and the URL is indexed independently by the Link
    // lane (InputMessagesFilterUrl). Never let caption text replace the media
    // identity shown on the All/Media grids.
    let has_native_visual_payload = is_photo_msg
        || mime_l.starts_with("image/")
        || mime_l.starts_with("video/")
        || mime_l.starts_with("audio/");
    if !has_native_visual_payload
        && (mime_l == "text/x-url"
            || name_l.starts_with("http://")
            || name_l.starts_with("https://"))
    {
        return ClassificationResult {
            telegram_category: "link".into(),
            telegram_subtype: "url".into(),
            drive_category: "web".into(),
            drive_format: "URL".into(),
            media_category,
        };
    }

    // 2. Check if Sticker
    if is_sticker || mime_l == "image/webp" && name_l.starts_with("sticker_") {
        return ClassificationResult {
            telegram_category: "sticker".into(),
            telegram_subtype: "sticker".into(),
            drive_category: "image".into(),
            drive_format: "WEBP".into(),
            media_category,
        };
    }

    // Determine content type flags
    let is_video_format = mime_l.starts_with("video/")
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

    let is_gif_format = mime_l == "image/gif" || name_l.ends_with(".gif");

    let is_image_format = is_photo_msg
        || mime_l.starts_with("image/")
        || name_l.ends_with(".jpg")
        || name_l.ends_with(".jpeg")
        || name_l.ends_with(".png")
        || name_l.ends_with(".webp")
        || name_l.ends_with(".bmp")
        || name_l.ends_with(".tiff")
        || name_l.ends_with(".heic")
        || name_l.ends_with(".heif")
        || is_gif_format;

    let is_audio_format = mime_l.starts_with("audio/")
        || name_l.ends_with(".mp3")
        || name_l.ends_with(".wav")
        || name_l.ends_with(".flac")
        || name_l.ends_with(".m4a")
        || name_l.ends_with(".aac")
        || name_l.ends_with(".ogg")
        || name_l.ends_with(".opus");

    let is_archive_format = name_l.ends_with(".zip")
        || name_l.ends_with(".rar")
        || name_l.ends_with(".7z")
        || name_l.ends_with(".tar")
        || name_l.ends_with(".gz")
        || name_l.ends_with(".bz2")
        || name_l.ends_with(".iso")
        || mime_l.contains("zip")
        || mime_l.contains("compressed")
        || mime_l.contains("archive");

    let is_doc_format = name_l.ends_with(".pdf")
        || name_l.ends_with(".docx")
        || name_l.ends_with(".doc")
        || name_l.ends_with(".xlsx")
        || name_l.ends_with(".xls")
        || name_l.ends_with(".pptx")
        || name_l.ends_with(".ppt")
        || name_l.ends_with(".txt")
        || name_l.ends_with(".csv")
        || mime_l.contains("pdf")
        || mime_l.contains("document")
        || mime_l.contains("spreadsheet")
        || mime_l.contains("presentation");

    let is_web_link = mime_l == "text/x-url"
        || mime_l == "text/html"
        || name_l.starts_with("http://")
        || name_l.starts_with("https://")
        || name_l.starts_with("t.me/")
        || name_l.contains("t.me/");

    let has_file_extension = name_l.rfind('.').map_or(false, |idx| {
        let extension = &name_l[idx + 1..];
        !extension.is_empty() && extension.len() <= 10 && extension.chars().all(|c| c.is_ascii_alphanumeric())
    });

    let is_actual_document = as_document || is_archive_format || is_doc_format || (has_file_extension && !is_web_link && mime_l != "text/plain" && mime_l != "text/html");

    // Telegram View Classification
    let (telegram_category, telegram_subtype) = if is_photo_msg {
        ("media".to_string(), "photo".to_string())
    } else if is_gif_format {
        ("gif".to_string(), "gif".to_string())
    } else if is_video_format {
        if as_document {
            ("file".to_string(), "doc_video".to_string())
        } else {
            ("media".to_string(), "video".to_string())
        }
    } else if is_image_format {
        if as_document {
            ("file".to_string(), "doc_photo".to_string())
        } else {
            ("media".to_string(), "photo".to_string())
        }
    } else if is_audio_format {
        ("audio".to_string(), "music".to_string())
    } else if is_web_link {
        ("link".to_string(), "url".to_string())
    } else if is_actual_document {
        let sub = if is_archive_format {
            "archive"
        } else if name_l.ends_with(".pdf") {
            "pdf"
        } else if name_l.ends_with(".docx") || name_l.ends_with(".doc") {
            "docx"
        } else if name_l.ends_with(".apk") {
            "apk"
        } else {
            "other"
        };
        ("file".to_string(), sub.to_string())
    } else {
        ("text".to_string(), "text".to_string())
    };

    // Drive View Classification (by true content)
    let drive_category = if is_image_format {
        "image".to_string()
    } else if is_video_format {
        "video".to_string()
    } else if is_audio_format {
        "audio".to_string()
    } else if is_archive_format {
        "archive".to_string()
    } else if is_doc_format || is_actual_document {
        "document".to_string()
    } else if is_web_link {
        "web".to_string()
    } else {
        "text".to_string()
    };

    ClassificationResult {
        telegram_category,
        telegram_subtype,
        drive_category,
        drive_format: ext,
        media_category,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_media_category_classification() {
        assert_eq!(
            classify_media_category("photo.jpg", Some("image/jpeg")),
            MediaCategory::ImageConsumer
        );
        assert_eq!(
            classify_media_category("raw_photo.cr2", Some("image/x-canon-cr2")),
            MediaCategory::ImageProfessional
        );
        assert_eq!(
            classify_media_category("video.mp4", Some("video/mp4")),
            MediaCategory::VideoConsumer
        );
        assert_eq!(
            classify_media_category("song.flac", Some("audio/flac")),
            MediaCategory::AudioLossless
        );
        assert_eq!(
            classify_media_category("data.zip", Some("application/zip")),
            MediaCategory::BinaryAsset
        );
    }

    #[test]
    fn test_restricted_notice_classification() {
        let ascii_res = classify_media_item(
            "This channel can't be displayed because it was used to spread...",
            Some("text/plain"),
            false,
            false,
            false,
        );
        assert_eq!(ascii_res.telegram_category, "restricted");
        assert_eq!(ascii_res.drive_category, "restricted");

        let curly_res = classify_media_item(
            "This channel can’t be displayed because it was used to spread...",
            Some("text/plain"),
            false,
            false,
            false,
        );
        assert_eq!(curly_res.telegram_category, "restricted");
        assert_eq!(curly_res.drive_category, "restricted");

        let id_res = classify_media_item(
            "Saluran ini tidak dapat ditampilkan karena melanggar hak cipta",
            Some("text/plain"),
            false,
            false,
            false,
        );
        assert_eq!(id_res.telegram_category, "restricted");
        assert_eq!(id_res.drive_category, "restricted");
    }

    #[test]
    fn native_media_caption_starting_with_url_stays_media() {
        let photo = classify_media_item(
            "https://t.me/example caption",
            Some("image/jpeg"),
            false,
            true,
            false,
        );
        assert_eq!(photo.telegram_category, "media");
        assert_eq!(photo.telegram_subtype, "photo");
        assert_eq!(photo.drive_category, "image");

        let video = classify_media_item(
            "https://example.com/watch",
            Some("video/mp4"),
            false,
            false,
            false,
        );
        assert_eq!(video.telegram_category, "media");
        assert_eq!(video.telegram_subtype, "video");

        let link = classify_media_item(
            "https://example.com/watch",
            Some("text/x-url"),
            false,
            false,
            false,
        );
        assert_eq!(link.telegram_category, "link");
        assert_eq!(link.drive_format, "URL");
    }
}
