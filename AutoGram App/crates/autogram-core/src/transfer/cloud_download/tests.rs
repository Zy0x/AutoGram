use super::*;
use super::{
    files::{digest, OwnedFile},
    store::SCHEMA,
};
use crate::transfer::download::{sha256_bytes, sha256_file, DOWNLOAD_CHUNK_SIZE};
use async_trait::async_trait;
use parking_lot::Mutex;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::sync::Notify;

#[tokio::test]
async fn recovered_preflight_failure_is_durable_and_cannot_steal_a_live_worker() {
    let f = Fixture::new(8);
    let lock = OwnedFile::open(&f.record()).unwrap();
    f.store.attach_file(f.request.operation_id(), &lock.identity).unwrap();
    f.store.claim(f.request.operation_id(), false).unwrap();
    assert!(matches!(f.executor().fail_source_preflight(f.request.operation_id(),
        f.request.source().scope(), SourceFailure::Unauthorized).await, Err(DownloadError::Busy)));
    assert_eq!(f.record().state, DownloadState::Running);
    drop(lock);
    f.executor().fail_source_preflight(f.request.operation_id(),
        f.request.source().scope(), SourceFailure::Unauthorized).await.unwrap();
    assert_eq!(f.record().state, DownloadState::Failed);
    assert_eq!(f.record().error_code.as_deref(), Some("source_unauthorized"));
    assert!(!f.store.has_recoverable_jobs().unwrap());
}

#[tokio::test]
async fn publishing_preflight_floodwait_retains_scheduler_work_without_dispatching_early() {
    let f = Fixture::new(8);
    let lock = OwnedFile::open(&f.record()).unwrap();
    f.store.attach_file(f.request.operation_id(), &lock.identity).unwrap();
    f.store.claim(f.request.operation_id(), false).unwrap();
    f.store.checkpoint(f.request.operation_id(), 8, &sha256_bytes(&f.data)).unwrap();
    assert!(f.store.publishing(f.request.operation_id(), &sha256_bytes(&f.data)).unwrap());
    drop(lock);
    f.executor().fail_source_preflight(f.request.operation_id(), f.request.source().scope(),
        SourceFailure::FloodWait { retry_after_ms: 60_000 }).await.unwrap();
    assert_eq!(f.record().state, DownloadState::Publishing);
    assert!(f.store.pending(100).unwrap().is_empty());
    assert!(f.store.has_recoverable_jobs().unwrap());
    assert_eq!(f.record().error_code.as_deref(), Some("source_flood_wait"));
}

