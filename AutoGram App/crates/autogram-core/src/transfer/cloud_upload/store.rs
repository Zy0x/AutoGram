use super::*;
use crate::transfer::cloud_download::AccountScope;
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::{
    fs::{File, OpenOptions},
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

pub(super) const SCHEMA: &str =
    include_str!("../../../../../database/migrations/026_native_cloud_uploads.sql");
const V4: &str =
    include_str!("../../../../../database/migrations/015_transfer_control_plane_v4.sql");
const SELECT: &str = "SELECT request_json,state,file_id,acknowledged_parts,uploaded_bytes,epoch,
    control,retry_not_before_ms,error_code,receipt_json FROM native_cloud_uploads";
pub(super) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
pub(super) fn random_nonzero() -> i64 {
    loop {
        let value = rand::random();
        if value != 0 {
            return value;
        }
    }
}

#[derive(Clone)]
pub struct UploadStore {
    pub(super) connection: Arc<Mutex<Connection>>,
    lock_root: PathBuf,
}
impl UploadStore {
    #[cfg(test)]
    pub(super) fn connection_for_fixture(&self) -> parking_lot::MutexGuard<'_, Connection> {
        self.connection.lock()
    }
    pub fn open(path: &Path) -> Result<Self, UploadError> {
        if !path.is_absolute() {
            return Err(UploadError::InvalidRequest);
        }
        let conn = Connection::open(path).map_err(|_| UploadError::Database)?;
        conn.execute_batch(V4).map_err(|_| UploadError::Database)?;
        conn.execute_batch(SCHEMA)
            .map_err(|_| UploadError::Database)?;
        conn.execute_batch(super::part_recovery::SCHEMA)
            .map_err(|_| UploadError::Database)?;
        let lock_root = path
            .parent()
            .ok_or(UploadError::InvalidRequest)?
            .join("native-upload-locks");
        std::fs::create_dir_all(&lock_root).map_err(|_| UploadError::Io)?;
        let lock_root = std::fs::canonicalize(lock_root).map_err(|_| UploadError::Io)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(conn)),
            lock_root,
        })
    }

    pub fn enqueue(&self, request: UploadRequest) -> Result<UploadRecord, UploadError> {
        request.validate()?;
        let json = serde_json::to_string(&request).map_err(|_| UploadError::InvalidRequest)?;
        let mut conn = self.connection.lock();
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| UploadError::Database)?;
        let existing: Option<String> = tx
            .query_row(
                "SELECT request_json FROM native_cloud_uploads WHERE operation_id=?1",
                [&request.operation_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| UploadError::Database)?;
        if let Some(existing) = existing {
            if existing != json {
                return Err(UploadError::Conflict);
            }
        } else {
            let now = now_ms();
            tx.execute("INSERT INTO transfer_runs(transfer_id,profile_snapshot_json,state,created_at,updated_at)
                VALUES (?1,?2,'QUEUED',?3,?3)", params![request.operation_id,
                serde_json::to_string(&request.profile).map_err(|_| UploadError::InvalidRequest)?, now])
                .map_err(|_| UploadError::Conflict)?;
            tx.execute("INSERT INTO transfer_items_v4(transfer_id,item_index,source_path,prepared_path,
                payload_class,state,updated_at) VALUES (?1,0,?2,?2,'original_document','QUEUED',?3)",
                params![request.operation_id, request.source.path.to_string_lossy(), now]).map_err(|_| UploadError::Database)?;
            tx.execute("INSERT INTO native_cloud_uploads(operation_id,account_id,authorized_user_id,request_json,
                expected_size,total_parts,random_id,file_id,created_ms,updated_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
                params![request.operation_id,request.destination.scope.account_id(),request.destination.scope.authorized_user_id(),
                json,request.source.size as i64,request.source.parts() as i64,request.random_id,random_nonzero(),now])
                .map_err(|_| UploadError::Database)?;
        }
        tx.commit().map_err(|_| UploadError::Database)?;
        drop(conn);
        self.get(&request.operation_id, &request.destination.scope)
    }

    pub fn get(&self, id: &str, scope: &AccountScope) -> Result<UploadRecord, UploadError> {
        let record = self
            .connection
            .lock()
            .query_row(&format!("{SELECT} WHERE operation_id=?1"), [id], decode)
            .optional()
            .map_err(|_| UploadError::Database)?
            .ok_or(UploadError::NotFound)?;
        if &record.request.destination.scope != scope {
            return Err(UploadError::WrongScope);
        }
        validate_record(&record)?;
        Ok(record)
    }
    pub fn list(
        &self,
        scope: &AccountScope,
        limit: usize,
    ) -> Result<Vec<UploadRecord>, UploadError> {
        if !(1..=1000).contains(&limit) {
            return Err(UploadError::InvalidRequest);
        }
        let conn = self.connection.lock();
        let mut statement = conn
            .prepare(&format!(
                "{SELECT} WHERE account_id=?1 AND authorized_user_id=?2
            ORDER BY created_ms,operation_id LIMIT ?3"
            ))
            .map_err(|_| UploadError::Database)?;
        let records = statement
            .query_map(
                params![scope.account_id(), scope.authorized_user_id(), limit as i64],
                decode,
            )
            .map_err(|_| UploadError::Database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| UploadError::Database)?;
        for record in &records {
            if &record.request.destination.scope != scope {
                return Err(UploadError::WrongScope);
            }
            validate_record(record)?;
        }
        Ok(records)
    }
    pub fn pending(&self, limit: usize) -> Result<Vec<UploadRecord>, UploadError> {
        if !(1..=1000).contains(&limit) {
            return Err(UploadError::InvalidRequest);
        }
        let conn = self.connection.lock();
        let mut statement = conn.prepare(&format!("{SELECT} WHERE state IN ('queued','running','retry_wait','committing')
            AND (retry_not_before_ms IS NULL OR retry_not_before_ms<=?1) ORDER BY created_ms,operation_id LIMIT ?2"))
            .map_err(|_| UploadError::Database)?;
        let records = statement
            .query_map(params![now_ms(), limit as i64], decode)
            .map_err(|_| UploadError::Database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| UploadError::Database)?;
        for record in &records {
            validate_record(record)?;
        }
        Ok(records)
    }
    pub fn has_recoverable(&self) -> Result<bool, UploadError> {
        self.connection
            .lock()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM native_cloud_uploads
            WHERE state IN ('queued','running','retry_wait','committing'))",
                [],
                |r| r.get(0),
            )
            .map_err(|_| UploadError::Database)
    }

    /// Authorization/source failures before worker admission must not spin forever
    /// as queued work or demote a concurrently running/committing worker.
    pub fn fail_preflight(
        &self,
        id: &str,
        scope: &AccountScope,
        failure: &UploadError,
    ) -> Result<(), UploadError> {
        self.get(id, scope)?;
        let (state, deadline) = match failure {
            UploadError::Cancelled => return Ok(()),
            UploadError::FloodWait { retry_after_ms } => (
                "retry_wait",
                Some(now_ms().saturating_add((*retry_after_ms).min(i64::MAX as u64) as i64)),
            ),
            UploadError::Network => ("retry_wait", Some(now_ms().saturating_add(30_000))),
            _ => ("failed", None),
        };
        let mut conn = self.connection.lock();
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| UploadError::Database)?;
        let changed = tx
            .execute(
                "UPDATE native_cloud_uploads SET state=?2,error_code=?3,
            retry_not_before_ms=CASE WHEN ?4 IS NULL THEN retry_not_before_ms
                WHEN retry_not_before_ms>?4 THEN retry_not_before_ms ELSE ?4 END,
            updated_ms=?5 WHERE operation_id=?1 AND state IN ('queued','retry_wait')",
                params![id, state, failure.to_string(), deadline, now_ms()],
            )
            .map_err(|_| UploadError::Database)?;
        if changed == 1 {
            sync_run(&tx, id)?;
        }
        tx.commit().map_err(|_| UploadError::Database)
    }

    pub fn review_interrupted_commit(
        &self,
        id: &str,
        scope: &AccountScope,
    ) -> Result<UploadRecord, UploadError> {
        let saved = self.get(id, scope)?;
        let _lock = self.lock_worker(&saved.request)?;
        let current = self.get(id, scope)?;
        if current.state == UploadState::Committing {
            self.transition(
                &current,
                UploadState::ReviewRequired,
                Some("interrupted_commit"),
                None,
            )?;
        }
        self.get(id, scope)
    }

    pub fn control(&self, id: &str, scope: &AccountScope, action: &str) -> Result<(), UploadError> {
        self.get(id, scope)?;
        let mut conn = self.connection.lock();
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| UploadError::Database)?;
        let changed = match action {
            "pause" | "cancel" => tx.execute("UPDATE native_cloud_uploads SET
                control=CASE WHEN state='running' THEN ?2 ELSE NULL END,
                state=CASE WHEN state='running' THEN state WHEN ?2='pause' THEN 'paused' ELSE 'cancelled' END,
                updated_ms=?3 WHERE operation_id=?1 AND state IN ('queued','running','paused','failed','retry_wait')
                AND (control IS NULL OR control=?2 OR ?2='cancel')", params![id, action, now_ms()]),
            "retry" => tx.execute("UPDATE native_cloud_uploads SET state=CASE WHEN retry_not_before_ms>?2
                THEN 'retry_wait' ELSE 'queued' END,control=NULL,error_code=NULL,updated_ms=?2
                WHERE operation_id=?1 AND state IN ('paused','failed','retry_wait')", params![id, now_ms()]),
            _ => return Err(UploadError::InvalidRequest),
        }.map_err(|_| UploadError::Database)?;
        if changed != 1 {
            return Err(UploadError::InvalidState);
        }
        sync_run(&tx, id)?;
        tx.commit().map_err(|_| UploadError::Database)
    }

    /// Kept open for the entire executor lifetime. Process death releases the OS lock.
    pub(super) fn lock_worker(&self, request: &UploadRequest) -> Result<File, UploadError> {
        request.validate()?;
        let path = self
            .lock_root
            .join(format!("{}.lock", request.operation_id));
        if let Ok(metadata) = std::fs::symlink_metadata(&path) {
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(UploadError::Io);
            }
        }
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)
            .map_err(|_| UploadError::Io)?;
        if std::fs::canonicalize(&path).map_err(|_| UploadError::Io)? != path {
            return Err(UploadError::Io);
        }
        file.try_lock().map_err(|_| UploadError::Busy)?;
        Ok(file)
    }
    pub(super) fn claim(
        &self,
        id: &str,
        scope: &AccountScope,
    ) -> Result<UploadRecord, UploadError> {
        let saved = self.get(id, scope)?;
        if saved.state == UploadState::Committing {
            self.transition(
                &saved,
                UploadState::ReviewRequired,
                Some("interrupted_commit"),
                None,
            )?;
            return Err(UploadError::ReviewRequired);
        }
        if saved.control.is_some() {
            self.apply_control(&saved)?;
            return Err(UploadError::Cancelled);
        }
        let mut conn = self.connection.lock();
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| UploadError::Database)?;
        let changed = tx.execute("UPDATE native_cloud_uploads SET state='running',epoch=epoch+1,error_code=NULL,
            retry_not_before_ms=NULL,updated_ms=?2 WHERE operation_id=?1 AND state IN ('queued','running','retry_wait')
            AND epoch=?3 AND control IS NULL AND (retry_not_before_ms IS NULL OR retry_not_before_ms<=?2)",
            params![id, now_ms(), saved.epoch]).map_err(|_| UploadError::Database)?;
        if changed != 1 {
            return Err(UploadError::InvalidState);
        }
        sync_run(&tx, id)?;
        tx.commit().map_err(|_| UploadError::Database)?;
        drop(conn);
        self.get(id, scope)
    }
    pub(super) fn apply_control(&self, record: &UploadRecord) -> Result<bool, UploadError> {
        let current = self.get(
            &record.request.operation_id,
            &record.request.destination.scope,
        )?;
        if current.epoch != record.epoch {
            return Err(UploadError::InvalidState);
        }
        if let Some(action) = current.control.as_deref() {
            self.transition(
                &current,
                if action == "cancel" {
                    UploadState::Cancelled
                } else {
                    UploadState::Paused
                },
                None,
                None,
            )?;
            return Ok(true);
        }
        Ok(false)
    }
    pub(super) fn acknowledge(
        &self,
        record: &UploadRecord,
        part: usize,
    ) -> Result<(), UploadError> {
        let bytes = ((part + 1) as u64 * UPLOAD_PART_BYTES as u64).min(record.request.source.size);
        let changed = self.connection.lock().execute("UPDATE native_cloud_uploads SET acknowledged_parts=?2,
            uploaded_bytes=?3,updated_ms=?4 WHERE operation_id=?1 AND epoch=?5 AND state='running' AND acknowledged_parts=?6",
            params![record.request.operation_id,part as i64+1,bytes as i64,now_ms(),record.epoch,part as i64])
            .map_err(|_| UploadError::Database)?;
        if changed != 1 {
            return Err(UploadError::InvalidState);
        }
        Ok(())
    }
    pub(super) fn begin_commit(&self, record: &UploadRecord) -> Result<bool, UploadError> {
        // Admission and control are serialized by SQLite, so cancellation cannot slip
        // between the last user-control check and the durable modifying RPC intent.
        let mut conn = self.connection.lock();
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| UploadError::Database)?;
        let changed = tx
            .execute(
                "UPDATE native_cloud_uploads SET state='committing',updated_ms=?2
            WHERE operation_id=?1 AND epoch=?3 AND state='running' AND control IS NULL
            AND acknowledged_parts=total_parts AND uploaded_bytes=expected_size",
                params![record.request.operation_id, now_ms(), record.epoch],
            )
            .map_err(|_| UploadError::Database)?;
        if changed == 1 {
            sync_run(&tx, &record.request.operation_id)?;
        }
        tx.commit().map_err(|_| UploadError::Database)?;
        Ok(changed == 1)
    }
    pub(super) fn transition(
        &self,
        record: &UploadRecord,
        state: UploadState,
        code: Option<&str>,
        deadline: Option<i64>,
    ) -> Result<(), UploadError> {
        if !matches!(
            state,
            UploadState::Paused
                | UploadState::Cancelled
                | UploadState::RetryWait
                | UploadState::Failed
                | UploadState::ReviewRequired
        ) {
            return Err(UploadError::InvalidState);
        }
        let mut conn = self.connection.lock();
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| UploadError::Database)?;
        let changed = tx.execute("UPDATE native_cloud_uploads SET state=?2,error_code=?3,retry_not_before_ms=?4,
            control=NULL,updated_ms=?5 WHERE operation_id=?1 AND epoch=?6 AND state IN ('running','committing')",
            params![record.request.operation_id,state.as_str(),code,deadline,now_ms(),record.epoch]).map_err(|_| UploadError::Database)?;
        if changed != 1 {
            return Err(UploadError::InvalidState);
        }
        sync_run(&tx, &record.request.operation_id)?;
        tx.commit().map_err(|_| UploadError::Database)
    }
    pub(super) fn complete(
        &self,
        record: &UploadRecord,
        receipt: UploadReceipt,
    ) -> Result<(), UploadError> {
        receipt.validate(&record.request)?;
        let mut conn = self.connection.lock();
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| UploadError::Database)?;
        let changed = tx.execute("UPDATE native_cloud_uploads SET state='completed',receipt_json=?2,
            error_code=NULL,retry_not_before_ms=NULL,updated_ms=?3 WHERE operation_id=?1 AND epoch=?4 AND state='committing'",
            params![record.request.operation_id,serde_json::to_string(&receipt).map_err(|_| UploadError::ReceiptMismatch)?,now_ms(),record.epoch])
            .map_err(|_| UploadError::Database)?;
        if changed != 1 {
            return Err(UploadError::InvalidState);
        }
        tx.execute("INSERT INTO upload_ledger(account_id,destination_id,topic_id,telegram_message_id,
            telegram_unique_id,prepared_sha256,filename,file_size,payload_class,created_at,updated_at)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'original_document',?9,?9)
            ON CONFLICT(account_id,destination_id,topic_id,prepared_sha256) DO UPDATE SET
            telegram_message_id=excluded.telegram_message_id,telegram_unique_id=excluded.telegram_unique_id,
            filename=excluded.filename,file_size=excluded.file_size,payload_class=excluded.payload_class,updated_at=excluded.updated_at",
            params![record.request.destination.scope.account_id(),record.request.destination.dialog_id(),record.request.destination.topic_id.unwrap_or(0),
            receipt.message_id,receipt.document_id.to_string(),record.request.source.sha256,record.request.filename,record.request.source.size as i64,now_ms()])
            .map_err(|_| UploadError::Database)?;
        tx.execute("UPDATE transfer_items_v4 SET telegram_message_id=?2 WHERE transfer_id=?1 AND item_index=0",
            params![record.request.operation_id,receipt.message_id]).map_err(|_| UploadError::Database)?;
        sync_run(&tx, &record.request.operation_id)?;
        tx.commit().map_err(|_| UploadError::Database)
    }
}

