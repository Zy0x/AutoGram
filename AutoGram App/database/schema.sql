-- AutoGram SQLite Database Schema

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    master_password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    session_file_path TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1
);

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

CREATE TABLE IF NOT EXISTS duplicate_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_unique_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    target_message_id INTEGER NOT NULL,
    UNIQUE(file_unique_id, target_entity_id)
);

CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    log_level TEXT NOT NULL, -- 'INFO', 'WARNING', 'ERROR'
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sync Engine & Real-Time Mirroring
CREATE TABLE IF NOT EXISTS sync_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_name TEXT,
    source_entity_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    last_processed_msg_id INTEGER DEFAULT 0,
    status TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS message_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_chat_id TEXT NOT NULL,
    source_message_id INTEGER NOT NULL,
    dest_chat_id TEXT NOT NULL,
    dest_message_id INTEGER NOT NULL,
    is_deleted BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_chat_id, source_message_id)
);

CREATE INDEX IF NOT EXISTS idx_message_mappings_source ON message_mappings(source_chat_id, source_message_id);

-- Profiles & Automations
CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    session_file_path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1
);

CREATE TABLE IF NOT EXISTS automations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    schedule_cron TEXT,
    action_type TEXT NOT NULL,
    config_json TEXT NOT NULL,
    status TEXT NOT NULL,
    last_run DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Fast Forward Mode
CREATE TABLE IF NOT EXISTS fast_forward_checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id INTEGER NOT NULL,
    checkpoint_data_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(execution_id) REFERENCES executions(id) ON DELETE CASCADE
);
