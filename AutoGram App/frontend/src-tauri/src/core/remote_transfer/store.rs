use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use super::models::{
    RemoteRecoveryItem, RemoteResolverState, RemoteTransferEvent, RemoteTransferJob, RemoteTransferMode,
    RemoteTransferState, StorageLocalPolicy,
};
use super::spool::{job_manifest_path, job_part_path, read_manifest, resolve_spool_root};

const SCHEMA_019: &str = include_str!("../../../../../database/migrations/019_remote_transfers.sql");
const SCHEMA_022: &str = include_str!("../../../../../database/migrations/022_remote_resolver_state.sql");

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub struct RemoteTransferStore;

impl RemoteTransferStore {
    pub fn get_connection() -> Result<Connection, String> {
        let path = crate::core::jobs_db::resolve_migrator_db();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(&path).map_err(|e| format!("open remote transfers db: {e}"))?;
        conn.execute_batch(
            "PRAGMA foreign_keys=ON;
             PRAGMA busy_timeout=15000;
             PRAGMA journal_mode=WAL;",
        )
        .map_err(|e| format!("pragma: {e}"))?;
        Self::ensure_schema(&conn)?;
        Ok(conn)
    }

    pub fn ensure_schema(conn: &Connection) -> Result<(), String> {
        conn.execute_batch(SCHEMA_019)
            .map_err(|e| format!("migration 019 failed: {e}"))?;
        conn.execute_batch(SCHEMA_022)
            .map_err(|e| format!("migration 022 failed: {e}"))?;
        Ok(())
    }

    pub fn upsert_resolver_state(state: &RemoteResolverState) -> Result<(), String> {
        let conn = Self::get_connection()?;
        let sanitized_url = redact_url(&state.source_final_url);
        let provenance = sanitize_json(&state.provenance);
        let cursor = sanitize_json_option(state.discovery_cursor.as_ref());
        let provenance_json = serde_json::to_string(&provenance)
            .map_err(|e| format!("serialize resolver provenance: {e}"))?;
        let cursor_json = cursor
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| format!("serialize resolver cursor: {e}"))?;
        let updated_at_ms = if state.updated_at_ms > 0 { state.updated_at_ms } else { now_ms() };

