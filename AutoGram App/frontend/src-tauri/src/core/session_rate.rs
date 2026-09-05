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

/// Stable RPC Method Classification for fine-grained FloodWait isolation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RpcClass {
    IndexSearch,
    IndexCounters,
    IndexRepair,
    ChannelSyncRecovery,
    MediaPreview,
    MediaDownload,
    WriteOperation,
    GeneralRead,
}

/// Concurrent GetFile pipelines per session. 2 allows bootstrap of a new
/// preview while the previous fill is cancelling (was 1 → open stuck "Memuat").
const MAX_MEDIA_DOWNLOADS: usize = 2;
const MAX_PREVIEW_CONCURRENCY: usize = 2;
const MAX_FAST_THUMB_CONCURRENCY: usize = 12;
const MAX_VIDEO_THUMB_CONCURRENCY: usize = 4;
const MAX_INDEX_CONCURRENCY: usize = 2;
const MAX_CHANNEL_SYNC_CONCURRENCY: usize = 2;

struct SessionRate {
    flood_until: Option<Instant>,
    class_flood_until: HashMap<RpcClass, Instant>,
    index_sem: std::sync::Arc<Semaphore>,
    channel_sync_sem: std::sync::Arc<Semaphore>,
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

        let mut class_flood_until = HashMap::new();
        let classes = [
            (RpcClass::IndexSearch, "IndexSearch"),
            (RpcClass::IndexCounters, "IndexCounters"),
            (RpcClass::IndexRepair, "IndexRepair"),
            (RpcClass::ChannelSyncRecovery, "ChannelSyncRecovery"),
            (RpcClass::MediaDownload, "MediaDownload"),
            (RpcClass::MediaPreview, "MediaPreview"),
            (RpcClass::WriteOperation, "WriteOperation"),
            (RpcClass::GeneralRead, "GeneralRead"),
        ];
        for (cls, cls_name) in classes {
            if let Ok(Some(secs)) =
                crate::core::autogram_core::transfer::load_class_rate_gate(session, cls_name)
            {
                if secs > 0 {
                    class_flood_until
                        .insert(cls, Instant::now() + Duration::from_secs(u64::from(secs)));
                }
            }
        }

        SessionRate {
            flood_until: restored_wait
                .map(|seconds| Instant::now() + Duration::from_secs(u64::from(seconds))),
            class_flood_until,
            index_sem: std::sync::Arc::new(Semaphore::new(MAX_INDEX_CONCURRENCY)),
            channel_sync_sem: std::sync::Arc::new(Semaphore::new(MAX_CHANNEL_SYNC_CONCURRENCY)),
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
/// Invariant: Never truncates Telegram-provided FloodWait durations (no 600s clamp).
pub fn note_flood_wait(session: &str, secs: u32) {
    let secs = secs.max(1);
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

/// Record a class-specific FLOOD_WAIT with persistent disk backing across restarts.
pub fn note_flood_wait_class(session: &str, class: RpcClass, secs: u32) {
    let secs = secs.max(1);
    let until = Instant::now() + Duration::from_secs(u64::from(secs));
    with_rate(session, |e| {
        let prev = e.class_flood_until.get(&class).copied();
        if prev.map(|p| p < until).unwrap_or(true) {
            e.class_flood_until.insert(class, until);
        }
    });
    let cls_name = match class {
        RpcClass::IndexSearch => "IndexSearch",
        RpcClass::IndexCounters => "IndexCounters",
        RpcClass::IndexRepair => "IndexRepair",
        RpcClass::ChannelSyncRecovery => "ChannelSyncRecovery",
        RpcClass::MediaDownload => "MediaDownload",
        RpcClass::MediaPreview => "MediaPreview",
        RpcClass::WriteOperation => "WriteOperation",
        RpcClass::GeneralRead => "GeneralRead",
    };
    let _ = crate::core::autogram_core::transfer::persist_class_rate_gate(
        session,
        cls_name,
        secs,
        "telegram_flood_wait",
    );
}

/// Parse FLOOD_WAIT or FLOOD_PREMIUM_WAIT seconds from Telegram RPC error text if present.
/// Supports full u32 wait durations without arbitrary <=3600 restriction.
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
                if n > 0 && n != 420 && n != 400 {
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
                if n > 0 && n != 420 && n != 400 {
                    return Some(n);
                }
            }
        }
    }
    // 3. Fallback: find any number except HTTP/RPC status 420 / 400
    for part in low.split(|c: char| !c.is_ascii_digit()) {
        if let Ok(n) = part.parse::<u32>() {
            if n > 0 && n != 420 && n != 400 {
                return Some(n);
            }
        }
    }
    None
}

/// If FloodWait is active, return remaining seconds without artificial truncation.
pub fn flood_remaining_secs(session: &str) -> Option<u32> {
    with_rate(session, |e| {
        let until = e.flood_until?;
        let now = Instant::now();
        if until <= now {
            e.flood_until = None;
            return None;
        }
        let remaining = (until - now).as_secs();
        Some(remaining.min(u64::from(u32::MAX)) as u32)
    })
}

