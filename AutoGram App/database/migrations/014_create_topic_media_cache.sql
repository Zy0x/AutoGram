-- Migration 014: Topic Media Cache with Strict Composite Isolation
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS topic_media_items (
    account_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    topic_id INTEGER NOT NULL DEFAULT 0,
    message_id INTEGER NOT NULL,

    message_date INTEGER NOT NULL,
    edit_date INTEGER,
    grouped_id INTEGER,

    sender_id TEXT,
    caption TEXT,

    media_type TEXT NOT NULL,
    mime_type TEXT,
    file_name TEXT,
    file_size INTEGER NOT NULL DEFAULT 0,

    document_id INTEGER,
    access_hash INTEGER,
    dc_id INTEGER,
    file_reference BLOB,

    width INTEGER,
    height INTEGER,
    duration_ms INTEGER,

    has_server_thumb INTEGER NOT NULL DEFAULT 0,
    has_video_thumb INTEGER NOT NULL DEFAULT 0,

    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    PRIMARY KEY (
        account_id,
        peer_id,
        topic_id,
        message_id
    )
);

CREATE INDEX IF NOT EXISTS idx_topic_media_items_page
ON topic_media_items (
    account_id,
    peer_id,
    topic_id,
    message_date DESC,
    message_id DESC
)
WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_topic_media_items_type
ON topic_media_items (
    account_id,
    peer_id,
    topic_id,
    media_type,
    message_date DESC,
    message_id DESC
)
WHERE is_deleted = 0;

CREATE INDEX IF NOT EXISTS idx_topic_media_items_document
ON topic_media_items (
    account_id,
    dc_id,
    document_id
)
WHERE document_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS topic_media_thumbnails (
    account_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    topic_id INTEGER NOT NULL DEFAULT 0,
    message_id INTEGER NOT NULL,

    variant TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,

    width INTEGER,
    height INTEGER,
    local_path TEXT,
    byte_size INTEGER NOT NULL DEFAULT 0,
    source_bytes_used INTEGER NOT NULL DEFAULT 0,

    source_fingerprint TEXT,
    extractor_version INTEGER NOT NULL DEFAULT 1,
    failure_code TEXT,

    generated_at INTEGER,
    last_accessed_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    PRIMARY KEY (
        account_id,
        peer_id,
        topic_id,
        message_id,
        variant
    ),

    FOREIGN KEY (
        account_id,
        peer_id,
        topic_id,
        message_id
    )
    REFERENCES topic_media_items (
        account_id,
        peer_id,
        topic_id,
        message_id
    )
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_topic_media_thumbnails_lru
ON topic_media_thumbnails (
    account_id,
    last_accessed_at ASC
);

CREATE TABLE IF NOT EXISTS topic_media_sync_state (
    account_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    topic_id INTEGER NOT NULL DEFAULT 0,
    filter_key TEXT NOT NULL,

    newest_message_id INTEGER,
    oldest_message_id INTEGER,
    last_reconciled_at INTEGER,
    cache_version INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,

    PRIMARY KEY (
        account_id,
        peer_id,
        topic_id,
        filter_key
    )
);

CREATE TABLE IF NOT EXISTS topic_media_downloads (
    account_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    topic_id INTEGER NOT NULL DEFAULT 0,
    message_id INTEGER NOT NULL,

    status TEXT NOT NULL,
    priority INTEGER NOT NULL,
    total_size INTEGER NOT NULL DEFAULT 0,
    downloaded_size INTEGER NOT NULL DEFAULT 0,

    temp_path TEXT,
    final_path TEXT,
    range_map_path TEXT,

    error_code TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    PRIMARY KEY (
        account_id,
        peer_id,
        topic_id,
        message_id
    )
);

PRAGMA user_version = 14;
