//! Recovery is permitted only after a definite missing-part rejection, before any
//! ambiguous send result. Never infer rejection from timeout, cancellation or history.
use super::{
    store::{now_ms, random_nonzero, sync_run},
    UploadError, UploadRecord, UploadStore,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};

pub(super) const SCHEMA: &str =
    include_str!("../../../../../database/migrations/027_native_upload_part_recovery.sql");

impl UploadStore {
    /// The caller still owns the OS worker lock and has received a definite RPC
    /// rejection on its first send attempt. Incrementing the epoch invalidates all
    /// callbacks/receipts from the obsolete allocation. The send random ID is unchanged.
    pub(super) fn restart_expired_parts(&self, record: &UploadRecord) -> Result<(), UploadError> {
        let mut conn = self.connection.lock();
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| UploadError::Database)?;
        let restarts: i64 = tx
            .query_row(
                "SELECT part_restarts FROM native_cloud_upload_recovery WHERE operation_id=?1",
                [&record.request.operation_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| UploadError::Database)?
            .unwrap_or(0);
        let now = now_ms();
        let changed = if restarts >= 3 {
            tx.execute(
                "UPDATE native_cloud_uploads SET state='failed',control=NULL,
                error_code='upload_parts_expired',retry_not_before_ms=NULL,updated_ms=?2
                WHERE operation_id=?1 AND epoch=?3 AND file_id=?4 AND state='committing'
                AND NOT EXISTS(SELECT 1 FROM native_cloud_upload_send_mapping WHERE operation_id=?1)",
                params![
                    record.request.operation_id,
                    now,
                    record.epoch,
                    record.file_id
                ],
            )
        } else {
            let file_id = loop {
                let value = random_nonzero();
                if value != record.file_id {
                    break value;
                }
            };
            tx.execute(
                "UPDATE native_cloud_uploads SET state='retry_wait',file_id=?2,
                acknowledged_parts=0,uploaded_bytes=0,epoch=epoch+1,control=NULL,
                error_code='upload_parts_expired',retry_not_before_ms=?3,updated_ms=?4
                WHERE operation_id=?1 AND epoch=?5 AND file_id=?6 AND state='committing'
                AND NOT EXISTS(SELECT 1 FROM native_cloud_upload_send_mapping WHERE operation_id=?1)",
                params![
                    record.request.operation_id,
                    file_id,
                    now.saturating_add(30_000 * (restarts + 1)),
                    now,
                    record.epoch,
                    record.file_id
                ],
            )
        }
        .map_err(|_| UploadError::Database)?;
        if changed != 1 {
            return Err(UploadError::InvalidState);
        }
        if restarts < 3 {
            tx.execute(
                "INSERT INTO native_cloud_upload_recovery(operation_id,part_restarts,updated_ms)
                VALUES (?1,?2,?3) ON CONFLICT(operation_id) DO UPDATE SET
                part_restarts=excluded.part_restarts,updated_ms=excluded.updated_ms",
                params![record.request.operation_id, restarts + 1, now],
            )
            .map_err(|_| UploadError::Database)?;
        }
        sync_run(&tx, &record.request.operation_id)?;
        tx.commit().map_err(|_| UploadError::Database)
    }
}
