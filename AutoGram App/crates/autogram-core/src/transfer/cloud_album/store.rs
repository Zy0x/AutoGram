use super::*;
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    path::Path,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

const V4: &str =
    include_str!("../../../../../database/migrations/015_transfer_control_plane_v4.sql");
const SCHEMA: &str = include_str!("../../../../../database/migrations/031_native_cloud_albums.sql");
const PARTS: &str =
    include_str!("../../../../../database/migrations/032_native_cloud_album_parts.sql");
const SELECT: &str = "SELECT request_json,state,prepared_items,mapped_message_ids_json,
    error_code,receipt_json,upload_file_ids_json,acknowledged_parts_json FROM native_cloud_albums";

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

#[derive(Clone)]
pub struct AlbumUploadStore {
    connection: Arc<Mutex<Connection>>,
}

impl AlbumUploadStore {
    pub fn open(path: &Path) -> Result<Self, AlbumUploadError> {
        if !path.is_absolute() {
            return Err(AlbumUploadError::InvalidRequest);
        }
        let connection = Connection::open(path).map_err(|_| AlbumUploadError::Database)?;
        connection
            .execute_batch(V4)
            .map_err(|_| AlbumUploadError::Database)?;
        connection
            .execute_batch(SCHEMA)
            .map_err(|_| AlbumUploadError::Database)?;
        let has_part_columns: bool = connection
            .prepare("PRAGMA table_info(native_cloud_albums)")
            .map_err(|_| AlbumUploadError::Database)?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|_| AlbumUploadError::Database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| AlbumUploadError::Database)?
            .iter()
            .any(|name| name == "upload_file_ids_json");
        if !has_part_columns {
            connection
                .execute_batch(PARTS)
                .map_err(|_| AlbumUploadError::Database)?;
        }
        let store = Self {
            connection: Arc::new(Mutex::new(connection)),
        };
        store.recover_interrupted_commits()?;
        Ok(store)
    }

    pub fn enqueue(
        &self,
        request: AlbumUploadRequest,
    ) -> Result<AlbumUploadRecord, AlbumUploadError> {
        request.validate()?;
        let request_json =
            serde_json::to_string(&request).map_err(|_| AlbumUploadError::InvalidRequest)?;
        let profile_json = serde_json::to_string(&request.profile)
            .map_err(|_| AlbumUploadError::InvalidRequest)?;
        let message_ids = vec![None::<i32>; request.items.len()];
        let file_ids = vec![None::<i64>; request.items.len()];
        let acknowledged_parts = vec![0usize; request.items.len()];
        let message_ids_json =
            serde_json::to_string(&message_ids).map_err(|_| AlbumUploadError::InvalidRequest)?;
        let file_ids_json =
            serde_json::to_string(&file_ids).map_err(|_| AlbumUploadError::InvalidRequest)?;
        let acknowledged_parts_json = serde_json::to_string(&acknowledged_parts)
            .map_err(|_| AlbumUploadError::InvalidRequest)?;
        let now = now_ms();
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| AlbumUploadError::Database)?;
        let existing: Option<String> = transaction
            .query_row(
                "SELECT request_json FROM native_cloud_albums WHERE operation_id=?1",
                [&request.operation_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| AlbumUploadError::Database)?;
        if let Some(existing) = existing {
            if existing != request_json {
                return Err(AlbumUploadError::Conflict);
            }
        } else {
            transaction.execute(
                "INSERT INTO transfer_runs(transfer_id,profile_snapshot_json,state,created_at,updated_at)
                 VALUES (?1,?2,'QUEUED',?3,?3)",
                params![request.operation_id, profile_json, now]).map_err(|_| AlbumUploadError::Conflict)?;
            for item in &request.items {
                transaction.execute(
                    "INSERT INTO transfer_items_v4(transfer_id,item_index,source_path,prepared_path,
                     media_category,payload_class,transform_action,state,reason_code,telegram_message_id,updated_at)
                     VALUES (?1,?2,?3,?3,'visual','native_visual','prepare_album','QUEUED',NULL,NULL,?4)",
                    params![request.operation_id, item.index as i64, item.source.path.to_string_lossy(),
                        now])
                    .map_err(|_| AlbumUploadError::Database)?;
            }
            transaction.execute(
                "INSERT INTO native_cloud_albums(operation_id,account_id,authorized_user_id,request_json,
                 item_count,mapped_message_ids_json,created_ms,updated_ms,upload_file_ids_json,acknowledged_parts_json)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?7,?8,?9)",
                params![request.operation_id, request.destination.scope.account_id(),
                    request.destination.scope.authorized_user_id(), request_json, request.items.len() as i64,
                    message_ids_json, now, file_ids_json, acknowledged_parts_json]).map_err(|_| AlbumUploadError::Database)?;
        }
        transaction
            .commit()
            .map_err(|_| AlbumUploadError::Database)?;
        drop(connection);
        self.get(&request.operation_id, &request.destination.scope)
    }

    pub fn get(
        &self,
        operation_id: &str,
        scope: &crate::transfer::cloud_download::AccountScope,
    ) -> Result<AlbumUploadRecord, AlbumUploadError> {
        let record = self
            .connection
            .lock()
            .query_row(
                &format!("{SELECT} WHERE operation_id=?1"),
                [operation_id],
                decode,
            )
            .optional()
            .map_err(|_| AlbumUploadError::Database)?
            .ok_or(AlbumUploadError::NotFound)?;
        if &record.request.destination.scope != scope {
            return Err(AlbumUploadError::WrongScope);
        }
        record.request.validate()?;
        validate_record(&record)?;
        Ok(record)
    }

    pub fn list(
        &self,
        scope: &crate::transfer::cloud_download::AccountScope,
        limit: usize,
    ) -> Result<Vec<AlbumUploadRecord>, AlbumUploadError> {
        if !(1..=1000).contains(&limit) {
            return Err(AlbumUploadError::InvalidRequest);
        }
        let connection = self.connection.lock();
        let mut statement = connection.prepare(&format!(
            "{SELECT} WHERE account_id=?1 AND authorized_user_id=?2 ORDER BY created_ms,operation_id LIMIT ?3"))
            .map_err(|_| AlbumUploadError::Database)?;
        let records = statement
            .query_map(
                params![scope.account_id(), scope.authorized_user_id(), limit as i64],
                decode,
            )
            .map_err(|_| AlbumUploadError::Database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| AlbumUploadError::Database)?;
        for record in &records {
            if &record.request.destination.scope != scope {
                return Err(AlbumUploadError::WrongScope);
            }
            record.request.validate()?;
            validate_record(record)?;
        }
        Ok(records)
    }

    pub fn pending(&self, limit: usize) -> Result<Vec<AlbumUploadRecord>, AlbumUploadError> {
        if !(1..=1000).contains(&limit) {
            return Err(AlbumUploadError::InvalidRequest);
        }
        let connection = self.connection.lock();
        let mut statement = connection.prepare(&format!(
            "{SELECT} WHERE state IN ('queued','preparing') ORDER BY created_ms,operation_id LIMIT ?1"))
            .map_err(|_| AlbumUploadError::Database)?;
        let records = statement
            .query_map([limit as i64], decode)
            .map_err(|_| AlbumUploadError::Database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| AlbumUploadError::Database)?;
        Ok(records)
    }

    pub fn has_recoverable(&self) -> Result<bool, AlbumUploadError> {
        self.connection.lock().query_row(
            "SELECT EXISTS(SELECT 1 FROM native_cloud_albums WHERE state IN ('queued','preparing','committing'))",
            [], |row| row.get(0)).map_err(|_| AlbumUploadError::Database)
    }

    /// An interrupted SendMultiMedia can have succeeded even if its response was
    /// lost. Never put that operation back in the send queue: reconcile only its
    /// persisted random-id mappings or leave it visible for review.
    pub fn recover_interrupted_commits(&self) -> Result<usize, AlbumUploadError> {
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction()
            .map_err(|_| AlbumUploadError::Database)?;
        transaction
            .execute(
                "UPDATE native_cloud_albums SET state='review_required',
             error_code='unknown_commit_after_restart',updated_ms=?1 WHERE state='committing'",
                [now_ms()],
            )
            .map_err(|_| AlbumUploadError::Database)?;
        let uncertain = transaction.changes();
        transaction.execute(
            "UPDATE transfer_runs SET state='REVIEW_REQUIRED',updated_at=?1
             WHERE transfer_id IN (SELECT operation_id FROM native_cloud_albums WHERE state='review_required' AND error_code='unknown_commit_after_restart')",
            [now_ms()],
        ).map_err(|_| AlbumUploadError::Database)?;
        transaction.execute(
            "UPDATE transfer_items_v4 SET state='REVIEW_REQUIRED',transform_action='reconcile_commit',updated_at=?1
             WHERE transfer_id IN (SELECT operation_id FROM native_cloud_albums
               WHERE state='review_required' AND error_code='unknown_commit_after_restart')",
            [now_ms()],
        ).map_err(|_| AlbumUploadError::Database)?;
        transaction
            .execute(
                "UPDATE native_cloud_albums SET state='queued',prepared_items=0,control=NULL,
             error_code=NULL,updated_ms=?1 WHERE state='preparing'",
                [now_ms()],
            )
            .map_err(|_| AlbumUploadError::Database)?;
        transaction.execute(
            "UPDATE transfer_runs SET state='QUEUED',updated_at=?1
             WHERE transfer_id IN (SELECT operation_id FROM native_cloud_albums WHERE state='queued')",
            [now_ms()],
        ).map_err(|_| AlbumUploadError::Database)?;
        transaction.execute(
            "UPDATE transfer_items_v4 SET state='QUEUED',transform_action='prepare_album',updated_at=?1
             WHERE transfer_id IN (SELECT operation_id FROM native_cloud_albums WHERE state='queued')",
            [now_ms()],
        ).map_err(|_| AlbumUploadError::Database)?;
        transaction
            .commit()
            .map_err(|_| AlbumUploadError::Database)?;
        Ok(usize::try_from(uncertain).unwrap_or(usize::MAX))
    }

    pub fn set_control(
        &self,
        operation_id: &str,
        scope: &crate::transfer::cloud_download::AccountScope,
        control: Option<&str>,
    ) -> Result<AlbumUploadRecord, AlbumUploadError> {
        let record = self.get(operation_id, scope)?;
        if !matches!(control, None | Some("pause") | Some("cancel"))
            || !matches!(
                record.state,
                AlbumUploadState::Queued | AlbumUploadState::Preparing | AlbumUploadState::Paused
            )
        {
            return Err(AlbumUploadError::InvalidState);
        }
        let (state, control_value) = match control {
            Some("pause") => ("paused", Some("pause")),
            Some("cancel") => ("cancelled", Some("cancel")),
            _ => ("queued", None),
        };
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction()
            .map_err(|_| AlbumUploadError::Database)?;
        let changed = transaction
            .execute(
                "UPDATE native_cloud_albums SET state=?2,control=?3,updated_ms=?4
             WHERE operation_id=?1 AND state IN ('queued','preparing','paused')",
                params![operation_id, state, control_value, now_ms()],
            )
            .map_err(|_| AlbumUploadError::Database)?;
        if changed != 1 {
            return Err(AlbumUploadError::InvalidState);
        }
        let transfer_state = match state {
            "paused" => "PAUSED",
            "cancelled" => "CANCELLED",
            _ => "QUEUED",
        };
        transaction
            .execute(
                "UPDATE transfer_runs SET state=?2,updated_at=?3 WHERE transfer_id=?1",
                params![operation_id, transfer_state, now_ms()],
            )
            .map_err(|_| AlbumUploadError::Database)?;
        if state == "cancelled" {
            transaction.execute(
                "UPDATE transfer_items_v4 SET state='CANCELLED',updated_at=?2 WHERE transfer_id=?1",
                params![operation_id, now_ms()],
            ).map_err(|_| AlbumUploadError::Database)?;
        }
        transaction
            .commit()
            .map_err(|_| AlbumUploadError::Database)?;
        drop(connection);
        self.get(operation_id, scope)
    }

    pub fn set_preparing(
        &self,
        operation_id: &str,
        scope: &crate::transfer::cloud_download::AccountScope,
    ) -> Result<AlbumUploadRecord, AlbumUploadError> {
        let record = self.get(operation_id, scope)?;
        if !matches!(
            record.state,
            AlbumUploadState::Queued | AlbumUploadState::Preparing
        ) {
            return Err(AlbumUploadError::InvalidState);
        }
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction()
            .map_err(|_| AlbumUploadError::Database)?;
        let changed = transaction
            .execute(
                "UPDATE native_cloud_albums SET state='preparing',error_code=NULL,updated_ms=?2
             WHERE operation_id=?1 AND state IN ('queued','preparing')",
                params![operation_id, now_ms()],
            )
            .map_err(|_| AlbumUploadError::Database)?;
        if changed != 1 {
            return Err(AlbumUploadError::InvalidState);
        }
        transaction
            .execute(
                "UPDATE transfer_runs SET state='RUNNING',updated_at=?2 WHERE transfer_id=?1",
                params![operation_id, now_ms()],
            )
            .map_err(|_| AlbumUploadError::Database)?;
        transaction.execute(
            "UPDATE transfer_items_v4 SET state='RUNNING',updated_at=?2 WHERE transfer_id=?1 AND state IN ('QUEUED','RUNNING')",
            params![operation_id, now_ms()],
        ).map_err(|_| AlbumUploadError::Database)?;
        transaction
            .commit()
            .map_err(|_| AlbumUploadError::Database)?;
        drop(connection);
        self.get(operation_id, scope)
    }

    pub fn mark_item_prepared(
        &self,
        operation_id: &str,
        scope: &crate::transfer::cloud_download::AccountScope,
        index: usize,
    ) -> Result<AlbumUploadRecord, AlbumUploadError> {
        let record = self.get(operation_id, scope)?;
        if record.state != AlbumUploadState::Preparing || index >= record.request.items.len() {
            return Err(AlbumUploadError::InvalidState);
        }
        if record.upload_file_ids[index].is_none()
            || record.acknowledged_parts[index] != record.request.items[index].source.parts()
        {
            return Err(AlbumUploadError::InvalidState);
        }
        if index < record.prepared_items {
            return Ok(record);
        }
        if index > record.prepared_items {
            return Err(AlbumUploadError::InvalidState);
        }
        let next = record.prepared_items + 1;
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction()
            .map_err(|_| AlbumUploadError::Database)?;
        transaction.execute(
            "UPDATE native_cloud_albums SET prepared_items=?2,updated_ms=?3 WHERE operation_id=?1 AND state='preparing'",
            params![operation_id, next as i64, now_ms()]).map_err(|_| AlbumUploadError::Database)?;
        transaction.execute(
            "UPDATE transfer_items_v4 SET state='PREPARED',transform_action='register_media',updated_at=?3
             WHERE transfer_id=?1 AND item_index=?2", params![operation_id, index as i64, now_ms()])
            .map_err(|_| AlbumUploadError::Database)?;
        transaction
            .commit()
            .map_err(|_| AlbumUploadError::Database)?;
        drop(connection);
        self.get(operation_id, scope)
    }

    pub fn record_upload_file_id(
        &self,
        operation_id: &str,
        scope: &crate::transfer::cloud_download::AccountScope,
        item_index: usize,
        file_id: i64,
    ) -> Result<(), AlbumUploadError> {
        if file_id == 0 {
            return Err(AlbumUploadError::InvalidRequest);
        }
        let mut record = self.get(operation_id, scope)?;
        if record.state != AlbumUploadState::Preparing || item_index >= record.request.items.len() {
            return Err(AlbumUploadError::InvalidState);
        }
        match record.upload_file_ids[item_index] {
            Some(saved) if saved != file_id => return Err(AlbumUploadError::Conflict),
            Some(_) => return Ok(()),
            None => record.upload_file_ids[item_index] = Some(file_id),
        }
        let json = serde_json::to_string(&record.upload_file_ids)
            .map_err(|_| AlbumUploadError::Database)?;
        let changed = self
            .connection
            .lock()
            .execute(
                "UPDATE native_cloud_albums SET upload_file_ids_json=?2,updated_ms=?3
             WHERE operation_id=?1 AND state='preparing'",
                params![operation_id, json, now_ms()],
            )
            .map_err(|_| AlbumUploadError::Database)?;
        if changed != 1 {
            return Err(AlbumUploadError::InvalidState);
        }
        Ok(())
    }

    pub fn acknowledge_part(
        &self,
        operation_id: &str,
        scope: &crate::transfer::cloud_download::AccountScope,
        item_index: usize,
        part_index: usize,
    ) -> Result<(), AlbumUploadError> {
        let mut record = self.get(operation_id, scope)?;
        if record.state != AlbumUploadState::Preparing
            || item_index >= record.request.items.len()
            || record.upload_file_ids[item_index].is_none()
            || part_index >= record.request.items[item_index].source.parts()
        {
            return Err(AlbumUploadError::InvalidState);
        }
        let acknowledged = &mut record.acknowledged_parts[item_index];
        if part_index < *acknowledged {
            return Ok(());
        }
        if part_index != *acknowledged {
            return Err(AlbumUploadError::InvalidState);
        }
        *acknowledged += 1;
        let json = serde_json::to_string(&record.acknowledged_parts)
            .map_err(|_| AlbumUploadError::Database)?;
        let changed = self
            .connection
            .lock()
            .execute(
                "UPDATE native_cloud_albums SET acknowledged_parts_json=?2,updated_ms=?3
             WHERE operation_id=?1 AND state='preparing'",
                params![operation_id, json, now_ms()],
            )
            .map_err(|_| AlbumUploadError::Database)?;
        if changed != 1 {
            return Err(AlbumUploadError::InvalidState);
        }
        Ok(())
    }

    pub fn begin_commit(
        &self,
        operation_id: &str,
        scope: &crate::transfer::cloud_download::AccountScope,
    ) -> Result<AlbumUploadRecord, AlbumUploadError> {
        let record = self.get(operation_id, scope)?;
        if record.state != AlbumUploadState::Preparing
            || record.prepared_items != record.request.items.len()
            || record
                .request
                .items
                .iter()
                .enumerate()
                .any(|(index, item)| {
                    record.upload_file_ids[index].is_none()
                        || record.acknowledged_parts[index] != item.source.parts()
                })
        {
            return Err(AlbumUploadError::InvalidState);
        }
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction()
            .map_err(|_| AlbumUploadError::Database)?;
        let changed = transaction.execute(
            "UPDATE native_cloud_albums SET state='committing',updated_ms=?2 WHERE operation_id=?1 AND state='preparing'",
            params![operation_id, now_ms()]).map_err(|_| AlbumUploadError::Database)?;
        if changed != 1 {
            return Err(AlbumUploadError::InvalidState);
        }
        transaction
            .execute(
                "UPDATE transfer_runs SET state='COMMITTING',updated_at=?2 WHERE transfer_id=?1",
                params![operation_id, now_ms()],
            )
            .map_err(|_| AlbumUploadError::Database)?;
        transaction.execute(
            "UPDATE transfer_items_v4 SET state='COMMITTING',transform_action='send_album',updated_at=?2 WHERE transfer_id=?1",
            params![operation_id, now_ms()],
        ).map_err(|_| AlbumUploadError::Database)?;
        transaction
            .commit()
            .map_err(|_| AlbumUploadError::Database)?;
        drop(connection);
        Ok(self.get(operation_id, scope)?.into())
    }

    pub fn record_message_id(
        &self,
        operation_id: &str,
        scope: &crate::transfer::cloud_download::AccountScope,
        item_index: usize,
        message_id: i32,
    ) -> Result<(), AlbumUploadError> {
        if message_id <= 0 {
            return Err(AlbumUploadError::InvalidRequest);
        }
        let record = self.get(operation_id, scope)?;
        if !matches!(
            record.state,
            AlbumUploadState::Committing | AlbumUploadState::ReviewRequired
        ) || item_index >= record.request.items.len()
        {
            return Err(AlbumUploadError::InvalidState);
        }
        let mut ids = record.mapped_message_ids;
        match ids.get(item_index).copied() {
            Some(Some(existing)) if existing != message_id => {
                return Err(AlbumUploadError::ReviewRequired)
            }
            Some(Some(_)) => return Ok(()),
            Some(None) => ids[item_index] = Some(message_id),
            None => return Err(AlbumUploadError::InvalidState),
        }
        let json = serde_json::to_string(&ids).map_err(|_| AlbumUploadError::Database)?;
        self.connection.lock().execute(
            "UPDATE native_cloud_albums SET mapped_message_ids_json=?2,updated_ms=?3 WHERE operation_id=?1",
            params![operation_id, json, now_ms()]).map_err(|_| AlbumUploadError::Database)?;
        Ok(())
    }

    pub fn require_review(
        &self,
        operation_id: &str,
        scope: &crate::transfer::cloud_download::AccountScope,
        code: &str,
    ) -> Result<AlbumUploadRecord, AlbumUploadError> {
        self.get(operation_id, scope)?;
        if code.is_empty() || code.len() > 128 {
            return Err(AlbumUploadError::InvalidRequest);
        }
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction()
            .map_err(|_| AlbumUploadError::Database)?;
        transaction.execute(
            "UPDATE native_cloud_albums SET state='review_required',error_code=?2,updated_ms=?3 WHERE operation_id=?1",
            params![operation_id, code, now_ms()]).map_err(|_| AlbumUploadError::Database)?;
        transaction.execute(
            "UPDATE transfer_runs SET state='REVIEW_REQUIRED',updated_at=?2 WHERE transfer_id=?1",
            params![operation_id, now_ms()],
        ).map_err(|_| AlbumUploadError::Database)?;
        transaction.execute(
            "UPDATE transfer_items_v4 SET state='REVIEW_REQUIRED',transform_action='reconcile_commit',updated_at=?2 WHERE transfer_id=?1",
            params![operation_id, now_ms()],
        ).map_err(|_| AlbumUploadError::Database)?;
        transaction
            .commit()
            .map_err(|_| AlbumUploadError::Database)?;
        drop(connection);
        self.get(operation_id, scope)
    }

    pub fn begin_reconciliation(
        &self,
        operation_id: &str,
        scope: &crate::transfer::cloud_download::AccountScope,
    ) -> Result<AlbumUploadRecord, AlbumUploadError> {
        let record = self.get(operation_id, scope)?;
        if record.state != AlbumUploadState::ReviewRequired
            || record.mapped_message_ids.len() != record.request.items.len()
            || record.mapped_message_ids.iter().any(Option::is_none)
        {
            return Err(AlbumUploadError::ReviewRequired);
        }
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction()
            .map_err(|_| AlbumUploadError::Database)?;
        let changed = transaction
            .execute(
                "UPDATE native_cloud_albums SET state='committing',error_code=NULL,updated_ms=?2
             WHERE operation_id=?1 AND state='review_required'",
                params![operation_id, now_ms()],
            )
            .map_err(|_| AlbumUploadError::Database)?;
        if changed != 1 {
            return Err(AlbumUploadError::InvalidState);
        }
        transaction
            .execute(
                "UPDATE transfer_runs SET state='COMMITTING',updated_at=?2 WHERE transfer_id=?1",
                params![operation_id, now_ms()],
            )
            .map_err(|_| AlbumUploadError::Database)?;
        transaction.execute(
            "UPDATE transfer_items_v4 SET state='COMMITTING',transform_action='reconcile_commit',updated_at=?2 WHERE transfer_id=?1",
            params![operation_id, now_ms()],
        ).map_err(|_| AlbumUploadError::Database)?;
        transaction
            .commit()
            .map_err(|_| AlbumUploadError::Database)?;
        drop(connection);
        self.get(operation_id, scope)
    }

    pub fn complete(
        &self,
        operation_id: &str,
        scope: &crate::transfer::cloud_download::AccountScope,
        receipt: AlbumUploadReceipt,
    ) -> Result<AlbumUploadRecord, AlbumUploadError> {
        let record = self.get(operation_id, scope)?;
        validate_album_receipt(&record.request, &receipt)?;
        if record.state != AlbumUploadState::Committing
            || record.mapped_message_ids
                != receipt
                    .message_ids
                    .iter()
                    .copied()
                    .map(Some)
                    .collect::<Vec<_>>()
        {
            return Err(AlbumUploadError::ReviewRequired);
        }
        let receipt_json =
            serde_json::to_string(&receipt).map_err(|_| AlbumUploadError::Database)?;
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction()
            .map_err(|_| AlbumUploadError::Database)?;
        let changed = transaction.execute(
            "UPDATE native_cloud_albums SET state='completed',grouped_id=?2,receipt_json=?3,error_code=NULL,updated_ms=?4
             WHERE operation_id=?1 AND state='committing'",
            params![operation_id, receipt.grouped_id, receipt_json, now_ms()]).map_err(|_| AlbumUploadError::Database)?;
        if changed != 1 {
            return Err(AlbumUploadError::ReviewRequired);
        }
        transaction
            .execute(
                "UPDATE transfer_runs SET state='COMPLETED',updated_at=?2 WHERE transfer_id=?1",
                params![operation_id, now_ms()],
            )
            .map_err(|_| AlbumUploadError::Database)?;
        transaction.execute("UPDATE transfer_items_v4 SET state='COMPLETED',transform_action='verified',updated_at=?2 WHERE transfer_id=?1",
            params![operation_id, now_ms()]).map_err(|_| AlbumUploadError::Database)?;
        transaction
            .commit()
            .map_err(|_| AlbumUploadError::Database)?;
        drop(connection);
        self.get(operation_id, scope)
    }
}

