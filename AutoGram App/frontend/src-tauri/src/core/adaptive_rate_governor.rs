//! adaptive_rate_governor.rs — Rust-Only Adaptive Rate Governor for P4.4
//!
//! Long-Haul Maximum-Speed Controller:
//! - Multi-window rolling throughput tracking (short 5-10s, medium 15-30s, long 60-120s)
//! - Continuous throughput decay detection & bi-directional inflight (1 ⇄ 2) adaptation
//! - Fair DegradeProbe comparison (inflight 2 -> 1) with anti-oscillation dwell time
//! - Rolling & ratio-aware DbBound protection (ack_p95 / rpc_p95 > 2.0 & consecutive elevated ACKs)
//! - Telemetry-linked ResourceBound protection (pending items buffer containment)
//! - Zero FloodWait degradation guarantee

use std::collections::VecDeque;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::core::tg_error::{TgError, TgErrorCode};

const LATENCY_BACKOFF_COOLDOWN: Duration = Duration::from_secs(2);
const LATENCY_BACKOFF_STEP: Duration = Duration::from_millis(25);
const LATENCY_ONLY_SPACING_CAP: Duration = Duration::from_millis(250);
const LATENCY_RECOVERY_STEP: Duration = Duration::from_millis(25);
const SEVERE_RATE_DECAY_PERCENT: f64 = 45.0;

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GovernorState {
    Warmup,
    Stable,
    ProbeInflight2,
    DegradeProbe,
    Cooldown,
    FloodRecovery,
    DbBound,
    ResourceBound,
}

impl GovernorState {
    pub fn as_str(&self) -> &'static str {
        match self {
            GovernorState::Warmup => "warmup",
            GovernorState::Stable => "stable",
            GovernorState::ProbeInflight2 => "probe_inflight_2",
            GovernorState::DegradeProbe => "degrade_probe",
            GovernorState::Cooldown => "cooldown",
            GovernorState::FloodRecovery => "flood_recovery",
            GovernorState::DbBound => "db_bound",
            GovernorState::ResourceBound => "resource_bound",
        }
    }
}

/// Bounded rolling sample window for O(1) p50/p95 percentile calculations
/// without unbounded memory allocation.
#[derive(Debug, Clone)]
pub struct RollingSampleWindow<T, const N: usize> {
    samples: VecDeque<T>,
}

impl<T: Copy + Ord, const N: usize> RollingSampleWindow<T, N> {
    pub fn new() -> Self {
        Self {
            samples: VecDeque::with_capacity(N),
        }
    }

    pub fn push(&mut self, val: T) {
        if self.samples.len() >= N {
            self.samples.pop_front();
        }
        self.samples.push_back(val);
    }

    pub fn len(&self) -> usize {
        self.samples.len()
    }

    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }

    pub fn p50(&self) -> Option<T> {
        if self.samples.is_empty() {
            return None;
        }
        let mut sorted: Vec<T> = self.samples.iter().copied().collect();
        sorted.sort_unstable();
        let idx = sorted.len() / 2;
        Some(sorted[idx])
    }

    pub fn p95(&self) -> Option<T> {
        if self.samples.is_empty() {
            return None;
        }
        let mut sorted: Vec<T> = self.samples.iter().copied().collect();
        sorted.sort_unstable();
        let idx = ((sorted.len() as f64 * 0.95) as usize).min(sorted.len() - 1);
        Some(sorted[idx])
    }
}

#[derive(Debug, Clone)]
struct CommittedProgressSample {
    timestamp: Instant,
    total_committed: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ThroughputWindow {
    pub rate: f64,
    pub duration_secs: f64,
    pub committed_delta: u64,
    pub sample_count: usize,
}

#[derive(Debug, Clone)]
pub struct SustainedWindow {
    pub started_at: Instant,
    pub committed_start: u64,
    pub rpc_start: u64,
    pub flood_start: u64,
    pub committed_rate: f64,
    pub rpc_p95_ms: u64,
    pub ack_p95_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRateProfile {
    pub sustainable_dispatch_rate_rps: f64,
    pub sustainable_pacing_ms: u32,
    pub max_safe_inflight: usize,
    pub confidence_score: f64,
    pub last_flood_at_ms: u64,
    pub last_flood_wait_secs: u32,
    pub flood_free_window_secs: u64,
}

#[derive(Debug, Clone)]
pub struct RpcObservation {
    pub latency_ms: u64,
    pub rows_yielded: usize,
    pub was_error: bool,
}

pub struct AdaptiveRateGovernor {
    state: GovernorState,
    min_dispatch_spacing: Duration,
    max_inflight: usize,

    baseline_rpc_p50_ms: f64,
    baseline_rpc_p95_ms: f64,
    rpc_ewma_ms: f64,

    ack_ewma_ms: f64,
    ack_p95_ms: f64,
    idle_ewma_ms: f64,

    rpc_samples: RollingSampleWindow<u64, 128>,
    ack_samples: RollingSampleWindow<u64, 128>,
    idle_samples: RollingSampleWindow<u64, 128>,

    committed_samples: VecDeque<CommittedProgressSample>,
    total_committed_rows: u64,
    committed_rows_per_sec: f64,
    useful_rows_per_rpc: f64,

