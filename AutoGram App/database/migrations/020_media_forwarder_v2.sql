-- Media Forwarder V2 canonical control-plane extensions.
-- This migration is additive and safe to replay.

CREATE TABLE IF NOT EXISTS forwarder_job_configs (
    job_id INTEGER PRIMARY KEY,
    schema_version INTEGER NOT NULL DEFAULT 2,
    revision INTEGER NOT NULL DEFAULT 0,
    config_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS forwarder_dedupe_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    source_account_id TEXT NOT NULL,
    destination_account_id TEXT NOT NULL,
    destination_peer_id TEXT NOT NULL,
    destination_topic_id INTEGER,
    source_message_id INTEGER NOT NULL,
    destination_message_id INTEGER,
    telegram_unique_id TEXT,
    sha256 TEXT,
    filename TEXT,
    byte_size INTEGER,
    decision TEXT NOT NULL DEFAULT 'transferred',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(job_id, source_account_id, destination_account_id, destination_peer_id, destination_topic_id, source_message_id),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS job_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    config_json TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'local',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(job_id, revision),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mirror_cursors (
    job_id INTEGER PRIMARY KEY,
    pts INTEGER,
    event_cursor TEXT,
    reconcile_state TEXT NOT NULL DEFAULT 'idle',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
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
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE SET NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
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
    next_attempt_at TEXT,
    delivered_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(channel, dedupe_key),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS retention_markers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    retention_until TEXT NOT NULL,
    export_reference TEXT,
    purged_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_forwarder_job_configs_revision
    ON forwarder_job_configs(revision);
CREATE INDEX IF NOT EXISTS idx_forwarder_dedupe_scope
    ON forwarder_dedupe_ledger(destination_account_id, destination_peer_id, destination_topic_id, sha256);
CREATE INDEX IF NOT EXISTS idx_job_revisions_job_revision
    ON job_revisions(job_id, revision DESC);
CREATE INDEX IF NOT EXISTS idx_decision_inbox_job_status
    ON decision_inbox(job_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_status
    ON notification_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_retention_markers_due
    ON retention_markers(retention_until, purged_at);
