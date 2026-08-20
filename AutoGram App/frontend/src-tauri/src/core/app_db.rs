use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

pub fn resolve_app_db() -> Result<PathBuf, String> {
    let mut current = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    loop {
        let worker_db_dir = current.join("worker").join("database");
        if worker_db_dir.exists() {
            return Ok(worker_db_dir.join("telegram_migrator.db"));
        }
        if !current.pop() {
            break;
        }
    }
    // Fallback
    Ok(PathBuf::from("worker/database/telegram_migrator.db"))
}

pub fn open_db() -> Result<Connection, String> {
    let db_path = resolve_app_db()?;

    // Pastikan folder ada
    if let Some(parent) = db_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Gagal membuka koneksi ke database: {}", e))?;

    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 60000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA wal_autocheckpoint = 1000;
        PRAGMA cache_size = -64000;
        PRAGMA mmap_size = 268435456;
        PRAGMA temp_store = MEMORY;
        ",
    )
    .map_err(|e| format!("Gagal set PRAGMA: {}", e))?;

    ensure_schema_extended(&conn)?;

    Ok(conn)
}

pub fn ensure_schema_extended(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        -- 1. duplicate_history
        CREATE TABLE IF NOT EXISTS duplicate_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_unique_id TEXT,
            target_entity_id TEXT NOT NULL,
            target_message_id INTEGER NOT NULL,
            fingerprint_hash TEXT,
            media_type TEXT,
            target_topic_id INTEGER,
            first_uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(file_unique_id, target_entity_id)
        );
        CREATE INDEX IF NOT EXISTS idx_duphist_entity ON duplicate_history(target_entity_id);
        CREATE INDEX IF NOT EXISTS idx_duphist_hash ON duplicate_history(fingerprint_hash);
        CREATE INDEX IF NOT EXISTS idx_duphist_msgid ON duplicate_history(target_message_id);

        -- 2. destination_scan_cache
        CREATE TABLE IF NOT EXISTS destination_scan_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_entity_id TEXT NOT NULL,
            topic_id INTEGER,
            message_id INTEGER NOT NULL,
            fingerprint_hash TEXT,
            file_unique_id TEXT,
            file_name TEXT,
            file_size INTEGER,
            is_alive BOOLEAN DEFAULT 1,
            verified_at INTEGER,
            delete_detected_at INTEGER,
            scanned_at INTEGER NOT NULL,
            UNIQUE(target_entity_id, topic_id, message_id)
        );
        CREATE INDEX IF NOT EXISTS idx_destscan_hash ON destination_scan_cache(fingerprint_hash);
        CREATE INDEX IF NOT EXISTS idx_destscan_file_uid ON destination_scan_cache(file_unique_id);

        -- 3. transfer_state
        CREATE TABLE IF NOT EXISTS transfer_state (
            job_id TEXT PRIMARY KEY,
            source_path TEXT,
            target_entity_id TEXT,
            status TEXT NOT NULL,
            scan_index_json TEXT,
            pending_queue_json TEXT,
            completed_items_json TEXT,
            total_files INTEGER,
            processed_files INTEGER DEFAULT 0,
            uploaded_files INTEGER DEFAULT 0,
            failed_files INTEGER DEFAULT 0,
            error_count INTEGER DEFAULT 0,
            last_error TEXT,
            created_at INTEGER NOT NULL,
            last_activity_at INTEGER NOT NULL
        );

        -- 4. transfer_audit_log
        CREATE TABLE IF NOT EXISTS transfer_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            file_path TEXT,
            file_name TEXT,
            fingerprint_hash TEXT,
            message_id INTEGER,
            details_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_transfer_audit_job ON transfer_audit_log(job_id);

        -- 5. sessions
        CREATE TABLE IF NOT EXISTS sessions (
            name TEXT PRIMARY KEY,
            session_string TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- 6. migration_profiles
        CREATE TABLE IF NOT EXISTS migration_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            config_json TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- 7. automation_jobs
        CREATE TABLE IF NOT EXISTS automation_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            schedule_cron TEXT,
            profile_id INTEGER,
            is_active BOOLEAN DEFAULT 1,
            last_run_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(profile_id) REFERENCES migration_profiles(id)
        );

        -- 8. message_mappings
        CREATE TABLE IF NOT EXISTS message_mappings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_chat_id TEXT NOT NULL,
            source_message_id INTEGER NOT NULL,
            dest_chat_id TEXT NOT NULL,
            dest_message_id INTEGER NOT NULL,
            is_deleted BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(source_chat_id, source_message_id, dest_chat_id)
        );
        CREATE INDEX IF NOT EXISTS idx_msgmap_dest ON message_mappings(dest_chat_id, dest_message_id);

        -- 9. topic_media_items
        CREATE TABLE IF NOT EXISTS topic_media_items (
            account_id TEXT NOT NULL,
            peer_id TEXT NOT NULL,
            topic_id INTEGER NOT NULL DEFAULT 0,
            message_id INTEGER NOT NULL,
            message_date INTEGER NOT NULL,
            edit_date INTEGER,
            grouped_id INTEGER,
            sender_id TEXT,
            caption TEXT,
            media_type TEXT NOT NULL,
            mime_type TEXT,
            file_name TEXT,
            file_size INTEGER NOT NULL DEFAULT 0,
            document_id INTEGER,
            access_hash INTEGER,
            dc_id INTEGER,
            file_reference BLOB,
            width INTEGER,
            height INTEGER,
            duration_ms INTEGER,
            has_server_thumb INTEGER NOT NULL DEFAULT 0,
            has_video_thumb INTEGER NOT NULL DEFAULT 0,
            is_deleted INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (account_id, peer_id, topic_id, message_id)
        );
        CREATE INDEX IF NOT EXISTS idx_topic_media_items_page
        ON topic_media_items (account_id, peer_id, topic_id, message_date DESC, message_id DESC)
        WHERE is_deleted = 0;
        CREATE INDEX IF NOT EXISTS idx_topic_media_items_type
        ON topic_media_items (account_id, peer_id, topic_id, media_type, message_date DESC, message_id DESC)
        WHERE is_deleted = 0;
        CREATE INDEX IF NOT EXISTS idx_topic_media_items_document
        ON topic_media_items (account_id, dc_id, document_id)
        WHERE document_id IS NOT NULL;

        -- 10. topic_media_thumbnails
        CREATE TABLE IF NOT EXISTS topic_media_thumbnails (
            account_id TEXT NOT NULL,
            peer_id TEXT NOT NULL,
            topic_id INTEGER NOT NULL DEFAULT 0,
            message_id INTEGER NOT NULL,
            variant TEXT NOT NULL,
            source TEXT NOT NULL,
            status TEXT NOT NULL,
            width INTEGER,
            height INTEGER,
            local_path TEXT,
            byte_size INTEGER NOT NULL DEFAULT 0,
            source_bytes_used INTEGER NOT NULL DEFAULT 0,
            source_fingerprint TEXT,
            extractor_version INTEGER NOT NULL DEFAULT 1,
            failure_code TEXT,
            generated_at INTEGER,
            last_accessed_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (account_id, peer_id, topic_id, message_id, variant),
            FOREIGN KEY (account_id, peer_id, topic_id, message_id)
            REFERENCES topic_media_items (account_id, peer_id, topic_id, message_id)
            ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_topic_media_thumbnails_lru
        ON topic_media_thumbnails (account_id, last_accessed_at ASC);

        -- 11. topic_media_sync_state
        CREATE TABLE IF NOT EXISTS topic_media_sync_state (
            account_id TEXT NOT NULL,
            peer_id TEXT NOT NULL,
            topic_id INTEGER NOT NULL DEFAULT 0,
            filter_key TEXT NOT NULL,
            newest_message_id INTEGER,
            oldest_message_id INTEGER,
            last_reconciled_at INTEGER,
            cache_version INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (account_id, peer_id, topic_id, filter_key)
        );

        -- 12. topic_media_downloads
        CREATE TABLE IF NOT EXISTS topic_media_downloads (
            account_id TEXT NOT NULL,
            peer_id TEXT NOT NULL,
            topic_id INTEGER NOT NULL DEFAULT 0,
            message_id INTEGER NOT NULL,
            status TEXT NOT NULL,
            priority INTEGER NOT NULL,
            total_size INTEGER NOT NULL DEFAULT 0,
            downloaded_size INTEGER NOT NULL DEFAULT 0,
            temp_path TEXT,
            final_path TEXT,
            range_map_path TEXT,
            error_code TEXT,
            retry_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (account_id, peer_id, topic_id, message_id)
        );

        -- 13. media_scan_state (AutoGram v2.7.0)
        CREATE TABLE IF NOT EXISTS media_scan_state (
            account_id TEXT NOT NULL,
            peer_id TEXT NOT NULL,
            topic_id INTEGER NOT NULL DEFAULT 0,
            media_filter TEXT NOT NULL DEFAULT 'all',
            search_query TEXT NOT NULL DEFAULT '',

            scan_generation INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'idle',

            server_total_count INTEGER,
            server_count_exact INTEGER NOT NULL DEFAULT 0,

            indexed_unique_count INTEGER NOT NULL DEFAULT 0,
            raw_fetched_count INTEGER NOT NULL DEFAULT 0,
            duplicate_count INTEGER NOT NULL DEFAULT 0,

            indexed_bytes INTEGER NOT NULL DEFAULT 0,
            known_size_count INTEGER NOT NULL DEFAULT 0,
            unknown_size_count INTEGER NOT NULL DEFAULT 0,

            next_offset_id INTEGER,
            last_successful_offset_id INTEGER,

            failed_page_count INTEGER NOT NULL DEFAULT 0,
            pending_page_count INTEGER NOT NULL DEFAULT 0,

            last_success_at INTEGER,
            last_attempt_at INTEGER,
            retry_after_at INTEGER,
            completion_verified_at INTEGER,

            last_error_class TEXT,
            last_error_message TEXT,

            PRIMARY KEY (account_id, peer_id, topic_id, media_filter, search_query)
        );
        "
    ).map_err(|e| format!("Gagal memastikan skema database (ensure_schema_extended): {}", e))?;

    Ok(())
}

