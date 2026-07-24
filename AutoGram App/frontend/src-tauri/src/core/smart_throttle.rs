//! smart_throttle.rs — Human Behavior Mode & Adaptive Rate Throttler (Rust)
//!
//! Port of Python `smart_throttle.py`:
//! Manages adaptive delays, burst breaks, and FloodWait backoff mechanisms
//! to protect Telegram accounts during transfers.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::time::Duration;
use tokio::time::sleep;

use super::tg_log;

const BACKEND: &str = "smart_throttle";

pub struct SmartThrottle {
    pub configured_delay_min_ms: u64,
    pub configured_delay_max_ms: u64,
    pub base_delay_min_ms: AtomicU64,
    pub base_delay_max_ms: AtomicU64,
    pub consecutive_errors: AtomicU32,
    pub is_paused: AtomicBool,
    pub messages_in_burst: AtomicU32,
    pub current_burst_limit: AtomicU32,
}

impl SmartThrottle {
    pub fn new(min_secs: f64, max_secs: f64) -> Self {
        let min_ms = (min_secs.max(0.0) * 1000.0) as u64;
        let max_ms = (max_secs.max(min_secs) * 1000.0) as u64;

        let burst_limit = Self::calc_burst_limit("Fast Forward");

        Self {
            configured_delay_min_ms: min_ms,
            configured_delay_max_ms: max_ms,
            base_delay_min_ms: AtomicU64::new(min_ms),
            base_delay_max_ms: AtomicU64::new(max_ms),
            consecutive_errors: AtomicU32::new(0),
            is_paused: AtomicBool::new(false),
            messages_in_burst: AtomicU32::new(0),
            current_burst_limit: AtomicU32::new(burst_limit),
        }
    }

    fn calc_burst_limit(mode: &str) -> u32 {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        if mode == "Fast Forward" {
            rng.gen_range(30..=55)
        } else {
            rng.gen_range(70..=110)
        }
    }

    /// Sleep with random delay to simulate human action and respect burst limits.
    pub async fn human_delay(&self, mode: &str, batch_size: u32) {
        use rand::Rng;
        let mut rng = rand::thread_rng();

        let min = self.base_delay_min_ms.load(Ordering::Relaxed);
        let max = self.base_delay_max_ms.load(Ordering::Relaxed);

        let delay_ms = if max > min {
            rng.gen_range(min..=max)
        } else {
            min
        };

        if delay_ms > 0 {
            sleep(Duration::from_millis(delay_ms)).await;
        }

        let curr_burst = self
            .messages_in_burst
            .fetch_add(batch_size.max(1), Ordering::Relaxed)
            + batch_size.max(1);

        let limit = self.current_burst_limit.load(Ordering::Relaxed);
        if curr_burst >= limit {
            let rest_secs = rng.gen_range(35..=65);
            tg_log::info(
                BACKEND,
                "burst_rest",
                format!("Reached {curr_burst} consecutive messages. Resting for {rest_secs}s"),
            );
            sleep(Duration::from_secs(rest_secs)).await;

            self.messages_in_burst.store(0, Ordering::Relaxed);
            let next_limit = Self::calc_burst_limit(mode);
            self.current_burst_limit.store(next_limit, Ordering::Relaxed);
        }
    }

    /// Handle FloodWait seconds from Telegram API.
    pub async fn handle_flood_wait(&self, wait_secs: u64) {
        use rand::Rng;
        let mut rng = rand::thread_rng();

        self.consecutive_errors.fetch_add(1, Ordering::Relaxed);
        let extra_ms = rng.gen_range(2000..5000);
        let total_sleep_ms = (wait_secs * 1000) + extra_ms;

        tg_log::warn(
            BACKEND,
            "flood_wait",
            format!("FloodWait {wait_secs}s. Sleeping total {}s", total_sleep_ms / 1000),
        );

        // Backoff base delays
        self.base_delay_min_ms
            .fetch_add(1000, Ordering::Relaxed);
        self.base_delay_max_ms
            .fetch_add(2000, Ordering::Relaxed);

        sleep(Duration::from_millis(total_sleep_ms)).await;
    }

    /// Reset health metrics upon successful transfers.
    pub fn reset_health(&self) {
        let errs = self.consecutive_errors.load(Ordering::Relaxed);
        if errs > 0 {
            self.consecutive_errors.store(errs - 1, Ordering::Relaxed);
        } else {
            // Decay delays toward baseline
            let cur_min = self.base_delay_min_ms.load(Ordering::Relaxed);
            if cur_min > self.configured_delay_min_ms {
                self.base_delay_min_ms.store(
                    (cur_min.saturating_sub(500)).max(self.configured_delay_min_ms),
                    Ordering::Relaxed,
                );
            }
            let cur_max = self.base_delay_max_ms.load(Ordering::Relaxed);
            if cur_max > self.configured_delay_max_ms {
                self.base_delay_max_ms.store(
                    (cur_max.saturating_sub(500)).max(self.configured_delay_max_ms),
                    Ordering::Relaxed,
                );
            }
        }
    }
}
