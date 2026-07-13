import time
import random

class ChangeReport:
    def __init__(self, new_messages_detected, deleted_messages_estimate, edited_messages_estimate, latest_id_changed, confidence, new_message_count=0):
        self.new_messages_detected = new_messages_detected
        self.deleted_messages_estimate = deleted_messages_estimate
        self.edited_messages_estimate = edited_messages_estimate
        self.latest_id_changed = latest_id_changed
        self.confidence = confidence
        self.new_message_count = new_message_count
        
        self.has_changes = new_messages_detected or (deleted_messages_estimate > 0) or (edited_messages_estimate > 0)
        self.new_messages = new_message_count
        self.deleted_messages = deleted_messages_estimate
        self.edited_messages = edited_messages_estimate

class SampleResults:
    def __init__(self, missing_count, hash_mismatch_count):
        self.missing_count = missing_count
        self.hash_mismatch_count = hash_mismatch_count

class SourceChangeDetector:
    def __init__(self, api, logger=None):
        self.api = api
        self.log = logger

    def detect_changes(self, job, checkpoint):
        # 1. Get current source message count
        current_count = self.api.get_message_count(job.source_chat)
        checkpoint_count = getattr(checkpoint, 'source_message_count', current_count)

        # 2. Sample check: Check 100 random messages from processed range
        sample = getattr(checkpoint, 'get_random_sample', lambda x: [])(100)
        sample_results = self.check_sample_existence(sample)

        # 3. Check latest message ID
        latest_source = self.api.get_latest_message_id(job.source_chat)
        latest_checkpoint = getattr(checkpoint, 'latest_source_message_id', latest_source)

        return ChangeReport(
            new_messages_detected=current_count > checkpoint_count,
            new_message_count=max(0, current_count - checkpoint_count),
            deleted_messages_estimate=sample_results.missing_count,
            edited_messages_estimate=sample_results.hash_mismatch_count,
            latest_id_changed=latest_source != latest_checkpoint,
            confidence=self.calculate_confidence(sample_results)
        )

    def check_sample_existence(self, sample):
        # Placeholder for actual API checking
        missing = 0
        hash_mismatch = 0
        
        if not sample:
            return SampleResults(0, 0)
            
        # In a real scenario, we would batch fetch the message IDs
        # and compare their hashes or text.
        for msg in sample:
            try:
                pass 
            except Exception:
                missing += 1
                
        return SampleResults(missing, hash_mismatch)

    def calculate_confidence(self, sample_results):
        # A simple confidence score based on sampling
        penalty = (sample_results.missing_count + sample_results.hash_mismatch_count) * 2
        return max(0, 100 - penalty)

    def classify_changes(self, report):
        if not report.has_changes:
            return "RESUME_NORMALLY"
        if report.new_messages_detected and report.deleted_messages_estimate == 0 and report.edited_messages_estimate == 0:
            return "APPEND_NEW"
        if report.confidence >= 70:
            return "RECONCILE_GAPS"
        if report.confidence >= 30:
            return "RECOMMEND_RESCAN"
        return "ABORT_WIPED"
