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
    Document,
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
            "DOCUMENT" | "DOC" | "FILE" | "RAW_DOCUMENT" => Self::Document,
            "ORIGINAL" | "UNCOMPRESSED" | "RAW" | "LOSSLESS" | "PASSTHROUGH" | "DIRECT"
            | "NATIVE" => Self::Original,
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
        "bmp" | "tif" | "tiff" | "heic" | "heif" | "hif" | "avif" | "avis" | "jxl" | "svg"
        | "svgz" | "ico" | "cur" | "psd" | "psb" | "tga" | "dds" | "exr" | "hdr" | "eps" | "ai"
        | "dng" | "cr2" | "cr3" | "nef" | "nrw" | "arw" | "srf" | "sr2" | "orf" | "rw2" | "pef"
        | "raf" | "srw" | "x3f" | "erf" | "kdc" | "dcr" | "mef" | "mos" | "mrw" => {
            MediaCategory::OtherImage
        }
        "mp4" | "m4v" => MediaCategory::Mp4Video,
        "mov" | "qt" | "mkv" | "webm" | "avi" | "3gp" | "3g2" | "3gpp" | "3gpp2" | "ts"
        | "m2ts" | "mts" | "vob" | "flv" | "f4v" | "f4p" | "wmv" | "asf" | "ogv" | "rm"
        | "rmvb" | "divx" | "xvid" | "mxf" | "dv" | "mpg" | "mpeg" | "m2v" | "mpe" | "mpv" => {
            MediaCategory::OtherVideo
        }
        "mp3" | "m4a" | "m4b" | "m4p" | "m4r" | "aac" | "ogg" | "oga" | "opus" | "flac"
        | "alac" | "wav" | "wave" | "wma" | "aiff" | "aif" | "aifc" | "ape" | "tak" | "tta"
        | "wv" | "dsf" | "dff" | "ac3" | "eac3" | "dts" | "dtshd" | "truehd" | "thd" | "amr"
        | "awb" | "voc" | "caf" | "mid" | "midi" | "kar" | "mod" | "xm" | "it" | "s3m" => {
            MediaCategory::Audio
        }
        "pdf" => MediaCategory::PdfDocument,
        "zip" | "rar" | "7z" | "tar" | "gz" | "tgz" | "bz2" | "tbz2" | "xz" | "txz" | "zst"
        | "lz4" | "iso" | "cab" => MediaCategory::Archive,
        "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "odt" | "ods" | "odp" | "epub"
        | "mobi" | "azw" | "azw3" | "cbr" | "cbz" | "fb2" | "djvu" => MediaCategory::OfficeDocument,
        "txt" | "md" | "csv" | "tsv" | "json" | "xml" | "html" | "htm" | "log" | "rtf" => {
            MediaCategory::TextDocument
        }
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
    if h.starts_with(b"BM")
        || h.starts_with(b"II*\0")
        || h.starts_with(b"MM\0*")
        || h.starts_with(b"8BPS")
    {
        return MediaCategory::OtherImage;
    }
    if h.starts_with(b"BZh")
        || h.starts_with(&[0x1f, 0x8b])
        || h.starts_with(&[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])
        || h.starts_with(&[0x28, 0xb5, 0x2f, 0xfd])
    {
        return MediaCategory::Archive;
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

/// Telegram rejects native Photo uploads larger than this via MTProto.
/// Any image exceeding the limit must be sent as a Document to avoid
/// PHOTO_INVALID_DIMENSIONS or silent server-side failure.
const TELEGRAM_NATIVE_PHOTO_MAX_BYTES: u64 = 10 * 1024 * 1024; // 10 MB

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

/// Returns true when the file exists and its size exceeds Telegram's native
/// photo upload limit. Used to auto-demote oversized images to document mode.
fn exceeds_native_photo_limit(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|m| m.len() > TELEGRAM_NATIVE_PHOTO_MAX_BYTES)
        .unwrap_or(false)
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
    if mode == QualityMode::Document {
        return DeliveryClassification {
            category,
            payload_class: PayloadClass::OriginalDocumentBatch,
            transform: TransformAction::PassThrough,
            as_document: true,
            reason_code: "forced_raw_document".into(),
        };
    }
    if mode == QualityMode::Original {
        let payload_class = match category {
            MediaCategory::JpegImage | MediaCategory::PngImage => PayloadClass::NativeVisual,
            MediaCategory::Mp4Video => PayloadClass::NativeVisual,
            MediaCategory::Audio if is_consumer_audio(path) => PayloadClass::AudioGroup,
            _ => PayloadClass::OriginalDocumentBatch,
        };
        let (payload_class, size_demoted) = if payload_class == PayloadClass::NativeVisual
            && matches!(category, MediaCategory::JpegImage | MediaCategory::PngImage)
            && exceeds_native_photo_limit(path)
        {
            (PayloadClass::OriginalDocumentBatch, true)
        } else {
            (payload_class, false)
        };
        let as_document = payload_class != PayloadClass::NativeVisual
            && payload_class != PayloadClass::AudioGroup;
        return DeliveryClassification {
            category,
            payload_class,
            transform: TransformAction::PassThrough,
            as_document,
            reason_code: if as_document {
                if size_demoted {
                    "original_oversized_photo_document".into()
                } else if category == MediaCategory::WebpImage {
                    "original_lossless_webp_document".into()
                } else {
                    "original_unsupported_document".into()
                }
            } else {
                "original_direct_passthrough".into()
            },
        };
    }
    let payload_class = match category {
        MediaCategory::JpegImage | MediaCategory::PngImage => PayloadClass::NativeVisual,
        MediaCategory::Mp4Video if native_video_validated => PayloadClass::NativeVisual,
        MediaCategory::Audio if is_consumer_audio(path) => PayloadClass::AudioGroup,
        _ => PayloadClass::DocumentGroup,
    };

    // Telegram's native Photo upload cap is 10 MB. Images larger than this are
    // auto-demoted to Document so the original lossless file (e.g. a PNG
    // transcoded from a WebP sticker) is sent intact instead of being silently
    // rejected or recompressed with quality loss by the Telegram server.
    let (payload_class, size_demoted) = if payload_class == PayloadClass::NativeVisual
        && matches!(category, MediaCategory::JpegImage | MediaCategory::PngImage)
        && exceeds_native_photo_limit(path)
    {
        (PayloadClass::DocumentGroup, true)
    } else {
        (payload_class, false)
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
            _ if size_demoted => "oversized_photo_demoted_to_document",
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
        let path = fixture("fake.mp4", &[0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
        assert_eq!(classify_media(&path), MediaCategory::JpegImage);
    }

    #[test]
    fn original_passthrough_preserves_native_visual() {
        let path = fixture("photo.jpg", &[0xff, 0xd8, 0xff, 0xdb]);
        let result = classify_delivery(&path, QualityMode::Original, false);
        assert!(!result.as_document);
        assert_eq!(result.payload_class, PayloadClass::NativeVisual);
        assert_eq!(result.transform, TransformAction::PassThrough);
    }

    #[test]
    fn document_mode_forces_generic_document() {
        let path = fixture("photo.jpg", &[0xff, 0xd8, 0xff, 0xdb]);
        let result = classify_delivery(&path, QualityMode::Document, false);
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
        // 'avif' brand
        let mut avif = vec![0, 0, 0, 0x1c, b'f', b't', b'y', b'p', b'a', b'v', b'i', b'f'];
        avif.extend_from_slice(&[0u8; 16]);
        let path = fixture("sample.avif", &avif);
        assert_eq!(classify_media(&path), MediaCategory::OtherImage);

        // 'isom' brand -> Mp4Video
        let mut mp4 = vec![0, 0, 0, 0x1c, b'f', b't', b'y', b'p', b'i', b's', b'o', b'm'];
        mp4.extend_from_slice(&[0u8; 16]);
        let path = fixture("sample.mp4", &mp4);
        assert_eq!(classify_media(&path), MediaCategory::Mp4Video);

        // Audio brands: 'M4A ', 'M4B '
        let mut m4a = vec![0, 0, 0, 0x1c, b'f', b't', b'y', b'p', b'M', b'4', b'A', b' '];
        m4a.extend_from_slice(&[0u8; 16]);
        let path = fixture("audio.m4a", &m4a);
        assert_eq!(classify_media(&path), MediaCategory::Audio);
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

    #[test]
    fn small_jpeg_under_limit_stays_native_visual() {
        // A tiny JPEG (4 bytes of magic + filler) is well under 10 MB
        let payload = {
            let mut v = vec![0xff, 0xd8, 0xff, 0xdb];
            v.extend_from_slice(&[0u8; 1024]); // 1 KB total
            v
        };
        let path = fixture("small.jpg", &payload);
        let result = classify_prepared_delivery(&path, QualityMode::Smart, false, false);
        assert_eq!(result.payload_class, PayloadClass::NativeVisual);
        assert!(!result.as_document);
        assert_eq!(result.reason_code, "prepared_native_visual");
    }

    #[test]
    fn oversized_photo_is_auto_demoted_to_document() {
        // Build a fake JPEG header + enough bytes to exceed 10 MB
        let mut payload = vec![0xff, 0xd8, 0xff, 0xdb];
        payload.extend_from_slice(&vec![0u8; 10 * 1024 * 1024 + 1]); // 10 MB + 1 byte
        let path = fixture("big_photo.jpg", &payload);
        let result = classify_prepared_delivery(&path, QualityMode::Smart, false, false);
        assert_eq!(result.payload_class, PayloadClass::DocumentGroup);
        assert!(result.as_document);
        assert_eq!(result.reason_code, "oversized_photo_demoted_to_document");
    }

    #[test]
    fn original_mode_webp_is_routed_to_document_lossless() {
        let mut payload = vec![b'R', b'I', b'F', b'F', 0, 0, 0, 0, b'W', b'E', b'B', b'P'];
        payload.extend_from_slice(&[0u8; 128]);
        let path = fixture("sample.webp", &payload);
        let result = classify_prepared_delivery(&path, QualityMode::Original, false, false);
        assert_eq!(result.payload_class, PayloadClass::OriginalDocumentBatch);
        assert!(result.as_document);
        assert_eq!(result.reason_code, "original_lossless_webp_document");
    }

    #[test]
    fn raw_and_nextgen_images_are_other_image() {
        let dng = fixture("photo.dng", b"RAW_STUB");
        let jxl = fixture("graphic.jxl", b"JXL_STUB");
        let wmv = fixture("clip.wmv", b"WMV_STUB");
        let epub = fixture("book.epub", b"EPUB_STUB");
        assert_eq!(classify_media(&dng), MediaCategory::OtherImage);
        assert_eq!(classify_media(&jxl), MediaCategory::OtherImage);
        assert_eq!(classify_media(&wmv), MediaCategory::OtherVideo);
        assert_eq!(classify_media(&epub), MediaCategory::OfficeDocument);
    }
}
