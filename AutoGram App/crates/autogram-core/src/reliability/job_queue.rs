//! SQLite WAL Queue Engine Module

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum JobStatus {
    Queued,
    Analyzing,
    Repairing,
    Planning,
    Remuxing,
    Encoding,
    Splitting,
    Uploading,
    Verifying,
    Paused,
    Failed,
    Completed,
}

impl JobStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobStatus::Queued => "QUEUED",
            JobStatus::Analyzing => "ANALYZING",
            JobStatus::Repairing => "REPAIRING",
            JobStatus::Planning => "PLANNING",
            JobStatus::Remuxing => "REMUXING",
            JobStatus::Encoding => "ENCODING",
            JobStatus::Splitting => "SPLITTING",
            JobStatus::Uploading => "UPLOADING",
            JobStatus::Verifying => "VERIFYING",
            JobStatus::Paused => "PAUSED",
            JobStatus::Failed => "FAILED",
            JobStatus::Completed => "COMPLETED",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "QUEUED" => JobStatus::Queued,
            "ANALYZING" => JobStatus::Analyzing,
            "REPAIRING" => JobStatus::Repairing,
            "PLANNING" => JobStatus::Planning,
            "REMUXING" => JobStatus::Remuxing,
            "ENCODING" => JobStatus::Encoding,
            "SPLITTING" => JobStatus::Splitting,
            "UPLOADING" => JobStatus::Uploading,
            "VERIFYING" => JobStatus::Verifying,
            "PAUSED" => JobStatus::Paused,
            "FAILED" => JobStatus::Failed,
            "COMPLETED" => JobStatus::Completed,
            _ => JobStatus::Queued,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReliableJob {
    pub id: i64,
    pub file_id: String,
    pub filepath: String,
    pub filename: String,
    pub filesize: u64,
    pub status: JobStatus,
    pub stage: String,
    pub progress: f64,
    pub uploaded_bytes: u64,
    pub retry_count: u32,
    pub account_id: Option<String>,
    pub error_class: Option<String>,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn update_job_status(
    conn: &Connection,
    job_id: i64,
    status: JobStatus,
    stage: &str,
    progress: f64,
    uploaded_bytes: u64,
) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    conn.execute(
        "UPDATE jobs SET status = ?1, stage = ?2, progress = ?3, uploaded_bytes = ?4, updated_at = ?5 WHERE id = ?6",
        params![status.as_str(), stage, progress, uploaded_bytes as i64, now, job_id],
    )
    .map_err(|e| format!("update job status failed: {e}"))?;

    Ok(())
}