fn decode(row: &rusqlite::Row<'_>) -> rusqlite::Result<AlbumUploadRecord> {
    let request_json: String = row.get(0)?;
    let state: String = row.get(1)?;
    let prepared_items: i64 = row.get(2)?;
    let mapped_json: String = row.get(3)?;
    let error_code: Option<String> = row.get(4)?;
    let receipt_json: Option<String> = row.get(5)?;
    let file_ids_json: Option<String> = row.get(6)?;
    let acknowledged_parts_json: Option<String> = row.get(7)?;
    let request: AlbumUploadRequest =
        serde_json::from_str(&request_json).map_err(|_| rusqlite::Error::InvalidQuery)?;
    let state = AlbumUploadState::parse(&state).map_err(|_| rusqlite::Error::InvalidQuery)?;
    let mapped_message_ids: Vec<Option<i32>> =
        serde_json::from_str(&mapped_json).map_err(|_| rusqlite::Error::InvalidQuery)?;
    let upload_file_ids: Vec<Option<i64>> = match file_ids_json {
        Some(json) => serde_json::from_str(&json).map_err(|_| rusqlite::Error::InvalidQuery)?,
        None => vec![None; request.items.len()],
    };
    let acknowledged_parts: Vec<usize> = match acknowledged_parts_json {
        Some(json) => serde_json::from_str(&json).map_err(|_| rusqlite::Error::InvalidQuery)?,
        None => vec![0; request.items.len()],
    };
    let receipt = receipt_json
        .map(|json| serde_json::from_str(&json).map_err(|_| rusqlite::Error::InvalidQuery))
        .transpose()?;
    Ok(AlbumUploadRecord {
        request,
        state,
        prepared_items: prepared_items.max(0) as usize,
        mapped_message_ids,
        upload_file_ids,
        acknowledged_parts,
        receipt,
        error_code,
    })
}

fn validate_record(record: &AlbumUploadRecord) -> Result<(), AlbumUploadError> {
    let count = record.request.items.len();
    if record.mapped_message_ids.len() != count
        || record.upload_file_ids.len() != count
        || record.acknowledged_parts.len() != count
        || record.upload_file_ids.iter().flatten().any(|id| *id == 0)
        || record
            .acknowledged_parts
            .iter()
            .enumerate()
            .any(|(index, parts)| *parts > record.request.items[index].source.parts())
    {
        return Err(AlbumUploadError::Database);
    }
    Ok(())
}
