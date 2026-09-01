-- ============================================================================
-- AUTOGRAM CONSOLIDATED MASTER SQLITE DATABASE SCHEMA
-- Version: 5.2.0 (Consolidated Migrations 001 - 019)
-- Database Engine: SQLite 3.x (WAL Journaling Mode)
-- ============================================================================

-- Pragmas for high-throughput concurrency and foreign key integrity
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- ============================================================================
-- 1. SYSTEM & AUTHENTICATION SUBSYSTEM
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    username             TEXT NOT NULL UNIQUE,
    master_password_hash TEXT NOT NULL,
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS telegram_accounts (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    account_name         TEXT NOT NULL,
    phone_number         TEXT NOT NULL UNIQUE,
    session_file_path    TEXT NOT NULL,
    is_active            BOOLEAN DEFAULT 1,
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at         DATETIME
);

CREATE TABLE IF NOT EXISTS profiles (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT NOT NULL UNIQUE,
    session_file_path    TEXT NOT NULL,
    is_active            BOOLEAN DEFAULT 1,
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS drive_beta_accounts (
    account_id           TEXT PRIMARY KEY,
    display_name         TEXT,
    created_at           INTEGER NOT NULL,
    last_seen_at         INTEGER NOT NULL,
    revoked_at           INTEGER
);
CREATE INDEX IF NOT EXISTS idx_drive_beta_accounts_active
ON drive_beta_accounts(last_seen_at DESC)
WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS drive_beta_devices (
    device_id            TEXT PRIMARY KEY,
    account_id           TEXT NOT NULL,
    display_name         TEXT,
    created_at           INTEGER NOT NULL,
    last_seen_at         INTEGER NOT NULL,
    revoked_at           INTEGER,
    FOREIGN KEY(account_id) REFERENCES drive_beta_accounts(account_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_drive_beta_devices_account
ON drive_beta_devices(account_id, revoked_at);

CREATE TABLE IF NOT EXISTS drive_beta_schema (
    component            TEXT PRIMARY KEY,
    version              INTEGER NOT NULL,
    applied_at           INTEGER NOT NULL
);

-- ============================================================================
-- 2. VIRTUAL DRIVE & CLOUD FILESYSTEM SUBSYSTEM
-- ============================================================================

CREATE TABLE IF NOT EXISTS drive_beta_registry (
    drive_id             TEXT PRIMARY KEY,
    account_id           TEXT NOT NULL,
    name                 TEXT NOT NULL COLLATE NOCASE,
    root_folder_id       TEXT NOT NULL UNIQUE,
    storage_peer_id      TEXT,
    storage_type         TEXT NOT NULL DEFAULT 'telegram'
        CHECK(storage_type IN ('telegram', 'telegram_topic', 'local_cache')),
    is_default           INTEGER NOT NULL DEFAULT 0,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    deleted_at           INTEGER,
    FOREIGN KEY(account_id) REFERENCES drive_beta_accounts(account_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_drive_beta_registry_account
ON drive_beta_registry(account_id, updated_at DESC)
WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS drive_beta_folders (
    folder_id            TEXT PRIMARY KEY,
    drive_id             TEXT NOT NULL,
    parent_id            TEXT,
    name                 TEXT NOT NULL COLLATE NOCASE,
    version              INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    object_hash          TEXT NOT NULL,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    deleted_at           INTEGER,
    FOREIGN KEY(drive_id) REFERENCES drive_beta_registry(drive_id) ON DELETE CASCADE,
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
    file_id              TEXT PRIMARY KEY,
    drive_id             TEXT NOT NULL,
    folder_id            TEXT NOT NULL,
    filename             TEXT NOT NULL COLLATE NOCASE,
    size                 INTEGER NOT NULL DEFAULT 0 CHECK(size >= 0),
    mime                 TEXT,
    content_hash         TEXT,
    telegram_unique_id   TEXT,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    deleted_at           INTEGER,
    FOREIGN KEY(drive_id) REFERENCES drive_beta_registry(drive_id) ON DELETE CASCADE,
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
    mapping_id           TEXT PRIMARY KEY,
    drive_id             TEXT NOT NULL,
    object_type          TEXT NOT NULL CHECK(object_type IN ('drive', 'folder', 'file')),
    object_id            TEXT NOT NULL,
    telegram_chat_id     TEXT NOT NULL,
    telegram_topic_id    INTEGER,
    telegram_message_id  INTEGER,
    storage_type         TEXT NOT NULL DEFAULT 'telegram'
        CHECK(storage_type IN ('telegram', 'telegram_topic', 'telegram_message')),
    version              INTEGER NOT NULL DEFAULT 1,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    deleted_at           INTEGER,
    FOREIGN KEY(drive_id) REFERENCES drive_beta_registry(drive_id) ON DELETE CASCADE,
    UNIQUE(drive_id, object_type, object_id, telegram_chat_id, telegram_topic_id, telegram_message_id)
);
CREATE INDEX IF NOT EXISTS idx_drive_beta_mapping_object
ON drive_beta_telegram_mapping(drive_id, object_type, object_id)
WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_drive_beta_mapping_telegram
ON drive_beta_telegram_mapping(telegram_chat_id, telegram_topic_id, telegram_message_id)
WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS drive_beta_events (
    event_id             TEXT PRIMARY KEY,
    drive_id             TEXT NOT NULL,
    device_id            TEXT NOT NULL,
    action               TEXT NOT NULL,
    object_type          TEXT NOT NULL,
    object_id            TEXT NOT NULL,
    object_version       INTEGER NOT NULL,
    payload_json         TEXT NOT NULL,
    occurred_at          INTEGER NOT NULL,
    status               TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'syncing', 'applied', 'conflict', 'failed')),
    retry_count          INTEGER NOT NULL DEFAULT 0,
    remote_message_id    INTEGER,
    last_error           TEXT
);
CREATE INDEX IF NOT EXISTS idx_drive_beta_event_outbox
ON drive_beta_events(status, occurred_at, event_id);
CREATE INDEX IF NOT EXISTS idx_drive_beta_event_drive
ON drive_beta_events(drive_id, occurred_at, event_id);

CREATE TABLE IF NOT EXISTS drive_beta_snapshots (
    snapshot_id          TEXT PRIMARY KEY,
    drive_id             TEXT NOT NULL,
    device_id            TEXT NOT NULL,
    event_cursor         TEXT,
    payload_json         TEXT NOT NULL,
    payload_hash         TEXT NOT NULL,
    created_at           INTEGER NOT NULL,
    remote_message_id    INTEGER,
    verified_at          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_drive_beta_snapshot_latest
ON drive_beta_snapshots(drive_id, created_at DESC);

CREATE TABLE IF NOT EXISTS drive_beta_sync_state (
    drive_id             TEXT PRIMARY KEY,
    local_event_cursor   TEXT,
    remote_event_cursor  TEXT,
    last_pull_at         INTEGER,
    last_push_at         INTEGER,
    last_snapshot_at     INTEGER,
    status               TEXT NOT NULL DEFAULT 'idle',
    last_error           TEXT
);

CREATE TABLE IF NOT EXISTS drive_beta_settings (
    account_id           TEXT NOT NULL,
    key                  TEXT NOT NULL,
    value_json           TEXT NOT NULL,
    updated_at           INTEGER NOT NULL,
    PRIMARY KEY(account_id, key)
);

-- ============================================================================
-- 3. TOPIC MEDIA CACHE & SPARSE VIDEO INDEXING
-- ============================================================================

CREATE TABLE IF NOT EXISTS topic_media_items (
    account_id           TEXT NOT NULL,
    peer_id              TEXT NOT NULL,
    topic_id             INTEGER NOT NULL DEFAULT 0,
    message_id           INTEGER NOT NULL,

    message_date         INTEGER NOT NULL,
    edit_date            INTEGER,
    grouped_id           INTEGER,

    sender_id            TEXT,
    caption              TEXT,

    media_type           TEXT NOT NULL,
    mime_type            TEXT,
    file_name            TEXT,
    file_size            INTEGER NOT NULL DEFAULT 0,

    document_id          INTEGER,
    access_hash          INTEGER,
    dc_id                INTEGER,
    file_reference       BLOB,

    width                INTEGER,
    height               INTEGER,
    duration             INTEGER,
    thumb_type           TEXT,

    has_spoiler          INTEGER DEFAULT 0,
    ttl_seconds          INTEGER,

    indexed_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,

    PRIMARY KEY (account_id, peer_id, topic_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_tmi_peer_topic_date
    ON topic_media_items (account_id, peer_id, topic_id, message_date DESC, message_id DESC);
CREATE INDEX IF NOT EXISTS idx_tmi_peer_topic_media
    ON topic_media_items (account_id, peer_id, topic_id, media_type, message_date DESC);
CREATE INDEX IF NOT EXISTS idx_tmi_grouped
    ON topic_media_items (account_id, peer_id, grouped_id)
    WHERE grouped_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tmi_doc_id
    ON topic_media_items (document_id)
    WHERE document_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS keyframe_index (
    file_id              TEXT NOT NULL,
    timestamp_ms         INTEGER NOT NULL,
    byte_offset          INTEGER NOT NULL,
    PRIMARY KEY (file_id, timestamp_ms)
);
CREATE INDEX IF NOT EXISTS idx_keyframe_lookup ON keyframe_index(file_id, byte_offset);

CREATE TABLE IF NOT EXISTS moov_sidecar (
    file_id              TEXT NOT NULL PRIMARY KEY,
    sidecar_path         TEXT NOT NULL,
    size                 INTEGER NOT NULL,
    created_at           TEXT NOT NULL
);

-- ============================================================================
-- 4. TRANSFER CONTROL PLANE V4 SUBSYSTEM
-- ============================================================================

CREATE TABLE IF NOT EXISTS transfer_profiles (
    profile_id           TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    schema_version       INTEGER NOT NULL,
    config_json          TEXT NOT NULL,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transfer_runs (
    transfer_id          TEXT PRIMARY KEY,
    profile_snapshot_json TEXT NOT NULL,
    state                TEXT NOT NULL,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transfer_items_v4 (
    transfer_id          TEXT NOT NULL,
    item_index           INTEGER NOT NULL,
    source_path          TEXT NOT NULL,
    prepared_path        TEXT,
    filename             TEXT NOT NULL,
    size_bytes           INTEGER NOT NULL,
    mime_type            TEXT,
    checksum_sha256      TEXT,
    item_type            TEXT NOT NULL,
    state                TEXT NOT NULL,
    phase                TEXT NOT NULL,
    bytes_uploaded       INTEGER NOT NULL DEFAULT 0,
    retry_count          INTEGER NOT NULL DEFAULT 0,
    error_message        TEXT,
    telegram_doc_id      INTEGER,
    telegram_access_hash INTEGER,
    telegram_file_ref    BLOB,
    telegram_message_id  INTEGER,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    PRIMARY KEY (transfer_id, item_index),
    FOREIGN KEY (transfer_id) REFERENCES transfer_runs(transfer_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_transfer_items_v4_lookup ON transfer_items_v4(transfer_id, state);

CREATE TABLE IF NOT EXISTS transfer_events (
    event_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_id          TEXT NOT NULL,
    item_index           INTEGER,
    event_type           TEXT NOT NULL,
    old_state            TEXT,
    new_state            TEXT,
    phase                TEXT,
    bytes_current        INTEGER,
    bytes_total          INTEGER,
    error_detail         TEXT,
    occurred_at          INTEGER NOT NULL,
    FOREIGN KEY (transfer_id) REFERENCES transfer_runs(transfer_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_transfer_events_transfer ON transfer_events(transfer_id, occurred_at ASC);

-- ============================================================================
-- 5. REMOTE TRANSFERS & RESUMABLE STREAM JOURNAL
-- ============================================================================

CREATE TABLE IF NOT EXISTS remote_transfer_jobs (
    job_id               TEXT PRIMARY KEY,
    account_id           TEXT,
    source_url           TEXT NOT NULL,
    source_filename      TEXT,
    source_mime          TEXT,
    source_size          INTEGER,
    source_etag          TEXT,
    source_last_modified TEXT,
    mode                 TEXT NOT NULL DEFAULT 'auto',
    storage_policy       TEXT NOT NULL DEFAULT 'telegram',
    custom_disk_path     TEXT,
    spool_path           TEXT,
    downloaded_bytes     INTEGER NOT NULL DEFAULT 0,
    uploaded_bytes       INTEGER NOT NULL DEFAULT 0,
    checksum_sha256      TEXT,
    destination_type     TEXT DEFAULT 'drive',
    destination_id       TEXT,
    destination_topic_id INTEGER,
    telegram_message_id  INTEGER,
    state                TEXT NOT NULL DEFAULT 'queued',
    cleanup_state        TEXT NOT NULL DEFAULT 'pending',
    retry_count          INTEGER NOT NULL DEFAULT 0,
    last_error           TEXT,
    created_at_ms        INTEGER NOT NULL,
    updated_at_ms        INTEGER NOT NULL,
    completed_at_ms      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_remote_transfer_jobs_state ON remote_transfer_jobs(state);
CREATE INDEX IF NOT EXISTS idx_remote_transfer_jobs_account ON remote_transfer_jobs(account_id);
CREATE INDEX IF NOT EXISTS idx_remote_transfer_jobs_updated ON remote_transfer_jobs(updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS remote_transfer_events (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id               TEXT NOT NULL,
    event_type           TEXT NOT NULL,
    payload              TEXT,
    created_at_ms        INTEGER NOT NULL,
    FOREIGN KEY(job_id) REFERENCES remote_transfer_jobs(job_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_remote_transfer_events_job ON remote_transfer_events(job_id, created_at_ms ASC);

-- ============================================================================
-- 6. 4-LEVEL DUPLICATE PREVENTION MATRIX & SCAN CACHE
-- ============================================================================

CREATE TABLE IF NOT EXISTS duplicate_history (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    file_unique_id       TEXT NOT NULL,
    target_entity_id     TEXT NOT NULL,
    target_message_id    INTEGER NOT NULL,
    media_type           TEXT NOT NULL DEFAULT 'unknown',
    fingerprint_tier     INTEGER NOT NULL DEFAULT 1,
    fingerprint_hash     TEXT,
    sha256_hash          TEXT,
    width                INTEGER,
    height               INTEGER,
    duration             INTEGER,
    first_seen_at        INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    last_seen_at         INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    hit_count            INTEGER NOT NULL DEFAULT 1,
    UNIQUE(file_unique_id, target_entity_id)
);
CREATE INDEX IF NOT EXISTS idx_dup_hist_unique_id ON duplicate_history(file_unique_id);
CREATE INDEX IF NOT EXISTS idx_dup_hist_target_msg ON duplicate_history(target_entity_id, target_message_id);
CREATE INDEX IF NOT EXISTS idx_dup_hist_sha256 ON duplicate_history(sha256_hash) WHERE sha256_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dup_hist_tier_hash ON duplicate_history(fingerprint_tier, fingerprint_hash) WHERE fingerprint_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS destination_scan_cache (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    target_entity_id     TEXT    NOT NULL,
    topic_id             INTEGER,
    file_unique_id       TEXT,
    file_name            TEXT,
    file_size            INTEGER,
    media_type           TEXT    NOT NULL DEFAULT 'unknown',
    fingerprint_tier     INTEGER NOT NULL DEFAULT 4,
    fingerprint_hash     TEXT,
    sha256_hash          TEXT,
    width                INTEGER,
    height               INTEGER,
    duration             INTEGER,
    telegram_message_id  INTEGER NOT NULL,
    telegram_date        INTEGER NOT NULL,
    cached_at            INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    UNIQUE(target_entity_id, topic_id, telegram_message_id)
);
CREATE INDEX IF NOT EXISTS idx_dsc_target_topic ON destination_scan_cache(target_entity_id, topic_id);
CREATE INDEX IF NOT EXISTS idx_dsc_file_unique_id ON destination_scan_cache(file_unique_id) WHERE file_unique_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dsc_sha256 ON destination_scan_cache(sha256_hash) WHERE sha256_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dsc_tier_hash ON destination_scan_cache(fingerprint_tier, fingerprint_hash) WHERE fingerprint_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dsc_name_size ON destination_scan_cache(target_entity_id, topic_id, file_name, file_size);

CREATE TABLE IF NOT EXISTS transfer_state (
    transfer_id          TEXT PRIMARY KEY,
    account_id           TEXT NOT NULL,
    target_entity_id     TEXT NOT NULL,
    topic_id             INTEGER,
    status               TEXT NOT NULL DEFAULT 'idle',
    total_items          INTEGER NOT NULL DEFAULT 0,
    processed_items      INTEGER NOT NULL DEFAULT 0,
    skipped_items        INTEGER NOT NULL DEFAULT 0,
    failed_items         INTEGER NOT NULL DEFAULT 0,
    bytes_transferred    INTEGER NOT NULL DEFAULT 0,
    current_item_name    TEXT,
    started_at           INTEGER,
    finished_at          INTEGER,
    last_error           TEXT,
    config_json          TEXT
);
CREATE INDEX IF NOT EXISTS idx_transfer_state_account ON transfer_state(account_id);
CREATE INDEX IF NOT EXISTS idx_transfer_state_status ON transfer_state(status);

CREATE TABLE IF NOT EXISTS transfer_audit_log (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_id          TEXT    NOT NULL,
    item_index           INTEGER,
    source_path          TEXT,
    file_name            TEXT    NOT NULL,
    file_size            INTEGER,
    decision             TEXT    NOT NULL, -- transferred | skipped_duplicate | failed | cancelled
    matched_tier         INTEGER,          -- 1 | 2 | 3 | 4
    matched_message_id   INTEGER,
    target_message_id    INTEGER,
    error_message        TEXT,
    logged_at            INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_tal_transfer_id ON transfer_audit_log(transfer_id);
CREATE INDEX IF NOT EXISTS idx_tal_decision ON transfer_audit_log(decision);

-- ============================================================================
-- 7. MIGRATION, CHANNEL FORWARDER & SYNC SUBSYSTEM
-- ============================================================================

CREATE TABLE IF NOT EXISTS jobs (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT,
    profile_name         TEXT,
    source_entity_id     TEXT NOT NULL,
    target_entity_id     TEXT NOT NULL,
    transfer_mode        TEXT NOT NULL,
    config_json          TEXT,
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS executions (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id               INTEGER NOT NULL,
    snapshot_config_json TEXT NOT NULL,
    status               TEXT NOT NULL,
    total_messages       INTEGER DEFAULT 0,
    processed_messages   INTEGER DEFAULT 0,
    last_processed_id    INTEGER DEFAULT 0,
    started_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at          DATETIME,
    error_message        TEXT,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_executions_job_started ON executions(job_id, started_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id         INTEGER NOT NULL,
    source_message_id    INTEGER NOT NULL,
    target_message_id    INTEGER,
    file_unique_id       TEXT,
    file_hash            TEXT,
    file_name            TEXT,
    file_size            INTEGER,
    status               TEXT NOT NULL,
    error_category       TEXT,
    error_message        TEXT,
    attempts             INTEGER DEFAULT 1,
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(execution_id) REFERENCES executions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tasks_execution_status_msg ON tasks(execution_id, status, source_message_id);

CREATE TABLE IF NOT EXISTS message_mapping (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id               INTEGER,
    source_chat_id       TEXT NOT NULL,
    source_msg_id        INTEGER NOT NULL,
    dest_chat_id         TEXT NOT NULL,
    dest_msg_id          INTEGER NOT NULL,
    status               TEXT DEFAULT 'COMPLETED',
    retry_count          INTEGER DEFAULT 0,
    error_message        TEXT,
    last_updated         TIMESTAMP,
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_chat_id, source_msg_id)
);
CREATE INDEX IF NOT EXISTS idx_mapping_job_message ON message_mapping(job_id, source_msg_id);
CREATE INDEX IF NOT EXISTS idx_mapping_job_status_updated ON message_mapping(job_id, status, last_updated);

CREATE TABLE IF NOT EXISTS sync_jobs (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_name         TEXT,
    source_entity_id     TEXT NOT NULL,
    target_entity_id     TEXT NOT NULL,
    last_processed_msg_id INTEGER DEFAULT 0,
    status               TEXT NOT NULL,
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS automations (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT NOT NULL,
    schedule_cron        TEXT,
    action_type          TEXT NOT NULL,
    config_json          TEXT NOT NULL,
    status               TEXT NOT NULL,
    last_run             DATETIME,
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fast_forward_checkpoints (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id         INTEGER NOT NULL,
    checkpoint_data_json TEXT NOT NULL,
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(execution_id) REFERENCES executions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS logs (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id               INTEGER,
    log_level            TEXT NOT NULL,
    message              TEXT NOT NULL,
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Media Forwarder V2 canonical extensions (kept additive for legacy adapters).
CREATE TABLE IF NOT EXISTS forwarder_job_configs (
    job_id INTEGER PRIMARY KEY,
    schema_version INTEGER NOT NULL DEFAULT 2,
    revision INTEGER NOT NULL DEFAULT 0,
    config_json TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS job_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    config_json TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'local',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(job_id, revision),
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS mirror_cursors (
    job_id INTEGER PRIMARY KEY,
    pts INTEGER,
    event_cursor TEXT,
    reconcile_state TEXT NOT NULL DEFAULT 'idle',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS decision_inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    execution_id INTEGER,
    task_id INTEGER,
    decision_type TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'OPEN',
    resolved_by TEXT,
    resolved_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY(execution_id) REFERENCES executions(id) ON DELETE SET NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS notification_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    execution_id INTEGER,
    channel TEXT NOT NULL,
    dedupe_key TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at DATETIME,
    delivered_at DATETIME,
    last_error TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel, dedupe_key),
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY(execution_id) REFERENCES executions(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS retention_markers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    retention_until DATETIME NOT NULL,
    export_reference TEXT,
    purged_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_forwarder_job_configs_revision ON forwarder_job_configs(revision);
CREATE INDEX IF NOT EXISTS idx_job_revisions_job_revision ON job_revisions(job_id, revision DESC);
CREATE INDEX IF NOT EXISTS idx_decision_inbox_job_status ON decision_inbox(job_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_status ON notification_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_retention_markers_due ON retention_markers(retention_until, purged_at);

-- ============================================================================
-- INITIAL SCHEMA VERSION SEED
-- ============================================================================
INSERT INTO drive_beta_schema(component, version, applied_at)
VALUES
    ('system', 2, (strftime('%s','now') * 1000)),
    ('metadata', 1, (strftime('%s','now') * 1000))
ON CONFLICT(component) DO UPDATE SET
    version = MAX(version, excluded.version),
    applied_at = excluded.applied_at;
