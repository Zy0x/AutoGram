//! Audit Trail Event Logger
//! Stores structured job events in `job_events` table for observability and diagnostics.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobEvent {
    pub id: i64,
    pub job_id: i64,
    pub timestamp: i64,
    pub stage: String,
    pub message: String,
    pub metadata: Option<String>,
}

pub fn log_job_event(
    conn: &Connection,
    job_id: i64,
    stage: &str,
    message: &str,
    metadata: Option<&str>,
) -> Result<(), String> {
    let _ = conn.execute(
        "CREATE TABLE IF NOT EXISTS job_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            timestamp INTEGER NOT NULL,
            stage TEXT NOT NULL,
            message TEXT NOT NULL,
            metadata TEXT
        );",
        [],
    );

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO job_events (job_id, timestamp, stage, message, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![job_id, now, stage, message, metadata],
    )
    .map_err(|e| format!("failed to log job event: {e}"))?;

    Ok(())
}

pub fn get_job_events(conn: &Connection, job_id: i64) -> Result<Vec<JobEvent>, String> {
    let _ = conn.execute(
        "CREATE TABLE IF NOT EXISTS job_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            timestamp INTEGER NOT NULL,
            stage TEXT NOT NULL,
            message TEXT NOT NULL,
            metadata TEXT
        );",
        [],
    );

    let mut stmt = conn
        .prepare("SELECT id, job_id, timestamp, stage, message, metadata FROM job_events WHERE job_id = ?1 ORDER BY timestamp ASC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![job_id], |row| {
            Ok(JobEvent {
                id: row.get(0)?,
                job_id: row.get(1)?,
                timestamp: row.get(2)?,
                stage: row.get(3)?,
                message: row.get(4)?,
                metadata: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut events = Vec::new();
    for r in rows {
        if let Ok(ev) = r {
            events.push(ev);
        }
    }

    Ok(events)
}