    // Long-haul sustained throughput metrics
    best_safe_committed_rate: f64,
    current_sustained_rate: f64,
    rate_decay_percent: f64,
    last_promotion_at: Option<Instant>,
    last_demotion_at: Option<Instant>,

    // Probe 1 -> 2 promotion tracking
    pending_probe: bool,
    baseline_rolling_committed_rate: f64,
    probe_start_instant: Option<Instant>,
    probe_start_committed_rows: u64,
    probe_successes: u64,

    // DegradeProbe 2 -> 1 demotion tracking
    pending_degrade_probe: bool,
    sustained_rate_before_degrade: f64,
    degrade_start_instant: Option<Instant>,
    degrade_start_committed_rows: u64,
    degrade_successes: u64,

    // DbBound & ResourceBound rolling state
    consecutive_high_acks: usize,
    consecutive_low_acks: usize,
    last_resource_observation_at: Option<Instant>,

    stable_successes: u64,
    total_search_rpcs: u64,
    last_latency_backoff_at: Option<Instant>,

    flood_count: u64,
    last_flood_wait_secs: u32,
    last_flood_at_ms: Option<u64>,
    flood_recovery_until: Option<Instant>,

    confidence_score: f64,
    state_entered_at: Instant,
}

impl AdaptiveRateGovernor {
    pub fn new() -> Self {
        Self {
            state: GovernorState::Stable,
            min_dispatch_spacing: Duration::from_millis(0),
            max_inflight: 2,

            baseline_rpc_p50_ms: 50.0,
            baseline_rpc_p95_ms: 100.0,
            rpc_ewma_ms: 50.0,

            ack_ewma_ms: 0.0,
            ack_p95_ms: 0.0,
            idle_ewma_ms: 0.0,

            rpc_samples: RollingSampleWindow::new(),
            ack_samples: RollingSampleWindow::new(),
            idle_samples: RollingSampleWindow::new(),

            committed_samples: VecDeque::with_capacity(128),
            total_committed_rows: 0,
            committed_rows_per_sec: 0.0,
            useful_rows_per_rpc: 0.0,

            best_safe_committed_rate: 0.0,
            current_sustained_rate: 0.0,
            rate_decay_percent: 0.0,
            last_promotion_at: None,
            last_demotion_at: None,

            pending_probe: false,
            baseline_rolling_committed_rate: 0.0,
            probe_start_instant: None,
            probe_start_committed_rows: 0,
            probe_successes: 0,

            pending_degrade_probe: false,
            sustained_rate_before_degrade: 0.0,
            degrade_start_instant: None,
            degrade_start_committed_rows: 0,
            degrade_successes: 0,

            consecutive_high_acks: 0,
            consecutive_low_acks: 0,
            last_resource_observation_at: None,

            stable_successes: 0,
            total_search_rpcs: 0,
            last_latency_backoff_at: None,

            flood_count: 0,
            last_flood_wait_secs: 0,
            last_flood_at_ms: None,
            flood_recovery_until: None,

            confidence_score: 0.1,
            state_entered_at: Instant::now(),
        }
    }

    /// Fast cancellation check and clean page epoch preparation.
    /// If probe eligibility or degrade probe was flagged,
    /// the transition activates strictly here at the page boundary.
    pub fn before_index_rpc(&mut self, cancel: &CancellationToken) -> Result<(), TgError> {
        if cancel.is_cancelled() {
            return Err(TgError::new(TgErrorCode::Cancelled, "indexing cancelled"));
        }

        // 1. Clean page epoch transition: activate pending probe (1 -> 2) strictly at page start
        if self.pending_probe && self.state == GovernorState::Stable && self.max_inflight == 1 {
            if let Some(baseline_win) = self.get_mature_baseline_window(12.0) {
                self.pending_probe = false;
                self.baseline_rolling_committed_rate = baseline_win.rate;
                self.probe_start_instant = Some(Instant::now());
                self.probe_start_committed_rows = self.total_committed_rows;
                self.transition_to(GovernorState::ProbeInflight2);
                self.max_inflight = 2;
                self.probe_successes = 0;

                // Initial conservative stagger based on baseline p50 latency to prevent simultaneous burst
                let conservative_stagger_ms =
                    ((self.baseline_rpc_p50_ms / 4.0) as u32).clamp(25, 100);
                self.min_dispatch_spacing = self
                    .min_dispatch_spacing
                    .max(Duration::from_millis(u64::from(conservative_stagger_ms)));
            } else {
                self.pending_probe = false;
            }
        }

        // 2. Clean page epoch transition: activate pending degrade probe (2 -> 1) strictly at page start
        if self.pending_degrade_probe
            && self.state == GovernorState::Stable
            && self.max_inflight == 2
        {
            self.pending_degrade_probe = false;
            self.sustained_rate_before_degrade = self.current_sustained_rate;
            self.degrade_start_instant = Some(Instant::now());
            self.degrade_start_committed_rows = self.total_committed_rows;
            self.transition_to(GovernorState::DegradeProbe);
            self.max_inflight = 1;
            self.degrade_successes = 0;
        }

        Ok(())
    }

