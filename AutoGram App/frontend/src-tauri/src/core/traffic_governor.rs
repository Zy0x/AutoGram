//! Shared transfer governor for upload, download, and preview traffic.
//!
//! This is intentionally a *permit/pacing adviser*, not a speed limiter.  It
//! records observed goodput and only yields background work when the active
//! preview's playable runway is critical.  Telegram/DC limits and FloodWaits
//! remain authoritative.

use parking_lot::Mutex;
use serde::Serialize;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

const ACTIVE_WINDOW_MS: u64 = 3_000;
const CRITICAL_RUNWAY_SECONDS: f64 = 4.0;
const RECOVERY_RUNWAY_SECONDS: f64 = 10.0;
const DATA_SAVER_HIGH_WATERMARK_SECONDS: f64 = 40.0;
const DATA_SAVER_LOW_WATERMARK_SECONDS: f64 = 25.0;
const MAX_STREAM_WORKERS: u32 = 6;

#[derive(Debug, Clone, Copy)]
pub enum TransferDirection {
    Upload,
    Download,
    Stream,
}

/// RAII lifecycle counter for real transfer workers.  It deliberately does
/// not grant permission to exceed a caller's configured concurrency; callers
/// acquire it only after their own queue/concurrency limit has admitted work.
pub struct WorkerLease(TransferDirection);

