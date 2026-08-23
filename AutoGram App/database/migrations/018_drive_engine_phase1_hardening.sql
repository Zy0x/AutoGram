PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS drive_beta_accounts (
    account_id TEXT PRIMARY KEY,
    display_name TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_drive_beta_accounts_active
ON drive_beta_accounts(last_seen_at DESC)
WHERE revoked_at IS NULL;

INSERT INTO drive_beta_schema(component, version, applied_at)
VALUES('system', 2, unixepoch('subsec') * 1000)
ON CONFLICT(component) DO UPDATE SET
    version = MAX(version, excluded.version),
    applied_at = excluded.applied_at;
