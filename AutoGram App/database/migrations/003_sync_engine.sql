-- 003 Sync Engine & Real-Time Mirroring
-- Berisi struktur untuk Sinkronisasi Waktu Nyata.

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
