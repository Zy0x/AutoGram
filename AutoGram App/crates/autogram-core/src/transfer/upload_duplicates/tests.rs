use super::*;
use crate::transfer::{
    cloud_download::{
        AccountScope, CloudDownloadIdentity, DownloadRecord, DownloadRequest, DownloadState,
        PeerKind,
    },
    cloud_upload::{snapshot_upload_file, UploadDestination, UploadError, UploadStore},
};
use async_trait::async_trait;
use parking_lot::Mutex;
use rusqlite::params;
use std::{collections::HashMap, path::PathBuf};
use tokio_util::sync::CancellationToken;

struct Fixture {
    root: PathBuf,
    store: Option<UploadStore>,
    query: DuplicateQuery,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "autogram-duplicate-fixture-{}",
            rand::random::<u64>()
        ));
        std::fs::create_dir(&root).unwrap();
        let root = std::fs::canonicalize(root).unwrap();
        let path = root.join("owned.staged");
        std::fs::write(&path, b"fixture content").unwrap();
        let store = UploadStore::open(&root.join("fixture.db")).unwrap();
        Self {
            root,
            store: Some(store),
            query: DuplicateQuery {
                destination: UploadDestination {
                    scope: AccountScope::new("tg_77".into(), 77).unwrap(),
                    peer_kind: PeerKind::Channel,
                    peer_id: 321,
                    topic_id: Some(17),
                },
                source: snapshot_upload_file(&path).unwrap(),
                filename: "fixture.txt".into(),
                origin: None,
            },
        }
    }
    fn store(&self) -> &UploadStore {
        self.store.as_ref().unwrap()
    }
    fn row(
        &self,
        destination: &UploadDestination,
        msg: i32,
        doc: Option<&str>,
        sha: &str,
        name: &str,
        size: u64,
    ) {
        self.store().inspect_ledger(|conn| {
            conn.execute("INSERT INTO upload_ledger(account_id,destination_id,topic_id,telegram_message_id,
                telegram_unique_id,prepared_sha256,filename,file_size,payload_class,created_at,updated_at)
                VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'original_document',0,0)",params![destination.scope.account_id(),
                destination.dialog_id(),destination.topic_id.unwrap_or(0),msg,doc,sha,name,size as i64]).unwrap();
            Ok(())
        }).unwrap();
    }
    fn origin_record(&self, peer: i64, topic: Option<i32>, msg: i32, doc: i64) -> DownloadRecord {
        let identity = CloudDownloadIdentity::new(
            self.query.destination.scope.clone(),
            PeerKind::Channel,
            peer,
            topic,
            msg,
            doc,
            "original".into(),
            "fixture-stable-fingerprint".into(),
            self.query.source.size,
        )
        .unwrap();
        DownloadRecord {
            request: DownloadRequest::new(
                "download-fixture".into(),
                identity,
                self.query.source.size,
                None,
                self.root.join("download.part"),
                self.root.join("download.output"),
            )
            .unwrap(),
            state: DownloadState::Completed,
            checkpoint_bytes: self.query.source.size,
            checkpoint_sha256: self.query.source.sha256.clone(),
            actual_sha256: Some(self.query.source.sha256.clone()),
            attempts: 1,
            error_code: None,
            retry_after_ms: None,
            created_ms: 0,
            updated_ms: 0,
            file_identity: None,
        }
    }
    fn origin(&self, peer: i64, topic: Option<i32>, msg: i32, doc: i64) -> VerifiedUploadOrigin {
        VerifiedUploadOrigin::from_download(
            &self.origin_record(peer, topic, msg, doc),
            &self.query.source,
        )
        .unwrap()
    }
    fn source(&self) -> FakeSource {
        FakeSource {
            scope: self.query.destination.scope.clone(),
            documents: HashMap::new(),
            calls: Mutex::new(Vec::new()),
            failure: None,
        }
    }
    fn document(&self, msg: i32, doc: i64, name: &str) -> ExistingCloudDocument {
        ExistingCloudDocument {
            destination: self.query.destination.clone(),
            message_id: msg,
            document_id: doc,
            size: self.query.source.size,
            filename: name.into(),
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        drop(self.store.take());
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}
struct FakeSource {
    scope: AccountScope,
    documents: HashMap<i32, ExistingCloudDocument>,
    calls: Mutex<Vec<i32>>,
    failure: Option<UploadError>,
}
#[async_trait]
impl DuplicateDocumentSource for FakeSource {
    fn scope(&self) -> &AccountScope {
        &self.scope
    }
    async fn read_document(
        &self,
        _: &UploadDestination,
        id: i32,
    ) -> Result<Option<ExistingCloudDocument>, UploadError> {
        self.calls.lock().push(id);
        if let Some(error) = &self.failure {
            return Err(error.clone());
        }
        Ok(self.documents.get(&id).cloned())
    }
}
async fn inspect(f: &Fixture, source: &FakeSource) -> Result<DuplicateInspection, UploadError> {
    inspect_duplicates(f.store(), &f.query, source, &CancellationToken::new()).await
}

#[tokio::test]
async fn four_levels_require_live_documents_and_keep_filename_size_weak() {
    let mut f = Fixture::new();
    f.query.origin = Some(f.origin(321, Some(17), 41, 901));
    // Same document at another message, equal binary at another document, weak name/size.
    f.row(
        &f.query.destination,
        42,
        Some("901"),
        &"1".repeat(64),
        "renamed.txt",
        f.query.source.size,
    );
    f.row(
        &f.query.destination,
        43,
        Some("903"),
        &f.query.source.sha256,
        "cloud-name.txt",
        f.query.source.size,
    );
    f.row(
        &f.query.destination,
        44,
        Some("904"),
        &"2".repeat(64),
        "FIXTURE.TXT",
        f.query.source.size,
    );
    let mut source = f.source();
    for (msg, doc, name) in [
        (41, 901, "original-name.txt"),
        (42, 901, "renamed.txt"),
        (43, 903, "cloud-name.txt"),
        (44, 904, "FIXTURE.TXT"),
    ] {
        source.documents.insert(msg, f.document(msg, doc, name));
    }
    let result = inspect(&f, &source).await.unwrap();
    assert_eq!(
        result
            .matches
            .iter()
            .map(|item| item.level)
            .collect::<Vec<_>>(),
        [
            DuplicateLevel::MessageId,
            DuplicateLevel::DocumentId,
            DuplicateLevel::Sha256,
            DuplicateLevel::FilenameSize
        ]
    );
    assert_eq!(
        result
            .matches
            .iter()
            .map(|item| item.level.exact_content())
            .collect::<Vec<_>>(),
        [true, true, true, false]
    );
    assert_eq!(*source.calls.lock(), [41, 42, 43, 44]);
    assert!(!result.truncated);
    assert_eq!(result.stale_candidates, 0);
}

#[tokio::test]
async fn message_numbers_from_other_locations_never_match_and_ledgers_are_scoped() {
    let mut f = Fixture::new();
    f.query.origin = Some(f.origin(999, Some(18), 41, 901));
    f.row(
        &f.query.destination,
        41,
        Some("902"),
        &"3".repeat(64),
        "other.txt",
        f.query.source.size,
    );
    for mutation in 0..3 {
        let mut other = f.query.destination.clone();
        match mutation {
            0 => other.topic_id = Some(18),
            1 => other.peer_id = 322,
            _ => other.scope = AccountScope::new("tg_88".into(), 88).unwrap(),
        }
        f.row(
            &other,
            42,
            Some("901"),
            &f.query.source.sha256,
            "fixture.txt",
            f.query.source.size,
        );
    }
    let source = f.source();
    assert!(inspect(&f, &source).await.unwrap().matches.is_empty());
    assert!(source.calls.lock().is_empty());
    // Same doc ID in destination is L2, never L1 from the unrelated message number.
    f.row(
        &f.query.destination,
        51,
        Some("901"),
        &"4".repeat(64),
        "another.txt",
        f.query.source.size,
    );
    let mut source = f.source();
    source
        .documents
        .insert(51, f.document(51, 901, "another.txt"));
    assert_eq!(
        inspect(&f, &source).await.unwrap().matches[0].level,
        DuplicateLevel::DocumentId
    );
}

#[tokio::test]
async fn edited_deleted_or_renamed_cloud_records_cannot_confirm_stale_hashes() {
    let f = Fixture::new();
    for (id, sha) in [
        (41, f.query.source.sha256.clone()),
        (42, "1".repeat(64)),
        (43, "2".repeat(64)),
    ] {
        f.row(
            &f.query.destination,
            id,
            Some("901"),
            &sha,
            "fixture.txt",
            f.query.source.size,
        );
    }
    let mut source = f.source();
    source
        .documents
        .insert(41, f.document(41, 999, "fixture.txt")); // edited document
    source
        .documents
        .insert(42, f.document(42, 901, "renamed.txt")); // stale metadata
    let result = inspect(&f, &source).await.unwrap();
    assert!(result.matches.is_empty());
    assert_eq!(result.stale_candidates, 3);
    // Read-only inspection retains ledger evidence; it never deletes personal metadata.
    f.store()
        .inspect_ledger(|conn| {
            assert_eq!(
                conn.query_row("SELECT COUNT(*) FROM upload_ledger", [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                3
            );
            Ok(())
        })
        .unwrap();
}

#[tokio::test]
async fn canonical_unicode_filename_fallback_requires_exact_size_and_never_equal_content() {
    let mut f = Fixture::new();
    f.query.filename = "résumé.txt".into();
    f.row(
        &f.query.destination,
        41,
        Some("901"),
        &"1".repeat(64),
        "RÉSUMÉ.TXT",
        f.query.source.size,
    );
    f.row(
        &f.query.destination,
        42,
        Some("902"),
        &"2".repeat(64),
        "résumé.txt",
        f.query.source.size + 1,
    );
    let mut source = f.source();
    source
        .documents
        .insert(41, f.document(41, 901, "RÉSUMÉ.TXT"));
    let result = inspect(&f, &source).await.unwrap();
    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.matches[0].level, DuplicateLevel::FilenameSize);
    assert!(!result.matches[0].level.exact_content());
    assert_eq!(*source.calls.lock(), [41]);
}

#[tokio::test]
async fn offline_floodwait_and_wrong_scope_are_errors_not_empty_success() {
    let f = Fixture::new();
    f.row(
        &f.query.destination,
        41,
        Some("901"),
        &f.query.source.sha256,
        "fixture.txt",
        f.query.source.size,
    );
    for error in [
        UploadError::Network,
        UploadError::FloodWait {
            retry_after_ms: 90000,
        },
        UploadError::Unauthorized,
    ] {
        let mut source = f.source();
        source.failure = Some(error.clone());
        assert_eq!(inspect(&f, &source).await.unwrap_err(), error);
    }
    let mut wrong = f.source();
    wrong.scope = AccountScope::new("tg_88".into(), 88).unwrap();
    assert_eq!(
        inspect(&f, &wrong).await.unwrap_err(),
        UploadError::WrongScope
    );
    assert!(wrong.calls.lock().is_empty());
    for mutation in 0..2 {
        let mut source = f.source();
        let mut doc = f.document(41, 901, "fixture.txt");
        if mutation == 0 {
            doc.destination.topic_id = Some(18);
        } else {
            doc.message_id = 42;
        }
        source.documents.insert(41, doc);
        assert_eq!(
            inspect(&f, &source).await.unwrap_err(),
            UploadError::ReceiptMismatch
        );
    }
}

#[test]
fn provenance_requires_completed_original_document_digest_and_same_account() {
    let mut f = Fixture::new();
    let record = f.origin_record(321, Some(17), 41, 901);
    for mutation in 0..4 {
        let mut invalid = record.clone();
        match mutation {
            0 => invalid.state = DownloadState::Running,
            1 => invalid.actual_sha256 = Some("0".repeat(64)),
            2 => invalid.checkpoint_bytes -= 1,
            _ => invalid.actual_sha256 = None,
        }
        assert!(matches!(
            VerifiedUploadOrigin::from_download(&invalid, &f.query.source),
            Err(UploadError::SourceChanged)
        ));
    }
    f.query.origin = Some(VerifiedUploadOrigin::from_download(&record, &f.query.source).unwrap());
    f.query.destination.scope = AccountScope::new("tg_88".into(), 88).unwrap();
    assert_eq!(f.query.validate().unwrap_err(), UploadError::WrongScope);
    f.query.origin = None;
    f.query.destination.scope = AccountScope::new("tg_77".into(), 88).unwrap();
    assert_eq!(f.query.validate().unwrap_err(), UploadError::WrongScope);
}

#[tokio::test]
async fn invalid_legacy_identifiers_and_bounded_queries_report_incomplete_evidence() {
    let f = Fixture::new();
    f.row(
        &f.query.destination,
        41,
        Some("doc_uid:unverified"),
        &f.query.source.sha256,
        "fixture.txt",
        f.query.source.size,
    );
    f.row(
        &f.query.destination,
        0,
        Some("901"),
        &"1".repeat(64),
        "fixture.txt",
        f.query.source.size,
    );
    let result = inspect(&f, &f.source()).await.unwrap();
    assert!(result.matches.is_empty());
    assert_eq!(result.unverified_ledger_rows, 2);
    for index in 2..=MAX_DUPLICATE_CANDIDATES {
        f.row(
            &f.query.destination,
            index as i32 + 100,
            Some("901"),
            &format!("{index:064x}"),
            "unrelated.txt",
            f.query.source.size,
        );
    }
    let result = inspect(&f, &f.source()).await.unwrap();
    assert!(result.truncated);
    assert!(result.matches.is_empty());
}

#[tokio::test]
async fn cancellation_interrupts_reads_without_partial_inspection_or_new_transfer_rows() {
    let f = Fixture::new();
    f.row(
        &f.query.destination,
        41,
        Some("901"),
        &f.query.source.sha256,
        "fixture.txt",
        f.query.source.size,
    );
    struct Pending {
        scope: AccountScope,
        started: tokio::sync::Notify,
    }
    #[async_trait]
    impl DuplicateDocumentSource for Pending {
        fn scope(&self) -> &AccountScope {
            &self.scope
        }
        async fn read_document(
            &self,
            _: &UploadDestination,
            _: i32,
        ) -> Result<Option<ExistingCloudDocument>, UploadError> {
            self.started.notify_one();
            std::future::pending().await
        }
    }
    let source = Pending {
        scope: f.query.destination.scope.clone(),
        started: tokio::sync::Notify::new(),
    };
    let cancel = CancellationToken::new();
    let (result, _) = tokio::join!(
        inspect_duplicates(f.store(), &f.query, &source, &cancel),
        async {
            source.started.notified().await;
            cancel.cancel();
        }
    );
    assert_eq!(result.unwrap_err(), UploadError::Cancelled);
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
}