    /// Feeds pure MTProto RPC invocation measurement (excluding dispatch pacing / semaphore queue time).
    pub fn on_rpc_observation(&mut self, obs: RpcObservation) {
        self.total_search_rpcs += 1;
        self.rpc_samples.push(obs.latency_ms);

        let latency_f = obs.latency_ms as f64;
        if self.rpc_ewma_ms <= 0.0 {
            self.rpc_ewma_ms = latency_f;
        } else {
            self.rpc_ewma_ms = (self.rpc_ewma_ms * 0.85) + (latency_f * 0.15);
        }

        if self.useful_rows_per_rpc <= 0.0 {
            self.useful_rows_per_rpc = obs.rows_yielded as f64;
        } else {
            self.useful_rows_per_rpc =
                (self.useful_rows_per_rpc * 0.9) + (obs.rows_yielded as f64 * 0.1);
        }

        if obs.was_error {
            // Degraded error response: increase spacing slightly
            self.min_dispatch_spacing = self
                .min_dispatch_spacing
                .saturating_add(Duration::from_millis(50));
            if self.state == GovernorState::ProbeInflight2 {
                self.transition_to(GovernorState::Cooldown);
                self.max_inflight = 1;
                self.last_demotion_at = Some(Instant::now());
            }
            return;
        }

        match self.state {
            GovernorState::Warmup => {
                if self.rpc_samples.len() >= 5 {
                    self.baseline_rpc_p50_ms = self.rpc_samples.p50().unwrap_or(100) as f64;
                    self.baseline_rpc_p95_ms = self.rpc_samples.p95().unwrap_or(200) as f64;
                    self.transition_to(GovernorState::Stable);
                    self.confidence_score = 0.5;
                }
            }
            GovernorState::Stable => {
                self.stable_successes += 1;
                self.confidence_score = (self.confidence_score + 0.01).min(0.95);
                let cur_p95 = self.rpc_samples.p95().unwrap_or(200) as f64;
                let latency_is_elevated =
                    self.baseline_rpc_p95_ms > 0.0 && cur_p95 > self.baseline_rpc_p95_ms * 1.8;
                let severe_flood_free_decay = self.last_flood_at_ms.is_none()
                    && self.rate_decay_percent >= SEVERE_RATE_DECAY_PERCENT;

                // A rolling p95 can stay elevated for dozens of otherwise-successful pages.
                // Never add latency pacing on every success: that feedback loop previously
                // snowballed spacing past 1.8s with zero FloodWait and collapsed throughput.
                if severe_flood_free_decay {
                    self.min_dispatch_spacing =
                        self.min_dispatch_spacing.min(LATENCY_ONLY_SPACING_CAP);
                    if self.min_dispatch_spacing > Duration::ZERO && self.stable_successes % 5 == 0
                    {
                        self.min_dispatch_spacing = self
                            .min_dispatch_spacing
                            .saturating_sub(LATENCY_RECOVERY_STEP);
                    }
                } else if latency_is_elevated {
                    let cooldown_elapsed = self
                        .last_latency_backoff_at
                        .map(|last| last.elapsed() >= LATENCY_BACKOFF_COOLDOWN)
                        .unwrap_or(true);
                    if cooldown_elapsed && self.min_dispatch_spacing < LATENCY_ONLY_SPACING_CAP {
                        self.min_dispatch_spacing = self
                            .min_dispatch_spacing
                            .saturating_add(LATENCY_BACKOFF_STEP)
                            .min(LATENCY_ONLY_SPACING_CAP);
                        self.last_latency_backoff_at = Some(Instant::now());
                    }
                } else if self.min_dispatch_spacing > Duration::ZERO
                    && self.stable_successes % 5 == 0
                {
                    // Relieve latency-only pacing promptly after the rolling window recovers.
                    self.min_dispatch_spacing = self
                        .min_dispatch_spacing
                        .saturating_sub(LATENCY_RECOVERY_STEP);
                }

                // Check probe eligibility (1 -> 2 promotion)
                if self.max_inflight == 1
                    && self.stable_successes >= 20
                    && self.confidence_score >= 0.6
                    && !severe_flood_free_decay
                {
                    let can_probe = self
                        .last_demotion_at
                        .map(|t| t.elapsed() >= Duration::from_secs(20))
                        .unwrap_or(true);

                    if can_probe && self.get_mature_baseline_window(12.0).is_some() {
                        self.pending_probe = true;
                    }
                }

                // Check long-haul throughput decay (2 -> 1 demotion trigger)
                if self.max_inflight == 2
                    && self.state_entered_at.elapsed() >= Duration::from_secs(15)
                {
                    let can_degrade_probe = self
                        .last_promotion_at
                        .map(|t| t.elapsed() >= Duration::from_secs(20))
                        .unwrap_or(true);

                    if can_degrade_probe
                        && self.rate_decay_percent > 18.0
                        && self.useful_rows_per_rpc >= 10.0
                    {
                        self.pending_degrade_probe = true;
                    }
                }
            }
            GovernorState::ProbeInflight2 => {
                self.probe_successes += 1;
                let cur_p95 = self.rpc_samples.p95().unwrap_or(200) as f64;

                // 1. Latency spike check: if pure RPC p95 spikes > 2.2x baseline, roll back
                if self.baseline_rpc_p95_ms > 0.0 && cur_p95 > self.baseline_rpc_p95_ms * 2.2 {
                    self.transition_to(GovernorState::Cooldown);
                    self.max_inflight = 1;
                    self.last_demotion_at = Some(Instant::now());
                    self.confidence_score = (self.confidence_score * 0.8).max(0.2);
                } else if self.probe_successes >= 20 {
                    // 2. Fair Throughput comparison: evaluate committed rows/sec during probe window vs stable rolling baseline
                    let probe_duration = self
                        .probe_start_instant
                        .map(|i| i.elapsed().as_secs_f64())
                        .unwrap_or(0.0);
                    let probe_delta_rows = self
                        .total_committed_rows
                        .saturating_sub(self.probe_start_committed_rows);

                    // Require at least 4.0s of probe duration and non-zero committed progress to evaluate
                    if probe_duration >= 4.0 && probe_delta_rows > 0 {
                        let probe_committed_rate = probe_delta_rows as f64 / probe_duration;

                        let is_rate_improved = self.baseline_rolling_committed_rate > 0.0
                            && probe_committed_rate
                                >= (self.baseline_rolling_committed_rate * 1.08);

                        if is_rate_improved {
                            // Confirmed real throughput gain under inflight=2 against mature rolling baseline!
                            self.confidence_score = (self.confidence_score + 0.15).min(0.95);
                            self.max_inflight = 2;
                            self.last_promotion_at = Some(Instant::now());
                            self.transition_to(GovernorState::Stable);

                            // Gradually relieve conservative probe stagger if stable
                            if self.min_dispatch_spacing > Duration::from_millis(0) {
                                self.min_dispatch_spacing = self
                                    .min_dispatch_spacing
                                    .saturating_sub(Duration::from_millis(15));
                            }
                        } else {
                            // No improvement: rollback to inflight=1 to avoid unneeded pressure
                            self.transition_to(GovernorState::Cooldown);
                            self.max_inflight = 1;
                            self.last_demotion_at = Some(Instant::now());
                            self.confidence_score = (self.confidence_score * 0.85).max(0.3);
                        }
                    } else if probe_duration >= 15.0 {
                        // Timeout without enough progress in probe window: rollback to inflight=1
                        self.transition_to(GovernorState::Cooldown);
                        self.max_inflight = 1;
                        self.last_demotion_at = Some(Instant::now());
                    }
                }
            }
            GovernorState::DegradeProbe => {
                self.degrade_successes += 1;
                let degrade_duration = self
                    .degrade_start_instant
                    .map(|i| i.elapsed().as_secs_f64())
                    .unwrap_or(0.0);
                let degrade_delta_rows = self
                    .total_committed_rows
                    .saturating_sub(self.degrade_start_committed_rows);

                if self.degrade_successes >= 15 && degrade_duration >= 5.0 && degrade_delta_rows > 0
                {
                    let degrade_committed_rate = degrade_delta_rows as f64 / degrade_duration;

                    // If inflight 1 is >= 98% of the degraded inflight 2 rate, inflight 1 is just as fast or faster!
                    if self.sustained_rate_before_degrade <= 0.0
                        || degrade_committed_rate >= (self.sustained_rate_before_degrade * 0.98)
                    {
                        // Stay at inflight 1
                        self.max_inflight = 1;
                        self.last_demotion_at = Some(Instant::now());
                        self.transition_to(GovernorState::Stable);
                    } else {
                        // Inflight 2 was actually faster; return to inflight 2
                        self.max_inflight = 2;
                        self.last_promotion_at = Some(Instant::now());
                        self.transition_to(GovernorState::Stable);
                    }
                } else if degrade_duration >= 15.0 {
                    self.max_inflight = 1;
                    self.last_demotion_at = Some(Instant::now());
                    self.transition_to(GovernorState::Stable);
                }
            }
            GovernorState::Cooldown => {
                if self.state_entered_at.elapsed() >= Duration::from_secs(15) {
                    self.transition_to(GovernorState::Stable);
                    self.stable_successes = 0;
                }
            }
            GovernorState::FloodRecovery => {
                if let Some(until) = self.flood_recovery_until {
                    if Instant::now() >= until {
                        self.transition_to(GovernorState::Stable);
                        self.stable_successes = 0;
                        self.flood_recovery_until = None;
                    }
                }
            }
            GovernorState::DbBound => {
                // Exit DbBound only after consecutive normal ACKs and recovered EWMA
                if self.consecutive_low_acks >= 3 && self.ack_ewma_ms < 200.0 {
                    self.transition_to(GovernorState::Stable);
                }
            }
            GovernorState::ResourceBound => {
                // Maintained via on_resource_observation
            }
        }
    }

