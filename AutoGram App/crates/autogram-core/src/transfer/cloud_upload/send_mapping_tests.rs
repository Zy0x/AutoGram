use super::super::send_mapping::CommitJournal;
use super::*;

fn map_count(store: &UploadStore) -> i64 {
    store
        .connection_for_fixture()
        .query_row(
            "SELECT count(*) FROM native_cloud_upload_send_mapping",
            [],
            |row| row.get(0),
        )
        .unwrap()
}
async fn mapped_but_interrupted(fixture: &Fixture, failure: UploadError) -> UploadRecord {
    fixture.store.enqueue(fixture.request.clone()).unwrap();
    let mut transport = Transport::new(&fixture.request);
    transport.journal_before_failure = true;
    transport.commit_failure = Some(failure.clone());
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
        failure
    );
    assert_eq!(transport.commits.lock().len(), 1);
    assert_eq!(map_count(&fixture.store), 1);
    let saved = fixture
        .store
        .get(&fixture.request.operation_id, &transport.scope)
        .unwrap();
    assert_eq!(saved.state, UploadState::ReviewRequired);
    saved
}
async fn reconcile(fixture: &Fixture, transport: &Transport) -> Result<UploadRecord, UploadError> {
    UploadExecutor::new(fixture.store.clone())
        .reconcile(
            &fixture.request.operation_id,
            &fixture.request.destination.scope,
            transport,
            &CancellationToken::new(),
        )
        .await
}

