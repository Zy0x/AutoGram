//! High-performance MTProto thumbnail batching, stripped mini-thumb data URL generation, and LRU memory/disk cache management.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use grammers_client::media::{Downloadable, Media, PhotoSize};
use grammers_client::Client;
use serde::{Deserialize, Serialize};

use super::ffmpeg::{is_fallback_black_card_bytes, unstrip_jpeg};
use super::session::{now_ms, thumb_dir, BACKEND};
use crate::core::grammers_ops::runtime;
use crate::core::telegram_ops::TelegramIdentity;
use crate::core::tg_error::TgError;

const THUMB_TARGET_MAX: usize = 96 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbSinglePayload {
    pub chat_id: String,
    pub message_id: i64,
    pub quality: String,
    pub url: String,
    pub is_placeholder: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbsBatchResult {
    pub status: String,
    pub thumbs: HashMap<String, Option<String>>,
    pub backend: String,
}

pub fn thumb_mem_cache() -> &'static Mutex<HashMap<String, String>> {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::with_capacity(10000)))
}

pub fn clear_thumb_mem_cache() {
    thumb_mem_cache().lock().unwrap().clear();
}

pub fn prune_thumb_cache(t_dir: &Path) {
    if !t_dir.is_dir() {
        return;
    }
    static LAST_PRUNE: OnceLock<Mutex<u128>> = OnceLock::new();
    let lock = LAST_PRUNE.get_or_init(|| Mutex::new(0));
    let now = now_ms();
    {
        let mut last = lock.lock().unwrap();
        if now.saturating_sub(*last) < 60_000 {
            return;
        }
        *last = now;
    }
    let t_dir_buf = t_dir.to_path_buf();
    std::thread::spawn(move || {
        let Ok(entries) = std::fs::read_dir(&t_dir_buf) else { return; };
        let mut files: Vec<(PathBuf, std::time::SystemTime, u64)> = Vec::new();

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
            if fname.ends_with(".jpg") {
                if let Ok(b) = std::fs::read(&p) {
                    if is_fallback_black_card_bytes(&b) {
                        let _ = std::fs::remove_file(&p);
                        continue;
                    }
                }
            }
            if let Ok(meta) = p.metadata() {
                let modified = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                files.push((p, modified, meta.len()));
            }
        }

        files.sort_by_key(|(_, modified, _)| *modified);
        let max_files = 500usize;
        let max_bytes = 256 * 1024 * 1024u64;
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

fn pick_thumb(sizes: &[PhotoSize], quality: &str) -> Option<PhotoSize> {
    let q = quality.to_lowercase();
    let candidates: Vec<&PhotoSize> = sizes
        .iter()
        .filter(|s| match s {
            PhotoSize::Size(sz) => sz.size > 0,
            PhotoSize::Progressive(p) => !p.sizes.is_empty(),
            _ => false,
        })
        .collect();

    if candidates.is_empty() {
        return None;
    }

    if q.contains("hemat") || q.contains("saver") {
        return candidates.first().cloned().cloned();
    }
    if q.contains("jelas") || q.contains("sharp") {
        return candidates.last().cloned().cloned();
    }
    let mid = candidates.len() / 2;
    candidates.get(mid).cloned().cloned()
}

pub fn media_thumbs(_client: Option<&Client>, media: &Media) -> Vec<PhotoSize> {
    match media {
        Media::Photo(p) => p.thumbs().to_vec(),
        Media::Document(d) => d.thumbs().to_vec(),
        Media::Sticker(s) => s.document.thumbs().to_vec(),
        _ => vec![],
    }
}

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
    _identity: &TelegramIdentity,
    chat_id: &str,
    message_ids: &[i64],
    quality: &str,
    _app: Option<&tauri::AppHandle>,
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
    let _rt = runtime()?;
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

    let mut thumbs: HashMap<String, Option<String>> = HashMap::new();
    let mut uncached_ids: Vec<i32> = Vec::new();

    for &mid in &ids {
        let key = mid.to_string();
        let cache_key = format!("{chat_safe}_{mid}_{q_key}");
        let mut found_url: Option<String> = None;
        let mut is_negative_hit = false;
        {
            let mem = thumb_mem_cache().lock().unwrap();
            if let Some(url) = mem.get(&cache_key) {
                if url == "NOT_FOUND" {
                    is_negative_hit = true;
                } else if !url.is_empty() {
                    found_url = Some(url.clone());
                }
            }
        }
        if is_negative_hit {
            thumbs.insert(key, None);
            continue;
        }

        if found_url.is_none() {
            let cache_file = t_dir.join(format!("{cache_key}.jpg"));
            if cache_file.is_file() {
                if let Ok(bytes) = std::fs::read(&cache_file) {
                    let min_disk = 64;
                    if bytes.len() >= min_disk {
                        if let Some(url) = to_data_url(&bytes) {
                            thumb_mem_cache().lock().unwrap().insert(cache_key.clone(), url.clone());
                            found_url = Some(url);
                        }
                    }
                }
            }
        }
        if let Some(url) = found_url {
            thumbs.insert(key, Some(url.clone()));
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

    Ok(ThumbsBatchResult {
        status: "success".into(),
        thumbs,
        backend: BACKEND.into(),
    })
}