// -----------------------------------------------------------------------------
// DUPLICATE HISTORY
// -----------------------------------------------------------------------------

pub fn log_duplicate(
    file_unique_id: &str,
    target_entity_id: &str,
    target_message_id: i64,
) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "INSERT OR IGNORE INTO duplicate_history (file_unique_id, target_entity_id, target_message_id) 
         VALUES (?1, ?2, ?3)",
        params![file_unique_id, target_entity_id, target_message_id],
    ).map_err(|e| format!("Gagal log_duplicate: {}", e))?;
    Ok(())
}

pub fn log_duplicates_batch(rows: &[(String, String, i64)]) -> Result<(), String> {
    let mut conn = open_db()?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Gagal mulai transaksi: {}", e))?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR IGNORE INTO duplicate_history (file_unique_id, target_entity_id, target_message_id) 
             VALUES (?1, ?2, ?3)"
        ).map_err(|e| format!("Gagal prepare statement: {}", e))?;

        for (fuid, teid, mid) in rows {
            stmt.execute(params![fuid, teid, mid])
                .map_err(|e| format!("Gagal execute batch log_duplicate: {}", e))?;
        }
    }
    tx.commit()
        .map_err(|e| format!("Gagal commit log_duplicates_batch: {}", e))?;
    Ok(())
}