struct Fixture {
    root: PathBuf,
    db: PathBuf,
    store: DownloadStore,
    request: DownloadRequest,
    data: Vec<u8>,
}
impl Fixture {
    fn new(size: usize) -> Self {
        // UUID-v4-owned names exist only in cfg(test). No real account, file or network access.
        let mut uuid: [u8; 16] = rand::random();
        uuid[6] = (uuid[6] & 15) | 64;
        uuid[8] = (uuid[8] & 63) | 128;
        let h = hex::encode(uuid);
        let id = format!(
            "{}-{}-{}-{}-{}",
            &h[..8],
            &h[8..12],
            &h[12..16],
            &h[16..20],
            &h[20..]
        );
        let root = std::env::temp_dir().join(format!("autogram-cloud-download-{id}"));
        fs::create_dir(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let db = root.join("queue.sqlite");
        let store = DownloadStore::open(&db).unwrap();
        let data: Vec<u8> = (0..size).map(|i| (i % 251) as u8).collect();
        let scope = AccountScope::new("test-account".into(), 123).unwrap();
        let source = CloudDownloadIdentity::new(
            scope,
            PeerKind::Channel,
            42,
            Some(7),
            11,
            999,
            "document-original".into(),
            "document-999-content-v1".into(),
            size as u64,
        )
        .unwrap();
        let request = DownloadRequest::new(
            id,
            source,
            size as u64,
            Some(sha256_bytes(&data)),
            root.join("selected.part"),
            root.join("selected.bin"),
        )
        .unwrap();
        store.enqueue(request.clone()).unwrap();
        Self {
            root,
            db,
            store,
            request,
            data,
        }
    }
    fn source(&self) -> MemorySource {
        MemorySource::new(self.request.source().clone(), self.data.clone())
    }
    fn executor(&self) -> DownloadExecutor {
        DownloadExecutor::new(self.store.clone())
    }
    fn record(&self) -> DownloadRecord {
        self.store
            .get(self.request.operation_id(), self.request.source().scope())
            .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // Exact UUID-owned fixture only. Windows may keep SQLite handles open until fields drop.
        // Close this fixture's own connection before deleting its directory.
        self.store.close_fixture();
        // No recursive removal outside the canonical test-owned root.
        assert!(self
            .root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("autogram-cloud-download-"));
        assert_eq!(
            self.root.parent().unwrap(),
            fs::canonicalize(std::env::temp_dir()).unwrap()
        );
        fs::remove_dir_all(&self.root).unwrap();
    }
}

#[derive(Clone)]
struct MemorySource {
    identity: CloudDownloadIdentity,
    data: Arc<Vec<u8>>,
    calls: Arc<AtomicUsize>,
    changed: bool,
    change_after: Option<usize>,
    wrong_offset: bool,
    wrong_size: bool,
    exit_after_checkpoint: bool,
    short: bool,
    failure: Option<SourceFailure>,
    control: Option<(DownloadStore, String, bool)>,
    pending: Option<Arc<Notify>>,
    offsets: Arc<Mutex<Vec<u64>>>,
}
impl MemorySource {
    fn new(identity: CloudDownloadIdentity, data: Vec<u8>) -> Self {
        Self {
            identity,
            data: Arc::new(data),
            calls: Arc::new(AtomicUsize::new(0)),
            changed: false,
            change_after: None,
            wrong_offset: false,
            wrong_size: false,
            exit_after_checkpoint: false,
            short: false,
            failure: None,
            control: None,
            pending: None,
            offsets: Arc::new(Mutex::new(vec![])),
        }
    }
    fn object(&self) -> RemoteObject {
        let mut identity = self.identity.clone();
        if self.changed
            || self
                .change_after
                .is_some_and(|n| self.calls.load(Ordering::SeqCst) >= n)
        {
            identity = CloudDownloadIdentity::new(
                identity.scope().clone(),
                identity.peer_kind(),
                identity.peer_id(),
                identity.topic_id(),
                identity.message_id(),
                identity.media_id(),
                identity.rendition().into(),
                "changed-content".into(),
                identity.expected_size(),
            )
            .unwrap();
        }
        RemoteObject {
            identity,
            size: self.data.len() as u64 + u64::from(self.wrong_size),
        }
    }
}
#[async_trait]
impl CloudByteRangeSource for MemorySource {
    fn scope(&self) -> &AccountScope {
        self.identity.scope()
    }
    async fn describe(&self, _: &CloudDownloadIdentity) -> Result<RemoteObject, SourceFailure> {
        Ok(self.object())
    }
    async fn read_range(
        &self,
        _: &CloudDownloadIdentity,
        offset: u64,
        length: usize,
    ) -> Result<RangeChunk, SourceFailure> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.offsets.lock().push(offset);
        if let Some(error) = self.failure {
            return Err(error);
        }
        if offset > 0 {
            if self.exit_after_checkpoint {
                // Real test worker death, with no destructors, OS lock release or cleanup by Rust.
                std::process::exit(0);
            }
            if let Some((store, id, cancel)) = &self.control {
                if *cancel {
                    store.cancel(id, self.scope()).unwrap();
                } else {
                    store.pause(id, self.scope()).unwrap();
                }
            }
            if let Some(notify) = &self.pending {
                notify.notify_one();
                std::future::pending::<()>().await;
            }
        }
        let length = if self.short {
            length.saturating_sub(1)
        } else {
            length
        };
        Ok(RangeChunk {
            object: self.object(),
            offset: offset + u64::from(self.wrong_offset),
            bytes: self.data[offset as usize..offset as usize + length].to_vec(),
        })
    }
}

#[tokio::test]
async fn changed_media_between_chunks_does_not_append_the_changed_chunk() {
    let f = Fixture::new(DOWNLOAD_CHUNK_SIZE as usize + 40);
    let mut source = f.source();
    source.change_after = Some(2);
    assert!(matches!(
        f.executor()
            .run(f.request.operation_id(), source.scope(), &source)
            .await,
        Err(DownloadError::IdentityChanged)
    ));
    assert_eq!(f.record().checkpoint_bytes, DOWNLOAD_CHUNK_SIZE);
    assert_eq!(
        fs::read(f.request.temp_path()).unwrap(),
        &f.data[..DOWNLOAD_CHUNK_SIZE as usize]
    );
    assert!(!f.request.output_path().exists());
}