pub(super) fn sync_run(tx: &Transaction<'_>, id: &str) -> Result<(), UploadError> {
    tx.execute("UPDATE transfer_runs SET state=(SELECT upper(state) FROM native_cloud_uploads WHERE operation_id=?1),
        updated_at=?2 WHERE transfer_id=?1", params![id,now_ms()]).map_err(|_| UploadError::Database)?;
    tx.execute("UPDATE transfer_items_v4 SET state=(SELECT upper(state) FROM native_cloud_uploads WHERE operation_id=?1),
        updated_at=?2 WHERE transfer_id=?1 AND item_index=0", params![id,now_ms()]).map_err(|_| UploadError::Database)?;
    Ok(())
}
fn decode(row: &rusqlite::Row<'_>) -> rusqlite::Result<UploadRecord> {
    let request: String = row.get(0)?;
    let state: String = row.get(1)?;
    let receipt: Option<String> = row.get(9)?;
    let invalid = || rusqlite::Error::InvalidQuery;
    Ok(UploadRecord {
        request: serde_json::from_str(&request).map_err(|_| invalid())?,
        state: UploadState::parse(&state).map_err(|_| invalid())?,
        file_id: row.get(2)?,
        acknowledged_parts: row.get::<_, i64>(3)? as usize,
        uploaded_bytes: row.get::<_, i64>(4)? as u64,
        epoch: row.get(5)?,
        control: row.get(6)?,
        retry_not_before_ms: row.get(7)?,
        error_code: row.get(8)?,
        receipt: receipt
            .map(|v| serde_json::from_str(&v))
            .transpose()
            .map_err(|_| invalid())?,
    })
}
fn validate_record(record: &UploadRecord) -> Result<(), UploadError> {
    record.request.validate()?;
    let expected = (record.acknowledged_parts as u64 * UPLOAD_PART_BYTES as u64)
        .min(record.request.source.size);
    if record.file_id == 0
        || record.epoch < 0
        || record.acknowledged_parts > record.request.source.parts()
        || record.uploaded_bytes != expected
        || (record.state == UploadState::Completed) != record.receipt.is_some()
    {
        return Err(UploadError::Database);
    }
    if let Some(receipt) = &record.receipt {
        receipt.validate(&record.request)?;
    }
    Ok(())
}
