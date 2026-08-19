//! media_index_types.rs — Typed contracts for Long-Running Rust Media Index Worker (P3)
//!
//! Enforces exact serialization parity between Rust Core and React TypeScript IPC bridge.
//! No Telegram credentials, API hashes, or large binary payloads may be serialized here.

use serde::{Deserialize, Serialize};

use super::grammers_ops::{LaneCounts, LaneDurability, LaneWatermark, MediaFileRow};
use super::telegram_ops::TelegramIdentity;

/// Lifecycle states of a long-running media index job in Rust.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaIndexJobState {
    Preparing,
    Running,
    WaitingAck,
    WaitingFrontend,
    FloodPaused,
    UserPaused,
    Completed,
    Cancelled,
    Failed,
}

/// Operational mode derived by Rust from the durable checkpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaIndexMode {
    HistoricalBackfill,
    DeltaSync,
}

/// Snapshot of the durable `MediaIndexState` stored in IndexedDB.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaIndexStateSnapshot {
    #[serde(default)]
    pub schema_version: Option<u32>,
    pub account_id: String,
    pub peer_id: String,
    pub scope_kind: String,
    pub topic_id_normalized: i64,
    pub mode: String,
    pub pv_committed_offset: i32,
    pub doc_committed_offset: i32,
    #[serde(default)]
    pub pv_exhausted: bool,
    #[serde(default)]
    pub doc_exhausted: bool,
    #[serde(default)]
    pub backfill_complete: bool,
    #[serde(default)]
    pub newest_committed_id: i64,
    #[serde(default)]
    pub delta_active: bool,
    #[serde(default)]
    pub delta_base_id: i64,
    #[serde(default)]
    pub delta_pv_committed_offset: i32,
    #[serde(default)]
    pub delta_doc_committed_offset: i32,
    #[serde(default)]
    pub delta_pv_exhausted: bool,
    #[serde(default)]
    pub delta_doc_exhausted: bool,
    #[serde(default)]
    pub delta_max_observed_id: i64,
}

/// Candidate checkpoint emitted alongside a page to be committed atomically by IndexedDB.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaIndexCheckpointCandidate {
    pub account_id: String,
    pub peer_id: String,
    pub scope_kind: String,
    pub topic_id_normalized: i64,
    pub mode: String,
    pub pv_committed_offset: i32,
    pub doc_committed_offset: i32,
    pub pv_committed_exhausted: bool,
    pub doc_committed_exhausted: bool,
    pub backfill_complete: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub newest_committed_id: Option<i64>,
    pub delta_active: bool,
    pub delta_base_id: i64,
    pub delta_pv_committed_offset: i32,
    pub delta_doc_committed_offset: i32,
    pub delta_pv_committed_exhausted: bool,
    pub delta_doc_committed_exhausted: bool,
    pub delta_complete: bool,
}

/// Bounded telemetry and progress metrics snapshot.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaIndexMetricsSnapshot {
    pub pages_fetched: u64,
    pub rpc_calls: u64,
    pub rows_emitted: u64,
    pub rows_committed: u64,
    pub unique_media_per_sec: f64,
    pub rpc_per_sec: f64,
    pub rpc_ewma_ms: f64,
    pub rpc_p95_ms: u64,
    pub flood_count: u64,
    pub flood_seconds_total: u64,
    pub ack_latency_ewma_ms: f64,
    pub ack_latency_p95_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_total_estimate: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_percent: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_eta_secs: Option<u64>,
}

/// Emitted when a new batch of media rows has been fetched and merged by Rust.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaIndexPageEvent {
    pub job_id: u64,
    pub ack_id: u64,
    pub mode: MediaIndexMode,
    pub rows: Vec<MediaFileRow>,
    pub candidate_checkpoint: MediaIndexCheckpointCandidate,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lane_counts: Option<LaneCounts>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emitted_watermark: Option<LaneWatermark>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lane_durability: Option<LaneDurability>,
    pub has_more: bool,
    pub metrics: MediaIndexMetricsSnapshot,
}

/// Periodic progress event emitted at 4–10 Hz.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaIndexProgressEvent {
    pub job_id: u64,
    pub state: MediaIndexJobState,
    pub mode: MediaIndexMode,
    pub metrics: MediaIndexMetricsSnapshot,
}

/// Emitted when the entire indexing run finishes successfully.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaIndexCompleteEvent {
    pub job_id: u64,
    pub mode: MediaIndexMode,
    pub total_emitted_rows: u64,
    pub metrics: MediaIndexMetricsSnapshot,
}

/// Unified typed event stream carried over the Tauri Channel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MediaIndexEvent {
    State {
        job_id: u64,
        state: MediaIndexJobState,
    },
    Page(MediaIndexPageEvent),
    Progress(MediaIndexProgressEvent),
    Flood {
        job_id: u64,
        wait_secs: u32,
        resume_at_ms: u64,
    },
    Complete(MediaIndexCompleteEvent),
    Failed {
        job_id: u64,
        code: String,
        message: String,
        recoverable: bool,
    },
}

