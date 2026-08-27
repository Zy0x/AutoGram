//! AutoGram Android UniFFI Bridge
//! Exposes shared `autogram-core` functionality to Kotlin & Jetpack Compose via Mozilla UniFFI.

use parking_lot::RwLock;
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

uniffi::setup_scaffolding!();

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum AutoGramBridgeError {
    #[error("Internal Error: {msg}")]
    InternalError { msg: String },
    #[error("Database Error: {msg}")]
    DatabaseError { msg: String },
    #[error("Telegram MTProto Error: {msg}")]
    TelegramError { msg: String },
    #[error("Media Processing Error: {msg}")]
    MediaError { msg: String },
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct AccountScoreResult {
    pub account_id: String,
    pub tier: String,
    pub total_score: f64,
    pub capability_score: f64,
    pub health_score: f64,
    pub latency_score: f64,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct RepairSummary {
    pub success: bool,
    pub output_path: String,
    pub repaired_by: String,
    pub message: String,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct HardwareProfileSummary {
    pub best_encoder: String,
    pub priority: u32,
    pub bitrate: u32,
    pub preset: String,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct StorageBudgetResult {
    pub max_temp_bytes: u64,
    pub purge_threshold_ratio: f32,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct AccountCapabilityResult {
    pub account_id: String,
    pub source: String,
    pub max_file_size: u64,
}

#[uniffi::export(callback_interface)]
pub trait AutoGramEventListener: Send + Sync {
    fn on_event(&self, event_type: String, payload_json: String);
}

static LISTENER: RwLock<Option<Box<dyn AutoGramEventListener>>> = RwLock::new(None);
static INITIALIZED: AtomicBool = AtomicBool::new(false);
static STORAGE_DIR: RwLock<Option<PathBuf>> = RwLock::new(None);

#[derive(Debug, Clone, uniffi::Record)]
pub struct BridgeRuntimeStatus {
    pub initialized: bool,
    pub database_path: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct BridgeDriveItem {
    pub id: String,
    pub session_id: String,
    pub peer_id: String,
    pub topic_id: Option<i64>,
    pub parent_path: String,
    pub name: String,
    pub size: u64,
    pub mime_type: String,
    pub delivery_kind: String,
    pub telegram_category: String,
    pub is_folder: bool,
    pub modified_ms: i64,
    pub thumbnail_uri: Option<String>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct BridgeTransferTask {
    pub id: String,
    pub file_name: String,
    pub source_identity: String,
    pub destination_identity: String,
    pub stage: String,
    pub status: String,
    pub total_bytes: u64,
    pub processed_bytes: u64,
    pub speed_bps: u64,
    pub eta_seconds: u64,
    pub attempt: u32,
    pub paused: bool,
    pub error_code: Option<String>,
    pub updated_ms: i64,
}

fn database_path() -> Result<PathBuf, AutoGramBridgeError> {
    STORAGE_DIR
        .read()
        .as_ref()
        .map(|path| path.join("telegram_migrator.db"))
        .ok_or_else(|| AutoGramBridgeError::InternalError {
            msg: "runtime_not_initialized".to_string(),
        })
}

fn open_database() -> Result<Connection, AutoGramBridgeError> {
    let path = database_path()?;
    let conn = Connection::open(path).map_err(|error| AutoGramBridgeError::DatabaseError {
        msg: error.to_string(),
    })?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| AutoGramBridgeError::DatabaseError {
            msg: error.to_string(),
        })?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS android_drive_items (
             id TEXT NOT NULL,
             session_id TEXT NOT NULL,
             peer_id TEXT NOT NULL,
             topic_id INTEGER NOT NULL DEFAULT -1,
             parent_path TEXT NOT NULL,
             name TEXT NOT NULL,
             size_bytes INTEGER NOT NULL DEFAULT 0,
             mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
             delivery_kind TEXT NOT NULL DEFAULT 'document',
             telegram_category TEXT NOT NULL DEFAULT 'file',
             is_folder INTEGER NOT NULL DEFAULT 0,
             modified_ms INTEGER NOT NULL DEFAULT 0,
             thumbnail_uri TEXT,
             PRIMARY KEY(session_id, peer_id, topic_id, id)
         );
         CREATE INDEX IF NOT EXISTS idx_android_drive_parent
             ON android_drive_items(session_id, peer_id, topic_id, parent_path, is_folder, name);
         CREATE TABLE IF NOT EXISTS android_transfer_tasks (
             id TEXT PRIMARY KEY,
             file_name TEXT NOT NULL,
             source_identity TEXT NOT NULL,
             destination_identity TEXT NOT NULL,
             stage TEXT NOT NULL,
             status TEXT NOT NULL,
             total_bytes INTEGER NOT NULL DEFAULT 0,
             processed_bytes INTEGER NOT NULL DEFAULT 0,
             speed_bps INTEGER NOT NULL DEFAULT 0,
             eta_seconds INTEGER NOT NULL DEFAULT 0,
             attempt INTEGER NOT NULL DEFAULT 0,
             paused INTEGER NOT NULL DEFAULT 0,
             error_code TEXT,
             updated_ms INTEGER NOT NULL DEFAULT 0
         );
         CREATE INDEX IF NOT EXISTS idx_android_transfer_state
             ON android_transfer_tasks(status, updated_ms DESC);",
    )
    .map_err(|error| AutoGramBridgeError::DatabaseError {
        msg: error.to_string(),
    })?;
    // Forward-compatible local migration for installations created before the
    // Telegram-native category became part of the Android bridge contract.
    let _ = conn.execute(
        "ALTER TABLE android_drive_items ADD COLUMN telegram_category TEXT NOT NULL DEFAULT 'file'",
        [],
    );
    Ok(conn)
}

#[uniffi::export]
pub fn init_autogram_runtime(app_storage_dir: String) -> Result<String, AutoGramBridgeError> {
    if app_storage_dir.trim().is_empty() {
        return Err(AutoGramBridgeError::InternalError {
            msg: "storage_dir_required".to_string(),
        });
    }
    let storage_dir = PathBuf::from(app_storage_dir.trim());
    std::fs::create_dir_all(&storage_dir).map_err(|error| AutoGramBridgeError::InternalError {
        msg: error.to_string(),
    })?;
    *STORAGE_DIR.write() = Some(storage_dir.clone());
    std::env::set_var("AUTOGRAM_DB_PATH", storage_dir.join("telegram_migrator.db"));
    std::env::set_var("AUTOGRAM_STORAGE_DIR", &storage_dir);
    open_database()?;
    INITIALIZED.store(true, Ordering::SeqCst);
    Ok("runtime_initialized".to_string())
}

#[uniffi::export]
pub fn get_runtime_status() -> Result<BridgeRuntimeStatus, AutoGramBridgeError> {
    let path = database_path()?;
    Ok(BridgeRuntimeStatus {
        initialized: INITIALIZED.load(Ordering::SeqCst),
        database_path: path.to_string_lossy().into_owned(),
        schema_version: 2,
    })
}

#[uniffi::export]
pub fn list_drive_items(
    session_id: String,
    peer_id: String,
    topic_id: Option<i64>,
    parent_path: String,
) -> Result<Vec<BridgeDriveItem>, AutoGramBridgeError> {
    let conn = open_database()?;
    let mut statement = conn
        .prepare(
            "SELECT id, session_id, peer_id, topic_id, parent_path, name,
                    size_bytes, mime_type, delivery_kind, telegram_category,
                    is_folder, modified_ms, thumbnail_uri
             FROM android_drive_items
             WHERE session_id = ?1 AND peer_id = ?2
               AND topic_id = ?3 AND parent_path = ?4
             ORDER BY is_folder DESC, name COLLATE NOCASE ASC",
        )
        .map_err(|error| AutoGramBridgeError::DatabaseError {
            msg: error.to_string(),
        })?;
    let rows = statement
        .query_map(
            params![session_id, peer_id, topic_id.unwrap_or(-1), parent_path],
            |row| {
                Ok(BridgeDriveItem {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    peer_id: row.get(2)?,
                    topic_id: {
                        let value = row.get::<_, i64>(3)?;
                        (value >= 0).then_some(value)
                    },
                    parent_path: row.get(4)?,
                    name: row.get(5)?,
                    size: row.get::<_, i64>(6)?.max(0) as u64,
                    mime_type: row.get(7)?,
                    delivery_kind: row.get(8)?,
                    telegram_category: row.get(9)?,
                    is_folder: row.get::<_, i64>(10)? != 0,
                    modified_ms: row.get(11)?,
                    thumbnail_uri: row.get(12)?,
                })
            },
        )
        .map_err(|error| AutoGramBridgeError::DatabaseError {
            msg: error.to_string(),
        })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| AutoGramBridgeError::DatabaseError {
            msg: error.to_string(),
        })
}

#[uniffi::export]
pub fn upsert_drive_items(items: Vec<BridgeDriveItem>) -> Result<u32, AutoGramBridgeError> {
    let mut conn = open_database()?;
    let transaction = conn
        .transaction()
        .map_err(|error| AutoGramBridgeError::DatabaseError {
            msg: error.to_string(),
        })?;
    let mut changed = 0u32;
    {
        let mut statement = transaction
            .prepare_cached(
                "INSERT INTO android_drive_items (
                    id, session_id, peer_id, topic_id, parent_path, name, size_bytes,
                    mime_type, delivery_kind, telegram_category, is_folder,
                    modified_ms, thumbnail_uri
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                 ON CONFLICT(session_id, peer_id, topic_id, id) DO UPDATE SET
                    parent_path = excluded.parent_path,
                    name = excluded.name,
                    size_bytes = excluded.size_bytes,
                    mime_type = excluded.mime_type,
                    delivery_kind = excluded.delivery_kind,
                    telegram_category = excluded.telegram_category,
                    is_folder = excluded.is_folder,
                    modified_ms = excluded.modified_ms,
                    thumbnail_uri = excluded.thumbnail_uri",
            )
            .map_err(|error| AutoGramBridgeError::DatabaseError {
                msg: error.to_string(),
            })?;
        for item in &items {
            changed += statement
                .execute(params![
                    item.id,
                    item.session_id,
                    item.peer_id,
                    item.topic_id.unwrap_or(-1),
                    item.parent_path,
                    item.name,
                    item.size.min(i64::MAX as u64) as i64,
                    item.mime_type,
                    item.delivery_kind,
                    item.telegram_category,
                    item.is_folder as i64,
                    item.modified_ms,
                    item.thumbnail_uri,
                ])
                .map_err(|error| AutoGramBridgeError::DatabaseError {
                    msg: error.to_string(),
                })? as u32;
        }
    }
    transaction
        .commit()
        .map_err(|error| AutoGramBridgeError::DatabaseError {
            msg: error.to_string(),
        })?;
    emit_bridge_event(
        "drive_items_changed".to_string(),
        serde_json::json!({"count": changed}).to_string(),
    );
    Ok(changed)
}

#[uniffi::export]
pub fn delete_drive_items(ids: Vec<String>) -> Result<u32, AutoGramBridgeError> {
    if ids.is_empty() {
        return Ok(0);
    }
    let mut conn = open_database()?;
    let transaction = conn
        .transaction()
        .map_err(|error| AutoGramBridgeError::DatabaseError {
            msg: error.to_string(),
        })?;
    let mut changed = 0u32;
    for id in ids {
        changed += transaction
            .execute("DELETE FROM android_drive_items WHERE id = ?1", [id])
            .map_err(|error| AutoGramBridgeError::DatabaseError {
                msg: error.to_string(),
            })? as u32;
    }
    transaction
        .commit()
        .map_err(|error| AutoGramBridgeError::DatabaseError {
            msg: error.to_string(),
        })?;
    emit_bridge_event(
        "drive_items_changed".to_string(),
        serde_json::json!({"deleted": changed}).to_string(),
    );
    Ok(changed)
}

#[uniffi::export]
pub fn list_transfer_tasks() -> Result<Vec<BridgeTransferTask>, AutoGramBridgeError> {
    let conn = open_database()?;
    let mut statement = conn
        .prepare(
            "SELECT id, file_name, source_identity, destination_identity, stage, status,
                    total_bytes, processed_bytes, speed_bps, eta_seconds, attempt,
                    paused, error_code, updated_ms
             FROM android_transfer_tasks ORDER BY updated_ms DESC",
        )
        .map_err(|error| AutoGramBridgeError::DatabaseError {
            msg: error.to_string(),
        })?;
    let rows = statement
        .query_map([], |row| {
            Ok(BridgeTransferTask {
                id: row.get(0)?,
                file_name: row.get(1)?,
                source_identity: row.get(2)?,
                destination_identity: row.get(3)?,
                stage: row.get(4)?,
                status: row.get(5)?,
                total_bytes: row.get::<_, i64>(6)?.max(0) as u64,
                processed_bytes: row.get::<_, i64>(7)?.max(0) as u64,
                speed_bps: row.get::<_, i64>(8)?.max(0) as u64,
                eta_seconds: row.get::<_, i64>(9)?.max(0) as u64,
                attempt: row.get::<_, i64>(10)?.max(0) as u32,
                paused: row.get::<_, i64>(11)? != 0,
                error_code: row.get(12)?,
                updated_ms: row.get(13)?,
            })
        })
        .map_err(|error| AutoGramBridgeError::DatabaseError {
            msg: error.to_string(),
        })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| AutoGramBridgeError::DatabaseError {
            msg: error.to_string(),
        })
}

#[uniffi::export]
pub fn upsert_transfer_task(task: BridgeTransferTask) -> Result<String, AutoGramBridgeError> {
    let conn = open_database()?;
    let id = if task.id.trim().is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        task.id.clone()
    };
    conn.execute(
        "INSERT INTO android_transfer_tasks (
            id, file_name, source_identity, destination_identity, stage, status,
            total_bytes, processed_bytes, speed_bps, eta_seconds, attempt,
            paused, error_code, updated_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(id) DO UPDATE SET
            file_name = excluded.file_name,
            source_identity = excluded.source_identity,
            destination_identity = excluded.destination_identity,
            stage = excluded.stage,
            status = excluded.status,
            total_bytes = excluded.total_bytes,
            processed_bytes = excluded.processed_bytes,
            speed_bps = excluded.speed_bps,
            eta_seconds = excluded.eta_seconds,
            attempt = excluded.attempt,
            paused = excluded.paused,
            error_code = excluded.error_code,
            updated_ms = excluded.updated_ms",
        params![
            id,
            task.file_name,
            task.source_identity,
            task.destination_identity,
            task.stage,
            task.status,
            task.total_bytes.min(i64::MAX as u64) as i64,
            task.processed_bytes.min(i64::MAX as u64) as i64,
            task.speed_bps.min(i64::MAX as u64) as i64,
            task.eta_seconds.min(i64::MAX as u64) as i64,
            task.attempt,
            task.paused as i64,
            task.error_code,
            task.updated_ms,
        ],
    )
    .map_err(|error| AutoGramBridgeError::DatabaseError {
        msg: error.to_string(),
    })?;
    emit_bridge_event(
        "transfer_task_changed".to_string(),
        serde_json::json!({"id": id}).to_string(),
    );
    Ok(id)
}

#[uniffi::export]
pub fn set_transfer_paused(id: String, paused: bool) -> Result<bool, AutoGramBridgeError> {
    let conn = open_database()?;
    let changed = conn
        .execute(
            "UPDATE android_transfer_tasks
             SET paused = ?2,
                 status = CASE WHEN ?2 = 1 THEN 'paused'
                               WHEN status = 'paused' THEN 'queued'
                               ELSE status END,
                 updated_ms = CAST(strftime('%s','now') AS INTEGER) * 1000
             WHERE id = ?1",
            params![id, paused as i64],
        )
        .map_err(|error| AutoGramBridgeError::DatabaseError {
            msg: error.to_string(),
        })?;
    if changed > 0 {
        emit_bridge_event(
            "transfer_task_changed".to_string(),
            serde_json::json!({"id": id, "paused": paused}).to_string(),
        );
    }
    Ok(changed > 0)
}

#[uniffi::export]
pub fn register_event_listener(listener: Box<dyn AutoGramEventListener>) {
    let mut guard = LISTENER.write();
    *guard = Some(listener);
}

#[uniffi::export]
pub fn emit_bridge_event(event_type: String, payload_json: String) {
    if let Some(ref listener) = *LISTENER.read() {
        listener.on_event(event_type, payload_json);
    }
}

#[uniffi::export]
pub fn get_account_scores() -> Result<Vec<AccountScoreResult>, AutoGramBridgeError> {
    Ok(Vec::new())
}

#[uniffi::export]
pub fn run_container_repair(
    input_path: String,
    output_path: String,
) -> Result<RepairSummary, AutoGramBridgeError> {
    let input = PathBuf::from(&input_path);
    let output = PathBuf::from(&output_path);
    let res = autogram_core::repair_mp4_container(&input, &output)
        .map_err(|e| AutoGramBridgeError::MediaError { msg: e })?;

    Ok(RepairSummary {
        success: res.success,
        output_path: res.output_path,
        repaired_by: res.repaired_by,
        message: res.message,
    })
}

#[uniffi::export]
pub fn get_hardware_profiles() -> Result<HardwareProfileSummary, AutoGramBridgeError> {
    let enc = autogram_core::HardwareEncoderType::MediaCodec;
    let info = autogram_core::select_best_hardware_profile(enc);

    let (bitrate, preset) = match info.default_profile {
        autogram_core::EncoderQualityProfile::HighQuality { bitrate, preset } => (bitrate, preset),
        autogram_core::EncoderQualityProfile::Balanced { bitrate, preset } => (bitrate, preset),
        autogram_core::EncoderQualityProfile::HighSpeed { bitrate, preset } => (bitrate, preset),
    };

    Ok(HardwareProfileSummary {
        best_encoder: info.best_encoder,
        priority: info.priority,
        bitrate,
        preset,
    })
}

#[uniffi::export]
pub fn get_storage_budget() -> Result<StorageBudgetResult, AutoGramBridgeError> {
    let budget = autogram_core::StorageBudget::default();
    Ok(StorageBudgetResult {
        max_temp_bytes: budget.max_temp_bytes,
        purge_threshold_ratio: budget.purge_threshold_ratio,
    })
}

#[uniffi::export]
pub fn plan_batch_execution_summary(
    total_files: u32,
    total_bytes: u64,
) -> Result<String, AutoGramBridgeError> {
    let summary = serde_json::json!({
        "status": "planned",
        "totalFiles": total_files,
        "totalBytes": total_bytes,
        "maxPartLimit": 2147483648u64,
        "engine": "AutoGram Batch Optimizer v4"
    });
    Ok(summary.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persists_scoped_drive_items_and_transfer_pause_state() {
        let root = std::env::current_dir()
            .expect("bridge cwd")
            .join("target")
            .join("test-data")
            .join(uuid::Uuid::new_v4().to_string());
        init_autogram_runtime(root.to_string_lossy().into_owned()).expect("runtime init");

        let item = BridgeDriveItem {
            id: "message-42".into(),
            session_id: "session-a".into(),
            peer_id: "peer-a".into(),
            topic_id: Some(7),
            parent_path: "/".into(),
            name: "photo.jpg".into(),
            size: 42,
            mime_type: "image/jpeg".into(),
            delivery_kind: "media".into(),
            telegram_category: "photo".into(),
            is_folder: false,
            modified_ms: 1,
            thumbnail_uri: None,
        };
        assert_eq!(upsert_drive_items(vec![item]).expect("upsert item"), 1);
        let items = list_drive_items("session-a".into(), "peer-a".into(), Some(7), "/".into())
            .expect("list items");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].delivery_kind, "media");
        assert_eq!(items[0].telegram_category, "photo");

        let task_id = upsert_transfer_task(BridgeTransferTask {
            id: String::new(),
            file_name: "example.com".into(),
            source_identity: "https://example.com/video.mp4".into(),
            destination_identity: "remote-link".into(),
            stage: "resolve".into(),
            status: "queued".into(),
            total_bytes: 100,
            processed_bytes: 0,
            speed_bps: 0,
            eta_seconds: 0,
            attempt: 0,
            paused: false,
            error_code: None,
            updated_ms: 2,
        })
        .expect("upsert transfer");
        assert!(set_transfer_paused(task_id.clone(), true).expect("pause transfer"));
        let tasks = list_transfer_tasks().expect("list transfers");
        let task = tasks
            .iter()
            .find(|task| task.id == task_id)
            .expect("task persisted");
        assert!(task.paused);
        assert_eq!(task.status, "paused");

        std::fs::remove_dir_all(&root).expect("remove isolated test directory");
    }
}
