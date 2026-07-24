use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use rusqlite::{params, Connection, OptionalExtension};

use super::fingerprint::MediaFingerprint;
use super::jobs_db::resolve_migrator_db;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckResult {
    Skip,
    ReuploadAuto,
    ReuploadGuard,
    UploadNew,
}

pub use super::app_db::ScanCacheEntry;

#[derive(Debug, Clone)]
pub struct DuplicateChecker {
    pub target_entity_id: String,
    pub guardrail_enabled: bool,
    pub guardrail_threshold_days: u32,
}

fn open_db() -> Result<Connection, String> {
    let p = resolve_migrator_db();
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let conn = Connection::open(&p).map_err(|e| format!("Failed to open DB {:?}: {}", p, e))?;
    conn.execute_batch(
        "PRAGMA foreign_keys=ON;
         PRAGMA busy_timeout=60000;
         PRAGMA journal_mode=WAL;"
    ).map_err(|e| format!("dup_checker PRAGMA: {e}"))?;
    ensure_tables(&conn)?;
    Ok(conn)
}

fn ensure_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS duplicate_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_unique_id TEXT NOT NULL,
            target_entity_id TEXT NOT NULL,
            target_message_id INTEGER NOT NULL,
            fingerprint_hash TEXT,
            media_type TEXT,
            target_topic_id INTEGER,
            first_uploaded_at INTEGER,
            UNIQUE(file_unique_id, target_entity_id)
        );
        CREATE INDEX IF NOT EXISTS idx_dup_entity ON duplicate_history(target_entity_id);
        CREATE INDEX IF NOT EXISTS idx_dup_uid ON duplicate_history(file_unique_id, target_entity_id);

        CREATE TABLE IF NOT EXISTS destination_scan_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_entity_id TEXT NOT NULL,
            topic_id INTEGER,
            file_unique_id TEXT,
            file_name TEXT,
            file_size INTEGER,
            media_type TEXT NOT NULL DEFAULT 'unknown',
            fingerprint_tier INTEGER NOT NULL DEFAULT 4,
            fingerprint_hash TEXT,
            width INTEGER, height INTEGER, duration INTEGER, mime_type TEXT,
            message_id INTEGER NOT NULL,
            scanned_at INTEGER NOT NULL,
            verified_at INTEGER,
            is_alive INTEGER NOT NULL DEFAULT 1,
            delete_detected_at INTEGER,
            UNIQUE(target_entity_id, topic_id, message_id)
        );
        CREATE INDEX IF NOT EXISTS idx_scan_fingerprint ON destination_scan_cache(target_entity_id, fingerprint_hash);
        CREATE INDEX IF NOT EXISTS idx_scan_uid ON destination_scan_cache(target_entity_id, file_unique_id);
        CREATE INDEX IF NOT EXISTS idx_scan_name_size ON destination_scan_cache(target_entity_id, file_name, file_size);
        CREATE INDEX IF NOT EXISTS idx_scan_alive ON destination_scan_cache(target_entity_id, is_alive);"
    ).map_err(|e| format!("Failed to init schema: {}", e))?;
    Ok(())
}

fn now_unix() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

impl DuplicateChecker {
    pub fn new(target_entity_id: impl Into<String>, guardrail_enabled: bool, guardrail_threshold_days: u32) -> Self {
        Self {
            target_entity_id: target_entity_id.into(),
            guardrail_enabled,
            guardrail_threshold_days,
        }
    }

    pub fn msgid_key(source_entity_id: &str, source_message_id: i64) -> String {
        format!("msgid:{}:{}", source_entity_id, source_message_id)
    }

