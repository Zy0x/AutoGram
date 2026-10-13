-- Durable per-item upload-file IDs and acknowledged chunk checkpoints.
BEGIN;
ALTER TABLE native_cloud_albums
    ADD COLUMN upload_file_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE native_cloud_albums
    ADD COLUMN acknowledged_parts_json TEXT NOT NULL DEFAULT '[]';
COMMIT;
