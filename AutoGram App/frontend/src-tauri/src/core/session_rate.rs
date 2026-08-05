//! Per-session FloodWait gate + download concurrency for Grammers.
//!
//! Telegram closes DC sockets (I/O read 0 / 10054) and returns FLOOD_WAIT when
//! many GetFile / preview streams run in parallel. This module serializes heavy
//! media downloads and freezes the session after FloodWait.

use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use super::tg_error::{TgError, TgErrorCode};

/// Concurrent GetFile pipelines per session. 2 allows bootstrap of a new
/// preview while the previous fill is cancelling (was 1 → open stuck "Memuat").
const MAX_MEDIA_DOWNLOADS: usize = 2;
const MAX_PREVIEW_CONCURRENCY: usize = 2;
const MAX_FAST_THUMB_CONCURRENCY: usize = 12;
const MAX_VIDEO_THUMB_CONCURRENCY: usize = 4;

struct SessionRate {
    flood_until: Option<Instant>,
    media_sem: std::sync::Arc<Semaphore>,
    preview_sem: std::sync::Arc<Semaphore>,
    fast_sem: std::sync::Arc<Semaphore>,
    video_sem: std::sync::Arc<Semaphore>,
    active_streams: Vec<String>,
    inflight_preview: HashMap<String, Instant>,
}

fn rates() -> &'static Mutex<HashMap<String, SessionRate>> {
    static MAP: OnceLock<Mutex<HashMap<String, SessionRate>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn with_rate<R>(session: &str, f: impl FnOnce(&mut SessionRate) -> R) -> R {
    let mut map = rates().lock();
    let e = map.entry(session.to_string()).or_insert_with(|| {
        let restored_wait = crate::core::autogram_core::transfer::load_account_rate_gate(session)
            .ok()
            .flatten();
        SessionRate {
            flood_until: restored_wait
                .map(|seconds| Instant::now() + Duration::from_secs(u64::from(seconds))),
            media_sem: std::sync::Arc::new(Semaphore::new(MAX_MEDIA_DOWNLOADS)),
            preview_sem: std::sync::Arc::new(Semaphore::new(MAX_PREVIEW_CONCURRENCY)),
            fast_sem: std::sync::Arc::new(Semaphore::new(MAX_FAST_THUMB_CONCURRENCY)),
            video_sem: std::sync::Arc::new(Semaphore::new(MAX_VIDEO_THUMB_CONCURRENCY)),
            active_streams: Vec::new(),
            inflight_preview: HashMap::new(),
        }
    });
    f(e)
}

/// Record a FLOOD_WAIT so subsequent ops sleep before touching MTProto.
pub fn note_flood_wait(session: &str, secs: u32) {
    let secs = secs.clamp(1, 600);
    let until = Instant::now() + Duration::from_secs(u64::from(secs));
    with_rate(session, |e| {
        e.flood_until = match e.flood_until {
            Some(prev) if prev > until => Some(prev),
            _ => Some(until),
        };
    });
    let _ = crate::core::autogram_core::transfer::persist_account_rate_gate(
        session,
        secs,
        "telegram_flood_wait",
    );
}

/// Parse FLOOD_WAIT or FLOOD_PREMIUM_WAIT seconds from Telegram RPC error text if present.
pub fn parse_flood_secs(err: &str) -> Option<u32> {
    let low = err.to_ascii_lowercase();
    if !low.contains("flood")
        && !low.contains("a wait of")
        && !low.contains("wait")
        && !low.contains("420")
    {
        return None;
    }
    // 1. Check for value: X or (value: X) in FLOOD_PREMIUM_WAIT
    if let Some(val_idx) = low.find("value") {
        let after = &low[val_idx..];
        for part in after.split(|c: char| !c.is_ascii_digit()) {
            if let Ok(n) = part.parse::<u32>() {
                if (1..3600).contains(&n) && n != 420 && n != 400 {
                    return Some(n);
                }
            }
        }
    }
    // 2. Check for wait of X or wait X
    if let Some(wait_idx) = low.find("wait") {
        let after = &low[wait_idx..];
        for part in after.split(|c: char| !c.is_ascii_digit()) {
            if let Ok(n) = part.parse::<u32>() {
                if (1..3600).contains(&n) && n != 420 && n != 400 {
                    return Some(n);
                }
            }
        }
    }
    // 3. Fallback: find any number except HTTP/RPC status 420 / 400
    for part in low.split(|c: char| !c.is_ascii_digit()) {
        if let Ok(n) = part.parse::<u32>() {
            if (1..3600).contains(&n) && n != 420 && n != 400 {
                return Some(n);
            }
        }
    }
    None
}

/// If FloodWait is active, return remaining seconds.
pub fn flood_remaining_secs(session: &str) -> Option<u32> {
    with_rate(session, |e| {
        let until = e.flood_until?;
        let now = Instant::now();
        if until <= now {
            e.flood_until = None;
            return None;
        }
        Some((until - now).as_secs().min(600) as u32)
    })
}

