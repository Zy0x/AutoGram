//! Plan with reads, then commit under the caller's selected-account revision guard.
use super::*;
use crate::transfer::cloud_upload::{
    UploadError, UploadRecord, UploadRequest, UploadReuse, UploadStore,
};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone)]
pub enum UploadAdmission {
    Queued(UploadRecord),
    Reused(UploadReuse),
}
enum Decision {
    Queue(Option<i64>),
    Reuse(VerifiedDuplicate),
    ExistingReuse(UploadReuse),
}
pub struct UploadAdmissionPlan {
    request: UploadRequest,
    decision: Decision,
    cancel: CancellationToken,
}
impl UploadAdmissionPlan {
    pub fn commit(self, store: &UploadStore) -> Result<UploadAdmission, UploadError> {
        if self.cancel.is_cancelled() {
            return Err(UploadError::Cancelled);
        }
        match self.decision {
            Decision::Queue(revision) => store
                .enqueue_skipping_identical(self.request, revision)
                .map(UploadAdmission::Queued),
            Decision::Reuse(proof) => store
                .reuse_verified_document(self.request, &proof)
                .map(UploadAdmission::Reused),
            Decision::ExistingReuse(record) => {
                let current = store
                    .get_reuse(
                        &record.request.operation_id,
                        &record.request.destination.scope,
                    )?
                    .ok_or(UploadError::NotFound)?;
                if current.request != record.request {
                    return Err(UploadError::Conflict);
                }
                Ok(UploadAdmission::Reused(current))
            }
        }
    }
}
pub async fn plan_identical_upload_admission(
    store: &UploadStore,
    request: UploadRequest,
    origin: Option<VerifiedUploadOrigin>,
    source: &dyn DuplicateDocumentSource,
    cancel: &CancellationToken,
) -> Result<UploadAdmissionPlan, UploadError> {
    request.validate()?;
    let query = DuplicateQuery {
        destination: request.destination.clone(),
        source: request.source.clone(),
        filename: request.filename.clone(),
        origin,
    };
    query.validate()?;
    if source.scope() != &query.destination.scope {
        return Err(UploadError::WrongScope);
    }
    if cancel.is_cancelled() {
        return Err(UploadError::Cancelled);
    }
    let decision =
        if let Some(reused) = store.get_reuse(&request.operation_id, &request.destination.scope)? {
            if reused.request != request {
                return Err(UploadError::Conflict);
            }
            // Historical admitted result: do not reinterpret it as a new send after deletion.
            Decision::ExistingReuse(reused)
        } else {
            match store.get(&request.operation_id, &request.destination.scope) {
                Ok(existing) => {
                    if existing.request != request {
                        return Err(UploadError::Conflict);
                    }
                    Decision::Queue(None)
                }
                Err(UploadError::NotFound) => {
                    let revision = store.duplicate_revision(&query.destination)?;
                    let inspection = inspect_duplicates(store, &query, source, cancel).await?;
                    if let Some(proof) = inspection
                        .matches
                        .iter()
                        .find(|m| m.level().exact_content())
                        .cloned()
                    {
                        Decision::Reuse(proof)
                    } else if inspection.truncated
                        || inspection.unverified_ledger_rows > 0
                        || !inspection.matches.is_empty()
                    {
                        return Err(UploadError::ReviewRequired);
                    } else {
                        Decision::Queue(Some(revision))
                    }
                }
                Err(error) => return Err(error),
            }
        };
    Ok(UploadAdmissionPlan {
        request,
        decision,
        cancel: cancel.clone(),
    })
}
