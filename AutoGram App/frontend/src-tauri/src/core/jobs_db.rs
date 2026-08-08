//! Local Jobs SQLite access (Rust) — replaces daemon list/create/edit/delete for UI.
//! Uses the same `database/telegram_migrator.db` as the legacy worker.

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::grammers_ops::resolve_sessions_dir;
use super::tg_log;

const BACKEND: &str = "jobs_db";

pub fn resolve_migrator_db() -> PathBuf {
    if let Ok(p) = std::env::var("AUTOGRAM_DB_PATH") {
        let pb = PathBuf::from(p);
        if !pb.as_os_str().is_empty() {
            return pb;
        }
    }
    // Prefer AutoGram App/database/telegram_migrator.db relative to sessions/worker
    let sessions = resolve_sessions_dir(None);
    // sessions → worker/sessions → worker → AutoGram App
    if let Some(worker) = sessions.parent() {
        if let Some(app_root) = worker.parent() {
            let p = app_root.join("database").join("telegram_migrator.db");
            if p.exists() {
                return p;
            }
            // Also worker/database
            let p2 = worker.join("database").join("telegram_migrator.db");
            if p2.exists() {
                return p2;
            }
            // Create under App database/
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
    let conn = Connection::open(&path).map_err(|e| format!("open jobs db: {e}"))?;
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
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            profile_name TEXT,
            source_entity_id TEXT,
            target_entity_id TEXT,
            transfer_mode TEXT,
            config_json TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS executions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            snapshot_config_json TEXT,
            status TEXT DEFAULT 'STARTING',
            processed_messages INTEGER DEFAULT 0,
            total_messages INTEGER DEFAULT 0,
            last_processed_id INTEGER DEFAULT 0,
            started_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS migration_ledger (
            job_id INTEGER NOT NULL,
            source_msg_id INTEGER NOT NULL,
            dest_msg_id INTEGER,
            telegram_unique_id TEXT,
            sha256 TEXT,
            filename TEXT,
            size INTEGER,
            created_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (job_id, source_msg_id)
        );
        CREATE INDEX IF NOT EXISTS idx_ledger_sha ON migration_ledger(job_id, sha256);
        CREATE INDEX IF NOT EXISTS idx_ledger_name_size ON migration_ledger(job_id, filename, size);
        CREATE INDEX IF NOT EXISTS idx_ledger_tg_uid ON migration_ledger(job_id, telegram_unique_id);

        CREATE TABLE IF NOT EXISTS job_dependencies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_job_id INTEGER NOT NULL,
            child_job_id INTEGER NOT NULL,
            dependency_type TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(parent_job_id) REFERENCES jobs(id) ON DELETE CASCADE,
            FOREIGN KEY(child_job_id) REFERENCES jobs(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS checkpoints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            segment_id INTEGER DEFAULT 0,
            validated_checkpoint_segment INTEGER DEFAULT 0,
            byte_offset INTEGER DEFAULT 0,
            temp_path TEXT,
            encoder_profile TEXT,
            segment_hash TEXT,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS job_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            timestamp INTEGER NOT NULL,
            stage TEXT NOT NULL,
            message TEXT NOT NULL,
            metadata TEXT,
            FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        "#,
    )
    .map_err(|e| format!("schema: {e}"))?;
    conn.execute_batch(include_str!(
        "../../../../database/migrations/015_transfer_control_plane_v4.sql"
    ))
    .map_err(|e| format!("transfer control schema: {e}"))?;
    Ok(())
}

/// 4-level dedupe probe for Clean Copy.
#[derive(Debug, Clone, Default)]
pub struct LedgerHit {
    pub by_source_msg: bool,
    pub by_telegram_unique: bool,
    pub by_sha256: bool,
    pub by_name_size: bool,
}

impl LedgerHit {
    pub fn is_duplicate(&self) -> bool {
        self.by_source_msg || self.by_telegram_unique || self.by_sha256 || self.by_name_size
    }
}

pub fn ledger_check(
    job_id: i64,
    source_msg_id: i64,
    telegram_unique_id: Option<&str>,
    sha256: Option<&str>,
    filename: Option<&str>,
    size: Option<i64>,
) -> Result<LedgerHit, String> {
    let conn = open_db()?;
    let mut hit = LedgerHit::default();
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM migration_ledger WHERE job_id=?1 AND source_msg_id=?2",
            params![job_id, source_msg_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    hit.by_source_msg = exists > 0;
    if let Some(uid) = telegram_unique_id.filter(|s| !s.is_empty()) {
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM migration_ledger WHERE job_id=?1 AND telegram_unique_id=?2",
                params![job_id, uid],
                |r| r.get(0),
            )
            .unwrap_or(0);
        hit.by_telegram_unique = n > 0;
    }
    if let Some(h) = sha256.filter(|s| !s.is_empty()) {
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM migration_ledger WHERE job_id=?1 AND sha256=?2",
                params![job_id, h],
                |r| r.get(0),
            )
            .unwrap_or(0);
        hit.by_sha256 = n > 0;
    }
    if let (Some(name), Some(sz)) = (filename.filter(|s| !s.is_empty()), size) {
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM migration_ledger WHERE job_id=?1 AND filename=?2 AND size=?3",
                params![job_id, name, sz],
                |r| r.get(0),
            )
            .unwrap_or(0);
        hit.by_name_size = n > 0;
    }
    Ok(hit)
}

