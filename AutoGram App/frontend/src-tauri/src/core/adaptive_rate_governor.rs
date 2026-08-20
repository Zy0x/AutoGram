//! adaptive_rate_governor.rs — Rust-Only Adaptive Rate Governor for P4
//!
//! Dynamically adjusts inter-request pacing, inflight permits (1 -> 2),
//! flood recovery, and latency EWMA/p95 feedback to maximize committed useful media/s.

use std::collections::VecDeque;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::core::tg_error::{TgError, TgErrorCode};

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

    last_dispatch_instant: Option<Instant>,
    last_safe_pacing_ms: u32,

    baseline_rpc_p50_ms: f64,
    baseline_rpc_p95_ms: f64,
    rpc_ewma_ms: f64,

    ack_ewma_ms: f64,
    ack_p95_ms: f64,

    rpc_samples: RollingSampleWindow<u64, 128>,
    ack_samples: RollingSampleWindow<u64, 128>,
    idle_samples: RollingSampleWindow<u64, 128>,

    committed_rows_per_sec: f64,
    useful_rows_per_rpc: f64,

    stable_successes: u64,
    probe_successes: u64,
    total_search_rpcs: u64,

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
            state: GovernorState::Warmup,
            min_dispatch_spacing: Duration::from_millis(0),
            max_inflight: 1,

            last_dispatch_instant: None,
            last_safe_pacing_ms: 0,

            baseline_rpc_p50_ms: 0.0,
            baseline_rpc_p95_ms: 0.0,
            rpc_ewma_ms: 0.0,

            ack_ewma_ms: 0.0,
            ack_p95_ms: 0.0,

            rpc_samples: RollingSampleWindow::new(),
            ack_samples: RollingSampleWindow::new(),
            idle_samples: RollingSampleWindow::new(),

            committed_rows_per_sec: 0.0,
            useful_rows_per_rpc: 0.0,

            stable_successes: 0,
            probe_successes: 0,
            total_search_rpcs: 0,

            flood_count: 0,
            last_flood_wait_secs: 0,
            last_flood_at_ms: None,
            flood_recovery_until: None,

            confidence_score: 0.1,
            state_entered_at: Instant::now(),
        }
    }

    /// Cancellation-aware pacing check to enforce minimum inter-request spacing before actual RPC dispatch.
    pub async fn before_index_rpc(&mut self, cancel: &CancellationToken) -> Result<(), TgError> {
        if cancel.is_cancelled() {
            return Err(TgError::new(TgErrorCode::Cancelled, "indexing cancelled"));
        }

        if let Some(last) = self.last_dispatch_instant {
            let elapsed = last.elapsed();
            if elapsed < self.min_dispatch_spacing {
                let wait = self.min_dispatch_spacing - elapsed;
                tokio::select! {
                    _ = cancel.cancelled() => {
                        return Err(TgError::new(TgErrorCode::Cancelled, "indexing cancelled during pacing"));
                    }
                    _ = tokio::time::sleep(wait) => {}
                }
            }
        }

        self.last_dispatch_instant = Some(Instant::now());
        Ok(())
    }

    /// Feeds real RPC measurement from a guarded search invocation.
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
            self.useful_rows_per_rpc = (self.useful_rows_per_rpc * 0.9) + (obs.rows_yielded as f64 * 0.1);
        }

        if obs.was_error {
            // Degraded error response: increase spacing slightly
            self.min_dispatch_spacing = self.min_dispatch_spacing.saturating_add(Duration::from_millis(50));
            if self.state == GovernorState::ProbeInflight2 {
                self.transition_to(GovernorState::Cooldown);
                self.max_inflight = 1;
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

                // Check for degradation: p95 > 1.8x baseline
                if self.baseline_rpc_p95_ms > 0.0 && cur_p95 > self.baseline_rpc_p95_ms * 1.8 {
                    self.min_dispatch_spacing = self.min_dispatch_spacing.saturating_add(Duration::from_millis(25));
                } else if self.min_dispatch_spacing > Duration::from_millis(0) && self.stable_successes % 10 == 0 {
                    // Gradually relieve pacing if healthy
                    self.min_dispatch_spacing = self.min_dispatch_spacing.saturating_sub(Duration::from_millis(10));
                }

                // Probe inflight 2 if stable for >= 20 successful RPCs and high confidence
                if self.stable_successes >= 20 && self.confidence_score >= 0.6 && self.max_inflight == 1 {
                    self.transition_to(GovernorState::ProbeInflight2);
                    self.max_inflight = 2;
                    self.probe_successes = 0;
                }
            }
            GovernorState::ProbeInflight2 => {
                self.probe_successes += 1;
                let cur_p95 = self.rpc_samples.p95().unwrap_or(200) as f64;

                // If p95 latency spikes sharply under inflight=2, roll back to Stable with inflight=1
                if self.baseline_rpc_p95_ms > 0.0 && cur_p95 > self.baseline_rpc_p95_ms * 2.2 {
                    self.transition_to(GovernorState::Cooldown);
                    self.max_inflight = 1;
                    self.confidence_score = (self.confidence_score * 0.8).max(0.2);
                } else if self.probe_successes >= 30 {
                    // Confirmed sustainable inflight=2!
                    self.confidence_score = (self.confidence_score + 0.1).min(0.95);
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
                    }
                }
            }
            GovernorState::DbBound | GovernorState::ResourceBound => {
                if self.state_entered_at.elapsed() >= Duration::from_secs(5) {
                    self.transition_to(GovernorState::Stable);
                }
            }
        }
    }

    /// Feeds FloodWait signal: resets inflight to 1, sets exact cooldown, and backs off pacing.
    pub fn on_flood_wait(&mut self, wait_secs: u32) {
        self.flood_count += 1;
        self.last_flood_wait_secs = wait_secs;
        self.last_flood_at_ms = Some(now_epoch_ms());
        self.max_inflight = 1;
        self.confidence_score = (self.confidence_score * 0.5).max(0.1);

        // Resume rate below the unsafe observed rate: add minimum 150ms pacing
        self.min_dispatch_spacing = (self.min_dispatch_spacing + Duration::from_millis(150)).max(Duration::from_millis(200));
        self.flood_recovery_until = Some(Instant::now() + Duration::from_secs(u64::from(wait_secs) + 10));
        self.transition_to(GovernorState::FloodRecovery);
    }

    /// Feeds IndexedDB ACK and scheduler gap observations.
    pub fn on_ack_committed(&mut self, ack_latency_ms: u64, ack_to_next_gap_ms: u64) {
        self.ack_samples.push(ack_latency_ms);
        self.idle_samples.push(ack_to_next_gap_ms);

        let ack_f = ack_latency_ms as f64;
        if self.ack_ewma_ms <= 0.0 {
            self.ack_ewma_ms = ack_f;
        } else {
            self.ack_ewma_ms = (self.ack_ewma_ms * 0.8) + (ack_f * 0.2);
        }

        // If IndexedDB ACK latency is high (>350ms), mark DbBound to prevent Telegram congestion
        if ack_latency_ms > 350 && self.state != GovernorState::FloodRecovery {
            self.transition_to(GovernorState::DbBound);
            self.max_inflight = 1;
        }
    }

    pub fn update_throughput(&mut self, committed_rate: f64) {
        self.committed_rows_per_sec = committed_rate;
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

    pub fn flood_count(&self) -> u64 {
        self.flood_count
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
    async fn test_governor_warmup_to_stable_and_probe() {
        let mut gov = AdaptiveRateGovernor::new();
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

        // Feed stable successes to trigger probe
        for _ in 0..25 {
            gov.on_rpc_observation(RpcObservation {
                latency_ms: 110,
                rows_yielded: 50,
                was_error: false,
            });
        }
        assert_eq!(gov.state(), GovernorState::ProbeInflight2);
        assert_eq!(gov.max_inflight(), 2);
    }

    #[test]
    fn test_governor_flood_wait_backoff() {
        let mut gov = AdaptiveRateGovernor::new();
        gov.on_flood_wait(30);

        assert_eq!(gov.state(), GovernorState::FloodRecovery);
        assert_eq!(gov.max_inflight(), 1);
        assert!(gov.spacing_ms() >= 200);
        assert_eq!(gov.flood_count, 1);
        assert_eq!(gov.last_flood_wait_secs, 30);
    }
}
