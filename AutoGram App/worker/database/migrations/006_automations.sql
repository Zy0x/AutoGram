CREATE TABLE IF NOT EXISTS automation_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    profile_id INTEGER, -- Bisa null jika menggunakan session string
    session_name TEXT,
    source_entity_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    cron_expression TEXT, -- Kosong jika real-time sync
    is_realtime BOOLEAN DEFAULT 0,
    config_json TEXT, -- Opsi-opsi lain
    status TEXT DEFAULT 'active', -- active, paused
    last_run_at TIMESTAMP,
    next_run_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