pub fn get_duplicate_message_id(
    target_entity_id: &str,
    file_unique_id: Option<&str>,
    file_hash: Option<&str>,
    file_name: Option<&str>,
    file_size: Option<i64>,
) -> Result<Option<i64>, String> {
    let conn = open_db()?;

    if let Some(fuid) = file_unique_id {
        let msg_id: Option<i64> = conn.query_row(
            "SELECT target_message_id FROM duplicate_history WHERE target_entity_id = ?1 AND file_unique_id = ?2",
            params![target_entity_id, fuid],
            |row| row.get(0)
        ).optional().map_err(|e| format!("Gagal get_duplicate_message_id (fuid): {}", e))?;
        if msg_id.is_some() {
            return Ok(msg_id);
        }
    }

    if let Some(hash) = file_hash {
        let msg_id: Option<i64> = conn.query_row(
            "SELECT target_message_id FROM duplicate_history WHERE target_entity_id = ?1 AND fingerprint_hash = ?2",
            params![target_entity_id, hash],
            |row| row.get(0)
        ).optional().map_err(|e| format!("Gagal get_duplicate_message_id (hash): {}", e))?;
        if msg_id.is_some() {
            return Ok(msg_id);
        }
    }

    // destination_scan_cache fallback for name + size
    if let (Some(name), Some(size)) = (file_name, file_size) {
        let msg_id: Option<i64> = conn.query_row(
            "SELECT message_id FROM destination_scan_cache WHERE target_entity_id = ?1 AND file_name = ?2 AND file_size = ?3 AND is_alive = 1",
            params![target_entity_id, name, size],
            |row| row.get(0)
        ).optional().map_err(|e| format!("Gagal get_duplicate_message_id (name+size): {}", e))?;
        if msg_id.is_some() {
            return Ok(msg_id);
        }
    }

    Ok(None)
}

