import time

class PredictiveFileReferenceManager:
    def __init__(self, api, db, logger=None):
        self.api = api
        self.db = db
        self.log = logger
        self.refresh_threshold = 3600  # 1 hour before expiry
        self.batch_size = 100          # Refresh 100 at a time
        self.refresh_interval = 300    # Every 5 minutes during pause

    def during_pause_maintenance(self, job):
        # Background task that runs even while paused
        while job.status == "PAUSED":
            # Find references expiring within threshold
            expiring = self.db.get_expiring_references(
                threshold=self.refresh_threshold,
                limit=self.batch_size
            )

            if expiring:
                # Refresh in small batches to avoid FloodWait
                for i in range(0, len(expiring), 10):
                    batch = expiring[i:i+10]
                    self.refresh_batch(batch)
                    time.sleep(30)  # Gentle pacing

            time.sleep(self.refresh_interval)

    def refresh_batch(self, batch):
        for ref in batch:
            try:
                fresh = self.api.refresh_file_reference(ref.file_id)
                self.db.update_reference(ref.file_id, fresh)
                if self.log:
                    self.log.info("Refreshed %s" % ref.file_id)
            except Exception as e:
                # Simplification: Assume FloodWait has a retry_after attribute if it's a flood wait
                if hasattr(e, 'retry_after'):
                    if self.log:
                        self.log.warning("FloodWait on refresh: %ds" % e.retry_after)
                    time.sleep(e.retry_after)
                else:
                    if self.log:
                        self.log.error("Failed to refresh %s: %s" % (ref.file_id, e))
                    # Mark for re-download on resume
                    self.db.mark_for_redownload(ref.file_id)

def validate_references_on_resume(job, refresh_reference_func):
    # Before resuming, validate all cached references
    invalid_count = 0
    refreshed_count = 0
    redownload_count = 0

    # Check references for pending messages only (not already sent)
    pending_refs = getattr(job, 'get_pending_references', lambda: [])()

    for ref in pending_refs:
        if getattr(ref, 'is_expired', False):
            try:
                fresh = refresh_reference_func(ref.file_id)
                refreshed_count += 1
            except Exception:
                invalid_count += 1
                redownload_count += 1
                getattr(job, 'mark_for_redownload', lambda x: None)(ref.sequence_id)

    return {
        'total_checked': len(pending_refs),
        'refreshed': refreshed_count,
        'invalid': invalid_count,
        'marked_for_redownload': redownload_count
    }
