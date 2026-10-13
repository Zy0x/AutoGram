use super::{
    AlbumUploadError, AlbumUploadRecord, AlbumUploadRequest, AlbumUploadState, AlbumUploadStore,
};
use crate::transfer::{cloud_download::AccountScope, cloud_upload::UploadSource};
use async_trait::async_trait;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[async_trait]
pub trait AlbumUploadTransport: Send + Sync {
    fn scope(&self) -> &AccountScope;
    async fn validate_destination(
        &self,
        request: &AlbumUploadRequest,
    ) -> Result<(), AlbumUploadError>;
    async fn save_part(
        &self,
        request: &AlbumUploadRequest,
        item_index: usize,
        file_id: i64,
        part_index: usize,
        bytes: Vec<u8>,
    ) -> Result<(), AlbumUploadError>;
    async fn send_album(
        &self,
        request: &AlbumUploadRequest,
        file_ids: &[i64],
        journal: &dyn AlbumCommitJournal,
    ) -> Result<super::AlbumUploadReceipt, AlbumUploadError>;
    async fn reconcile_album(
        &self,
        request: &AlbumUploadRequest,
        message_ids: &[i32],
    ) -> Result<super::AlbumUploadReceipt, AlbumUploadError>;
}

pub trait AlbumCommitJournal: Send + Sync {
    fn record_message_id(&self, item_index: usize, message_id: i32)
        -> Result<(), AlbumUploadError>;
}

pub struct AlbumUploadExecutor {
    store: AlbumUploadStore,
}

impl AlbumUploadExecutor {
    pub fn new(store: AlbumUploadStore) -> Self {
        Self { store }
    }

    pub async fn run(
        &self,
        operation_id: &str,
        scope: &AccountScope,
        transport: &dyn AlbumUploadTransport,
        cancel: &CancellationToken,
    ) -> Result<AlbumUploadRecord, AlbumUploadError> {
        if transport.scope() != scope {
            return Err(AlbumUploadError::WrongScope);
        }
        let mut record = self.store.get(operation_id, scope)?;
        if record.state == AlbumUploadState::Completed {
            return Ok(record);
        }
        if record.state == AlbumUploadState::Committing {
            return self
                .store
                .require_review(operation_id, scope, "unknown_commit");
        }
        if matches!(
            record.state,
            AlbumUploadState::ReviewRequired | AlbumUploadState::Cancelled
        ) {
            return Err(AlbumUploadError::InvalidState);
        }
        transport.validate_destination(&record.request).await?;
        record = self.store.set_preparing(operation_id, scope)?;

        for index in 0..record.request.items.len() {
            if stopped(&self.store, operation_id, scope, cancel)? {
                return self.store.get(operation_id, scope);
            }
            let item = &record.request.items[index];
            let mut source = UploadSource::open(&item.source)?;
            let cancel_copy = cancel.clone();
            source = tokio::task::spawn_blocking(move || {
                source.verify_all(&cancel_copy)?;
                Ok::<_, AlbumUploadError>(source)
            })
            .await
            .map_err(|_| AlbumUploadError::Io)??;

            let file_id = match record.upload_file_ids[index] {
                Some(value) => value,
                None => {
                    let value = loop {
                        let id: i64 = rand::random();
                        if id != 0 {
                            break id;
                        }
                    };
                    self.store
                        .record_upload_file_id(operation_id, scope, index, value)?;
                    value
                }
            };
            for part in record.acknowledged_parts[index]..item.source.parts() {
                if stopped(&self.store, operation_id, scope, cancel)? {
                    return self.store.get(operation_id, scope);
                }
                let source_copy = source;
                let (bytes, restored_source) = tokio::task::spawn_blocking(move || {
                    let mut source_copy = source_copy;
                    let bytes = source_copy.part(part)?;
                    Ok::<_, AlbumUploadError>((bytes, source_copy))
                })
                .await
                .map_err(|_| AlbumUploadError::Io)??;
                source = restored_source;
                let mut accepted = false;
                for attempt in 0..3u64 {
                    if cancel.is_cancelled() {
                        return Err(AlbumUploadError::Cancelled);
                    }
                    match transport
                        .save_part(&record.request, index, file_id, part, bytes.clone())
                        .await
                    {
                        Ok(()) => {
                            accepted = true;
                            break;
                        }
                        Err(AlbumUploadError::Network) if attempt < 2 => {
                            tokio::select! { _ = cancel.cancelled() => return Err(AlbumUploadError::Cancelled),
                            _ = tokio::time::sleep(Duration::from_millis(400 * (attempt + 1))) => {} }
                        }
                        Err(error) => return Err(error),
                    }
                }
                if !accepted {
                    return Err(AlbumUploadError::Network);
                }
                self.store
                    .acknowledge_part(operation_id, scope, index, part)?;
            }
            self.store.mark_item_prepared(operation_id, scope, index)?;
            record = self.store.get(operation_id, scope)?;
        }

        if stopped(&self.store, operation_id, scope, cancel)? {
            return self.store.get(operation_id, scope);
        }
        record = self.store.begin_commit(operation_id, scope)?;
        let file_ids = record
            .upload_file_ids
            .iter()
            .copied()
            .collect::<Option<Vec<_>>>()
            .ok_or(AlbumUploadError::InvalidState)?;
        let journal = StoreJournal {
            store: &self.store,
            operation_id,
            scope,
        };
        match transport
            .send_album(&record.request, &file_ids, &journal)
            .await
        {
            Ok(receipt) => self.store.complete(operation_id, scope, receipt),
            Err(_) => self
                .store
                .require_review(operation_id, scope, "commit_unconfirmed"),
        }
    }

    pub async fn reconcile(
        &self,
        operation_id: &str,
        scope: &AccountScope,
        transport: &dyn AlbumUploadTransport,
    ) -> Result<AlbumUploadRecord, AlbumUploadError> {
        if transport.scope() != scope { return Err(AlbumUploadError::WrongScope); }
        let record = self.store.get(operation_id, scope)?;
        if record.state == AlbumUploadState::Completed { return Ok(record); }
        if record.state != AlbumUploadState::ReviewRequired { return Err(AlbumUploadError::InvalidState); }
        let message_ids = record.mapped_message_ids.iter().copied().collect::<Option<Vec<_>>>()
            .ok_or(AlbumUploadError::ReviewRequired)?;
        self.store.begin_reconciliation(operation_id, scope)?;
        match transport.reconcile_album(&record.request, &message_ids).await {
            Ok(receipt) => self.store.complete(operation_id, scope, receipt),
            Err(error) => {
                self.store.require_review(operation_id, scope, "reconcile_unconfirmed")?;
                Err(error)
            }
        }
    }
}

fn stopped(
    store: &AlbumUploadStore,
    operation_id: &str,
    scope: &AccountScope,
    cancel: &CancellationToken,
) -> Result<bool, AlbumUploadError> {
    if cancel.is_cancelled() {
        return Err(AlbumUploadError::Cancelled);
    }
    let record = store.get(operation_id, scope)?;
    Ok(matches!(
        record.state,
        AlbumUploadState::Paused | AlbumUploadState::Cancelled
    ))
}

struct StoreJournal<'a> {
    store: &'a AlbumUploadStore,
    operation_id: &'a str,
    scope: &'a AccountScope,
}
impl AlbumCommitJournal for StoreJournal<'_> {
    fn record_message_id(
        &self,
        item_index: usize,
        message_id: i32,
    ) -> Result<(), AlbumUploadError> {
        self.store
            .record_message_id(self.operation_id, self.scope, item_index, message_id)
    }
}
