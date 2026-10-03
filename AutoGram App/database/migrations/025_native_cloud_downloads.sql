-- Executable native cloud downloads, isolated from Android offline metadata jobs.
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS native_cloud_downloads (
    operation_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    authorized_user_id INTEGER NOT NULL CHECK(authorized_user_id > 0),
    request_json TEXT NOT NULL,
    temp_path TEXT NOT NULL UNIQUE,
    output_path TEXT NOT NULL UNIQUE,
    expected_size INTEGER NOT NULL CHECK(expected_size >= 0),
    state TEXT NOT NULL DEFAULT 'queued'
        CHECK(state IN ('queued','running','paused','cancelled','failed','publishing','completed')),
    control TEXT CHECK(control IN ('pause','cancel')),
    checkpoint_bytes INTEGER NOT NULL DEFAULT 0
        CHECK(checkpoint_bytes >= 0 AND checkpoint_bytes <= expected_size),
    checkpoint_sha256 TEXT NOT NULL CHECK(length(checkpoint_sha256) = 64),
    file_identity TEXT,
    actual_sha256 TEXT CHECK(actual_sha256 IS NULL OR length(actual_sha256) = 64),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
    error_code TEXT,
    retry_after_ms INTEGER CHECK(retry_after_ms IS NULL OR retry_after_ms >= 0),
    created_ms INTEGER NOT NULL,
    updated_ms INTEGER NOT NULL,
    CHECK(state NOT IN ('publishing','completed') OR
        (checkpoint_bytes = expected_size AND actual_sha256 IS NOT NULL AND file_identity IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_native_cloud_download_scope_state
    ON native_cloud_downloads(account_id, authorized_user_id, state, updated_ms);
CREATE INDEX IF NOT EXISTS idx_native_cloud_download_dispatch
    ON native_cloud_downloads(created_ms, operation_id) WHERE state IN ('queued','running','publishing');
CREATE TRIGGER IF NOT EXISTS native_cloud_download_binding_immutable
BEFORE UPDATE OF operation_id, account_id, authorized_user_id, request_json, temp_path, output_path, expected_size
ON native_cloud_downloads BEGIN
    SELECT RAISE(ABORT, 'native_cloud_download_binding_immutable');
END;
