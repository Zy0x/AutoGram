//! Transfer progress / ETA helpers (pure Rust).

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressSnapshot {
    pub percent: f64,
    pub bytes_per_sec: f64,
    pub eta_seconds: Option<f64>,
    pub remaining: u64,
    pub backend: String,
}

/// Compute rate and ETA from totals.
pub fn compute_progress(done_bytes: u64, total_bytes: u64, elapsed_secs: f64) -> ProgressSnapshot {
    let remaining = total_bytes.saturating_sub(done_bytes);
    let percent = if total_bytes == 0 {
        0.0
    } else {
        ((done_bytes as f64) * 100.0 / (total_bytes as f64)).min(100.0)
    };
    let elapsed = elapsed_secs.max(0.001);
    let bps = (done_bytes as f64) / elapsed;
    let eta = if bps > 1.0 && remaining > 0 {
        Some((remaining as f64) / bps)
    } else {
        None
    };
    ProgressSnapshot {
        percent: (percent * 100.0).round() / 100.0,
        bytes_per_sec: bps,
        eta_seconds: eta,
        remaining,
        backend: "rust".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn half_done() {
        let p = compute_progress(50, 100, 10.0);
        assert!((p.percent - 50.0).abs() < 0.01);
        assert!((p.bytes_per_sec - 5.0).abs() < 0.01);
        assert!(p.eta_seconds.unwrap() > 9.0);
    }
}
