//! Adaptive Bandwidth & Worker Controller
//! Dynamically regulates concurrent worker count and chunk size based on measured network speed and latency.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BandwidthLimits {
    pub max_upload_speed_bps: u64,
    pub active_worker_limit: usize,
    pub adaptive_chunk_size: usize,
    pub is_streaming_active: bool,
    pub pacing_delay_ms: u64,
}

pub struct BandwidthController {
    pub current_limits: BandwidthLimits,
}

impl BandwidthController {
    pub fn new() -> Self {
        Self {
            current_limits: BandwidthLimits {
                max_upload_speed_bps: 0, // 0 = unthrottled
                active_worker_limit: 6,
                adaptive_chunk_size: 512 * 1024,
                is_streaming_active: false,
                pacing_delay_ms: 0,
            },
        }
    }

    pub fn set_streaming_active(&mut self, active: bool) {
        self.current_limits.is_streaming_active = active;
        if active {
            // Yield socket and network bandwidth to ensure 0-jitter streaming
            self.current_limits.active_worker_limit = 2;
            self.current_limits.pacing_delay_ms = 15;
        } else {
            // Turbo Mode: Restore full throughput while staying strictly within safe 6-socket boundary
            self.current_limits.active_worker_limit = 6;
            self.current_limits.pacing_delay_ms = 0;
        }
    }

    pub fn effective_worker_limit(&self) -> usize {
        if self.current_limits.is_streaming_active {
            2
        } else {
            self.current_limits.active_worker_limit.clamp(1, 6)
        }
    }

    pub fn effective_pacing_delay_ms(&self) -> u64 {
        if self.current_limits.is_streaming_active {
            15
        } else {
            self.current_limits.pacing_delay_ms
        }
    }

    pub fn update_limits(&mut self, is_metered: bool, latency_ms: u32, thermal_critical: bool) {
        if thermal_critical {
            self.current_limits.active_worker_limit = 1;
            self.current_limits.adaptive_chunk_size = 128 * 1024;
            self.current_limits.pacing_delay_ms = 25;
        } else if is_metered {
            self.current_limits.active_worker_limit = 2;
            self.current_limits.adaptive_chunk_size = 256 * 1024;
            self.current_limits.pacing_delay_ms = 10;
        } else if latency_ms < 100 {
            // Low latency local/regional DC (e.g. DC5 Singapore ~35ms)
            self.current_limits.active_worker_limit = if self.current_limits.is_streaming_active { 2 } else { 6 };
            self.current_limits.adaptive_chunk_size = 512 * 1024;
            self.current_limits.pacing_delay_ms = if self.current_limits.is_streaming_active { 15 } else { 0 };
        } else {
            // High latency overseas DC (e.g. DC2/DC4 Amsterdam ~190ms)
            self.current_limits.active_worker_limit = if self.current_limits.is_streaming_active { 2 } else { 5 };
            self.current_limits.adaptive_chunk_size = 512 * 1024;
            self.current_limits.pacing_delay_ms = if self.current_limits.is_streaming_active { 15 } else { 0 };
        }
    }
}
