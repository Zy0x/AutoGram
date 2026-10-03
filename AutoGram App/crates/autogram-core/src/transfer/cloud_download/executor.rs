use super::{
    files::{digest, OwnedFile},
    *,
};
use sha2::{Digest, Sha256};
use std::{future::Future, time::Duration};

#[derive(Clone)]
pub struct DownloadExecutor {
    store: DownloadStore,
}

impl DownloadExecutor {
    pub fn new(store: DownloadStore) -> Self {
        Self { store }
    }
    pub fn store(&self) -> &DownloadStore {
        &self.store
    }

    /// Persist authentication/network preflight failures without stealing a live worker.
    /// Recovery must acquire the same OS lock as execution; publication stays irreversible.
    pub async fn fail_source_preflight(
        &self,
        id: &str,
        scope: &AccountScope,
        failure: SourceFailure,
    ) -> Result<(), DownloadError> {
        let record = self.store.get(id, scope)?;
        if record.state == DownloadState::Queued {
            return self.store.fail_queued_source(id, scope, failure);
        }
        if !matches!(record.state, DownloadState::Running | DownloadState::Publishing) {
            return Err(DownloadError::InvalidState);
        }
        let file = tokio::task::spawn_blocking(move || OwnedFile::open(&record))
            .await.map_err(|_| DownloadError::Io {
                action: "preflight_worker", kind: std::io::ErrorKind::Other,
            })??;
        self.store.claim(id, true)?;
        self.store.failed(id, &DownloadError::Source(failure))?;
        drop(file);
        Ok(())
    }

    /// Runs one explicitly queued operation; does not import or auto-run metadata tasks.
    pub async fn run(
        &self,
        id: &str,
        scope: &AccountScope,
        source: &dyn CloudByteRangeSource,
    ) -> Result<DownloadRecord, DownloadError> {
        self.execute(id, scope, source, false).await
    }

    /// Explicit recovery after executor future/process death. OS file lock rejects live workers.
    /// A durable publishing operation is never returned to the append phase.
    pub async fn recover(
        &self,
        id: &str,
        scope: &AccountScope,
        source: &dyn CloudByteRangeSource,
    ) -> Result<DownloadRecord, DownloadError> {
        self.execute(id, scope, source, true).await
    }

    async fn execute(
        &self,
        id: &str,
        scope: &AccountScope,
        source: &dyn CloudByteRangeSource,
        recovery: bool,
    ) -> Result<DownloadRecord, DownloadError> {
        let record = self.store.get(id, scope)?;
        if source.scope() != scope {
            return Err(DownloadError::WrongScope);
        }
        if (!recovery && record.state != DownloadState::Queued)
            || (recovery
                && !matches!(
                    record.state,
                    DownloadState::Running | DownloadState::Publishing
                ))
        {
            return Err(DownloadError::InvalidState);
        }
        let opening = record.clone();
        let file = tokio::task::spawn_blocking(move || OwnedFile::open(&opening))
            .await
            .map_err(|_| DownloadError::Io {
                action: "open_worker",
                kind: std::io::ErrorKind::Other,
            })??;
        if record.file_identity.is_none() {
            self.store.attach_file(id, &file.identity)?;
        }
        let mut file = Some(file);
        self.store.claim(id, recovery)?;
        // Reload after claiming so controls racing with startup/recovery are not lost.
        let record = self.store.get(id, scope)?;
        let result = self.drive(&record, source, &mut file, recovery).await;
        if let Err(error) = &result {
            // A store failure is surfaced, never silently converted into successful completion.
            self.store.failed(id, error)?;
        }
        result?;
        self.store.get(id, scope)
    }