pub fn ledger_insert(
    job_id: i64,
    source_msg_id: i64,
    dest_msg_id: Option<i64>,
    telegram_unique_id: Option<&str>,
    sha256: Option<&str>,
    filename: Option<&str>,
    size: Option<i64>,
) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "INSERT OR REPLACE INTO migration_ledger
         (job_id, source_msg_id, dest_msg_id, telegram_unique_id, sha256, filename, size)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            job_id,
            source_msg_id,
            dest_msg_id,
            telegram_unique_id,
            sha256,
            filename,
            size
        ],
    )
    .map_err(|e| format!("ledger insert: {e}"))?;
    Ok(())
}

/// Last successful source message id for resume (any past execution of this job).
pub fn last_resumable_msg_id(job_id: i64) -> Result<Option<i64>, String> {
    let conn = open_db()?;
    let id: Option<i64> = conn
        .query_row(
            "SELECT last_processed_id FROM executions
             WHERE job_id=?1 AND last_processed_id IS NOT NULL AND last_processed_id > 0
             ORDER BY started_at DESC LIMIT 1",
            params![job_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(id.filter(|v| *v > 0))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRow {
    pub id: i64,
    pub job_name: Option<String>,
    pub profile_name: Option<String>,
    pub source_entity_id: Option<String>,
    pub target_entity_id: Option<String>,
    pub transfer_mode: Option<String>,
    pub config_json: Option<String>,
    pub created_at: Option<String>,
    pub status: Option<String>,
    pub processed_messages: Option<i64>,
    pub total_messages: Option<i64>,
    pub last_processed_id: Option<i64>,
    pub last_execution_id: Option<i64>,
}

pub fn list_jobs() -> Result<Vec<JobRow>, String> {
    let conn = open_db()?;
    // Prefer window-function query; fall back to simple SELECT
    let sql_modern = r#"
        SELECT 
            j.id, j.name as job_name, j.profile_name, j.source_entity_id, 
            j.target_entity_id, j.transfer_mode, j.config_json, j.created_at,
            e.status, e.processed_messages, e.total_messages, 
            e.last_processed_id, e.id as last_execution_id
        FROM jobs j
        LEFT JOIN (
            SELECT job_id, status, processed_messages, total_messages, last_processed_id, id,
                   ROW_NUMBER() OVER(PARTITION BY job_id ORDER BY started_at DESC) as rn
            FROM executions
        ) e ON j.id = e.job_id AND e.rn = 1
        ORDER BY j.created_at DESC
    "#;
    let mut stmt = match conn.prepare(sql_modern) {
        Ok(s) => s,
        Err(_) => {
            // Older SQLite without window functions
            let mut rows = Vec::new();
            let mut s = conn
                .prepare(
                    "SELECT id, name, profile_name, source_entity_id, target_entity_id,
                            transfer_mode, config_json, created_at
                     FROM jobs ORDER BY created_at DESC",
                )
                .map_err(|e| e.to_string())?;
            let mapped = s
                .query_map([], |r| {
                    Ok(JobRow {
                        id: r.get(0)?,
                        job_name: r.get(1)?,
                        profile_name: r.get(2)?,
                        source_entity_id: r.get(3)?,
                        target_entity_id: r.get(4)?,
                        transfer_mode: r.get(5)?,
                        config_json: r.get(6)?,
                        created_at: r.get(7)?,
                        status: None,
                        processed_messages: None,
                        total_messages: None,
                        last_processed_id: None,
                        last_execution_id: None,
                    })
                })
                .map_err(|e| e.to_string())?;
            for row in mapped {
                rows.push(row.map_err(|e| e.to_string())?);
            }
            tg_log::info(BACKEND, "list_jobs", format!("n={} (legacy)", rows.len()));
            return Ok(rows);
        }
    };
    let mapped = stmt
        .query_map([], |r| {
            Ok(JobRow {
                id: r.get(0)?,
                job_name: r.get(1)?,
                profile_name: r.get(2)?,
                source_entity_id: r.get(3)?,
                target_entity_id: r.get(4)?,
                transfer_mode: r.get(5)?,
                config_json: r.get(6)?,
                created_at: r.get(7)?,
                status: r.get(8)?,
                processed_messages: r.get(9)?,
                total_messages: r.get(10)?,
                last_processed_id: r.get(11)?,
                last_execution_id: r.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for row in mapped {
        rows.push(row.map_err(|e| e.to_string())?);
    }
    tg_log::info(BACKEND, "list_jobs", format!("n={}", rows.len()));
    Ok(rows)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateJobRequest {
    pub source: String,
    pub destination: String,
    pub session: String,
    pub mode: Option<String>,
    pub config_json: Option<String>,
    pub job_name: Option<String>,
}

pub fn create_job(req: &CreateJobRequest) -> Result<i64, String> {
    let conn = open_db()?;
    let mode = req.mode.clone().unwrap_or_else(|| "Clean Copy".into());
    let config = req.config_json.clone().unwrap_or_else(|| "{}".into());
    conn.execute(
        "INSERT INTO jobs (name, profile_name, source_entity_id, target_entity_id, transfer_mode, config_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            req.job_name,
            req.session,
            req.source,
            req.destination,
            mode,
            config
        ],
    )
    .map_err(|e| format!("insert job: {e}"))?;
    let id = conn.last_insert_rowid();
    tg_log::info(BACKEND, "create_job", format!("id={id}"));
    Ok(id)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditJobRequest {
    pub job_id: i64,
    pub source: String,
    pub destination: String,
    pub session: String,
    pub mode: Option<String>,
    pub config_json: Option<String>,
    pub job_name: Option<String>,
}

pub fn edit_job(req: &EditJobRequest) -> Result<(), String> {
    let conn = open_db()?;
    let mode = req.mode.clone().unwrap_or_else(|| "Clean Copy".into());
    let config = req.config_json.clone().unwrap_or_else(|| "{}".into());
    let n = conn
        .execute(
            "UPDATE jobs SET name=?1, profile_name=?2, source_entity_id=?3, target_entity_id=?4,
             transfer_mode=?5, config_json=?6 WHERE id=?7",
            params![
                req.job_name,
                req.session,
                req.source,
                req.destination,
                mode,
                config,
                req.job_id
            ],
        )
        .map_err(|e| format!("update job: {e}"))?;
    if n == 0 {
        return Err(format!("job {} not found", req.job_id));
    }
    Ok(())
}

pub fn delete_job(job_id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM executions WHERE job_id = ?1", params![job_id])
        .ok();
    let n = conn
        .execute("DELETE FROM jobs WHERE id = ?1", params![job_id])
        .map_err(|e| format!("delete job: {e}"))?;
    if n == 0 {
        return Err(format!("job {job_id} not found"));
    }
    Ok(())
}

pub fn get_job(job_id: i64) -> Result<Option<JobRow>, String> {
    let conn = open_db()?;
    conn.query_row(
        "SELECT id, name, profile_name, source_entity_id, target_entity_id,
                transfer_mode, config_json, created_at
         FROM jobs WHERE id = ?1",
        params![job_id],
        |r| {
            Ok(JobRow {
                id: r.get(0)?,
                job_name: r.get(1)?,
                profile_name: r.get(2)?,
                source_entity_id: r.get(3)?,
                target_entity_id: r.get(4)?,
                transfer_mode: r.get(5)?,
                config_json: r.get(6)?,
                created_at: r.get(7)?,
                status: None,
                processed_messages: None,
                total_messages: None,
                last_processed_id: None,
                last_execution_id: None,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Mark a lightweight execution row (migration runner will fill progress later).
pub fn start_execution(job_id: i64) -> Result<i64, String> {
    let job = get_job(job_id)?.ok_or_else(|| format!("job {job_id} not found"))?;
    let snapshot = job.config_json.unwrap_or_else(|| "{}".into());
    let conn = open_db()?;
    conn.execute(
        "INSERT INTO executions (job_id, snapshot_config_json, status)
         VALUES (?1, ?2, 'STARTING')",
        params![job_id, snapshot],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

pub fn update_execution_status(
    execution_id: i64,
    status: &str,
    processed: Option<i64>,
    total: Option<i64>,
    last_id: Option<i64>,
) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE executions SET status=?1,
         processed_messages=COALESCE(?2, processed_messages),
         total_messages=COALESCE(?3, total_messages),
         last_processed_id=COALESCE(?4, last_processed_id)
         WHERE id=?5",
        params![status, processed, total, last_id, execution_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheDirInfo {
    pub custom_path: Option<String>,
    pub active_cache_dir: PathBuf,
    pub active_temp_dir: PathBuf,
    pub active_thumbs_dir: PathBuf,
    pub is_fallback: bool,
    pub default_cache_dir: PathBuf,
}

pub fn resolve_active_cache_dirs() -> CacheDirInfo {
    let sessions = resolve_sessions_dir(None);
    let default_base = sessions
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let default_cache = default_base.join("cache");
    let default_temp = default_base.join("temp");
    // Thumbs live under worker/cache/thumbs (same base as cache, not under sessions)
    let default_thumbs = default_cache.join("thumbs");

    let conn = open_db().ok();
    let custom_path: Option<String> = conn.as_ref().and_then(|c| {
        c.query_row(
            "SELECT value FROM settings WHERE key = 'custom_cache_dir'",
            [],
            |r| r.get(0),
        )
        .ok()
    });

    if let Some(ref cp) = custom_path {
        let p = PathBuf::from(cp.trim());
        if !cp.trim().is_empty() && (p.is_dir() || std::fs::create_dir_all(&p).is_ok()) {
            let active_cache = p.join("cache");
            let active_temp = p.join("temp");
            let active_thumbs = p.join("thumbs");
            let _ = std::fs::create_dir_all(&active_cache);
            let _ = std::fs::create_dir_all(&active_temp);
            let _ = std::fs::create_dir_all(&active_thumbs);

            return CacheDirInfo {
                custom_path: Some(cp.clone()),
                active_cache_dir: active_cache,
                active_temp_dir: active_temp,
                active_thumbs_dir: active_thumbs,
                is_fallback: false,
                default_cache_dir: default_cache,
            };
        } else {
            // Fallback because custom path is inaccessible/unmounted
            return CacheDirInfo {
                custom_path: Some(cp.clone()),
                active_cache_dir: default_cache.clone(),
                active_temp_dir: default_temp,
                active_thumbs_dir: default_thumbs,
                is_fallback: true,
                default_cache_dir: default_cache,
            };
        }
    }

    CacheDirInfo {
        custom_path: None,
        active_cache_dir: default_cache.clone(),
        active_temp_dir: default_temp,
        active_thumbs_dir: default_thumbs,
        is_fallback: false,
        default_cache_dir: default_cache,
    }
}

pub fn get_custom_cache_dir_info() -> Result<serde_json::Value, String> {
    let info = resolve_active_cache_dirs();
    Ok(json!({
        "customPath": info.custom_path,
        "activePath": info.active_cache_dir.display().to_string(),
        "isFallback": info.is_fallback,
        "defaultPath": info.default_cache_dir.display().to_string(),
    }))
}

pub fn set_custom_cache_dir(new_path: &str, action: &str) -> Result<serde_json::Value, String> {
    let trimmed = new_path.trim();
    if trimmed.is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    let p = PathBuf::from(trimmed);
    std::fs::create_dir_all(&p).map_err(|e| format!("Failed to create custom directory: {e}"))?;

    // Verify write permissions
    let test_file = p.join(".autogram_write_test");
    if std::fs::write(&test_file, b"test").is_err() {
        return Err(format!("Selected directory is not writable: {trimmed}"));
    }
    let _ = std::fs::remove_file(&test_file);

    let old_info = resolve_active_cache_dirs();
    let new_cache = p.join("cache");
    let new_temp = p.join("temp");
    let new_thumbs = p.join("thumbs");
    let _ = std::fs::create_dir_all(&new_cache);
    let _ = std::fs::create_dir_all(&new_temp);
    let _ = std::fs::create_dir_all(&new_thumbs);

    fn copy_dir_all(src: &Path, dst: &Path) {
        if !src.is_dir() { return; }
        let Ok(rd) = std::fs::read_dir(src) else { return; };
        for e in rd.flatten() {
            let path = e.path();
            let target = dst.join(e.file_name());
            if path.is_dir() {
                let _ = std::fs::create_dir_all(&target);
                copy_dir_all(&path, &target);
                let _ = std::fs::remove_dir(&path);
            } else {
                if std::fs::copy(&path, &target).is_ok() {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }

    fn cleanup_empty_custom_dir(old_info: &CacheDirInfo) {
        if let Some(ref cp) = old_info.custom_path {
            if !old_info.is_fallback {
                let _ = std::fs::remove_dir(&old_info.active_cache_dir);
                let _ = std::fs::remove_dir(&old_info.active_temp_dir);
                let _ = std::fs::remove_dir(&old_info.active_thumbs_dir);

                let custom_base = PathBuf::from(cp.trim());
                if custom_base.is_dir() {
                    if let Ok(mut rd) = std::fs::read_dir(&custom_base) {
                        if rd.next().is_none() {
                            let _ = std::fs::remove_dir(&custom_base);
                        }
                    }
                }
            }
        }
    }

    if action == "move" {
        copy_dir_all(&old_info.active_cache_dir, &new_cache);
        copy_dir_all(&old_info.active_temp_dir, &new_temp);
        copy_dir_all(&old_info.active_thumbs_dir, &new_thumbs);
    } else {
        // "wipe" option: clear old cache
        let _ = clear_disk_cache();
    }

    cleanup_empty_custom_dir(&old_info);

    let conn = open_db()?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('custom_cache_dir', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![trimmed],
    )
    .map_err(|e| format!("Save settings error: {e}"))?;

    get_custom_cache_dir_info()
}

pub fn reset_custom_cache_dir() -> Result<serde_json::Value, String> {
    let old_info = resolve_active_cache_dirs();
    let conn = open_db()?;
    conn.execute("DELETE FROM settings WHERE key = 'custom_cache_dir'", [])
        .map_err(|e| format!("Delete settings error: {e}"))?;
    
    // Clean up empty custom directories if old path was custom
    cleanup_empty_custom_dir(&old_info);

    get_custom_cache_dir_info()
}

/// Cache size under worker/cache, worker/temp, sessions/thumbs (pure Rust FS).
pub fn calculate_cache_size() -> Result<serde_json::Value, String> {
    let info = resolve_active_cache_dirs();
    let mut cache_bytes: u64 = 0;
    let mut temp_bytes: u64 = 0;
    let mut thumbs_bytes: u64 = 0;
    let mut sys_temp_bytes: u64 = 0;
    let mut stale_bytes: u64 = 0;

    let now = std::time::SystemTime::now();
    let one_day = std::time::Duration::from_secs(86400);

    fn walk_detailed(dir: &Path, sum: &mut u64, stale: &mut u64, now: std::time::SystemTime, one_day: std::time::Duration) {
        let Ok(rd) = std::fs::read_dir(dir) else {
            return;
        };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk_detailed(&p, sum, stale, now, one_day);
            } else if let Ok(m) = e.metadata() {
                let len = m.len();
                *sum = sum.saturating_add(len);
                if let Ok(mod_time) = m.modified() {
                    if let Ok(elapsed) = now.duration_since(mod_time) {
                        if elapsed > one_day {
                            *stale = stale.saturating_add(len);
                        }
                    }
                }
            }
        }
    }

    if info.active_cache_dir.is_dir() {
        // Walk each child of active_cache_dir, explicitly skipping the thumbs subdir
        // (thumbs are counted separately in thumbs_bytes to avoid double-counting)
        let thumbs_name = info.active_thumbs_dir
            .file_name()
            .map(|n| n.to_os_string());
        if let Ok(rd) = std::fs::read_dir(&info.active_cache_dir) {
            for entry in rd.flatten() {
                let child = entry.path();
                // Skip the thumbs subdirectory — it is walked separately below
                if child.is_dir() {
                    if let Some(ref tname) = thumbs_name {
                        if entry.file_name() == *tname {
                            continue;
                        }
                    }
                    let mut dummy = 0u64;
                    walk_detailed(&child, &mut cache_bytes, &mut dummy, now, one_day);
                } else if let Ok(m) = entry.metadata() {
                    cache_bytes = cache_bytes.saturating_add(m.len());
                }
            }
        }
    }
    if info.active_temp_dir.is_dir() {
        walk_detailed(&info.active_temp_dir, &mut temp_bytes, &mut stale_bytes, now, one_day);
    }
    if info.active_thumbs_dir.is_dir() {
        let mut dummy_stale = 0u64;
        walk_detailed(&info.active_thumbs_dir, &mut thumbs_bytes, &mut dummy_stale, now, one_day);
    }

    // Also scan legacy worker/sessions/thumbs if distinct from active_thumbs_dir
    let sessions_dir = resolve_sessions_dir(None);
    let legacy_thumbs = sessions_dir.join("thumbs");
    if legacy_thumbs.is_dir() && legacy_thumbs != info.active_thumbs_dir {
        let mut dummy_stale = 0u64;
        walk_detailed(&legacy_thumbs, &mut thumbs_bytes, &mut dummy_stale, now, one_day);
    }

    if let Ok(sys_temp) = std::env::temp_dir().canonicalize() {
        let autogram_temp = sys_temp.join("autogram");
        if autogram_temp.is_dir() {
            walk_detailed(&autogram_temp, &mut sys_temp_bytes, &mut stale_bytes, now, one_day);
        }
    }

    let total = cache_bytes.saturating_add(temp_bytes).saturating_add(thumbs_bytes).saturating_add(sys_temp_bytes);

    Ok(json!({
        "status": "success",
        "bytes": total,
        "cacheBytes": cache_bytes,
        "tempBytes": temp_bytes,
        "thumbsBytes": thumbs_bytes,
        "sysTempBytes": sys_temp_bytes,
        "staleBytes": stale_bytes,
        "path": info.active_cache_dir.display().to_string(),
        "customPath": info.custom_path,
        "isFallback": info.is_fallback,
        "backend": "rust",
    }))
}

/// Reset job progress: delete executions so next run starts clean.
pub fn fresh_start_job(job_id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM executions WHERE job_id = ?1", params![job_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Export all jobs as JSON array (for backup).
pub fn export_jobs_json() -> Result<String, String> {
    let jobs = list_jobs()?;
    serde_json::to_string_pretty(&jobs).map_err(|e| e.to_string())
}

/// Import jobs from JSON array (best-effort insert).
pub fn import_jobs_json(json_str: &str) -> Result<usize, String> {
    let rows: Vec<serde_json::Value> =
        serde_json::from_str(json_str).map_err(|e| format!("parse import: {e}"))?;
    let mut n = 0usize;
    for row in rows {
        let req = CreateJobRequest {
            source: row
                .get("sourceEntityId")
                .or_else(|| row.get("source_entity_id"))
                .and_then(|v| v.as_str())
                .unwrap_or("0")
                .to_string(),
            destination: row
                .get("targetEntityId")
                .or_else(|| row.get("target_entity_id"))
                .and_then(|v| v.as_str())
                .unwrap_or("0")
                .to_string(),
            session: row
                .get("profileName")
                .or_else(|| row.get("profile_name"))
                .and_then(|v| v.as_str())
                .unwrap_or("Lavender")
                .to_string(),
            mode: row
                .get("transferMode")
                .or_else(|| row.get("transfer_mode"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            config_json: row
                .get("configJson")
                .or_else(|| row.get("config_json"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            job_name: row
                .get("jobName")
                .or_else(|| row.get("job_name"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        };
        create_job(&req)?;
        n += 1;
    }
    Ok(n)
}

pub fn clear_disk_cache() -> Result<serde_json::Value, String> {
    super::grammers_media::clear_thumb_mem_cache();
    super::grammers_media::clear_thumb_terminal_cache();
    let info = resolve_active_cache_dirs();
    let mut removed = 0u64;

    fn wipe(dir: &Path, removed: &mut u64) {
        let Ok(rd) = std::fs::read_dir(dir) else {
            return;
        };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                wipe(&p, removed);
                let _ = std::fs::remove_dir(&p);
            } else {
                if std::fs::remove_file(&p).is_ok() {
                    *removed += 1;
                }
            }
        }
    }

    if info.active_cache_dir.is_dir() {
        wipe(&info.active_cache_dir, &mut removed);
    }
    if info.active_temp_dir.is_dir() {
        wipe(&info.active_temp_dir, &mut removed);
    }
    if info.active_thumbs_dir.is_dir() {
        wipe(&info.active_thumbs_dir, &mut removed);
    }

    let sessions_dir = resolve_sessions_dir(None);
    let legacy_thumbs = sessions_dir.join("thumbs");
    if legacy_thumbs.is_dir() && legacy_thumbs != info.active_thumbs_dir {
        wipe(&legacy_thumbs, &mut removed);
    }

    if let Ok(sys_temp) = std::env::temp_dir().canonicalize() {
        let autogram_temp = sys_temp.join("autogram");
        if autogram_temp.is_dir() {
            wipe(&autogram_temp, &mut removed);
        }
    }

    Ok(json!({
        "status": "success",
        "removedFiles": removed,
        "backend": "rust"
    }))
}

pub fn trim_disk_cache(target_bytes: u64) -> Result<serde_json::Value, String> {
    let info = resolve_active_cache_dirs();
    let cache = info.active_cache_dir.clone();

    struct FileEntry {
        path: PathBuf,
        size: u64,
        modified: std::time::SystemTime,
    }

    let mut files = Vec::new();
    let mut current_total: u64 = 0;

    fn collect(dir: &Path, files: &mut Vec<FileEntry>, total: &mut u64) {
        let Ok(rd) = std::fs::read_dir(dir) else {
            return;
        };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                collect(&p, files, total);
            } else if let Ok(m) = e.metadata() {
                let sz = m.len();
                let mod_time = m.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                *total = total.saturating_add(sz);
                files.push(FileEntry {
                    path: p,
                    size: sz,
                    modified: mod_time,
                });
            }
        }
    }

    if cache.is_dir() {
        collect(&cache, &mut files, &mut current_total);
    }

    let mut removed_count = 0u64;
    let mut freed_bytes = 0u64;

    if current_total > target_bytes {
        files.sort_by_key(|f| f.modified);

        let now = std::time::SystemTime::now();
        let protect_window = std::time::Duration::from_secs(600); // 10 minutes active file protection

        for f in files {
            if current_total <= target_bytes {
                break;
            }
            // Skip files modified/accessed in the last 10 minutes (protect active previews/streams)
            if let Ok(age) = now.duration_since(f.modified) {
                if age < protect_window {
                    continue;
                }
            }
            if std::fs::remove_file(&f.path).is_ok() {
                removed_count += 1;
                freed_bytes += f.size;
                current_total = current_total.saturating_sub(f.size);
            }
        }
    }

    Ok(json!({
        "status": "success",
        "removed_files": removed_count,
        "freed_bytes": freed_bytes,
        "remaining_bytes": current_total,
        "backend": "rust",
    }))
}

pub fn cancel_execution(job_id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE executions SET status='CANCELLED' WHERE job_id=?1 AND status='RUNNING'",
        params![job_id],
    )
    .map_err(|e| format!("cancel execution: {e}"))?;
    Ok(())
}

pub fn is_execution_cancelled(exec_id: i64) -> bool {
    let Ok(conn) = open_db() else { return false };
    let status: Option<String> = conn
        .query_row(
            "SELECT status FROM executions WHERE id = ?1",
            params![exec_id],
            |r| r.get(0),
        )
        .optional()
        .unwrap_or(None);
    matches!(
        status.as_deref().map(|s| s.to_ascii_uppercase()).as_deref(),
        Some("CANCELLED") | Some("PAUSED") | Some("STOPPED")
    )
}

#[cfg(target_os = "windows")]
extern "system" {
    #[link_name = "GetDiskFreeSpaceExW"]
    fn winapi_get_disk_free_space(
        directory_name: *const u16,
        free_bytes_available_to_caller: *mut u64,
        total_number_of_bytes: *mut u64,
        total_number_of_free_bytes: *mut u64,
    ) -> i32;
}

pub fn get_disk_free_space(path_str: Option<String>) -> Result<serde_json::Value, String> {
    let target = path_str.unwrap_or_else(|| {
        let active = resolve_active_cache_dirs();
        active.active_cache_dir.display().to_string()
    });

    let p = PathBuf::from(&target);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;

        let mut candidates = Vec::new();

        if let Ok(canon) = p.canonicalize() {
            candidates.push(canon);
        }
        candidates.push(p.clone());

        // Extract drive root prefix e.g. "F:\"
        let path_s = p.to_string_lossy();
        if path_s.len() >= 2 && path_s.as_bytes()[1] == b':' {
            let drive_root = format!("{}\\", &path_s[..2]);
            candidates.push(PathBuf::from(drive_root));
        }
        if let Ok(cwd) = std::env::current_dir() {
            let cwd_s = cwd.to_string_lossy();
            if cwd_s.len() >= 2 && cwd_s.as_bytes()[1] == b':' {
                let drive_root = format!("{}\\", &cwd_s[..2]);
                candidates.push(PathBuf::from(drive_root));
            }
        }

        for cand in candidates {
            let cand_str = cand.to_string_lossy();
            let mut wide_vec: Vec<u16> = cand.as_os_str().encode_wide().collect();
            // Ensure trailing backslash for drive root e.g. "F:\"
            if cand_str.len() == 2 && cand_str.as_bytes()[1] == b':' {
                wide_vec.push(b'\\' as u16);
            }
            wide_vec.push(0);

            let mut free_avail: u64 = 0;
            let mut total_bytes: u64 = 0;
            let mut total_free: u64 = 0;

            unsafe {
                let res = winapi_get_disk_free_space(
                    wide_vec.as_ptr(),
                    &mut free_avail,
                    &mut total_bytes,
                    &mut total_free,
                );
                if res != 0 && total_bytes > 0 {
                    let bytes_free = if total_free > 0 { total_free } else { free_avail };
                    return Ok(json!({
                        "status": "success",
                        "free_bytes": bytes_free,
                        "total_bytes": total_bytes,
                        "path": cand.display().to_string()
                    }));
                }
            }
        }
    }

    Ok(json!({
        "status": "error",
        "free_bytes": 0u64,
        "total_bytes": 0u64,
        "path": target
    }))
}
