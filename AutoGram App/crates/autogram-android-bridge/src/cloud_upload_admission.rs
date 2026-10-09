//! Explicit strong-duplicate skip; other policies do not silently fall back to it.
use crate::{
    auth::engine,
    cloud_upload::{self, NativeCloudUpload, NativeUploadError},
    cloud_upload_enqueue::{prepare, NativeUploadInput, ProfileChoice},
};
use autogram_core::{
    telegram::{auth::AccountId, upload::transport::TelegramUploadTransport},
    transfer::{cloud_upload::UploadReuse, upload_duplicates::*},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, uniffi::Record)]
pub struct NativeReusedCloudUpload {
    pub operation_id: String,
    pub account_id: String,
    pub peer_id: String,
    pub topic_id: Option<i32>,
    pub message_id: i32,
    pub document_id: i64,
    pub filename: String,
    pub size: u64,
    pub verified_at_ms: i64,
}
#[derive(Clone, uniffi::Enum)]
pub enum NativeUploadAdmission {
    Queued { upload: NativeCloudUpload },
    Reused { existing: NativeReusedCloudUpload },
}
fn reused_record(value: UploadReuse) -> NativeReusedCloudUpload {
    NativeReusedCloudUpload {
        operation_id: value.request.operation_id,
        account_id: value.document.destination.scope.account_id().into(),
        peer_id: value.document.destination.dialog_id(),
        topic_id: value.document.destination.topic_id,
        message_id: value.document.message_id,
        document_id: value.document.document_id,
        filename: value.document.filename,
        size: value.document.size,
        verified_at_ms: value.created_ms,
    }
}
/// Inspects the persisted historical decision without a source file or new network read.
#[uniffi::export]
pub fn get_reused_cloud_upload(
    account_id: String,
    operation_id: String,
) -> Result<Option<NativeReusedCloudUpload>, NativeUploadError> {
    let scope = cloud_upload::scope(account_id.clone())?;
    let auth = engine().map_err(|_| cloud_upload::error("auth_not_initialized"))?;
    let revision = auth.selected_job_revision();
    auth.commit_selected_job(&AccountId(account_id), revision, || {
        Ok(cloud_upload::store()?
            .get_reuse(&operation_id, &scope)?
            .map(reused_record))
    })
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn enqueue_cloud_upload_skipping_identical(
    input: NativeUploadInput,
    profile_id: Option<String>,
    download_operation_id: Option<String>,
) -> Result<NativeUploadAdmission, NativeUploadError> {
    let cancel = CancellationToken::new();
    let _cancel_on_drop = cancel.clone().drop_guard();
    let prepared = prepare(input, ProfileChoice::Selected { profile_id }).await?;
    let auth = engine().map_err(|_| cloud_upload::error("auth_not_initialized"))?;
    let origin = match download_operation_id {
        Some(id) => Some(VerifiedUploadOrigin::from_download(
            &crate::cloud_download::store()
                .map_err(|_| cloud_upload::error("database"))?
                .get(&id, &prepared.request.destination.scope)
                .map_err(|_| cloud_upload::error("download_provenance_invalid"))?,
            &prepared.request.source,
        )?),
        None => None,
    };
    let transport = TelegramUploadTransport::connect(
        auth,
        prepared.request.destination.scope.clone(),
        cancel.clone(),
    )
    .await?;
    let plan = plan_identical_upload_admission(
        cloud_upload::store()?,
        prepared.request,
        origin,
        &transport,
        &cancel,
    )
    .await?;
    auth.commit_selected_job(&prepared.account, prepared.selected_revision, || {
        Ok(match plan.commit(cloud_upload::store()?)? {
            UploadAdmission::Queued(value) => NativeUploadAdmission::Queued {
                upload: cloud_upload::record(value),
            },
            UploadAdmission::Reused(value) => NativeUploadAdmission::Reused {
                existing: reused_record(value),
            },
        })
    })
}