#[tokio::test]
async fn wrong_range_offset_and_remote_size_are_rejected() {
    for wrong_size in [false, true] {
        let f = Fixture::new(40);
        let mut source = f.source();
        source.wrong_size = wrong_size;
        source.wrong_offset = !wrong_size;
        assert!(matches!(
            f.executor()
                .run(f.request.operation_id(), source.scope(), &source)
                .await,
            Err(DownloadError::IdentityChanged)
        ));
        assert_eq!(f.record().checkpoint_bytes, 0);
        assert_eq!(fs::metadata(f.request.temp_path()).unwrap().len(), 0);
        assert!(!f.request.output_path().exists());
    }
}

#[tokio::test]
async fn extra_hard_link_blocks_append_to_protect_other_names() {
    let f = Fixture::new(DOWNLOAD_CHUNK_SIZE as usize + 40);
    interrupted(&f).await;
    let alias = f.root.join("unrelated-name.bin");
    fs::hard_link(f.request.temp_path(), &alias).unwrap();
    let original = fs::read(&alias).unwrap();
    let source = f.source();
    assert!(matches!(
        f.executor()
            .recover(f.request.operation_id(), source.scope(), &source)
            .await,
        Err(DownloadError::Ownership)
    ));
    assert_eq!(fs::read(alias).unwrap(), original);
    assert_eq!(
        fs::metadata(f.request.temp_path()).unwrap().len(),
        DOWNLOAD_CHUNK_SIZE
    );
}

/// Invoked by the subprocess test only, using its UUID-owned root and immutable row.
#[tokio::test]
#[ignore = "test subprocess entry point"]
async fn process_death_child() {
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(10));
        std::process::exit(99);
    });
    let root = fs::canonicalize(std::env::var_os("AUTOGRAM_DOWNLOAD_TEST_ROOT").unwrap()).unwrap();
    let id = std::env::var("AUTOGRAM_DOWNLOAD_TEST_ID").unwrap();
    assert_eq!(
        root.file_name().unwrap().to_string_lossy(),
        format!("autogram-cloud-download-{id}")
    );
    assert_eq!(
        root.parent().unwrap(),
        fs::canonicalize(std::env::temp_dir()).unwrap()
    );
    let store = DownloadStore::open(&root.join("queue.sqlite")).unwrap();
    let scope = AccountScope::new("test-account".into(), 123).unwrap();
    let record = store.get(&id, &scope).unwrap();
    assert_eq!(record.request.temp_path().parent().unwrap(), root);
    assert_eq!(record.request.output_path().parent().unwrap(), root);
    assert_eq!(record.request.expected_size(), DOWNLOAD_CHUNK_SIZE + 40);
    let data = (0..record.request.expected_size() as usize)
        .map(|i| (i % 251) as u8)
        .collect();
    let mut source = MemorySource::new(record.request.source().clone(), data);
    source.exit_after_checkpoint = true;
    DownloadExecutor::new(store)
        .run(&id, &scope, &source)
        .await
        .unwrap();
    panic!("child must exit at the next read after its first durable checkpoint");
}

#[tokio::test]
async fn actual_process_exit_releases_lock_and_preserves_sqlite_checkpoint() {
    let f = Fixture::new(DOWNLOAD_CHUNK_SIZE as usize + 40);
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "transfer::cloud_download::tests::process_death_child",
            "--ignored",
        ])
        .env("AUTOGRAM_DOWNLOAD_TEST_ROOT", &f.root)
        .env("AUTOGRAM_DOWNLOAD_TEST_ID", f.request.operation_id())
        .stdout(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let started = std::time::Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        assert!(
            started.elapsed() < Duration::from_secs(15),
            "test worker exceeded exit deadline"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    };
    assert!(status.success());
    assert_eq!(f.record().state, DownloadState::Running);
    assert_eq!(f.record().checkpoint_bytes, DOWNLOAD_CHUNK_SIZE);
    let source = f.source();
    let store = DownloadStore::open(&f.db).unwrap();
    let result = DownloadExecutor::new(store)
        .recover(f.request.operation_id(), source.scope(), &source)
        .await
        .unwrap();
    assert_eq!(result.state, DownloadState::Completed);
    assert_eq!(
        sha256_file(f.request.output_path()).unwrap(),
        sha256_bytes(&f.data)
    );
    assert_eq!(source.offsets.lock().as_slice(), &[DOWNLOAD_CHUNK_SIZE]);
}

