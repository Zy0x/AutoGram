-- 007 Redesign Execution Engine (State Machine Architecture)
-- Drops legacy tables and creates the new 3-tier architecture (Job -> Execution -> Task)

DROP TABLE IF EXISTS migration_items;
DROP TABLE IF EXISTS migration_jobs;

CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    profile_name TEXT,
    source_entity_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    transfer_mode TEXT NOT NULL,
    config_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    snapshot_config_json TEXT NOT NULL,
    status TEXT NOT NULL, -- READY, STARTING, RUNNING, PAUSING, PAUSED, RESUMING, STOPPING, STOPPED, COMPLETED, PARTIAL_SUCCESS, FAILED, CANCELLED, RECOVERING
    total_messages INTEGER DEFAULT 0,
    processed_messages INTEGER DEFAULT 0,
    last_processed_id INTEGER DEFAULT 0,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    error_message TEXT,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id INTEGER NOT NULL,
    source_message_id INTEGER NOT NULL,
    target_message_id INTEGER,
    file_unique_id TEXT,
    file_hash TEXT,
    file_name TEXT,
    file_size INTEGER,
    status TEXT NOT NULL, -- DONE, FAILED, SKIPPED, RUNNING
    error_category TEXT,
    error_message TEXT,
    attempts INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(execution_id) REFERENCES executions(id) ON DELETE CASCADE
);
