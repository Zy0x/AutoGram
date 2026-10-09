//! Exact server message mapping journal and read-only post-interruption recovery.
use super::{store::now_ms, *};
use crate::transfer::cloud_download::AccountScope;
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use tokio_util::sync::CancellationToken;

pub(super) const SCHEMA: &str =
    include_str!("../../../../../database/migrations/028_native_upload_send_mapping.sql");
pub(super) struct CommitJournal<'a> {
    pub store: &'a UploadStore,
    pub record: &'a UploadRecord,
}
impl UploadCommitJournal for CommitJournal<'_> {
    fn record_message_id(&self, message_id: i32) -> Result<(), UploadError> {
        if message_id <= 0 {
            return Err(UploadError::ReceiptMismatch);
        }
        let record = self.record;
        let mut conn = self.store.connection.lock();
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| UploadError::Database)?;
        let valid: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM native_cloud_uploads WHERE
            operation_id=?1 AND epoch=?2 AND file_id=?3 AND random_id=?4 AND state='committing')",
                params![
                    record.request.operation_id,
                    record.epoch,
                    record.file_id,
                    record.request.random_id
                ],
                |row| row.get(0),
            )
            .map_err(|_| UploadError::Database)?;
        if !valid {
            return Err(UploadError::InvalidState);
        }
        let existing: Option<(i64,i32,i64)> = tx.query_row(
            "SELECT random_id,message_id,epoch FROM native_cloud_upload_send_mapping WHERE operation_id=?1",
            [&record.request.operation_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)))
            .optional().map_err(|_| UploadError::Database)?;
        if let Some(existing) = existing {
            if existing != (record.request.random_id, message_id, record.epoch) {
                return Err(UploadError::ReceiptMismatch);
            }
        } else {
            tx.execute("INSERT INTO native_cloud_upload_send_mapping(operation_id,random_id,message_id,epoch,created_ms)
                VALUES (?1,?2,?3,?4,?5)", params![record.request.operation_id,record.request.random_id,
                    message_id,record.epoch,now_ms()]).map_err(|_| UploadError::Database)?;
        }
        tx.commit().map_err(|_| UploadError::Database)
    }
}
impl UploadStore {
    /// Allows callers to reject unavailable recovery before contacting Telegram.
    pub fn reconciliation_target(
        &self,
        id: &str,
        scope: &AccountScope,
    ) -> Result<i32, UploadError> {
        let record = self.get(id, scope)?;
        if record.state != UploadState::ReviewRequired
            || record
                .retry_not_before_ms
                .is_some_and(|deadline| deadline > now_ms())
        {
            return Err(UploadError::InvalidState);
        }
        self.mapped_message_id(&record)?
            .ok_or(UploadError::ReviewRequired)
    }
    pub(super) fn mapped_message_id(
        &self,
        record: &UploadRecord,
    ) -> Result<Option<i32>, UploadError> {
        self.connection
            .lock()
            .query_row(
                "SELECT message_id FROM native_cloud_upload_send_mapping
            WHERE operation_id=?1 AND random_id=?2 AND epoch=?3",
                params![
                    record.request.operation_id,
                    record.request.random_id,
                    record.epoch
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| UploadError::Database)
    }
}
impl UploadExecutor {
    /// Reads a persisted exact message ID; never uploads bytes, searches history or sends.
    pub async fn reconcile(
        &self,
        id: &str,
        scope: &AccountScope,
        transport: &dyn CloudUploadTransport,
        cancel: &CancellationToken,
    ) -> Result<UploadRecord, UploadError> {
        if transport.scope() != scope {
            return Err(UploadError::WrongScope);
        }
        let initial = self.store.get(id, scope)?;
        if initial.state == UploadState::Completed {
            return Ok(initial);
        }
        let _lock = self.store.lock_worker(&initial.request)?;
        if initial.state == UploadState::Committing {
            self.store.transition(
                &initial,
                UploadState::ReviewRequired,
                Some("interrupted_commit"),
                initial.retry_not_before_ms,
            )?;
        }
        let record = self.store.get(id, scope)?;
        if record.state != UploadState::ReviewRequired
            || record
                .retry_not_before_ms
                .is_some_and(|deadline| deadline > now_ms())
        {
            return Err(UploadError::InvalidState);
        }
        let message_id = self.store.reconciliation_target(id, scope)?;
        let receipt_result = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(UploadError::Cancelled),
            result = transport.reconcile_document(&record.request, message_id) => result,
        };
        let receipt = match receipt_result {
            Ok(receipt) => receipt,
            Err(error) => {
                let deadline = match &error {
                    UploadError::FloodWait { retry_after_ms } => {
                        Some(now_ms().saturating_add((*retry_after_ms).min(i64::MAX as u64) as i64))
                    }
                    UploadError::Network => Some(now_ms().saturating_add(30_000)),
                    _ => record.retry_not_before_ms,
                };
                self.store.connection.lock().execute("UPDATE native_cloud_uploads SET error_code=?2,
                    retry_not_before_ms=?3,updated_ms=?4 WHERE operation_id=?1 AND epoch=?5 AND state='review_required'",
                    params![record.request.operation_id,error.to_string(),deadline,now_ms(),record.epoch])
                    .map_err(|_| UploadError::Database)?;
                return Err(error);
            }
        };
        if receipt.message_id != message_id {
            return Err(UploadError::ReceiptMismatch);
        }
        self.store.complete_reconciled(&record, receipt)?;
        self.store.get(id, scope)
    }
}
