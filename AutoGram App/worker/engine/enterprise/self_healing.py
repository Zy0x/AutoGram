import time

class HealingAction:
    RETRY = "RETRY"
    SKIP = "SKIP"
    PAUSE = "PAUSE"
    STOP = "STOP"

class SelfHealingEngine:
    def __init__(self, scheduler, engine, notifier):
        self.scheduler = scheduler
        self.engine = engine
        self.notifier = notifier

    def handle_error(self, error, task):
        strategy = self.classify_error(error)

        if strategy == "AUTO_RETRY":
            return self.schedule_retry(task, delay=self.exponential_backoff(task.retry_count))

        elif strategy == "REFRESH_AND_RETRY":
            self.refresh_reference(task.file_id)
            return self.schedule_retry(task, delay=5)

        elif strategy == "REDOWNLOAD":
            task.mark_for_redownload()
            return self.schedule_retry(task, delay=0)

        elif strategy == "SKIP_WITH_LOG":
            task.mark_skipped(reason=str(error))
            return HealingAction.SKIP

        elif strategy == "FALLBACK_MODE":
            self.scheduler.downgrade_to_safe_mode()
            return self.schedule_retry(task, delay=60)

        elif strategy == "PAUSE_AND_ALERT":
            self.engine.pause()
            self.notifier.send_alert(error, task)
            return HealingAction.PAUSE

        elif strategy == "EMERGENCY_STOP":
            self.engine.emergency_stop()
            self.notifier.send_critical_alert(error, task)
            return HealingAction.STOP

    def classify_error(self, error):
        error_str = str(error).lower()
        if "timeout" in error_str or "network" in error_str:
            return "AUTO_RETRY"
        if "floodwait" in error_str:
            wait_time = getattr(error, 'retry_after', 0)
            if wait_time < 300:
                return "AUTO_RETRY"
            else:
                return "PAUSE_AND_ALERT"
        if "expired" in error_str or "file_reference" in error_str:
            return "REFRESH_AND_RETRY"
        if "too large" in error_str or "unsupported" in error_str:
            return "SKIP_WITH_LOG"
        if "deleted" in error_str:
            return "SKIP_WITH_LOG"
        if "restricted" in error_str or "forbidden" in error_str:
            return "FALLBACK_MODE"
        if "banned" in error_str or "disk full" in error_str or "corrupt" in error_str:
            return "EMERGENCY_STOP"
            
        return "PAUSE_AND_ALERT" # default

    def exponential_backoff(self, retry_count):
        return min(300, (2 ** retry_count) + (time.time() % 1))

    def schedule_retry(self, task, delay):
        task.retry_count += 1
        task.next_retry_at = time.time() + delay
        return HealingAction.RETRY

    def refresh_reference(self, file_id):
        # Implementation for refreshing reference
        pass
