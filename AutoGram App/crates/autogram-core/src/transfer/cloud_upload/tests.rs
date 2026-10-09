use super::*;
use crate::transfer::{
    cloud_download::{AccountScope, PeerKind},
    FrozenTransferProfile, PresentationOverride,
};
use async_trait::async_trait;
use parking_lot::Mutex;
use std::{
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};
use tokio_util::sync::CancellationToken;

struct Fixture {
    root: PathBuf,
    store: UploadStore,
    request: UploadRequest,
}
impl Fixture {
    fn new(bytes: &[u8]) -> Self {
        let root =
            std::env::temp_dir().join(format!("autogram-upload-fixture-{}", rand::random::<u64>()));
        std::fs::create_dir(&root).unwrap();
        let root = std::fs::canonicalize(root).unwrap();
        let path = root.join("fixture.txt");
        std::fs::write(&path, bytes).unwrap();
        let store = UploadStore::open(&root.join("fixture.db")).unwrap();
        let mut profile = FrozenTransferProfile::default();
        profile.presentation_override = PresentationOverride::ForceDocument;
        profile.group_as_album = false;
        profile.group_documents = false;
        let request = UploadRequest {
            operation_id: "fixture-operation".into(),
            destination: UploadDestination {
                scope: AccountScope::new("tg_123".into(), 123).unwrap(),
                peer_kind: PeerKind::Channel,
                peer_id: 321,
                topic_id: Some(17),
            },
            source: snapshot_upload_file(&path).unwrap(),
            filename: "fixture.txt".into(),
            mime_type: "text/plain".into(),
            caption: "fixture".into(),
            profile,
            random_id: 919,
        };
        Self {
            root,
            store,
            request,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // Close the isolated database before deleting this fixture directory on Windows.
        *self.store.connection_for_fixture() = rusqlite::Connection::open_in_memory().unwrap();
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

struct Transport {
    scope: AccountScope,
    destination: UploadDestination,
    parts: Mutex<Vec<(i64, usize, Vec<u8>)>>,
    commits: Mutex<Vec<(i64, i64)>>,
    failures: AtomicUsize,
    part_failure: Option<UploadError>,
    commit_failure: Option<UploadError>,
    wrong_receipt: bool,
    pause_after_part: Option<(UploadStore, String)>,
}
impl Transport {
    fn new(request: &UploadRequest) -> Self {
        Self {
            scope: request.destination.scope.clone(),
            destination: request.destination.clone(),
            parts: Mutex::new(vec![]),
            commits: Mutex::new(vec![]),
            failures: AtomicUsize::new(0),
            part_failure: None,
            commit_failure: None,
            wrong_receipt: false,
            pause_after_part: None,
        }
    }
}
#[async_trait]
impl CloudUploadTransport for Transport {
    fn scope(&self) -> &AccountScope {
        &self.scope
    }
    async fn limits(&self) -> Result<UploadLimits, UploadError> {
        Ok(UploadLimits {
            max_parts: 8000,
            caption_utf16: 1024,
        })
    }
    async fn validate_destination(
        &self,
        destination: &UploadDestination,
    ) -> Result<(), UploadError> {
        if destination != &self.destination {
            return Err(UploadError::WrongScope);
        }
        Ok(())
    }
    async fn save_part(
        &self,
        _request: &UploadRequest,
        file_id: i64,
        part: usize,
        bytes: Vec<u8>,
    ) -> Result<(), UploadError> {
        if let Some(error) = &self.part_failure {
            return Err(error.clone());
        }
        self.parts.lock().push((file_id, part, bytes));
        if let Some((store, id)) = &self.pause_after_part {
            store.control(id, &self.scope, "pause")?;
        }
        Ok(())
    }
    async fn commit_document(
        &self,
        request: &UploadRequest,
        file_id: i64,
    ) -> Result<UploadReceipt, UploadError> {
        self.commits.lock().push((file_id, request.random_id));
        if self
            .failures
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| v.checked_sub(1))
            .is_ok()
        {
            return Err(UploadError::Network);
        }
        if let Some(error) = &self.commit_failure {
            return Err(error.clone());
        }
        let mut destination = self.destination.clone();
        if self.wrong_receipt {
            destination.topic_id = Some(18);
        }
        Ok(UploadReceipt {
            destination,
            random_id: request.random_id,
            message_id: 57,
            document_id: 891,
            size: request.source.size,
            filename: request.filename.clone(),
        })
    }
}

#[test]
fn immutable_enqueue_freezes_destination_profile_and_random_id() {
    let fixture = Fixture::new(b"actual fixture");
    let first = fixture.store.enqueue(fixture.request.clone()).unwrap();
    let same = fixture.store.enqueue(fixture.request.clone()).unwrap();
    assert_eq!(first.file_id, same.file_id);
    let mut changed = fixture.request.clone();
    changed.destination.topic_id = Some(18);
    assert_eq!(
        fixture.store.enqueue(changed).unwrap_err(),
        UploadError::Conflict
    );
    let foreign = AccountScope::new("tg_456".into(), 456).unwrap();
    assert_eq!(
        fixture
            .store
            .get(&fixture.request.operation_id, &foreign)
            .unwrap_err(),
        UploadError::WrongScope
    );
    assert!(fixture.store.list(&foreign, 100).unwrap().is_empty());
}

#[test]
fn cancelled_preflight_never_hashes_or_enqueues_a_missing_source() {
    let fixture = Fixture::new(b"fixture");
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert_eq!(
        snapshot_upload_file_cancellable(&fixture.root.join("missing"), &cancel).unwrap_err(),
        UploadError::Cancelled
    );
    assert!(fixture.store.pending(100).unwrap().is_empty());
}
#[test]
fn original_document_contract_rejects_album_native_and_invalid_paths() {
    let fixture = Fixture::new(b"fixture");
    let mut request = fixture.request.clone();
    request.profile.group_as_album = true;
    assert_eq!(request.validate(), Err(UploadError::UnsupportedProfile));
    request = fixture.request.clone();
    request.filename = "../escape.txt".into();
    assert_eq!(request.validate(), Err(UploadError::InvalidRequest));
    request = fixture.request.clone();
    request.random_id = 0;
    assert_eq!(request.validate(), Err(UploadError::InvalidRequest));
    request = fixture.request.clone();
    request.source.part_sha256.clear();
    assert_eq!(request.validate(), Err(UploadError::InvalidRequest));
}
#[tokio::test]
async fn verified_receipt_atomically_completes_run_item_and_ledger() {
    let fixture = Fixture::new(&vec![37; UPLOAD_PART_BYTES + 7]);
    fixture.store.enqueue(fixture.request.clone()).unwrap();
    let transport = Transport::new(&fixture.request);
    let record = UploadExecutor::new(fixture.store.clone())
        .run(
            &fixture.request.operation_id,
            &fixture.request.destination.scope,
            &transport,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(record.state, UploadState::Completed);
    assert_eq!(record.uploaded_bytes, fixture.request.source.size);
    assert_eq!(
        transport
            .parts
            .lock()
            .iter()
            .map(|(_, p, b)| (*p, b.len()))
            .collect::<Vec<_>>(),
        vec![(0, UPLOAD_PART_BYTES), (1, 7)]
    );
    let conn = fixture.store.connection_for_fixture();
    let states: (String, String, i32) = conn
        .query_row(
            "SELECT r.state,i.state,i.telegram_message_id FROM transfer_runs r
        JOIN transfer_items_v4 i ON r.transfer_id=i.transfer_id",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(states, ("COMPLETED".into(), "COMPLETED".into(), 57));
    assert_eq!(
        conn.query_row("SELECT count(*) FROM upload_ledger", [], |r| r
            .get::<_, i32>(0))
            .unwrap(),
        1
    );
}
#[tokio::test]
async fn worker_retries_commit_with_identical_persisted_ids() {
    let fixture = Fixture::new(b"fixture");
    fixture.store.enqueue(fixture.request.clone()).unwrap();
    let transport = Transport::new(&fixture.request);
    transport.failures.store(2, Ordering::SeqCst);
    let result = UploadExecutor::new(fixture.store.clone())
        .run(
            &fixture.request.operation_id,
            &fixture.request.destination.scope,
            &transport,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result.state, UploadState::Completed);
    let commits = transport.commits.lock();
    assert_eq!(commits.len(), 3);
    assert!(commits.iter().all(|v| *v == commits[0]));
}
#[tokio::test]
async fn wrong_receipt_and_ambiguous_commit_never_report_success_or_auto_resend() {
    let fixture = Fixture::new(b"fixture");
    fixture.store.enqueue(fixture.request.clone()).unwrap();
    let mut transport = Transport::new(&fixture.request);
    transport.wrong_receipt = true;
    let executor = UploadExecutor::new(fixture.store.clone());
    assert_eq!(
        executor
            .run(
                &fixture.request.operation_id,
                &fixture.request.destination.scope,
                &transport,
                &CancellationToken::new()
            )
            .await
            .unwrap_err(),
        UploadError::ReceiptMismatch
    );
    assert_eq!(
        fixture
            .store
            .get(&fixture.request.operation_id, &transport.scope)
            .unwrap()
            .state,
        UploadState::ReviewRequired
    );
    assert!(fixture.store.pending(10).unwrap().is_empty());
    assert!(fixture
        .store
        .control(&fixture.request.operation_id, &transport.scope, "retry")
        .is_err());
    assert!(executor
        .run(
            &fixture.request.operation_id,
            &transport.scope,
            &transport,
            &CancellationToken::new()
        )
        .await
        .is_err());
    assert_eq!(transport.commits.lock().len(), 1);
}
#[tokio::test]
async fn source_mutation_is_detected_before_any_upload() {
    let fixture = Fixture::new(b"original");
    fixture.store.enqueue(fixture.request.clone()).unwrap();
    std::fs::write(&fixture.request.source.path, b"modified").unwrap();
    let transport = Transport::new(&fixture.request);
    assert_eq!(
        UploadExecutor::new(fixture.store.clone())
            .run(
                &fixture.request.operation_id,
                &transport.scope,
                &transport,
                &CancellationToken::new()
            )
            .await
            .unwrap_err(),
        UploadError::SourceChanged
    );
    assert!(transport.parts.lock().is_empty());
    assert!(transport.commits.lock().is_empty());
}
#[tokio::test]
async fn pause_after_ack_preserves_progress_and_prevents_commit() {
    let fixture = Fixture::new(&vec![8; UPLOAD_PART_BYTES + 1]);
    fixture.store.enqueue(fixture.request.clone()).unwrap();
    let mut transport = Transport::new(&fixture.request);
    transport.pause_after_part =
        Some((fixture.store.clone(), fixture.request.operation_id.clone()));
    let record = UploadExecutor::new(fixture.store.clone())
        .run(
            &fixture.request.operation_id,
            &transport.scope,
            &transport,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(record.state, UploadState::Paused);
    assert_eq!(record.acknowledged_parts, 1);
    assert!(transport.commits.lock().is_empty());
    assert!(fixture.store.pending(10).unwrap().is_empty());
}
#[tokio::test]
async fn flood_wait_deadline_survives_explicit_retry() {
    let fixture = Fixture::new(b"fixture");
    fixture.store.enqueue(fixture.request.clone()).unwrap();
    let mut transport = Transport::new(&fixture.request);
    transport.part_failure = Some(UploadError::FloodWait {
        retry_after_ms: 60_000,
    });
    assert!(UploadExecutor::new(fixture.store.clone())
        .run(
            &fixture.request.operation_id,
            &transport.scope,
            &transport,
            &CancellationToken::new()
        )
        .await
        .is_err());
    let old = fixture
        .store
        .get(&fixture.request.operation_id, &transport.scope)
        .unwrap()
        .retry_not_before_ms;
    fixture
        .store
        .control(&fixture.request.operation_id, &transport.scope, "retry")
        .unwrap();
    assert_eq!(
        fixture
            .store
            .get(&fixture.request.operation_id, &transport.scope)
            .unwrap()
            .retry_not_before_ms,
        old
    );
    assert!(fixture.store.pending(10).unwrap().is_empty());
    assert!(fixture.store.has_recoverable().unwrap());
}
#[test]
fn cross_store_worker_lock_and_interrupted_commit_are_conservative() {
    let fixture = Fixture::new(b"fixture");
    fixture.store.enqueue(fixture.request.clone()).unwrap();
    let lock = fixture.store.lock_worker(&fixture.request).unwrap();
    let second = UploadStore::open(&fixture.root.join("fixture.db")).unwrap();
    assert!(matches!(
        second.lock_worker(&fixture.request),
        Err(UploadError::Busy)
    ));
    drop(lock);
    let _second = second.lock_worker(&fixture.request).unwrap();
    let record = second
        .claim(
            &fixture.request.operation_id,
            &fixture.request.destination.scope,
        )
        .unwrap();
    second.acknowledge(&record, 0).unwrap();
    assert!(second.begin_commit(&record).unwrap());
    assert_eq!(
        second
            .claim(
                &fixture.request.operation_id,
                &fixture.request.destination.scope
            )
            .unwrap_err(),
        UploadError::ReviewRequired
    );
    assert_eq!(
        second
            .get(
                &fixture.request.operation_id,
                &fixture.request.destination.scope
            )
            .unwrap()
            .state,
        UploadState::ReviewRequired
    );
}
#[test]
fn schema_matches_master_and_binding_trigger_rejects_retargeting() {
    let fixture = Fixture::new(b"fixture");
    fixture.store.enqueue(fixture.request.clone()).unwrap();
    let master = rusqlite::Connection::open_in_memory().unwrap();
    master
        .execute_batch(include_str!("../../../../../database/schema.sql"))
        .unwrap();
    let conn = fixture.store.connection_for_fixture();
    conn.execute_batch(super::store::SCHEMA).unwrap();
    let columns = |c: &rusqlite::Connection| {
        c.prepare("PRAGMA table_info(native_cloud_uploads)")
            .unwrap()
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    assert_eq!(columns(&conn), columns(&master));
    assert!(conn
        .execute("UPDATE native_cloud_uploads SET random_id=18", [])
        .is_err());
}

#[test]
fn stale_preflight_cannot_demote_claimed_work_and_review_needs_no_cloud_auth() {
    let fixture = Fixture::new(b"fixture");
    fixture.store.enqueue(fixture.request.clone()).unwrap();
    let scope = &fixture.request.destination.scope;
    let id = &fixture.request.operation_id;
    let record = fixture.store.claim(id, scope).unwrap();
    fixture
        .store
        .fail_preflight(id, scope, &UploadError::Unauthorized)
        .unwrap();
    assert_eq!(
        fixture.store.get(id, scope).unwrap().state,
        UploadState::Running
    );
    fixture.store.acknowledge(&record, 0).unwrap();
    fixture.store.begin_commit(&record).unwrap();
    let reviewed = fixture.store.review_interrupted_commit(id, scope).unwrap();
    assert_eq!(reviewed.state, UploadState::ReviewRequired);
}

#[tokio::test]
async fn resume_uses_acknowledged_parts_without_cancelling_the_parent_worker() {
    let fixture = Fixture::new(&vec![9; UPLOAD_PART_BYTES + 3]);
    fixture.store.enqueue(fixture.request.clone()).unwrap();
    let mut transport = Transport::new(&fixture.request);
    transport.pause_after_part =
        Some((fixture.store.clone(), fixture.request.operation_id.clone()));
    let parent = CancellationToken::new();
    let executor = UploadExecutor::new(fixture.store.clone());
    let id = &fixture.request.operation_id;
    assert_eq!(
        executor
            .run(id, &transport.scope, &transport, &parent)
            .await
            .unwrap()
            .state,
        UploadState::Paused
    );
    assert!(!parent.is_cancelled());
    let first_id = transport.parts.lock()[0].0;
    fixture
        .store
        .control(id, &transport.scope, "retry")
        .unwrap();
    transport.pause_after_part = None;
    assert_eq!(
        executor
            .run(id, &transport.scope, &transport, &parent)
            .await
            .unwrap()
            .state,
        UploadState::Completed
    );
    assert_eq!(
        transport
            .parts
            .lock()
            .iter()
            .map(|(file, part, _)| (*file, *part))
            .collect::<Vec<_>>(),
        vec![(first_id, 0), (first_id, 1)]
    );
    assert!(!parent.is_cancelled());
}
