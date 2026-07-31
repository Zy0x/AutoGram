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

// Thumbnails
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbsBatchResult {
    pub status: String,
    pub thumbs: HashMap<String, Option<String>>,
    pub backend: String,
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
) -> Result<ThumbsBatchResult, TgError> {
    thumbs_batch_blocking_app(sessions_dir, identity, chat_id, message_ids, quality, None)
}

pub fn thumbs_batch_blocking_app(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    message_ids: &[i64],
    quality: &str,
    app: Option<&tauri::AppHandle>,
) -> Result<ThumbsBatchResult, TgError> {
    let ids: Vec<i32> = message_ids
        .iter()
        .filter(|&&id| id > 0)
        .take(64)
        .map(|&id| id as i32)
        .collect();
    if ids.is_empty() {
        return Ok(ThumbsBatchResult {
            status: "success".into(),
            thumbs: HashMap::new(),
            backend: BACKEND.into(),
        });
    }
    let rt = runtime()?;
    let chat = chat_id.to_string();
    let q_mode = quality.to_lowercase();
    let q_key = if q_mode.contains("hemat") || q_mode.contains("saver") {
        "hemat"
    } else if q_mode.contains("jelas") || q_mode.contains("sharp") {
        "jelas"
    } else {
        "seimbang"
    };
    let chat_safe: String = chat
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let t_dir = thumb_dir(sessions_dir);
    let _ = std::fs::create_dir_all(&t_dir);
    prune_thumb_cache(&t_dir);

    // Section
    let mut thumbs: HashMap<String, Option<String>> = HashMap::new();
    let mut uncached_ids: Vec<i32> = Vec::new();

    for &mid in &ids {
        let key = mid.to_string();
        let cache_key = format!("v98_{chat_safe}_{mid}_{q_key}");
        tg_log::info(
            BACKEND,
            "thumb_request_identity",
            format!("op=thumb_request_identity account_id={} peer_id={} topic_id=None message_id={} media_kind_from_list=unknown", identity.session, chat, mid),
        );
        let mut found_url: Option<String> = None;
        let mut is_negative_hit = false;
        {
            let mem = thumb_mem_cache().lock();
            if let Some(url) = mem.get(&cache_key) {
                if url == "NOT_FOUND" {
                    is_negative_hit = true;
                } else if !url.is_empty() {
                    found_url = Some(url.clone());
                }
            }
        }
        if !is_negative_hit && found_url.is_none() {
            let nothumb_file = t_dir.join(format!("{cache_key}.nothumb"));
            if nothumb_file.is_file() {
                let _ = std::fs::remove_file(&nothumb_file);
            }
        }
        if is_negative_hit {
            tg_log::info(
                BACKEND,
                "thumb_cache_hit",
                format!("op=thumb_cache_hit message_id={mid} negative=true"),
            );
            thumbs.insert(key, None);
            continue;
        }

        if found_url.is_none() {
            // Prefer exact quality file; fall back to hemat (stripped) so grid
            // reopens like Telegram without re-hitting the network.
            let cache_file = t_dir.join(format!("{cache_key}.jpg"));
            if cache_file.is_file() {
                if let Ok(bytes) = std::fs::read(&cache_file) {
                    let min_disk = 64;
                    if bytes.len() >= min_disk {
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
                format!("op=thumb_cache_hit message_id={mid}"),
            );
            thumbs.insert(key, Some(url.clone()));
            if let Some(app_handle) = app {
                let _ = app_handle.emit(
                    "thumb_single_ready",
                    ThumbSinglePayload {
                        chat_id: chat.clone(),
                        message_id: mid as i64,
                        quality: q_key.to_string(),
                        url,
                        is_placeholder: false,
                    },
                );
            }
            continue;
        }
        uncached_ids.push(mid);
    }

    if uncached_ids.is_empty() {
        return Ok(ThumbsBatchResult {
            status: "success".into(),
            thumbs,
            backend: BACKEND.into(),
        });
    }

    let app_owned = app.cloned();

    rt.block_on(async {
        with_pool_retry(&identity.session, || {
            let chat = chat.clone();
            let uncached_ids = uncached_ids.clone();
            let t_dir = t_dir.clone();
            let chat_safe = chat_safe.clone();
            let mut thumbs = thumbs.clone();
            let ids = ids.clone();
            let app_owned = app_owned.clone();
            let session_name = identity.session.clone();
            with_client(sessions_dir, identity, true, move |client| {
            let app_ref = app_owned.clone();
            let session_name = session_name.clone();
            Box::pin(async move {
                if !crate::core::grammers_ops::session_known_authorized(&session_name)
                    && !client
                        .is_authorized()
                        .await
                        .map_err(|e| map_invocation(&e))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = match resolve_peer(client, &chat).await {
                    Ok(p) => p,
                    Err(e) => {
                        tg_log::warn(
                            BACKEND,
                            "thumbs_batch_peer_error",
                            format!("chat={chat} error={e}"),
                        );
                        return Err(e);
                    }
                };
                // Keep the requested id list so we can index results by id, not by
                // position after the stripped fast-path filters some ids out.
                let fetch_ids = uncached_ids.clone();
                let msgs = client
                    .get_messages_by_id(peer, &fetch_ids)
                    .await
                    .map_err(|e| map_invocation(&e))?;

                // Align messages to message_id. After hemat stripped filtering,
                // enumerating remaining ids with msgs.get(i) would map the wrong
                // media onto the wrong card (missing / swapped thumbs).
                let mut msg_by_id: HashMap<i32, grammers_client::message::Message> =
                    HashMap::with_capacity(fetch_ids.len());
                for msg_opt in msgs {
                    if let Some(msg) = msg_opt {
                        msg_by_id.insert(msg.id(), msg);
                    }
                }

                // Hemat: stripped = final (fast). Seimbang/Jelas: download real
                // layers so quality pills actually change the grid.
                let quality_owned = q_key.to_string();
                let hemat_only = q_key == "hemat";
                let mut need_download: Vec<i32> = Vec::new();

                for mid in fetch_ids.iter().copied() {
                    let key = mid.to_string();
                    let mut got_stripped = false;
                    if let Some(msg) = msg_by_id.get(&mid) {
                        if let Some(media) = msg.media() {
                            let sizes = media_thumbs(Some(&client), &media);
                            for s in &sizes {
                                if let Some(data) = s.to_data() {
                                    let bytes = unstrip_jpeg(&data).unwrap_or(data);
                                    if bytes.is_empty() {
                                        continue;
                                    }
                                    if let Some(url) = to_data_url(&bytes) {
                                        // Always keep stripped under hemat only using atomic .part rename
                                        let cache_file = t_dir
                                            .join(format!("{chat_safe}_{mid}_hemat.jpg"));
                                        let rand_id = now_ms();
                                        let part_file = t_dir.join(format!("{chat_safe}_{mid}_hemat.{rand_id}.part"));
                                        if std::fs::write(&part_file, &bytes).is_ok() {
                                            let _ = std::fs::rename(&part_file, &cache_file);
                                        }
                                        thumb_mem_cache().lock().insert(
                                            format!("{chat_safe}_{mid}_hemat"),
                                            url.clone(),
                                        );
                                        got_stripped = true;
                                        if hemat_only {
                                            thumbs.insert(key.clone(), Some(url.clone()));
                                            if let Some(app_handle) = app_ref.as_ref() {
                                                let _ = app_handle.emit(
                                                    "thumb_single_ready",
                                                    ThumbSinglePayload {
                                                        chat_id: chat.clone(),
                                                        message_id: mid as i64,
                                                        quality: "hemat".into(),
                                                        url,
                                                        is_placeholder: false,
                                                    },
                                                );
                                            }
                                        } else {
                                            // Placeholder paint while seimbang/jelas downloads
                                            if let Some(app_handle) = app_ref.as_ref() {
                                                let _ = app_handle.emit(
                                                    "thumb_single_ready",
                                                    ThumbSinglePayload {
                                                        chat_id: chat.clone(),
                                                        message_id: mid as i64,
                                                        quality: q_key.to_string(),
                                                        url,
                                                        is_placeholder: true,
                                                    },
                                                );
                                            }
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    if hemat_only {
                        if !got_stripped {
                            need_download.push(mid);
                        }
                    } else {
                        // seimbang/jelas always need a real download when not on disk
                        need_download.push(mid);
                    }
                }

                let mut set = tokio::task::JoinSet::new();
                let fast_sem = std::sync::Arc::new(tokio::sync::Semaphore::new(12));
                let video_sem = std::sync::Arc::new(tokio::sync::Semaphore::new(2));
                let is_flooded = session_rate::flood_remaining_secs(&session_name).unwrap_or(0) > 0;

                // Sort need_download so fast-path items (photos, image docs, static thumbs) spawn BEFORE heavy video extraction tasks
                let mut sorted_download = need_download.clone();
                sorted_download.sort_by_key(|mid| {
                    if let Some(msg) = msg_by_id.get(mid) {
                        if let Some(media) = msg.media() {
                            match media {
                                Media::Document(ref d) => {
                                    let mime = d.mime_type().unwrap_or("").to_lowercase();
                                    let name = d.name().unwrap_or("").to_lowercase();
                                    let has_video_attr = d.raw.video;
                                    let sizes = media_thumbs(Some(&client), &media);
                                    let is_v = has_video_attr
                                        || mime.starts_with("video/")
                                        || name.ends_with(".mp4")
                                        || name.ends_with(".mov")
                                        || name.ends_with(".mkv")
                                        || name.ends_with(".webm")
                                        || name.ends_with(".avi")
                                        || name.ends_with(".ts");
                                    let has_static = sizes.iter().any(|s| matches!(s, PhotoSize::Size(_) | PhotoSize::Progressive(_)));
                                    is_v && !has_static // Video without static thumb is heavy (key = 1), fast items are key = 0
                                }
                                _ => false,
                            }
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                });

                for mid in sorted_download.iter().copied() {
                    let key = mid.to_string();
                    if is_flooded {
                        tg_log::warn(
                            BACKEND,
                            "thumbs_batch_flooded",
                            format!("chat={chat} session={session_name} skipping mid={mid}"),
                        );
                        thumbs.insert(key, None);
                        continue;
                    }
                    // Disk hit for THIS quality only (never fall back to hemat blur here).
                    // Accept any non-empty cached URL — do NOT apply a character-length
                    // threshold (previously url.len() > 600) which rejected valid small
                    // thumbnails (e.g. 310-byte JPEG → ~437-char data URL).
                    let q_cache = format!("v98_{chat_safe}_{mid}_{q_key}");
                    {
                        let mut mem = thumb_mem_cache().lock();
                        if let Some(url) = mem.get(&q_cache) {
                            if url != "NOT_FOUND" && !url.is_empty() {
                                thumbs.insert(key, Some(url.clone()));
                                continue;
                            } else if url == "NOT_FOUND" {
                                mem.remove(&q_cache);
                            }
                        }
                    }
                    let nothumb_file_check = t_dir.join(format!("{q_cache}.nothumb"));
                    if nothumb_file_check.is_file() {
                        let _ = std::fs::remove_file(&nothumb_file_check);
                    }
                    let q_file = t_dir.join(format!("{q_cache}.jpg"));
                    if q_file.is_file() {
                        if let Ok(bytes) = std::fs::read(&q_file) {
                            let min_ok = 64;
                            if bytes.len() >= min_ok {
                                if let Some(url) = to_data_url(&bytes) {
                                    thumb_mem_cache().lock().insert(q_cache, url.clone());
                                    thumbs.insert(key, Some(url));
                                    continue;
                                }
                            }
                        }
                    }
                    let Some(msg) = msg_by_id.get(&mid) else {
                        tg_log::warn(
                            BACKEND,
                            "thumb_msg_not_returned",
                            format!("op=thumb_msg_not_returned requested_peer_id={chat} requested_message_id={mid} reason=MessageNotReturned"),
                        );
                        thumbs.insert(key, None);
                        continue;
                    };
                    let returned_id = msg.id();
                    if returned_id != mid {
                        tg_log::warn(
                            BACKEND,
                            "thumb_identity_mismatch",
                            format!("op=thumb_identity_mismatch requested_peer={chat} requested_message_id={mid} returned_peer={chat} returned_message_id={returned_id} reason=MessageIdentityMismatch"),
                        );
                        thumbs.insert(key, None);
                        continue;
                    }
                    let maybe_media = msg.media();
                    let has_media = maybe_media.is_some();
                    let media_kind_str = match &maybe_media {
                        Some(Media::Photo(_)) => "photo",
                        Some(Media::Document(_)) => "document",
                        Some(Media::Sticker(_)) => "sticker",
                        _ => "none",
                    };
                    tg_log::info(
                        BACKEND,
                        "thumb_message_resolved",
                        format!("op=thumb_message_resolved requested_peer_id={chat} requested_message_id={mid} returned_peer_id={chat} returned_message_id={returned_id} has_media={has_media} media_kind={media_kind_str}"),
                    );
                    let Some(media) = maybe_media else {
                        tg_log::warn(
                            BACKEND,
                            "thumb_no_media",
                            format!("op=thumb_no_media requested_peer_id={chat} requested_message_id={mid} reason=MessageHasNoMedia"),
                        );
                        thumbs.insert(key, None);
                        continue;
                    };
                    let media_cloned = media.clone();
                    let client_ref = client.clone();
                    let mid_val = mid;
                    let q_sub = quality_owned.clone();
                    let c_sub = chat_safe.clone();
                    let t_sub = t_dir.clone();

                    let is_heavy_video = match &media {
                        Media::Document(d) => {
                            let mime = d.mime_type().unwrap_or("").to_lowercase();
                            let name = d.name().unwrap_or("").to_lowercase();
                            let has_video_attr = d.raw.video;
                            let sizes = media_thumbs(Some(&client), &media);
                            let is_v = has_video_attr
                                || mime.starts_with("video/")
                                || name.ends_with(".mp4")
                                || name.ends_with(".mov")
                                || name.ends_with(".mkv")
                                || name.ends_with(".webm")
                                || name.ends_with(".avi")
                                || name.ends_with(".ts");
                            let has_static = sizes.iter().any(|s| matches!(s, PhotoSize::Size(_) | PhotoSize::Progressive(_)));
                            is_v && !has_static
                        }
                        _ => false,
                    };

                    let sem_sub = if is_heavy_video {
                        video_sem.clone()
                    } else {
                        fast_sem.clone()
                    };

                    set.spawn(async move {
                        let _permit = sem_sub.acquire_owned().await.ok();
                        let cache_file = t_sub.join(format!("{c_sub}_{mid_val}_{q_sub}.jpg"));
                        let rand_id = now_ms();
                        let part_file = t_sub.join(format!("{c_sub}_{mid_val}_{q_sub}.{rand_id}.part"));
                        match download_media_thumb(&client_ref, &media_cloned, &q_sub).await {
                            Ok(bytes) => {
                                // Accept any valid thumbnail payload (>= 64 bytes)
                                let min_ok = 64;
                                if bytes.len() < min_ok {
                                    let nothumb_file = t_sub.join(format!("{c_sub}_{mid_val}_{q_sub}.nothumb"));
                                    let _ = std::fs::write(&nothumb_file, b"none");
                                    thumb_mem_cache().lock().insert(
                                        format!("{c_sub}_{mid_val}_{q_sub}"),
                                        "NOT_FOUND".to_string(),
                                    );
                                    return (mid_val.to_string(), None);
                                }
                                if std::fs::write(&part_file, &bytes).is_ok() {
                                    let _ = std::fs::rename(&part_file, &cache_file);
                                }
                                let url = to_data_url(&bytes);
                                if let Some(ref u) = url {
                                    thumb_mem_cache().lock().insert(
                                        format!("{c_sub}_{mid_val}_{q_sub}"),
                                        u.clone(),
                                    );
                                }
                                (mid_val.to_string(), url)
                            }
                            Err(e) => {
                                let nothumb_file = t_sub.join(format!("{c_sub}_{mid_val}_{q_sub}.nothumb"));
                                let _ = std::fs::write(&nothumb_file, b"none");
                                thumb_mem_cache().lock().insert(
                                    format!("{c_sub}_{mid_val}_{q_sub}"),
                                    "NOT_FOUND".to_string(),
                                );

                                let err_str = e.to_string();
                                tg_log::info(
                                    BACKEND,
                                    "thumb_negative_cache_written",
                                    format!("chat={c_sub} mid={mid_val} quality={q_sub} reason={err_str}"),
                                );
                                (mid_val.to_string(), None)
                            }
                        }
                    });
                }

                while let Some(res) = set.join_next().await {
                    if let Ok((k, v)) = res {
                        if let (Ok(mid_i64), Some(ref url_str)) = (k.parse::<i64>(), v.as_ref()) {
                            if let Some(app_handle) = app_ref.as_ref() {
                                let _ = app_handle.emit(
                                    "thumb_single_ready",
                                    ThumbSinglePayload {
                                        chat_id: chat.clone(),
                                        message_id: mid_i64,
                                        quality: q_key.to_string(),
                                        url: (*url_str).clone(),
                                        is_placeholder: false,
                                    },
                                );
                            }
                        }
                        thumbs.insert(k, v);
                    }
                }

                tg_log::info(
                    BACKEND,
                    "thumbs_batch",
                    format!(
                        "chat={} q={} total={} download={} ok={}",
                        chat,
                        q_key,
                        ids.len(),
                        need_download.len(),
                        thumbs.values().filter(|v| v.is_some()).count()
                    ),
                );
                Ok(ThumbsBatchResult {
                    status: "success".into(),
                    thumbs,
                    backend: BACKEND.into(),
                })
            })
            })
        })
        .await
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
}