        conn.execute(
            "INSERT INTO remote_transfer_resolver_state (
                job_id, resolver_version, source_final_url, provenance_json,
                discovery_cursor_json, expires_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(job_id) DO UPDATE SET
                resolver_version = excluded.resolver_version,
                source_final_url = excluded.source_final_url,
                provenance_json = excluded.provenance_json,
                discovery_cursor_json = excluded.discovery_cursor_json,
                expires_at_ms = excluded.expires_at_ms,
                updated_at_ms = excluded.updated_at_ms",
            params![
                state.job_id,
                state.resolver_version as i64,
                sanitized_url,
                provenance_json,
                cursor_json,
                state.expires_at_ms,
                updated_at_ms,
            ],
        )
        .map_err(|e| format!("upsert remote resolver state: {e}"))?;
        Ok(())
    }

    pub fn get_resolver_state(job_id: &str) -> Result<Option<RemoteResolverState>, String> {
        let conn = Self::get_connection()?;
        conn.query_row(
            "SELECT job_id, resolver_version, source_final_url, provenance_json,
                    discovery_cursor_json, expires_at_ms, updated_at_ms
             FROM remote_transfer_resolver_state WHERE job_id = ?1",
            params![job_id],
            |row| {
                let provenance_text: String = row.get(3)?;
                let cursor_text: Option<String> = row.get(4)?;
                Ok(RemoteResolverState {
                    job_id: row.get(0)?,
                    resolver_version: row.get::<_, i64>(1)?.max(1) as u32,
                    source_final_url: row.get(2)?,
                    provenance: serde_json::from_str(&provenance_text).unwrap_or(serde_json::Value::Null),
                    discovery_cursor: cursor_text.and_then(|value| serde_json::from_str(&value).ok()),
                    expires_at_ms: row.get(5)?,
                    updated_at_ms: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("get remote resolver state: {e}"))
    }

    pub fn insert_job(job: &RemoteTransferJob) -> Result<(), String> {
        let conn = Self::get_connection()?;
        conn.execute(
            "INSERT OR REPLACE INTO remote_transfer_jobs (
                job_id, account_id, source_url, source_filename, source_mime, source_size,
                source_etag, source_last_modified, mode, storage_policy, custom_disk_path,
                spool_path, downloaded_bytes, uploaded_bytes, checksum_sha256, destination_type,
                destination_id, destination_topic_id, telegram_message_id, state, cleanup_state,
                retry_count, last_error, created_at_ms, updated_at_ms, completed_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26)",
            params![
                job.job_id,
                job.account_id,
                job.source_url,
                job.source_filename,
                job.source_mime,
                job.source_size.map(|s| s as i64),
                job.source_etag,
                job.source_last_modified,
                job.mode.as_str(),
                job.storage_policy.as_str(),
                job.custom_disk_path,
                job.spool_path,
                job.downloaded_bytes as i64,
                job.uploaded_bytes as i64,
                job.checksum_sha256,
                job.destination_type,
                job.destination_id,
                job.destination_topic_id,
                job.telegram_message_id,
                job.state.as_str(),
                job.cleanup_state,
                job.retry_count,
                job.last_error,
                job.created_at_ms,
                job.updated_at_ms,
                job.completed_at_ms,
            ],
        )
        .map_err(|e| format!("insert remote job: {e}"))?;
        Ok(())
    }

    pub fn update_job_state(
        job_id: &str,
        state: RemoteTransferState,
        error: Option<&str>,
    ) -> Result<(), String> {
        let conn = Self::get_connection()?;
        let updated_at = now_ms();
        let completed_at = if state.is_terminal() {
            Some(updated_at)
        } else {
            None
        };
        conn.execute(
            "UPDATE remote_transfer_jobs SET state = ?1, last_error = ?2, updated_at_ms = ?3, completed_at_ms = COALESCE(completed_at_ms, ?4) WHERE job_id = ?5",
            params![state.as_str(), error, updated_at, completed_at, job_id],
        )
        .map_err(|e| format!("update remote job state: {e}"))?;
        Ok(())
    }

    pub fn update_job_download_progress(
        job_id: &str,
        downloaded: u64,
        total: Option<u64>,
    ) -> Result<(), String> {
        let conn = Self::get_connection()?;
        let updated_at = now_ms();
        conn.execute(
            "UPDATE remote_transfer_jobs SET downloaded_bytes = ?1, source_size = COALESCE(?2, source_size), updated_at_ms = ?3 WHERE job_id = ?4",
            params![downloaded as i64, total.map(|s| s as i64), updated_at, job_id],
        )
        .map_err(|e| format!("update remote job download: {e}"))?;
        Ok(())
    }

    pub fn update_job_upload_progress(job_id: &str, uploaded: u64) -> Result<(), String> {
        let conn = Self::get_connection()?;
        let updated_at = now_ms();
        conn.execute(
            "UPDATE remote_transfer_jobs SET uploaded_bytes = ?1, updated_at_ms = ?2 WHERE job_id = ?3",
            params![uploaded as i64, updated_at, job_id],
        )
        .map_err(|e| format!("update remote job upload: {e}"))?;
        Ok(())
    }

    pub fn mark_job_completed(
        job_id: &str,
        message_id: Option<i64>,
        checksum: Option<&str>,
    ) -> Result<(), String> {
        let conn = Self::get_connection()?;
        let ts = now_ms();
        conn.execute(
            "UPDATE remote_transfer_jobs SET state = 'done', telegram_message_id = COALESCE(?1, telegram_message_id), checksum_sha256 = COALESCE(?2, checksum_sha256), updated_at_ms = ?3, completed_at_ms = ?3 WHERE job_id = ?4",
            params![message_id, checksum, ts, job_id],
        )
        .map_err(|e| format!("complete remote job: {e}"))?;
        Ok(())
    }

    pub fn get_job(job_id: &str) -> Result<Option<RemoteTransferJob>, String> {
        let conn = Self::get_connection()?;
        let mut stmt = conn
            .prepare(
                "SELECT job_id, account_id, source_url, source_filename, source_mime, source_size,
                        source_etag, source_last_modified, mode, storage_policy, custom_disk_path,
                        spool_path, downloaded_bytes, uploaded_bytes, checksum_sha256, destination_type,
                        destination_id, destination_topic_id, telegram_message_id, state, cleanup_state,
                        retry_count, last_error, created_at_ms, updated_at_ms, completed_at_ms
                 FROM remote_transfer_jobs WHERE job_id = ?1",
            )
            .map_err(|e| format!("prepare get_job: {e}"))?;

        let res = stmt
            .query_row(params![job_id], |row| {
                let size_i64: Option<i64> = row.get(5)?;
                let dl_i64: i64 = row.get(12)?;
                let up_i64: i64 = row.get(13)?;
                let mode_str: String = row.get(8)?;
                let policy_str: String = row.get(9)?;
                let state_str: String = row.get(19)?;

                Ok(RemoteTransferJob {
                    job_id: row.get(0)?,
                    account_id: row.get(1)?,
                    source_url: row.get(2)?,
                    source_filename: row.get(3)?,
                    source_mime: row.get(4)?,
                    source_size: size_i64.map(|s| s.max(0) as u64),
                    source_etag: row.get(6)?,
                    source_last_modified: row.get(7)?,
                    thumbnail_url: None,
                    mode: RemoteTransferMode::from_str_lenient(&mode_str),
                    storage_policy: StorageLocalPolicy::from_str_lenient(&policy_str),
                    custom_disk_path: row.get(10)?,
                    spool_path: row.get(11)?,
                    downloaded_bytes: dl_i64.max(0) as u64,
                    uploaded_bytes: up_i64.max(0) as u64,
                    checksum_sha256: row.get(14)?,
                    destination_type: row.get(15)?,
                    destination_id: row.get(16)?,
                    destination_topic_id: row.get(17)?,
                    telegram_message_id: row.get(18)?,
                    state: RemoteTransferState::from_str_lenient(&state_str),
                    cleanup_state: row.get(20)?,
                    retry_count: row.get::<_, i64>(21)? as u32,
                    last_error: row.get(22)?,
                    created_at_ms: row.get(23)?,
                    updated_at_ms: row.get(24)?,
                    completed_at_ms: row.get(25)?,
                })
            })
            .optional()
            .map_err(|e| format!("query get_job: {e}"))?;

        Ok(res)
    }

    pub fn append_event(job_id: &str, event_type: &str, payload: Option<&str>) -> Result<(), String> {
        let conn = Self::get_connection()?;
        let ts = now_ms();
        conn.execute(
            "INSERT INTO remote_transfer_events (job_id, event_type, payload, created_at_ms) VALUES (?1, ?2, ?3, ?4)",
            params![job_id, event_type, payload, ts],
        )
        .map_err(|e| format!("append event: {e}"))?;
        Ok(())
    }

    pub fn list_recoverable_jobs() -> Result<Vec<RemoteRecoveryItem>, String> {
        let spool_root = resolve_spool_root();
        let mut items = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&spool_root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|ext| ext == "manifest")
                    || path.to_string_lossy().ends_with(".manifest.json")
                {
                    let filename = path.file_name().unwrap_or_default().to_string_lossy();
                    let job_id = filename
                        .trim_end_matches(".manifest.json")
                        .trim_end_matches(".manifest");
                    if let Some(manifest) = read_manifest(job_id) {
                        let part_p = job_part_path(job_id);
                        let part_size = std::fs::metadata(&part_p)
                            .map(|m| m.len())
                            .unwrap_or(manifest.downloaded_bytes);
                        let job = Self::get_job(job_id).ok().flatten();
                        let state = job
                            .as_ref()
                            .map(|j| j.state.as_str().to_string())
                            .unwrap_or(manifest.status);
                        let is_done = state == "done";
                        if !is_done && part_size > 0 {
                            items.push(RemoteRecoveryItem {
                                job_id: job_id.to_string(),
                                source_url: manifest.source_url,
                                filename: manifest.filename,
                                downloaded_bytes: part_size,
                                total_size_bytes: manifest.total_size,
                                part_path: part_p.to_string_lossy().to_string(),
                                manifest_path: path.to_string_lossy().to_string(),
                                state,
                                created_at_ms: manifest.created_at_ms,
                                reason: "Interrupted transfer checkpoint found on disk".to_string(),
                                can_resume: true,
                            });
                        }
                    }
                }
            }
        }
        Ok(items)
    }
}

