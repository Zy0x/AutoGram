-- Bounded Migration/Jobs scale indexes (idempotent for existing installs).
CREATE INDEX IF NOT EXISTS idx_tasks_execution_status_msg
    ON tasks(execution_id, status, source_message_id);

CREATE INDEX IF NOT EXISTS idx_executions_job_started
    ON executions(job_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_mapping_job_message
    ON message_mapping(job_id, source_msg_id);

CREATE INDEX IF NOT EXISTS idx_mapping_job_status_updated
    ON message_mapping(job_id, status, last_updated);
