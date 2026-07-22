//! Size-tier streaming policy (Rust source of truth for desktop).
//! Mirrors worker/engine/media_stream.py get_streaming_config buckets.

use serde::Serialize;

const MB: u64 = 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamingConfig {
    pub layer: String,
    pub first_play: u64,
    pub initial_head: u64,
    pub window_size: u64,
    pub throttle_ahead: u64,
    pub workers: u32,
    pub chunk_size: u64,
}

/// Size-tier policy: &lt;10 … 4000+ MB (same ladder as Python v2.1.67).
pub fn get_streaming_config(total_size: u64) -> StreamingConfig {
    let sz = total_size;
    // (max_exclusive or None, layer, first_play, initial_head, window, throttle, workers, chunk)
    let tiers: &[(Option<u64>, &str, u64, u64, u64, u64, u32, u64)] = &[
        (Some(10 * MB), "u10", 320 * 1024, 4 * MB, 10 * MB, 0, 18, 512 * 1024),
        (Some(20 * MB), "u20", 288 * 1024, 3 * MB, 8 * MB, 4 * MB, 20, 512 * 1024),
        (Some(50 * MB), "u50", 256 * 1024, 2 * MB, 8 * MB, 6 * MB, 22, 512 * 1024),
        (Some(100 * MB), "u100", 224 * 1024, 2 * MB, 8 * MB, 8 * MB, 24, 512 * 1024),
        (Some(150 * MB), "u150", 224 * 1024, 1536 * 1024, 6 * MB, 10 * MB, 26, 512 * 1024),
        (Some(200 * MB), "u200", 192 * 1024, 1280 * 1024, 6 * MB, 12 * MB, 26, 512 * 1024),
        (Some(250 * MB), "u250", 192 * 1024, 1280 * 1024, 6 * MB, 12 * MB, 28, 512 * 1024),
        (Some(300 * MB), "u300", 192 * 1024, 1024 * 1024, 5 * MB, 14 * MB, 28, 512 * 1024),
        (Some(500 * MB), "u500", 160 * 1024, 896 * 1024, 5 * MB, 16 * MB, 28, 256 * 1024),
        (Some(1000 * MB), "u1g", 160 * 1024, 768 * 1024, 4 * MB, 20 * MB, 30, 256 * 1024),
        (Some(1500 * MB), "u1_5g", 128 * 1024, 640 * 1024, 4 * MB, 24 * MB, 30, 256 * 1024),
        (Some(2000 * MB), "u2g", 128 * 1024, 512 * 1024, 4 * MB, 28 * MB, 32, 256 * 1024),
        (Some(2500 * MB), "u2_5g", 128 * 1024, 512 * 1024, 3 * MB, 32 * MB, 32, 128 * 1024),
        (Some(3000 * MB), "u3g", 96 * 1024, 448 * 1024, 3 * MB, 36 * MB, 32, 128 * 1024),
        (Some(3500 * MB), "u3_5g", 96 * 1024, 384 * 1024, 3 * MB, 40 * MB, 32, 128 * 1024),
        (Some(4000 * MB), "u4g", 96 * 1024, 320 * 1024, 3 * MB, 44 * MB, 32, 128 * 1024),
        (None, "u4g_plus", 96 * 1024, 320 * 1024, 2 * MB, 48 * MB, 32, 128 * 1024),
    ];

    for &(max_sz, layer, first_play, initial_head, window, throttle, workers, chunk) in tiers {
        if max_sz.map(|m| sz < m).unwrap_or(true) {
            let cap = if sz > 0 { sz } else { initial_head };
            return StreamingConfig {
                layer: layer.to_string(),
                first_play: first_play.min(cap),
                initial_head: initial_head.min(cap),
                window_size: if cap > 0 { window.min(cap) } else { window },
                throttle_ahead: throttle,
                workers,
                chunk_size: chunk,
            };
        }
    }
    StreamingConfig {
        layer: "u4g_plus".into(),
        first_play: 96 * 1024,
        initial_head: 256 * 1024,
        window_size: 2 * MB,
        throttle_ahead: 48 * MB,
        workers: 32,
        chunk_size: 64 * 1024,
    }
}

#[allow(dead_code)] // used by future stream HTTP / Python parity checks
pub fn first_play_bytes(total_size: u64) -> u64 {
    get_streaming_config(total_size).first_play
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buckets_monotonic_first_play() {
        let mut prev: Option<u64> = None;
        for mb in [10u64, 50, 100, 500, 1000, 4000] {
            let cfg = get_streaming_config(mb * MB - 1);
            assert!(cfg.first_play <= 512 * 1024, "layer {}", cfg.layer);
            if let Some(p) = prev {
                // first_play should not grow as files get larger
                assert!(
                    cfg.first_play <= p,
                    "first_play grew: {} -> {} at {}MB",
                    p,
                    cfg.first_play,
                    mb
                );
            }
            prev = Some(cfg.first_play);
        }
    }

    #[test]
    fn over_4gb() {
        let cfg = get_streaming_config(4500 * MB);
        assert_eq!(cfg.layer, "u4g_plus");
        assert!(cfg.workers >= 28);
    }

    #[test]
    fn stream_window_never_exceeds_small_file() {
        let size = 640 * 1024;
        let cfg = get_streaming_config(size);
        assert_eq!(cfg.window_size, size);
        assert!(cfg.first_play <= cfg.window_size);
    }
}
