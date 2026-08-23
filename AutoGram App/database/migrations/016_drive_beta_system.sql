PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS drive_beta_schema (
    component TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS drive_beta_devices (
    device_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    display_name TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_drive_beta_devices_account
ON drive_beta_devices(account_id, revoked_at);

CREATE TABLE IF NOT EXISTS drive_beta_registry (
    drive_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    name TEXT NOT NULL COLLATE NOCASE,
    root_folder_id TEXT NOT NULL UNIQUE,
    storage_peer_id TEXT,
    storage_topic_id INTEGER,
    state TEXT NOT NULL DEFAULT 'active'
        CHECK(state IN ('active', 'syncing', 'error', 'deleted')),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    manifest_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drive_beta_registry_account_name
ON drive_beta_registry(account_id, name)
WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_drive_beta_registry_account
ON drive_beta_registry(account_id, updated_at DESC)
WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS drive_beta_settings (
    account_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(account_id, key)
);

INSERT INTO drive_beta_schema(component, version, applied_at)
VALUES('system', 1, unixepoch('subsec') * 1000)
ON CONFLICT(component) DO UPDATE SET
    version = MAX(version, excluded.version),
    applied_at = excluded.applied_at;
