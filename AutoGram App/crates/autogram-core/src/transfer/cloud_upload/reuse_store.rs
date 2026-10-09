//! Immutable SKIPPED decisions never enter the transmitted-upload state machine.
use super::*;
use crate::transfer::{
    cloud_download::AccountScope,
    upload_duplicates::{DuplicateLevel, ExistingCloudDocument, VerifiedDuplicate},
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};

pub(super) const SCHEMA: &str =
    include_str!("../../../../../database/migrations/030_native_cloud_upload_reuses.sql");
#[derive(Debug, Clone)]
pub struct UploadReuse {
    pub request: UploadRequest,
    pub document: ExistingCloudDocument,
    pub level: DuplicateLevel,
    pub created_ms: i64,
}
impl UploadStore {
    pub fn duplicate_revision(&self, destination: &UploadDestination) -> Result<i64, UploadError> {
        destination.validate()?;
        duplicate_revision(&self.connection.lock(), destination)
    }
    pub fn get_reuse(
        &self,
        id: &str,
        scope: &AccountScope,
    ) -> Result<Option<UploadReuse>, UploadError> {
        let record = self
            .connection
            .lock()
            .query_row(
                "SELECT request_json,document_json,match_level,created_ms,operation_id,account_id,authorized_user_id
            FROM native_cloud_upload_reuses WHERE operation_id=?1",
                [id],
                decode,
            )
            .optional()
            .map_err(|_| UploadError::Database)?;
        if let Some(record) = &record {
            if &record.request.destination.scope != scope {
                return Err(UploadError::WrongScope);
            }
            record.validate()?;
        }
        Ok(record)
    }
    pub fn reuse_verified_document(
        &self,
        request: UploadRequest,
        verified: &VerifiedDuplicate,
    ) -> Result<UploadReuse, UploadError> {
        request.validate()?;
        if !verified.level().exact_content()
            || !verified.validates_source(&request.source)
            || verified.document().destination != request.destination
            || verified.document().size != request.source.size
        {
            return Err(UploadError::ReceiptMismatch);
        }
        let record = UploadReuse {
            request,
            document: verified.document().clone(),
            level: verified.level(),
            created_ms: store::now_ms(),
        };
        record.validate()?;
        let json =
            serde_json::to_string(&record.request).map_err(|_| UploadError::InvalidRequest)?;
        let mut conn = self.connection.lock();
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| UploadError::Database)?;
        if let Some(existing) = tx
            .query_row(
                "SELECT request_json,document_json,match_level,created_ms,operation_id,account_id,authorized_user_id
            FROM native_cloud_upload_reuses WHERE operation_id=?1",
                [&record.request.operation_id],
                decode,
            )
            .optional()
            .map_err(|_| UploadError::Database)?
        {
            existing.validate()?;
            if existing.request != record.request {
                return Err(UploadError::Conflict);
            }
            // First admitted decision remains immutable, even if a newer duplicate is found.
            return Ok(existing);
        }
        let uploading: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM native_cloud_uploads WHERE operation_id=?1)",
                [&record.request.operation_id],
                |r| r.get(0),
            )
            .map_err(|_| UploadError::Database)?;
        if uploading {
            return Err(UploadError::Conflict);
        }
        let now = record.created_ms;
        tx.execute("INSERT INTO transfer_runs(transfer_id,profile_snapshot_json,state,created_at,updated_at)
            VALUES(?1,?2,'SKIPPED',?3,?3)",params![record.request.operation_id,
            serde_json::to_string(&record.request.profile).map_err(|_|UploadError::InvalidRequest)?,now]).map_err(|_|UploadError::Conflict)?;
        tx.execute("INSERT INTO transfer_items_v4(transfer_id,item_index,source_path,prepared_path,payload_class,state,telegram_message_id,updated_at)
            VALUES(?1,0,?2,?2,'original_document','SKIPPED',?3,?4)",params![record.request.operation_id,
            record.request.source.path.to_string_lossy(),record.document.message_id,now]).map_err(|_|UploadError::Database)?;
        tx.execute("INSERT INTO native_cloud_upload_reuses(operation_id,account_id,authorized_user_id,request_json,document_json,match_level,created_ms)
            VALUES(?1,?2,?3,?4,?5,?6,?7)",params![record.request.operation_id,record.request.destination.scope.account_id(),
            record.request.destination.scope.authorized_user_id(),json,serde_json::to_string(&record.document).map_err(|_|UploadError::ReceiptMismatch)?,
            level_name(record.level)?,now]).map_err(|_|UploadError::Conflict)?;
        tx.commit().map_err(|_| UploadError::Database)?;
        Ok(record)
    }
}
pub(super) fn duplicate_revision(
    conn: &rusqlite::Connection,
    destination: &UploadDestination,
) -> Result<i64, UploadError> {
    conn.query_row(
        "SELECT coalesce((SELECT revision FROM native_upload_duplicate_revisions
        WHERE account_id=?1 AND destination_id=?2 AND topic_id=?3),0)",
        params![
            destination.scope.account_id(),
            destination.dialog_id(),
            destination.topic_id.unwrap_or(0)
        ],
        |row| row.get(0),
    )
    .map_err(|_| UploadError::Database)
}
impl UploadReuse {
    pub fn validate(&self) -> Result<(), UploadError> {
        self.request.validate()?;
        if !self.level.exact_content()
            || self.created_ms < 0
            || self.document.destination != self.request.destination
            || self.document.message_id <= 0
            || self.document.document_id == 0
            || self.document.size != self.request.source.size
            || self.document.filename.is_empty()
        {
            return Err(UploadError::ReceiptMismatch);
        }
        Ok(())
    }
}
fn level_name(level: DuplicateLevel) -> Result<&'static str, UploadError> {
    match level {
        DuplicateLevel::MessageId => Ok("message_id"),
        DuplicateLevel::DocumentId => Ok("document_id"),
        DuplicateLevel::Sha256 => Ok("sha256"),
        DuplicateLevel::FilenameSize => Err(UploadError::ReceiptMismatch),
    }
}
/// Called only inside the queue's immediate write transaction.
pub(super) fn check_duplicate_admission(
    conn: &rusqlite::Connection,
    request: &UploadRequest,
    revision: i64,
) -> Result<(), UploadError> {
    if duplicate_revision(conn, &request.destination)? != revision {
        return Err(UploadError::Busy);
    }
    let kind = match request.destination.peer_kind {
        crate::transfer::cloud_download::PeerKind::User => "User",
        crate::transfer::cloud_download::PeerKind::Chat => "Chat",
        crate::transfer::cloud_download::PeerKind::Channel => "Channel",
    };
    let pending: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM native_cloud_uploads
        WHERE account_id=?1 AND authorized_user_id=?2 AND state NOT IN ('completed','cancelled')
        AND expected_size=?3 AND json_extract(request_json,'$.source.sha256')=?4
        AND json_extract(request_json,'$.destination.peer_kind')=?5
        AND json_extract(request_json,'$.destination.peer_id')=?6
        AND coalesce(json_extract(request_json,'$.destination.topic_id'),0)=?7)",
            params![
                request.destination.scope.account_id(),
                request.destination.scope.authorized_user_id(),
                request.source.size as i64,
                request.source.sha256,
                kind,
                request.destination.peer_id,
                request.destination.topic_id.unwrap_or(0)
            ],
            |row| row.get(0),
        )
        .map_err(|_| UploadError::Database)?;
    if pending {
        return Err(UploadError::Busy);
    }
    Ok(())
}
fn decode(row: &rusqlite::Row<'_>) -> rusqlite::Result<UploadReuse> {
    let request: String = row.get(0)?;
    let document: String = row.get(1)?;
    let level: String = row.get(2)?;
    let record = UploadReuse {
        request: serde_json::from_str(&request).map_err(|_| rusqlite::Error::InvalidQuery)?,
        document: serde_json::from_str(&document).map_err(|_| rusqlite::Error::InvalidQuery)?,
        level: match level.as_str() {
            "message_id" => DuplicateLevel::MessageId,
            "document_id" => DuplicateLevel::DocumentId,
            "sha256" => DuplicateLevel::Sha256,
            _ => return Err(rusqlite::Error::InvalidQuery),
        },
        created_ms: row.get(3)?,
    };
    let operation_id: String = row.get(4)?;
    let account_id: String = row.get(5)?;
    let user_id: i64 = row.get(6)?;
    if record.request.operation_id != operation_id
        || record.request.destination.scope.account_id() != account_id
        || record.request.destination.scope.authorized_user_id() != user_id
    {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(record)
}
