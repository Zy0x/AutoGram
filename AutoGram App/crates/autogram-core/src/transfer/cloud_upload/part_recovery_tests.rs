use super::*;

fn expire_transport(fixture: &Fixture) -> Transport {
    let mut transport = Transport::new(&fixture.request);
    transport.commit_failure = Some(UploadError::PartsExpired);
    transport
}
fn ready_now(fixture: &Fixture) {
    fixture
        .store
        .connection_for_fixture()
        .execute(
            "UPDATE native_cloud_uploads SET retry_not_before_ms=0 WHERE operation_id=?1",
            [&fixture.request.operation_id],
        )
        .unwrap();
}
fn restart_count(store: &UploadStore, id: &str) -> i64 {
    store
        .connection_for_fixture()
        .query_row(
            "SELECT coalesce((SELECT part_restarts FROM native_cloud_upload_recovery
            WHERE operation_id=?1),0)",
            [id],
            |row| row.get(0),
        )
        .unwrap()
}
async fn run(fixture: &Fixture, transport: &Transport) -> Result<UploadRecord, UploadError> {
    UploadExecutor::new(fixture.store.clone())
        .run(
            &fixture.request.operation_id,
            &fixture.request.destination.scope,
            transport,
            &CancellationToken::new(),
        )
        .await
}

#[tokio::test]
async fn definite_rejection_reallocates_only_parts_and_preserves_durable_retry_deadline() {
    let fixture = Fixture::new(&vec![7; UPLOAD_PART_BYTES + 1]);
    let queued = fixture.store.enqueue(fixture.request.clone()).unwrap();
    let transport = expire_transport(&fixture);
    let saved = run(&fixture, &transport).await.unwrap();
    assert_eq!(saved.state, UploadState::RetryWait);
    assert_eq!(saved.error_code.as_deref(), Some("upload_parts_expired"));
    assert_eq!(saved.request, queued.request);
    assert_ne!(saved.file_id, queued.file_id);
    assert_eq!(
        (saved.acknowledged_parts, saved.uploaded_bytes, saved.epoch),
        (0, 0, 2)
    );
    assert!(saved.retry_not_before_ms.unwrap() > super::super::store::now_ms());
    assert_eq!(
        restart_count(&fixture.store, &queued.request.operation_id),
        1
    );
    let deadline = saved.retry_not_before_ms;
    fixture
        .store
        .control(&queued.request.operation_id, &transport.scope, "retry")
        .unwrap();
    assert_eq!(
        run(&fixture, &transport).await.unwrap_err(),
        UploadError::InvalidState
    );
    assert_eq!(transport.commits.lock().len(), 1);
    let reopened = UploadStore::open(&fixture.root.join("fixture.db")).unwrap();
    let restored = reopened
        .get(&queued.request.operation_id, &transport.scope)
        .unwrap();
    assert_eq!(restored.retry_not_before_ms, deadline);
    assert_eq!(restart_count(&reopened, &queued.request.operation_id), 1);
    assert!(reopened.pending(10).unwrap().is_empty());
    let ledger: i64 = reopened
        .connection_for_fixture()
        .query_row("SELECT count(*) FROM upload_ledger", [], |row| row.get(0))
        .unwrap();
    assert_eq!(ledger, 0);
}

#[tokio::test]
async fn retry_reuploads_every_part_with_new_file_id_and_original_send_identity() {
    let fixture = Fixture::new(&vec![9; UPLOAD_PART_BYTES + 1]);
    let queued = fixture.store.enqueue(fixture.request.clone()).unwrap();
    let expired = run(&fixture, &expire_transport(&fixture)).await.unwrap();
    ready_now(&fixture);
    let transport = Transport::new(&fixture.request);
    let completed = run(&fixture, &transport).await.unwrap();
    assert_eq!(completed.state, UploadState::Completed);
    let parts = transport.parts.lock();
    assert_eq!(parts.len(), 2);
    assert_eq!(
        parts.iter().map(|part| part.1).collect::<Vec<_>>(),
        vec![0, 1]
    );
    assert!(parts
        .iter()
        .all(|part| part.0 == expired.file_id && part.0 != queued.file_id));
    assert_eq!(
        *transport.commits.lock(),
        vec![(expired.file_id, queued.request.random_id)]
    );
}

