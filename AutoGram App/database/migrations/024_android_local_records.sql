-- Catalog the existing Android local cache/journal; this does not add cloud execution.
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS android_drive_items (
    id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    topic_id INTEGER NOT NULL DEFAULT -1,
    parent_path TEXT NOT NULL,
    name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    delivery_kind TEXT NOT NULL DEFAULT 'document',
    telegram_category TEXT NOT NULL DEFAULT 'file',
    is_folder INTEGER NOT NULL DEFAULT 0,
    modified_ms INTEGER NOT NULL DEFAULT 0,
    thumbnail_uri TEXT,
    PRIMARY KEY(session_id, peer_id, topic_id, id)
);
CREATE INDEX IF NOT EXISTS idx_android_drive_parent
    ON android_drive_items(session_id, peer_id, topic_id, parent_path, is_folder, name);
CREATE TABLE IF NOT EXISTS android_transfer_tasks (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    source_identity TEXT NOT NULL,
    destination_identity TEXT NOT NULL,
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    processed_bytes INTEGER NOT NULL DEFAULT 0,
    speed_bps INTEGER NOT NULL DEFAULT 0,
    eta_seconds INTEGER NOT NULL DEFAULT 0,
    attempt INTEGER NOT NULL DEFAULT 0,
    paused INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    updated_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_android_transfer_state
    ON android_transfer_tasks(status, updated_ms DESC);
PRAGMA busy_timeout=5000;
