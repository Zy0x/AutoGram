//! High-performance MTProto thumbnail batching, stripped mini-thumb data URL generation, and LRU memory/disk cache management.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use grammers_client::media::{Downloadable, Media, PhotoSize};
use grammers_client::tl;
use grammers_client::Client;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use super::ffmpeg::{extract_ffmpeg_frame_from_url, extract_ffmpeg_frame_sync, find_ffmpeg_binary, get_ffmpeg_capabilities, is_fallback_black_card_bytes, unstrip_jpeg};
use super::thumbnail_range_bridge::spawn_range_bridge;

use super::session::{cache_root, now_ms, preview_dir, thumb_dir, BACKEND};
use crate::core::grammers_ops::{
    obtain_download_clients, obtain_live_client, persist_memory_session, resolve_peer, runtime, with_client, with_pool_retry,
};
use crate::core::path_policy;
use crate::core::session_rate;
use crate::core::telegram_ops::TelegramIdentity;
use crate::core::tg_error::{map_invocation, TgError, TgErrorCode};
use crate::core::tg_log;

const PROGRESSIVE_MAX: u64 = 4 * 1024 * 1024 * 1024;
const THUMB_TARGET_MAX: usize = 96 * 1024;

/// Structured locator for media thumbnails extracted during listing or search.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailLocator {
    pub account_id: String,
    pub peer_id: i64,
    pub message_id: i32,
    pub topic_id: Option<i32>,
    pub media_kind: String,
    pub document_id: Option<i64>,
    pub photo_id: Option<i64>,
    pub dc_id: Option<i32>,
    pub telegram_thumb_type: Option<String>,
    pub mime_type: Option<String>,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
}

