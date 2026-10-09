use super::{source::UploadSource, store::now_ms, *};
use crate::transfer::cloud_download::AccountScope;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub struct UploadExecutor {
    store: UploadStore,
}
impl UploadExecutor {
    pub fn new(store: UploadStore) -> Self {
        Self { store }
    }
    pub async fn run(
        &self,
        id: &str,
        scope: &AccountScope,
        transport: &dyn CloudUploadTransport,
        cancel: &CancellationToken,
    ) -> Result<UploadRecord, UploadError> {
        let cancel = cancel.child_token();
        let _cancel_on_drop = cancel.clone().drop_guard();
        if transport.scope() != scope {
            return Err(UploadError::WrongScope);
        }
        let initial = self.store.get(id, scope)?;
        if initial.state == UploadState::Completed {
            return Ok(initial);
        }
        // An OS lock protects even separate store instances/processes recovering a job.
        let _worker = self.store.lock_worker(&initial.request)?;
        if cancel.is_cancelled() {
            return Err(UploadError::Cancelled);
        }
        let record = self.store.claim(id, scope)?;
        let outcome = self.execute(&record, transport, &cancel).await;
        match outcome {
            Ok(()) => self.store.get(id, scope),
            Err(error) => {
                let current = self.store.get(id, scope)?;
                if current.state == UploadState::Running && self.store.apply_control(&current)? {
                    return self.store.get(id, scope);
                }
                if matches!(
                    current.state,
                    UploadState::Paused | UploadState::Cancelled | UploadState::Completed
                ) {
                    return Ok(current);
                }
                if current.state == UploadState::Committing {
                    // Dropping a modifying RPC can lose an acknowledgement. Never
                    // report cancellation/failure as proof that nothing was sent.
                    self.store.transition(
                        &current,
                        UploadState::ReviewRequired,
                        Some("commit_unconfirmed"),
                        deadline(&error),
                    )?;
                } else if error == UploadError::Cancelled {
                    // Platform stop is resumable; explicit user control is handled
                    // separately and remains terminal when the user asked to cancel.
                    self.store.transition(
                        &current,
                        UploadState::RetryWait,
                        None,
                        Some(now_ms().saturating_add(30_000)),
                    )?;
                } else {
                    let waiting =
                        matches!(error, UploadError::Network | UploadError::FloodWait { .. });
                    self.store.transition(
                        &current,
                        if waiting {
                            UploadState::RetryWait
                        } else {
                            UploadState::Failed
                        },
                        Some(code(&error)),
                        if waiting {
                            Some(deadline(&error).unwrap_or(now_ms().saturating_add(30_000)))
                        } else {
                            None
                        },
                    )?;
                }
                Err(error)
            }
        }
    }
    async fn execute(
        &self,
        record: &UploadRecord,
        transport: &dyn CloudUploadTransport,
        cancel: &CancellationToken,
    ) -> Result<(), UploadError> {
        transport.limits().await?.validate(&record.request)?;
        transport
            .validate_destination(&record.request.destination)
            .await?;
        let mut source = UploadSource::open(&record.request.source)?;
        // Validate every source part even when some parts have been acknowledged on
        // a previous run. No UI metadata/digest becomes permission to upload bytes.
        source = verify_source(source, cancel.clone()).await?;
        for part in record.acknowledged_parts..record.request.source.parts() {
            if self.stopped(record, cancel)? {
                return Ok(());
            }
            let bytes = source.part(part)?;
            let mut accepted = false;
            for attempt in 0..3u64 {
                if self.stopped(record, cancel)? {
                    return Ok(());
                }
                let result = tokio::select! {
                    biased;
                    _ = cancel.cancelled() => return Err(UploadError::Cancelled),
                    result = transport.save_part(&record.request, record.file_id, part, bytes.clone()) => result,
                };
                match result {
                    Ok(()) => {
                        accepted = true;
                        break;
                    }
                    Err(error @ (UploadError::Network | UploadError::PartRejected))
                        if attempt < 2 =>
                    {
                        let _ = error;
                        tokio::select! {
                            _ = cancel.cancelled() => return Err(UploadError::Cancelled),
                            _ = tokio::time::sleep(Duration::from_millis(400 * (attempt + 1))) => {}
                        }
                    }
                    Err(error) => return Err(error),
                }
            }
            if !accepted {
                return Err(UploadError::PartRejected);
            }
            self.store.acknowledge(record, part)?;
        }
        let _verified = verify_source(source, cancel.clone()).await?;
        if self.stopped(record, cancel)? {
            return Ok(());
        }
        if !self.store.begin_commit(record)? {
            if self.store.apply_control(record)? {
                return Ok(());
            }
            return Err(UploadError::InvalidState);
        }
        // Three attempts retain the same persisted random_id and file_id. A lost
        // receipt never starts another unrelated send or chooses a history guess.
        for attempt in 0..3u64 {
            let result = tokio::select! {
                biased;
                _ = cancel.cancelled() => return Err(UploadError::Cancelled),
                result = transport.commit_document(&record.request, record.file_id) => result,
            };
            match result {
                Ok(receipt) => {
                    self.store.complete(record, receipt)?;
                    return Ok(());
                }
                Err(UploadError::Network) if attempt < 2 => {
                    tokio::select! {
                        _ = cancel.cancelled() => return Err(UploadError::Cancelled),
                        _ = tokio::time::sleep(Duration::from_millis(400 * (attempt + 1))) => {}
                    }
                }
                Err(error) => return Err(error),
            }
        }
        Err(UploadError::ReviewRequired)
    }
    fn stopped(
        &self,
        record: &UploadRecord,
        cancel: &CancellationToken,
    ) -> Result<bool, UploadError> {
        if self.store.apply_control(record)? {
            return Ok(true);
        }
        if cancel.is_cancelled() {
            return Err(UploadError::Cancelled);
        }
        Ok(false)
    }
}
async fn verify_source(
    mut source: UploadSource,
    cancel: CancellationToken,
) -> Result<UploadSource, UploadError> {
    tokio::task::spawn_blocking(move || {
        source.verify_all(&cancel)?;
        Ok(source)
    })
    .await
    .map_err(|_| UploadError::Io)?
}
fn deadline(error: &UploadError) -> Option<i64> {
    match error {
        UploadError::FloodWait { retry_after_ms } => {
            Some(now_ms().saturating_add((*retry_after_ms).min(i64::MAX as u64) as i64))
        }
        _ => None,
    }
}
fn code(error: &UploadError) -> &'static str {
    match error {
        UploadError::Unauthorized => "not_authorized",
        UploadError::WrongScope => "wrong_scope",
        UploadError::SourceChanged => "source_changed",
        UploadError::FloodWait { .. } => "flood_wait",
        UploadError::Network => "network",
        UploadError::PartRejected => "upload_part_rejected",
        UploadError::PartsExpired => "upload_parts_expired",
        UploadError::Io => "io",
        UploadError::ReceiptMismatch => "receipt_mismatch",
        UploadError::Rejected => "cloud_write_rejected",
        _ => "upload_failed",
    }
}
