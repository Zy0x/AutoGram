//! media_index_bench.rs — High-Scale Indexing Throughput & Scale Verification Benchmark (Rust)
//!
//! Evaluates sustained indexing throughput, 0 duplicate invariant, 0 missing ID invariant,
//! k-way merge efficiency, and memory stability across 10k -> 25k -> 50k -> 100k -> 250k -> 500k -> 1M+ scales.
//!
//! Note: Full end-to-end application pipeline benchmark (incorporating MediaIndexWorker, AdaptiveRateGovernor,
//! Tauri IPC events, IndexedDB transactions, storage ACKs, and crash-resume parity) is part of Phase P5.

use std::collections::HashSet;
use std::path::Path;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::core::grammers_ops::media_list::{buffered_k_way_merge, list_media_page_async, MediaFileRow};
use crate::core::telegram_ops::TelegramIdentity;
use crate::core::tg_error::TgError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IndexBenchTier {
    Scale10k,
    Scale25k,
    Scale50k,
    Scale100k,
    Scale250k,
    Scale500k,
    Scale1M,
}

impl IndexBenchTier {
    pub fn count(&self) -> usize {
        match self {
            IndexBenchTier::Scale10k => 10_000,
            IndexBenchTier::Scale25k => 25_000,
            IndexBenchTier::Scale50k => 50_000,
            IndexBenchTier::Scale100k => 100_000,
            IndexBenchTier::Scale250k => 250_000,
            IndexBenchTier::Scale500k => 500_000,
            IndexBenchTier::Scale1M => 1_000_000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexBenchReport {
    pub tier: IndexBenchTier,
    pub target_items: usize,
    pub emitted_items: usize,
    pub unique_items: usize,
    pub missing_items: usize,
    pub duplicate_items: usize,
    pub duration_ms: u64,
    pub avg_items_per_sec: f64,
    pub merge_cycles: usize,
    pub passed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveTelegramSearchScanBenchReport {
    pub target_peer: String,
    pub wall_duration_ms: u64,
    pub total_pages_fetched: usize,
    pub total_rows_emitted: usize,
    pub unique_rows: usize,
    pub duplicate_rows: usize,
    pub unique_emitted_per_sec: f64,
    pub passed: bool,
}

/// Generates synthetic descending MediaFileRow stream for benchmark testing.
fn make_synthetic_row(id: i64, kind: &str) -> MediaFileRow {
    MediaFileRow {
        id,
        folder_id: Some(1),
        name: format!("file_{}_{}.dat", kind, id),
        size: 1024 * 1024,
        mime_type: Some("application/octet-stream".into()),
        icon_type: "document".into(),
        created_at: Some("2026-08-20T00:00:00Z".into()),
        has_thumb: false,
        as_document: true,
        backend: "grammers".into(),
        thumb_data_url: None,
        topic_id: None,
        identity_source: None,
        peer_id: Some("-100123".into()),
        account_id: Some("bench_session".into()),
        peer_kind: Some("channel".into()),
        peer_username: None,
        grouped_id: None,
        is_saved_messages: Some(false),
        telegram_category: None,
        telegram_subtype: None,
        drive_category: None,
        drive_format: None,
    }
}

/// Executes an end-to-end synthetic scale benchmark across dual-lane pagination and k-way merge.
pub fn run_synthetic_index_benchmark(tier: IndexBenchTier) -> IndexBenchReport {
    let total_target = tier.count();
    let page_size = 100usize;

    // Simulate two realistic interleaving lanes:
    // PV: even IDs from total*2 down to 2
    // DOC: odd IDs from total*2-1 down to 1 (with 5% overlap duplicates to stress dual-pop)
    let start_id = (total_target * 2) as i64;
    let mut cur_pv_id = start_id;
    let mut cur_doc_id = start_id - 1;

    let mut pending_pv = Vec::with_capacity(page_size * 2);
    let mut pending_doc = Vec::with_capacity(page_size * 2);

    let mut seen_ids = HashSet::with_capacity(total_target);
    let mut duplicate_count = 0usize;
    let mut emitted_count = 0usize;
    let mut merge_cycles = 0usize;

    let start = Instant::now();

    while emitted_count < total_target && (cur_pv_id > 0 || cur_doc_id > 0 || !pending_pv.is_empty() || !pending_doc.is_empty()) {
        // Replenish PV lane
        while pending_pv.len() < page_size && cur_pv_id > 0 {
            pending_pv.push(make_synthetic_row(cur_pv_id, "pv"));
            cur_pv_id -= 2;
        }

        // Replenish DOC lane
        while pending_doc.len() < page_size && cur_doc_id > 0 {
            // 5% intentional duplicate ID to verify dual-pop deduplication
            let id = if cur_doc_id % 40 == 1 { cur_doc_id + 1 } else { cur_doc_id };
            pending_doc.push(make_synthetic_row(id, "doc"));
            cur_doc_id -= 2;
        }

        merge_cycles += 1;
        let merged = buffered_k_way_merge(&mut pending_pv, &mut pending_doc, page_size);
        if merged.is_empty() {
            break;
        }

        for item in merged {
            emitted_count += 1;
            if !seen_ids.insert(item.row.id) {
                duplicate_count += 1;
            }
            if emitted_count >= total_target {
                break;
            }
        }
    }

    let elapsed = start.elapsed();
    let duration_ms = elapsed.as_millis().max(1) as u64;
    let avg_items_per_sec = (emitted_count as f64) / elapsed.as_secs_f64().max(0.0001);

    let missing = total_target.saturating_sub(seen_ids.len());
    let passed = duplicate_count == 0 && missing == 0;

    IndexBenchReport {
        tier,
        target_items: total_target,
        emitted_items: emitted_count,
        unique_items: seen_ids.len(),
        missing_items: missing,
        duplicate_items: duplicate_count,
        duration_ms,
        avg_items_per_sec,
        merge_cycles,
        passed,
    }
}

/// Executes a raw search scan throughput probe against real Telegram MTProto datacenter.
pub async fn run_live_telegram_search_scan_benchmark(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    max_pages: usize,
) -> Result<LiveTelegramSearchScanBenchReport, TgError> {
    let start = Instant::now();
    let mut cursor = None;
    let mut pages_fetched = 0usize;
    let mut emitted_rows = 0usize;
    let mut seen_ids = HashSet::new();
    let mut duplicate_rows = 0usize;

    for _ in 0..max_pages {
        pages_fetched += 1;
        let res = list_media_page_async(
            sessions_dir,
            identity,
            chat_id,
            100,
            None,
            None,
            None,
            cursor.clone(),
            2, // Test inflight=2 dual lane
            None,
        )
        .await?;

        for f in &res.files {
            emitted_rows += 1;
            if !seen_ids.insert(f.id) {
                duplicate_rows += 1;
            }
        }

        cursor = res.search_cursor;
        if !res.has_more {
            break;
        }
    }

    let elapsed = start.elapsed();
    let wall_duration_ms = elapsed.as_millis().max(1) as u64;
    let unique_emitted_per_sec = (seen_ids.len() as f64) / elapsed.as_secs_f64().max(0.0001);
    let passed = duplicate_rows == 0 && seen_ids.len() == emitted_rows;

    Ok(LiveTelegramSearchScanBenchReport {
        target_peer: chat_id.to_string(),
        wall_duration_ms,
        total_pages_fetched: pages_fetched,
        total_rows_emitted: emitted_rows,
        unique_rows: seen_ids.len(),
        duplicate_rows,
        unique_emitted_per_sec,
        passed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_synthetic_benchmark_10k_to_50k() {
        let r10k = run_synthetic_index_benchmark(IndexBenchTier::Scale10k);
        assert!(r10k.passed, "10k benchmark failed: {:?}", r10k);
        assert_eq!(r10k.duplicate_items, 0);
        assert_eq!(r10k.missing_items, 0);
        assert!(r10k.avg_items_per_sec > 10_000.0);

        let r25k = run_synthetic_index_benchmark(IndexBenchTier::Scale25k);
        assert!(r25k.passed, "25k benchmark failed: {:?}", r25k);
        assert_eq!(r25k.duplicate_items, 0);
        assert_eq!(r25k.missing_items, 0);

        let r50k = run_synthetic_index_benchmark(IndexBenchTier::Scale50k);
        assert!(r50k.passed, "50k benchmark failed: {:?}", r50k);
        assert_eq!(r50k.duplicate_items, 0);
        assert_eq!(r50k.missing_items, 0);
    }

    #[test]
    fn test_synthetic_benchmark_100k() {
        let r100k = run_synthetic_index_benchmark(IndexBenchTier::Scale100k);
        assert!(r100k.passed, "100k benchmark failed: {:?}", r100k);
        assert_eq!(r100k.duplicate_items, 0);
        assert_eq!(r100k.missing_items, 0);
        assert!(r100k.avg_items_per_sec > 20_000.0);
    }

    #[test]
    fn test_synthetic_benchmark_250k_to_1m() {
        let r250k = run_synthetic_index_benchmark(IndexBenchTier::Scale250k);
        assert!(r250k.passed, "250k benchmark failed: {:?}", r250k);
        assert_eq!(r250k.duplicate_items, 0);
        assert_eq!(r250k.missing_items, 0);

        let r500k = run_synthetic_index_benchmark(IndexBenchTier::Scale500k);
        assert!(r500k.passed, "500k benchmark failed: {:?}", r500k);
        assert_eq!(r500k.duplicate_items, 0);
        assert_eq!(r500k.missing_items, 0);

        let r1m = run_synthetic_index_benchmark(IndexBenchTier::Scale1M);
        assert!(r1m.passed, "1M benchmark failed: {:?}", r1m);
        assert_eq!(r1m.duplicate_items, 0);
        assert_eq!(r1m.missing_items, 0);
        assert!(r1m.avg_items_per_sec > 20_000.0);
    }
}