    pub fn get_duplicate_message_id(&self, file_unique_id: Option<&str>, file_hash: Option<&str>, file_name: Option<&str>, file_size: Option<i64>) -> Result<Option<i64>, String> {
        let conn = open_db()?;
        
        if let Some(uid) = file_unique_id {
            let mid: Option<i64> = conn.query_row(
                "SELECT target_message_id FROM duplicate_history WHERE file_unique_id=? AND target_entity_id=?",
                params![uid, self.target_entity_id],
                |row| row.get(0)
            ).optional().map_err(|e| format!("DB error: {}", e))?;
            
            if mid.is_some() {
                return Ok(mid);
            }
        }
        
        if let Some(fh) = file_hash {
            let uid = format!("hash:{}", fh);
            let mid: Option<i64> = conn.query_row(
                "SELECT target_message_id FROM duplicate_history WHERE file_unique_id=? AND target_entity_id=?",
                params![uid, self.target_entity_id],
                |row| row.get(0)
            ).optional().map_err(|e| format!("DB error: {}", e))?;
            
            if mid.is_some() {
                return Ok(mid);
            }
        }
        
        if let (Some(fnm), Some(fsz)) = (file_name, file_size) {
            let uid = format!("name:{}|{}", fnm, fsz);
            let mid: Option<i64> = conn.query_row(
                "SELECT target_message_id FROM duplicate_history WHERE file_unique_id=? AND target_entity_id=?",
                params![uid, self.target_entity_id],
                |row| row.get(0)
            ).optional().map_err(|e| format!("DB error: {}", e))?;
            
            if mid.is_some() {
                return Ok(mid);
            }
        }
        
        Ok(None)
    }

    pub fn get_duplicate_message_ids_batch(&self, keys: &[String]) -> Result<HashMap<String, i64>, String> {
        let conn = open_db()?;
        let mut map = HashMap::new();
        
        for chunk in keys.chunks(400) {
            let placeholders = vec!["?"; chunk.len()].join(",");
            let sql = format!("SELECT file_unique_id, target_message_id FROM duplicate_history WHERE target_entity_id=? AND file_unique_id IN ({})", placeholders);
            
            let mut params: Vec<rusqlite::types::ToSqlOutput> = vec![self.target_entity_id.clone().into()];
            for k in chunk {
                params.push(k.clone().into());
            }
            
            let mut stmt = conn.prepare(&sql).map_err(|e| format!("Prepare error: {}", e))?;
            let rows = stmt.query_map(rusqlite::params_from_iter(params), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            }).map_err(|e| format!("Query error: {}", e))?;
            
            for row in rows {
                if let Ok((k, v)) = row {
                    map.insert(k, v);
                }
            }
        }
        
