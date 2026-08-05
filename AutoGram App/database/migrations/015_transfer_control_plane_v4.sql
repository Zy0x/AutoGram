-- AutoGram Transfer Control Plane v4 (specs 4.1, 4.3-4.7)
-- Idempotent: runtime applies this file on every Jobs DB open.

CREATE TABLE IF NOT EXISTS transfer_profiles (
    profile_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    config_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transfer_runs (
    transfer_id TEXT PRIMARY KEY,
    profile_snapshot_json TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transfer_items_v4 (
    transfer_id TEXT NOT NULL,
    item_index INTEGER NOT NULL,
    source_path TEXT NOT NULL,
    prepared_path TEXT,
    media_category TEXT,
    payload_class TEXT,
    transform_action TEXT,
    state TEXT NOT NULL,
    reason_code TEXT,
    telegram_message_id INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (transfer_id, item_index),
    FOREIGN KEY (transfer_id) REFERENCES transfer_runs(transfer_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS media_analysis_cache (
    cache_key TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    source_size INTEGER NOT NULL,
    source_mtime_ms INTEGER NOT NULL,
    analysis_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transfer_decision_cache (
    cache_key TEXT PRIMARY KEY,
    analysis_key TEXT NOT NULL,
    profile_digest TEXT NOT NULL,
    capability_digest TEXT NOT NULL,
    decision_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_ledger (
    ledger_id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    destination_id TEXT NOT NULL,
    topic_id INTEGER NOT NULL DEFAULT 0,
    telegram_message_id INTEGER,
    telegram_unique_id TEXT,
    prepared_sha256 TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    payload_class TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(account_id, destination_id, topic_id, prepared_sha256)
);
CREATE INDEX IF NOT EXISTS idx_upload_ledger_message
ON upload_ledger(account_id, destination_id, telegram_message_id);
CREATE INDEX IF NOT EXISTS idx_upload_ledger_unique_media
ON upload_ledger(account_id, destination_id, telegram_unique_id);
CREATE INDEX IF NOT EXISTS idx_upload_ledger_filename_size
ON upload_ledger(account_id, destination_id, filename, file_size);

CREATE TABLE IF NOT EXISTS album_commits (
    commit_id TEXT PRIMARY KEY,
    transfer_id TEXT NOT NULL,
    compatibility_key_json TEXT NOT NULL,
    ordered_item_indices_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('PREPARED','UPLOADING','COMMITTING','UNKNOWN_COMMIT','RECONCILING','COMMITTED','FAILED','REVIEW_REQUIRED')),
    telegram_message_ids_json TEXT,
    last_error TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_album_commits_transfer ON album_commits(transfer_id, state);

CREATE TABLE IF NOT EXISTS album_commit_intents (
    commit_id TEXT PRIMARY KEY,
    random_ids_json TEXT NOT NULL,
    expected_count INTEGER NOT NULL,
    payload_digest TEXT NOT NULL,
    context_digest TEXT NOT NULL,
    grouped_id INTEGER,
    verified_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (commit_id) REFERENCES album_commits(commit_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account_rate_gates (
    account_id TEXT PRIMARY KEY,
    blocked_until INTEGER,
    reason TEXT,
    consecutive_flood_waits INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account_capabilities (
    account_id TEXT PRIMARY KEY,
    capability_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alternate_upload_bindings (
    transfer_id TEXT NOT NULL,
    item_index INTEGER NOT NULL,
    uploader_account_id TEXT NOT NULL,
    telegram_message_id INTEGER,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (transfer_id, item_index)
);

CREATE TABLE IF NOT EXISTS encoder_receipts (
    receipt_id TEXT PRIMARY KEY,
    transfer_id TEXT NOT NULL,
    item_index INTEGER NOT NULL,
    strategy TEXT NOT NULL,
    device_id TEXT,
    input_json TEXT NOT NULL,
    output_json TEXT,
    validation_json TEXT,
    state TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS split_manifests (
    manifest_id TEXT PRIMARY KEY,
    transfer_id TEXT NOT NULL,
    item_index INTEGER NOT NULL,
    manifest_path TEXT NOT NULL,
    original_sha256 TEXT NOT NULL,
    part_count INTEGER NOT NULL,
    state TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS download_receipts (
    receipt_id TEXT PRIMARY KEY,
    transfer_id TEXT NOT NULL,
    item_index INTEGER NOT NULL,
    conflict_policy TEXT NOT NULL,
    partial_path TEXT,
    final_path TEXT,
    bytes_written INTEGER NOT NULL DEFAULT 0,
    expected_size INTEGER,
    expected_hash TEXT,
    state TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS download_ranges (
    receipt_id TEXT NOT NULL,
    byte_offset INTEGER NOT NULL,
    byte_length INTEGER NOT NULL,
    sha256 TEXT,
    state TEXT NOT NULL CHECK(state IN ('VERIFIED','INVALID')),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (receipt_id, byte_offset),
    FOREIGN KEY (receipt_id) REFERENCES download_receipts(receipt_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_download_ranges_receipt_state
ON download_ranges(receipt_id, state, byte_offset);