    async fn drive(
        &self,
        record: &DownloadRecord,
        source: &dyn CloudByteRangeSource,
        file: &mut Option<OwnedFile>,
        recovery: bool,
    ) -> Result<(), DownloadError> {
        let request = &record.request;
        let id = request.operation_id();
        if record.state == DownloadState::Publishing {
            // Complete the irreversible, verified commit protocol even if the old future died.
            let object = source
                .describe(request.source())
                .await
                .map_err(DownloadError::Source)?;
            check_object(request, source, &object)?;
            let hash = record
                .actual_sha256
                .as_deref()
                .ok_or(DownloadError::Integrity)?;
            verify_file(file, request.expected_size(), hash).await?;
            let output = request.output_path().to_owned();
            disk(file, move |f| f.publish(&output, true)).await?;
            verify_file(file, request.expected_size(), hash).await?;
            return self.store.completed(id);
        }
        let Some(object) = self
            .interruptible(id, source.describe(request.source()))
            .await?
        else {
            return Ok(());
        };
        check_object(request, source, &object)?;
        // Identity is validated remotely before interpreting or truncating an owned checkpoint.
        let saved = record.clone();
        let mut hasher: Sha256 = disk(file, move |f| f.resume(&saved)).await?;
        let mut offset = record.checkpoint_bytes;
        while offset < request.expected_size() {
            if self.store.stop_if_requested(id)? {
                return Ok(());
            }
            let length = (request.expected_size() - offset)
                .min(crate::transfer::download::DOWNLOAD_CHUNK_SIZE)
                as usize;
            let Some(chunk) = self
                .interruptible(id, source.read_range(request.source(), offset, length))
                .await?
            else {
                return Ok(());
            };
            check_object(request, source, &chunk.object)?;
            if chunk.offset != offset {
                return Err(DownloadError::IdentityChanged);
            }
            if chunk.bytes.len() != length {
                return Err(DownloadError::ShortRead {
                    expected: length,
                    actual: chunk.bytes.len(),
                });
            }
            if self.store.stop_if_requested(id)? {
                return Ok(());
            }
            hasher.update(&chunk.bytes);
            disk(file, move |f| f.append(&chunk.bytes)).await?;
            offset += length as u64;
            self.store.checkpoint(id, offset, &digest(&hasher))?;
        }
        if self.store.stop_if_requested(id)? {
            return Ok(());
        }
        let hash = digest(&hasher);
        if request
            .expected_sha256()
            .is_some_and(|expected| expected != hash)
        {
            return Err(DownloadError::Integrity);
        }
        verify_file(file, request.expected_size(), &hash).await?;
        // Revalidate authorization/identity after the last byte as well as before each append.
        let Some(object) = self
            .interruptible(id, source.describe(request.source()))
            .await?
        else {
            return Ok(());
        };
        check_object(request, source, &object)?;
        if !self.store.publishing(id, &hash)? {
            if self.store.stop_if_requested(id)? {
                return Ok(());
            }
            return Err(DownloadError::InvalidState);
        }
        // Never overwrite an existing output. Recovery accepts only this exact owned inode.
        let output = request.output_path().to_owned();
        disk(file, move |f| f.publish(&output, recovery)).await?;
        verify_file(file, request.expected_size(), &hash).await?;
        self.store.completed(id)
    }

    /// Persisted control polling also works across independent SQLite connections/processes.
    /// Dropping an in-flight source read on pause/cancel leaves the previous checkpoint intact.
    async fn interruptible<T>(
        &self,
        id: &str,
        future: impl Future<Output = Result<T, SourceFailure>>,
    ) -> Result<Option<T>, DownloadError> {
        tokio::pin!(future);
        loop {
            if self.store.stop_if_requested(id)? {
                return Ok(None);
            }
            tokio::select! {
                result = &mut future => return result.map(Some).map_err(DownloadError::Source),
                _ = tokio::time::sleep(Duration::from_millis(50)) => {},
            }
        }
    }
}

// Hashing large media and flushing files must not block the Tokio/Android lifecycle thread.
// The file lock moves into the blocking task; dropped executor futures cannot release it
// while an in-flight write is still running. Recovery gets Busy until that task exits.
async fn disk<T: Send + 'static>(
    file: &mut Option<OwnedFile>,
    action: impl FnOnce(&mut OwnedFile) -> Result<T, DownloadError> + Send + 'static,
) -> Result<T, DownloadError> {
    let mut owned = file.take().ok_or(DownloadError::Ownership)?;
    let (owned, result) = tokio::task::spawn_blocking(move || {
        let result = action(&mut owned);
        (owned, result)
    })
    .await
    .map_err(|_| DownloadError::Io {
        action: "file_worker",
        kind: std::io::ErrorKind::Other,
    })?;
    *file = Some(owned);
    result
}

async fn verify_file(
    file: &mut Option<OwnedFile>,
    size: u64,
    hash: &str,
) -> Result<(), DownloadError> {
    let hash = hash.to_owned();
    disk(file, move |f| f.verify_full(size, &hash)).await
}

fn check_object(
    request: &DownloadRequest,
    source: &dyn CloudByteRangeSource,
    object: &RemoteObject,
) -> Result<(), DownloadError> {
    if source.scope() != request.source().scope()
        || object.identity.scope() != request.source().scope()
    {
        return Err(DownloadError::WrongScope);
    }
    if object.identity != *request.source() || object.size != request.expected_size() {
        return Err(DownloadError::IdentityChanged);
    }
    Ok(())
}