        Ok(map)
    }

    pub fn log_duplicate(
        &self, 
        file_unique_id: &str, 
        target_message_id: i64, 
        file_hash: Option<&str>, 
        file_name: Option<&str>, 
        file_size: Option<i64>, 
        fingerprint_hash: Option<&str>, 
        media_type: Option<&str>, 
        target_topic_id: Option<i64>, 
        first_uploaded_at: Option<i64>
    ) -> Result<(), String> {
        let conn = open_db()?;
        
        let mut uids = vec![file_unique_id.to_string()];
        
        if let Some(fh) = file_hash {
            uids.push(format!("hash:{}", fh));
        }
        if let (Some(fnm), Some(fsz)) = (file_name, file_size) {
            uids.push(format!("name:{}|{}", fnm, fsz));
        }
        if let Some(fph) = fingerprint_hash {
            uids.push(format!("fp:{}", fph));
        }
        
        for uid in uids {
            conn.execute(
                "INSERT OR IGNORE INTO duplicate_history (file_unique_id, target_entity_id, target_message_id) VALUES (?, ?, ?)",
                params![uid, self.target_entity_id, target_message_id]
            ).map_err(|e| format!("Insert error: {}", e))?;
        }
        
        conn.execute(
            "UPDATE duplicate_history SET fingerprint_hash = COALESCE(?, fingerprint_hash), media_type = COALESCE(?, media_type), target_topic_id = COALESCE(?, target_topic_id), first_uploaded_at = COALESCE(?, first_uploaded_at) WHERE target_entity_id=? AND target_message_id=?",
            params![fingerprint_hash, media_type, target_topic_id, first_uploaded_at, self.target_entity_id, target_message_id]
        ).map_err(|e| format!("Update error: {}", e))?;
        
        Ok(())
    }

    pub fn delete_duplicate_by_message_id(&self, target_message_id: i64) -> Result<(), String> {
        let conn = open_db()?;
        conn.execute(
            "DELETE FROM duplicate_history WHERE target_entity_id=? AND target_message_id=?",
            params![self.target_entity_id, target_message_id]
        ).map_err(|e| format!("Delete error: {}", e))?;
        Ok(())
    }

    pub fn purge_deleted_messages(&self, message_ids: &[i64]) -> Result<i64, String> {
        let conn = open_db()?;
        let mut total_deleted = 0;
        
        for chunk in message_ids.chunks(400) {
            let placeholders = vec!["?"; chunk.len()].join(",");
            let sql = format!("DELETE FROM duplicate_history WHERE target_entity_id=? AND target_message_id IN ({})", placeholders);
            
            let mut params: Vec<rusqlite::types::ToSqlOutput> = vec![self.target_entity_id.clone().into()];
            for mid in chunk {
                params.push((*mid).into());
            }
            
            total_deleted += conn.execute(&sql, rusqlite::params_from_iter(params)).map_err(|e| format!("Delete chunk error: {}", e))?;
        }
        
        Ok(total_deleted as i64)
    }

    pub fn upsert_scan_cache(&self, entries: &[ScanCacheEntry]) -> Result<(), String> {
        let mut conn = open_db()?;
        let tx = conn.transaction().map_err(|e| format!("Tx error: {}", e))?;
        
        {
            let mut stmt = tx.prepare(
                "INSERT INTO destination_scan_cache (
                    target_entity_id, topic_id, file_unique_id, file_name, file_size, media_type, fingerprint_tier, fingerprint_hash, width, height, duration, mime_type, message_id, scanned_at, verified_at, is_alive, delete_detected_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(target_entity_id, topic_id, message_id) DO UPDATE SET 
                    fingerprint_hash=excluded.fingerprint_hash, 
                    is_alive=1, 
                    delete_detected_at=NULL"
            ).map_err(|e| format!("Prepare error: {}", e))?;
            
            for entry in entries {
                stmt.execute(params![
                    entry.target_entity_id,
                    entry.topic_id,
                    entry.file_unique_id,
                    entry.file_name,
                    entry.file_size,
                    entry.media_type,
                    entry.fingerprint_tier,
                    entry.fingerprint_hash,
                    entry.width,
                    entry.height,
                    entry.duration,
                    entry.mime_type,
                    entry.message_id,
                    entry.scanned_at,
                    entry.verified_at,
                    entry.is_alive,
                    entry.delete_detected_at
                ]).map_err(|e| format!("Upsert error: {}", e))?;
            }
        }
        
        tx.commit().map_err(|e| format!("Commit error: {}", e))?;
        Ok(())
    }

    pub fn load_scan_cache(&self, topic_id: Option<i64>) -> Result<Vec<ScanCacheEntry>, String> {
        let conn = open_db()?;
        
        let sql = if topic_id.is_some() {
            "SELECT target_entity_id, topic_id, file_unique_id, file_name, file_size, media_type, fingerprint_tier, fingerprint_hash, width, height, duration, mime_type, message_id, scanned_at, verified_at, is_alive, delete_detected_at FROM destination_scan_cache WHERE target_entity_id=? AND is_alive=1 AND (topic_id=? OR topic_id IS NULL)"
        } else {
            "SELECT target_entity_id, topic_id, file_unique_id, file_name, file_size, media_type, fingerprint_tier, fingerprint_hash, width, height, duration, mime_type, message_id, scanned_at, verified_at, is_alive, delete_detected_at FROM destination_scan_cache WHERE target_entity_id=? AND is_alive=1 AND topic_id IS NULL"
        };
        
        let mut stmt = conn.prepare(sql).map_err(|e| format!("Prepare error: {}", e))?;
        
        let rows = if let Some(tid) = topic_id {
            stmt.query_map(params![self.target_entity_id, tid], Self::map_scan_cache_row)
        } else {
            stmt.query_map(params![self.target_entity_id], Self::map_scan_cache_row)
        }.map_err(|e| format!("Query error: {}", e))?;
        
        let mut result = Vec::new();
        for row in rows {
            if let Ok(entry) = row {
                result.push(entry);
            }
        }
        
        Ok(result)
    }

    fn map_scan_cache_row(row: &rusqlite::Row) -> rusqlite::Result<ScanCacheEntry> {
        Ok(ScanCacheEntry {
            target_entity_id: row.get(0)?,
            topic_id: row.get(1)?,
            file_unique_id: row.get(2)?,
            file_name: row.get(3)?,
            file_size: row.get(4)?,
            media_type: row.get(5)?,
            fingerprint_tier: row.get(6)?,
            fingerprint_hash: row.get(7)?,
            width: row.get(8)?,
            height: row.get(9)?,
            duration: row.get(10)?,
            mime_type: row.get(11)?,
            message_id: row.get(12)?,
            scanned_at: row.get(13)?,
            verified_at: row.get(14)?,
            is_alive: row.get(15)?,
            delete_detected_at: row.get(16)?,
        })
    }

    pub fn lookup_scan_cache(&self, fp: &MediaFingerprint) -> Result<Option<(i64, ScanCacheEntry)>, String> {
        let conn = open_db()?;
        
        let mut hashes = Vec::new();
        if let Some(ph) = &fp.primary_hash {
            hashes.push(ph.clone());
        }
        for sh in &fp.secondary_hashes {
            hashes.push(sh.clone());
        }
        
        if !hashes.is_empty() {
            let placeholders = vec!["?"; hashes.len()].join(",");
            let sql = format!("SELECT target_entity_id, topic_id, file_unique_id, file_name, file_size, media_type, fingerprint_tier, fingerprint_hash, width, height, duration, mime_type, message_id, scanned_at, verified_at, is_alive, delete_detected_at FROM destination_scan_cache WHERE target_entity_id=? AND is_alive=1 AND fingerprint_hash IN ({}) LIMIT 1", placeholders);
            
            let mut p_vec: Vec<rusqlite::types::ToSqlOutput> = vec![self.target_entity_id.clone().into()];
            for h in hashes {
                p_vec.push(h.into());
            }
            
            let mut stmt = conn.prepare(&sql).map_err(|e| format!("Prepare error: {}", e))?;
            let mut rows = stmt.query(rusqlite::params_from_iter(p_vec)).map_err(|e| format!("Query error: {}", e))?;
            
            if let Some(row) = rows.next().map_err(|e| format!("Row error: {}", e))? {
                let entry = Self::map_scan_cache_row(row).map_err(|e| format!("Map error: {}", e))?;
                return Ok(Some((entry.message_id, entry)));
            }
        }
        
        if let (Some(fnm), Some(fsz)) = (&fp.file_name, fp.file_size) {
            let mut stmt = conn.prepare("SELECT target_entity_id, topic_id, file_unique_id, file_name, file_size, media_type, fingerprint_tier, fingerprint_hash, width, height, duration, mime_type, message_id, scanned_at, verified_at, is_alive, delete_detected_at FROM destination_scan_cache WHERE target_entity_id=? AND is_alive=1 AND file_name=? AND file_size=? LIMIT 1").map_err(|e| format!("Prepare error: {}", e))?;
            let mut rows = stmt.query(params![self.target_entity_id, fnm, fsz]).map_err(|e| format!("Query error: {}", e))?;
            
            if let Some(row) = rows.next().map_err(|e| format!("Row error: {}", e))? {
                let entry = Self::map_scan_cache_row(row).map_err(|e| format!("Map error: {}", e))?;
                return Ok(Some((entry.message_id, entry)));
            }
        }
        
        Ok(None)
    }

    pub fn mark_dead_in_cache(&self, message_id: i64, deleted_at: i64) -> Result<(), String> {
        let conn = open_db()?;
        conn.execute(
            "UPDATE destination_scan_cache SET is_alive=0, delete_detected_at=? WHERE target_entity_id=? AND message_id=?",
            params![deleted_at, self.target_entity_id, message_id]
        ).map_err(|e| format!("Update error: {}", e))?;
        Ok(())
    }

    pub fn update_verified_at(&self, message_id: i64, verified_at: i64) -> Result<(), String> {
        let conn = open_db()?;
        conn.execute(
            "UPDATE destination_scan_cache SET verified_at=? WHERE target_entity_id=? AND message_id=?",
            params![verified_at, self.target_entity_id, message_id]
        ).map_err(|e| format!("Update error: {}", e))?;
        Ok(())
    }

    pub fn decide_reupload(&self, deleted_at: i64, orig_mid: i64) -> (CheckResult, Option<i64>, String) {
        let now = now_unix();
        let age_days = if now > deleted_at { (now - deleted_at) / 86400 } else { 0 };
        
        if !self.guardrail_enabled || age_days as u32 > self.guardrail_threshold_days {
            (CheckResult::ReuploadAuto, Some(orig_mid), "old_deletion_auto_reupload".to_string())
        } else {
            (CheckResult::ReuploadGuard, Some(orig_mid), "recent_deletion_guardrail".to_string())
        }
    }
}
