//! transfer_state.rs — Transfer State Manager & Audit Logging (Rust)
//!
//! Port of Python `transfer_state_manager.py`:
//! Manages full state persistence for transfers in the `transfer_state` SQLite table,
//! including pause/resume capabilities and audit logs in `transfer_audit_log`.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::app_db::{open_db, TransferStateRow};
use super::tg_log;

const BACKEND: &str = "transfer_state";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TransferStateConfig {
    pub target_topic_id: Option<i64>,
    pub transfer_mode: Option<String>,
    pub duplicate_policy: Option<String>,
    pub scan_mode: Option<String>,
    pub guardrail_enabled: Option<bool>,
    pub guardrail_threshold_days: Option<u32>,
    pub topic_scope: Option<String>,
    pub max_reupload_per_hour: Option<u32>,
}

pub struct TransferStateManager {
    pub job_id: String,
    pub source_path: String,
    pub target_entity_id: String,
    pub config: TransferStateConfig,
}

impl TransferStateManager {
    pub fn new(
        job_id: impl Into<String>,
        source_path: impl Into<String>,
        target_entity_id: impl Into<String>,
        config: TransferStateConfig,
    ) -> Self {
        Self {
            job_id: job_id.into(),
            source_path: source_path.into(),
            target_entity_id: target_entity_id.into(),
            config,
        }
    }

    /// Insert initial transfer_state row for a job.
    pub fn create(&self, total_files: i64) -> Result<(), String> {
        let conn = open_db()?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        conn.execute(
            "INSERT OR IGNORE INTO transfer_state (
                job_id, source_path, target_entity_id, status, 
                total_files, processed_files, uploaded_files, failed_files, error_count, 
                created_at, last_activity_at
            ) VALUES (?1, ?2, ?3, 'created', ?4, 0, 0, 0, 0, ?5, ?5)",
            params![
                self.job_id,
                self.source_path,
                self.target_entity_id,
                total_files,
                now,
            ],
        )
        .map_err(|e| format!("create transfer_state: {e}"))?;

        tg_log::info(
            BACKEND,
            "create",
            format!("Created transfer_state for job {}", self.job_id),
        );
        Ok(())
    }

    /// Update status and last_activity_at.
    pub fn update_status(&self, status: &str) -> Result<(), String> {
        let conn = open_db()?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        conn.execute(
            "UPDATE transfer_state SET status=?1, last_activity_at=?2 WHERE job_id=?3",
            params![status, now, self.job_id],
        )
        .map_err(|e| format!("update_status: {e}"))?;
        Ok(())
    }

    /// Save pre-scan index and scan stats as JSON strings.
    pub fn save_scan_complete(&self, scan_index_json: &str) -> Result<(), String> {
        let conn = open_db()?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        conn.execute(
            "UPDATE transfer_state SET scan_index_json=?1, status='pre_scanned', last_activity_at=?2 WHERE job_id=?3",
            params![scan_index_json, now, self.job_id],
        )
        .map_err(|e| format!("save_scan_complete: {e}"))?;
        Ok(())
    }

    /// Save progress counts and queue checkpoints.
    pub fn save_progress(
        &self,
        pending_queue_json: &str,
        completed_items_json: &str,
        processed: i64,
        uploaded: i64,
        failed: i64,
    ) -> Result<(), String> {
        let conn = open_db()?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        conn.execute(
            "UPDATE transfer_state SET 
                pending_queue_json=?1, completed_items_json=?2, 
                processed_files=?3, uploaded_files=?4, failed_files=?5, 
                last_activity_at=?6 
            WHERE job_id=?7",
            params![
                pending_queue_json,
                completed_items_json,
                processed,
                uploaded,
                failed,
                now,
                self.job_id
            ],
        )
        .map_err(|e| format!("save_progress: {e}"))?;
        Ok(())
    }

    /// Load transfer state for resume.
    pub fn load(job_id: &str) -> Result<Option<TransferStateRow>, String> {
        super::app_db::load_transfer_state(job_id)
    }

    /// Record event to transfer_audit_log.
    pub fn log_audit(
        job_id: &str,
        event_type: &str,
        file_path: Option<&str>,
        file_name: Option<&str>,
        fingerprint_hash: Option<&str>,
        message_id: Option<i64>,
        details_json: Option<&str>,
    ) -> Result<(), String> {
        super::app_db::log_transfer_audit(
            job_id,
            event_type,
            file_path,
            file_name,
            fingerprint_hash,
            message_id,
            details_json,
        )
    }
}