fn sanitize_json_option(value: Option<&serde_json::Value>) -> Option<serde_json::Value> {
    value.map(sanitize_json)
}

fn sanitize_json(value: &serde_json::Value) -> serde_json::Value {
    const SENSITIVE_KEYS: &[&str] = &[
        "authorization", "cookie", "cookies", "credential", "password", "session", "token",
        "api_key", "apikey", "signature", "sig",
    ];
    match value {
        serde_json::Value::Object(object) => serde_json::Value::Object(
            object
                .iter()
                .filter(|(key, _)| {
                    let lower = key.to_ascii_lowercase();
                    !SENSITIVE_KEYS.iter().any(|needle| lower.contains(needle))
                })
                .map(|(key, value)| (key.clone(), sanitize_json(value)))
                .collect(),
        ),
        serde_json::Value::Array(values) => {
            serde_json::Value::Array(values.iter().map(sanitize_json).collect())
        }
        serde_json::Value::String(value) if value.starts_with("http://") || value.starts_with("https://") => {
            serde_json::Value::String(redact_url(value))
        }
        _ => value.clone(),
    }
}

fn redact_url(value: &str) -> String {
    match url::Url::parse(value) {
        Ok(mut url) => {
            url.set_query(None);
            url.set_fragment(None);
            url.to_string()
        }
        Err(_) => "[invalid-url]".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolver_provenance_never_persists_secrets_or_signed_queries() {
        let value = serde_json::json!({
            "source": "https://cdn.example/media.mp4?token=secret&expire=10",
            "authorization": "Bearer secret",
            "nested": { "cookie": "private", "parent": "https://site.example/watch?a=b" },
        });
        let safe = sanitize_json(&value);
        let serialized = safe.to_string();
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("authorization"));
        assert!(!serialized.contains("cookie"));
        assert!(serialized.contains("https://cdn.example/media.mp4"));
        assert!(!serialized.contains("?token"));
    }

    #[test]
    fn invalid_final_url_fails_closed_for_persistence() {
        assert_eq!(redact_url("not a url"), "[invalid-url]");
    }
}