/// Block (async) until flood window ends for this session (capped wait).
pub async fn wait_if_flooded(session: &str) -> Result<(), TgError> {
    loop {
        let wait = with_rate(session, |e| {
            e.flood_until.and_then(|until| {
                let now = Instant::now();
                if until > now {
                    Some(until - now)
                } else {
                    e.flood_until = None;
                    None
                }
            })
        });
        match wait {
            None => return Ok(()),
            Some(d) if d.as_secs() > 90 => {
                return Err(TgError::with_flood(
                    d.as_secs().min(u64::from(u32::MAX)) as u32,
                    "FLOOD_WAIT",
                ));
            }
            Some(d) => {
                tokio::time::sleep(d.min(Duration::from_secs(3))).await;
            }
        }
    }
}

/// Block (async) until flood window ends if wait duration is within `max_wait`.
/// If wait exceeds `max_wait`, returns a FLOOD_WAIT error.
pub async fn wait_if_flooded_capped(session: &str, max_wait: Duration) -> Result<(), TgError> {
    loop {
        let wait = with_rate(session, |e| {
            e.flood_until.and_then(|until| {
                let now = Instant::now();
                if until > now {
                    Some(until - now)
                } else {
                    e.flood_until = None;
                    None
                }
            })
        });
        match wait {
            None => return Ok(()),
            Some(d) if d > max_wait => {
                return Err(TgError::with_flood(
                    d.as_secs().min(u64::from(u32::MAX)) as u32,
                    "FLOOD_WAIT",
                ));
            }
            Some(d) => {
                tokio::time::sleep(d.min(Duration::from_secs(2))).await;
            }
        }
    }
}

/// Fail-fast if still flooded (stops preview spam).
pub fn ensure_not_flooded(session: &str) -> Result<(), TgError> {
    if let Some(secs) = flood_remaining_secs(session) {
        if secs > 0 {
            return Err(TgError::with_flood(secs, "FLOOD_WAIT"));
        }
    }
    Ok(())
}

/// Acquire media-download slot (short bootstrap only — never hold for full file).
pub async fn acquire_media_slot(session: &str) -> Result<OwnedSemaphorePermit, TgError> {
    // Fail-fast on flood (don't sleep minutes inside preview open).
    ensure_not_flooded(session)?;
    let sem = with_rate(session, |e| e.media_sem.clone());
    match sem.clone().try_acquire_owned() {
        Ok(p) => Ok(p),
        Err(_) => match tokio::time::timeout(Duration::from_secs(6), sem.acquire_owned()).await {
            Ok(Ok(p)) => Ok(p),
            Ok(Err(_)) => Err(TgError::new(
                TgErrorCode::Internal,
                "media download semaphore closed",
            )),
            Err(_) => Err(TgError::new(
                TgErrorCode::Timeout,
                "media slot busy — batalkan preview lama dan coba lagi",
            )),
        },
    }
}

/// Try acquire without waiting (warm heads).
pub fn try_acquire_media_slot(session: &str) -> Option<OwnedSemaphorePermit> {
    if flood_remaining_secs(session).unwrap_or(0) > 0 {
        return None;
    }
    let sem = with_rate(session, |e| e.media_sem.clone());
    sem.try_acquire_owned().ok()
}

/// Acquire high-priority preview slot (2 permits, never blocked by thumbnail batches).
pub async fn acquire_preview_slot(session: &str) -> Result<OwnedSemaphorePermit, TgError> {
    ensure_not_flooded(session)?;
    let sem = with_rate(session, |e| e.preview_sem.clone());
    match sem.clone().try_acquire_owned() {
        Ok(p) => Ok(p),
        Err(_) => match tokio::time::timeout(Duration::from_secs(10), sem.acquire_owned()).await {
            Ok(Ok(p)) => Ok(p),
            Ok(Err(_)) => Err(TgError::new(
                TgErrorCode::Internal,
                "preview semaphore closed",
            )),
            Err(_) => Err(TgError::new(
                TgErrorCode::Timeout,
                "Telegram belum merespons saat mengambil file. AutoGram telah mencoba ulang. Coba lagi beberapa saat.",
            )),
        },
    }
}

/// Acquire fast thumbnail slot (12 permits for fast image/stripped thumbs).
pub fn try_acquire_fast_thumb_slot(session: &str) -> Option<OwnedSemaphorePermit> {
    if flood_remaining_secs(session).unwrap_or(0) > 0 {
        return None;
    }
    let sem = with_rate(session, |e| e.fast_sem.clone());
    sem.try_acquire_owned().ok()
}