    /// Feeds FloodWait signal: resets inflight to 1, extends cooldown monotonically (longest safety window wins), and backs off pacing.
    pub fn on_flood_wait(&mut self, wait_secs: u32) {
        self.flood_count += 1;
        self.last_flood_wait_secs = self.last_flood_wait_secs.max(wait_secs);
        self.last_flood_at_ms = Some(now_epoch_ms());
        self.max_inflight = 1;
        self.pending_probe = false;
        self.pending_degrade_probe = false;
        self.confidence_score = (self.confidence_score * 0.5).max(0.1);

        // Resume rate below the unsafe observed rate: add minimum 150ms pacing
        self.min_dispatch_spacing = (self.min_dispatch_spacing + Duration::from_millis(150))
            .max(Duration::from_millis(200));

        let candidate_until = Instant::now() + Duration::from_secs(u64::from(wait_secs) + 10);
        self.flood_recovery_until = Some(
            self.flood_recovery_until
                .map(|existing| existing.max(candidate_until))
                .unwrap_or(candidate_until),
        );
        self.transition_to(GovernorState::FloodRecovery);
    }

    /// Feeds IndexedDB ACK observation, maintaining rolling progress history.
    pub fn on_ack_committed(
        &mut self,
        ack_latency_ms: u64,
        total_committed: u64,
        _committed_rate_cum: f64,
    ) {
        self.total_committed_rows = total_committed;
        let now = Instant::now();

        if self.committed_samples.len() >= 128 {
            self.committed_samples.pop_front();
        }
        self.committed_samples.push_back(CommittedProgressSample {
            timestamp: now,
            total_committed,
        });

        // Prune samples older than 60s
        while let Some(front) = self.committed_samples.front() {
            if now.duration_since(front.timestamp) > Duration::from_secs(60)
                && self.committed_samples.len() > 2
            {
                self.committed_samples.pop_front();
            } else {
                break;
            }
        }

        self.committed_rows_per_sec = self.calculate_rolling_committed_rate(15.0);
        self.current_sustained_rate = self.committed_rows_per_sec;

        // Track best safe sustained rate when flood count == 0 and in Stable
        if self.flood_count == 0
            && self.state == GovernorState::Stable
            && self.current_sustained_rate > self.best_safe_committed_rate
        {
            let sample_duration = self
                .committed_samples
                .front()
                .map(|f| now.duration_since(f.timestamp).as_secs_f64())
                .unwrap_or(0.0);
            if sample_duration >= 8.0 {
                self.best_safe_committed_rate = self.current_sustained_rate;
            }
        }

        // Calculate rate decay
        if self.best_safe_committed_rate > 0.0 {
            let decay = (self.best_safe_committed_rate - self.current_sustained_rate).max(0.0);
            self.rate_decay_percent = (decay / self.best_safe_committed_rate) * 100.0;
        } else {
            self.rate_decay_percent = 0.0;
        }

        self.ack_samples.push(ack_latency_ms);
        let ack_f = ack_latency_ms as f64;
        if self.ack_ewma_ms <= 0.0 {
            self.ack_ewma_ms = ack_f;
        } else {
            self.ack_ewma_ms = (self.ack_ewma_ms * 0.8) + (ack_f * 0.2);
        }

        // Rolling & ratio-aware DbBound
        if ack_latency_ms > 250 {
            self.consecutive_high_acks += 1;
            self.consecutive_low_acks = 0;
        } else {
            self.consecutive_low_acks += 1;
            self.consecutive_high_acks = self.consecutive_high_acks.saturating_sub(1);
        }

        let has_enough_samples = self.ack_samples.len() >= 3;
        let rpc_p95_val = self.rpc_p95().max(1);
        let ack_p95_val = self.ack_p95();
        let db_ratio = ack_p95_val as f64 / rpc_p95_val as f64;

        let should_enter_db_bound = has_enough_samples
            && ((self.consecutive_high_acks >= 3)
                || (self.rpc_samples.len() >= 3
                    && ack_p95_val > 250
                    && db_ratio > 2.0
                    && self.ack_ewma_ms > 200.0));

        if should_enter_db_bound
            && self.state != GovernorState::FloodRecovery
            && self.state != GovernorState::DbBound
        {
            self.transition_to(GovernorState::DbBound);
            self.max_inflight = 1;
            self.pending_probe = false;
        } else if self.state == GovernorState::DbBound
            && self.consecutive_low_acks >= 3
            && self.ack_ewma_ms < 200.0
        {
            self.transition_to(GovernorState::Stable);
        }
    }

