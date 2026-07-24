//! Rust SQLite access for Automations — replaces Python worker daemon list/save/delete.

use rusqlite::{params, Connection};
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
    let conn = Connection::open(&path).map_err(|e| format!("open automations db: {e}"))?;
    conn.execute_batch(
        "PRAGMA foreign_keys=ON;
         PRAGMA busy_timeout=15000;
         PRAGMA journal_mode=WAL;",
    )
    .map_err(|e| format!("pragma: {e}"))?;
    ensure_schema(&conn)?;
    Ok(conn)
}

fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS automations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            schedule_cron TEXT,
            action_type TEXT NOT NULL,
            config_json TEXT NOT NULL,
            status TEXT NOT NULL,
            last_run DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        "#,
    )
    .map_err(|e| format!("schema: {e}"))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRow {
    pub id: i64,
    pub name: String,
    pub schedule_cron: Option<String>,
    pub action_type: String,
    pub config_json: String,
    pub status: String,
    pub last_run: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAutomationRequest {
    pub id: Option<i64>,
    pub name: String,
    pub schedule_cron: Option<String>,
    pub action_type: String,
    pub config_json: String,
    pub status: Option<String>,
}

pub fn list_automations() -> Result<Vec<AutomationRow>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare("SELECT id, name, schedule_cron, action_type, config_json, status, last_run, created_at FROM automations ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(AutomationRow {
                id: row.get(0)?,
                name: row.get(1)?,
                schedule_cron: row.get(2)?,
                action_type: row.get(3)?,
                config_json: row.get(4)?,
                status: row.get(5)?,
                last_run: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for r in rows {
        if let Ok(a) = r {
            result.push(a);
        }
    }
    Ok(result)
}

pub fn save_automation(req: SaveAutomationRequest) -> Result<i64, String> {
    let conn = open_db()?;
    let status = req.status.unwrap_or_else(|| "ACTIVE".into());
    if let Some(id) = req.id {
        conn.execute(
            "UPDATE automations SET name=?1, schedule_cron=?2, action_type=?3, config_json=?4, status=?5 WHERE id=?6",
            params![req.name, req.schedule_cron, req.action_type, req.config_json, status, id],
        )
        .map_err(|e| format!("update automation: {e}"))?;
        Ok(id)
    } else {
        conn.execute(
            "INSERT INTO automations (name, schedule_cron, action_type, config_json, status) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![req.name, req.schedule_cron, req.action_type, req.config_json, status],
        )
        .map_err(|e| format!("insert automation: {e}"))?;
        Ok(conn.last_insert_rowid())
    }
}

pub fn delete_automation(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM automations WHERE id=?1", params![id])
        .map_err(|e| format!("delete automation: {e}"))?;
    Ok(())
}