/// Acquire video thumbnail slot (4 permits for video FFmpeg frame extraction).
pub fn try_acquire_video_thumb_slot(session: &str) -> Option<OwnedSemaphorePermit> {
    if flood_remaining_secs(session).unwrap_or(0) > 0 {
        return None;
    }
    let sem = with_rate(session, |e| e.video_sem.clone());
    sem.try_acquire_owned().ok()
}

pub fn track_stream(session: &str, stream_id: &str) {
    with_rate(session, |e| {
        e.active_streams.retain(|s| s != stream_id);
        e.active_streams.push(stream_id.to_string());
        if e.active_streams.len() > 8 {
            let drop_n = e.active_streams.len() - 8;
            e.active_streams.drain(0..drop_n);
        }
    });
}

pub fn untrack_stream(session: &str, stream_id: &str) {
    with_rate(session, |e| {
        e.active_streams.retain(|s| s != stream_id);
    });
}

pub fn streams_to_cancel(session: &str, keep: &str) -> Vec<String> {
    let msg_prefix = keep.split('-').next().unwrap_or(keep);
    with_rate(session, |e| {
        let mut to_cancel = Vec::new();
        // 1. Cancel older streams for the SAME message_id (e.g. g33-...)
        for s in &e.active_streams {
            if s != keep && s.starts_with(msg_prefix) {
                to_cancel.push(s.clone());
            }
        }
        // 2. If active streams count exceeds max capacity (4), evict oldest excess streams
        let remaining_count = e.active_streams.len() - to_cancel.len();
        if remaining_count > 4 {
            let overflow = remaining_count - 4;
            let mut evicted = 0;
            for s in &e.active_streams {
                if s != keep && !to_cancel.contains(s) {
                    to_cancel.push(s.clone());
                    evicted += 1;
                    if evicted >= overflow {
                        break;
                    }
                }
            }
        }
        to_cancel
    })
}

/// Single-flight: return false if this chat:msg is already starting.
pub fn begin_preview_flight(session: &str, chat: &str, msg: i64) -> bool {
    let key = format!("{chat}:{msg}");
    with_rate(session, |e| {
        e.inflight_preview
            .retain(|_, t| t.elapsed() < Duration::from_secs(90));
        if e.inflight_preview.contains_key(&key) {
            return false;
        }
        e.inflight_preview.insert(key, Instant::now());
        true
    })
}

pub fn end_preview_flight(session: &str, chat: &str, msg: i64) {
    let key = format!("{chat}:{msg}");
    with_rate(session, |e| {
        e.inflight_preview.remove(&key);
    });
}

pub fn note_error(session: &str, err: &TgError) {
    if err.code() == TgErrorCode::FloodWait {
        if let Some(secs) = err.flood_wait_secs() {
            note_flood_wait(session, secs);
            return;
        }
        if let Some(secs) = parse_flood_secs(&err.to_string()) {
            note_flood_wait(session, secs);
            return;
        }
        // Fallback default for TgErrorCode::FloodWait without explicit seconds
        note_flood_wait(session, 30);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streams_to_cancel_only_cancels_same_msg_or_excess() {
        let sess = "test-session-streams";
        track_stream(sess, "g33-100-1");
        track_stream(sess, "g34-100-2");

        // Opening a new stream for g34 should cancel older g34 stream, but NOT g33 stream
        let cancel = streams_to_cancel(sess, "g34-100-3");
        assert!(!cancel.contains(&"g33-100-1".to_string()));

        // Opening a new stream for g33 should cancel older g33-100-1
        track_stream(sess, "g34-100-3");
        let cancel33 = streams_to_cancel(sess, "g33-100-9");
        assert!(cancel33.contains(&"g33-100-1".to_string()));
        assert!(!cancel33.contains(&"g34-100-2".to_string()));
    }

    #[test]
    fn non_flood_errors_do_not_trigger_flood_wait() {
        let sess = format!(
            "test-session-non-flood-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );

        // 1. Timeout with 'tunggu' in Indonesian UI error message must NOT trigger FloodWait
        let err_busy = TgError::new(
            TgErrorCode::Timeout,
            "media slot busy — batalkan preview lama dan coba lagi",
        );
        note_error(&sess, &err_busy);
        assert_eq!(flood_remaining_secs(&sess), None);

        // 2. Generic network timeout with 'tunggu 5 detik' must NOT trigger FloodWait
        let err_net = TgError::new(
            TgErrorCode::Network,
            "Silakan tunggu 5 detik sebelum mencoba lagi",
        );
        note_error(&sess, &err_net);
        assert_eq!(flood_remaining_secs(&sess), None);

        // 3. Genuine TgErrorCode::FloodWait DOES trigger FloodWait
        let err_flood = TgError::with_flood(20, "FLOOD_WAIT_20");
        note_error(&sess, &err_flood);
        assert!(flood_remaining_secs(&sess).unwrap_or(0) >= 18);
    }
}
