//! channel_sync_types.rs — Types & Wire Contracts for Rust Channel Synchronization Subsystem (P2.5)

use serde::{Deserialize, Serialize};
use super::media_mutation::MediaMutation;
use super::telegram_ops::TelegramIdentity;

/// Lifecycle and runtime states of an active ChannelSyncWorker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelSyncStatus {
    Preparing,
    Bootstrapping,
    LiveSynced,
    GapGrace,
    RecoveringDifference,
    WaitingAck,
    WaitingFrontend,
    ReconcileRequired,
    Reconciling,
    Paused,
    Stopped,
    Failed,
}

/// Provenance of the mutations in a batch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelMutationSource {
    Bootstrap,
    Passive,
    Difference,
    DifferenceEmpty,
}

/// Outcome of a getChannelDifference pagination loop.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DifferenceRecoveryOutcome {
    Synced {
        next_short_poll_secs: Option<u32>,
    },
    ReconcileRequired {
        latest_pts: i32,
    },
    TerminalFailed(String),
}

/// Reason triggering a getChannelDifference invocation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DifferenceReason {
    Gap,
    ChannelTooLong,
    ActiveShortPoll,
    ExplicitReconcile,
    Overflow,
}

/// Batch of media mutations delivered to the frontend for atomic IndexedDB commit alongside candidate PTS.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSyncMutationBatchEvent {
    pub sync_id: u64,
    pub batch_id: u64,
    pub account_id: String,
    pub peer_id: String,
    pub previous_pts: i32,
    pub candidate_pts: i32,
    pub source: ChannelMutationSource,
    pub mutations: Vec<MediaMutation>,
    pub is_final: bool,
}

/// Unified typed event stream carried over the Tauri Channel for channel synchronization.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChannelSyncEvent {
    State {
        sync_id: u64,
        state: ChannelSyncStatus,
    },
    Batch(ChannelSyncMutationBatchEvent),
    GapDetected {
        sync_id: u64,
        local_pts: i32,
        incoming_pts: i32,
        pts_count: i32,
    },
    ReconcileRequired {
        sync_id: u64,
        latest_pts: i32,
        reason: String,
    },
    Failed {
        sync_id: u64,
        code: String,
        message: String,
        recoverable: bool,
    },
}

/// Outcome of an IndexedDB atomic mutation + PTS commit transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelSyncAckOutcome {
    Committed,
    Failed,
}

/// Storage ACK sent by the frontend after IndexedDB transaction commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSyncAck {
    pub sync_id: u64,
    pub batch_id: u64,
    pub outcome: ChannelSyncAckOutcome,
    pub committed_pts: Option<i32>,
    pub error_code: Option<String>,
}

/// Result returned from Rust when processing an incoming channel sync ACK.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelSyncAckResult {
    Accepted,
    AlreadyAcked,
    Stale,
    Unexpected,
    SyncTerminal,
}

/// Request to start or attach to a long-running channel sync worker.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartChannelSyncRequest {
    pub client_request_id: String,
    pub identity: TelegramIdentity,
    pub peer_id: String,
    pub initial_pts: Option<i32>,
    pub is_actively_viewed: Option<bool>,
    pub requires_initial_reconcile: Option<bool>,
}

/// Response returned immediately upon channel sync creation or retrieval.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartChannelSyncResponse {
    pub sync_id: u64,
    pub state: ChannelSyncStatus,
    pub reused_existing_sync: bool,
    pub subscriber_id: u64,
    pub generation: u64,
    pub current_pts: i32,
}

/// Response returned when attaching a new primary persistence Channel to an existing sync worker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachChannelSyncResponse {
    pub sync_id: u64,
    pub attached: bool,
    pub subscriber_id: u64,
    pub generation: u64,
    pub state: ChannelSyncStatus,
    pub current_pts: i32,
    pub replayed_batch_id: Option<u64>,
}

/// Response returned when explicitly detaching a Channel from a sync worker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachChannelSyncResponse {
    pub sync_id: u64,
    pub detached: bool,
}

/// Response returned from lifecycle control commands (pause, resume, stop).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSyncControlResponse {
    pub sync_id: u64,
    pub accepted: bool,
    pub state: ChannelSyncStatus,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_channel_sync_event_serialization() {
        let batch = ChannelSyncMutationBatchEvent {
            sync_id: 1,
            batch_id: 10,
            account_id: "sess_1".into(),
            peer_id: "-100123".into(),
            previous_pts: 100,
            candidate_pts: 105,
            source: ChannelMutationSource::Difference,
            mutations: Vec::new(),
            is_final: true,
        };

        let evt = ChannelSyncEvent::Batch(batch);
        let json = serde_json::to_string(&evt).unwrap();
        assert!(json.contains("\"type\":\"batch\""));
        assert!(json.contains("\"candidatePts\":105"));
    }
}
