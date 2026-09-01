-- Forwarder runtime bridge.  This migration only adds missing canonical
-- control-plane objects; legacy tables remain available through adapters.

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id INTEGER NOT NULL,
    source_message_id INTEGER NOT NULL,
    destination_message_ids_json TEXT NOT NULL DEFAULT '[]',
    stage TEXT NOT NULL DEFAULT 'QUEUED',
    status TEXT NOT NULL DEFAULT 'QUEUED',
    attempts INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT,
    reason_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(execution_id, source_message_id),
    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS message_mapping (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    source_account_id TEXT NOT NULL DEFAULT '',
    source_chat_id TEXT NOT NULL,
    source_msg_id INTEGER NOT NULL,
    destination_account_id TEXT NOT NULL DEFAULT '',
    dest_chat_id TEXT NOT NULL,
    dest_msg_id INTEGER NOT NULL,
    topic_id INTEGER,
    album_id TEXT,
    reply_to_source_msg_id INTEGER,
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    reason_code TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    last_updated TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_account_id, source_chat_id, source_msg_id, destination_account_id, dest_chat_id, topic_id)
);

CREATE TABLE IF NOT EXISTS automation_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    rrule TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    misfire_policy TEXT NOT NULL DEFAULT 'one_catch_up',
    next_run_at TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(job_id),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS forwarder_event_sequences (
    job_id INTEGER PRIMARY KEY,
    next_sequence INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_execution_status ON tasks(execution_id, status, source_message_id);
CREATE INDEX IF NOT EXISTS idx_mapping_forwarder_scope ON message_mapping(destination_account_id, dest_chat_id, topic_id, source_msg_id);
CREATE INDEX IF NOT EXISTS idx_automation_schedules_next_run ON automation_schedules(enabled, next_run_at);
