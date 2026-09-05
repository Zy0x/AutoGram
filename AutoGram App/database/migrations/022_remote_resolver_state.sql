-- Migration 022: Persist resumable, privacy-safe remote resolver discovery state.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS remote_transfer_resolver_state (
    job_id                    TEXT PRIMARY KEY,
    resolver_version          INTEGER NOT NULL DEFAULT 1,
    source_final_url          TEXT NOT NULL,
    provenance_json           TEXT NOT NULL DEFAULT '{}',
    discovery_cursor_json     TEXT,
    expires_at_ms             INTEGER,
    updated_at_ms             INTEGER NOT NULL,
    FOREIGN KEY(job_id) REFERENCES remote_transfer_jobs(job_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_remote_transfer_resolver_state_expiry
    ON remote_transfer_resolver_state(expires_at_ms);
