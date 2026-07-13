-- 002 Telegram Core & Duplicate Engine
-- Berisi struktur utama untuk engine migrasi Telegram.

CREATE TABLE IF NOT EXISTS migration_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_name TEXT,
    source_entity_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    transfer_mode TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS migration_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    source_message_id INTEGER NOT NULL,
    target_message_id INTEGER,
    file_unique_id TEXT,
    file_hash TEXT,
    file_name TEXT,
    file_size INTEGER,
    status TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES migration_jobs(id)
);

CREATE TABLE IF NOT EXISTS duplicate_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_unique_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    target_message_id INTEGER NOT NULL,
    UNIQUE(file_unique_id, target_entity_id)
);
