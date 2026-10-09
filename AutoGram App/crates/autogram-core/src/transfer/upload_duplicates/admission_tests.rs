use super::*;
use crate::transfer::{
    cloud_upload::{UploadRequest, UploadState},
    FrozenTransferProfile, PresentationOverride,
};

fn request(f: &Fixture, id: &str) -> UploadRequest {
    let mut profile = FrozenTransferProfile::default();
    profile.presentation_override = PresentationOverride::ForceDocument;
    profile.group_as_album = false;
    profile.group_documents = false;
    UploadRequest {
        operation_id: id.into(),
        destination: f.query.destination.clone(),
        source: f.query.source.clone(),
        filename: f.query.filename.clone(),
        mime_type: "text/plain".into(),
        caption: String::new(),
        profile,
        profile_binding: None,
        random_id: 919,
    }
}
fn matching(f: &Fixture) -> FakeSource {
    f.row(
        &f.query.destination,
        41,
        Some("901"),
        &f.query.source.sha256,
        "fixture.txt",
        f.query.source.size,
    );
    let mut source = f.source();
    source
        .documents
        .insert(41, f.document(41, 901, "fixture.txt"));
    source
}
async fn plan(
    f: &Fixture,
    req: UploadRequest,
    source: &FakeSource,
) -> Result<UploadAdmissionPlan, UploadError> {
    plan_identical_upload_admission(f.store(), req, None, source, &CancellationToken::new()).await
}
#[tokio::test]
async fn strong_skip_is_persisted_as_reuse_and_never_fakes_sent_parts_or_commit_mapping() {
    let f = Fixture::new();
    let req = request(&f, "reuse-op");
    let source = matching(&f);
    let admission = plan(&f, req.clone(), &source)
        .await
        .unwrap()
        .commit(f.store())
        .unwrap();
    let UploadAdmission::Reused(reused) = admission else {
        panic!("verified equal bytes should reuse");
    };
    assert_eq!(reused.request, req);
    assert_eq!(reused.document.message_id, 41);
    assert_eq!(reused.level, DuplicateLevel::Sha256);
    assert!(matches!(
        f.store().get("reuse-op", &req.destination.scope),
        Err(UploadError::NotFound)
    ));
    f.store().inspect_ledger(|conn|{
        for table in ["native_cloud_uploads","native_cloud_upload_send_mapping"] {
            assert_eq!(conn.query_row(&format!("SELECT COUNT(*) FROM {table}"),[],|r|r.get::<_,i64>(0)).unwrap(),0);
        }
        assert_eq!(conn.query_row("SELECT state FROM transfer_runs WHERE transfer_id='reuse-op'",[],|r|r.get::<_,String>(0)).unwrap(),"SKIPPED");
        assert_eq!(conn.query_row("SELECT telegram_message_id FROM transfer_items_v4 WHERE transfer_id='reuse-op'",[],|r|r.get::<_,i32>(0)).unwrap(),41);
        Ok(())
    }).unwrap();
    assert!(f.store().pending(100).unwrap().is_empty());
}
#[tokio::test]
async fn restart_retains_first_reuse_without_source_or_server_reads_and_blocks_reinterpretation() {
    let mut f = Fixture::new();
    let req = request(&f, "reuse-op");
    let source = matching(&f);
    let UploadAdmission::Reused(first) = plan(&f, req.clone(), &source)
        .await
        .unwrap()
        .commit(f.store())
        .unwrap()
    else {
        panic!();
    };
    drop(f.store.take());
    f.store = Some(UploadStore::open(&f.root.join("fixture.db")).unwrap());
    std::fs::remove_file(&req.source.path).unwrap();
    let mut offline = f.source();
    offline.failure = Some(UploadError::Network);
    let UploadAdmission::Reused(retry) = plan(&f, req.clone(), &offline)
        .await
        .unwrap()
        .commit(f.store())
        .unwrap()
    else {
        panic!();
    };
    assert_eq!(retry.request, first.request);
    assert_eq!(retry.document, first.document);
    assert_eq!(retry.created_ms, first.created_ms);
    assert!(offline.calls.lock().is_empty());
    assert_eq!(
        f.store().enqueue(req.clone()).unwrap_err(),
        UploadError::Conflict
    );
    let mut changed = req.clone();
    changed.caption = "changed".into();
    assert!(matches!(
        plan(&f, changed, &offline).await,
        Err(UploadError::Conflict)
    ));
    let wrong = AccountScope::new("tg_88".into(), 88).unwrap();
    assert_eq!(
        f.store().get_reuse("reuse-op", &wrong).unwrap_err(),
        UploadError::WrongScope
    );
}
#[tokio::test]
async fn weak_or_incomplete_evidence_needs_review_and_cancelled_plan_cannot_admit() {
    let f = Fixture::new();
    f.row(
        &f.query.destination,
        41,
        Some("901"),
        &"1".repeat(64),
        "fixture.txt",
        f.query.source.size,
    );
    let mut source = f.source();
    source
        .documents
        .insert(41, f.document(41, 901, "fixture.txt"));
    assert!(matches!(
        plan(&f, request(&f, "weak-op"), &source).await,
        Err(UploadError::ReviewRequired)
    ));
    let inspected = inspect(&f, &source).await.unwrap();
    assert_eq!(
        f.store()
            .reuse_verified_document(request(&f, "weak-op"), &inspected.matches[0])
            .unwrap_err(),
        UploadError::ReceiptMismatch
    );
    let f = Fixture::new();
    let source = f.source();
    let cancel = CancellationToken::new();
    let prepared = plan_identical_upload_admission(
        f.store(),
        request(&f, "cancel-op"),
        None,
        &source,
        &cancel,
    )
    .await
    .unwrap();
    cancel.cancel();
    assert!(matches!(
        prepared.commit(f.store()),
        Err(UploadError::Cancelled)
    ));
    f.store()
        .inspect_ledger(|conn| {
            assert_eq!(
                conn.query_row("SELECT COUNT(*) FROM transfer_runs", [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
            Ok(())
        })
        .unwrap();
    f.row(
        &f.query.destination,
        41,
        Some("legacy-unknown"),
        &f.query.source.sha256,
        "fixture.txt",
        f.query.source.size,
    );
    assert!(matches!(
        plan(&f, request(&f, "unknown-op"), &source).await,
        Err(UploadError::ReviewRequired)
    ));
}
#[tokio::test]
async fn reuse_proof_cannot_bind_different_bytes_topic_or_existing_queued_operation() {
    let f = Fixture::new();
    let source = matching(&f);
    let proof = inspect(&f, &source).await.unwrap().matches.remove(0);
    let req = request(&f, "reuse-op");
    for mutation in 0..2 {
        let mut other = req.clone();
        if mutation == 0 {
            std::fs::write(f.root.join("other.staged"), b"different bytes").unwrap();
            other.source = snapshot_upload_file(&f.root.join("other.staged")).unwrap();
        } else {
            other.destination.topic_id = Some(18);
        }
        assert_eq!(
            f.store()
                .reuse_verified_document(other, &proof)
                .unwrap_err(),
            UploadError::ReceiptMismatch
        );
    }
    f.store().enqueue(req.clone()).unwrap();
    assert_eq!(
        f.store()
            .reuse_verified_document(req.clone(), &proof)
            .unwrap_err(),
        UploadError::Conflict
    );
    let admitted = plan(&f, req.clone(), &source)
        .await
        .unwrap()
        .commit(f.store())
        .unwrap();
    assert!(
        matches!(admitted,UploadAdmission::Queued(record) if record.state==UploadState::Queued)
    );
}
#[tokio::test]
async fn concurrent_skip_admissions_reserve_only_one_scoped_pending_payload() {
    let f = Fixture::new();
    let source = f.source();
    let one = request(&f, "queue-one");
    let two = request(&f, "queue-two");
    let plan_one = plan(&f, one.clone(), &source).await.unwrap();
    let plan_two = plan(&f, two.clone(), &source).await.unwrap();
    let other_store = UploadStore::open(&f.root.join("fixture.db")).unwrap();
    let barrier = std::sync::Barrier::new(2);
    let (first, second) = std::thread::scope(|scope| {
        let a = scope.spawn(|| {
            barrier.wait();
            plan_one.commit(f.store())
        });
        let b = scope.spawn(|| {
            barrier.wait();
            plan_two.commit(&other_store)
        });
        (a.join().unwrap(), b.join().unwrap())
    });
    assert_eq!(
        [&first, &second]
            .iter()
            .filter(|r| matches!(r, Ok(UploadAdmission::Queued(_))))
            .count(),
        1
    );
    assert_eq!(
        [&first, &second]
            .iter()
            .filter(|r| matches!(r, Err(UploadError::Busy)))
            .count(),
        1
    );
    let winner = if first.is_ok() { one } else { two };
    assert!(matches!(
        plan(&f, winner.clone(), &source)
            .await
            .unwrap()
            .commit(f.store())
            .unwrap(),
        UploadAdmission::Queued(_)
    ));
    let mut other_topic = request(&f, "queue-other-topic");
    other_topic.destination.topic_id = Some(18);
    assert!(matches!(
        plan(&f, other_topic, &source)
            .await
            .unwrap()
            .commit(f.store())
            .unwrap(),
        UploadAdmission::Queued(_)
    ));
    f.store()
        .control(&winner.operation_id, &winner.destination.scope, "cancel")
        .unwrap();
    assert!(matches!(
        plan(&f, request(&f, "queue-after-cancel"), &source)
            .await
            .unwrap()
            .commit(f.store())
            .unwrap(),
        UploadAdmission::Queued(_)
    ));
    drop(other_store);
}

#[tokio::test]
async fn ledger_change_between_inspection_and_admission_requires_reinspection() {
    let f = Fixture::new();
    let req = request(&f, "revision-op");
    let empty = f.source();
    let prepared = plan(&f, req.clone(), &empty).await.unwrap();
    let live = matching(&f);
    assert!(matches!(prepared.commit(f.store()), Err(UploadError::Busy)));
    assert!(matches!(
        f.store().get("revision-op", &req.destination.scope),
        Err(UploadError::NotFound)
    ));
    assert!(matches!(
        plan(&f, req, &live)
            .await
            .unwrap()
            .commit(f.store())
            .unwrap(),
        UploadAdmission::Reused(_)
    ));
}

#[tokio::test]
async fn ledger_update_delete_and_scope_move_advance_counters_without_cross_topic_blocking() {
    let f = Fixture::new();
    let source = f.source();
    let prepared = plan(&f, request(&f, "unrelated-op"), &source)
        .await
        .unwrap();
    let mut other = f.query.destination.clone();
    other.topic_id = Some(18);
    f.row(
        &other,
        41,
        Some("901"),
        &f.query.source.sha256,
        "fixture.txt",
        f.query.source.size,
    );
    assert!(matches!(
        prepared.commit(f.store()).unwrap(),
        UploadAdmission::Queued(_)
    ));
    let prior = f.store().duplicate_revision(&other).unwrap();
    f.store()
        .inspect_ledger(|conn| {
            conn.execute("UPDATE upload_ledger SET topic_id=17", [])
                .unwrap();
            Ok(())
        })
        .unwrap();
    assert!(f.store().duplicate_revision(&other).unwrap() > prior);
    assert_eq!(
        f.store().duplicate_revision(&f.query.destination).unwrap(),
        1
    );
    let prepared = plan(&f, request(&f, "deleted-op"), &source).await.unwrap(); // exact cloud document is absent
    f.store()
        .inspect_ledger(|conn| {
            conn.execute("DELETE FROM upload_ledger", []).unwrap();
            Ok(())
        })
        .unwrap();
    assert_eq!(
        f.store().duplicate_revision(&f.query.destination).unwrap(),
        2
    );
    assert!(matches!(prepared.commit(f.store()), Err(UploadError::Busy)));
}
#[tokio::test]
async fn reuse_schema_is_repeatable_immutable_and_exclusive_with_preserved_existing_rows() {
    let f = Fixture::new();
    let source = matching(&f);
    let req = request(&f, "reuse-op");
    plan(&f, req, &source)
        .await
        .unwrap()
        .commit(f.store())
        .unwrap();
    f.store()
        .inspect_ledger(|conn| {
            let schema = include_str!(
                "../../../../../database/migrations/030_native_cloud_upload_reuses.sql"
            );
            conn.execute_batch(schema).unwrap();
            conn.execute_batch(schema).unwrap();
            assert!(conn
                .execute(
                    "UPDATE native_cloud_upload_reuses SET document_json='{}'",
                    []
                )
                .is_err());
            assert!(conn
                .execute(
                    "UPDATE native_cloud_upload_reuses SET account_id='tg_88'",
                    []
                )
                .is_err());
            assert_eq!(
                conn.query_row("SELECT COUNT(*) FROM upload_ledger", [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                1
            );
            let master = rusqlite::Connection::open_in_memory().unwrap();
            master
                .execute_batch(include_str!("../../../../../database/schema.sql"))
                .unwrap();
            let columns = |db: &rusqlite::Connection| {
                db.prepare("PRAGMA table_info(native_cloud_upload_reuses)")
                    .unwrap()
                    .query_map([], |r| {
                        Ok((
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, i64>(3)?,
                        ))
                    })
                    .unwrap()
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap()
            };
            assert_eq!(columns(conn), columns(&master));
            for trigger in [
                "native_cloud_upload_reuse_immutable",
                "native_cloud_upload_reuse_exclusive",
                "native_cloud_upload_execution_exclusive",
                "native_upload_duplicate_insert",
                "native_upload_duplicate_update",
                "native_upload_duplicate_delete",
            ] {
                for db in [conn, &master] {
                    assert_eq!(
                        db.query_row(
                            "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name=?1",
                            [trigger],
                            |r| r.get::<_, i64>(0)
                        )
                        .unwrap(),
                        1
                    );
                }
            }
            Ok(())
        })
        .unwrap();
}
