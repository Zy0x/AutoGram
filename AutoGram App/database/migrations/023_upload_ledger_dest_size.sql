-- Migration 023: Add candidate size lookup index for upload ledger deduplication preflight
PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_upload_ledger_dest_size
    ON upload_ledger(account_id, destination_id, topic_id, file_size);
