//! media_classifier.rs — Dual-Perspective Media Intelligence Classifier (Rust)
//!
//! Classifies media messages into two distinct perspectives:
//! 1. Telegram View: How Telegram / Nekogram / Nagram categorize messages (Media, Files, Links, GIFs, Audio, Stickers).
//! 2. Drive View: Actual file content / MIME perspective (Images, Videos, Audio, Documents, Archives, Web).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationResult {
    pub telegram_category: String, // "media" | "file" | "link" | "gif" | "audio" | "sticker"
    pub telegram_subtype: String,  // "photo" | "video" | "doc_photo" | "doc_video" | "archive" | "pdf" | "docx" | "url" | "music" | "voice" | "other"
    pub drive_category: String,    // "image" | "video" | "audio" | "document" | "archive" | "web"
    pub drive_format: String,      // "MP4" | "MKV" | "JPG" | "PNG" | "PDF" | "ZIP" | "URL" | etc.
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

    // 1. Check if URL / Link
    if mime_l == "text/x-url" || name_l.starts_with("http://") || name_l.starts_with("https://") {
        return ClassificationResult {
            telegram_category: "link".into(),
            telegram_subtype: "url".into(),
            drive_category: "web".into(),
            drive_format: "URL".into(),
        };
    }

    // 2. Check if Sticker
    if is_sticker || mime_l == "image/webp" && name_l.starts_with("sticker_") {
        return ClassificationResult {
            telegram_category: "sticker".into(),
            telegram_subtype: "sticker".into(),
            drive_category: "image".into(),
            drive_format: "WEBP".into(),
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
    } else {
        let sub = if is_archive_format {
            "archive"
        } else if name_l.ends_with(".pdf") {
            "pdf"
        } else if name_l.ends_with(".docx") || name_l.ends_with(".doc") {
            "docx"
        } else {
            "other"
        };
        ("file".to_string(), sub.to_string())
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
    } else if is_doc_format {
        "document".to_string()
    } else {
        "document".to_string()
    };

    ClassificationResult {
        telegram_category,
        telegram_subtype,
        drive_category,
        drive_format: ext,
    }
}
