CREATE TABLE IF NOT EXISTS sessions (
    name TEXT PRIMARY KEY,
    session_string TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
