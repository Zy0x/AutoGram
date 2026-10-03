use super::*;
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    path::Path,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

pub(crate) const SCHEMA: &str =
    include_str!("../../../../../database/migrations/025_native_cloud_downloads.sql");
const SELECT: &str = "SELECT request_json,state,checkpoint_bytes,checkpoint_sha256,
    actual_sha256,attempts,error_code,retry_after_ms,file_identity,created_ms,updated_ms FROM native_cloud_downloads";

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

#[derive(Clone)]
pub struct DownloadStore {
    connection: Arc<Mutex<Connection>>,
}

impl DownloadStore {
    #[cfg(test)]
    pub(super) fn close_fixture(&self) {
        *self.connection.lock() = Connection::open_in_memory().unwrap();
    }
    /// Opens only the selected database; never resolves sessions or scans legacy jobs.
    pub fn open(path: &Path) -> Result<Self, DownloadError> {
        if !path.is_absolute() {
            return Err(DownloadError::InvalidRequest);
        }
        let conn = Connection::open(path).map_err(|_| DownloadError::Database)?;
        conn.execute_batch(SCHEMA)
            .map_err(|_| DownloadError::Database)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(conn)),
        })
    }

    /// Scheduling must retain recoverable jobs even while their FloodWait deadline is future.
    /// This is not a dispatch query: callers still use pending(), which enforces the deadline.
    pub fn has_recoverable_jobs(&self) -> Result<bool, DownloadError> {
        self.connection.lock().query_row(
            "SELECT EXISTS(SELECT 1 FROM native_cloud_downloads WHERE state IN ('queued','running','publishing'))",
            [], |row| row.get(0),
        ).map_err(|_| DownloadError::Database)
    }

    pub fn enqueue(&self, request: DownloadRequest) -> Result<DownloadRecord, DownloadError> {
        request.validate()?;
        let request = DownloadRequest::new(
            request.operation_id().into(),
            request.source().clone(),
            request.expected_size(),
            request.expected_sha256().map(str::to_owned),
            super::files::normalize_target(request.temp_path())?,
            super::files::normalize_target(request.output_path())?,
        )?;
        let json = serde_json::to_string(&request).map_err(|_| DownloadError::InvalidRequest)?;
        let temp_key = path_key(request.temp_path())?;
        let output_key = path_key(request.output_path())?;
        if temp_key == output_key {
            return Err(DownloadError::InvalidRequest);
        }
        let mut conn = self.connection.lock();
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| DownloadError::Database)?;
        let existing: Option<String> = tx
            .query_row(
                "SELECT request_json FROM native_cloud_downloads WHERE operation_id=?1",
                [request.operation_id()],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| DownloadError::Database)?;
        if let Some(existing) = existing {
            if existing != json {
                return Err(DownloadError::OperationConflict);
            }
        } else {
            let collision: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM native_cloud_downloads
                WHERE temp_path IN (?1,?2) OR output_path IN (?1,?2))",
                    params![temp_key, output_key],
                    |r| r.get(0),
                )
                .map_err(|_| DownloadError::Database)?;
            if collision {
                return Err(DownloadError::OperationConflict);
            }
            tx.execute(
                "INSERT INTO native_cloud_downloads
                (operation_id,account_id,authorized_user_id,request_json,temp_path,output_path,
                 expected_size,checkpoint_sha256,created_ms,updated_ms)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
                params![
                    request.operation_id(),
                    request.source().scope().account_id(),
                    request.source().scope().authorized_user_id(),
                    json,
                    temp_key,
                    output_key,
                    request.expected_size() as i64,
                    crate::transfer::download::sha256_bytes(b""),
                    now_ms()
                ],
            )
            .map_err(|_| DownloadError::Database)?;
        }
        tx.commit().map_err(|_| DownloadError::Database)?;
        drop(conn);
        self.get(request.operation_id(), request.source().scope())
    }

    pub fn get(&self, id: &str, scope: &AccountScope) -> Result<DownloadRecord, DownloadError> {
        let conn = self.connection.lock();
        let record = conn
            .query_row(&format!("{SELECT} WHERE operation_id=?1"), [id], decode)
            .optional()
            .map_err(|_| DownloadError::Database)?
            .ok_or(DownloadError::NotFound)?;
        if record.request.source().scope() != scope {
            return Err(DownloadError::WrongScope);
        }
        record.request.validate()?;
        Ok(record)
    }

    /// Explicit queue inspection, with a bounded stable operation-key cursor. Never executes rows.
    pub fn list(
        &self,
        scope: &AccountScope,
        after_id: &str,
        limit: usize,
    ) -> Result<Vec<DownloadRecord>, DownloadError> {
        if limit == 0 || limit > 1000 {
            return Err(DownloadError::InvalidRequest);
        }
        let conn = self.connection.lock();
        let mut stmt = conn
            .prepare(&format!(
                "{SELECT} WHERE account_id=?1 AND authorized_user_id=?2
            AND operation_id>?3 ORDER BY operation_id LIMIT ?4"
            ))
            .map_err(|_| DownloadError::Database)?;
        let values = stmt
            .query_map(
                params![
                    scope.account_id(),
                    scope.authorized_user_id(),
                    after_id,
                    limit as i64
                ],
                decode,
            )
            .map_err(|_| DownloadError::Database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| DownloadError::Database)?;
        for value in &values {
            value.request.validate()?;
            if value.request.source().scope() != scope {
                return Err(DownloadError::WrongScope);
            }
        }
        Ok(values)
    }

    /// Bounded native-worker dispatch inspection only. Frozen scope is not live authorization.
    /// The caller must server-revalidate every returned account before run/recover.
    /// Paused/failed/cancelled/completed and future FloodWait deadlines are excluded.
    pub fn pending(&self, limit: usize) -> Result<Vec<DownloadRecord>, DownloadError> {
        if limit == 0 || limit > 1000 {
            return Err(DownloadError::InvalidRequest);
        }
        let conn = self.connection.lock();
        let mut stmt = conn
            .prepare(&format!(
                "{SELECT} WHERE state IN ('queued','running','publishing')
            AND (retry_after_ms IS NULL OR retry_after_ms <= ?1-updated_ms)
            ORDER BY created_ms,operation_id LIMIT ?2"
            ))
            .map_err(|_| DownloadError::Database)?;
        let values = stmt
            .query_map(params![now_ms(), limit as i64], decode)
            .map_err(|_| DownloadError::Database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| DownloadError::Database)?;
        for value in &values {
            value.request.validate()?;
        }
        Ok(values)
    }

    pub fn pause(&self, id: &str, scope: &AccountScope) -> Result<(), DownloadError> {
        self.request_control(id, scope, "pause")
    }
    /// Preflight authorization failure cannot demote a concurrently claimed/running operation.
    pub fn fail_queued_source(&self, id: &str, scope: &AccountScope, failure: SourceFailure)
        -> Result<(), DownloadError> {
        self.get(id, scope)?;
        let retry = match failure { SourceFailure::FloodWait { retry_after_ms } => Some(retry_after_ms.min(i64::MAX as u64) as i64), _ => None };
        self.connection.lock().execute("UPDATE native_cloud_downloads SET state='failed',
            error_code=?2,retry_after_ms=?3,updated_ms=?4 WHERE operation_id=?1 AND state='queued'",
            params![id, DownloadError::Source(failure).code(), retry, now_ms()])
            .map_err(|_| DownloadError::Database)?;
        Ok(())
    }
    pub fn cancel(&self, id: &str, scope: &AccountScope) -> Result<(), DownloadError> {
        self.request_control(id, scope, "cancel")
    }
    fn request_control(
        &self,
        id: &str,
        scope: &AccountScope,
        control: &str,
    ) -> Result<(), DownloadError> {
        self.get(id, scope)?;
        let conn = self.connection.lock();
        let changed = conn.execute("UPDATE native_cloud_downloads SET
            control=CASE WHEN state='running' THEN ?2 ELSE NULL END,
            state=CASE WHEN state='running' THEN state WHEN ?2='pause' THEN 'paused' ELSE 'cancelled' END,
            updated_ms=?3 WHERE operation_id=?1 AND state IN ('queued','running','paused','failed')
            AND (control IS NULL OR control=?2 OR ?2='cancel')", params![id, control, now_ms()])
            .map_err(|_| DownloadError::Database)?;
        if changed != 1 {
            return Err(DownloadError::InvalidState);
        }
        Ok(())
    }

    /// Resume/retry is an explicit decision. Cancelled and completed rows are terminal.
    pub fn retry(&self, id: &str, scope: &AccountScope) -> Result<(), DownloadError> {
        self.get(id, scope)?;
        let conn = self.connection.lock();
        let changed = conn
            .execute(
                "UPDATE native_cloud_downloads SET state='queued',control=NULL,
            error_code=NULL,retry_after_ms=NULL,updated_ms=?2 WHERE operation_id=?1
            AND state IN ('paused','failed') AND
            (retry_after_ms IS NULL OR retry_after_ms <= ?2-updated_ms)",
                params![id, now_ms()],
            )
            .map_err(|_| DownloadError::Database)?;
        if changed != 1 {
            return Err(DownloadError::InvalidState);
        }
        Ok(())
    }

    pub(crate) fn attach_file(&self, id: &str, identity: &str) -> Result<(), DownloadError> {
        let changed = self
            .connection
            .lock()
            .execute(
                "UPDATE native_cloud_downloads SET file_identity=?2,
            updated_ms=?3 WHERE operation_id=?1 AND file_identity IS NULL
            AND state IN ('queued','paused','cancelled')",
                params![id, identity, now_ms()],
            )
            .map_err(|_| DownloadError::Database)?;
        if changed != 1 {
            return Err(DownloadError::InvalidState);
        }
        Ok(())
    }

    // Called only while holding the staging file's OS-exclusive lock. Recovery cannot steal an active handle.
    pub(crate) fn claim(&self, id: &str, recovery: bool) -> Result<(), DownloadError> {
        let states = if recovery {
            "('running','publishing')"
        } else {
            "('queued')"
        };
        let changed = self
            .connection
            .lock()
            .execute(
                &format!(
                    "UPDATE native_cloud_downloads SET
            state=CASE WHEN state='publishing' THEN state ELSE 'running' END,
            attempts=attempts+1,error_code=NULL,retry_after_ms=NULL,updated_ms=?2
            WHERE operation_id=?1 AND file_identity IS NOT NULL AND state IN {states}
            AND (retry_after_ms IS NULL OR retry_after_ms <= ?2-updated_ms)"
                ),
                params![id, now_ms()],
            )
            .map_err(|_| DownloadError::Database)?;
        if changed != 1 {
            return Err(DownloadError::InvalidState);
        }
        Ok(())
    }

    pub(crate) fn checkpoint(&self, id: &str, bytes: u64, hash: &str) -> Result<(), DownloadError> {
        let changed = self
            .connection
            .lock()
            .execute(
                "UPDATE native_cloud_downloads SET
            checkpoint_bytes=?2,checkpoint_sha256=?3,updated_ms=?4
            WHERE operation_id=?1 AND state='running' AND checkpoint_bytes<=?2",
                params![id, bytes as i64, hash, now_ms()],
            )
            .map_err(|_| DownloadError::Database)?;
        if changed != 1 {
            return Err(DownloadError::InvalidState);
        }
        Ok(())
    }

    pub(crate) fn stop_if_requested(&self, id: &str) -> Result<bool, DownloadError> {
        let changed = self.connection.lock().execute("UPDATE native_cloud_downloads SET
            state=CASE control WHEN 'cancel' THEN 'cancelled' ELSE 'paused' END,
            control=NULL,updated_ms=?2 WHERE operation_id=?1 AND state='running' AND control IS NOT NULL",
            params![id, now_ms()]).map_err(|_| DownloadError::Database)?;
        Ok(changed == 1)
    }

    pub(crate) fn publishing(&self, id: &str, hash: &str) -> Result<bool, DownloadError> {
        let changed = self.connection.lock().execute("UPDATE native_cloud_downloads SET state='publishing',
            actual_sha256=?2,updated_ms=?3 WHERE operation_id=?1 AND state='running' AND control IS NULL
            AND checkpoint_bytes=expected_size", params![id, hash, now_ms()])
            .map_err(|_| DownloadError::Database)?;
        Ok(changed == 1)
    }
    pub(crate) fn completed(&self, id: &str) -> Result<(), DownloadError> {
        let changed = self
            .connection
            .lock()
            .execute(
                "UPDATE native_cloud_downloads SET state='completed',
            error_code=NULL,updated_ms=?2 WHERE operation_id=?1 AND state='publishing'",
                params![id, now_ms()],
            )
            .map_err(|_| DownloadError::Database)?;
        if changed != 1 {
            return Err(DownloadError::InvalidState);
        }
        Ok(())
    }

    pub(crate) fn failed(&self, id: &str, error: &DownloadError) -> Result<(), DownloadError> {
        let retry = match error {
            DownloadError::Source(SourceFailure::FloodWait { retry_after_ms }) => {
                Some((*retry_after_ms).min(i64::MAX as u64) as i64)
            }
            _ => None,
        };
        // Publication is a recoverable commit protocol: never demote it and start writing again.
        self.connection.lock().execute("UPDATE native_cloud_downloads SET
            state=CASE WHEN state='publishing' THEN state
                       WHEN control='cancel' THEN 'cancelled' WHEN control='pause' THEN 'paused' ELSE 'failed' END,
            control=NULL,error_code=?2,retry_after_ms=?3,updated_ms=?4
            WHERE operation_id=?1 AND state IN ('running','publishing')",
            params![id, error.code(), retry, now_ms()]).map_err(|_| DownloadError::Database)?;
        Ok(())
    }
}

fn path_key(path: &Path) -> Result<String, DownloadError> {
    let value = path
        .to_str()
        .ok_or(DownloadError::InvalidRequest)?
        .to_owned();
    #[cfg(windows)]
    let value = value.to_lowercase();
    Ok(value)
}

fn decode(row: &rusqlite::Row<'_>) -> rusqlite::Result<DownloadRecord> {
    let json: String = row.get(0)?;
    let request = serde_json::from_str(&json).map_err(|_| rusqlite::Error::InvalidQuery)?;
    let state: String = row.get(1)?;
    Ok(DownloadRecord {
        request,
        state: DownloadState::parse(&state).map_err(|_| rusqlite::Error::InvalidQuery)?,
        checkpoint_bytes: row.get(2)?,
        checkpoint_sha256: row.get(3)?,
        actual_sha256: row.get(4)?,
        attempts: row.get(5)?,
        error_code: row.get(6)?,
        retry_after_ms: row.get(7)?,
        file_identity: row.get(8)?,
        created_ms: row.get(9)?,
        updated_ms: row.get(10)?,
    })
}
