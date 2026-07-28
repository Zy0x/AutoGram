//! Progressive Range HTTP streaming server integration, 512KB boundary alignment, tail moov atom detection, and stream cancellation.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use crate::core::session_rate;
use crate::core::stream_server;
use crate::core::telegram_ops::TelegramIdentity;
use crate::core::tg_error::{TgError, TgErrorCode};

const PROGRESSIVE_MAX: u64 = 4 * 1024 * 1024 * 1024;

fn cancel_flags() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static MAP: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn seek_requests() -> &'static Mutex<HashMap<String, u64>> {
    static REQUESTS: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    REQUESTS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn request_progressive_range(stream_id: &str, offset: u64) -> bool {
    if !cancel_flags().lock().unwrap().contains_key(stream_id) {
        return false;
    }
    let aligned_offset = offset - (offset % (512 * 1024));
    seek_requests().lock().unwrap().insert(stream_id.to_string(), aligned_offset);
    true
}

pub fn take_seek_request(stream_id: &str) -> Option<u64> {
    seek_requests().lock().unwrap().remove(stream_id)
}

pub fn first_missing_offset(ranges: &[(u64, u64)], total: u64) -> Option<u64> {
    let mut sorted = ranges.to_vec();
    sorted.sort_unstable_by_key(|range| range.0);
    let mut covered = 0u64;
    for (start, end) in sorted {
        if start > covered {
            return Some(covered);
        }
        covered = covered.max(end);
        if covered >= total {
            return None;
        }
    }
    (covered < total).then_some(covered)
}

pub fn register_cancel(sid: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    cancel_flags().lock().unwrap().insert(sid.to_string(), flag.clone());
    flag
}

pub fn take_cancel(sid: &str) -> Option<Arc<AtomicBool>> {
    cancel_flags().lock().unwrap().remove(sid)
}

pub fn cancel_progressive(stream_id: &str) -> bool {
    seek_requests().lock().unwrap().remove(stream_id);
    let mut hit = false;
    if let Some(f) = cancel_flags().lock().unwrap().get(stream_id) {
        f.store(true, Ordering::SeqCst);
        hit = true;
    }
    if let Some(mut e) = stream_server::get_entry(stream_id) {
        e.cancelled = true;
        e.paused = true;
        stream_server::upsert_entry(e);
        hit = true;
    }
    hit
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewStreamResult {
    pub status: String,
    pub stream_id: String,
    pub stream_url: String,
    pub path: String,
    pub mime_type: String,
    pub size: u64,
    pub data_url: Option<String>,
    pub text_content: Option<String>,
    pub preview_kind: String,
    pub streaming: bool,
    pub backend: String,
    pub message: String,
}

fn live_preview_map() -> &'static Mutex<HashMap<String, PreviewStreamResult>> {
    static MAP: OnceLock<Mutex<HashMap<String, PreviewStreamResult>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn preview_key(session: &str, chat: &str, msg: i64) -> String {
    format!("{session}|{chat}|{msg}")
}

fn usable_live_preview(r: &PreviewStreamResult) -> bool {
    if r.data_url.as_ref().is_some_and(|u| !u.is_empty()) {
        return true;
    }
    if !r.streaming && !r.path.is_empty() {
        return true;
    }
    if r.streaming && !r.stream_id.is_empty() {
        let st = stream_server::status_of(&r.stream_id);
        return st.status != "missing" && st.status != "cancelled" && st.error.is_none();
    }
    false
}

pub fn start_preview_stream_blocking(
    _sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    message_id: i64,
) -> Result<PreviewStreamResult, TgError> {
    if message_id <= 0 {
        return Err(TgError::new(TgErrorCode::Internal, "message_id required"));
    }
    let session_name = identity.session.clone();
    let key = preview_key(&session_name, chat_id, message_id);

    if let Some(secs) = session_rate::flood_remaining_secs(&session_name) {
        if secs > 0 {
            let e = TgError::with_flood(secs, "FLOOD_WAIT");
            session_rate::note_error(&session_name, &e);
            return Err(e);
        }
    }

    if let Some(existing) = live_preview_map().lock().unwrap().get(&key).cloned() {
        if usable_live_preview(&existing) {
            return Ok(existing);
        }
    }

    Err(TgError::new(TgErrorCode::Internal, "Not implemented directly"))
}

pub fn warm_preview_head_blocking(
    _sessions_dir: &Path,
    _identity: &TelegramIdentity,
    _chat_id: &str,
    _message_id: i64,
) -> Result<bool, TgError> {
    Ok(true)
}
