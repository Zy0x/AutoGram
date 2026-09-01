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
    conn.execute_batch(include_str!(
        "../../../../database/migrations/020_media_forwarder_v2.sql"
    ))
    .map_err(|e| format!("forwarder v2 schema: {e}"))?;
    conn.execute_batch(include_str!(
        "../../../../database/migrations/021_forwarder_runtime_bridge.sql"
    ))
    .map_err(|e| format!("forwarder runtime schema: {e}"))?;

    // Existing installations may have the legacy table shape.  SQLite has no
    // `ADD COLUMN IF NOT EXISTS`, so inspect first and alter only when the
    // column is genuinely absent.  This keeps upgrades replay-safe.
    for (table, column, definition) in [
        ("jobs", "revision", "INTEGER NOT NULL DEFAULT 0"),
        ("jobs", "schema_version", "INTEGER NOT NULL DEFAULT 2"),
        ("jobs", "source_account_id", "TEXT NOT NULL DEFAULT ''"),
        ("jobs", "destination_account_id", "TEXT NOT NULL DEFAULT ''"),
        ("executions", "cancel_requested", "INTEGER NOT NULL DEFAULT 0"),
        ("executions", "cancellation_state", "TEXT NOT NULL DEFAULT 'NONE'"),
        ("executions", "checkpoint_json", "TEXT"),
        ("tasks", "destination_message_ids_json", "TEXT NOT NULL DEFAULT '[]'"),
        ("tasks", "stage", "TEXT NOT NULL DEFAULT 'QUEUED'"),
        ("tasks", "idempotency_key", "TEXT"),
        ("tasks", "reason_code", "TEXT"),
        ("message_mapping", "source_account_id", "TEXT NOT NULL DEFAULT ''"),
        ("message_mapping", "destination_account_id", "TEXT NOT NULL DEFAULT ''"),
        ("message_mapping", "topic_id", "INTEGER"),
        ("message_mapping", "album_id", "TEXT"),
        ("message_mapping", "reply_to_source_msg_id", "INTEGER"),
        ("message_mapping", "reason_code", "TEXT"),
    ] {
        let exists: bool = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .and_then(|mut stmt| {
                let mut rows = stmt.query([])?;
                while let Some(row) = rows.next()? {
                    let name: String = row.get(1)?;
                    if name == column { return Ok(true); }
                }
                Ok(false)
            })
            .unwrap_or(false);
        if !exists {
            conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"))
                .map_err(|e| format!("add {table}.{column}: {e}"))?;
        }
    }
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

/// Scoped V2 dedupe probe. Unlike the legacy job-local ledger this includes
/// both account identities, destination peer and topic in every lookup.
pub fn forwarder_ledger_check(
    job_id: i64,
    source_account_id: &str,
    destination_account_id: &str,
    destination_peer_id: &str,
    destination_topic_id: Option<i64>,
    source_message_id: i64,
    telegram_unique_id: Option<&str>,
    sha256: Option<&str>,
    filename: Option<&str>,
    size: Option<i64>,
) -> Result<LedgerHit, String> {
    let conn = open_db()?;
    let scope = "job_id=?1 AND source_account_id=?2 AND destination_account_id=?3 AND destination_peer_id=?4 AND destination_topic_id IS ?5";
    let mut hit = LedgerHit::default();
    let source: i64 = conn.query_row(&format!("SELECT COUNT(1) FROM forwarder_dedupe_ledger WHERE {scope} AND source_message_id=?6"), params![job_id, source_account_id, destination_account_id, destination_peer_id, destination_topic_id, source_message_id], |r| r.get(0)).unwrap_or(0);
    hit.by_source_msg = source > 0;
    if let Some(uid) = telegram_unique_id.filter(|s| !s.is_empty()) {
        let n: i64 = conn.query_row(&format!("SELECT COUNT(1) FROM forwarder_dedupe_ledger WHERE {scope} AND telegram_unique_id=?6"), params![job_id, source_account_id, destination_account_id, destination_peer_id, destination_topic_id, uid], |r| r.get(0)).unwrap_or(0);
        hit.by_telegram_unique = n > 0;
    }
    if let Some(hash) = sha256.filter(|s| !s.is_empty()) {
        let n: i64 = conn.query_row(&format!("SELECT COUNT(1) FROM forwarder_dedupe_ledger WHERE {scope} AND sha256=?6"), params![job_id, source_account_id, destination_account_id, destination_peer_id, destination_topic_id, hash], |r| r.get(0)).unwrap_or(0);
        hit.by_sha256 = n > 0;
    }
    if let (Some(name), Some(bytes)) = (filename.filter(|s| !s.is_empty()), size) {
        let n: i64 = conn.query_row(&format!("SELECT COUNT(1) FROM forwarder_dedupe_ledger WHERE {scope} AND filename=?6 AND byte_size=?7"), params![job_id, source_account_id, destination_account_id, destination_peer_id, destination_topic_id, name, bytes], |r| r.get(0)).unwrap_or(0);
        hit.by_name_size = n > 0;
    }
    Ok(hit)
}

