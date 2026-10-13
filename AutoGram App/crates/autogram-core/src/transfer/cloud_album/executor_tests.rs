use super::*;
use crate::transfer::{cloud_download::AccountScope, cloud_upload::snapshot_upload_file};
use async_trait::async_trait;
use parking_lot::Mutex;
use std::{
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};
use tokio_util::sync::CancellationToken;

struct Sources(Vec<PathBuf>);
impl Sources {
    fn new() -> Self {
        let paths = (0..2)
            .map(|index| {
                let path = std::env::temp_dir().join(format!(
                    "autogram-album-executor-{}-{}-{index}.jpg",
                    std::process::id(),
                    rand::random::<u64>()
                ));
                std::fs::write(&path, [0xff, 0xd8, index as u8, 0xff, 0xd9]).unwrap();
                std::fs::canonicalize(path).unwrap()
            })
            .collect();
        Self(paths)
    }
    fn request(&self) -> AlbumUploadRequest {
        AlbumUploadRequest::new(
            "album-executor-test".into(),
            super::destination(Some(17)),
            self.0
                .iter()
                .enumerate()
                .map(|(index, path)| {
                    (
                        snapshot_upload_file(path).unwrap(),
                        format!("photo-{index}.jpg"),
                        "image/jpeg".into(),
                    )
                })
                .collect(),
            "summary".into(),
            FrozenTransferProfile::default(),
            None,
        )
        .unwrap()
    }
}
impl Drop for Sources {
    fn drop(&mut self) {
        for path in &self.0 {
            let _ = std::fs::remove_file(path);
        }
    }
}

struct AmbiguousCommitTransport {
    scope: AccountScope,
    send_calls: AtomicUsize,
    saved_parts: AtomicUsize,
    request_random_ids: Mutex<Vec<i64>>,
}

#[async_trait]
impl AlbumUploadTransport for AmbiguousCommitTransport {
    fn scope(&self) -> &AccountScope {
        &self.scope
    }
    async fn validate_destination(&self, _: &AlbumUploadRequest) -> Result<(), AlbumUploadError> {
        Ok(())
    }
    async fn save_part(
        &self,
        _: &AlbumUploadRequest,
        _: usize,
        file_id: i64,
        _: usize,
        bytes: Vec<u8>,
    ) -> Result<(), AlbumUploadError> {
        assert_ne!(file_id, 0);
        assert_eq!(bytes.len(), 5);
        self.saved_parts.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    async fn send_album(
        &self,
        request: &AlbumUploadRequest,
        _: &[i64],
        journal: &dyn AlbumCommitJournal,
    ) -> Result<AlbumUploadReceipt, AlbumUploadError> {
        self.send_calls.fetch_add(1, Ordering::SeqCst);
        *self.request_random_ids.lock() = request.items.iter().map(|item| item.random_id).collect();
        let ids = [701, 702];
        for (index, id) in ids.into_iter().enumerate() {
            journal.record_message_id(index, id)?;
        }
        Err(AlbumUploadError::Network)
    }
    async fn reconcile_album(
        &self,
        request: &AlbumUploadRequest,
        message_ids: &[i32],
    ) -> Result<AlbumUploadReceipt, AlbumUploadError> {
        Ok(AlbumUploadReceipt {
            destination: request.destination.clone(),
            grouped_id: 9007,
            message_ids: message_ids.to_vec(),
        })
    }
}

#[tokio::test]
async fn executor_persists_chunks_and_reconciles_ambiguous_send_without_resending() {
    let sources = Sources::new();
    let request = sources.request();
    let operation_id = request.operation_id.clone();
    let scope = request.destination.scope.clone();
    let db = super::TempDb::new();
    let store = AlbumUploadStore::open(&db.0).unwrap();
    let initial_random_ids = request
        .items
        .iter()
        .map(|item| item.random_id)
        .collect::<Vec<_>>();
    store.enqueue(request).unwrap();
    let transport = AmbiguousCommitTransport {
        scope: scope.clone(),
        send_calls: AtomicUsize::new(0),
        saved_parts: AtomicUsize::new(0),
        request_random_ids: Mutex::new(Vec::new()),
    };
    let executor = AlbumUploadExecutor::new(store.clone());
    let prepared = executor
        .run(&operation_id, &scope, &transport, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(prepared.state, AlbumUploadState::ReviewRequired);
    assert_eq!(prepared.acknowledged_parts, vec![1, 1]);
    assert_eq!(prepared.prepared_items, 2);
    assert_eq!(transport.saved_parts.load(Ordering::SeqCst), 2);
    assert_eq!(*transport.request_random_ids.lock(), initial_random_ids);
    assert_eq!(transport.send_calls.load(Ordering::SeqCst), 1);

    let completed = executor
        .reconcile(&operation_id, &scope, &transport)
        .await
        .unwrap();
    assert_eq!(completed.state, AlbumUploadState::Completed);
    assert_eq!(completed.receipt.unwrap().message_ids, vec![701, 702]);
    assert_eq!(
        transport.send_calls.load(Ordering::SeqCst),
        1,
        "read-only reconciliation must not dispatch SendMultiMedia again"
    );
}
