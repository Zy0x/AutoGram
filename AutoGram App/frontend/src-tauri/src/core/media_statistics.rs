//! media_statistics.rs — Media Statistics Cache & SQLite Engine (Rust)
//!
//! Stores and retrieves media statistics (total count, loaded count, category breakdown)
//! keyed by (account_id, peer_id, topic_id) in SQLite `telegram_migrator.db`.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use super::grammers_ops::resolve_sessions_dir;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaStatisticsResult {
    pub account_id: String,
    pub peer_id: String,
    pub topic_id: Option<i64>,
    pub total_count: usize,
    pub photo_count: usize,
    pub video_count: usize,
    pub file_count: usize,
    pub gif_count: usize,
    pub link_count: usize,
    pub audio_count: usize,
    pub sticker_count: usize,
    pub loaded_count: usize,
    pub total_bytes: u64,
    pub last_sync: u64,
    pub is_exact: Option<bool>,
}

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
         PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS media_statistics (
             account_id TEXT NOT NULL,
             peer_id TEXT NOT NULL,
             topic_id INTEGER NOT NULL DEFAULT 0,
             total_count INTEGER NOT NULL DEFAULT 0,
             photo_count INTEGER NOT NULL DEFAULT 0,
             video_count INTEGER NOT NULL DEFAULT 0,
             file_count INTEGER NOT NULL DEFAULT 0,
             gif_count INTEGER NOT NULL DEFAULT 0,
             link_count INTEGER NOT NULL DEFAULT 0,
             audio_count INTEGER NOT NULL DEFAULT 0,
             sticker_count INTEGER NOT NULL DEFAULT 0,
             loaded_count INTEGER NOT NULL DEFAULT 0,
             total_bytes INTEGER NOT NULL DEFAULT 0,
             last_sync INTEGER NOT NULL DEFAULT 0,
             is_exact INTEGER NOT NULL DEFAULT 0,
             PRIMARY KEY (account_id, peer_id, topic_id)
         );",
    )
    .map_err(|e| format!("init media_statistics table: {e}"))?;
    let _ = conn.execute(
        "ALTER TABLE media_statistics ADD COLUMN is_exact INTEGER NOT NULL DEFAULT 0;",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE media_statistics ADD COLUMN sticker_count INTEGER NOT NULL DEFAULT 0;",
        [],
    );
    Ok(conn)
}

pub fn get_cached_statistics(
    account_id: &str,
    peer_id: &str,
    topic_id: Option<i64>,
) -> Option<MediaStatisticsResult> {
    let conn = open_db().ok()?;
    let tid = topic_id.unwrap_or(0);
    let mut stmt = conn
        .prepare(
            "SELECT total_count, photo_count, video_count, file_count, gif_count, link_count, audio_count, sticker_count, loaded_count, total_bytes, last_sync, is_exact
             FROM media_statistics
             WHERE account_id = ?1 AND peer_id = ?2 AND topic_id = ?3",
        )
        .ok()?;

    let row = stmt
        .query_row(params![account_id, peer_id, tid], |r| {
            let is_exact_val: i64 = r.get(11).unwrap_or(0);
            Ok(MediaStatisticsResult {
                account_id: account_id.to_string(),
                peer_id: peer_id.to_string(),
                topic_id,
                total_count: r.get::<_, i64>(0)? as usize,
                photo_count: r.get::<_, i64>(1)? as usize,
                video_count: r.get::<_, i64>(2)? as usize,
                file_count: r.get::<_, i64>(3)? as usize,
                gif_count: r.get::<_, i64>(4)? as usize,
                link_count: r.get::<_, i64>(5)? as usize,
                audio_count: r.get::<_, i64>(6)? as usize,
                sticker_count: r.get::<_, i64>(7)? as usize,
                loaded_count: r.get::<_, i64>(8)? as usize,
                total_bytes: r.get::<_, i64>(9)? as u64,
                last_sync: r.get::<_, i64>(10)? as u64,
                is_exact: Some(is_exact_val == 1),
            })
        })
        .ok()?;

    Some(row)
}

pub fn save_statistics(stats: &MediaStatisticsResult) -> Result<(), String> {
    let conn = open_db()?;
    let tid = stats.topic_id.unwrap_or(0);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let is_exact_num = if stats.is_exact.unwrap_or(false) {
        1i64
    } else {
        0i64
    };

    conn.execute(
        "INSERT INTO media_statistics (
            account_id, peer_id, topic_id, total_count, photo_count, video_count, file_count, gif_count, link_count, audio_count, sticker_count, loaded_count, total_bytes, last_sync, is_exact
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
         ON CONFLICT(account_id, peer_id, topic_id) DO UPDATE SET
            total_count = excluded.total_count,
            photo_count = excluded.photo_count,
            video_count = excluded.video_count,
            file_count = excluded.file_count,
            gif_count = excluded.gif_count,
            link_count = excluded.link_count,
            audio_count = excluded.audio_count,
            sticker_count = excluded.sticker_count,
            loaded_count = excluded.loaded_count,
            total_bytes = excluded.total_bytes,
            last_sync = excluded.last_sync,
            is_exact = MAX(media_statistics.is_exact, excluded.is_exact);",
        params![
            stats.account_id,
            stats.peer_id,
            tid,
            stats.total_count as i64,
            stats.photo_count as i64,
            stats.video_count as i64,
            stats.file_count as i64,
            stats.gif_count as i64,
            stats.link_count as i64,
            stats.audio_count as i64,
            stats.sticker_count as i64,
            stats.loaded_count as i64,
            stats.total_bytes as i64,
            now as i64,
            is_exact_num,
        ],
    )
    .map_err(|e| format!("save statistics: {e}"))?;

    Ok(())
}

pub fn invalidate_cached_statistics(account_id: &str, peer_id: &str, topic_id: Option<i64>) {
    if let Ok(conn) = open_db() {
        let tid = topic_id.unwrap_or(0);
        let _ = conn.execute(
            "DELETE FROM media_statistics WHERE account_id = ?1 AND peer_id = ?2 AND topic_id = ?3",
            params![account_id, peer_id, tid],
        );
        let _ = conn.execute(
            "DELETE FROM media_statistics WHERE account_id = ?1 AND peer_id = ?2 AND topic_id = 0",
            params![account_id, peer_id],
        );
    }
}