    /// Feeds authoritative measured gap between ACK completion and first subsequent Telegram network dispatch.
    pub fn on_ack_to_dispatch_gap(&mut self, gap_ms: u64) {
        self.idle_samples.push(gap_ms);
        let idle_f = gap_ms as f64;
        if self.idle_ewma_ms <= 0.0 {
            self.idle_ewma_ms = idle_f;
        } else {
            self.idle_ewma_ms = (self.idle_ewma_ms * 0.8) + (idle_f * 0.2);
        }
    }

    /// Feeds resource observation (pending items buffer & persistence batch rows) to contain RAM/IPC pressure.
    pub fn on_resource_observation(
        &mut self,
        pending_pv: usize,
        pending_doc: usize,
        persistence_batch_rows: usize,
    ) {
        self.last_resource_observation_at = Some(Instant::now());
        let total_pending = pending_pv.saturating_add(pending_doc);

        if total_pending >= 600 || persistence_batch_rows >= 1000 {
            if self.state != GovernorState::FloodRecovery
                && self.state != GovernorState::ResourceBound
            {
                self.transition_to(GovernorState::ResourceBound);
                self.max_inflight = 1;
                self.pending_probe = false;
                self.min_dispatch_spacing =
                    self.min_dispatch_spacing.max(Duration::from_millis(50));
            }
        } else if self.state == GovernorState::ResourceBound
            && total_pending <= 200
            && persistence_batch_rows <= 300
        {
            self.transition_to(GovernorState::Stable);
        }
    }