pub fn get_duplicate_message_ids_batch(
    target_entity_id: &str,
    keys: &[String],
) -> Result<HashMap<String, i64>, String> {
    let conn = open_db()?;
    let mut results = HashMap::new();
    let chunk_size = 400;

    for chunk in keys.chunks(chunk_size) {
        let placeholders: Vec<String> = (0..chunk.len()).map(|_| "?".to_string()).collect();
        let sql = format!(
            "SELECT file_unique_id, target_message_id FROM duplicate_history WHERE target_entity_id = ? AND file_unique_id IN ({})",
            placeholders.join(", ")
        );

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Gagal prepare get_duplicate_message_ids_batch: {}", e))?;

        let mut p = vec![&target_entity_id as &dyn rusqlite::ToSql];
        for k in chunk {
            p.push(k as &dyn rusqlite::ToSql);
        }

        let mut rows = stmt
            .query(&*p)
            .map_err(|e| format!("Gagal query get_duplicate_message_ids_batch: {}", e))?;
        while let Some(row) = rows
            .next()
            .map_err(|e| format!("Gagal next row get_duplicate_message_ids_batch: {}", e))?
        {
            let file_uid: String = row.get(0).unwrap_or_default();
            let msg_id: i64 = row.get(1).unwrap_or_default();
            if !file_uid.is_empty() {
                results.insert(file_uid, msg_id);
            }
        }
    }

    Ok(results)
}

pub fn delete_duplicate_by_message_id(
    target_entity_id: &str,
    target_message_id: i64,
) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "DELETE FROM duplicate_history WHERE target_entity_id = ?1 AND target_message_id = ?2",
        params![target_entity_id, target_message_id],
    )
    .map_err(|e| format!("Gagal delete_duplicate_by_message_id: {}", e))?;
    Ok(())
}

pub fn purge_deleted_duplicates_batch(
    target_entity_id: &str,
    message_ids: &[i64],
) -> Result<i64, String> {
    let mut conn = open_db()?;
    let mut total_purged = 0;
    let chunk_size = 400;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Gagal mulai transaksi purge: {}", e))?;

    for chunk in message_ids.chunks(chunk_size) {
        let placeholders: Vec<String> = (0..chunk.len()).map(|_| "?".to_string()).collect();
        let sql = format!(
            "DELETE FROM duplicate_history WHERE target_entity_id = ? AND target_message_id IN ({})",
            placeholders.join(", ")
        );

        let mut p = vec![&target_entity_id as &dyn rusqlite::ToSql];
        for id in chunk {
            p.push(id as &dyn rusqlite::ToSql);
        }

        let purged = tx
            .execute(&sql, &*p)
            .map_err(|e| format!("Gagal execute purge chunk: {}", e))?;
        total_purged += purged as i64;
    }

    tx.commit()
        .map_err(|e| format!("Gagal commit purge: {}", e))?;
    Ok(total_purged)
}

