//! Rust SQLite access for Statistics — replaces Python worker daemon stats/export-csv.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use super::grammers_ops::resolve_sessions_dir;

fn resolve_migrator_db() -> PathBuf {
    if let Ok(p) = std::env::var("AUTOGRAM_DB_PATH") {
        let pb = PathBuf::from(p);
        if !pb.as_os_str().is_empty() {
            return pb;
        }
    }
    let sessions = resolve_sessions_dir(None);
    if let Some(worker) = sessions.parent() {
        if let Some(app_root) = worker.parent() {
            let p = app_root.join("database").join("telegram_migrator.db");
            if p.exists() {
                return p;
            }
            let p2 = worker.join("database").join("telegram_migrator.db");
            if p2.exists() {
                return p2;
            }
            let dir = app_root.join("database");
            let _ = std::fs::create_dir_all(&dir);
            return dir.join("telegram_migrator.db");
        }
    }
    PathBuf::from("telegram_migrator.db")
}

fn open_db() -> Result<Connection, String> {
    let path = resolve_migrator_db();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let conn = Connection::open(&path).map_err(|e| format!("open stats db: {e}"))?;
    conn.execute_batch(
        "PRAGMA foreign_keys=ON;
         PRAGMA busy_timeout=15000;
         PRAGMA journal_mode=WAL;",
    )
    .map_err(|e| format!("pragma: {e}"))?;
    Ok(conn)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsSummary {
    pub total_jobs: i64,
    pub active_jobs: i64,
    pub completed_executions: i64,
    pub total_processed_messages: i64,
    pub total_ledger_items: i64,
    pub total_bytes_transferred: i64,
}

pub fn get_statistics() -> Result<StatsSummary, String> {
    let conn = open_db()?;

    let total_jobs: i64 = conn
        .query_row("SELECT COUNT(1) FROM jobs", [], |r| r.get(0))
        .unwrap_or(0);

    let active_jobs: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT job_id) FROM executions WHERE status='RUNNING'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let completed_executions: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM executions WHERE status='COMPLETED'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let total_processed_messages: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(processed_messages), 0) FROM executions",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let total_ledger_items: i64 = conn
        .query_row("SELECT COUNT(1) FROM migration_ledger", [], |r| r.get(0))
        .unwrap_or(0);

    let total_bytes_transferred: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(size), 0) FROM migration_ledger WHERE size > 0",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    Ok(StatsSummary {
        total_jobs,
        active_jobs,
        completed_executions,
        total_processed_messages,
        total_ledger_items,
        total_bytes_transferred,
    })
}

pub fn export_stats_csv() -> Result<String, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT job_id, source_msg_id, dest_msg_id, telegram_unique_id, sha256, filename, size, created_at
             FROM migration_ledger ORDER BY created_at DESC LIMIT 5000",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let job_id: i64 = row.get(0)?;
            let src_id: i64 = row.get(1)?;
            let dst_id: Option<i64> = row.get(2)?;
            let tg_uid: Option<String> = row.get(3)?;
            let sha: Option<String> = row.get(4)?;
            let name: Option<String> = row.get(5)?;
            let sz: Option<i64> = row.get(6)?;
            let created: Option<String> = row.get(7)?;

            Ok(format!(
                "{},{},{},\"{}\",\"{}\",\"{}\",{},\"{}\"",
                job_id,
                src_id,
                dst_id.unwrap_or(0),
                tg_uid.unwrap_or_default().replace('"', "\"\""),
                sha.unwrap_or_default(),
                name.unwrap_or_default().replace('"', "\"\""),
                sz.unwrap_or(0),
                created.unwrap_or_default()
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut lines = Vec::new();
    lines.push("job_id,source_msg_id,dest_msg_id,telegram_unique_id,sha256,filename,size,created_at".to_string());
    for r in rows {
        if let Ok(line) = r {
            lines.push(line);
        }
    }
    Ok(lines.join("\n"))
}