    /// Computes delta committed rows / delta time over a rolling duration window.
    pub fn calculate_rolling_committed_rate(&self, window_secs: f64) -> f64 {
        if self.committed_samples.len() < 2 {
            return 0.0;
        }
        let now = Instant::now();
        let newest = self.committed_samples.back().unwrap();

        let mut baseline_sample = self.committed_samples.front().unwrap();
        for sample in self.committed_samples.iter() {
            let age = now.duration_since(sample.timestamp).as_secs_f64();
            if age <= window_secs {
                baseline_sample = sample;
                break;
            }
        }

        let dt = newest
            .timestamp
            .duration_since(baseline_sample.timestamp)
            .as_secs_f64();
        if dt < 0.001 {
            return 0.0;
        }
        let d_rows = newest
            .total_committed
            .saturating_sub(baseline_sample.total_committed);
        d_rows as f64 / dt
    }

    /// Validates and returns a mature throughput window for probe baseline gating.
    pub fn get_mature_baseline_window(&self, target_window_secs: f64) -> Option<ThroughputWindow> {
        if self.committed_samples.len() < 4 {
            return None;
        }
        let now = Instant::now();
        let newest = self.committed_samples.back()?;

        let mut oldest_in_window = None;
        let mut sample_count = 0usize;

        for sample in self.committed_samples.iter() {
            let age = now.duration_since(sample.timestamp).as_secs_f64();
            if age <= target_window_secs {
                if oldest_in_window.is_none() {
                    oldest_in_window = Some(sample);
                }
                sample_count += 1;
            }
        }

        let oldest = oldest_in_window?;
        let duration_secs = newest
            .timestamp
            .duration_since(oldest.timestamp)
            .as_secs_f64();
        let committed_delta = newest
            .total_committed
            .saturating_sub(oldest.total_committed);

        if duration_secs >= 3.0 && sample_count >= 3 && committed_delta > 0 {
            let rate = committed_delta as f64 / duration_secs;
            Some(ThroughputWindow {
                rate,
                duration_secs,
                committed_delta,
                sample_count,
            })
        } else {
            None
        }
    }

    fn transition_to(&mut self, new_state: GovernorState) {
        self.state = new_state;
        self.state_entered_at = Instant::now();
    }

    pub fn state(&self) -> GovernorState {
        self.state
    }

    pub fn max_inflight(&self) -> usize {
        self.max_inflight
    }

    pub fn spacing_ms(&self) -> u32 {
        self.min_dispatch_spacing.as_millis() as u32
    }

    pub fn confidence(&self) -> f64 {
        self.confidence_score
    }

    pub fn rpc_p50(&self) -> u64 {
        self.rpc_samples.p50().unwrap_or(0)
    }

    pub fn rpc_p95(&self) -> u64 {
        self.rpc_samples.p95().unwrap_or(0)
    }

    pub fn ack_p50(&self) -> u64 {
        self.ack_samples.p50().unwrap_or(0)
    }

    pub fn ack_p95(&self) -> u64 {
        self.ack_samples.p95().unwrap_or(0)
    }

    pub fn ack_to_next_p95(&self) -> u64 {
        self.idle_samples.p95().unwrap_or(0)
    }

    pub fn ack_to_next_ewma(&self) -> f64 {
        self.idle_ewma_ms
    }

    pub fn flood_count(&self) -> u64 {
        self.flood_count
    }

    pub fn last_flood_wait_secs(&self) -> u32 {
        self.last_flood_wait_secs
    }

    pub fn best_safe_committed_rate(&self) -> f64 {
        self.best_safe_committed_rate
    }

    pub fn current_sustained_rate(&self) -> f64 {
        self.current_sustained_rate
    }

    pub fn rate_decay_percent(&self) -> f64 {
        self.rate_decay_percent
    }

    pub fn is_db_bound(&self) -> bool {
        self.state == GovernorState::DbBound
    }