pub fn clear_duplicate_history_for_target(target_entity_id: &str) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "DELETE FROM duplicate_history WHERE target_entity_id = ?1",
        params![target_entity_id],
    )
    .map_err(|e| format!("Gagal clear_duplicate_history_for_target: {}", e))?;
    Ok(())
}

// -----------------------------------------------------------------------------
// DESTINATION SCAN CACHE
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanCacheEntry {
    pub target_entity_id: String,
    pub topic_id: Option<i64>,
    pub message_id: i64,
    pub fingerprint_hash: Option<String>,
    pub file_unique_id: Option<String>,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    pub media_type: String,
    pub fingerprint_tier: u8,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub duration: Option<i32>,
    pub mime_type: Option<String>,
    pub is_alive: bool,
    pub verified_at: Option<i64>,
    pub delete_detected_at: Option<i64>,
    pub scanned_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanCacheInsert {
    pub target_entity_id: String,
    pub topic_id: Option<i64>,
    pub message_id: i64,
    pub fingerprint_hash: Option<String>,
    pub file_unique_id: Option<String>,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    pub media_type: String,
    pub fingerprint_tier: u8,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub duration: Option<i32>,
    pub mime_type: Option<String>,
    pub is_alive: bool,
    pub verified_at: Option<i64>,
    pub delete_detected_at: Option<i64>,
    pub scanned_at: i64,
}

pub fn upsert_scan_cache(entries: &[ScanCacheInsert]) -> Result<(), String> {
    let mut conn = open_db()?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Gagal mulai tx upsert scan cache: {}", e))?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO destination_scan_cache (
                target_entity_id, topic_id, message_id, fingerprint_hash, 
                file_unique_id, file_name, file_size, media_type, fingerprint_tier,
                width, height, duration, mime_type, is_alive, 
                verified_at, delete_detected_at, scanned_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
            ON CONFLICT(target_entity_id, topic_id, message_id) DO UPDATE SET
                fingerprint_hash = excluded.fingerprint_hash,
                file_unique_id = excluded.file_unique_id,
                file_name = excluded.file_name,
                file_size = excluded.file_size,
                media_type = excluded.media_type,
                fingerprint_tier = excluded.fingerprint_tier,
                width = excluded.width,
                height = excluded.height,
                duration = excluded.duration,
                mime_type = excluded.mime_type,
                is_alive = excluded.is_alive,
                verified_at = excluded.verified_at,
                delete_detected_at = excluded.delete_detected_at,
                scanned_at = excluded.scanned_at",
            )
            .map_err(|e| format!("Gagal prepare upsert scan cache: {}", e))?;

        for e in entries {
            stmt.execute(params![
                e.target_entity_id,
                e.topic_id,
                e.message_id,
                e.fingerprint_hash,
                e.file_unique_id,
                e.file_name,
                e.file_size,
                e.media_type,
                e.fingerprint_tier,
                e.width,
                e.height,
                e.duration,
                e.mime_type,
                e.is_alive,
                e.verified_at,
                e.delete_detected_at,
                e.scanned_at
            ])
            .map_err(|err| format!("Gagal execute upsert scan cache: {}", err))?;
        }
    }
    tx.commit()
        .map_err(|e| format!("Gagal commit upsert scan cache: {}", e))?;
    Ok(())
}

