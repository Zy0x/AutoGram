-- Bounded recovery of explicitly rejected temporary upload allocations.
-- Additive and repeatable; never changes immutable send IDs or user sessions.
CREATE TABLE IF NOT EXISTS native_cloud_upload_recovery (
    operation_id TEXT PRIMARY KEY REFERENCES native_cloud_uploads(operation_id),
    part_restarts INTEGER NOT NULL DEFAULT 0 CHECK(part_restarts BETWEEN 0 AND 3),
    updated_ms INTEGER NOT NULL
);
