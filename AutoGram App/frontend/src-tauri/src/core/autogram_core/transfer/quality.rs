use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Read;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QualityMode {
    HighQuality,
    Smart,
    Original,
}

impl QualityMode {
    pub fn parse(value: Option<&str>) -> Self {
        match value
            .unwrap_or("SMART")
            .trim()
            .to_ascii_uppercase()
            .as_str()
        {
            "HIGH_QUALITY" | "HIGHQUALITY" | "HQ" => Self::HighQuality,
            "ORIGINAL" | "DOCUMENT" => Self::Original,
            _ => Self::Smart,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaCategory {
    JpegImage,
    PngImage,
    WebpImage,
    GifImage,
    OtherImage,
    Mp4Video,
    OtherVideo,
    Audio,
    PdfDocument,
    Archive,
    OfficeDocument,
    TextDocument,
    Executable,
    Database,
    UnknownBinary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PayloadClass {
    NativeVisual,
    DocumentGroup,
    AudioGroup,
    OriginalDocumentBatch,
    SplitPartBatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransformAction {
    PassThrough,
    LosslessRemux,
    Reencode,
    ConvertWebpPng,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryClassification {
    pub category: MediaCategory,
    pub payload_class: PayloadClass,
    pub transform: TransformAction,
    pub as_document: bool,
    pub reason_code: String,
}

fn read_header(path: &Path) -> Vec<u8> {
    let Ok(mut file) = File::open(path) else {
        return Vec::new();
    };
    let mut header = vec![0u8; 32];
    match file.read(&mut header) {
        Ok(n) => {
            header.truncate(n);
            header
        }
        Err(_) => Vec::new(),
    }
}

fn ext_category(path: &Path) -> MediaCategory {
    let ext = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" | "jfif" => MediaCategory::JpegImage,
        "png" => MediaCategory::PngImage,
        "webp" => MediaCategory::WebpImage,
        "gif" => MediaCategory::GifImage,
        "bmp" | "tif" | "tiff" | "heic" | "heif" | "avif" | "svg" => MediaCategory::OtherImage,
        "mp4" | "m4v" => MediaCategory::Mp4Video,
        "mov" | "mkv" | "webm" | "avi" | "3gp" | "ts" | "flv" => MediaCategory::OtherVideo,
        "mp3" | "m4a" | "aac" | "ogg" | "opus" | "flac" | "wav" | "wma" => MediaCategory::Audio,
        "pdf" => MediaCategory::PdfDocument,
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" => MediaCategory::Archive,
        "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "odt" | "ods" | "odp" => {
            MediaCategory::OfficeDocument
        }
        "txt" | "md" | "csv" | "json" | "xml" | "log" | "rtf" => MediaCategory::TextDocument,
        "exe" | "dll" | "msi" | "com" | "bat" | "cmd" | "sh" | "appimage" => {
            MediaCategory::Executable
        }
        "db" | "sqlite" | "sqlite3" => MediaCategory::Database,
        _ => MediaCategory::UnknownBinary,
    }
}

fn iso_bmff_category(header: &[u8], extension_fallback: MediaCategory) -> MediaCategory {
    if header.len() < 12 || &header[4..8] != b"ftyp" {
        return extension_fallback;
    }
    let brands = header[8..].chunks_exact(4).take(6).collect::<Vec<_>>();
    if brands.iter().any(|brand| {
        matches!(
            *brand,
            b"heic"
                | b"heix"
                | b"hevc"
                | b"hevx"
                | b"heim"
                | b"heis"
                | b"mif1"
                | b"msf1"
                | b"avif"
                | b"avis"
        )
    }) {
        return MediaCategory::OtherImage;
    }
    if brands
        .iter()
        .any(|brand| matches!(*brand, b"M4A " | b"M4B " | b"F4A "))
    {
        return MediaCategory::Audio;
    }
    MediaCategory::Mp4Video
}

/// Magic bytes win over extensions. An unrecognised payload safely remains a document.
pub fn classify_media(path: &Path) -> MediaCategory {
    let h = read_header(path);
    let extension_fallback = ext_category(path);
    if h.starts_with(&[0xff, 0xd8, 0xff]) {
        return MediaCategory::JpegImage;
    }
    if h.starts_with(b"\x89PNG\r\n\x1a\n") {
        return MediaCategory::PngImage;
    }
    if h.len() >= 12 && &h[0..4] == b"RIFF" && &h[8..12] == b"WEBP" {
        return MediaCategory::WebpImage;
    }
    if h.len() >= 12 && &h[0..4] == b"RIFF" && &h[8..12] == b"WAVE" {
        return MediaCategory::Audio;
    }
    if h.len() >= 12 && &h[0..4] == b"RIFF" && &h[8..12] == b"AVI " {
        return MediaCategory::OtherVideo;
    }
    if h.starts_with(b"BM") || h.starts_with(b"II*\0") || h.starts_with(b"MM\0*") {
        return MediaCategory::OtherImage;
    }
    if h.starts_with(b"GIF87a") || h.starts_with(b"GIF89a") {
        return MediaCategory::GifImage;
    }
    if h.starts_with(b"%PDF-") {
        return MediaCategory::PdfDocument;
    }
    if h.starts_with(b"PK\x03\x04") {
        return if extension_fallback == MediaCategory::OfficeDocument {
            MediaCategory::OfficeDocument
        } else {
            MediaCategory::Archive
        };
    }
    if h.starts_with(b"7z\xbc\xaf\x27\x1c") || h.starts_with(b"Rar!") {
        return MediaCategory::Archive;
    }
    if h.starts_with(b"MZ") || h.starts_with(b"\x7fELF") {
        return MediaCategory::Executable;
    }
    if h.starts_with(b"SQLite format 3\0") {
        return MediaCategory::Database;
    }
    if h.len() >= 12 && &h[4..8] == b"ftyp" {
        return iso_bmff_category(&h, extension_fallback);
    }
    if h.starts_with(b"fLaC") || h.starts_with(b"ID3") {
        return MediaCategory::Audio;
    }
    if h.starts_with(b"OggS") {
        return match extension_fallback {
            MediaCategory::OtherVideo => MediaCategory::OtherVideo,
            _ => MediaCategory::Audio,
        };
    }
    if h.starts_with(b"\x1a\x45\xdf\xa3") {
        return match extension_fallback {
            MediaCategory::Audio => MediaCategory::Audio,
            _ => MediaCategory::OtherVideo,
        };
    }
    extension_fallback
}

fn is_consumer_audio(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "mp3" | "m4a" | "aac" | "ogg" | "opus"
    )
}

pub fn classify_delivery(
    path: &Path,
    mode: QualityMode,
    transformed: bool,
) -> DeliveryClassification {
    classify_prepared_delivery(path, mode, transformed, true)
}

pub fn classify_prepared_delivery(
    path: &Path,
    mode: QualityMode,
    transformed: bool,
    native_video_validated: bool,
) -> DeliveryClassification {
    let category = classify_media(path);
    if mode == QualityMode::Original {
        return DeliveryClassification {
            category,
            payload_class: PayloadClass::OriginalDocumentBatch,
            transform: TransformAction::PassThrough,
            as_document: true,
            reason_code: "original_generic_document".into(),
        };
    }
    let payload_class = match category {
        MediaCategory::JpegImage | MediaCategory::PngImage => PayloadClass::NativeVisual,
        MediaCategory::Mp4Video if native_video_validated => PayloadClass::NativeVisual,
        MediaCategory::Audio if is_consumer_audio(path) => PayloadClass::AudioGroup,
        _ => PayloadClass::DocumentGroup,
    };
    let transform = if transformed {
        TransformAction::Reencode
    } else {
        TransformAction::PassThrough
    };
    DeliveryClassification {
        category,
        payload_class,
        transform,
        as_document: payload_class != PayloadClass::NativeVisual,
        reason_code: match payload_class {
            PayloadClass::NativeVisual => "prepared_native_visual",
            PayloadClass::AudioGroup => "prepared_audio_document",
            _ => "safe_generic_document",
        }
        .into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fixture(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("autogram-quality-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn magic_wins_over_misleading_extension() {
        let path = fixture("fake.jpg", b"%PDF-1.7\n");
        assert_eq!(classify_media(&path), MediaCategory::PdfDocument);
    }

    #[test]
    fn original_is_always_generic_document() {
        let path = fixture("photo.jpg", &[0xff, 0xd8, 0xff, 0xdb]);
        let result = classify_delivery(&path, QualityMode::Original, false);
        assert!(result.as_document);
        assert_eq!(result.payload_class, PayloadClass::OriginalDocumentBatch);
    }

    #[test]
    fn prepared_mp4_is_native_visual() {
        let path = fixture("clip.bin", b"\0\0\0\x18ftypisom\0\0\0\0");
        assert_eq!(
            classify_delivery(&path, QualityMode::Smart, false).payload_class,
            PayloadClass::NativeVisual
        );
    }

    #[test]
    fn iso_bmff_brands_do_not_all_become_video() {
        let heic = fixture("photo.bin", b"\0\0\0\x18ftypheic\0\0\0\0mif1");
        let m4a = fixture("sound.bin", b"\0\0\0\x18ftypM4A \0\0\0\0isom");
        assert_eq!(classify_media(&heic), MediaCategory::OtherImage);
        assert_eq!(classify_media(&m4a), MediaCategory::Audio);
    }

    #[test]
    fn zipped_office_document_keeps_document_category() {
        let path = fixture("report.docx", b"PK\x03\x04stub");
        assert_eq!(classify_media(&path), MediaCategory::OfficeDocument);
    }

    #[test]
    fn lossless_audio_is_not_grouped_as_consumer_audio() {
        let path = fixture("master.flac", b"fLaCstub");
        let result = classify_prepared_delivery(&path, QualityMode::Smart, false, false);
        assert_eq!(result.payload_class, PayloadClass::DocumentGroup);
        assert!(result.as_document);
    }
}
