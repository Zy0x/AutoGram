import time

class SourceWatcher:
    def __init__(self, detector, notifier, check_interval=3600, logger=None):
        self.check_interval = check_interval  # Check every hour while paused
        self.change_callbacks = []
        self.detector = detector
        self.notifier = notifier
        self.log = logger
        self.db = None # Inject later

    def watch(self, job):
        # Background thread that runs during pause
        while job.status == "PAUSED":
            try:
                # We need a checkpoint to compare against
                checkpoint = getattr(job, 'last_checkpoint', None)
                if not checkpoint:
                    time.sleep(self.check_interval)
                    continue
                    
                changes = self.detector.detect_changes(job, checkpoint)
                if changes.has_changes:
                    self.notify_user(job, changes)
                    # Pre-compute delta for faster resume
                    self.precompute_delta(job, changes)

                time.sleep(self.check_interval)
            except Exception as e:
                if self.log:
                    self.log.error("Source watch error: %s" % e)
                time.sleep(self.check_interval * 2)  # Back off on error

    def notify_user(self, job, changes):
        # Send desktop notification if significant changes detected
        if changes.new_messages > 100 or changes.deleted_messages > 50:
            title = "AutoGram: Source '%s' changed" % getattr(job, 'source_name', 'Unknown')
            body = "%d new, %d deleted. Ready to resume." % (changes.new_messages, changes.deleted_messages)
            if self.notifier:
                self.notifier.desktop_notify(title=title, body=body)

    def precompute_delta(self, job, changes):
        # While paused, pre-compute merge operations
        # 1. Identify new messages that need processing
        new_tasks = self.create_tasks_for_new_messages(changes.new_messages)

        # 2. Identify edited messages that need decision
        edited_tasks = self.create_decision_queue(changes.edited_messages)

        # 3. Pre-validate File References for new messages
        for task in new_tasks:
            if getattr(task, 'has_media', False):
                task.file_reference_status = self.validate_reference(task.file_id)

        # 4. Store pre-computed plan
        if self.db:
            self.db.store_precomputed_plan(job.id, {
                "new_tasks_count": len(new_tasks),
                "edited_tasks_count": len(edited_tasks),
                "ready_at": time.time()
            })

        if self.log:
            self.log.info("Pre-computed delta for job %s: %d new, %d edited" % (job.id, len(new_tasks), len(edited_tasks)))

    def create_tasks_for_new_messages(self, count):
        return [type('Task', (), {'has_media': False})() for _ in range(count)]
        
    def create_decision_queue(self, count):
        return [type('Task', (), {})() for _ in range(count)]
        
    def validate_reference(self, file_id):
        return "VALID"