pub fn load_scan_cache(
    target_entity_id: &str,
    topic_id: Option<i64>,
) -> Result<Vec<ScanCacheEntry>, String> {
    let conn = open_db()?;
    let mut entries = Vec::new();

    let sql = if topic_id.is_some() {
        "SELECT target_entity_id, topic_id, message_id, fingerprint_hash, file_unique_id, file_name, file_size, \
                media_type, fingerprint_tier, width, height, duration, mime_type, is_alive, verified_at, delete_detected_at, scanned_at \
         FROM destination_scan_cache WHERE target_entity_id = ?1 AND topic_id = ?2 AND is_alive = 1"
    } else {
        "SELECT target_entity_id, topic_id, message_id, fingerprint_hash, file_unique_id, file_name, file_size, \
                media_type, fingerprint_tier, width, height, duration, mime_type, is_alive, verified_at, delete_detected_at, scanned_at \
         FROM destination_scan_cache WHERE target_entity_id = ?1 AND topic_id IS NULL AND is_alive = 1"
    };

    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("Gagal prepare load_scan_cache: {}", e))?;

    let mut rows = if let Some(tid) = topic_id {
        stmt.query(params![target_entity_id, tid])
    } else {
        stmt.query(params![target_entity_id])
    }
    .map_err(|e| format!("Gagal execute load_scan_cache: {}", e))?;

    while let Some(row) = rows
        .next()
        .map_err(|e| format!("Gagal next row load_scan_cache: {}", e))?
    {
        entries.push(ScanCacheEntry {
            target_entity_id: row.get(0).unwrap_or_default(),
            topic_id: row.get(1).unwrap_or_default(),
            message_id: row.get(2).unwrap_or_default(),
            fingerprint_hash: row.get(3).unwrap_or_default(),
            file_unique_id: row.get(4).unwrap_or_default(),
            file_name: row.get(5).unwrap_or_default(),
            file_size: row.get(6).unwrap_or_default(),
            media_type: row.get(7).unwrap_or_else(|_| "unknown".into()),
            fingerprint_tier: row.get(8).unwrap_or(4),
            width: row.get(9).unwrap_or_default(),
            height: row.get(10).unwrap_or_default(),
            duration: row.get(11).unwrap_or_default(),
            mime_type: row.get(12).unwrap_or_default(),
            is_alive: row.get(13).unwrap_or_default(),
            verified_at: row.get(14).unwrap_or_default(),
            delete_detected_at: row.get(15).unwrap_or_default(),
            scanned_at: row.get(16).unwrap_or_default(),
        });
    }

    Ok(entries)
}

pub fn mark_dead_in_scan_cache(
    target_entity_id: &str,
    message_id: i64,
    deleted_at: i64,
) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE destination_scan_cache SET is_alive = 0, delete_detected_at = ?3 WHERE target_entity_id = ?1 AND message_id = ?2",
        params![target_entity_id, message_id, deleted_at],
    ).map_err(|e| format!("Gagal mark_dead_in_scan_cache: {}", e))?;
    Ok(())
}

pub fn update_scan_cache_verified_at(
    target_entity_id: &str,
    message_id: i64,
    verified_at: i64,
) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE destination_scan_cache SET verified_at = ?3 WHERE target_entity_id = ?1 AND message_id = ?2",
        params![target_entity_id, message_id, verified_at],
    ).map_err(|e| format!("Gagal update_scan_cache_verified_at: {}", e))?;
    Ok(())
}

// -----------------------------------------------------------------------------
// SESSIONS
// -----------------------------------------------------------------------------

pub fn save_session(name: &str, session_string: &str, status: &str) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "INSERT INTO sessions (name, session_string, status) VALUES (?1, ?2, ?3)
         ON CONFLICT(name) DO UPDATE SET session_string = excluded.session_string, status = excluded.status",
        params![name, session_string, status],
    ).map_err(|e| format!("Gagal save_session: {}", e))?;
    Ok(())
}

pub fn get_session(name: &str) -> Result<Option<(String, String)>, String> {
    let conn = open_db()?;
    let res = conn
        .query_row(
            "SELECT session_string, status FROM sessions WHERE name = ?1",
            params![name],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| format!("Gagal get_session: {}", e))?;
    Ok(res)
}

