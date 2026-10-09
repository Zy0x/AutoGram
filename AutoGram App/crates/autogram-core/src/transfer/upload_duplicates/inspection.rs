use super::*;
use crate::transfer::cloud_upload::{UploadError, UploadStore};
use tokio_util::sync::CancellationToken;

pub async fn inspect_duplicates(
    store: &UploadStore,
    query: &DuplicateQuery,
    source: &dyn DuplicateDocumentSource,
    cancel: &CancellationToken,
) -> Result<DuplicateInspection, UploadError> {
    query.validate()?;
    if source.scope() != &query.destination.scope {
        return Err(UploadError::WrongScope);
    }
    if cancel.is_cancelled() {
        return Err(UploadError::Cancelled);
    }
    let batch = store.duplicate_candidates(query)?;
    let mut matches = Vec::new();
    let mut stale_candidates = 0;
    for candidate in batch.candidates {
        let document = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(UploadError::Cancelled),
            result = source.read_document(&query.destination,candidate.message_id) => result?,
        };
        let Some(document) = document else {
            stale_candidates += 1;
            continue;
        };
        if document.destination != query.destination || document.message_id != candidate.message_id
        {
            return Err(UploadError::ReceiptMismatch);
        }
        if document.document_id != candidate.document_id
            || document.size != candidate.size
            || candidate
                .filename
                .as_ref()
                .is_some_and(|name| *name != document.filename)
        {
            stale_candidates += 1;
            continue;
        }
        matches.push(VerifiedDuplicate {
            document,
            level: candidate.level,
            source_sha256: query.source.sha256.clone(),
            source_size: query.source.size,
        });
    }
    if cancel.is_cancelled() {
        return Err(UploadError::Cancelled);
    }
    Ok(DuplicateInspection {
        matches,
        truncated: batch.truncated,
        unverified_ledger_rows: batch.unverified_rows,
        stale_candidates,
    })
}
