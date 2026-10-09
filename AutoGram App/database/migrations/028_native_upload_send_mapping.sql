-- Exact server random-ID mappings survive a lost receipt or process stop.
CREATE TABLE IF NOT EXISTS native_cloud_upload_send_mapping (
    operation_id TEXT PRIMARY KEY REFERENCES native_cloud_uploads(operation_id),
    random_id INTEGER NOT NULL CHECK(random_id != 0),
    message_id INTEGER NOT NULL CHECK(message_id > 0),
    epoch INTEGER NOT NULL CHECK(epoch >= 0),
    created_ms INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS native_cloud_upload_send_mapping_immutable
BEFORE UPDATE ON native_cloud_upload_send_mapping BEGIN
    SELECT RAISE(ABORT, 'native_cloud_upload_send_mapping_immutable');
END;
