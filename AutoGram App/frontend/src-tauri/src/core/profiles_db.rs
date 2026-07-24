//! Rust SQLite access for Profiles — replaces Python worker daemon list/save/delete.

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
    let conn = Connection::open(&path).map_err(|e| format!("open profiles db: {e}"))?;
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
        CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            session_file_path TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT 1
        );
        "#,
    )
    .map_err(|e| format!("schema: {e}"))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRow {
    pub id: i64,
    pub name: String,
    pub session_file_path: String,
    pub created_at: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProfileRequest {
    pub id: Option<i64>,
    pub name: String,
    pub session_file_path: String,
    pub is_active: Option<bool>,
}

pub fn list_profiles() -> Result<Vec<ProfileRow>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare("SELECT id, name, session_file_path, created_at, is_active FROM profiles ORDER BY name ASC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let active_int: i32 = row.get(4).unwrap_or(1);
            Ok(ProfileRow {
                id: row.get(0)?,
                name: row.get(1)?,
                session_file_path: row.get(2)?,
                created_at: row.get(3)?,
                is_active: active_int != 0,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for r in rows {
        if let Ok(p) = r {
            result.push(p);
        }
    }
    Ok(result)
}

pub fn save_profile(req: SaveProfileRequest) -> Result<i64, String> {
    let conn = open_db()?;
    let active = if req.is_active.unwrap_or(true) { 1 } else { 0 };
    if let Some(id) = req.id {
        conn.execute(
            "UPDATE profiles SET name=?1, session_file_path=?2, is_active=?3 WHERE id=?4",
            params![req.name, req.session_file_path, active, id],
        )
        .map_err(|e| format!("update profile: {e}"))?;
        Ok(id)
    } else {
        conn.execute(
            "INSERT INTO profiles (name, session_file_path, is_active) VALUES (?1, ?2, ?3)",
            params![req.name, req.session_file_path, active],
        )
        .map_err(|e| format!("insert profile: {e}"))?;
        Ok(conn.last_insert_rowid())
    }
}

pub fn delete_profile(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM profiles WHERE id=?1", params![id])
        .map_err(|e| format!("delete profile: {e}"))?;
    Ok(())
}