pub fn forwarder_ledger_insert(
    job_id: i64,
    source_account_id: &str,
    destination_account_id: &str,
    destination_peer_id: &str,
    destination_topic_id: Option<i64>,
    source_message_id: i64,
    destination_message_id: Option<i64>,
    telegram_unique_id: Option<&str>,
    sha256: Option<&str>,
    filename: Option<&str>,
    size: Option<i64>,
    decision: &str,
) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "INSERT INTO forwarder_dedupe_ledger (job_id, source_account_id, destination_account_id, destination_peer_id, destination_topic_id, source_message_id, destination_message_id, telegram_unique_id, sha256, filename, byte_size, decision)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
         ON CONFLICT(job_id, source_account_id, destination_account_id, destination_peer_id, destination_topic_id, source_message_id)
         DO UPDATE SET destination_message_id=excluded.destination_message_id, telegram_unique_id=excluded.telegram_unique_id, sha256=excluded.sha256, filename=excluded.filename, byte_size=excluded.byte_size, decision=excluded.decision",
        params![job_id, source_account_id, destination_account_id, destination_peer_id, destination_topic_id, source_message_id, destination_message_id, telegram_unique_id, sha256, filename, size, decision],
    ).map_err(|e| format!("forwarder ledger insert: {e}"))?;
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
    #[serde(default)]
    pub source_account_id: Option<String>,
    #[serde(default)]
    pub destination_account_id: Option<String>,
    pub mode: Option<String>,
    pub config_json: Option<String>,
    pub job_name: Option<String>,
}

fn sync_forwarder_contract(conn: &Connection, job_id: i64, raw_config: &str) {
    let Ok(canonical) = super::forwarder_contract::normalize_job_config_json(raw_config) else {
        return;
    };
    let revision = serde_json::from_str::<serde_json::Value>(&canonical)
        .ok()
        .and_then(|v| v.get("revision").and_then(|v| v.as_i64()))
        .unwrap_or(0);
    let _ = conn.execute(
        "INSERT INTO forwarder_job_configs(job_id, schema_version, revision, config_json, updated_at)
         VALUES (?1, 2, ?2, ?3, datetime('now'))
         ON CONFLICT(job_id) DO UPDATE SET revision=excluded.revision,
         config_json=excluded.config_json, updated_at=datetime('now')",
        params![job_id, revision, canonical],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO job_revisions(job_id, revision, config_json) VALUES (?1, ?2, ?3)",
        params![job_id, revision, canonical],
    );
}

pub fn create_job(req: &CreateJobRequest) -> Result<i64, String> {
    let conn = open_db()?;
    let mode = req.mode.clone().unwrap_or_else(|| "Clean Copy".into());
    let raw_config = req.config_json.clone().unwrap_or_else(|| {
        serde_json::json!({"source": req.source, "destination": req.destination, "session": req.session, "mode": mode}).to_string()
    });
    let config = super::forwarder_contract::normalize_job_config_json(&raw_config).unwrap_or(raw_config);
    conn.execute(
        "INSERT INTO jobs (name, profile_name, source_entity_id, target_entity_id, transfer_mode, config_json, source_account_id, destination_account_id, revision, schema_version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 2)",
        params![
            req.job_name,
            req.session,
            req.source,
            req.destination,
            mode,
            config,
            req.source_account_id.clone().unwrap_or_else(|| req.session.clone()),
            req.destination_account_id.clone().unwrap_or_else(|| req.session.clone())
        ],
    )
    .map_err(|e| format!("insert job: {e}"))?;
    let id = conn.last_insert_rowid();
    sync_forwarder_contract(&conn, id, &config);
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
    #[serde(default)]
    pub source_account_id: Option<String>,
    #[serde(default)]
    pub destination_account_id: Option<String>,
    pub mode: Option<String>,
    pub config_json: Option<String>,
    pub job_name: Option<String>,
}