#[tokio::test]
async fn journal_survives_interrupted_receipt_and_completes_without_source_or_resend() {
    let fixture = Fixture::new(b"fixture");
    let saved = mapped_but_interrupted(&fixture, UploadError::Network).await;
    std::fs::remove_file(&fixture.request.source.path).unwrap();
    let reopened = UploadStore::open(&fixture.root.join("fixture.db")).unwrap();
    let transport = Transport::new(&fixture.request);
    let executor = UploadExecutor::new(reopened.clone());
    let complete = executor
        .reconcile(
            &fixture.request.operation_id,
            &transport.scope,
            &transport,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(complete.state, UploadState::Completed);
    assert_eq!(complete.request, saved.request);
    assert_eq!(complete.file_id, saved.file_id);
    assert_eq!(*transport.reads.lock(), vec![57]);
    assert!(transport.commits.lock().is_empty());
    assert!(transport.parts.lock().is_empty());
    let (ledger, item, state): (i64, i32, String) = reopened.connection_for_fixture().query_row(
        "SELECT (SELECT count(*) FROM upload_ledger),telegram_message_id,
        (SELECT state FROM transfer_runs WHERE transfer_id=?1) FROM transfer_items_v4 WHERE transfer_id=?1",
        [&fixture.request.operation_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).unwrap();
    assert_eq!((ledger, item, state), (1, 57, "COMPLETED".into()));
    let again = executor
        .reconcile(
            &fixture.request.operation_id,
            &transport.scope,
            &transport,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(again.receipt, complete.receipt);
    assert_eq!(transport.reads.lock().len(), 1);
}

#[tokio::test]
async fn exact_mapping_prevents_part_replacement_even_if_later_fetch_reports_missing_part() {
    let fixture = Fixture::new(b"fixture");
    let saved = mapped_but_interrupted(&fixture, UploadError::PartsExpired).await;
    assert_eq!(saved.acknowledged_parts, 1);
    assert!(fixture.store.restart_expired_parts(&saved).is_err());
    let recovery: i64 = fixture
        .store
        .connection_for_fixture()
        .query_row(
            "SELECT count(*) FROM native_cloud_upload_recovery",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(recovery, 0);
    assert_eq!(
        reconcile(&fixture, &Transport::new(&fixture.request))
            .await
            .unwrap()
            .state,
        UploadState::Completed
    );
}

#[tokio::test]
async fn unknown_send_without_mapping_never_guesses_message_or_searches_or_resends() {
    let fixture = Fixture::new(b"fixture");
    fixture.store.enqueue(fixture.request.clone()).unwrap();
    let old = fixture
        .store
        .claim(
            &fixture.request.operation_id,
            &fixture.request.destination.scope,
        )
        .unwrap();
    fixture.store.acknowledge(&old, 0).unwrap();
    fixture.store.begin_commit(&old).unwrap();
    let transport = Transport::new(&fixture.request);
    assert_eq!(
        reconcile(&fixture, &transport).await.unwrap_err(),
        UploadError::ReviewRequired
    );
    assert!(transport.reads.lock().is_empty());
    assert!(transport.commits.lock().is_empty());
    assert!(transport.parts.lock().is_empty());
    assert_eq!(map_count(&fixture.store), 0);
}

#[tokio::test]
async fn wrong_topic_or_message_id_is_not_a_receipt_and_never_completes() {
    let fixture = Fixture::new(b"fixture");
    mapped_but_interrupted(&fixture, UploadError::Cancelled).await;
    let mut transport = Transport::new(&fixture.request);
    transport.wrong_receipt = true;
    assert_eq!(
        reconcile(&fixture, &transport).await.unwrap_err(),
        UploadError::ReceiptMismatch
    );
    transport.wrong_receipt = false;
    transport.wrong_message_id = Some(58);
    assert_eq!(
        reconcile(&fixture, &transport).await.unwrap_err(),
        UploadError::ReceiptMismatch
    );
    assert!(transport.commits.lock().is_empty());
    let saved = fixture
        .store
        .get(&fixture.request.operation_id, &transport.scope)
        .unwrap();
    assert_eq!(saved.state, UploadState::ReviewRequired);
    let ledger: i64 = fixture
        .store
        .connection_for_fixture()
        .query_row("SELECT count(*) FROM upload_ledger", [], |row| row.get(0))
        .unwrap();
    assert_eq!(ledger, 0);
}

#[tokio::test]
async fn read_flood_wait_persists_and_cannot_be_bypassed_by_another_recovery_call() {
    let fixture = Fixture::new(b"fixture");
    mapped_but_interrupted(&fixture, UploadError::Network).await;
    let mut transport = Transport::new(&fixture.request);
    transport.reconcile_failure = Some(UploadError::FloodWait {
        retry_after_ms: 60_000,
    });
    assert!(matches!(
        reconcile(&fixture, &transport).await,
        Err(UploadError::FloodWait { .. })
    ));
    let saved = fixture
        .store
        .get(&fixture.request.operation_id, &transport.scope)
        .unwrap();
    assert_eq!(saved.state, UploadState::ReviewRequired);
    assert!(saved.retry_not_before_ms.unwrap() > super::super::store::now_ms());
    transport.reconcile_failure = None;
    assert_eq!(
        reconcile(&fixture, &transport).await.unwrap_err(),
        UploadError::InvalidState
    );
    assert_eq!(*transport.reads.lock(), vec![57]);
    assert!(fixture
        .store
        .control(&fixture.request.operation_id, &transport.scope, "retry")
        .is_err());
    assert!(transport.commits.lock().is_empty());
}

#[tokio::test]
async fn wrong_account_and_cancelled_read_cannot_publish_a_late_success() {
    let fixture = Fixture::new(b"fixture");
    mapped_but_interrupted(&fixture, UploadError::Network).await;
    let transport = Transport::new(&fixture.request);
    let executor = UploadExecutor::new(fixture.store.clone());
    assert_eq!(
        executor
            .reconcile(
                &fixture.request.operation_id,
                &AccountScope::new("tg_124".into(), 124).unwrap(),
                &transport,
                &CancellationToken::new()
            )
            .await
            .unwrap_err(),
        UploadError::WrongScope
    );
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert_eq!(
        executor
            .reconcile(
                &fixture.request.operation_id,
                &transport.scope,
                &transport,
                &cancel
            )
            .await
            .unwrap_err(),
        UploadError::Cancelled
    );
    assert!(transport.reads.lock().is_empty());
    assert_eq!(
        fixture
            .store
            .get(&fixture.request.operation_id, &transport.scope)
            .unwrap()
            .state,
        UploadState::ReviewRequired
    );
}

#[test]
fn journal_is_exact_idempotent_immutable_and_rejects_conflicts_or_old_generation() {
    let fixture = Fixture::new(b"fixture");
    fixture.store.enqueue(fixture.request.clone()).unwrap();
    let old = fixture
        .store
        .claim(
            &fixture.request.operation_id,
            &fixture.request.destination.scope,
        )
        .unwrap();
    let journal = CommitJournal {
        store: &fixture.store,
        record: &old,
    };
    assert_eq!(
        journal.record_message_id(57).unwrap_err(),
        UploadError::InvalidState
    );
    fixture.store.acknowledge(&old, 0).unwrap();
    fixture.store.begin_commit(&old).unwrap();
    assert_eq!(
        journal.record_message_id(0).unwrap_err(),
        UploadError::ReceiptMismatch
    );
    journal.record_message_id(57).unwrap();
    journal.record_message_id(57).unwrap();
    assert_eq!(
        journal.record_message_id(58).unwrap_err(),
        UploadError::ReceiptMismatch
    );
    assert_eq!(map_count(&fixture.store), 1);
    assert!(fixture
        .store
        .connection_for_fixture()
        .execute(
            "UPDATE native_cloud_upload_send_mapping SET message_id=58",
            []
        )
        .is_err());
    fixture
        .store
        .transition(
            &old,
            UploadState::ReviewRequired,
            Some("interrupted_commit"),
            None,
        )
        .unwrap();
    assert_eq!(
        journal.record_message_id(57).unwrap_err(),
        UploadError::InvalidState
    );
}
