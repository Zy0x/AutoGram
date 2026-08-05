//! Checkpoint Manager Module
//! Handles segment-based encoding checkpoints and byte-offset upload resume checkpoints in SQLite.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobCheckpoint {
    pub id: i64,
    pub job_id: i64,
    pub segment_id: i64,
    pub validated_checkpoint_segment: i64,
    pub byte_offset: u64,
    pub temp_path: Option<String>,
    pub encoder_profile: Option<String>,
    pub segment_hash: Option<String>,
    pub updated_at: i64,
}

pub fn save_checkpoint(conn: &Connection, checkpoint: &JobCheckpoint) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO checkpoints (job_id, segment_id, validated_checkpoint_segment, byte_offset, temp_path, encoder_profile, segment_hash, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            checkpoint.job_id,
            checkpoint.segment_id,
            checkpoint.validated_checkpoint_segment,
            checkpoint.byte_offset as i64,
            checkpoint.temp_path,
            checkpoint.encoder_profile,
            checkpoint.segment_hash,
            now
        ],
    )
    .map_err(|e| format!("save checkpoint failed: {e}"))?;

    Ok(())
}

pub fn load_latest_checkpoint(
    conn: &Connection,
    job_id: i64,
) -> Result<Option<JobCheckpoint>, String> {
    let result = conn
        .query_row(
            "SELECT id, job_id, segment_id, validated_checkpoint_segment, byte_offset, temp_path, encoder_profile, segment_hash, updated_at
             FROM checkpoints
             WHERE job_id = ?1
             ORDER BY updated_at DESC, id DESC
             LIMIT 1",
            params![job_id],
            |row| {
                let byte_offset_i64: i64 = row.get(4)?;
                Ok(JobCheckpoint {
                    id: row.get(0)?,
                    job_id: row.get(1)?,
                    segment_id: row.get(2)?,
                    validated_checkpoint_segment: row.get(3)?,
                    byte_offset: byte_offset_i64.max(0) as u64,
                    temp_path: row.get(5)?,
                    encoder_profile: row.get(6)?,
                    segment_hash: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("load checkpoint query error: {e}"))?;

    Ok(result)
}

pub fn delete_job_checkpoints(conn: &Connection, job_id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM checkpoints WHERE job_id = ?1", params![job_id])
        .map_err(|e| format!("delete checkpoints failed: {e}"))?;
    Ok(())
}
