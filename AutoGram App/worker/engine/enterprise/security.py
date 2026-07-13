import time
import random
from datetime import datetime

class SessionRotator:
    def __init__(self, sessions_pool=None):
        self.rotation_interval = 86400  # 24 hours
        self.sessions = sessions_pool or []  # Pool of pre-warmed sessions

    def should_rotate(self, session):
        # We assume session has a created_at or started_at property
        started_at = getattr(session, 'started_at', time.time())
        return time.time() - started_at > self.rotation_interval

    def rotate(self, current, logger=None):
        # Gradually transition: new session takes over new tasks
        # Old session finishes in-progress tasks, then retired
        new_session = self.get_healthy_unused()
        
        if not new_session:
            if logger:
                logger.warning("No healthy unused session available for rotation.")
            return current

        # Mark current as "finishing"
        current.status = "FINISHING"
        current.no_new_tasks = True

        # New session marked as active
        new_session.status = "ACTIVE"
        new_session.started_at = time.time()

        if logger:
            logger.info("Session rotated: %s -> %s" % (getattr(current, 'id', 'old'), getattr(new_session, 'id', 'new')))
            
        return new_session
        
    def get_healthy_unused(self):
        healthy = [s for s in self.sessions if getattr(s, 'status', 'UNUSED') == 'UNUSED' and getattr(s, 'health_score', 100) > 50]
        return healthy[0] if healthy else None

class SleepWindow:
    def __init__(self, start, end, probability):
        self.start = start
        self.end = end
        self.probability = probability

    def contains(self, t):
        # Time format "HH:MM"
        start_t = datetime.strptime(self.start, "%H:%M").time()
        end_t = datetime.strptime(self.end, "%H:%M").time()
        
        if start_t <= end_t:
            return start_t <= t <= end_t
        else:
            return start_t <= t or t <= end_t

class BehavioralMimicry:
    def __init__(self):
        self.sleep_schedule = self.generate_human_schedule()

    def generate_human_schedule(self):
        # Generate realistic sleep windows
        return [
            SleepWindow(start="00:00", end="07:00", probability=0.9),  # Night sleep
            SleepWindow(start="12:00", end="13:00", probability=0.5),  # Lunch
            SleepWindow(start="18:00", end="19:00", probability=0.3),  # Dinner
        ]

    def should_sleep(self):
        # Return sleep duration if engine should pause, None otherwise
        now = datetime.now().time()
        for window in self.sleep_schedule:
            if window.contains(now) and random.random() < window.probability:
                return random.randint(1800, 7200)  # 30 min - 2 hours
        return None
