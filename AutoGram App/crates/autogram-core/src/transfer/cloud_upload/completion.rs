//! Receipt, v4 run/item and ledger completion share one guarded transaction.
use super::{
    store::{now_ms, sync_run},
    *,
};
use rusqlite::{params, TransactionBehavior};

impl UploadStore {
    pub(super) fn complete(
        &self,
        record: &UploadRecord,
        receipt: UploadReceipt,
    ) -> Result<(), UploadError> {
        self.complete_in_state(record, receipt, UploadState::Committing)
    }
    pub(super) fn complete_reconciled(
        &self,
        record: &UploadRecord,
        receipt: UploadReceipt,
    ) -> Result<(), UploadError> {
        self.complete_in_state(record, receipt, UploadState::ReviewRequired)
    }
    fn complete_in_state(
        &self,
        record: &UploadRecord,
        receipt: UploadReceipt,
        state: UploadState,
    ) -> Result<(), UploadError> {
        receipt.validate(&record.request)?;
        let mut conn = self.connection.lock();
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| UploadError::Database)?;
        let changed = tx.execute("UPDATE native_cloud_uploads SET state='completed',receipt_json=?2,
            error_code=NULL,retry_not_before_ms=NULL,updated_ms=?3 WHERE operation_id=?1 AND epoch=?4 AND state=?5
            AND EXISTS(SELECT 1 FROM native_cloud_upload_send_mapping m WHERE m.operation_id=?1
                AND m.epoch=?4 AND m.random_id=?6 AND m.message_id=?7)",
            params![record.request.operation_id,serde_json::to_string(&receipt).map_err(|_| UploadError::ReceiptMismatch)?,
                now_ms(),record.epoch,state.as_str(),record.request.random_id,receipt.message_id])
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
