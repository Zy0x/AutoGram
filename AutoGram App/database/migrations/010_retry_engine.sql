ALTER TABLE message_mapping ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE message_mapping ADD COLUMN error_message TEXT;
ALTER TABLE message_mapping ADD COLUMN last_updated TIMESTAMP;
