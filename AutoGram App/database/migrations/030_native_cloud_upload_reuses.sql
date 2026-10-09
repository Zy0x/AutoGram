-- Reuse references an existing verified document; it is not a transmitted upload.
CREATE TABLE IF NOT EXISTS native_cloud_upload_reuses (
    operation_id TEXT PRIMARY KEY REFERENCES transfer_runs(transfer_id),
    account_id TEXT NOT NULL,
    authorized_user_id INTEGER NOT NULL CHECK(authorized_user_id > 0),
    request_json TEXT NOT NULL,
    document_json TEXT NOT NULL,
    match_level TEXT NOT NULL CHECK(match_level IN ('message_id','document_id','sha256')),
    created_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_native_cloud_upload_reuse_scope
ON native_cloud_upload_reuses(account_id, authorized_user_id, created_ms, operation_id);
CREATE TRIGGER IF NOT EXISTS native_cloud_upload_reuse_immutable
BEFORE UPDATE ON native_cloud_upload_reuses BEGIN
    SELECT RAISE(ABORT, 'native_cloud_upload_reuse_immutable');
END;

-- Any ledger write changes the admission revision in the same SQLite transaction.
CREATE TABLE IF NOT EXISTS native_upload_duplicate_revisions (
    account_id TEXT NOT NULL,
    destination_id TEXT NOT NULL,
    topic_id INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision > 0),
    PRIMARY KEY(account_id, destination_id, topic_id)
);
CREATE TRIGGER IF NOT EXISTS native_upload_duplicate_insert
AFTER INSERT ON upload_ledger BEGIN
    INSERT INTO native_upload_duplicate_revisions VALUES(NEW.account_id,NEW.destination_id,NEW.topic_id,1)
    ON CONFLICT(account_id,destination_id,topic_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS native_upload_duplicate_delete
AFTER DELETE ON upload_ledger BEGIN
    INSERT INTO native_upload_duplicate_revisions VALUES(OLD.account_id,OLD.destination_id,OLD.topic_id,1)
    ON CONFLICT(account_id,destination_id,topic_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS native_upload_duplicate_update
AFTER UPDATE ON upload_ledger BEGIN
    INSERT INTO native_upload_duplicate_revisions VALUES(OLD.account_id,OLD.destination_id,OLD.topic_id,1)
    ON CONFLICT(account_id,destination_id,topic_id) DO UPDATE SET revision=revision+1;
    INSERT INTO native_upload_duplicate_revisions
    SELECT NEW.account_id,NEW.destination_id,NEW.topic_id,1
    WHERE OLD.account_id<>NEW.account_id OR OLD.destination_id<>NEW.destination_id OR OLD.topic_id<>NEW.topic_id
    ON CONFLICT(account_id,destination_id,topic_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS native_cloud_upload_reuse_exclusive
BEFORE INSERT ON native_cloud_upload_reuses
WHEN EXISTS(SELECT 1 FROM native_cloud_uploads WHERE operation_id=NEW.operation_id) BEGIN
    SELECT RAISE(ABORT, 'native_cloud_upload_admission_conflict');
END;
CREATE TRIGGER IF NOT EXISTS native_cloud_upload_execution_exclusive
BEFORE INSERT ON native_cloud_uploads
WHEN EXISTS(SELECT 1 FROM native_cloud_upload_reuses WHERE operation_id=NEW.operation_id) BEGIN
    SELECT RAISE(ABORT, 'native_cloud_upload_admission_conflict');
END;