#[tokio::test]
async fn persistent_reallocation_budget_prevents_endless_missing_part_reuploads() {
    let fixture = Fixture::new(b"fixture");
    fixture.store.enqueue(fixture.request.clone()).unwrap();
    for expected in 1..=4 {
        ready_now(&fixture);
        let store = UploadStore::open(&fixture.root.join("fixture.db")).unwrap();
        let result = UploadExecutor::new(store.clone())
            .run(
                &fixture.request.operation_id,
                &fixture.request.destination.scope,
                &expire_transport(&fixture),
                &CancellationToken::new(),
            )
            .await
            .unwrap();
        assert_eq!(
            restart_count(&store, &fixture.request.operation_id),
            expected.min(3)
        );
        assert_eq!(
            result.state,
            if expected < 4 {
                UploadState::RetryWait
            } else {
                UploadState::Failed
            }
        );
        let state: String = store
            .connection_for_fixture()
            .query_row(
                "SELECT state FROM transfer_runs WHERE transfer_id=?1",
                [&fixture.request.operation_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(state, result.state.as_str().to_uppercase());
        if expected == 4 {
            assert!(store.pending(10).unwrap().is_empty());
        }
    }
}

#[tokio::test]
async fn missing_part_after_ambiguous_send_never_resets_or_automatically_resends() {
    let fixture = Fixture::new(b"fixture");
    let queued = fixture.store.enqueue(fixture.request.clone()).unwrap();
    let transport = expire_transport(&fixture);
    transport.failures.store(1, Ordering::SeqCst);
    assert_eq!(
        run(&fixture, &transport).await.unwrap_err(),
        UploadError::PartsExpired
    );
    let saved = fixture
        .store
        .get(&fixture.request.operation_id, &transport.scope)
        .unwrap();
    assert_eq!(saved.state, UploadState::ReviewRequired);
    assert_eq!(saved.file_id, queued.file_id);
    assert_eq!(saved.acknowledged_parts, 1);
    assert_eq!(
        restart_count(&fixture.store, &fixture.request.operation_id),
        0
    );
    assert_eq!(transport.commits.lock().len(), 2);
    assert_eq!(
        run(&fixture, &transport).await.unwrap_err(),
        UploadError::InvalidState
    );
    assert!(fixture
        .store
        .control(&fixture.request.operation_id, &transport.scope, "retry")
        .is_err());
    assert_eq!(transport.commits.lock().len(), 2);
}

#[tokio::test]
async fn obsolete_generation_cannot_ack_complete_or_repeat_reallocation() {
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
    assert!(fixture.store.begin_commit(&old).unwrap());
    fixture.store.restart_expired_parts(&old).unwrap();
    assert_eq!(
        fixture.store.restart_expired_parts(&old).unwrap_err(),
        UploadError::InvalidState
    );
    assert_eq!(
        fixture.store.acknowledge(&old, 0).unwrap_err(),
        UploadError::InvalidState
    );
    let receipt = Transport::new(&fixture.request)
        .commit_document(&fixture.request, old.file_id)
        .await
        .unwrap();
    assert_eq!(
        fixture.store.complete(&old, receipt).unwrap_err(),
        UploadError::InvalidState
    );
    assert_eq!(
        restart_count(&fixture.store, &fixture.request.operation_id),
        1
    );
    assert_eq!(
        fixture
            .store
            .get(
                &fixture.request.operation_id,
                &fixture.request.destination.scope
            )
            .unwrap()
            .state,
        UploadState::RetryWait
    );
}

#[test]
fn additive_recovery_migration_is_repeatable_and_matches_master_without_changing_existing_job() {
    let fixture = Fixture::new(b"fixture");
    let queued = fixture.store.enqueue(fixture.request.clone()).unwrap();
    let conn = fixture.store.connection_for_fixture();
    // Simulate an existing 026 database; only this test-owned empty extension is removed.
    conn.execute_batch("DROP TABLE native_cloud_upload_recovery")
        .unwrap();
    for _ in 0..2 {
        conn.execute_batch(super::super::part_recovery::SCHEMA)
            .unwrap();
    }
    let master = rusqlite::Connection::open_in_memory().unwrap();
    master
        .execute_batch(include_str!("../../../../../database/schema.sql"))
        .unwrap();
    let columns = |db: &rusqlite::Connection| {
        db.prepare("PRAGMA table_info(native_cloud_upload_recovery)")
            .unwrap()
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    assert_eq!(columns(&conn), columns(&master));
    assert!(conn
        .execute(
            "INSERT INTO native_cloud_upload_recovery VALUES (?1,4,0)",
            [&fixture.request.operation_id]
        )
        .is_err());
    drop(conn);
    let saved = fixture
        .store
        .get(
            &fixture.request.operation_id,
            &fixture.request.destination.scope,
        )
        .unwrap();
    assert_eq!(saved.request, queued.request);
    assert_eq!(saved.file_id, queued.file_id);
    assert_eq!(saved.state, UploadState::Queued);
}
