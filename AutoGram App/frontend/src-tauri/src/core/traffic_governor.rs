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
    preview_active_at_ms: u64,
    dc_latency_ms: Option<u64>,
    flood_wait_until_ms: Option<u64>,
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
            preview_active_at_ms: 0,
            dc_latency_ms: None,
            flood_wait_until_ms: None,
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
    // Playback uses at most four MTProto chunk workers and shares the download
    // ceiling; it never manufactures extra sessions beyond that hard cap.
    guard.stream.configured_ceiling = download.clamp(1, 4);
}

pub fn observe_preview(runway_seconds: Option<f64>, playback_active: bool) {
    let mut guard = state().lock();
    if playback_active {
        guard.preview_active_at_ms = now_ms();
        guard.preview_runway_seconds = runway_seconds.filter(|value| value.is_finite() && *value >= 0.0);
    } else {
        guard.preview_runway_seconds = None;
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

fn governor_reason(state: &GovernorState, now: u64) -> &'static str {
    if state.flood_wait_until_ms.is_some_and(|until| until > now) {
        return "telegram_cooldown";
    }
    if now.saturating_sub(state.preview_active_at_ms) > ACTIVE_WINDOW_MS {
        return "throughput_plateau_probe";
    }
    match state.preview_runway_seconds {
        Some(runway) if runway < CRITICAL_RUNWAY_SECONDS => "preview_runway_critical",
        Some(runway) if runway < RECOVERY_RUNWAY_SECONDS => "preview_runway_recovering",
        Some(_) => "preview_runway_safe",
        None => "throughput_plateau_probe",
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
        _ => guard.stream.configured_ceiling.clamp(1, 4) as usize,
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
    TrafficSnapshot {
        upload: lane_snapshot(&guard.upload, now),
        download: lane_snapshot(&guard.download, now),
        stream: lane_snapshot(&guard.stream, now),
        preview_runway_seconds: if now.saturating_sub(guard.preview_active_at_ms) <= ACTIVE_WINDOW_MS {
            guard.preview_runway_seconds
        } else {
            None
        },
        governor_reason: governor_reason(&guard, now).to_string(),
        dc_latency_ms: guard.dc_latency_ms,
        flood_wait_seconds: guard
            .flood_wait_until_ms
            .and_then(|until| (until > now).then_some((until - now).div_ceil(1_000))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_critical_playback_yields_background_work() {
        observe_preview(Some(12.0), true);
        assert_eq!(background_pacing_ms(TransferDirection::Download), 0);
        observe_preview(Some(3.5), true);
        assert!(background_pacing_ms(TransferDirection::Upload) > 0);
        observe_preview(None, false);
        assert_eq!(background_pacing_ms(TransferDirection::Upload), 0);
    }

    #[test]
    fn configured_ceiling_is_reported_not_exceeded() {
        configure_ceiling(6, 4);
        let snapshot = snapshot();
        assert_eq!(snapshot.upload.configured_ceiling, 6);
        assert_eq!(snapshot.download.configured_ceiling, 4);
        assert_eq!(snapshot.stream.configured_ceiling, 4);
    }

    #[test]
    fn worker_leases_report_real_lifecycle() {
        let worker = acquire_worker(TransferDirection::Stream);
        assert!(snapshot().stream.active_workers >= 1);
        drop(worker);
        assert_eq!(snapshot().stream.active_workers, 0);
    }

    #[test]
    fn stream_window_prioritizes_critical_preview() {
        configure_ceiling(4, 4);
        observe_preview(Some(3.0), true);
        assert_eq!(stream_worker_limit(), 1);
        observe_preview(Some(7.0), true);
        assert_eq!(stream_worker_limit(), 2);
    }
}