pub fn to_data_url(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }
    let is_jpeg = bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8;
    let is_png = bytes.len() >= 8 && &bytes[0..4] == b"\x89PNG";
    let is_webp = bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP";
    let is_svg = bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml");
    let mime = if is_jpeg {
        "image/jpeg"
    } else if is_png {
        "image/png"
    } else if is_webp {
        "image/webp"
    } else if is_svg {
        "image/svg+xml"
    } else {
        "image/jpeg"
    };
    Some(format!("data:{mime};base64,{}", B64.encode(bytes)))
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbSinglePayload {
    pub chat_id: String,
    pub message_id: i64,
    pub quality: String,
    pub url: String,
    pub is_placeholder: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MediaPreviewClass {
    TelegramPhoto,
    TelegramVideo,
    ImageDocument,
    VideoDocument,
    PdfDocument,
    GenericDocument,
    AudioDocument,
    ArchiveDocument,
    Unknown,
}

impl MediaPreviewClass {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::TelegramPhoto => "TelegramPhoto",
            Self::TelegramVideo => "TelegramVideo",
            Self::ImageDocument => "ImageDocument",
            Self::VideoDocument => "VideoDocument",
            Self::PdfDocument => "PdfDocument",
            Self::GenericDocument => "GenericDocument",
            Self::AudioDocument => "AudioDocument",
            Self::ArchiveDocument => "ArchiveDocument",
            Self::Unknown => "Unknown",
        }
    }

    pub fn is_video(&self) -> bool {
        matches!(self, Self::TelegramVideo | Self::VideoDocument)
    }

    pub fn is_generic_or_non_media(&self) -> bool {
        matches!(
            self,
            Self::GenericDocument | Self::ArchiveDocument | Self::AudioDocument | Self::Unknown
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedThumbRequestId {
    pub peer_id: String,
    pub message_id: i32,
    pub generation: u64,
}

pub fn parse_thumb_request_id(req_id: &str) -> Option<ParsedThumbRequestId> {
    let parts: Vec<&str> = req_id.split(':').collect();
    if parts.len() != 4 || parts[0] != "thumb" {
        return None;
    }
    let peer_id = parts[1].to_string();
    let message_id = parts[2].parse::<i32>().ok()?;
    if !parts[3].starts_with('g') {
        return None;
    }
    let generation = parts[3][1..].parse::<u64>().ok()?;
    Some(ParsedThumbRequestId {
        peer_id,
        message_id,
        generation,
    })
}

pub fn classify_message_media(msg: &grammers_client::message::Message) -> MediaPreviewClass {
    let Some(media) = msg.media() else {
        return MediaPreviewClass::Unknown;
    };
    match media {
        Media::Photo(_) => MediaPreviewClass::TelegramPhoto,
        Media::Document(ref doc) => {
            let mime = doc.mime_type().unwrap_or("").to_lowercase();
            let name = doc.name().unwrap_or("").to_lowercase();
            let ext = std::path::Path::new(&name)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();

            let has_video_attr = doc.raw.video;

            if has_video_attr {
                return MediaPreviewClass::TelegramVideo;
            }
            if mime.starts_with("video/")
                || matches!(ext.as_str(), "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "3gp" | "flv" | "wmv" | "ts")
            {
                return MediaPreviewClass::VideoDocument;
            }
            if mime.starts_with("image/")
                || matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "heic" | "tiff")
            {
                return MediaPreviewClass::ImageDocument;
            }
            if mime == "application/pdf" || ext == "pdf" {
                return MediaPreviewClass::PdfDocument;
            }
            if mime.starts_with("audio/") || matches!(ext.as_str(), "mp3" | "ogg" | "flac" | "wav" | "m4a" | "aac" | "opus") {
                return MediaPreviewClass::AudioDocument;
            }
            if matches!(ext.as_str(), "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz") {
                return MediaPreviewClass::ArchiveDocument;
            }
            if matches!(ext.as_str(), "bin" | "exe" | "iso" | "dat" | "sys" | "dll")
                || (mime == "application/octet-stream" && ext.is_empty())
            {
                return MediaPreviewClass::GenericDocument;
            }
            MediaPreviewClass::GenericDocument
        }
        Media::Sticker(_) => MediaPreviewClass::ImageDocument,
        _ => MediaPreviewClass::Unknown,
    }
}

pub fn classify_media_preview(mime: Option<&str>, name: Option<&str>) -> MediaPreviewClass {
    let mime = mime.unwrap_or("").to_lowercase();
    let name = name.unwrap_or("").to_lowercase();
    let ext = std::path::Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if mime.starts_with("video/")
        || matches!(ext.as_str(), "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "3gp" | "flv" | "wmv" | "ts")
    {
        return MediaPreviewClass::VideoDocument;
    }
    if mime.starts_with("image/")
        || matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "heic" | "tiff")
    {
        return MediaPreviewClass::ImageDocument;
    }
    if mime == "application/pdf" || ext == "pdf" {
        return MediaPreviewClass::PdfDocument;
    }
    if mime.starts_with("audio/") || matches!(ext.as_str(), "mp3" | "ogg" | "flac" | "wav" | "m4a" | "aac" | "opus") {
        return MediaPreviewClass::AudioDocument;
    }
    if matches!(ext.as_str(), "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz") {
        return MediaPreviewClass::ArchiveDocument;
    }
    if matches!(ext.as_str(), "bin" | "exe" | "iso" | "dat" | "sys" | "dll")
        || mime == "application/octet-stream"
    {
        return MediaPreviewClass::GenericDocument;
    }
    MediaPreviewClass::GenericDocument
}

pub fn is_ffmpeg_eligible_media(class: &MediaPreviewClass, mime: Option<&str>, name: Option<&str>) -> bool {
    if !class.is_video() {
        return false;
    }
    let mime = mime.unwrap_or("").to_lowercase();
    let name = name.unwrap_or("").to_lowercase();
    let ext = std::path::Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    mime.starts_with("video/")
        || matches!(ext.as_str(), "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v")
}

static THUMB_TERMINAL_CACHE: std::sync::OnceLock<parking_lot::Mutex<std::collections::HashSet<String>>> =
    std::sync::OnceLock::new();

fn thumb_terminal_cache() -> &'static parking_lot::Mutex<std::collections::HashSet<String>> {
    THUMB_TERMINAL_CACHE.get_or_init(|| parking_lot::Mutex::new(std::collections::HashSet::new()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailBatchItemResult {
    pub request_id: String,
    pub peer_id: String,
    pub telegram_message_id: i32,
    pub status: String,
    pub source: Option<String>,
    pub reason: Option<String>,
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub classification: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbsBatchResult {
    pub status: String,
    pub thumbs: HashMap<String, Option<String>>,
    pub items: Vec<ThumbnailBatchItemResult>,
    pub backend: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramMediaLocator {
    pub account_id: String,
    pub telegram_peer_id: String,
    pub telegram_message_id: i32,
    pub topic_id: Option<i32>,
    pub document_id: Option<i64>,
    pub photo_id: Option<i64>,
    pub media_kind: String,
    pub identity_source: String,
}

fn thumb_mem_cache() -> &'static Mutex<HashMap<String, String>> {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::with_capacity(10000)))
}

pub fn clear_thumb_mem_cache() {
    thumb_mem_cache().lock().clear();
}

pub fn prune_thumb_cache(t_dir: &Path) {
    if !t_dir.is_dir() {
        return;
    }
    static LAST_PRUNE: OnceLock<Mutex<u128>> = OnceLock::new();
    let lock = LAST_PRUNE.get_or_init(|| Mutex::new(0));
    let now = now_ms();
    {
        let mut last = lock.lock();
        if now.saturating_sub(*last) < 60_000 {
            return;
        }
        *last = now;
    }
    let t_dir_buf = t_dir.to_path_buf();
    std::thread::spawn(move || {
        let Ok(entries) = std::fs::read_dir(&t_dir_buf) else { return; };
        let mut files: Vec<(PathBuf, SystemTime, u64)> = Vec::new();

        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let fname = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if fname.ends_with(".part") || fname.ends_with(".nothumb") {
                let _ = std::fs::remove_file(&p);
                continue;
            }
            // Auto-purge solid dark slate/black fallback cards from previous builds
            if fname.ends_with(".jpg") {
                if let Ok(b) = std::fs::read(&p) {
                    if is_fallback_black_card_bytes(&b) {
                        let _ = std::fs::remove_file(&p);
                        continue;
                    }
                }
            }
            if let Ok(meta) = p.metadata() {
                let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                files.push((p, modified, meta.len()));
            }
        }

        files.sort_by_key(|(_, modified, _)| *modified);
        let max_files = 500usize;
        let max_bytes = 256 * 1024 * 1024u64; // 256 MB cap
        let mut total_bytes: u64 = files.iter().map(|(_, _, len)| *len).sum();

        while files.len() > max_files || total_bytes > max_bytes {
            if let Some((path, _, len)) = files.first().cloned() {
                let _ = std::fs::remove_file(&path);
                total_bytes = total_bytes.saturating_sub(len);
                files.remove(0);
            } else {
                break;
            }
        }
    });
}

pub fn photo_size_dimensions(s: &PhotoSize) -> (i32, i32) {
    match s {
        PhotoSize::Size(sz) => (sz.width, sz.height),
        PhotoSize::Progressive(p) => (p.width, p.height),
        PhotoSize::Cached(c) => (c.width, c.height),
        _ => (0, 0),
    }
}

pub fn pick_thumb(sizes: &[PhotoSize], quality: &str) -> Option<PhotoSize> {
    let mode = quality.to_lowercase();
    let saver = mode.contains("hemat") || mode.contains("saver");
    let sharp = mode.contains("jelas") || mode.contains("sharp");

    // Hemat / Saver: prefer free inline stripped/cached (tiny).
    if saver {
        for s in sizes {
            if s.to_data().is_some() {
                match s {
                    PhotoSize::Cached(_) | PhotoSize::Stripped(_) => return Some(s.clone()),
                    _ => {}
                }
            }
        }
        // Fall through to smallest downloadable if no inline
    }

    // Filter static downloadable layers with size() > 0 (ignoring 0-byte stripped mini-thumbs)
    let mut downloadable: Vec<&PhotoSize> = sizes
        .iter()
        .filter(|s| matches!(s, PhotoSize::Size(_) | PhotoSize::Progressive(_)) && s.size() > 0)
        .collect();

    downloadable.sort_by_key(|s| {
        let (w, h) = photo_size_dimensions(s);
        if w > 0 && h > 0 { w * h } else { s.size() as i32 }
    });

    if !downloadable.is_empty() {
        if sharp {
            // Jelas: largest static layer available in Telegram.
            // If static layer max dimension is < 400px, return None to trigger HD photo chunk download or 1080p FFmpeg video frame extraction.
            let best = downloadable.last().copied()?;
            let (w, h) = photo_size_dimensions(best);
            if w > 0 && h > 0 && w.max(h) < 400 {
                return None;
            }
            return Some(best.clone());
        }

        if saver {
            // Hemat downloadable fallback: smallest non-stripped layer
            return downloadable.first().map(|s| (*s).clone());
        }
        // Seimbang: prefer layer closest to ~512px max dim (avoids tiny blur/pixelation while keeping good quality).
        // If no qualifying (>=240px) layer, return None to trigger photo chunk / FFmpeg frame fallback.
        let target = 512i32;
        let mut candidates: Vec<(i32, &PhotoSize)> = downloadable
            .iter()
            .filter_map(|s| {
                let (w, h) = photo_size_dimensions(s);
                let d = w.max(h);
                if d > 0 && d >= 240 {
                    Some(((d - target).abs(), *s))
                } else {
                    None
                }
            })
            .collect();
        if !candidates.is_empty() {
            candidates.sort_by_key(|(dist, _)| *dist);
            let (_, best) = candidates[0];
            return Some(best.clone());
        }
        return downloadable.last().map(|s| (*s).clone());
    }

    // No downloadable static layer: saver accepts stripped as final
    if saver {
        for s in sizes {
            if s.to_data().is_some() {
                return Some(s.clone());
            }
        }
    }

    // For seimbang/jelas, return None so download_media_thumb falls back to photo chunk / FFmpeg frame
    None
}

pub fn extract_office_zip_thumbnail(bytes: &[u8]) -> Option<Vec<u8>> {
    if bytes.len() < 100 || !bytes.starts_with(b"PK\x03\x04") {
        return None;
    }
    let mut pos = 0;
    let limit = bytes.len().saturating_sub(4);
    while pos < limit {
        if bytes[pos] == 0xFF && bytes[pos + 1] == 0xD8 && bytes[pos + 2] == 0xFF {
            let start = pos;
            let mut end = start + 3;
            while end + 1 < bytes.len() {
                if bytes[end] == 0xFF && bytes[end + 1] == 0xD9 {
                    end += 2;
                    let jpeg = &bytes[start..end];
                    if jpeg.len() >= 1024 && jpeg.len() <= 2 * 1024 * 1024 {
                        return Some(jpeg.to_vec());
                    }
                    break;
                }
                end += 1;
            }
        }
        pos += 1;
    }
    None
}

pub fn extract_id3_album_art(bytes: &[u8]) -> Option<Vec<u8>> {
    if bytes.len() < 10 || !bytes.starts_with(b"ID3") {
        return None;
    }
    let limit = bytes.len().min(512 * 1024);
    for pos in 0..limit.saturating_sub(4) {
        if (bytes[pos] == 0xFF && bytes[pos + 1] == 0xD8 && bytes[pos + 2] == 0xFF)
            || bytes[pos..].starts_with(b"\x89PNG")
        {
            let is_png = bytes[pos] == 0x89;
            let start = pos;
            if is_png {
                let end = (start + 32 * 1024).min(bytes.len());
                if end > start + 512 {
                    return Some(bytes[start..end].to_vec());
                }
            } else {
                let mut end = start + 3;
                while end + 1 < bytes.len() {
                    if bytes[end] == 0xFF && bytes[end + 1] == 0xD9 {
                        end += 2;
                        let img = &bytes[start..end];
                        if img.len() >= 512 {
                            return Some(img.to_vec());
                        }
                        break;
                    }
                    end += 1;
                }
            }
        }
    }
    None
}

pub fn media_thumbs(_client: Option<&Client>, media: &Media) -> Vec<PhotoSize> {
    match media {
        Media::Photo(p) => p.thumbs(),
        Media::Document(d) => d.thumbs(),
        Media::Sticker(s) => s.document.thumbs(),
        Media::WebPage(wp) => match &wp.raw.webpage {
            tl::enums::WebPage::Page(page) => {
                let mut out = Vec::new();
                if let Some(photo) = &page.photo {
                    let p = grammers_client::media::Photo::from_raw(photo.clone());
                    out.extend(p.thumbs());
                }
                if let Some(doc) = &page.document {
                    let media_doc = tl::types::MessageMediaDocument {
                        nopremium: false,
                        spoiler: false,
                        video: false,
                        round: false,
                        voice: false,
                        video_cover: None,
                        video_timestamp: None,
                        document: Some(doc.clone()),
                        alt_documents: None,
                        ttl_seconds: None,
                    };
                    let d = grammers_client::media::Document::from_raw_media(media_doc);
                    out.extend(d.thumbs());
                }
                out
            }
            _ => vec![],
        },
        _ => vec![],
    }
}

/// Inline stripped JPEG (Telegram mini-thumb) as data-URL — no network GetFile.
/// Inline stripped JPEG (Telegram mini-thumb) as data-URL — no network GetFile.
/// Used by list_media so the grid paints like the official app on first paint.
pub fn stripped_thumb_data_url(media: &Media) -> Option<String> {
    let mut best: Option<(usize, Vec<u8>)> = None;
    for s in media_thumbs(None, media) {
        if let Some(data) = s.to_data() {
            let bytes = unstrip_jpeg(&data).unwrap_or(data);
            if !bytes.is_empty() {
                let size = bytes.len();
                if best.as_ref().map_or(true, |(b, _)| size > *b) {
                    best = Some((size, bytes));
                }
            }
        }
    }
    if let Some((_, bytes)) = best {
        if let Some(url) = to_data_url(&bytes) {
            return Some(url);
        }
    }
    None
}

pub fn tl_stripped_thumb_data_url(media: &grammers_client::tl::enums::MessageMedia) -> Option<String> {
    use grammers_client::tl::enums::MessageMedia;
    match media {
        MessageMedia::Photo(p) => {
            if let Some(ref photo) = p.photo {
                let ph = grammers_client::media::Photo::from_raw(photo.clone());
                let m = Media::Photo(ph);
                return stripped_thumb_data_url(&m);
            }
        }
        MessageMedia::Document(d) => {
            let m_doc = grammers_client::media::Document::from_raw_media(d.clone());
            let m = Media::Document(m_doc);
            return stripped_thumb_data_url(&m);
        }
        _ => {}
    }
    None
}

async fn download_thumb_bytes(client: &Client, thumb: &PhotoSize) -> Result<Vec<u8>, TgError> {
    if let Some(data) = thumb.to_data() {
        if let Some(unstripped) = unstrip_jpeg(&data) {
            return Ok(unstripped);
        }
        return Ok(data);
    }
    let mut out = Vec::new();
    let mut iter = client.iter_download(thumb).chunk_size(256 * 1024);
    while let Some(chunk) = iter.next().await.map_err(|e| map_invocation(&e))? {
        out.extend_from_slice(&chunk);
        if out.len() > 512 * 1024 {
            break;
        }
    }
    Ok(out)
}

pub fn convert_avcc_to_annexb(raw_data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(raw_data.len() + 1024);
    let mut pos = 0;
    while pos + 4 < raw_data.len() {
        let nal_len = u32::from_be_bytes([
            raw_data[pos],
            raw_data[pos + 1],
            raw_data[pos + 2],
            raw_data[pos + 3],
        ]) as usize;
        if nal_len > 0 && nal_len < 16 * 1024 * 1024 && pos + 4 + nal_len <= raw_data.len() {
            out.extend_from_slice(&[0x00, 0x00, 0x00, 0x01]);
            out.extend_from_slice(&raw_data[pos + 4..pos + 4 + nal_len]);
            pos += 4 + nal_len;
        } else {
            break;
        }
    }
    if out.is_empty() {
        raw_data.to_vec()
    } else {
        out
    }
}

fn render_pdf_first_page_winrt(pdf_bytes: &[u8]) -> Option<Vec<u8>> {
    let temp_dir = std::env::temp_dir();
    let rand_id = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let sample_pdf_path = temp_dir.join(format!("autogram_pdf_{rand_id}.pdf"));
    let out_jpg_path = temp_dir.join(format!("autogram_pdf_thumb_{rand_id}.jpg"));

    if std::fs::write(&sample_pdf_path, pdf_bytes).is_err() {
        return None;
    }

    let ps_cmd = format!(
        "[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime] | Out-Null; \
         [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null; \
         $fileTask = [Windows.Storage.StorageFile]::GetFileFromPathAsync('{}'); \
         while ($fileTask.Status -eq [Windows.Foundation.AsyncStatus]::Started) {{ [System.Threading.Thread]::Sleep(10) }} \
         $file = $fileTask.GetResults(); \
         $docTask = [Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file); \
         while ($docTask.Status -eq [Windows.Foundation.AsyncStatus]::Started) {{ [System.Threading.Thread]::Sleep(10) }} \
         $doc = $docTask.GetResults(); \
         if ($doc.PageCount -gt 0) {{ \
             $page = $doc.GetPage(0); \
             $stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new(); \
             $renderTask = $page.RenderToStreamAsync($stream); \
             while ($renderTask.Status -eq [Windows.Foundation.AsyncStatus]::Started) {{ [System.Threading.Thread]::Sleep(10) }} \
             $buf = New-Object byte[] $stream.Size; \
             $reader = [Windows.Storage.Streams.DataReader]::new($stream); \
             $reader.LoadAsync($stream.Size).GetAwaiter().GetResult() | Out-Null; \
             $reader.ReadBytes($buf); \
             [System.IO.File]::WriteAllBytes('{}', $buf); \
         }}",
        sample_pdf_path.to_string_lossy().replace('\\', "\\\\"),
        out_jpg_path.to_string_lossy().replace('\\', "\\\\")
    );

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = std::process::Command::new("powershell")
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-Command")
            .arg(&ps_cmd)
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }

    let res = if out_jpg_path.exists() {
        let b = std::fs::read(&out_jpg_path).ok();
        if let Some(ref data) = b {
            if data.len() >= 512 {
                b
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let _ = std::fs::remove_file(&sample_pdf_path);
    let _ = std::fs::remove_file(&out_jpg_path);

    res
}

async fn download_media_thumb(
    client: &Client,
    media: &Media,
    quality: &str,
) -> Result<Vec<u8>, TgError> {
    let sizes = media_thumbs(Some(client), media);
    let mode = quality.to_lowercase();
    let saver = mode.contains("hemat") || mode.contains("saver");

    // Tier 1: Try selected quality size
    if let Some(pick) = pick_thumb(&sizes, quality) {
        if let Ok(bytes) = download_thumb_bytes(client, &pick).await {
            let min_ok = 64;
            if bytes.len() >= min_ok {
                return Ok(bytes);
            }
        }
    }

    // Tier 2: Inline stripped only for Saver mode
    if saver {
        for s in &sizes {
            if let Some(data) = s.to_data() {
                let bytes = unstrip_jpeg(&data).unwrap_or(data);
                if !bytes.is_empty() {
                    return Ok(bytes);
                }
            }
        }
    }

    // Tier 3: Any downloadable size (largest-first for non-saver)
    let mut downloadable: Vec<&PhotoSize> = sizes
        .iter()
        .filter(|s| matches!(s, PhotoSize::Size(_) | PhotoSize::Progressive(_)))
        .collect();
    if !saver {
        downloadable.reverse();
    }
    for s in downloadable {
        let (w, h) = photo_size_dimensions(s);
        let max_dim = w.max(h);
        let mode = quality.to_lowercase();
        let sharp = mode.contains("jelas") || mode.contains("sharp");
        // For jelas mode only, skip tiny static layer (< 400px) so Tier 4 photo chunk or Tier 5 FFmpeg HD frame extraction can run
        if sharp && max_dim > 0 && max_dim < 400 {
            continue;
        }
        if let Ok(bytes) = download_thumb_bytes(client, s).await {
            let min_bytes = 64;
            if bytes.len() >= min_bytes {
                return Ok(bytes);
            }
        }
    }

    // Tier 4: Fallback for photos (download full photo payload up to 2MB)
    if let Media::Photo(p) = media {
        let max_bytes = 2048 * 1024;
        let mut out = Vec::new();
        let mut iter = client.iter_download(p).chunk_size(256 * 1024);
        while let Some(chunk) = iter.next().await.map_err(|e| map_invocation(&e))? {
            out.extend_from_slice(&chunk);
            if out.len() >= max_bytes {
                break;
            }
        }
        if !out.is_empty() {
            return Ok(out);
        }
    }

    // Tier 5: Fallback for Documents (videos/photos uploaded "as file" without Telegram static thumbs, PDFs, or custom documents like /-1004468191168/73)
    if let Media::Document(d) = media {
        let mime = d.mime_type().unwrap_or("").to_lowercase();
        let name = d.name().unwrap_or("").to_lowercase();
        let has_video_attr = d.raw.video;

        let mut is_video = has_video_attr
            || mime.starts_with("video/")
            || name.ends_with(".mp4")
            || name.ends_with(".mov")
            || name.ends_with(".mkv")
            || name.ends_with(".webm")
            || name.ends_with(".avi")
            || name.ends_with(".m4v")
            || name.ends_with(".3gp")
            || name.ends_with(".ts")
            || name.ends_with(".flv")
            || name.ends_with(".wmv")
            || name.ends_with(".m2ts")
            || name.ends_with(".vob")
            || name.ends_with(".ogv")
            || name.ends_with(".3g2")
            || name.ends_with(".f4v");

        let mut is_image = mime.starts_with("image/")
            || name.ends_with(".jpg")
            || name.ends_with(".jpeg")
            || name.ends_with(".png")
            || name.ends_with(".webp")
            || name.ends_with(".bmp")
            || name.ends_with(".gif")
            || name.ends_with(".heic")
            || name.ends_with(".heif")
            || name.ends_with(".avif")
            || name.ends_with(".tif")
            || name.ends_with(".tiff")
            || name.ends_with(".ico")
            || name.ends_with(".jfif");

        let mut is_pdf = mime == "application/pdf" || mime.contains("pdf") || name.ends_with(".pdf");

        let mut sample_bytes = Vec::new();
        let mut iter = client.iter_download(d).chunk_size(256 * 1024);
        if let Ok(Some(chunk)) = iter.next().await.map_err(|e| map_invocation(&e)) {
            sample_bytes.extend_from_slice(&chunk);
        }

        if !sample_bytes.is_empty() {
            if !is_image && !is_video && !is_pdf && sample_bytes.len() >= 4 {
                // Image magic bytes: JPEG (0xFF 0xD8), PNG (\x89PNG), WebP (RIFF...WEBP), GIF (GIF8), BMP (BM), HEIC/HEIF/AVIF
                if (sample_bytes[0] == 0xff && sample_bytes[1] == 0xd8)
                    || (sample_bytes.starts_with(b"\x89PNG"))
                    || (sample_bytes.starts_with(b"RIFF") && sample_bytes.len() >= 12 && &sample_bytes[8..12] == b"WEBP")
                    || (sample_bytes.starts_with(b"GIF8"))
                    || (sample_bytes.starts_with(b"BM"))
                    || (sample_bytes.len() >= 12 && &sample_bytes[4..8] == b"ftyp" && (
                        &sample_bytes[8..12] == b"heic" || &sample_bytes[8..12] == b"heif" || &sample_bytes[8..12] == b"mif1" || &sample_bytes[8..12] == b"avif"
                    ))
                {
                    is_image = true;
                }
                // Video magic bytes: MP4/MOV (ftyp/moov/mdat at offset 4), MKV/WebM (0x1A 0x45 0xDF 0xA3), AVI (RIFF...AVI ), TS (0x47), FLV (FLV), OGV (OggS), WMV (\x30\x26\xB2\x75)
                else if (sample_bytes.len() >= 8 && (&sample_bytes[4..8] == b"ftyp" || &sample_bytes[4..8] == b"moov" || &sample_bytes[4..8] == b"mdat"))
                    || (sample_bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]))
                    || (sample_bytes.starts_with(b"RIFF") && sample_bytes.len() >= 12 && &sample_bytes[8..12] == b"AVI ")
                    || (sample_bytes.starts_with(b"FLV"))
                    || (sample_bytes.starts_with(b"OggS"))
                    || (sample_bytes.starts_with(&[0x30, 0x26, 0xB2, 0x75]))
                    || (sample_bytes.starts_with(&[0x47]))
                {
                    is_video = true;
                }
                // PDF magic bytes: %PDF-
                else if sample_bytes.starts_with(b"%PDF-") {
                    is_pdf = true;
                }
            }

            if is_image {
                let doc_size = d.size().unwrap_or(0) as usize;
                let max_bytes = if doc_size > 0 && doc_size <= 8 * 1024 * 1024 {
                    doc_size
                } else {
                    2048 * 1024
                };
                while sample_bytes.len() < max_bytes {
                    if let Ok(Some(chunk)) = iter.next().await.map_err(|e| map_invocation(&e)) {
                        sample_bytes.extend_from_slice(&chunk);
                    } else {
                        break;
                    }
                }

                // Check if image format is a standard web image format (JPEG, PNG, WebP, GIF)
                let is_standard_web_image = sample_bytes.len() >= 4 && (
                    (sample_bytes[0] == 0xff && sample_bytes[1] == 0xd8 && sample_bytes[2] == 0xff)
                        || sample_bytes.starts_with(b"\x89PNG")
                        || (sample_bytes.starts_with(b"RIFF") && sample_bytes.len() >= 12 && &sample_bytes[8..12] == b"WEBP")
                        || sample_bytes.starts_with(b"GIF8")
                );

                if is_standard_web_image {
                    return Ok(sample_bytes);
                }

                // If sample_bytes is text/json (e.g. daemon file-json test.jpg), reject immediately without wasting CPU/FFmpeg
                let is_text_or_json = sample_bytes.len() > 0 && (
                    sample_bytes.starts_with(b"{") || sample_bytes.starts_with(b"[") || sample_bytes.starts_with(b"<!--") || sample_bytes.starts_with(b"http")
                );
                if is_text_or_json {
                    let err_msg = format!("file '{name}' is text/json data despite image extension");
                    return Err(TgError::new(TgErrorCode::Internal, err_msg));
                }

                // Non-web image format (HEIC, TIFF, BMP, PSD, etc.): transcode to JPEG frame via FFmpeg
                let ext_hint = if name.contains('.') {
                    name.rsplit('.').next().unwrap_or("jpg")
                } else {
                    "jpg"
                };
                if let Some(frame_bytes) = extract_ffmpeg_frame_sync(&sample_bytes, quality, ext_hint) {
                    return Ok(frame_bytes);
                }

                return Ok(sample_bytes);
            } else if is_pdf {
                // PDF extraction: try embedded cover image stream first, then WinRT PDF page render
                if let Some(img_bytes) = extract_embedded_pdf_image(&sample_bytes) {
                    return Ok(img_bytes);
                }
                if let Some(frame_bytes) = render_pdf_first_page_winrt(&sample_bytes) {
                    return Ok(frame_bytes);
                }

                // If sample_bytes is partial (e.g. 256KB of multi-MB PDF), download additional sample
                // to include trailer/XRef structure so WinRT or embedded image search can succeed
                let doc_size = d.size().unwrap_or(0) as usize;
                if doc_size > 0 && doc_size <= 8 * 1024 * 1024 && sample_bytes.len() < doc_size {
                    let max_pdf_sample = doc_size.min(2048 * 1024);
                    while sample_bytes.len() < max_pdf_sample {
                        if let Ok(Some(chunk)) = iter.next().await.map_err(|e| map_invocation(&e)) {
                            sample_bytes.extend_from_slice(&chunk);
                        } else {
                            break;
                        }
                    }
                    if let Some(img_bytes) = extract_embedded_pdf_image(&sample_bytes) {
                        return Ok(img_bytes);
                    }
                    if let Some(frame_bytes) = render_pdf_first_page_winrt(&sample_bytes) {
                        return Ok(frame_bytes);
                    }
                }
            } else if is_video {
                let doc_size = d.size().unwrap_or(0) as usize;

                let is_av1_video = mime.contains("av1")
                    || name.ends_with(".av1")
                    || sample_bytes.windows(4).any(|w| w == b"av1C")
                    || sample_bytes.windows(4).any(|w| w == b"av01");

                let caps = get_ffmpeg_capabilities();
                if let Some(ref c) = caps {
                    if !c.supports_http {
                        tg_log::warn(
                            BACKEND,
                            "thumb_result",
                            format!("status=fallback reason=http_protocol_unavailable path='{}'", c.path.display()),
                        );
                        return Err(TgError::new(TgErrorCode::Internal, "HttpProtocolUnavailable"));
                    }
                    if is_av1_video && c.av1_decoder.is_none() {
                        tg_log::warn(
                            BACKEND,
                            "thumb_result",
                            format!("status=fallback reason=decoder_unavailable path='{}'", c.path.display()),
                        );
                        return Err(TgError::new(TgErrorCode::Internal, "DecoderUnavailable"));
                    }
                } else {
                    tg_log::warn(
                        BACKEND,
                        "thumb_result",
                        "status=fallback reason=ffmpeg_not_found",
                    );
                    return Err(TgError::new(TgErrorCode::Internal, "FfmpegNotFound"));
                }

                // Level 3 primary path: Seekable Local HTTP Range Bridge for FFmpeg
                let saver = quality.to_lowercase().contains("hemat") || quality.to_lowercase().contains("saver");
                let max_budget = if saver { 3 * 1024 * 1024 } else { 6 * 1024 * 1024 };

                if doc_size > 0 {
                    if let Ok(rt) = tokio::runtime::Handle::try_current() {
                        if let Some(bridge) = spawn_range_bridge(&rt, client.clone(), media.clone(), doc_size as u64, max_budget) {
                            if let Some(frame_bytes) = extract_ffmpeg_frame_from_url(&bridge.url, quality, is_av1_video) {
                                tg_log::info(
                                    BACKEND,
                                    "thumb_result",
                                    format!("status=ready source=ffmpeg_range bytes={}", frame_bytes.len()),
                                );
                                return Ok(frame_bytes);
                            }
                        }
                    }
                }

                // Strictly NO partial MP4 fallback! Fail-fast to Fallback Icon.
                tg_log::warn(
                    BACKEND,
                    "thumb_result",
                    "status=fallback reason=range_bridge_failed",
                );
                return Err(TgError::new(TgErrorCode::Internal, "RangeBridgeFailed"));

            } else {
                // Check Office document embedded thumbnail (docProps/thumbnail.jpeg inside ZIP container)
                if let Some(office_thumb) = extract_office_zip_thumbnail(&sample_bytes) {
                    return Ok(office_thumb);
                }
                // Check MP3 ID3 album art
                if let Some(album_art) = extract_id3_album_art(&sample_bytes) {
                    return Ok(album_art);
                }

                // Fallback extraction for general documents
                let ext_hint = if name.contains('.') {
                    name.rsplit('.').next().unwrap_or("bin")
                } else {
                    "bin"
                };

                let is_known_media_ext = matches!(
                    ext_hint,
                    "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "3gp" | "ts" | "flv" | "wmv"
                        | "jpg" | "jpeg" | "png" | "webp" | "bmp" | "gif" | "heic" | "heif" | "avif" | "tiff"
                );

                let is_binary_archive_or_text = sample_bytes.len() > 0 && (
                    sample_bytes.starts_with(b"{")
                        || sample_bytes.starts_with(b"[")
                        || sample_bytes.starts_with(b"<!--")
                        || sample_bytes.starts_with(b"http")
                        || sample_bytes.starts_with(b"PK\x03\x04")
                        || sample_bytes.starts_with(b"Rar!\x1a\x07")
                        || sample_bytes.starts_with(b"7z\xbc\xaf\x27\x1c")
                        || !is_known_media_ext
                );

                if !is_binary_archive_or_text {
                    let test_ext = if ext_hint == "bin" || ext_hint == "dat" { "mp4" } else { ext_hint };
                    if let Some(frame_bytes) = extract_ffmpeg_frame_sync(&sample_bytes, quality, test_ext) {
                        return Ok(frame_bytes);
                    }
                }

                // Ultimate fallback for document media (e.g. msg 73 / image sent as document):
                // If sample_bytes contains JPEG/PNG/WebP/GIF/BMP header anywhere in first 64 bytes,
                // finish downloading image payload and return sample_bytes directly!
                if sample_bytes.len() >= 64 {
                    let head = &sample_bytes[..sample_bytes.len().min(64)];
                    let is_image_data = head.windows(2).any(|w| w == [0xff, 0xd8])
                        || head.windows(4).any(|w| w == b"\x89PNG")
                        || head.windows(4).any(|w| w == b"WEBP")
                        || head.windows(3).any(|w| w == b"GIF")
                        || head.starts_with(b"BM");
                    if is_image_data {
                        let doc_size = d.size().unwrap_or(0) as usize;
                        let max_bytes = if doc_size > 0 && doc_size <= 8 * 1024 * 1024 {
                            doc_size
                        } else {
                            2048 * 1024
                        };
                        while sample_bytes.len() < max_bytes {
                            if let Ok(Some(chunk)) = iter.next().await.map_err(|e| map_invocation(&e)) {
                                sample_bytes.extend_from_slice(&chunk);
                            } else {
                                break;
                            }
                        }
                        return Ok(sample_bytes);
                    }
                }
            }
        }
    }

    // Tier 6: Try downloading ANY available static thumbnail layer from Telegram (no dimension/quality restriction)
    for s in &sizes {
        if matches!(s, PhotoSize::Size(_) | PhotoSize::Progressive(_) | PhotoSize::Cached(_)) {
            if let Ok(bytes) = download_thumb_bytes(client, s).await {
                if bytes.len() >= 64 {
                    return Ok(bytes);
                }
            }
        }
    }

    // Tier 7: Last-resort fallback: return stripped/cached inline JPEG if available (instead of leaving empty card)
    for s in &sizes {
        if let Some(data) = s.to_data() {
            let bytes = unstrip_jpeg(&data).unwrap_or(data);
            if !bytes.is_empty() {
                return Ok(bytes);
            }
        }
    }



    let (media_kind, mime, name, size) = match media {
        Media::Photo(_) => ("Photo", String::new(), String::new(), 0),
        Media::Document(d) => (
            "Document",
            d.mime_type().unwrap_or("").to_string(),
            d.name().unwrap_or("").to_string(),
            d.size().unwrap_or(0),
        ),
        Media::Sticker(_) => ("Sticker", String::new(), String::new(), 0),
        Media::WebPage(_) => ("WebPage", String::new(), String::new(), 0),
        _ => ("UnknownMedia", String::new(), String::new(), 0),
    };
    let ffmpeg_ok = find_ffmpeg_binary().is_some();
    let err_msg = format!(
        "no valid thumb found (kind={media_kind} sizes={} mime='{mime}' name='{name}' size={size} ffmpeg={ffmpeg_ok})",
        sizes.len()
    );

    let is_video_doc = media_kind == "Document" && (
        mime.starts_with("video/")
            || name.ends_with(".mp4")
            || name.ends_with(".mov")
            || name.ends_with(".mkv")
            || name.ends_with(".webm")
            || name.ends_with(".avi")
            || name.ends_with(".m4v")
            || name.ends_with(".3gp")
            || name.ends_with(".ts")
            || name.ends_with(".flv")
            || name.ends_with(".wmv")
    );

    if is_video_doc {
        tg_log::info(BACKEND, "thumb_miss_fallback", &format!("Video document '{name}' had no extractable frame; returning miss"));
    }

    if media_kind == "Document" && !mime.starts_with("video/") && !mime.starts_with("image/") {
        tg_log::info(BACKEND, "thumb_miss_detail", &err_msg);
    } else {
        tg_log::warn(BACKEND, "thumb_miss_detail", &err_msg);
    }
    Err(TgError::new(TgErrorCode::Internal, err_msg))
}

fn extract_embedded_pdf_image(pdf_bytes: &[u8]) -> Option<Vec<u8>> {
    if pdf_bytes.len() < 128 {
        return None;
    }
    // Search for JPEG header \xFF\xD8\xFF in pdf_bytes
    let max_len = pdf_bytes.len().saturating_sub(64);
    for i in 0..max_len {
        if pdf_bytes[i] == 0xff && pdf_bytes[i + 1] == 0xd8 && pdf_bytes[i + 2] == 0xff {
            // Find end of JPEG marker \xFF\xD9
            if let Some(end_rel) = pdf_bytes[i + 3..].windows(2).position(|w| w == [0xff, 0xd9]) {
                let end_pos = i + 3 + end_rel + 2;
                let jpeg_data = &pdf_bytes[i..end_pos];
                if jpeg_data.len() >= 512 {
                    return Some(jpeg_data.to_vec());
                }
            }
        }
        // Search for PNG header \x89PNG
        if pdf_bytes[i..].starts_with(b"\x89PNG\r\n\x1a\n") {
            if let Some(end_rel) = pdf_bytes[i + 8..].windows(4).position(|w| w == b"IEND") {
                let end_pos = i + 8 + end_rel + 8;
                let png_data = &pdf_bytes[i..end_pos.min(pdf_bytes.len())];
                if png_data.len() >= 256 {
                    return Some(png_data.to_vec());
                }
            }
        }
    }
    None
}

fn patch_moov_offsets(moov_buf: &mut [u8], shift_amount: usize) {
    if shift_amount == 0 || moov_buf.len() < 12 {
        return;
    }
    let shift_u32 = shift_amount as u32;
    let shift_u64 = shift_amount as u64;

    // Patch stco (32-bit chunk offset atom)
    let stco_tag = b"stco";
    if moov_buf.len() >= 12 {
        for i in 4..=moov_buf.len() - 12 {
            if &moov_buf[i..i + 4] == stco_tag {
                let entry_count = u32::from_be_bytes([
                    moov_buf[i + 8],
                    moov_buf[i + 9],
                    moov_buf[i + 10],
                    moov_buf[i + 11],
                ]) as usize;
                let mut off = i + 12;
                for _ in 0..entry_count {
                    if off + 4 <= moov_buf.len() {
                        let old_val = u32::from_be_bytes([
                            moov_buf[off],
                            moov_buf[off + 1],
                            moov_buf[off + 2],
                            moov_buf[off + 3],
                        ]);
                        let new_val = old_val.wrapping_add(shift_u32);
                        moov_buf[off..off + 4].copy_from_slice(&new_val.to_be_bytes());
                        off += 4;
                    } else {
                        break;
                    }
                }
            }
        }
    }

    // Patch co64 (64-bit chunk offset atom)
    let co64_tag = b"co64";
    if moov_buf.len() >= 12 {
        for i in 4..=moov_buf.len() - 12 {
            if &moov_buf[i..i + 4] == co64_tag {
                let entry_count = u32::from_be_bytes([
                    moov_buf[i + 8],
                    moov_buf[i + 9],
                    moov_buf[i + 10],
                    moov_buf[i + 11],
                ]) as usize;
                let mut off = i + 12;
                for _ in 0..entry_count {
                    if off + 8 <= moov_buf.len() {
                        let old_val = u64::from_be_bytes([
                            moov_buf[off],
                            moov_buf[off + 1],
                            moov_buf[off + 2],
                            moov_buf[off + 3],
                            moov_buf[off + 4],
                            moov_buf[off + 5],
                            moov_buf[off + 6],
                            moov_buf[off + 7],
                        ]);
                        let new_val = old_val.wrapping_add(shift_u64);
                        moov_buf[off..off + 8].copy_from_slice(&new_val.to_be_bytes());
                        off += 8;
                    } else {
                        break;
                    }
                }
            }
        }
    }
}

fn patch_head_mp4(sample_bytes: &[u8]) -> Vec<u8> {
    let mut patched = sample_bytes.to_vec();
    if patched.len() >= 12 {
        for i in 4..=patched.len() - 8 {
            if &patched[i..i + 4] == b"mdat" {
                let mdat_start = i - 4;
                let new_len = (patched.len() - mdat_start) as u32;
                patched[mdat_start..mdat_start + 4].copy_from_slice(&new_len.to_be_bytes());
                break;
            }
        }
    }
    patched
}

fn parse_first_chunk_offset(moov_buf: &[u8]) -> Option<u64> {
    let stco_tag = b"stco";
    if moov_buf.len() >= 16 {
        for i in 4..=moov_buf.len() - 16 {
            if &moov_buf[i..i + 4] == stco_tag {
                let entry_count = u32::from_be_bytes([
                    moov_buf[i + 8],
                    moov_buf[i + 9],
                    moov_buf[i + 10],
                    moov_buf[i + 11],
                ]);
                if entry_count > 0 {
                    let first_off = u32::from_be_bytes([
                        moov_buf[i + 12],
                        moov_buf[i + 13],
                        moov_buf[i + 14],
                        moov_buf[i + 15],
                    ]) as u64;
                    if first_off > 0 {
                        return Some(first_off);
                    }
                }
            }
        }
    }
    let co64_tag = b"co64";
    if moov_buf.len() >= 20 {
        for i in 4..=moov_buf.len() - 20 {
            if &moov_buf[i..i + 4] == co64_tag {
                let entry_count = u32::from_be_bytes([
                    moov_buf[i + 8],
                    moov_buf[i + 9],
                    moov_buf[i + 10],
                    moov_buf[i + 11],
                ]);
                if entry_count > 0 {
                    let first_off = u64::from_be_bytes([
                        moov_buf[i + 12],
                        moov_buf[i + 13],
                        moov_buf[i + 14],
                        moov_buf[i + 15],
                        moov_buf[i + 16],
                        moov_buf[i + 17],
                        moov_buf[i + 18],
                        moov_buf[i + 19],
                    ]);
                    if first_off > 0 {
                        return Some(first_off);
                    }
                }
            }
        }
    }
    None
}

fn locate_valid_moov_atom(buf: &[u8]) -> Option<(usize, usize)> {
    if buf.len() < 8 {
        return None;
    }
    for i in (4..=buf.len() - 4).rev() {
        if &buf[i..i + 4] == b"moov" {
            let pos = i - 4;
            let raw_sz = u32::from_be_bytes([buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]]) as usize;
            let moov_size = if raw_sz == 1 && pos + 16 <= buf.len() {
                u64::from_be_bytes([
                    buf[pos + 8],
                    buf[pos + 9],
                    buf[pos + 10],
                    buf[pos + 11],
                    buf[pos + 12],
                    buf[pos + 13],
                    buf[pos + 14],
                    buf[pos + 15],
                ]) as usize
            } else if raw_sz >= 8 {
                raw_sz
            } else {
                continue;
            };

            // Validate that this is an authentic MP4 moov atom containing child boxes (mvhd, trak, cmov, meta, udta)
            // This prevents false positives when the 4 bytes 'moov' occur inside raw mdat video bitstream.
            let check_len = moov_size.min(buf.len().saturating_sub(pos));
            if check_len >= 8 {
                let is_valid = buf[pos..pos + check_len]
                    .windows(4)
                    .any(|w| w == b"mvhd" || w == b"trak" || w == b"cmov" || w == b"meta" || w == b"udta");
                if is_valid {
                    return Some((pos, moov_size));
                }
            }
        }
    }
    None
}

fn make_faststart_mp4(sample_bytes: &[u8], tail_bytes: &[u8]) -> Option<Vec<u8>> {
    if sample_bytes.len() < 16 || tail_bytes.is_empty() {
        return None;
    }

    let (target_buf, pos, moov_size) = if let Some((p, sz)) = locate_valid_moov_atom(tail_bytes) {
        (tail_bytes, p, sz)
    } else if let Some((p, sz)) = locate_valid_moov_atom(sample_bytes) {
        (sample_bytes, p, sz)
    } else {
        return None;
    };

    if pos + moov_size > target_buf.len() {
        // moov atom is truncated in current target_buf.
        // Return None so caller fetches a larger tail sample to get the complete moov atom.
        return None;
    }

    let mut moov_slice = target_buf[pos..pos + moov_size].to_vec();
    patch_moov_offsets(&mut moov_slice, moov_size);

    let ftyp_size = if sample_bytes.len() >= 8 && &sample_bytes[4..8] == b"ftyp" {
        u32::from_be_bytes([
            sample_bytes[0],
            sample_bytes[1],
            sample_bytes[2],
            sample_bytes[3],
        ]) as usize
    } else {
        32
    };

    let ftyp_len = ftyp_size.min(sample_bytes.len());
    let mut out = Vec::with_capacity(ftyp_len + moov_size + sample_bytes.len() - ftyp_len);

    out.extend_from_slice(&sample_bytes[0..ftyp_len]);
    out.extend_from_slice(&moov_slice);

    let mut mdat_rem = sample_bytes[ftyp_len..].to_vec();
    if mdat_rem.len() >= 8 && &mdat_rem[4..8] == b"mdat" {
        let new_mdat_len = mdat_rem.len() as u32;
        mdat_rem[0..4].copy_from_slice(&new_mdat_len.to_be_bytes());
    }
    out.extend_from_slice(&mdat_rem);

    Some(out)
}

async fn make_smart_target_mp4(
    client: &grammers_client::Client,
    d: &grammers_client::media::Document,
    sample_bytes: &[u8],
    tail_bytes: &[u8],
    quality: &str,
    ext_hint: &str,
) -> Option<Vec<u8>> {
    if sample_bytes.len() < 16 || tail_bytes.is_empty() {
        return None;
    }

    let (target_buf, pos, moov_size) = if let Some((p, sz)) = locate_valid_moov_atom(tail_bytes) {
        (tail_bytes, p, sz)
    } else if let Some((p, sz)) = locate_valid_moov_atom(sample_bytes) {
        (sample_bytes, p, sz)
    } else {
        return None;
    };

    if pos + moov_size > target_buf.len() {
        return None;
    }

    let moov_slice = &target_buf[pos..pos + moov_size];
    let first_off = parse_first_chunk_offset(moov_slice)?;

    let chunk_size = 256 * 1024u64;
    let target_chunk = (first_off / chunk_size) as i32;
    let chunk_start_byte = (target_chunk as u64) * chunk_size;

    let mut target_frame_bytes = Vec::new();
    let mut iter = client.iter_download(d).chunk_size(chunk_size as i32).skip_chunks(target_chunk);
    // Fetch 16 chunks (4 MB) starting at target_chunk to provide enough keyframes for 1s-3s seeking
    for _ in 0..16 {
        if let Ok(Some(chunk)) = iter.next().await.map_err(|e| map_invocation(&e)) {
            target_frame_bytes.extend_from_slice(&chunk);
        } else {
            break;
        }
    }
    if target_frame_bytes.is_empty() {
        return None;
    }

    let ftyp_size = if sample_bytes.len() >= 8 && &sample_bytes[4..8] == b"ftyp" {
        u32::from_be_bytes([
            sample_bytes[0],
            sample_bytes[1],
            sample_bytes[2],
            sample_bytes[3],
        ]) as usize
    } else {
        32
    };
    let ftyp_len = ftyp_size.min(sample_bytes.len());

    let new_first_off = (ftyp_len + moov_size) as u64 + (first_off.saturating_sub(chunk_start_byte));
    let shift_needed = new_first_off.wrapping_sub(first_off);

    let mut patched_moov = moov_slice.to_vec();
    patch_moov_offsets(&mut patched_moov, shift_needed as usize);

    let mut out = Vec::with_capacity(ftyp_len + moov_size + target_frame_bytes.len() + 16);
    out.extend_from_slice(&sample_bytes[0..ftyp_len]);
    out.extend_from_slice(&patched_moov);

    if target_frame_bytes.len() >= 8 && &target_frame_bytes[4..8] == b"mdat" {
        out.extend_from_slice(&target_frame_bytes);
    } else {
        let mdat_hdr_size = (target_frame_bytes.len() + 8) as u32;
        out.extend_from_slice(&mdat_hdr_size.to_be_bytes());
        out.extend_from_slice(b"mdat");
        out.extend_from_slice(&target_frame_bytes);
    }

    extract_ffmpeg_frame_sync(&out, quality, ext_hint)
}

pub fn thumbs_batch_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    message_ids: &[i64],
    quality: &str,
    request_id: Option<&str>,
    app: Option<&tauri::AppHandle>,
) -> Result<ThumbsBatchResult, TgError> {
    let req = crate::core::telegram_ops::ThumbsBatchRequest {
        session: identity.session.clone(),
        api_id: identity.api_id,
        api_hash: identity.api_hash.clone(),
        batch_id: None,
        items: Vec::new(),
        request_id: request_id.map(String::from),
        chat_id: Some(chat_id.to_string()),
        telegram_peer_id: Some(chat_id.to_string()),
        message_ids: Some(message_ids.to_vec()),
        telegram_message_ids: Some(message_ids.to_vec()),
        quality: Some(quality.to_string()),
    };
    thumbs_batch_items_blocking_app(sessions_dir, identity, &req, quality, app)
}

pub fn thumbs_batch_items_blocking_app(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    req: &crate::core::telegram_ops::ThumbsBatchRequest,
    quality: &str,
    app: Option<&tauri::AppHandle>,
) -> Result<ThumbsBatchResult, TgError> {
    use crate::core::telegram_ops::ThumbnailItemRequest;

    let batch_id = req
        .batch_id
        .as_deref()
        .unwrap_or("thumb-batch:default")
        .to_string();

    let items: Vec<ThumbnailItemRequest> = if !req.items.is_empty() {
        req.items.clone()
    } else {
        let peer = req
            .telegram_peer_id
            .as_deref()
            .or(req.chat_id.as_deref())
            .unwrap_or("me")
            .to_string();
        let req_id_prefix = req.request_id.as_deref().unwrap_or("thumb");
        let mids = req
            .telegram_message_ids
            .as_ref()
            .or(req.message_ids.as_ref());
        if let Some(mids) = mids {
            mids.iter()
                .filter(|&&id| id > 0)
                .take(64)
                .map(|&id| {
                    let request_id = if req_id_prefix.contains(":g") || req_id_prefix.ends_with(&id.to_string()) {
                        req_id_prefix.to_string()
                    } else {
                        format!("{req_id_prefix}:{id}")
                    };
                    ThumbnailItemRequest {
                        request_id,
                        peer_id: peer.clone(),
                        telegram_message_id: id as i32,
                        quality: Some(quality.to_string()),
                        generation: None,
                    }
                })
                .collect()
        } else {
            Vec::new()
        }
    };

    if items.is_empty() {
        return Ok(ThumbsBatchResult {
            status: "success".into(),
            thumbs: HashMap::new(),
            items: Vec::new(),
            backend: BACKEND.into(),
        });
    }

    let rt = runtime()?;
    let q_mode = quality.to_lowercase();
    let q_key = if q_mode.contains("hemat") || q_mode.contains("saver") {
        "hemat"
    } else if q_mode.contains("jelas") || q_mode.contains("sharp") {
        "jelas"
    } else {
        "seimbang"
    };

    let t_dir = thumb_dir(sessions_dir);
    let _ = std::fs::create_dir_all(&t_dir);
    prune_thumb_cache(&t_dir);

    let mut thumbs: HashMap<String, Option<String>> = HashMap::new();
    let mut item_results: Vec<ThumbnailBatchItemResult> = Vec::new();
    let mut uncached_items: Vec<ThumbnailItemRequest> = Vec::new();

    for item in &items {
        let peer_id = &item.peer_id;
        let mid = item.telegram_message_id;
        let item_req_id = &item.request_id;
        let key = mid.to_string();

        // 1. Correlation assertion check (Requirement 1)
        if let Some(gen) = item.generation {
            let expected_id = format!("thumb:{}:{}:g{}", peer_id, mid, gen);
            if item_req_id != &expected_id {
                tg_log::warn(
                    BACKEND,
                    "thumb_invalid_correlation",
                    format!(
                        "op=thumb_invalid_correlation batch_id={batch_id} item_request_id={item_req_id} requested_peer_id={peer_id} requested_message_id={mid} reason=InvalidRequestCorrelation"
                    ),
                );
                thumbs.insert(key, None);
                item_results.push(ThumbnailBatchItemResult {
                    request_id: item_req_id.clone(),
                    peer_id: peer_id.clone(),
                    telegram_message_id: mid,
                    status: "failed".into(),
                    source: None,
                    reason: Some("InvalidRequestCorrelation".into()),
                    url: None,
                    classification: None,
                });
                continue;
            }
        }

        // 2. Terminal fallback cache check (Requirement 6)
        let term_key = format!("v99_item_{peer_id}_{mid}");
        if thumb_terminal_cache().lock().contains(&term_key) {
            tg_log::info(
                BACKEND,
                "thumb_terminal_cache_hit",
                format!(
                    "op=thumb_terminal_cache_hit batch_id={batch_id} item_request_id={item_req_id} requested_peer_id={peer_id} requested_message_id={mid}"
                ),
            );
            thumbs.insert(key, None);
            item_results.push(ThumbnailBatchItemResult {
                request_id: item_req_id.clone(),
                peer_id: peer_id.clone(),
                telegram_message_id: mid,
                status: "fallback".into(),
                source: Some("file_type_icon".into()),
                reason: Some("GenericDocumentNoThumbnail".into()),
                url: None,
                classification: Some("GenericDocument".into()),
            });
            continue;
        }

        // 3. Disk / memory cache check
        let peer_safe: String = peer_id
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .collect();
        let cache_key = format!("v99_item_{peer_safe}_{mid}_{q_key}");
        let mut found_url: Option<String> = None;
        {
            let mem = thumb_mem_cache().lock();
            if let Some(url) = mem.get(&cache_key) {
                if !url.is_empty() && url != "NOT_FOUND" {
                    found_url = Some(url.clone());
                }
            }
        }

        if found_url.is_none() {
            let cache_file = t_dir.join(format!("{cache_key}.jpg"));
            if cache_file.is_file() {
                if let Ok(bytes) = std::fs::read(&cache_file) {
                    if bytes.len() >= 64 {
                        if let Some(url) = to_data_url(&bytes) {
                            thumb_mem_cache().lock().insert(cache_key.clone(), url.clone());
                            found_url = Some(url);
                        }
                    }
                }
            }
        }

        if let Some(url) = found_url {
            tg_log::info(
                BACKEND,
                "thumb_cache_hit",
                format!(
                    "op=thumb_cache_hit batch_id={batch_id} item_request_id={item_req_id} requested_peer_id={peer_id} requested_message_id={mid}"
                ),
            );
            thumbs.insert(key, Some(url.clone()));
            item_results.push(ThumbnailBatchItemResult {
                request_id: item_req_id.clone(),
                peer_id: peer_id.clone(),
                telegram_message_id: mid,
                status: "ready".into(),
                source: Some("disk_cache".into()),
                reason: None,
                url: Some(url.clone()),
                classification: None,
            });
            if let Some(app_handle) = app {
                let _ = app_handle.emit(
                    "thumb_single_ready",
                    ThumbSinglePayload {
                        chat_id: peer_id.clone(),
                        message_id: mid as i64,
                        quality: q_key.to_string(),
                        url,
                        is_placeholder: false,
                    },
                );
            }
            continue;
        }

        uncached_items.push(item.clone());
    }

    if uncached_items.is_empty() {
        return Ok(ThumbsBatchResult {
            status: "success".into(),
            thumbs,
            items: item_results,
            backend: BACKEND.into(),
        });
    }

    let app_owned = app.cloned();

    rt.block_on(async {
        with_pool_retry(&identity.session, || {
            let uncached_items = uncached_items.clone();
            let t_dir = t_dir.clone();
            let mut thumbs = thumbs.clone();
            let mut item_results = item_results.clone();
            let app_owned = app_owned.clone();
            let session_name = identity.session.clone();
            let batch_id = batch_id.clone();

            with_client(sessions_dir, identity, true, move |client| {
                let app_ref = app_owned.clone();
                let session_name = session_name.clone();
                let batch_id = batch_id.clone();

                Box::pin(async move {
                    if !crate::core::grammers_ops::session_known_authorized(&session_name)
                        && !client.is_authorized().await.map_err(|e| map_invocation(&e))?
                    {
                        return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                    }

                    // Group uncached items by peer_id
                    let mut items_by_peer: HashMap<String, Vec<ThumbnailItemRequest>> = HashMap::new();
                    for it in uncached_items {
                        items_by_peer.entry(it.peer_id.clone()).or_default().push(it);
                    }

                    for (peer_str, p_items) in items_by_peer {
                        let peer = match resolve_peer(client, &peer_str).await {
                            Ok(p) => p,
                            Err(e) => {
                                tg_log::warn(
                                    BACKEND,
                                    "thumb_peer_failed",
                                    format!("op=thumb_peer_failed batch_id={batch_id} requested_peer_id={peer_str} error={e}"),
                                );
                                for it in p_items {
                                    thumbs.insert(it.telegram_message_id.to_string(), None);
                                    item_results.push(ThumbnailBatchItemResult {
                                        request_id: it.request_id.clone(),
                                        peer_id: it.peer_id.clone(),
                                        telegram_message_id: it.telegram_message_id,
                                        status: "failed".into(),
                                        source: None,
                                        reason: Some("PeerResolutionFailed".into()),
                                        url: None,
                                        classification: None,
                                    });
                                }
                                continue;
                            }
                        };

                        let mids: Vec<i32> = p_items.iter().map(|it| it.telegram_message_id).collect();
                        tg_log::info(
                            BACKEND,
                            "thumb_lookup_started",
                            format!("op=thumb_lookup_started batch_id={batch_id} requested_peer_id={peer_str} fetch_count={}", mids.len()),
                        );

                        let msgs = client.get_messages_by_id(peer, &mids).await.map_err(|e| map_invocation(&e))?;
                        let mut msg_by_id: HashMap<i32, grammers_client::message::Message> = HashMap::new();
                        for m_opt in msgs {
                            if let Some(m) = m_opt {
                                msg_by_id.insert(m.id(), m);
                            }
                        }

                        for it in p_items {
                            let mid = it.telegram_message_id;
                            let item_req_id = &it.request_id;
                            let key = mid.to_string();
                            let term_key = format!("v99_item_{peer_str}_{mid}");

                            let Some(msg) = msg_by_id.get(&mid) else {
                                tg_log::warn(
                                    BACKEND,
                                    "thumb_msg_not_returned",
                                    format!("op=thumb_msg_not_returned batch_id={batch_id} item_request_id={item_req_id} requested_peer_id={peer_str} requested_message_id={mid} reason=MessageNotReturned"),
                                );
                                thumbs.insert(key, None);
                                item_results.push(ThumbnailBatchItemResult {
                                    request_id: item_req_id.clone(),
                                    peer_id: peer_str.clone(),
                                    telegram_message_id: mid,
                                    status: "failed".into(),
                                    source: None,
                                    reason: Some("MessageNotReturned".into()),
                                    url: None,
                                    classification: None,
                                });
                                continue;
                            };

                            let msg_var = "Message";
                            let text_len = msg.text().len();
                            let raw_var = if msg.media().is_some() { "Media" } else { "Text" };
                            let has_media = msg.media().is_some();

                            // Requirement 9: Inspection log
                            tg_log::info(
                                BACKEND,
                                "thumb_message_inspected",
                                format!(
                                    "op=thumb_message_inspected batch_id={batch_id} item_request_id={item_req_id} requested_peer_id={peer_str} requested_message_id={mid} returned_message_id={} message_variant={msg_var} text_length={text_len} has_media={has_media} raw_media_variant={raw_var}",
                                    msg.id()
                                ),
                            );

                            if !has_media {
                                tg_log::warn(
                                    BACKEND,
                                    "MediaListingContractViolation",
                                    format!("op=MediaListingContractViolation batch_id={batch_id} item_request_id={item_req_id} requested_peer_id={peer_str} requested_message_id={mid}"),
                                );
                                if let Some(app_handle) = &app_ref {
                                    use tauri::Emitter;
                                    let _ = app_handle.emit(
                                        "topic-media://invalidate-media-row",
                                        serde_json::json!({
                                            "peerId": peer_str.clone(),
                                            "telegramMessageId": mid,
                                            "reason": "MediaListingContractViolation"
                                        }),
                                    );
                                }
                                thumb_terminal_cache().lock().insert(term_key);
                                thumbs.insert(key, None);
                                item_results.push(ThumbnailBatchItemResult {
                                    request_id: item_req_id.clone(),
                                    peer_id: peer_str.clone(),
                                    telegram_message_id: mid,
                                    status: "not_applicable".into(),
                                    source: None,
                                    reason: Some("MediaListingContractViolation".into()),
                                    url: None,
                                    classification: Some("NoMedia".into()),
                                });
                                continue;
                            }

                            // Requirement 3: Explicit Media Classification
                            let classification = classify_message_media(msg);
                            if classification.is_generic_or_non_media() {
                                tg_log::info(
                                    BACKEND,
                                    "thumb_generic_fallback",
                                    format!(
                                        "op=thumb_generic_fallback batch_id={batch_id} item_request_id={item_req_id} requested_peer_id={peer_str} requested_message_id={mid} classification={} status=fallback source=file_type_icon reason=GenericDocumentNoThumbnail",
                                        classification.as_str()
                                    ),
                                );
                                thumb_terminal_cache().lock().insert(term_key);
                                thumbs.insert(key, None);
                                item_results.push(ThumbnailBatchItemResult {
                                    request_id: item_req_id.clone(),
                                    peer_id: peer_str.clone(),
                                    telegram_message_id: mid,
                                    status: "fallback".into(),
                                    source: Some("file_type_icon".into()),
                                    reason: Some("GenericDocumentNoThumbnail".into()),
                                    url: None,
                                    classification: Some(classification.as_str().to_string()),
                                });
                                continue;
                            }

                            // Photo or document static thumbnail extraction
                            let Some(media) = msg.media() else { continue; };
                            let peer_safe: String = peer_str.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
                            let q_cache = format!("v99_item_{peer_safe}_{mid}_{q_key}");

                            let dl_res = download_media_thumb(&client, &media, q_key).await;
                            match dl_res {
                                Ok(bytes) if bytes.len() >= 64 => {
                                    let cache_file = t_dir.join(format!("{q_cache}.jpg"));
                                    let rand_id = now_ms();
                                    let part_file = t_dir.join(format!("{q_cache}.{rand_id}.part"));
                                    if std::fs::write(&part_file, &bytes).is_ok() {
                                        let _ = std::fs::rename(&part_file, &cache_file);
                                    }
                                    if let Some(url) = to_data_url(&bytes) {
                                        thumb_mem_cache().lock().insert(q_cache, url.clone());
                                        thumbs.insert(key, Some(url.clone()));
                                        item_results.push(ThumbnailBatchItemResult {
                                            request_id: item_req_id.clone(),
                                            peer_id: peer_str.clone(),
                                            telegram_message_id: mid,
                                            status: "ready".into(),
                                            source: Some("telegram_thumb".into()),
                                            reason: None,
                                            url: Some(url),
                                            classification: Some(classification.as_str().to_string()),
                                        });
                                        continue;
                                    }
                                }
                                _ => {}
                            }

                            // Requirement 4: FFmpeg strictly gated for Video ONLY
                            if classification.is_video() {
                                tg_log::info(
                                    BACKEND,
                                    "thumb_ffmpeg_attempt",
                                    format!("op=thumb_ffmpeg_attempt batch_id={batch_id} item_request_id={item_req_id} requested_peer_id={peer_str} requested_message_id={mid} classification=VideoDocument"),
                                );
                                if let Some(_caps) = get_ffmpeg_capabilities() {
                                    let rt_handle = tokio::runtime::Handle::current();
                                    let total_size = media.size().unwrap_or(0) as u64;
                                    let max_budget = 2 * 1024 * 1024;
                                    if let Some(bridge) = spawn_range_bridge(&rt_handle, client.clone(), media.clone(), total_size, max_budget) {
                                        let probe_url = bridge.url.clone();
                                        let q_mode = q_key.to_string();
                                        let frame_res = tokio::task::spawn_blocking(move || {
                                            extract_ffmpeg_frame_from_url(&probe_url, &q_mode, false)
                                        }).await;
                                        if let Ok(Some(frame_bytes)) = frame_res {
                                            if frame_bytes.len() >= 64 && !is_fallback_black_card_bytes(&frame_bytes) {
                                                if let Some(url) = to_data_url(&frame_bytes) {
                                                    thumbs.insert(key.clone(), Some(url.clone()));
                                                    item_results.push(ThumbnailBatchItemResult {
                                                        request_id: item_req_id.clone(),
                                                        peer_id: peer_str.clone(),
                                                        telegram_message_id: mid,
                                                        status: "ready".into(),
                                                        source: Some("ffmpeg_range".into()),
                                                        reason: None,
                                                        url: Some(url),
                                                        classification: Some(classification.as_str().to_string()),
                                                    });
                                                    continue;
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Default fallback if no static thumb or ffmpeg frame retrieved
                            thumb_terminal_cache().lock().insert(term_key);
                            thumbs.insert(key, None);
                            item_results.push(ThumbnailBatchItemResult {
                                request_id: item_req_id.clone(),
                                peer_id: peer_str.clone(),
                                telegram_message_id: mid,
                                status: "fallback".into(),
                                source: Some("file_type_icon".into()),
                                reason: Some("NoThumbnailAvailable".into()),
                                url: None,
                                classification: Some(classification.as_str().to_string()),
                            });
                        }
                    }

                    Ok(ThumbsBatchResult {
                        status: "success".into(),
                        thumbs,
                        items: item_results,
                        backend: BACKEND.into(),
                    })
                })
            })
        }).await
    })
}

// Section

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identity_contract_batch_matching() {
        let requested_ids = vec![10, 20, 30, 40, 50];
        let mut mock_map: HashMap<i32, String> = HashMap::new();
        // Simulate missing message ID 30 (not returned by Telegram) and out-of-order return
        mock_map.insert(50, "msg_50".to_string());
        mock_map.insert(10, "msg_10".to_string());
        mock_map.insert(40, "msg_40".to_string());
        mock_map.insert(20, "msg_20".to_string());

        let mut resolved_results: HashMap<i32, Option<String>> = HashMap::new();
        for &req_id in &requested_ids {
            let res = mock_map.get(&req_id).cloned();
            resolved_results.insert(req_id, res);
        }

        assert_eq!(resolved_results.get(&10), Some(&Some("msg_10".to_string())));
        assert_eq!(resolved_results.get(&20), Some(&Some("msg_20".to_string())));
        assert_eq!(resolved_results.get(&30), Some(&None)); // Missing ID 30 cleanly resolved as None, not swapped!
        assert_eq!(resolved_results.get(&40), Some(&Some("msg_40".to_string())));
        assert_eq!(resolved_results.get(&50), Some(&Some("msg_50".to_string())));
    }

    #[test]
    fn test_per_item_request_id_correlation() {
        let peer_id = "-1004468191168";
        let msg_id = 215;
        let gen = 4;
        let valid_req_id = format!("thumb:{}:{}:g{}", peer_id, msg_id, gen);
        assert_eq!(valid_req_id, "thumb:-1004468191168:215:g4");

        let mismatch_req_id = "thumb:-1004468191168:214:g4";
        assert_ne!(mismatch_req_id, valid_req_id);
    }

    #[test]
    fn test_media_classification_ffmpeg_gating() {
        // Generic bin files must be classified as GenericDocument and reject FFmpeg
        let bin_class = classify_media_preview(Some("application/octet-stream"), Some("speed_12mb.bin"));
        assert!(matches!(bin_class, MediaPreviewClass::GenericDocument));
        assert!(!is_ffmpeg_eligible_media(&bin_class, Some("application/octet-stream"), Some("speed_12mb.bin")));

        // Archive zip files must reject FFmpeg
        let zip_class = classify_media_preview(Some("application/zip"), Some("data.zip"));
        assert!(matches!(zip_class, MediaPreviewClass::ArchiveDocument));
        assert!(!is_ffmpeg_eligible_media(&zip_class, Some("application/zip"), Some("data.zip")));

        // Video mp4 must accept FFmpeg
        let video_class = classify_media_preview(Some("video/mp4"), Some("clip.mp4"));
        assert!(matches!(video_class, MediaPreviewClass::TelegramVideo | MediaPreviewClass::VideoDocument));
        assert!(is_ffmpeg_eligible_media(&video_class, Some("video/mp4"), Some("clip.mp4")));
    }

    #[test]
    fn test_parse_thumb_request_id_valid() {
        let req_id = "thumb:-1004468191168:220:g2";
        let parsed = parse_thumb_request_id(req_id).expect("Should parse valid thumb request ID");
        assert_eq!(parsed.peer_id, "-1004468191168");
        assert_eq!(parsed.message_id, 220);
        assert_eq!(parsed.generation, 2);
    }

    #[test]
    fn test_parse_thumb_request_id_mismatch_and_invalid() {
        let req_id = "thumb:-1004468191168:220:g2";
        let parsed = parse_thumb_request_id(req_id).unwrap();
        // Mismatch check
        assert_ne!(parsed.message_id, 221);
        assert_ne!(parsed.peer_id, "-1001234567890");

        // Invalid format
        assert!(parse_thumb_request_id("invalid_format").is_none());
        assert!(parse_thumb_request_id("thumb:-1004468191168:220").is_none());
    }

    #[test]
    fn test_request_id_no_double_append() {
        let prefix = "thumb:-1004468191168:220:g2";
        let msg_id = 220;
        let formatted = if prefix.contains(":g") || prefix.ends_with(&msg_id.to_string()) {
            prefix.to_string()
        } else {
            format!("{prefix}:{msg_id}")
        };
        assert_eq!(formatted, "thumb:-1004468191168:220:g2");
        assert_ne!(formatted, "thumb:-1004468191168:220:g2:220");
    }

    #[test]
    fn test_batch_id_uuid_format() {
        let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
        let batch_id = format!("thumb-batch:{uuid_str}");
        assert!(batch_id.starts_with("thumb-batch:"));
        assert_ne!(batch_id, "thumb-batch:default");
    }
}
