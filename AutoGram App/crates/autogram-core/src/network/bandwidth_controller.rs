//! Adaptive Bandwidth & Worker Controller
//! Dynamically regulates concurrent worker count and chunk size based on measured network speed and latency.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BandwidthLimits {
    pub max_upload_speed_bps: u64,
    pub active_worker_limit: usize,
    pub adaptive_chunk_size: usize,
}

pub struct BandwidthController {
    pub current_limits: BandwidthLimits,
}

impl BandwidthController {
    pub fn new() -> Self {
        Self {
            current_limits: BandwidthLimits {
                max_upload_speed_bps: 0, // 0 = unthrottled
                active_worker_limit: 4,
                adaptive_chunk_size: 512 * 1024,
            },
        }
    }

    pub fn update_limits(&mut self, is_metered: bool, latency_ms: u32, thermal_critical: bool) {
        if thermal_critical {
            self.current_limits.active_worker_limit = 1;
            self.current_limits.adaptive_chunk_size = 128 * 1024;
        } else if is_metered {
            self.current_limits.active_worker_limit = 2;
            self.current_limits.adaptive_chunk_size = 256 * 1024;
        } else if latency_ms < 100 {
            self.current_limits.active_worker_limit = 8;
            self.current_limits.adaptive_chunk_size = 512 * 1024;
        } else {
            self.current_limits.active_worker_limit = 4;
            self.current_limits.adaptive_chunk_size = 512 * 1024;
        }
    }
}
