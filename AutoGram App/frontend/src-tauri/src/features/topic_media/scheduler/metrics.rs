//! Scheduler metrics tracking for observability.

use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Default)]
pub struct SchedulerMetrics {
    pub total_searches: AtomicU64,
    pub total_thumbs_fetched: AtomicU64,
    pub total_flood_waits: AtomicU64,
    pub cancelled_tasks: AtomicU64,
}

impl SchedulerMetrics {
    pub fn inc_search(&self) {
        self.total_searches.fetch_add(1, Ordering::Relaxed);
    }
    pub fn inc_thumb(&self) {
        self.total_thumbs_fetched.fetch_add(1, Ordering::Relaxed);
    }
    pub fn inc_flood_wait(&self) {
        self.total_flood_waits.fetch_add(1, Ordering::Relaxed);
    }
    pub fn inc_cancelled(&self) {
        self.cancelled_tasks.fetch_add(1, Ordering::Relaxed);
    }
}
