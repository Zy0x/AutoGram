//! Read-only inspection; UI cannot supply document IDs or unchecked provenance.
use crate::{
    auth::engine,
    cloud_upload::{self, NativeUploadError},
};
use autogram_core::{
    telegram::{auth::AccountId, upload::transport::TelegramUploadTransport},
    transfer::{cloud_upload::snapshot_upload_file_cancellable, upload_duplicates::*},
};
use std::path::Path;
use tokio_util::sync::CancellationToken;

#[derive(Clone, uniffi::Enum)]
pub enum NativeDuplicateLevel {
    MessageId,
    DocumentId,
    Sha256,
    FilenameSize,
}
#[derive(Clone, uniffi::Record)]
pub struct NativeUploadDuplicate {
    pub message_id: i32,
    pub document_id: i64,
    pub filename: String,
    pub size: u64,
    pub level: NativeDuplicateLevel,
    pub exact_content: bool,
}
#[derive(Clone, uniffi::Record)]
pub struct NativeDuplicateInspection {
    pub account_id: String,
    pub peer_id: String,
    pub topic_id: Option<i32>,
    pub source_sha256: String,
    pub source_size: u64,
    pub matches: Vec<NativeUploadDuplicate>,
    pub truncated: bool,
    pub unverified_ledger_rows: u32,
    pub stale_candidates: u32,
    pub covers_full_destination: bool,
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn inspect_cloud_upload_duplicates(
    account_id: String,
    peer_id: String,
    topic_id: Option<i32>,
    staged_path: String,
    filename: String,
    download_operation_id: Option<String>,
) -> Result<NativeDuplicateInspection, NativeUploadError> {
    let cancel = CancellationToken::new();
    let _cancel_on_drop = cancel.clone().drop_guard();
    let auth = engine().map_err(|_| cloud_upload::error("auth_not_initialized"))?;
    let account = AccountId(account_id.clone());
    auth.validate_selected_account(&account).await?;
    let revision = auth.selected_job_revision();
    let destination =
        cloud_upload::destination(cloud_upload::scope(account_id)?, &peer_id, topic_id)?;
    let path =
        cloud_upload::staging_source(&cloud_upload::staging_root()?, Path::new(&staged_path))?;
    let hash_cancel = cancel.clone();
    let source =
        tokio::task::spawn_blocking(move || snapshot_upload_file_cancellable(&path, &hash_cancel))
            .await
            .map_err(|_| cloud_upload::error("io"))??;
    let origin = match download_operation_id {
        Some(id) => Some(VerifiedUploadOrigin::from_download(
            &crate::cloud_download::store()
                .map_err(|_| cloud_upload::error("database"))?
                .get(&id, &destination.scope)
                .map_err(|_| cloud_upload::error("download_provenance_invalid"))?,
            &source,
        )?),
        None => None,
    };
    let query = DuplicateQuery {
        destination,
        source,
        filename,
        origin,
    };
    query.validate()?;
    let transport =
        TelegramUploadTransport::connect(auth, query.destination.scope.clone(), cancel.clone())
            .await?;
    let inspection =
        inspect_duplicates(cloud_upload::store()?, &query, &transport, &cancel).await?;
    // A late result cannot be displayed after selection changed, including away/back.
    auth.commit_selected_job(&account, revision, || Ok(to_native(&query, inspection)))
}
fn to_native(query: &DuplicateQuery, inspection: DuplicateInspection) -> NativeDuplicateInspection {
    NativeDuplicateInspection {
        account_id: query.destination.scope.account_id().into(),
        peer_id: query.destination.dialog_id(),
        topic_id: query.destination.topic_id,
        source_sha256: query.source.sha256.clone(),
        source_size: query.source.size,
        matches: inspection
            .matches
            .into_iter()
            .map(|item| NativeUploadDuplicate {
                message_id: item.document.message_id,
                document_id: item.document.document_id,
                filename: item.document.filename,
                size: item.document.size,
                exact_content: item.level.exact_content(),
                level: match item.level {
                    DuplicateLevel::MessageId => NativeDuplicateLevel::MessageId,
                    DuplicateLevel::DocumentId => NativeDuplicateLevel::DocumentId,
                    DuplicateLevel::Sha256 => NativeDuplicateLevel::Sha256,
                    DuplicateLevel::FilenameSize => NativeDuplicateLevel::FilenameSize,
                },
            })
            .collect(),
        truncated: inspection.truncated,
        unverified_ledger_rows: inspection.unverified_ledger_rows as u32,
        stale_candidates: inspection.stale_candidates as u32,
        covers_full_destination: false,
    }
}