#[tokio::test]
async fn writes_exact_bytes_and_sha256_then_completes() {
    let f = Fixture::new(DOWNLOAD_CHUNK_SIZE as usize * 2 + 17);
    let source = f.source();
    let result = f
        .executor()
        .run(f.request.operation_id(), source.scope(), &source)
        .await
        .unwrap();
    assert_eq!(result.state, DownloadState::Completed);
    assert_eq!(result.checkpoint_bytes, f.data.len() as u64);
    assert_eq!(
        result.actual_sha256.as_deref(),
        Some(sha256_bytes(&f.data).as_str())
    );
    assert_eq!(fs::read(f.request.output_path()).unwrap(), f.data);
    assert_eq!(
        sha256_file(f.request.output_path()).unwrap(),
        sha256_bytes(&f.data)
    );
    assert_eq!(
        source.offsets.lock().as_slice(),
        &[0, DOWNLOAD_CHUNK_SIZE, DOWNLOAD_CHUNK_SIZE * 2]
    );
    assert!(matches!(
        f.store.retry(f.request.operation_id(), source.scope()),
        Err(DownloadError::InvalidState)
    ));
}

#[tokio::test]
async fn empty_file_is_verified_and_published_without_a_range_read() {
    let f = Fixture::new(0);
    let source = f.source();
    let record = f
        .executor()
        .run(f.request.operation_id(), source.scope(), &source)
        .await
        .unwrap();
    assert_eq!(record.actual_sha256, Some(sha256_bytes(b"")));
    assert_eq!(source.calls.load(Ordering::SeqCst), 0);
    assert_eq!(fs::metadata(f.request.output_path()).unwrap().len(), 0);
}

#[tokio::test]
async fn wrong_scope_and_changed_identity_never_append() {
    let f = Fixture::new(30);
    let wrong = AccountScope::new("other-account".into(), 456).unwrap();
    assert!(matches!(
        f.store.get(f.request.operation_id(), &wrong),
        Err(DownloadError::WrongScope)
    ));
    assert!(matches!(
        f.store.cancel(f.request.operation_id(), &wrong),
        Err(DownloadError::WrongScope)
    ));
    let mut source = f.source();
    source.identity = CloudDownloadIdentity::new(
        wrong,
        PeerKind::Channel,
        42,
        Some(7),
        11,
        999,
        "document-original".into(),
        "document-999-content-v1".into(),
        30,
    )
    .unwrap();
    assert!(matches!(
        f.executor()
            .run(
                f.request.operation_id(),
                f.request.source().scope(),
                &source
            )
            .await,
        Err(DownloadError::WrongScope)
    ));
    assert!(!f.request.temp_path().exists());
    let mut source = f.source();
    source.changed = true;
    assert!(matches!(
        f.executor()
            .run(f.request.operation_id(), source.scope(), &source)
            .await,
        Err(DownloadError::IdentityChanged)
    ));
    assert_eq!(f.record().checkpoint_bytes, 0);
    assert_eq!(fs::metadata(f.request.temp_path()).unwrap().len(), 0);
    assert!(!f.request.output_path().exists());
    assert_eq!(f.record().error_code.as_deref(), Some("identity_changed"));
}

#[tokio::test]
async fn short_read_is_failed_without_checkpoint_or_publication_and_can_retry() {
    let f = Fixture::new(50);
    let mut bad = f.source();
    bad.short = true;
    assert!(matches!(
        f.executor()
            .run(f.request.operation_id(), bad.scope(), &bad)
            .await,
        Err(DownloadError::ShortRead {
            expected: 50,
            actual: 49
        })
    ));
    assert_eq!(f.record().state, DownloadState::Failed);
    assert_eq!(f.record().checkpoint_bytes, 0);
    assert!(!f.request.output_path().exists());
    let source = f.source();
    f.store
        .retry(f.request.operation_id(), source.scope())
        .unwrap();
    f.executor()
        .run(f.request.operation_id(), source.scope(), &source)
        .await
        .unwrap();
    assert_eq!(
        sha256_file(f.request.output_path()).unwrap(),
        sha256_bytes(&f.data)
    );
    assert_eq!(f.record().attempts, 2);
}

#[tokio::test]
async fn pause_and_cancel_preserve_only_flushed_checkpoints() {
    for cancel in [false, true] {
        let f = Fixture::new(DOWNLOAD_CHUNK_SIZE as usize + 25);
        let mut source = f.source();
        source.control = Some((f.store.clone(), f.request.operation_id().into(), cancel));
        let result = f
            .executor()
            .run(f.request.operation_id(), source.scope(), &source)
            .await
            .unwrap();
        assert_eq!(
            result.state,
            if cancel {
                DownloadState::Cancelled
            } else {
                DownloadState::Paused
            }
        );
        assert_eq!(result.checkpoint_bytes, DOWNLOAD_CHUNK_SIZE);
        assert_eq!(
            sha256_file(f.request.temp_path()).unwrap(),
            sha256_bytes(&f.data[..DOWNLOAD_CHUNK_SIZE as usize])
        );
        assert!(!f.request.output_path().exists());
        if cancel {
            assert!(matches!(
                f.store.retry(f.request.operation_id(), source.scope()),
                Err(DownloadError::InvalidState)
            ));
        } else {
            f.store
                .retry(f.request.operation_id(), source.scope())
                .unwrap();
            let source = f.source();
            f.executor()
                .run(f.request.operation_id(), source.scope(), &source)
                .await
                .unwrap();
            assert_eq!(source.offsets.lock().as_slice(), &[DOWNLOAD_CHUNK_SIZE]);
        }
    }
}