impl Drop for WorkerLease {
    fn drop(&mut self) {
        let mut guard = state().lock();
        let lane = lane_mut(&mut guard, self.0);
        lane.active_workers = lane.active_workers.saturating_sub(1);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficLaneSnapshot {
    pub goodput_bps: f64,
    pub active_workers: u32,
    pub configured_ceiling: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficSnapshot {
    pub upload: TrafficLaneSnapshot,
    pub download: TrafficLaneSnapshot,
    pub stream: TrafficLaneSnapshot,
    pub preview_runway_seconds: Option<f64>,
    pub governor_reason: String,
    pub dc_latency_ms: Option<u64>,
    pub flood_wait_seconds: Option<u64>,
    pub preview_observation: Option<String>,
    pub data_saver_enabled: bool,
    pub buffer_saturated: bool,
}

#[derive(Debug, Clone)]
struct Lane {
    goodput_bps: f64,
    last_bytes_at_ms: u64,
    last_active_at_ms: u64,
    configured_ceiling: u32,
    active_workers: u32,
}

impl Default for Lane {
    fn default() -> Self {
        Self {
            goodput_bps: 0.0,
            last_bytes_at_ms: 0,
            last_active_at_ms: 0,
            configured_ceiling: 0,
            active_workers: 0,
        }
    }
}

#[derive(Debug, Clone)]
struct GovernorState {
    upload: Lane,
    download: Lane,
    stream: Lane,
    preview_runway_seconds: Option<f64>,
    preview_observation: Option<String>,
    preview_active_at_ms: u64,
    dc_latency_ms: Option<u64>,
    flood_wait_until_ms: Option<u64>,
    data_saver_enabled: bool,
}

impl Default for GovernorState {
    fn default() -> Self {
        let mut upload = Lane::default();
        let mut download = Lane::default();
        let mut stream = Lane::default();
        // Mirror the product's default Transfer Settings before the settings
        // workspace has mounted and sent its first configured ceiling.
        upload.configured_ceiling = 4;
        download.configured_ceiling = 4;
        stream.configured_ceiling = 4;
        Self {
            upload,
            download,
            stream,
            preview_runway_seconds: None,
            preview_observation: None,
            preview_active_at_ms: 0,
            dc_latency_ms: None,
            flood_wait_until_ms: None,
            data_saver_enabled: true,
        }
    }
}

static GOVERNOR: OnceLock<Mutex<GovernorState>> = OnceLock::new();

fn state() -> &'static Mutex<GovernorState> {
    GOVERNOR.get_or_init(|| Mutex::new(GovernorState::default()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn lane_mut(state: &mut GovernorState, direction: TransferDirection) -> &mut Lane {
    match direction {
        TransferDirection::Upload => &mut state.upload,
        TransferDirection::Download => &mut state.download,
        TransferDirection::Stream => &mut state.stream,
    }
}

/// Observe actual bytes only after they have been read or written successfully.
pub fn record_bytes(direction: TransferDirection, bytes: u64) {
    if bytes == 0 {
        return;
    }
    let now = now_ms();
    let mut guard = state().lock();
    let lane = lane_mut(&mut guard, direction);
    if lane.last_bytes_at_ms > 0 && now > lane.last_bytes_at_ms {
        let instant = bytes as f64 * 1000.0 / (now - lane.last_bytes_at_ms) as f64;
        lane.goodput_bps = if lane.goodput_bps > 0.0 {
            lane.goodput_bps * 0.72 + instant * 0.28
        } else {
            instant
        };
    }
    lane.last_bytes_at_ms = now;
    lane.last_active_at_ms = now;
}

pub fn acquire_worker(direction: TransferDirection) -> WorkerLease {
    let mut guard = state().lock();
    let lane = lane_mut(&mut guard, direction);
    lane.active_workers = lane.active_workers.saturating_add(1);
    WorkerLease(direction)
}

pub fn configure_ceiling(upload: u32, download: u32) {
    let mut guard = state().lock();
    guard.upload.configured_ceiling = upload.max(1);
    guard.download.configured_ceiling = download.max(1);
    // Playback may use up to six MTProto chunk workers when the user has
    // opted into a higher download ceiling. The byte-distance Data Saver cap
    // remains authoritative, so extra workers improve recovery/goodput but do
    // not turn a short preview into a full background download.
    guard.stream.configured_ceiling = download.clamp(1, MAX_STREAM_WORKERS);
}

pub fn observe_preview(runway_seconds: Option<f64>, playback_active: bool) {
    let mut guard = state().lock();
    guard.preview_active_at_ms = now_ms();
    if let Some(runway) = runway_seconds.filter(|value| value.is_finite() && *value >= 0.0) {
        guard.preview_runway_seconds = Some(runway);
        guard.preview_observation = Some(if playback_active {
            "measured".to_string()
        } else {
            "idle".to_string()
        });
    } else {
        guard.preview_runway_seconds = None;
        guard.preview_observation = Some(if playback_active {
            "waiting_metadata".to_string()
        } else {
            "idle".to_string()
        });
    }
}

pub fn record_dc_latency(latency_ms: Option<u64>) {
    state().lock().dc_latency_ms = latency_ms;
}

pub fn record_flood_wait(wait_seconds: Option<u64>) {
    let mut guard = state().lock();
    guard.flood_wait_until_ms = wait_seconds
        .filter(|value| *value > 0)
        .map(|value| now_ms().saturating_add(value.saturating_mul(1_000)));
}

pub fn set_data_saver(enabled: bool) {
    let mut guard = state().lock();
    guard.data_saver_enabled = enabled;
}

pub fn is_data_saver_enabled() -> bool {
    state().lock().data_saver_enabled
}

/// Returns pacing delay in ms if Data Saver mode is enabled and the preview
/// player already holds a generous buffer runway (>= 40.0s) ahead of current playback,
/// or when paused/idle with comfortable buffer (>= 25.0s).
pub fn stream_buffer_pacing_ms() -> Option<u64> {
    let guard = state().lock();
    if !guard.data_saver_enabled {
        return None;
    }
    let now = now_ms();
    let preview_alive = now.saturating_sub(guard.preview_active_at_ms) <= 15_000;
    if !preview_alive {
        return None;
    }
    let is_measured_and_full = guard.preview_observation.as_deref() == Some("measured")
        && guard.preview_runway_seconds.is_some_and(|r| r >= DATA_SAVER_HIGH_WATERMARK_SECONDS);
    let is_idle_and_buffered = guard.preview_observation.as_deref() == Some("idle")
        && guard.preview_runway_seconds.is_some_and(|r| r >= DATA_SAVER_LOW_WATERMARK_SECONDS);

    if is_measured_and_full || is_idle_and_buffered {
        return Some(350);
    }
    None
}

fn governor_reason(state: &GovernorState, now: u64) -> &'static str {
    if state.flood_wait_until_ms.is_some_and(|until| until > now) {
        return "telegram_cooldown";
    }
    if now.saturating_sub(state.preview_active_at_ms) > 15_000 {
        return "throughput_plateau_probe";
    }
    let is_saturated = state.data_saver_enabled
        && ((state.preview_observation.as_deref() == Some("measured")
            && state.preview_runway_seconds.is_some_and(|runway| runway >= DATA_SAVER_HIGH_WATERMARK_SECONDS))
            || (state.preview_observation.as_deref() == Some("idle")
                && state.preview_runway_seconds.is_some_and(|runway| runway >= DATA_SAVER_LOW_WATERMARK_SECONDS)));
    if is_saturated {
        return "preview_data_saver_saturated";
    }
    match state.preview_runway_seconds {
        Some(runway) if runway < CRITICAL_RUNWAY_SECONDS => "preview_runway_critical",
        Some(runway) if runway < RECOVERY_RUNWAY_SECONDS => "preview_runway_recovering",
        Some(_) => {
            if state.preview_observation.as_deref() == Some("idle") {
                "preview_idle_buffered"
            } else {
                "preview_runway_safe"
            }
        }
        None => {
            if state.preview_observation.as_deref() == Some("waiting_metadata") {
                "preview_waiting_metadata"
            } else {
                "throughput_plateau_probe"
            }
        }
    }
}

/// Delay background chunks only while an actual playing preview is at risk.
/// The maximum is deliberately tiny; it is removed as soon as runway recovers.
pub fn background_pacing_ms(_direction: TransferDirection) -> u64 {
    let guard = state().lock();
    match governor_reason(&guard, now_ms()) {
        "preview_runway_critical" => 3,
        "preview_runway_recovering" => 1,
        "telegram_cooldown" => 0,
        _ => 0,
    }
}

/// Adaptive streaming window. It starts/runs fast when healthy, preserves a
/// critical preview with one demand worker, and ramps back without a static cap.
pub fn stream_worker_limit() -> usize {
    let guard = state().lock();
    match governor_reason(&guard, now_ms()) {
        "preview_runway_critical" => 1,
        "preview_runway_recovering" => 2,
        "telegram_cooldown" => 1,
        _ => guard.stream.configured_ceiling.clamp(1, MAX_STREAM_WORKERS) as usize,
    }
}

fn lane_snapshot(lane: &Lane, now: u64) -> TrafficLaneSnapshot {
    TrafficLaneSnapshot {
        goodput_bps: if now.saturating_sub(lane.last_active_at_ms) <= ACTIVE_WINDOW_MS {
            lane.goodput_bps
        } else {
            0.0
        },
        active_workers: lane.active_workers,
        configured_ceiling: lane.configured_ceiling,
    }
}

pub fn snapshot() -> TrafficSnapshot {
    let guard = state().lock();
    let now = now_ms();
    let preview_alive = now.saturating_sub(guard.preview_active_at_ms) <= 15_000;
    let buffer_saturated = preview_alive
        && guard.data_saver_enabled
        && ((guard.preview_observation.as_deref() == Some("measured")
            && guard.preview_runway_seconds.is_some_and(|r| r >= DATA_SAVER_HIGH_WATERMARK_SECONDS))
            || (guard.preview_observation.as_deref() == Some("idle")
                && guard.preview_runway_seconds.is_some_and(|r| r >= DATA_SAVER_LOW_WATERMARK_SECONDS)));
    TrafficSnapshot {
        upload: lane_snapshot(&guard.upload, now),
        download: lane_snapshot(&guard.download, now),
        stream: lane_snapshot(&guard.stream, now),
        preview_runway_seconds: if preview_alive {
            guard.preview_runway_seconds
        } else {
            None
        },
        governor_reason: governor_reason(&guard, now).to_string(),
        dc_latency_ms: guard.dc_latency_ms,
        flood_wait_seconds: guard
            .flood_wait_until_ms
            .and_then(|until| (until > now).then_some((until - now).div_ceil(1_000))),
        preview_observation: if preview_alive {
            guard.preview_observation.clone()
        } else {
            None
        },
        data_saver_enabled: guard.data_saver_enabled,
        buffer_saturated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static TEST_MUTEX: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

    fn reset_state() {
        let mut guard = state().lock();
        *guard = GovernorState::default();
    }

    #[test]
    fn only_critical_playback_yields_background_work() {
        let _lock = TEST_MUTEX.lock();
        reset_state();
        observe_preview(Some(12.0), true);
        assert_eq!(background_pacing_ms(TransferDirection::Download), 0);
        observe_preview(Some(3.5), true);
        assert!(background_pacing_ms(TransferDirection::Upload) > 0);
        observe_preview(None, false);
        assert_eq!(background_pacing_ms(TransferDirection::Upload), 0);
    }

    #[test]
    fn configured_ceiling_is_reported_not_exceeded() {
        let _lock = TEST_MUTEX.lock();
        reset_state();
        configure_ceiling(6, 6);
        let snapshot = snapshot();
        assert_eq!(snapshot.upload.configured_ceiling, 6);
        assert_eq!(snapshot.download.configured_ceiling, 6);
        assert_eq!(snapshot.stream.configured_ceiling, 6);
    }

    #[test]
    fn worker_leases_report_real_lifecycle() {
        let _lock = TEST_MUTEX.lock();
        reset_state();
        let worker = acquire_worker(TransferDirection::Stream);
        assert!(snapshot().stream.active_workers >= 1);
        drop(worker);
        assert_eq!(snapshot().stream.active_workers, 0);
    }

    #[test]
    fn stream_window_prioritizes_critical_preview() {
        let _lock = TEST_MUTEX.lock();
        reset_state();
        configure_ceiling(4, 4);
        observe_preview(Some(3.0), true);
        assert_eq!(stream_worker_limit(), 1);
        observe_preview(Some(7.0), true);
        assert_eq!(stream_worker_limit(), 2);
    }

    #[test]
    fn data_saver_paces_saturated_preview() {
        let _lock = TEST_MUTEX.lock();
        reset_state();
        set_data_saver(true);
        observe_preview(Some(45.0), true);
        assert_eq!(stream_buffer_pacing_ms(), Some(350));
        let snap = snapshot();
        assert!(snap.buffer_saturated);
        assert_eq!(snap.governor_reason, "preview_data_saver_saturated");

        // When paused (idle) but with comfortable buffer, it still paces
        observe_preview(Some(30.0), false);
        assert_eq!(stream_buffer_pacing_ms(), Some(350));
        assert!(snapshot().buffer_saturated);

        // When runway drops, pacing clears
        observe_preview(Some(15.0), true);
        assert_eq!(stream_buffer_pacing_ms(), None);
        assert!(!snapshot().buffer_saturated);

        // When data saver is disabled, pacing never triggers
        set_data_saver(false);
        observe_preview(Some(50.0), true);
        assert_eq!(stream_buffer_pacing_ms(), None);
    }
}
