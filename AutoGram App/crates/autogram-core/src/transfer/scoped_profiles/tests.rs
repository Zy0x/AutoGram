use super::*;
use crate::transfer::{
    cloud_download::PeerKind,
    cloud_upload::{snapshot_upload_file, UploadDestination, UploadRequest, UploadStore},
    PresentationOverride,
};
use std::path::PathBuf;

struct Fixture {
    root: PathBuf,
    store: ScopedProfileStore,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "autogram-profile-fixture-{:016x}",
            rand::random::<u64>()
        ));
        std::fs::create_dir(&root).unwrap();
        Self {
            store: ScopedProfileStore::open(&root.join("profiles.db")).unwrap(),
            root,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        *self.store.connection.lock() = rusqlite::Connection::open_in_memory().unwrap();
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
fn scope(user: i64) -> AccountScope {
    AccountScope::new(format!("tg_{user}"), user).unwrap()
}
fn doc(name: &str) -> FrozenTransferProfile {
    let mut config = FrozenTransferProfile::default();
    config.profile_name = name.into();
    config.quality_mode = "DOCUMENT".into();
    config.presentation_override = PresentationOverride::ForceDocument;
    config.group_as_album = false;
    config.group_documents = false;
    config
}

#[test]
fn account_namespace_and_active_selection_are_independent_and_persistent() {
    let fixture = Fixture::new();
    assert!(fixture.store.list(&scope(77)).unwrap().is_empty());
    assert!(fixture.store.active(&scope(77)).unwrap().is_none());
    let first = fixture
        .store
        .save(&scope(77), "first", 0, doc("First"))
        .unwrap();
    fixture
        .store
        .save(&scope(78), "first", 0, doc("Other account"))
        .unwrap();
    fixture
        .store
        .save(&scope(77), "second", 0, doc("Second"))
        .unwrap();
    fixture
        .store
        .select(&scope(77), "first", first.revision)
        .unwrap();
    fixture.store.select(&scope(78), "first", 1).unwrap();
    fixture.store.select(&scope(77), "second", 1).unwrap();
    let reopened = ScopedProfileStore::open(&fixture.root.join("profiles.db")).unwrap();
    assert_eq!(
        reopened.active(&scope(77)).unwrap().unwrap().profile_id,
        "second"
    );
    assert_eq!(
        reopened
            .active(&scope(78))
            .unwrap()
            .unwrap()
            .config
            .profile_name,
        "Other account"
    );
    assert_eq!(
        reopened
            .list(&scope(77))
            .unwrap()
            .iter()
            .filter(|p| p.active)
            .count(),
        1
    );
    assert_eq!(
        reopened.get(&scope(78), "second").unwrap_err(),
        ProfileError::NotFound
    );
    assert_eq!(
        reopened.remove(&scope(78), "second", 1).unwrap_err(),
        ProfileError::NotFound
    );
}

#[test]
fn stale_edit_select_and_delete_are_atomic_and_preserve_active_definition() {
    let fixture = Fixture::new();
    fixture
        .store
        .save(&scope(77), "first", 0, doc("Initial"))
        .unwrap();
    fixture.store.select(&scope(77), "first", 1).unwrap();
    let second_store = ScopedProfileStore::open(&fixture.root.join("profiles.db")).unwrap();
    let newer = second_store
        .save(&scope(77), "first", 1, doc("Edited"))
        .unwrap();
    assert_eq!(newer.revision, 2);
    assert!(newer.active);
    assert_eq!(
        fixture
            .store
            .save(&scope(77), "first", 1, doc("Stale"))
            .unwrap_err(),
        ProfileError::Conflict
    );
    assert_eq!(
        fixture.store.select(&scope(77), "first", 1).unwrap_err(),
        ProfileError::Conflict
    );
    assert_eq!(
        fixture.store.remove(&scope(77), "first", 1).unwrap_err(),
        ProfileError::Conflict
    );
    assert_eq!(
        fixture
            .store
            .active(&scope(77))
            .unwrap()
            .unwrap()
            .config
            .profile_name,
        "Edited"
    );
    assert_eq!(
        fixture
            .store
            .save(&scope(77), "missing", 4, doc("Missing"))
            .unwrap_err(),
        ProfileError::Conflict
    );
    fixture.store.remove(&scope(77), "first", 2).unwrap();
    assert!(fixture.store.list(&scope(77)).unwrap().is_empty());
    assert!(fixture.store.active(&scope(77)).unwrap().is_none());
}

#[test]
fn queued_upload_keeps_snapshot_after_profile_edit_switch_and_delete() {
    let fixture = Fixture::new();
    let account = scope(77);
    fixture
        .store
        .save(&account, "first", 0, doc("Original profile"))
        .unwrap();
    fixture.store.select(&account, "first", 1).unwrap();
    let snapshot = fixture.store.active(&account).unwrap().unwrap().config;
    let path = fixture.root.join("fixture.staged");
    std::fs::write(&path, b"profile fixture").unwrap();
    let uploads = UploadStore::open(&fixture.root.join("profiles.db")).unwrap();
    let request = UploadRequest {
        operation_id: "profile-fixture-operation".into(),
        destination: UploadDestination {
            scope: account.clone(),
            peer_kind: PeerKind::Channel,
            peer_id: 321,
            topic_id: Some(17),
        },
        source: snapshot_upload_file(&std::fs::canonicalize(path).unwrap()).unwrap(),
        filename: "fixture.txt".into(),
        mime_type: "text/plain".into(),
        caption: String::new(),
        profile: snapshot.clone(),
        profile_binding: Some(crate::transfer::cloud_upload::UploadProfileBinding {
            profile_id: "first".into(),
            revision: 1,
        }),
        random_id: 911,
    };
    uploads.enqueue(request.clone()).unwrap();
    let mut retargeted = request.clone();
    retargeted.profile_binding.as_mut().unwrap().revision = 2;
    assert_eq!(
        uploads.enqueue(retargeted).unwrap_err(),
        crate::transfer::cloud_upload::UploadError::Conflict
    );
    fixture
        .store
        .save(&account, "first", 1, doc("Updated profile"))
        .unwrap();
    fixture
        .store
        .save(&account, "second", 0, doc("Another profile"))
        .unwrap();
    fixture.store.select(&account, "second", 1).unwrap();
    fixture.store.remove(&account, "first", 2).unwrap();
    let saved = uploads.get(&request.operation_id, &account).unwrap();
    assert_eq!(saved.request.profile, snapshot);
    let conn = fixture.store.connection.lock();
    let json: String = conn
        .query_row(
            "SELECT profile_snapshot_json FROM transfer_runs WHERE transfer_id=?1",
            [&request.operation_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<FrozenTransferProfile>(&json).unwrap(),
        snapshot
    );
}

#[test]
fn invalid_settings_do_not_replace_a_valid_definition() {
    let fixture = Fixture::new();
    let initial = doc("Valid");
    fixture
        .store
        .save(&scope(77), "first", 0, initial.clone())
        .unwrap();
    let mut invalids = vec![];
    for field in 0..8 {
        let mut config = initial.clone();
        match field {
            0 => config.profile_name = "\n".into(),
            1 => config.quality_mode = "TYPO".into(),
            2 => config.upload_concurrency = 0,
            3 => config.album_group_size = 11,
            4 => config.encoder.max_cpu_percent = 101,
            5 => config.encoder.max_parallel_encodes = 0,
            6 => config.encoder.strategy = crate::transfer::EncoderStrategy::SpecificDevice,
            _ => config.schema_version = 2,
        }
        invalids.push(config);
    }
    for config in invalids {
        assert_eq!(
            fixture
                .store
                .save(&scope(77), "first", 1, config)
                .unwrap_err(),
            ProfileError::InvalidProfile
        );
    }
    assert_eq!(
        fixture.store.get(&scope(77), "first").unwrap().config,
        initial
    );
    assert_eq!(
        fixture
            .store
            .save(&scope(77), "../escape", 0, initial)
            .unwrap_err(),
        ProfileError::InvalidProfile
    );
}

#[test]
fn owner_binding_is_immutable_schema_matches_master_and_existing_v4_rows_survive() {
    let fixture = Fixture::new();
    let conn = fixture.store.connection.lock();
    conn.execute(
        "INSERT INTO transfer_profiles VALUES ('desktop-existing','Existing',1,'{}',0,0)",
        [],
    )
    .unwrap();
    for _ in 0..2 {
        conn.execute_batch(super::store::SCHEMA).unwrap();
    }
    let master = rusqlite::Connection::open_in_memory().unwrap();
    master
        .execute_batch(include_str!("../../../../../database/schema.sql"))
        .unwrap();
    let columns = |db: &rusqlite::Connection| {
        db.prepare("PRAGMA table_info(native_transfer_profile_bindings)")
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
    let old: i64 = conn
        .query_row(
            "SELECT count(*) FROM transfer_profiles WHERE profile_id='desktop-existing'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(old, 1);
    drop(conn);
    fixture
        .store
        .save(&scope(77), "first", 0, doc("Owned"))
        .unwrap();
    assert!(fixture
        .store
        .connection
        .lock()
        .execute(
            "UPDATE native_transfer_profile_bindings SET account_id='tg_78'",
            []
        )
        .is_err());
}
