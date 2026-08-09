//! Isolated policy for oversized Telegram video documents.
//!
//! Keeping these gates outside the regular preview implementation prevents
//! large-document tuning from changing established startup behavior for normal
//! photos, audio, and sub-1 GiB video.

pub const LARGE_STREAM_THRESHOLD: u64 = 1024 * 1024 * 1024;
pub const DEFAULT_BOOT_TARGET: u64 = 512 * 1024;
pub const LARGE_BOOT_TARGET: u64 = 512 * 1024;
pub const DEFAULT_TAIL_PROBE: u64 = 3 * 1024 * 1024;
pub const LARGE_TAIL_PROBE: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProgressiveStartupPolicy {
    pub immediate_url: bool,
    pub boot_target: u64,
    pub tail_probe_bytes: u64,
}

pub fn policy_for_size(size: u64) -> ProgressiveStartupPolicy {
    if size >= LARGE_STREAM_THRESHOLD {
        ProgressiveStartupPolicy {
            immediate_url: true,
            // Seed one Telegram chunk so the browser never waits on an empty
            // sparse head while the independent tail-MOOV probe is running.
            boot_target: LARGE_BOOT_TARGET,
            tail_probe_bytes: LARGE_TAIL_PROBE,
        }
    } else {
        ProgressiveStartupPolicy {
            immediate_url: false,
            boot_target: DEFAULT_BOOT_TARGET,
            tail_probe_bytes: DEFAULT_TAIL_PROBE,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversized_policy_is_isolated_from_normal_preview() {
        let normal = policy_for_size(LARGE_STREAM_THRESHOLD - 1);
        assert_eq!(normal.boot_target, DEFAULT_BOOT_TARGET);
        assert!(!normal.immediate_url);

        let large = policy_for_size(LARGE_STREAM_THRESHOLD);
        assert_eq!(large.boot_target, LARGE_BOOT_TARGET);
        assert_eq!(large.tail_probe_bytes, LARGE_TAIL_PROBE);
        assert!(large.immediate_url);
    }

    #[test]
    fn largest_supported_stream_keeps_tail_probe_bounded() {
        assert!(policy_for_size(4 * 1024 * 1024 * 1024).tail_probe_bytes <= 8 * 1024 * 1024);
    }
}
