-- Durable Android visual-album admission and exact send reconciliation.
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS native_cloud_albums (
    operation_id TEXT PRIMARY KEY REFERENCES transfer_runs(transfer_id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    authorized_user_id INTEGER NOT NULL CHECK(authorized_user_id > 0),
    request_json TEXT NOT NULL,
    item_count INTEGER NOT NULL CHECK(item_count BETWEEN 2 AND 10),
    state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN
        ('queued','preparing','committing','paused','review_required','completed','failed','cancelled')),
    prepared_items INTEGER NOT NULL DEFAULT 0 CHECK(prepared_items >= 0 AND prepared_items <= item_count),
    mapped_message_ids_json TEXT NOT NULL,
    grouped_id INTEGER,
    control TEXT CHECK(control IN ('pause','cancel')),
    error_code TEXT,
    receipt_json TEXT,
    created_ms INTEGER NOT NULL,
    updated_ms INTEGER NOT NULL,
    CHECK((state='completed' AND receipt_json IS NOT NULL AND grouped_id IS NOT NULL) OR state!='completed')
);
CREATE INDEX IF NOT EXISTS idx_native_cloud_albums_scope
    ON native_cloud_albums(account_id, authorized_user_id, created_ms, operation_id);
CREATE INDEX IF NOT EXISTS idx_native_cloud_albums_dispatch
    ON native_cloud_albums(state, created_ms, operation_id)
    WHERE state IN ('queued','preparing','committing');
CREATE TRIGGER IF NOT EXISTS native_cloud_album_binding_immutable
BEFORE UPDATE OF operation_id, account_id, authorized_user_id, request_json, item_count
ON native_cloud_albums BEGIN
    SELECT RAISE(ABORT, 'native_cloud_album_binding_immutable');
END;
