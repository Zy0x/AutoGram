PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS drive_beta_folders (
    folder_id TEXT PRIMARY KEY,
    drive_id TEXT NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL COLLATE NOCASE,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    object_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY(parent_id) REFERENCES drive_beta_folders(folder_id)
        DEFERRABLE INITIALLY DEFERRED,
    CHECK(parent_id IS NULL OR parent_id <> folder_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drive_beta_folder_name
ON drive_beta_folders(drive_id, parent_id, name)
WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_drive_beta_folder_page
ON drive_beta_folders(drive_id, parent_id, name, folder_id)
WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_drive_beta_folder_hash
ON drive_beta_folders(drive_id, object_hash);

CREATE TABLE IF NOT EXISTS drive_beta_files (
    file_id TEXT PRIMARY KEY,
    drive_id TEXT NOT NULL,
    folder_id TEXT NOT NULL,
    filename TEXT NOT NULL COLLATE NOCASE,
    size INTEGER NOT NULL DEFAULT 0 CHECK(size >= 0),
    mime TEXT,
    content_hash TEXT,
    telegram_unique_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY(folder_id) REFERENCES drive_beta_folders(folder_id)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS idx_drive_beta_file_page
ON drive_beta_files(drive_id, folder_id, filename, file_id)
WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_drive_beta_file_hash
ON drive_beta_files(drive_id, content_hash)
WHERE content_hash IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_drive_beta_file_name_size
ON drive_beta_files(drive_id, filename, size)
WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS drive_beta_telegram_mapping (
    mapping_id TEXT PRIMARY KEY,
    drive_id TEXT NOT NULL,
    object_type TEXT NOT NULL CHECK(object_type IN ('drive', 'folder', 'file')),
    object_id TEXT NOT NULL,
    telegram_chat_id TEXT NOT NULL,
    telegram_topic_id INTEGER,
    telegram_message_id INTEGER,
    storage_type TEXT NOT NULL DEFAULT 'telegram'
        CHECK(storage_type IN ('telegram', 'telegram_topic', 'telegram_message')),
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    UNIQUE(drive_id, object_type, object_id, telegram_chat_id, telegram_topic_id, telegram_message_id)
);
CREATE INDEX IF NOT EXISTS idx_drive_beta_mapping_object
ON drive_beta_telegram_mapping(drive_id, object_type, object_id)
WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_drive_beta_mapping_telegram
ON drive_beta_telegram_mapping(telegram_chat_id, telegram_topic_id, telegram_message_id)
WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS drive_beta_events (
    event_id TEXT PRIMARY KEY,
    drive_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    action TEXT NOT NULL,
    object_type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    object_version INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'syncing', 'applied', 'conflict', 'failed')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    remote_message_id INTEGER,
    last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_drive_beta_event_outbox
ON drive_beta_events(status, occurred_at, event_id);
CREATE INDEX IF NOT EXISTS idx_drive_beta_event_drive
ON drive_beta_events(drive_id, occurred_at, event_id);

CREATE TABLE IF NOT EXISTS drive_beta_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    drive_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    event_cursor TEXT,
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    remote_message_id INTEGER,
    verified_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_drive_beta_snapshot_latest
ON drive_beta_snapshots(drive_id, created_at DESC);

CREATE TABLE IF NOT EXISTS drive_beta_sync_state (
    drive_id TEXT PRIMARY KEY,
    local_event_cursor TEXT,
    remote_event_cursor TEXT,
    last_pull_at INTEGER,
    last_push_at INTEGER,
    last_snapshot_at INTEGER,
    status TEXT NOT NULL DEFAULT 'idle',
    last_error TEXT
);

CREATE TABLE IF NOT EXISTS drive_beta_schema (
    component TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    applied_at INTEGER NOT NULL
);
INSERT INTO drive_beta_schema(component, version, applied_at)
VALUES('metadata', 1, unixepoch('subsec') * 1000)
ON CONFLICT(component) DO UPDATE SET
    version = MAX(version, excluded.version),
    applied_at = excluded.applied_at;
