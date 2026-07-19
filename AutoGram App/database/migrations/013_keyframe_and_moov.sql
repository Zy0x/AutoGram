-- Migration 013: Keyframe byte index and persistent moov sidecar cache
CREATE TABLE IF NOT EXISTS keyframe_index (
    file_id TEXT NOT NULL,
    timestamp_ms INTEGER NOT NULL,
    byte_offset INTEGER NOT NULL,
    PRIMARY KEY (file_id, timestamp_ms)
);
CREATE INDEX IF NOT EXISTS idx_keyframe_lookup ON keyframe_index(file_id, byte_offset);

CREATE TABLE IF NOT EXISTS moov_sidecar (
    file_id TEXT NOT NULL PRIMARY KEY,
    sidecar_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