async fn interrupted(f: &Fixture) -> MemorySource {
    let mut source = f.source();
    let reached = Arc::new(Notify::new());
    source.pending = Some(reached.clone());
    let executor = f.executor();
    let id = f.request.operation_id().to_owned();
    let worker_source = source.clone();
    let task = tokio::spawn(async move {
        executor
            .run(&id, worker_source.scope(), &worker_source)
            .await
    });
    tokio::time::timeout(Duration::from_secs(3), reached.notified())
        .await
        .unwrap();
    assert_eq!(f.record().checkpoint_bytes, DOWNLOAD_CHUNK_SIZE);
    let record = f.record();
    assert!(matches!(OwnedFile::open(&record), Err(DownloadError::Busy)));
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    source
}

#[tokio::test]
async fn process_recovery_reopens_sqlite_and_discards_only_owned_uncommitted_tail() {
    let f = Fixture::new(DOWNLOAD_CHUNK_SIZE as usize + 40);
    interrupted(&f).await;
    fs::OpenOptions::new()
        .append(true)
        .open(f.request.temp_path())
        .unwrap()
        .write_all(b"uncommitted")
        .unwrap();
    let reopened = DownloadStore::open(&f.db).unwrap();
    let source = f.source();
    let result = DownloadExecutor::new(reopened)
        .recover(f.request.operation_id(), source.scope(), &source)
        .await
        .unwrap();
    assert_eq!(result.state, DownloadState::Completed);
    assert_eq!(source.offsets.lock().as_slice(), &[DOWNLOAD_CHUNK_SIZE]);
    assert_eq!(fs::read(f.request.output_path()).unwrap(), f.data);
}

#[tokio::test]
async fn changed_identity_is_checked_before_recovery_truncates_a_tail() {
    let f = Fixture::new(DOWNLOAD_CHUNK_SIZE as usize + 40);
    interrupted(&f).await;
    fs::OpenOptions::new()
        .append(true)
        .open(f.request.temp_path())
        .unwrap()
        .write_all(b"uncommitted")
        .unwrap();
    let before = fs::read(f.request.temp_path()).unwrap();
    let mut source = f.source();
    source.changed = true;
    assert!(matches!(
        f.executor()
            .recover(f.request.operation_id(), source.scope(), &source)
            .await,
        Err(DownloadError::IdentityChanged)
    ));
    assert_eq!(fs::read(f.request.temp_path()).unwrap(), before);
    assert!(!f.request.output_path().exists());
}

#[tokio::test]
async fn corrupted_checkpoint_and_wrong_final_hash_do_not_complete() {
    let f = Fixture::new(DOWNLOAD_CHUNK_SIZE as usize + 40);
    interrupted(&f).await;
    let mut corrupt = fs::read(f.request.temp_path()).unwrap();
    corrupt[0] ^= 1;
    fs::write(f.request.temp_path(), &corrupt).unwrap();
    let source = f.source();
    assert!(matches!(
        f.executor()
            .recover(f.request.operation_id(), source.scope(), &source)
            .await,
        Err(DownloadError::Integrity)
    ));
    assert_eq!(source.calls.load(Ordering::SeqCst), 0);
    assert_eq!(fs::read(f.request.temp_path()).unwrap(), corrupt);
    assert!(!f.request.output_path().exists());

    let f = Fixture::new(30);
    let mut source = f.source();
    source.data = Arc::new(vec![3; 30]);
    assert!(matches!(
        f.executor()
            .run(f.request.operation_id(), source.scope(), &source)
            .await,
        Err(DownloadError::Integrity)
    ));
    assert_eq!(f.record().state, DownloadState::Failed);
    assert!(!f.request.output_path().exists());
    assert!(f.record().actual_sha256.is_none());
}