/// If FloodWait is active for a specific RPC class or globally, return remaining seconds.
pub fn flood_remaining_secs_class(session: &str, class: RpcClass) -> Option<u32> {
    with_rate(session, |e| {
        let now = Instant::now();
        // Check global emergency gate first
        let global_rem = if let Some(u) = e.flood_until {
            if u > now {
                Some((u - now).as_secs())
            } else {
                e.flood_until = None;
                None
            }
        } else {
            None
        };

        // Check class-specific gate
        let class_rem = if let Some(u) = e.class_flood_until.get(&class).copied() {
            if u > now {
                Some((u - now).as_secs())
            } else {
                e.class_flood_until.remove(&class);
                None
            }
        } else {
            None
        };

        match (global_rem, class_rem) {
            (Some(g), Some(c)) => Some(g.max(c).min(u64::from(u32::MAX)) as u32),
            (Some(g), None) => Some(g.min(u64::from(u32::MAX)) as u32),
            (None, Some(c)) => Some(c.min(u64::from(u32::MAX)) as u32),
            (None, None) => None,
        }
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

/// Block (async) until class flood window ends for this session.
pub async fn wait_if_flooded_class(session: &str, class: RpcClass) -> Result<(), TgError> {
    loop {
        let wait = flood_remaining_secs_class(session, class);
        match wait {
            None | Some(0) => return Ok(()),
            Some(secs) if secs > 180 => {
                return Err(TgError::with_flood(secs, "FLOOD_WAIT"));
            }
            Some(secs) => {
                let d = Duration::from_secs(u64::from(secs));
                tokio::time::sleep(d.min(Duration::from_secs(3))).await;
            }
        }
    }
}

/// Fail-fast if still flooded globally or for a specific class.
pub fn ensure_not_flooded_class(session: &str, class: RpcClass) -> Result<(), TgError> {
    if let Some(secs) = flood_remaining_secs_class(session, class) {
        if secs > 0 {
            return Err(TgError::with_flood(secs, "FLOOD_WAIT"));
        }
    }
    Ok(())
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

/// Acquire channel sync slot (up to 2 permits per session for live PTS recovery / differences).
pub async fn acquire_channel_sync_slot(session: &str) -> Result<OwnedSemaphorePermit, TgError> {
    ensure_not_flooded_class(session, RpcClass::ChannelSyncRecovery)?;
    let sem = with_rate(session, |e| e.channel_sync_sem.clone());
    match sem.clone().try_acquire_owned() {
        Ok(p) => Ok(p),
        Err(_) => match tokio::time::timeout(Duration::from_secs(8), sem.acquire_owned()).await {
            Ok(Ok(p)) => Ok(p),
            Ok(Err(_)) => Err(TgError::new(
                TgErrorCode::Internal,
                "channel sync semaphore closed",
            )),
            Err(_) => Err(TgError::new(
                TgErrorCode::Timeout,
                "channel sync slot busy — antrean sync penuh",
            )),
        },
    }
}

/// Acquire indexing slot (up to 2 permits per session control plane).
pub async fn acquire_index_slot(session: &str) -> Result<OwnedSemaphorePermit, TgError> {
    ensure_not_flooded_class(session, RpcClass::IndexSearch)?;
    let sem = with_rate(session, |e| e.index_sem.clone());
    match sem.clone().try_acquire_owned() {
        Ok(p) => Ok(p),
        Err(_) => match tokio::time::timeout(Duration::from_secs(8), sem.acquire_owned()).await {
            Ok(Ok(p)) => Ok(p),
            Ok(Err(_)) => Err(TgError::new(
                TgErrorCode::Internal,
                "index semaphore closed",
            )),
            Err(_) => Err(TgError::new(
                TgErrorCode::Timeout,
                "index slot busy — antrean indeks penuh",
            )),
        },
    }
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
    with_rate(session, |e| {
        // Stream ids are deterministic per session+peer+message, so there is no
        // separate "older version" sharing a prefix. Prefix cancellation used to
        // treat every Saved Messages stream (`gme-*`) as the same item. Only evict
        // the oldest entries needed to keep the post-open pool at four streams.
        let other_streams: Vec<&String> = e
            .active_streams
            .iter()
            .filter(|stream_id| stream_id.as_str() != keep)
            .collect();
        let overflow = other_streams.len().saturating_sub(3);
        other_streams.into_iter().take(overflow).cloned().collect()
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
            crate::core::traffic_governor::record_flood_wait(Some(secs as u64));
            return;
        }
        if let Some(secs) = parse_flood_secs(&err.to_string()) {
            note_flood_wait(session, secs);
            crate::core::traffic_governor::record_flood_wait(Some(secs as u64));
            return;
        }
        // Fallback default for TgErrorCode::FloodWait without explicit seconds
        note_flood_wait(session, 30);
        crate::core::traffic_governor::record_flood_wait(Some(30));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streams_to_cancel_preserves_distinct_items_until_capacity() {
        let sess = "test-session-stream-capacity";
        track_stream(sess, "gscope-me-81");
        track_stream(sess, "gscope-me-185");
        track_stream(sess, "gscope-me-186");

        assert!(streams_to_cancel(sess, "gscope-me-187").is_empty());

        track_stream(sess, "gscope-me-187");
        assert_eq!(
            streams_to_cancel(sess, "gscope-me-188"),
            vec!["gscope-me-81".to_string()]
        );
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
