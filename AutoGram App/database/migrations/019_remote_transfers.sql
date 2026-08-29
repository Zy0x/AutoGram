-- Migration 019: Remote Transfer Resumable Jobs & Events Journal
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS remote_transfer_jobs (
    job_id TEXT PRIMARY KEY,
    account_id TEXT,
    source_url TEXT NOT NULL,
    source_filename TEXT,
    source_mime TEXT,
    source_size INTEGER,
    source_etag TEXT,
    source_last_modified TEXT,
    mode TEXT NOT NULL DEFAULT 'auto',
    storage_policy TEXT NOT NULL DEFAULT 'telegram',
    custom_disk_path TEXT,
    spool_path TEXT,
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    uploaded_bytes INTEGER NOT NULL DEFAULT 0,
    checksum_sha256 TEXT,
    destination_type TEXT DEFAULT 'drive',
    destination_id TEXT,
    destination_topic_id INTEGER,
    telegram_message_id INTEGER,
    state TEXT NOT NULL DEFAULT 'queued',
    cleanup_state TEXT NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    completed_at_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_remote_transfer_jobs_state ON remote_transfer_jobs(state);
CREATE INDEX IF NOT EXISTS idx_remote_transfer_jobs_account ON remote_transfer_jobs(account_id);
CREATE INDEX IF NOT EXISTS idx_remote_transfer_jobs_updated ON remote_transfer_jobs(updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS remote_transfer_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT,
    created_at_ms INTEGER NOT NULL,
    FOREIGN KEY(job_id) REFERENCES remote_transfer_jobs(job_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_remote_transfer_events_job ON remote_transfer_events(job_id, created_at_ms ASC);