#[tokio::test]
async fn output_and_preexisting_temp_are_never_overwritten() {
    for temp in [false, true] {
        let f = Fixture::new(20);
        let protected = if temp {
            f.request.temp_path()
        } else {
            f.request.output_path()
        };
        fs::write(protected, b"unrelated-user-content").unwrap();
        let source = f.source();
        let result = f
            .executor()
            .run(f.request.operation_id(), source.scope(), &source)
            .await;
        assert!(matches!(
            result,
            Err(DownloadError::Ownership | DownloadError::DestinationExists)
        ));
        assert_eq!(fs::read(protected).unwrap(), b"unrelated-user-content");
        assert_eq!(source.calls.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn replaced_temp_with_identical_bytes_is_rejected_by_file_identity() {
    let f = Fixture::new(DOWNLOAD_CHUNK_SIZE as usize + 40);
    interrupted(&f).await;
    let original = f.root.join("original-owned.part");
    fs::rename(f.request.temp_path(), &original).unwrap();
    fs::copy(&original, f.request.temp_path()).unwrap();
    let source = f.source();
    assert!(matches!(
        f.executor()
            .recover(f.request.operation_id(), source.scope(), &source)
            .await,
        Err(DownloadError::Ownership)
    ));
    assert_eq!(
        fs::read(f.request.temp_path()).unwrap(),
        fs::read(original).unwrap()
    );
    assert!(!f.request.output_path().exists());
}

#[tokio::test]
async fn publish_crash_window_recovers_only_the_owned_output() {
    let f = Fixture::new(40);
    let record = f.record();
    let mut file = OwnedFile::open(&record).unwrap();
    f.store
        .attach_file(f.request.operation_id(), &file.identity)
        .unwrap();
    f.store.claim(f.request.operation_id(), false).unwrap();
    file.append(&f.data).unwrap();
    f.store
        .checkpoint(f.request.operation_id(), 40, &sha256_bytes(&f.data))
        .unwrap();
    assert!(f
        .store
        .publishing(f.request.operation_id(), &sha256_bytes(&f.data))
        .unwrap());
    file.publish(f.request.output_path(), false).unwrap();
    drop(file); // Dies after filesystem commit, before SQLite completed.
    let source = f.source();
    let result = f
        .executor()
        .recover(f.request.operation_id(), source.scope(), &source)
        .await
        .unwrap();
    assert_eq!(result.state, DownloadState::Completed);
    assert_eq!(source.calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        sha256_file(f.request.output_path()).unwrap(),
        sha256_bytes(&f.data)
    );
}

#[tokio::test]
async fn late_output_collision_is_preserved_and_publication_remains_recoverable() {
    let f = Fixture::new(40);
    let record = f.record();
    let mut file = OwnedFile::open(&record).unwrap();
    f.store
        .attach_file(f.request.operation_id(), &file.identity)
        .unwrap();
    f.store.claim(f.request.operation_id(), false).unwrap();
    file.append(&f.data).unwrap();
    f.store
        .checkpoint(f.request.operation_id(), 40, &sha256_bytes(&f.data))
        .unwrap();
    f.store
        .publishing(f.request.operation_id(), &sha256_bytes(&f.data))
        .unwrap();
    drop(file);
    fs::write(f.request.output_path(), b"unrelated-user-content").unwrap();
    let source = f.source();
    assert!(matches!(
        f.executor()
            .recover(f.request.operation_id(), source.scope(), &source)
            .await,
        Err(DownloadError::DestinationExists)
    ));
    assert_eq!(f.record().state, DownloadState::Publishing);
    assert_eq!(
        fs::read(f.request.output_path()).unwrap(),
        b"unrelated-user-content"
    );
}

#[tokio::test]
async fn controls_interrupt_pending_reads_through_a_separate_connection() {
    for cancel in [false, true] {
        let f = Fixture::new(DOWNLOAD_CHUNK_SIZE as usize + 40);
        let mut source = f.source();
        let reached = Arc::new(Notify::new());
        source.pending = Some(reached.clone());
        let executor = f.executor();
        let id = f.request.operation_id().to_owned();
        let worker_source = source.clone();
        let task = tokio::spawn(async move {
            executor
                .run(&id, worker_source.scope(), &worker_source)
                .await
        });
        tokio::time::timeout(Duration::from_secs(3), reached.notified())
            .await
            .unwrap();
        let controls = DownloadStore::open(&f.db).unwrap();
        if cancel {
            controls
                .cancel(f.request.operation_id(), source.scope())
                .unwrap();
        } else {
            controls
                .pause(f.request.operation_id(), source.scope())
                .unwrap();
        }
        let result = tokio::time::timeout(Duration::from_secs(3), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(
            result.state,
            if cancel {
                DownloadState::Cancelled
            } else {
                DownloadState::Paused
            }
        );
        assert_eq!(result.checkpoint_bytes, DOWNLOAD_CHUNK_SIZE);
        assert!(!f.request.output_path().exists());
    }
}

#[tokio::test]
async fn flood_wait_is_durable_and_retry_respects_cooldown() {
    let f = Fixture::new(40);
    let mut source = f.source();
    source.failure = Some(SourceFailure::FloodWait {
        retry_after_ms: 60_000,
    });
    assert!(matches!(
        f.executor()
            .run(f.request.operation_id(), source.scope(), &source)
            .await,
        Err(DownloadError::Source(SourceFailure::FloodWait {
            retry_after_ms: 60_000
        }))
    ));
    let record = f.record();
    assert_eq!(record.retry_after_ms, Some(60_000));
    assert_eq!(record.error_code.as_deref(), Some("source_flood_wait"));
    assert!(matches!(
        f.store.retry(f.request.operation_id(), source.scope()),
        Err(DownloadError::InvalidState)
    ));
}

#[test]
fn immutable_bindings_cross_target_collisions_and_metadata_isolation() {
    let f = Fixture::new(40);
    f.store.enqueue(f.request.clone()).unwrap();
    let changed = DownloadRequest::new(
        f.request.operation_id().into(),
        f.request.source().clone(),
        40,
        None,
        f.request.temp_path().into(),
        f.request.output_path().into(),
    )
    .unwrap();
    assert!(matches!(
        f.store.enqueue(changed),
        Err(DownloadError::OperationConflict)
    ));
    let cross = DownloadRequest::new(
        "other-operation".into(),
        f.request.source().clone(),
        40,
        None,
        f.root.join("other.part"),
        f.request.temp_path().into(),
    )
    .unwrap();
    assert!(matches!(
        f.store.enqueue(cross),
        Err(DownloadError::OperationConflict)
    ));
    let conn = rusqlite::Connection::open(&f.db).unwrap();
    conn.execute_batch(include_str!(
        "../../../../../database/migrations/024_android_local_records.sql"
    ))
    .unwrap();
    conn.execute("INSERT INTO android_transfer_tasks(id,file_name,source_identity,destination_identity,stage,status)
        VALUES ('old','old.bin','offline','offline','download','queued')", []).unwrap();
    assert_eq!(
        f.store
            .list(f.request.source().scope(), "", 100)
            .unwrap()
            .len(),
        1
    );
    assert!(conn
        .execute("UPDATE native_cloud_downloads SET request_json='{}'", [])
        .is_err());
    assert!(conn
        .execute("UPDATE native_cloud_downloads SET state='completed'", [])
        .is_err());
}

#[test]
fn master_schema_matches_migration_tables_indexes_and_trigger() {
    let incremental = rusqlite::Connection::open_in_memory().unwrap();
    incremental.execute_batch(SCHEMA).unwrap();
    incremental.execute_batch(SCHEMA).unwrap();
    let master = rusqlite::Connection::open_in_memory().unwrap();
    master
        .execute_batch(include_str!("../../../../../database/schema.sql"))
        .unwrap();
    for object in [
        "native_cloud_downloads",
        "idx_native_cloud_download_scope_state",
        "idx_native_cloud_download_dispatch",
        "native_cloud_download_binding_immutable",
    ] {
        let sql = |conn: &rusqlite::Connection| -> String {
            conn.query_row(
                "SELECT sql FROM sqlite_master WHERE name=?1",
                [object],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
        };
        assert_eq!(sql(&incremental), sql(&master));
    }
}

#[test]
fn independent_expected_size_and_bad_hash_are_rejected() {
    let f = Fixture::new(40);
    assert!(matches!(
        DownloadRequest::new(
            "bad".into(),
            f.request.source().clone(),
            41,
            None,
            f.root.join("bad.part"),
            f.root.join("bad.bin")
        ),
        Err(DownloadError::InvalidRequest)
    ));
    assert!(matches!(
        DownloadRequest::new(
            "bad".into(),
            f.request.source().clone(),
            40,
            Some("bad".into()),
            f.root.join("bad.part"),
            f.root.join("bad.bin")
        ),
        Err(DownloadError::InvalidRequest)
    ));
    let mut hasher = Sha256::new();
    hasher.update(&f.data);
    assert_eq!(digest(&hasher), sha256_bytes(&f.data));
}

#[test]
fn pending_is_bounded_native_only_with_frozen_scopes_and_recovery_states() {
    let f = Fixture::new(40);
    let add = |suffix: &str, account: &str, user: i64| {
        let scope = AccountScope::new(account.into(), user).unwrap();
        let identity = CloudDownloadIdentity::new(
            scope,
            PeerKind::Channel,
            42,
            Some(7),
            11,
            999,
            "document-original".into(),
            "document-999-content-v1".into(),
            40,
        )
        .unwrap();
        let request = DownloadRequest::new(
            format!("{}-{suffix}", f.request.operation_id()),
            identity,
            40,
            Some(sha256_bytes(&f.data)),
            f.root.join(format!("{suffix}.part")),
            f.root.join(format!("{suffix}.bin")),
        )
        .unwrap();
        f.store.enqueue(request).unwrap()
    };
    let activate = |record: &DownloadRecord| {
        let file = OwnedFile::open(record).unwrap();
        f.store
            .attach_file(record.request.operation_id(), &file.identity)
            .unwrap();
        f.store.claim(record.request.operation_id(), false).unwrap();
        file
    };
    let running = add("running", "second-account", 456);
    drop(activate(&running));
    let publishing = add("publishing", "third-account", 789);
    let mut file = activate(&publishing);
    file.append(&f.data).unwrap();
    f.store
        .checkpoint(
            publishing.request.operation_id(),
            40,
            &sha256_bytes(&f.data),
        )
        .unwrap();
    f.store
        .publishing(publishing.request.operation_id(), &sha256_bytes(&f.data))
        .unwrap();
    drop(file);
    let paused = add("paused", "test-account", 123);
    f.store
        .pause(
            paused.request.operation_id(),
            paused.request.source().scope(),
        )
        .unwrap();
    let failed = add("failed", "test-account", 123);
    let file = activate(&failed);
    f.store
        .failed(
            failed.request.operation_id(),
            &DownloadError::Source(SourceFailure::Network),
        )
        .unwrap();
    drop(file);
    let cancelled = add("cancelled", "test-account", 123);
    f.store
        .cancel(
            cancelled.request.operation_id(),
            cancelled.request.source().scope(),
        )
        .unwrap();

    let conn = rusqlite::Connection::open(&f.db).unwrap();
    conn.execute_batch(include_str!(
        "../../../../../database/migrations/024_android_local_records.sql"
    ))
    .unwrap();
    conn.execute("INSERT INTO android_transfer_tasks(id,file_name,source_identity,destination_identity,stage,status)
        VALUES ('legacy','legacy.bin','offline','offline','download','queued')", []).unwrap();
    let pending = f.store.pending(100).unwrap();
    assert_eq!(pending.len(), 3);
    assert!(pending.iter().any(|r| r.state == DownloadState::Queued));
    assert!(pending.iter().any(|r| r.state == DownloadState::Running
        && r.request.source().scope().account_id() == "second-account"));
    assert!(pending.iter().any(|r| r.state == DownloadState::Publishing
        && r.request.source().scope().authorized_user_id() == 789));
    assert_eq!(f.store.pending(2).unwrap().len(), 2);
    assert!(matches!(
        f.store.pending(0),
        Err(DownloadError::InvalidRequest)
    ));
    assert!(matches!(
        f.store.pending(1001),
        Err(DownloadError::InvalidRequest)
    ));
    f.store
        .retry(
            paused.request.operation_id(),
            paused.request.source().scope(),
        )
        .unwrap();
    f.store
        .retry(
            failed.request.operation_id(),
            failed.request.source().scope(),
        )
        .unwrap();
    assert_eq!(f.store.pending(100).unwrap().len(), 5);

    // A publication interrupted by a source FloodWait is recoverable, but never dispatched early.
    f.store
        .failed(
            publishing.request.operation_id(),
            &DownloadError::Source(SourceFailure::FloodWait {
                retry_after_ms: 60_000,
            }),
        )
        .unwrap();
    let waiting = f
        .store
        .get(
            publishing.request.operation_id(),
            publishing.request.source().scope(),
        )
        .unwrap();
    assert!(waiting.retry_not_before_ms().unwrap() > super::store::now_ms() as u64);
    assert_eq!(f.store.pending(100).unwrap().len(), 4);
    assert!(matches!(
        f.store.claim(publishing.request.operation_id(), true),
        Err(DownloadError::InvalidState)
    ));
    // Simulate elapsed clock time in this UUID-owned test DB, without sleeps or production bypasses.
    conn.execute(
        "UPDATE native_cloud_downloads SET updated_ms=updated_ms-60001 WHERE operation_id=?1",
        [publishing.request.operation_id()],
    )
    .unwrap();
    assert_eq!(f.store.pending(100).unwrap().len(), 5);
    f.store
        .claim(publishing.request.operation_id(), true)
        .unwrap();
}
