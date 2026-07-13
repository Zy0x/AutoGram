CREATE TABLE IF NOT EXISTS message_mapping (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id          TEXT NOT NULL,
    source_chat_id  BIGINT NOT NULL,
    source_msg_id   BIGINT NOT NULL,
    dest_chat_id    BIGINT NOT NULL,
    dest_msg_id     BIGINT NOT NULL,
    sequence_id     BIGINT NOT NULL,
    quality_mode    TEXT NOT NULL,  -- ORIGINAL, HIGH_QUALITY, SMART
    file_checksum   TEXT,           -- SHA-256 for ORIGINAL mode
    file_size       BIGINT,
    filename        TEXT,
    status          TEXT NOT NULL,  -- PENDING, COMMITTED, VERIFIED, FAILED
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    verified_at     TIMESTAMP,
    UNIQUE(source_chat_id, source_msg_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_mapping_source ON message_mapping(source_chat_id, source_msg_id);
CREATE INDEX IF NOT EXISTS idx_mapping_dest ON message_mapping(dest_chat_id, dest_msg_id);
CREATE INDEX IF NOT EXISTS idx_mapping_sequence ON message_mapping(sequence_id);
CREATE INDEX IF NOT EXISTS idx_mapping_status ON message_mapping(status);
