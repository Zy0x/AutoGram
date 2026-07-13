import time
from collections import deque

class RequestRecord:
    def __init__(self, request_type, timestamp):
        self.request_type = request_type
        self.timestamp = timestamp

class PredictiveFloodWaitManager:
    def __init__(self, logger=None):
        self.pressure_history = deque(maxlen=1000)  # Last 1000 requests
        self.pressure_threshold = 0.7  # 70% of limit
        self.cooldown_prediction = 300  # Predict FloodWait 5 min early
        self.log = logger

    def before_request(self, session, request_type):
        # Return True if request should proceed, False if should delay
        
        # Calculate current pressure score
        current_time = time.time()
        recent_requests = sum(1 for r in self.pressure_history 
                              if r.timestamp > current_time - 60 and r.request_type == request_type)
                              
        limit = self.get_limit_for(request_type)
        pressure = recent_requests / limit if limit > 0 else 0

        if pressure > self.pressure_threshold:
            # Predict FloodWait imminent
            predicted_wait = self.predict_wait_time(pressure)
            if self.log:
                self.log.warning("Predicted FloodWait in %ds. Pre-emptive pause." % predicted_wait)

            # Pre-emptive pause
            if hasattr(session, 'preemptive_pause'):
                session.preemptive_pause(seconds=predicted_wait * 0.5)
            return False

        # Add to history
        self.pressure_history.append(RequestRecord(request_type, current_time))
        return True

    def predict_wait_time(self, pressure):
        # Simplistic prediction logic based on pressure
        base_wait = 300
        return int(base_wait * pressure)

    def get_limit_for(self, request_type):
        limits = {
            "send_message": 20,      # 20/min per chat
            "send_media": 10,        # 10/min per chat
            "get_message": 100,      # 100/min per chat
            "download_file": 30,     # 30/min per session
            "refresh_reference": 10, # 10/min per session
        }
        return limits.get(request_type, 20)

class NoHealthySessionError(Exception):
    pass

class SessionBalancer:
    def select_session(self, task, sessions):
        # Select healthiest session with lowest pressure

        # Filter healthy sessions
        healthy = [s for s in sessions if getattr(s, 'health_score', 100) > 20]

        if not healthy:
            raise NoHealthySessionError("All sessions quarantined")

        # Score by: health (60%), pressure (30%), recency (10%)
        def score(session):
            health = getattr(session, 'health_score', 100)
            pressure = getattr(session, 'pressure_score', 0)
            recency = getattr(session, 'time_since_last_use', 0)
            
            return (
                health * 0.6 +
                (100 - pressure) * 0.3 +
                recency * 0.1
            )

        return max(healthy, key=score)