pub fn edit_job(req: &EditJobRequest) -> Result<(), String> {
    let conn = open_db()?;
    let mode = req.mode.clone().unwrap_or_else(|| "Clean Copy".into());
    let raw_config = req.config_json.clone().unwrap_or_else(|| {
        serde_json::json!({"source": req.source, "destination": req.destination, "session": req.session, "mode": mode}).to_string()
    });
    let config = super::forwarder_contract::normalize_job_config_json(&raw_config).unwrap_or(raw_config);
    let n = conn
        .execute(
            "UPDATE jobs SET name=?1, profile_name=?2, source_entity_id=?3, target_entity_id=?4,
             transfer_mode=?5, config_json=?6, source_account_id=?7, destination_account_id=?8,
             revision=revision+1 WHERE id=?9",
            params![
                req.job_name,
                req.session,
                req.source,
                req.destination,
                mode,
                config,
                req.source_account_id.clone().unwrap_or_else(|| req.session.clone()),
                req.destination_account_id.clone().unwrap_or_else(|| req.session.clone()),
                req.job_id
            ],
        )
        .map_err(|e| format!("update job: {e}"))?;
    if n == 0 {
        return Err(format!("job {} not found", req.job_id));
    }
    sync_forwarder_contract(&conn, req.job_id, &config);
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionInboxRow {
    pub id: i64,
    pub job_id: i64,
    pub execution_id: Option<i64>,
    pub task_id: Option<i64>,
    pub decision_type: String,
    pub reason_code: String,
    pub payload_json: String,
    pub status: String,
    pub created_at: String,
}

pub fn list_decision_inbox(job_id: Option<i64>) -> Result<Vec<DecisionInboxRow>, String> {
    let conn = open_db()?;
    let mut out = Vec::new();
    let sql = "SELECT id, job_id, execution_id, task_id, decision_type, reason_code, payload_json, status, created_at FROM decision_inbox WHERE (?1 IS NULL OR job_id=?1) AND status='OPEN' ORDER BY created_at ASC";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![job_id], |r| Ok(DecisionInboxRow { id:r.get(0)?, job_id:r.get(1)?, execution_id:r.get(2)?, task_id:r.get(3)?, decision_type:r.get(4)?, reason_code:r.get(5)?, payload_json:r.get(6)?, status:r.get(7)?, created_at:r.get(8)? })).map_err(|e| e.to_string())?;
    for row in rows { out.push(row.map_err(|e| e.to_string())?); }
    Ok(out)
}