pub fn delete_session(name: &str) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM sessions WHERE name = ?1", params![name])
        .map_err(|e| format!("Gagal delete_session: {}", e))?;
    Ok(())
}

// -----------------------------------------------------------------------------
// TRANSFER STATE & AUDIT
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferStateRow {
    pub job_id: String,
    pub status: String,
    pub scan_index_json: Option<String>,
    pub pending_queue_json: Option<String>,
    pub completed_items_json: Option<String>,
    pub total_files: Option<i64>,
    pub processed_files: Option<i64>,
    pub error_count: i64,
    pub last_error: Option<String>,
    pub created_at: i64,
    pub last_activity_at: i64,
}

pub fn create_transfer_state(
    job_id: &str,
    source_path: &str,
    target_entity_id: &str,
    total_files: i64,
) -> Result<(), String> {
    let conn = open_db()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    conn.execute(
        "INSERT INTO transfer_state (job_id, source_path, target_entity_id, status, total_files, created_at, last_activity_at) 
         VALUES (?1, ?2, ?3, 'scanning', ?4, ?5, ?5)",
        params![job_id, source_path, target_entity_id, total_files, now],
    ).map_err(|e| format!("Gagal create_transfer_state: {}", e))?;
    Ok(())
}

pub fn update_transfer_status(job_id: &str, status: &str) -> Result<(), String> {
    let conn = open_db()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    conn.execute(
        "UPDATE transfer_state SET status = ?2, last_activity_at = ?3 WHERE job_id = ?1",
        params![job_id, status, now],
    )
    .map_err(|e| format!("Gagal update_transfer_status: {}", e))?;
    Ok(())
}

pub fn save_transfer_progress(
    job_id: &str,
    pending_json: &str,
    completed_json: &str,
    processed: i64,
    uploaded: i64,
    failed: i64,
) -> Result<(), String> {
    let conn = open_db()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    conn.execute(
        "UPDATE transfer_state SET 
         pending_queue_json = ?2, 
         completed_items_json = ?3, 
         processed_files = ?4, 
         uploaded_files = ?5, 
         failed_files = ?6,
         last_activity_at = ?7 
         WHERE job_id = ?1",
        params![
            job_id,
            pending_json,
            completed_json,
            processed,
            uploaded,
            failed,
            now
        ],
    )
    .map_err(|e| format!("Gagal save_transfer_progress: {}", e))?;
    Ok(())
}

pub fn load_transfer_state(job_id: &str) -> Result<Option<TransferStateRow>, String> {
    let conn = open_db()?;
    let res = conn.query_row(
        "SELECT job_id, status, scan_index_json, pending_queue_json, completed_items_json, total_files, processed_files, error_count, last_error, created_at, last_activity_at 
         FROM transfer_state WHERE job_id = ?1",
        params![job_id],
        |row| {
            Ok(TransferStateRow {
                job_id: row.get(0)?,
                status: row.get(1)?,
                scan_index_json: row.get(2)?,
                pending_queue_json: row.get(3)?,
                completed_items_json: row.get(4)?,
                total_files: row.get(5)?,
                processed_files: row.get(6)?,
                error_count: row.get(7)?,
                last_error: row.get(8)?,
                created_at: row.get(9)?,
                last_activity_at: row.get(10)?,
            })
        }
    ).optional().map_err(|e| format!("Gagal load_transfer_state: {}", e))?;
    Ok(res)
}

pub fn log_transfer_audit(
    job_id: &str,
    event_type: &str,
    file_path: Option<&str>,
    file_name: Option<&str>,
    fingerprint_hash: Option<&str>,
    message_id: Option<i64>,
    details_json: Option<&str>,
) -> Result<(), String> {
    let conn = open_db()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    conn.execute(
        "INSERT INTO transfer_audit_log (job_id, timestamp, event_type, file_path, file_name, fingerprint_hash, message_id, details_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![job_id, now, event_type, file_path, file_name, fingerprint_hash, message_id, details_json],
    ).map_err(|e| format!("Gagal log_transfer_audit: {}", e))?;
    Ok(())
}
