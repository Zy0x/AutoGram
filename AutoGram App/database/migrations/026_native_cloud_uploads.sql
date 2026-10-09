-- Account-pinned original-document execution extends the existing v4 control plane.
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS native_cloud_uploads (
    operation_id TEXT PRIMARY KEY REFERENCES transfer_runs(transfer_id),
    account_id TEXT NOT NULL,
    authorized_user_id INTEGER NOT NULL CHECK(authorized_user_id > 0),
    request_json TEXT NOT NULL,
    expected_size INTEGER NOT NULL CHECK(expected_size > 0),
    total_parts INTEGER NOT NULL CHECK(total_parts BETWEEN 1 AND 8000),
    random_id INTEGER NOT NULL CHECK(random_id != 0),
    file_id INTEGER NOT NULL CHECK(file_id != 0),
    state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN
        ('queued','running','paused','retry_wait','committing','review_required','completed','failed','cancelled')),
    acknowledged_parts INTEGER NOT NULL DEFAULT 0 CHECK(acknowledged_parts >= 0 AND acknowledged_parts <= total_parts),
    uploaded_bytes INTEGER NOT NULL DEFAULT 0 CHECK(uploaded_bytes >= 0 AND uploaded_bytes <= expected_size),
    epoch INTEGER NOT NULL DEFAULT 0 CHECK(epoch >= 0),
    control TEXT CHECK(control IN ('pause','cancel')),
    retry_not_before_ms INTEGER CHECK(retry_not_before_ms IS NULL OR retry_not_before_ms >= 0),
    error_code TEXT,
    receipt_json TEXT,
    created_ms INTEGER NOT NULL,
    updated_ms INTEGER NOT NULL,
    CHECK(state NOT IN ('committing','completed') OR
        (acknowledged_parts=total_parts AND uploaded_bytes=expected_size)),
    CHECK((state='completed' AND receipt_json IS NOT NULL) OR (state!='completed' AND receipt_json IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_native_cloud_upload_scope
ON native_cloud_uploads(account_id, authorized_user_id, created_ms, operation_id);
CREATE INDEX IF NOT EXISTS idx_native_cloud_upload_dispatch
ON native_cloud_uploads(state, retry_not_before_ms, created_ms);
CREATE TRIGGER IF NOT EXISTS native_cloud_upload_binding_immutable
BEFORE UPDATE OF operation_id, account_id, authorized_user_id, request_json, expected_size, total_parts, random_id
ON native_cloud_uploads BEGIN
    SELECT RAISE(ABORT, 'native_cloud_upload_binding_immutable');
END;