    pub fn is_resource_bound(&self) -> bool {
        self.state == GovernorState::ResourceBound
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rolling_sample_window_p50_and_p95() {
        let mut window = RollingSampleWindow::<u64, 10>::new();
        assert!(window.is_empty());
        assert_eq!(window.p50(), None);

        for i in 1..=10 {
            window.push(i * 10);
        }
        assert_eq!(window.len(), 10);
        assert_eq!(window.p50(), Some(60));
        assert_eq!(window.p95(), Some(100));

        // Push 11th item to test bounded capacity
        window.push(110);
        assert_eq!(window.len(), 10);
        assert_eq!(window.p50(), Some(70));
    }

    #[tokio::test]
    async fn test_governor_warmup_to_stable_and_probe_with_mature_baseline() {
        let cancel = CancellationToken::new();
        let mut gov = AdaptiveRateGovernor::new();
        // Production now starts in the already-qualified two-lane Stable
        // profile. Explicitly enter the legacy cold-start state here so this
        // test continues to cover Warmup -> Stable -> Probe transitions.
        gov.state = GovernorState::Warmup;
        gov.max_inflight = 1;
        gov.baseline_rpc_p50_ms = 0.0;
        gov.baseline_rpc_p95_ms = 0.0;
        gov.rpc_ewma_ms = 0.0;
        assert_eq!(gov.state(), GovernorState::Warmup);
        assert_eq!(gov.max_inflight(), 1);

        for _ in 0..5 {
            gov.on_rpc_observation(RpcObservation {
                latency_ms: 120,
                rows_yielded: 50,
                was_error: false,
            });
        }
        assert_eq!(gov.state(), GovernorState::Stable);

        // Feed mature committed ACK history (simulate 5 ACKs over 4s)
        for i in 1..=5 {
            gov.committed_samples.push_back(CommittedProgressSample {
                timestamp: Instant::now() - Duration::from_secs(6 - i),
                total_committed: i * 100,
            });
        }

        // Feed stable successes to flag pending probe
        for _ in 0..25 {
            gov.on_rpc_observation(RpcObservation {
                latency_ms: 110,
                rows_yielded: 50,
                was_error: false,
            });
        }

        // State remains Stable until next page epoch boundary!
        assert_eq!(gov.state(), GovernorState::Stable);
        assert_eq!(gov.max_inflight(), 1);
        assert!(gov.pending_probe);

        // At next page boundary, activate probe cleanly
        gov.before_index_rpc(&cancel).unwrap();
        assert_eq!(gov.state(), GovernorState::ProbeInflight2);
        assert_eq!(gov.max_inflight(), 2);
        assert!(
            gov.spacing_ms() >= 25,
            "Initial probe spacing must be conservative"
        );
    }

    #[tokio::test]
    async fn test_bi_directional_inflight_degrade_probe_and_demotion() {
        let cancel = CancellationToken::new();
        let mut gov = AdaptiveRateGovernor::new();

        // 1. Establish stable baseline
        for _ in 0..5 {
            gov.on_rpc_observation(RpcObservation {
                latency_ms: 80,
                rows_yielded: 100,
                was_error: false,
            });
        }
        assert_eq!(gov.state(), GovernorState::Stable);

        // Set high best safe rate
        gov.best_safe_committed_rate = 700.0;
        gov.max_inflight = 2;
        gov.state_entered_at = Instant::now() - Duration::from_secs(20);

        // Simulate degraded throughput at inflight 2 (current = 350, decay = 50%)
        gov.current_sustained_rate = 350.0;
        gov.rate_decay_percent = 50.0;
        gov.useful_rows_per_rpc = 80.0;

        // Feed RPC observation to trigger degrade probe detection
        gov.on_rpc_observation(RpcObservation {
            latency_ms: 150,
            rows_yielded: 80,
            was_error: false,
        });

        assert!(
            gov.pending_degrade_probe,
            "Governor must flag pending degrade probe on severe sustained rate decay"
        );

        // Activate degrade probe at page boundary
        gov.before_index_rpc(&cancel).unwrap();
        assert_eq!(gov.state(), GovernorState::DegradeProbe);
        assert_eq!(
            gov.max_inflight(),
            1,
            "Inflight must demote to 1 during DegradeProbe"
        );

        // Simulate degrade probe running for 6s with 500 rows/sec (faster than degraded 350 rows/sec!)
        gov.degrade_start_instant = Some(Instant::now() - Duration::from_secs(6));
        gov.degrade_start_committed_rows = 0;
        gov.total_committed_rows = 3000; // 3000 / 6 = 500 rows/s

        for _ in 0..16 {
            gov.on_rpc_observation(RpcObservation {
                latency_ms: 90,
                rows_yielded: 80,
                was_error: false,
            });
        }

        // Must transition to Stable while KEEPING max_inflight = 1!
        assert_eq!(gov.state(), GovernorState::Stable);
        assert_eq!(
            gov.max_inflight(),
            1,
            "Governor must remain at inflight 1 since it outperforms degraded inflight 2"
        );
    }

    #[test]
    fn test_rolling_db_bound_requires_sustained_evidence() {
        let mut gov = AdaptiveRateGovernor::new();
        gov.baseline_rpc_p95_ms = 100.0;
        gov.transition_to(GovernorState::Stable);

        // Single high ACK spike (e.g. 300ms) MUST NOT immediately trigger DbBound
        gov.on_ack_committed(300, 100, 10.0);
        assert_ne!(
            gov.state(),
            GovernorState::DbBound,
            "Single ACK spike must not cause premature DbBound"
        );

        // Second high ACK
        gov.on_ack_committed(290, 200, 10.0);
        assert_ne!(gov.state(), GovernorState::DbBound);

        // Third consecutive high ACK -> Sustained evidence triggers DbBound
        gov.on_ack_committed(310, 300, 10.0);
        assert_eq!(
            gov.state(),
            GovernorState::DbBound,
            "3 consecutive high ACKs must trigger DbBound"
        );
        assert_eq!(gov.max_inflight(), 1);

        // Recovery: requires 3 consecutive low ACKs (<150ms)
        gov.on_ack_committed(40, 400, 10.0);
        gov.on_ack_committed(45, 500, 10.0);
        assert_eq!(
            gov.state(),
            GovernorState::DbBound,
            "Must not exit DbBound before 3 normal ACKs"
        );

        gov.on_ack_committed(42, 600, 10.0);
        gov.on_rpc_observation(RpcObservation {
            latency_ms: 100,
            rows_yielded: 50,
            was_error: false,
        });
        assert_eq!(
            gov.state(),
            GovernorState::Stable,
            "Must exit DbBound after sustained low ACKs"
        );
    }

    #[test]
    fn test_resource_bound_activation_and_recovery() {
        let mut gov = AdaptiveRateGovernor::new();
        gov.transition_to(GovernorState::Stable);
        gov.max_inflight = 2;

        // Normal buffer level (pending = 100, doc = 50)
        gov.on_resource_observation(100, 50, 150);
        assert_eq!(gov.state(), GovernorState::Stable);
        assert_eq!(gov.max_inflight(), 2);

        // High pending items buffer (pending = 400 pv + 300 doc = 700 total >= 600)
        gov.on_resource_observation(400, 300, 150);
        assert_eq!(
            gov.state(),
            GovernorState::ResourceBound,
            "Excess pending items must activate ResourceBound"
        );
        assert_eq!(
            gov.max_inflight(),
            1,
            "ResourceBound must clamp inflight to 1"
        );

        // Buffer drains back to safe zone (total = 150 <= 200)
        gov.on_resource_observation(100, 50, 150);
        assert_eq!(
            gov.state(),
            GovernorState::Stable,
            "ResourceBound must recover to Stable once buffer drains"
        );
    }

    #[test]
    fn test_stable_latency_backoff_is_cooldown_bounded_and_recovers_from_runaway() {
        let mut gov = AdaptiveRateGovernor::new();
        gov.baseline_rpc_p95_ms = 100.0;
        gov.transition_to(GovernorState::Stable);

        // Repeated successful high-latency observations in one cooldown window
        // may apply only one step, not one step per page.
        for _ in 0..100 {
            gov.on_rpc_observation(RpcObservation {
                latency_ms: 250,
                rows_yielded: 100,
                was_error: false,
            });
        }
        assert_eq!(gov.spacing_ms(), 25);

        // Even when every synthetic cooldown has elapsed, latency-only pacing is capped.
        for _ in 0..20 {
            gov.last_latency_backoff_at = Some(Instant::now() - LATENCY_BACKOFF_COOLDOWN);
            gov.on_rpc_observation(RpcObservation {
                latency_ms: 250,
                rows_yielded: 100,
                was_error: false,
            });
        }
        assert_eq!(gov.spacing_ms(), 250);

        // Reproduce the live 558k-peer failure: no FloodWait, 85% rate decay,
        // and historical spacing already above 1.8s. The next success must clamp
        // it immediately, then normal successes progressively relieve it.
        gov.min_dispatch_spacing = Duration::from_millis(1_875);
        gov.rate_decay_percent = 85.0;
        gov.confidence_score = 0.95;
        gov.pending_probe = false;
        let now = Instant::now();
        for i in 0_u64..4 {
            gov.committed_samples.push_back(CommittedProgressSample {
                timestamp: now - Duration::from_secs(4 - i),
                total_committed: i * 100,
            });
        }
        gov.on_rpc_observation(RpcObservation {
            latency_ms: 250,
            rows_yielded: 100,
            was_error: false,
        });
        assert!(gov.spacing_ms() <= 250);
        assert!(
            !gov.pending_probe,
            "severe decay must not promote inflight while pacing recovers"
        );

        for _ in 0..5 {
            gov.on_rpc_observation(RpcObservation {
                latency_ms: 250,
                rows_yielded: 100,
                was_error: false,
            });
        }
        assert!(
            gov.spacing_ms() < 250,
            "severe flood-free decay must relieve pacing"
        );
    }

    #[test]
    fn test_governor_monotonic_flood_recovery_window() {
        let mut gov = AdaptiveRateGovernor::new();

        // 1. First FloodWait of 30s
        gov.on_flood_wait(30);
        assert_eq!(gov.state(), GovernorState::FloodRecovery);
        assert_eq!(gov.last_flood_wait_secs, 30);
        let first_deadline = gov.flood_recovery_until.unwrap();

        // 2. Concurrent second FloodWait of 5s MUST NOT shorten the recovery window!
        gov.on_flood_wait(5);
        assert_eq!(gov.state(), GovernorState::FloodRecovery);
        assert_eq!(
            gov.last_flood_wait_secs, 30,
            "last_flood_wait_secs must retain maximum wait"
        );
        assert!(
            gov.spacing_ms() > 250,
            "FloodWait pacing must remain independent of the latency-only cap"
        );
        let second_deadline = gov.flood_recovery_until.unwrap();
        assert!(
            second_deadline >= first_deadline,
            "Concurrent shorter flood must not shorten recovery deadline"
        );

        // 3. Subsequent longer FloodWait of 45s MUST extend the deadline
        gov.on_flood_wait(45);
        assert_eq!(gov.last_flood_wait_secs, 45);
        let third_deadline = gov.flood_recovery_until.unwrap();
        assert!(
            third_deadline > second_deadline,
            "Longer flood must extend recovery deadline"
        );
    }

    #[test]
    fn test_rolling_committed_rate_calculation() {
        let mut gov = AdaptiveRateGovernor::new();
        gov.on_ack_committed(50, 100, 10.0);
        std::thread::sleep(Duration::from_millis(50));
        gov.on_ack_committed(50, 200, 20.0);

        let rate = gov.calculate_rolling_committed_rate(10.0);
        assert!(rate > 0.0, "Rolling rate must be positive");
    }
}