/// Outcome reported by the frontend after IndexedDB commit attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaIndexAckOutcome {
    Committed,
    Failed,
}

/// Typed ACK payload sent by the frontend back to Rust.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaIndexPageAck {
    pub job_id: u64,
    pub ack_id: u64,
    pub outcome: MediaIndexAckOutcome,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub committed_state: Option<MediaIndexStateSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

/// Result returned from Rust when processing an incoming ACK.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaIndexAckResult {
    Accepted,
    AlreadyAcked,
    Stale,
    Unexpected,
    JobTerminal,
}

/// Request to launch a new or attach to an existing media index job.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartMediaIndexJobRequest {
    pub client_request_id: String,
    pub identity: TelegramIdentity,
    pub peer_id: String,
    pub topic_id: Option<i64>,
    pub page_size: Option<usize>,
    pub initial_state: Option<MediaIndexStateSnapshot>,
    pub force_mode: Option<MediaIndexMode>,
}

/// Response returned immediately upon job creation/retrieval.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartMediaIndexJobResponse {
    pub job_id: u64,
    pub state: MediaIndexJobState,
    pub reused_existing_job: bool,
}

/// Response returned when attaching a new primary persistence Channel to an existing job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachMediaIndexJobResponse {
    pub job_id: u64,
    pub attached: bool,
    pub subscriber_id: u64,
    pub generation: u64,
    pub state: MediaIndexJobState,
    pub replayed_ack_id: Option<u64>,
}

/// Response returned when explicitly detaching a Channel from an indexing job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachMediaIndexJobResponse {
    pub job_id: u64,
    pub detached: bool,
}

/// Response returned from lifecycle control commands (pause, resume, cancel).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaIndexControlResponse {
    pub job_id: u64,
    pub accepted: bool,
    pub state: MediaIndexJobState,
}

/// Terminal error metadata for queryable job status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaIndexJobError {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
}

/// Comprehensive queryable status of an indexing job.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaIndexJobStatus {
    pub job_id: u64,
    pub state: MediaIndexJobState,
    pub mode: MediaIndexMode,
    pub peer_safe_label: String,
    pub topic_id: Option<i64>,
    pub created_at_ms: u64,
    pub started_at_ms: Option<u64>,
    pub updated_at_ms: u64,
    pub expected_ack_id: Option<u64>,
    pub metrics: MediaIndexMetricsSnapshot,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal_error: Option<MediaIndexJobError>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_serialization_parity() {
        let event = MediaIndexEvent::Page(MediaIndexPageEvent {
            job_id: 101,
            ack_id: 1,
            mode: MediaIndexMode::HistoricalBackfill,
            rows: vec![],
            candidate_checkpoint: MediaIndexCheckpointCandidate {
                account_id: "session_1".into(),
                peer_id: "-100123".into(),
                scope_kind: "topic".into(),
                topic_id_normalized: 42,
                mode: "backfill".into(),
                pv_committed_offset: 1200,
                doc_committed_offset: 1100,
                pv_committed_exhausted: false,
                doc_committed_exhausted: false,
                backfill_complete: false,
                newest_committed_id: None,
                delta_active: false,
                delta_base_id: 0,
                delta_pv_committed_offset: 0,
                delta_doc_committed_offset: 0,
                delta_pv_committed_exhausted: false,
                delta_doc_committed_exhausted: false,
                delta_complete: false,
            },
            lane_counts: None,
            emitted_watermark: None,
            lane_durability: None,
            has_more: true,
            metrics: MediaIndexMetricsSnapshot::default(),
        });

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"page\""));
        assert!(json.contains("\"jobId\":101"));
        assert!(json.contains("\"ackId\":1"));
        assert!(json.contains("\"mode\":\"historical_backfill\""));
    }

    #[test]
    fn test_ack_serialization_parity() {
        let ack = MediaIndexPageAck {
            job_id: 101,
            ack_id: 1,
            outcome: MediaIndexAckOutcome::Committed,
            committed_state: Some(MediaIndexStateSnapshot {
                schema_version: Some(2),
                account_id: "session_1".into(),
                peer_id: "-100123".into(),
                scope_kind: "topic".into(),
                topic_id_normalized: 42,
                mode: "backfill".into(),
                pv_committed_offset: 1200,
                doc_committed_offset: 1100,
                pv_exhausted: false,
                doc_exhausted: false,
                backfill_complete: false,
                newest_committed_id: 5000,
                delta_active: false,
                delta_base_id: 0,
                delta_pv_committed_offset: 0,
                delta_doc_committed_offset: 0,
                delta_pv_exhausted: false,
                delta_doc_exhausted: false,
                delta_max_observed_id: 0,
            }),
            error_code: None,
        };

        let json = serde_json::to_string(&ack).unwrap();
        assert!(json.contains("\"outcome\":\"committed\""));
        assert!(json.contains("\"schemaVersion\":2"));
    }
}
