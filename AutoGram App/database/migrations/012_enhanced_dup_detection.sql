-- Migration 012: Enhanced Duplicate Detection for Media Studio
-- Adds destination_scan_cache, transfer_state, transfer_audit_log
-- and extends duplicate_history with new metadata columns.
-- All statements use IF NOT EXISTS / ALTER TABLE for idempotency.

-- ─────────────────────────────────────────────────────────────────
-- 1. destination_scan_cache
--    Caches Telegram media attributes fetched during pre-scan so
--    that subsequent transfers to the same destination skip re-fetching
--    messages already seen.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS destination_scan_cache (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    target_entity_id    TEXT    NOT NULL,
    topic_id            INTEGER,                 -- NULL for non-forum destinations
    file_unique_id      TEXT,                    -- Telegram document/photo file_unique_id
    file_name           TEXT,
    file_size           INTEGER,
    media_type          TEXT    NOT NULL DEFAULT 'unknown',  -- document|photo|video|audio|voice
    fingerprint_tier    INTEGER NOT NULL DEFAULT 4,          -- 1(best)..4(fallback)
    fingerprint_hash    TEXT,                    -- primary lookup hash (tier-dependent format)
    sha256_hash         TEXT,                    -- SHA-256 of local source file (if known)
    width               INTEGER,
    height              INTEGER,
    duration            INTEGER,                 -- seconds (video/audio)
    mime_type           TEXT,
    message_id          INTEGER NOT NULL,
    sender_id           INTEGER,
    scanned_at          INTEGER NOT NULL,         -- UNIX timestamp
    verified_at         INTEGER,                 -- last deep-verify timestamp
    last_accessed       INTEGER,
    is_alive            BOOLEAN NOT NULL DEFAULT 1,
    delete_detected_at  INTEGER,
    scan_job_id         TEXT,
    UNIQUE(target_entity_id, topic_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_scan_entity_alive
    ON destination_scan_cache(target_entity_id, is_alive, verified_at);
CREATE INDEX IF NOT EXISTS idx_scan_fingerprint
    ON destination_scan_cache(target_entity_id, fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_scan_unique_id
    ON destination_scan_cache(target_entity_id, file_unique_id);
CREATE INDEX IF NOT EXISTS idx_scan_name_size
    ON destination_scan_cache(target_entity_id, file_name, file_size);
CREATE INDEX IF NOT EXISTS idx_scan_sha256
    ON destination_scan_cache(target_entity_id, sha256_hash)
    WHERE sha256_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scan_topic
    ON destination_scan_cache(target_entity_id, topic_id);

-- ─────────────────────────────────────────────────────────────────
-- 2. transfer_state
--    Full state persistence for resume capability.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfer_state (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id                  TEXT    NOT NULL UNIQUE,
    source_path             TEXT    NOT NULL,
    target_entity_id        TEXT    NOT NULL,
    target_topic_id         INTEGER,
    transfer_mode           TEXT    NOT NULL DEFAULT 'upload',
    duplicate_policy        TEXT    NOT NULL DEFAULT 'SKIP',
    scan_mode               TEXT    NOT NULL DEFAULT 'smart',   -- normal|smart|forensic
    guardrail_enabled       BOOLEAN NOT NULL DEFAULT 1,
    guardrail_threshold_days INTEGER NOT NULL DEFAULT 7,
    topic_scope             TEXT    NOT NULL DEFAULT 'selected_plus_general',
    max_reupload_per_hour   INTEGER NOT NULL DEFAULT 10,
    status                  TEXT    NOT NULL DEFAULT 'created', -- created|pre_scanning|running|paused|completed|failed|cancelled
    total_files             INTEGER NOT NULL DEFAULT 0,
    processed_files         INTEGER NOT NULL DEFAULT 0,
    skipped_files           INTEGER NOT NULL DEFAULT 0,
    reuploaded_files        INTEGER NOT NULL DEFAULT 0,
    uploaded_files          INTEGER NOT NULL DEFAULT 0,
    failed_files            INTEGER NOT NULL DEFAULT 0,
    guardrail_pending_files INTEGER NOT NULL DEFAULT 0,
    scan_index_json         TEXT,   -- JSON: {fingerprint_hash: message_id, ...}
    scan_stats_json         TEXT,   -- JSON: {recentScanned, sampledScanned, dbHits, ...}
    pending_queue_json      TEXT,   -- JSON: [file_path, ...]
    guardrail_queue_json    TEXT,   -- JSON: [{filePath, deletedAt, originalMessageId}, ...]
    completed_items_json    TEXT,   -- JSON: [{index, status, messageId, ...}, ...]
    circuit_breaker_state   TEXT,   -- closed|open|half_open
    circuit_breaker_until   INTEGER,
    created_at              INTEGER NOT NULL,
    started_at              INTEGER,
    paused_at               INTEGER,
    resumed_at              INTEGER,
    completed_at            INTEGER,
    last_activity_at        INTEGER,
    last_error              TEXT,
    error_count             INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_transfer_status
    ON transfer_state(status, last_activity_at);
CREATE INDEX IF NOT EXISTS idx_transfer_job
    ON transfer_state(job_id);

-- ─────────────────────────────────────────────────────────────────
-- 3. transfer_audit_log
--    Granular event log per-file for debugging and timeline display.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfer_audit_log (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id           TEXT    NOT NULL,
    timestamp        INTEGER NOT NULL,
    event_type       TEXT    NOT NULL, -- uploaded|skipped|reuploaded|guardrail|failed|verified|scan_complete
    file_path        TEXT,
    file_name        TEXT,
    fingerprint_hash TEXT,
    message_id       INTEGER,
    details_json     TEXT,
    FOREIGN KEY (job_id) REFERENCES transfer_state(job_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_job
    ON transfer_audit_log(job_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_event
    ON transfer_audit_log(event_type, timestamp);

-- ─────────────────────────────────────────────────────────────────
-- 4. Extend duplicate_history (add columns that may not exist yet)
--    ALTER TABLE … ADD COLUMN is idempotent-safe: wrap each in a
--    BEGIN/COMMIT and ignore "duplicate column" errors at app layer.
-- ─────────────────────────────────────────────────────────────────
-- Note: SQLite doesn't support IF NOT EXISTS for ADD COLUMN,
-- so the Python migration runner must IGNORE OperationalError on these.
ALTER TABLE duplicate_history ADD COLUMN fingerprint_hash TEXT;
ALTER TABLE duplicate_history ADD COLUMN media_type TEXT;
ALTER TABLE duplicate_history ADD COLUMN target_topic_id INTEGER;
ALTER TABLE duplicate_history ADD COLUMN deleted_from_destination BOOLEAN DEFAULT 0;
ALTER TABLE duplicate_history ADD COLUMN deleted_detected_at INTEGER;
ALTER TABLE duplicate_history ADD COLUMN first_uploaded_at INTEGER;