pub fn resolve_decision(id: i64, decision: &str) -> Result<(), String> {
    let conn = open_db()?;
    let changed = conn.execute("UPDATE decision_inbox SET status='RESOLVED', resolved_by=?1, resolved_at=datetime('now') WHERE id=?2 AND status='OPEN'", params![decision, id]).map_err(|e| e.to_string())?;
    if changed == 0 { return Err(format!("decision {id} not found or already resolved")); }
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

pub fn log_job_event(
    job_id: i64,
    stage: &str,
    message: &str,
    metadata: Option<&str>,
) -> Result<(), String> {
    let conn = open_db()?;
    super::autogram_core::log_job_event(&conn, job_id, stage, message, metadata)
}

/// Persist one source-message task before any network side effect.  The
/// idempotency key is deterministic for an execution/message pair, allowing
/// resume and reconciliation code to distinguish a retried item from a new
/// item without duplicating rows.
pub fn upsert_forwarder_task(execution_id: i64, source_message_id: i64, stage: &str, status: &str) -> Result<i64, String> {
    let conn = open_db()?;
    let existing: Option<i64> = conn.query_row("SELECT id FROM tasks WHERE execution_id=?1 AND source_message_id=?2 ORDER BY id LIMIT 1", params![execution_id, source_message_id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    if let Some(id) = existing {
        conn.execute("UPDATE tasks SET stage=?1, status=?2, updated_at=datetime('now') WHERE id=?3", params![stage, status, id]).map_err(|e| e.to_string())?;
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO tasks (execution_id, source_message_id, stage, status, attempts, idempotency_key, updated_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, datetime('now'))",
        params![execution_id, source_message_id, stage, status, format!("exec:{execution_id}:msg:{source_message_id}")],
    ).map_err(|e| format!("insert forwarder task: {e}"))?;
    conn.query_row("SELECT id FROM tasks WHERE execution_id=?1 AND source_message_id=?2", params![execution_id, source_message_id], |r| r.get(0)).map_err(|e| e.to_string())
}

pub fn complete_forwarder_task(task_id: i64, status: &str, reason_code: Option<&str>, destination_ids_json: Option<&str>) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE tasks SET status=?1, reason_code=COALESCE(?2, reason_code), destination_message_ids_json=COALESCE(?3, destination_message_ids_json), updated_at=datetime('now') WHERE id=?4",
        params![status, reason_code, destination_ids_json, task_id],
    ).map_err(|e| format!("complete forwarder task: {e}"))?;
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

pub fn set_custom_cache_dir(new_path: &str, action: &str) -> Result<serde_json::Value, String> {
    let trimmed = new_path.trim();
    if trimmed.is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    let mut p = PathBuf::from(trimmed);
    let is_autogram = p
        .file_name()
        .map(|n| n.to_string_lossy().eq_ignore_ascii_case("AutoGram"))
        .unwrap_or(false);
    if !is_autogram {
        p = p.join("AutoGram");
    }

    std::fs::create_dir_all(&p).map_err(|e| format!("Failed to create custom directory: {e}"))?;

    // Verify write permissions
    let test_file = p.join(".autogram_write_test");
    if std::fs::write(&test_file, b"test").is_err() {
        return Err(format!(
            "Selected directory is not writable: {}",
            p.display()
        ));
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
        if !src.is_dir() {
            return;
        }
        let Ok(rd) = std::fs::read_dir(src) else {
            return;
        };
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
        params![p.display().to_string()],
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

const DEFAULT_CACHE_LIMIT_BYTES: u64 = 5 * 1024 * 1024 * 1024;

static CACHE_OPERATION_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();

fn cache_operation_lock() -> &'static std::sync::Mutex<()> {
    CACHE_OPERATION_LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

fn stream_entry_is_active(entry: &super::stream_server::StreamEntry) -> bool {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    !entry.done
        && !entry.cancelled
        && !entry.paused
        && now_ms.saturating_sub(entry.updated_at_ms) <= 120_000
}

fn cache_accounted_file_size(path: &Path, metadata: &std::fs::Metadata) -> u64 {
    if path.extension().and_then(|ext| ext.to_str()) == Some("partial") {
        if let Some(stream_id) = path.file_stem().and_then(|name| name.to_str()) {
            let live_entry = super::stream_server::get_entry(stream_id);
            let persisted_entry = if live_entry.is_none() {
                let mut candidates = Vec::new();
                if let Some(cache_root) = path.parent().and_then(Path::parent) {
                    candidates.push(
                        cache_root
                            .join("stream_registry")
                            .join(format!("{stream_id}.json")),
                    );
                }
                candidates.push(
                    std::env::temp_dir()
                        .join("autogram_stream_registry")
                        .join(format!("{stream_id}.json")),
                );
                candidates.into_iter().find_map(|registry_path| {
                    let bytes = std::fs::read(registry_path).ok()?;
                    let entry =
                        serde_json::from_slice::<super::stream_server::StreamEntry>(&bytes).ok()?;
                    let same_path = entry.path.eq_ignore_ascii_case(&path.display().to_string());
                    (same_path && entry.total_size == metadata.len()).then_some(entry)
                })
            } else {
                None
            };
            if let Some(entry) = live_entry.or(persisted_entry) {
                if entry.done {
                    return entry.total_size;
                }
                // A progressive file is sparse. Its logical length is the remote
                // media size, not the bytes currently occupying the cache.
                return super::stream_server::filled_bytes(&entry.ranges);
            }
        }
    }
    metadata.len()
}

fn cache_roots(info: &CacheDirInfo) -> Vec<PathBuf> {
    let mut roots = vec![
        info.active_cache_dir.clone(),
        info.active_temp_dir.clone(),
        info.active_thumbs_dir.clone(),
        info.default_cache_dir.clone(),
    ];
    if let Some(default_base) = info.default_cache_dir.parent() {
        roots.push(default_base.join("temp"));
    }

    let sessions_dir = resolve_sessions_dir(None);
    roots.push(sessions_dir.join("thumbs"));

    // Only include temp directories owned by the running application. A broad
    // `autogram-*` prefix also matches WebView profiles, QA reports, and session
    // authorization scratch directories; scanning or deleting those made a
    // cache operation both unbounded and unsafe.
    let sys_temp = std::env::temp_dir();
    roots.push(sys_temp.join("autogram"));
    roots.push(sys_temp.join("autogram_studio_prep"));
    roots.push(sys_temp.join("autogram_stream_registry"));

    roots.sort_by_key(|path| path.components().count());
    let mut unique: Vec<PathBuf> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for root in roots {
        let key = root.to_string_lossy().to_ascii_lowercase();
        let nested = unique.iter().any(|parent| root.starts_with(parent));
        if !nested && seen.insert(key) {
            unique.push(root);
        }
    }
    unique
}

pub fn cache_limit_bytes() -> u64 {
    let Ok(conn) = open_db() else {
        return DEFAULT_CACHE_LIMIT_BYTES;
    };
    conn.query_row(
        "SELECT value FROM settings WHERE key = 'cache_limit_bytes'",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|value| value.parse::<u64>().ok())
    .unwrap_or(DEFAULT_CACHE_LIMIT_BYTES)
}

pub fn set_cache_policy(limit_bytes: u64, auto_prune: bool) -> Result<serde_json::Value, String> {
    let conn = open_db()?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('cache_limit_bytes', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![limit_bytes.to_string()],
    )
    .map_err(|e| format!("save cache limit: {e}"))?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('cache_auto_prune', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![if auto_prune { "true" } else { "false" }],
    )
    .map_err(|e| format!("save cache auto-prune: {e}"))?;
    drop(conn);

    if limit_bytes == 0 {
        Ok(json!({
            "status": "success",
            "limitBytes": 0,
            "limitSatisfied": true,
            "backend": "rust",
        }))
    } else {
        let mut result = trim_disk_cache(limit_bytes)?;
        result["limitBytes"] = json!(limit_bytes);
        Ok(result)
    }
}

/// Enforce the persisted hard limit from cache-producing call chains.
pub fn enforce_cache_policy() -> Result<serde_json::Value, String> {
    let limit = cache_limit_bytes();
    if limit == 0 {
        return Ok(json!({ "status": "success", "limitSatisfied": true, "limitBytes": 0 }));
    }
    trim_disk_cache(limit)
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

    fn walk_detailed(
        dir: &Path,
        sum: &mut u64,
        stale: &mut u64,
        now: std::time::SystemTime,
        one_day: std::time::Duration,
    ) {
        let Ok(rd) = std::fs::read_dir(dir) else {
            return;
        };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk_detailed(&p, sum, stale, now, one_day);
            } else if let Ok(m) = e.metadata() {
                let len = cache_accounted_file_size(&p, &m);
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
        let thumbs_name = info.active_thumbs_dir.file_name().map(|n| n.to_os_string());
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
                    cache_bytes = cache_bytes.saturating_add(cache_accounted_file_size(&child, &m));
                }
            }
        }
    }
    if info.active_temp_dir.is_dir() {
        walk_detailed(
            &info.active_temp_dir,
            &mut temp_bytes,
            &mut stale_bytes,
            now,
            one_day,
        );
    }
    if info.active_thumbs_dir.is_dir() {
        let mut dummy_stale = 0u64;
        walk_detailed(
            &info.active_thumbs_dir,
            &mut thumbs_bytes,
            &mut dummy_stale,
            now,
            one_day,
        );
    }

    // Also scan legacy worker/sessions/thumbs if distinct from active_thumbs_dir
    let sessions_dir = resolve_sessions_dir(None);
    let legacy_thumbs = sessions_dir.join("thumbs");
    if legacy_thumbs.is_dir() && legacy_thumbs != info.active_thumbs_dir {
        let mut dummy_stale = 0u64;
        walk_detailed(
            &legacy_thumbs,
            &mut thumbs_bytes,
            &mut dummy_stale,
            now,
            one_day,
        );
    }

    let sys_temp = std::env::temp_dir();
    for owned_temp in [
        sys_temp.join("autogram"),
        sys_temp.join("autogram_studio_prep"),
        sys_temp.join("autogram_stream_registry"),
    ] {
        if owned_temp.is_dir() {
            walk_detailed(
                &owned_temp,
                &mut sys_temp_bytes,
                &mut stale_bytes,
                now,
                one_day,
            );
        }
    }

    let total = cache_bytes
        .saturating_add(temp_bytes)
        .saturating_add(thumbs_bytes)
        .saturating_add(sys_temp_bytes);

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

/// Reset every resumable artifact for a job so the next run is genuinely new.
pub fn fresh_start_job(job_id: i64) -> Result<(), String> {
    let mut conn = open_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for table in [
        "executions",
        "migration_ledger",
        "checkpoints",
        "job_events",
    ] {
        tx.execute(
            &format!("DELETE FROM {table} WHERE job_id = ?1"),
            params![job_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
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
            source_account_id: row.get("sourceAccountId").or_else(|| row.get("source_account_id")).and_then(|v| v.as_str()).map(|s| s.to_string()),
            destination_account_id: row.get("destinationAccountId").or_else(|| row.get("destination_account_id")).and_then(|v| v.as_str()).map(|s| s.to_string()),
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
    let _operation = cache_operation_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    super::grammers_media::clear_thumb_mem_cache();
    super::grammers_media::clear_thumb_terminal_cache();
    let cancelled_streams = super::grammers_media::clear_runtime_preview_cache();
    // Let progressive workers observe cancellation and close their file handles
    // before Windows deletion. Range responses can retain a Windows handle for
    // a few seconds after the preview element closes, so bounded retries below
    // are part of Clear All rather than leaving cleanup to the background prune.
    std::thread::sleep(std::time::Duration::from_millis(60));
    let info = resolve_active_cache_dirs();
    let mut removed = 0u64;
    let mut freed_bytes = 0u64;
    let mut failed_paths = Vec::new();

    #[derive(Default)]
    struct WipeStats {
        removed: u64,
        freed: u64,
        failed: Vec<String>,
    }

    fn wipe(path: &Path, stats: &mut WipeStats) {
        if path.is_file() {
            let size = std::fs::metadata(path)
                .map(|m| cache_accounted_file_size(path, &m))
                .unwrap_or(0);
            match std::fs::remove_file(path) {
                Ok(()) => {
                    stats.removed += 1;
                    stats.freed = stats.freed.saturating_add(size);
                    if path.extension().and_then(|ext| ext.to_str()) == Some("partial") {
                        if let Some(stream_id) = path.file_stem().and_then(|name| name.to_str()) {
                            super::stream_server::remove_entry(stream_id);
                        }
                    }
                }
                Err(_) => stats.failed.push(path.display().to_string()),
            }
            return;
        }
        let Ok(rd) = std::fs::read_dir(path) else {
            return;
        };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                wipe(&p, stats);
                let _ = std::fs::remove_dir(&p);
            } else {
                let size = e
                    .metadata()
                    .map(|m| cache_accounted_file_size(&p, &m))
                    .unwrap_or(0);
                match std::fs::remove_file(&p) {
                    Ok(()) => {
                        stats.removed += 1;
                        stats.freed = stats.freed.saturating_add(size);
                        if p.extension().and_then(|ext| ext.to_str()) == Some("partial") {
                            if let Some(stream_id) = p.file_stem().and_then(|name| name.to_str()) {
                                super::stream_server::remove_entry(stream_id);
                            }
                        }
                    }
                    Err(_) => stats.failed.push(p.display().to_string()),
                }
            }
        }
    }

    fn sum_owned(path: &Path) -> u64 {
        let mut total = 0u64;
        if path.is_file() {
            if let Ok(metadata) = std::fs::metadata(path) {
                total = total.saturating_add(cache_accounted_file_size(path, &metadata));
            }
            return total;
        }
        let Ok(entries) = std::fs::read_dir(path) else {
            return total;
        };
        for entry in entries.flatten() {
            let child = entry.path();
            if child.is_dir() {
                total = total.saturating_add(sum_owned(&child));
            } else if let Ok(metadata) = entry.metadata() {
                total = total.saturating_add(cache_accounted_file_size(&child, &metadata));
            }
        }
        total
    }

    let roots = cache_roots(&info);
    let mut remaining_bytes = u64::MAX;
    for attempt in 0..=12 {
        failed_paths.clear();
        let pass = std::thread::scope(|scope| {
            let handles: Vec<_> = roots
                .iter()
                .map(|root| {
                    scope.spawn(move || {
                        let mut stats = WipeStats::default();
                        wipe(root, &mut stats);
                        stats
                    })
                })
                .collect();
            handles
                .into_iter()
                .filter_map(|handle| handle.join().ok())
                .collect::<Vec<_>>()
        });
        for stats in pass {
            removed = removed.saturating_add(stats.removed);
            freed_bytes = freed_bytes.saturating_add(stats.freed);
            failed_paths.extend(stats.failed);
        }
        remaining_bytes = std::thread::scope(|scope| {
            let handles: Vec<_> = roots
                .iter()
                .map(|root| scope.spawn(move || sum_owned(root)))
                .collect();
            handles
                .into_iter()
                .filter_map(|handle| handle.join().ok())
                .fold(0u64, u64::saturating_add)
        });
        if remaining_bytes == 0 && failed_paths.is_empty() {
            break;
        }
        super::grammers_media::clear_runtime_preview_cache();
        if attempt < 12 {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
    let cleared_registry_entries = super::stream_server::clear_all_entries();

    Ok(json!({
        "status": if remaining_bytes == 0 && failed_paths.is_empty() { "success" } else { "partial" },
        "removedFiles": removed,
        "freedBytes": freed_bytes,
        "remainingBytes": remaining_bytes,
        "failedPaths": failed_paths,
        "cancelledStreams": cancelled_streams,
        "clearedRegistryEntries": cleared_registry_entries,
        "backend": "rust"
    }))
}

pub fn trim_disk_cache(target_bytes: u64) -> Result<serde_json::Value, String> {
    let _operation = cache_operation_lock()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let info = resolve_active_cache_dirs();

    struct FileEntry {
        path: PathBuf,
        size: u64,
        modified: std::time::SystemTime,
        active: bool,
    }

    let mut files = Vec::new();
    let mut current_total: u64 = 0;

    fn collect(path: &Path, files: &mut Vec<FileEntry>, total: &mut u64) {
        if path.is_file() {
            if let Ok(metadata) = std::fs::metadata(path) {
                let size = cache_accounted_file_size(path, &metadata);
                let stream_id = path.file_stem().and_then(|name| name.to_str());
                let active = stream_id
                    .and_then(super::stream_server::get_entry)
                    .map(|entry| stream_entry_is_active(&entry))
                    .unwrap_or(false);
                *total = total.saturating_add(size);
                files.push(FileEntry {
                    path: path.to_path_buf(),
                    size,
                    modified: metadata
                        .modified()
                        .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
                    active,
                });
            }
            return;
        }
        let Ok(rd) = std::fs::read_dir(path) else {
            return;
        };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                collect(&p, files, total);
            } else if let Ok(m) = e.metadata() {
                let sz = cache_accounted_file_size(&p, &m);
                let mod_time = m.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                let stream_id = p.file_stem().and_then(|name| name.to_str());
                let active = p.extension().and_then(|ext| ext.to_str()) == Some("partial")
                    && stream_id
                        .and_then(super::stream_server::get_entry)
                        .map(|entry| stream_entry_is_active(&entry))
                        .unwrap_or(false);
                *total = total.saturating_add(sz);
                files.push(FileEntry {
                    path: p,
                    size: sz,
                    modified: mod_time,
                    active,
                });
            }
        }
    }

    for root in cache_roots(&info) {
        collect(&root, &mut files, &mut current_total);
    }

    let mut removed_count = 0u64;
    let mut freed_bytes = 0u64;

    if current_total > target_bytes {
        files.sort_by_key(|f| f.modified);

        for f in files {
            if current_total <= target_bytes {
                break;
            }
            // Registry state, not modification time, is the authority for an
            // actively served sparse preview. Recent but idle files remain LRU
            // candidates so the configured ceiling is actually enforceable.
            if f.active {
                continue;
            }
            if std::fs::remove_file(&f.path).is_ok() {
                if f.path.extension().and_then(|ext| ext.to_str()) == Some("partial") {
                    if let Some(stream_id) = f.path.file_stem().and_then(|name| name.to_str()) {
                        super::stream_server::remove_entry(stream_id);
                    }
                }
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
        "target_bytes": target_bytes,
        "limit_satisfied": current_total <= target_bytes,
        "backend": "rust",
    }))
}

pub fn cancel_execution(job_id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE executions SET status='CANCELLED', cancel_requested=1,
         cancellation_state='REQUESTED'
         WHERE job_id=?1 AND status IN
         ('STARTING','RUNNING','SCANNING','FORWARDING','DOWNLOADING','UPLOADING','COMMITTING')",
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
                    let bytes_free = if total_free > 0 {
                        total_free
                    } else {
                        free_avail
                    };
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
