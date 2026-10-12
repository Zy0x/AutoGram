use super::*;
use crate::transfer::{
    cloud_download::{AccountScope, PeerKind},
    cloud_upload::{UploadDestination, UploadFileSnapshot},
    FrozenTransferProfile,
};
use std::path::PathBuf;

struct TempDb(PathBuf);
impl TempDb {
    fn new() -> Self {
        let name = format!(
            "autogram-album-{}-{:032x}.sqlite",
            std::process::id(),
            rand::random::<u128>()
        );
        Self(std::env::temp_dir().join(name))
    }
}
impl Drop for TempDb {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn destination(topic_id: Option<i32>) -> UploadDestination {
    UploadDestination {
        scope: AccountScope::new("tg_123".into(), 123).unwrap(),
        peer_kind: PeerKind::Channel,
        peer_id: 456,
        topic_id,
    }
}

fn source(index: usize) -> UploadFileSnapshot {
    UploadFileSnapshot {
        path: std::env::temp_dir().join(format!("album-{index}.staged")),
        size: 3,
        sha256: "a".repeat(64),
        md5: "b".repeat(32),
        part_sha256: vec!["c".repeat(64)],
    }
}

fn request() -> AlbumUploadRequest {
    let sources = (0..3)
        .map(|index| {
            (
                source(index),
                format!("photo-{index}.jpg"),
                "image/jpeg".into(),
            )
        })
        .collect();
    AlbumUploadRequest::new(
        "album-op-1".into(),
        destination(Some(17)),
        sources,
        "Trip summary".into(),
        FrozenTransferProfile::default(),
        None,
    )
    .unwrap()
}

#[test]
fn visual_album_admission_pins_caption_order_and_unique_random_ids() {
    let request = request();
    assert_eq!(request.items.len(), 3);
    assert_eq!(
        request
            .items
            .iter()
            .map(|item| item.index)
            .collect::<Vec<_>>(),
        vec![0, 1, 2]
    );
    assert_eq!(request.item_caption(0), Some("Trip summary"));
    assert_eq!(request.item_caption(1), Some(""));
    assert_eq!(request.item_caption(2), Some(""));
    let ids = request
        .items
        .iter()
        .map(|item| item.random_id)
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(ids.len(), request.items.len());
    assert!(!ids.contains(&0));
}

#[test]
fn visual_album_admission_enforces_telegram_size_and_native_media_contract() {
    for count in [0usize, 1, 11] {
        let items = (0..count)
            .map(|index| {
                (
                    source(index),
                    format!("photo-{index}.jpg"),
                    "image/jpeg".into(),
                )
            })
            .collect();
        assert_eq!(
            AlbumUploadRequest::new(
                "album-op".into(),
                destination(None),
                items,
                String::new(),
                FrozenTransferProfile::default(),
                None
            )
            .unwrap_err(),
            AlbumUploadError::InvalidRequest
        );
    }
    let mut docs = request();
    docs.items[0].filename = "archive.zip".into();
    docs.items[0].mime_type = "application/zip".into();
    assert_eq!(
        docs.validate().unwrap_err(),
        AlbumUploadError::InvalidRequest
    );
    let mut ids = request();
    ids.items[1].random_id = ids.items[0].random_id;
    assert_eq!(
        ids.validate().unwrap_err(),
        AlbumUploadError::InvalidRequest
    );
}

#[test]
fn native_album_store_persists_exact_identity_progress_and_receipt() {
    let db = TempDb::new();
    let store = AlbumUploadStore::open(&db.0).unwrap();
    let request = request();
    let scope = request.destination.scope.clone();
    let record = store.enqueue(request.clone()).unwrap();
    assert_eq!(record.state, AlbumUploadState::Queued);
    assert_eq!(record.request, request);
    assert_eq!(
        store.enqueue(record.request.clone()).unwrap().request,
        record.request
    );
    assert_eq!(store.list(&scope, 10).unwrap().len(), 1);

    store
        .set_preparing(&record.request.operation_id, &scope)
        .unwrap();
    for index in 0..record.request.items.len() {
        let updated = store
            .mark_item_prepared(&record.request.operation_id, &scope, index)
            .unwrap();
        assert_eq!(updated.prepared_items, index + 1);
    }
    let committing = store
        .begin_commit(&record.request.operation_id, &scope)
        .unwrap();
    assert_eq!(committing.state, AlbumUploadState::Committing);
    let message_ids = vec![301, 302, 303];
    for (index, id) in message_ids.iter().copied().enumerate() {
        store
            .record_message_id(&record.request.operation_id, &scope, index, id)
            .unwrap();
    }
    let receipt = AlbumUploadReceipt {
        destination: record.request.destination.clone(),
        grouped_id: 9001,
        message_ids,
    };
    let completed = store
        .complete(&record.request.operation_id, &scope, receipt.clone())
        .unwrap();
    assert_eq!(completed.state, AlbumUploadState::Completed);
    assert_eq!(completed.receipt, Some(receipt));
    assert!(!store.has_recoverable().unwrap());
}

#[test]
fn native_album_store_rejects_cross_account_reads_and_unverified_completion() {
    let db = TempDb::new();
    let store = AlbumUploadStore::open(&db.0).unwrap();
    let request = request();
    let operation_id = request.operation_id.clone();
    store.enqueue(request.clone()).unwrap();
    let foreign = AccountScope::new("tg_999".into(), 999).unwrap();
    assert_eq!(
        store.get(&operation_id, &foreign).unwrap_err(),
        AlbumUploadError::WrongScope
    );
    store
        .set_preparing(&operation_id, &request.destination.scope)
        .unwrap();
    let incomplete = AlbumUploadReceipt {
        destination: request.destination.clone(),
        grouped_id: 8,
        message_ids: vec![31, 32],
    };
    assert_eq!(
        store
            .complete(&operation_id, &request.destination.scope, incomplete)
            .unwrap_err(),
        AlbumUploadError::ReviewRequired
    );
}

#[test]
fn recovery_requeues_only_precommit_work_and_never_resends_uncertain_commits() {
    let db = TempDb::new();
    let store = AlbumUploadStore::open(&db.0).unwrap();
    let queued = store.enqueue(request()).unwrap();
    store
        .set_preparing(
            &queued.request.operation_id,
            &queued.request.destination.scope,
        )
        .unwrap();
    store
        .mark_item_prepared(
            &queued.request.operation_id,
            &queued.request.destination.scope,
            0,
        )
        .unwrap();
    assert_eq!(store.recover_interrupted_commits().unwrap(), 0);
    let recovered = store
        .get(
            &queued.request.operation_id,
            &queued.request.destination.scope,
        )
        .unwrap();
    assert_eq!(recovered.state, AlbumUploadState::Queued);
    assert_eq!(recovered.prepared_items, 0);

    store
        .set_preparing(
            &queued.request.operation_id,
            &queued.request.destination.scope,
        )
        .unwrap();
    for index in 0..queued.request.items.len() {
        store
            .mark_item_prepared(
                &queued.request.operation_id,
                &queued.request.destination.scope,
                index,
            )
            .unwrap();
    }
    store
        .begin_commit(
            &queued.request.operation_id,
            &queued.request.destination.scope,
        )
        .unwrap();
    assert_eq!(store.recover_interrupted_commits().unwrap(), 1);
    let uncertain = store
        .get(
            &queued.request.operation_id,
            &queued.request.destination.scope,
        )
        .unwrap();
    assert_eq!(uncertain.state, AlbumUploadState::ReviewRequired);
    assert_eq!(
        uncertain.error_code.as_deref(),
        Some("unknown_commit_after_restart")
    );
    assert_eq!(
        uncertain
            .request
            .items
            .iter()
            .map(|item| item.random_id)
            .collect::<Vec<_>>(),
        queued
            .request
            .items
            .iter()
            .map(|item| item.random_id)
            .collect::<Vec<_>>()
    );
    assert!(store
        .begin_commit(
            &queued.request.operation_id,
            &queued.request.destination.scope
        )
        .is_err());
}

#[test]
fn persisted_pause_resume_and_cancel_keep_queue_state_consistent() {
    let db = TempDb::new();
    let store = AlbumUploadStore::open(&db.0).unwrap();
    let record = store.enqueue(request()).unwrap();
    let scope = &record.request.destination.scope;

    let paused = store
        .set_control(&record.request.operation_id, scope, Some("pause"))
        .unwrap();
    assert_eq!(paused.state, AlbumUploadState::Paused);
    assert!(store.pending(10).unwrap().is_empty());
    let resumed = store
        .set_control(&record.request.operation_id, scope, None)
        .unwrap();
    assert_eq!(resumed.state, AlbumUploadState::Queued);
    let cancelled = store
        .set_control(&record.request.operation_id, scope, Some("cancel"))
        .unwrap();
    assert_eq!(cancelled.state, AlbumUploadState::Cancelled);
    assert!(store
        .set_preparing(&record.request.operation_id, scope)
        .is_err());
}
