import json
import time
import sys
import uuid

class ExecutionFSM:
    """Finite State Machine for Execution State Validation"""
    
    VALID_TRANSITIONS = {
        'READY': ['STARTING', 'CANCELLED'],
        'STARTING': ['RUNNING', 'FAILED', 'CANCELLED'],
        'RUNNING': ['PAUSING', 'STOPPING', 'COMPLETED', 'PARTIAL_SUCCESS', 'FAILED'],
        'PAUSING': ['PAUSED', 'STOPPING', 'FAILED'],
        'PAUSED': ['RESUMING', 'STOPPING', 'CANCELLED'],
        'RESUMING': ['RUNNING', 'FAILED'],
        'STOPPING': ['STOPPED', 'FAILED'],
        'STOPPED': ['RECOVERING'], # If user clicks Retry from Stopped
        'RECOVERING': ['RUNNING', 'FAILED'],
        'COMPLETED': [], # Terminal
        'PARTIAL_SUCCESS': ['RECOVERING'], # If user retries failed tasks
        'FAILED': ['RECOVERING'],
        'CANCELLED': [] # Terminal
    }

    @classmethod
    def can_transition(cls, from_state, to_state):
        if from_state not in cls.VALID_TRANSITIONS:
            return False
        return to_state in cls.VALID_TRANSITIONS[from_state]
        
    @classmethod
    def require_transition(cls, from_state, to_state):
        if not cls.can_transition(from_state, to_state):
            raise ValueError(f"Illegal state transition from {from_state} to {to_state}")

class EventEmitter:
    """Structured Event Emitter ensuring deterministic ordering and metadata"""
    
    def __init__(self, execution_id=None, job_id=None):
        self.execution_id = execution_id
        self.job_id = job_id
        self.sequence = 0
        self.version = "1.0"
        
    def emit(self, event_type, **payload):
        """Emit a structured event to stdout"""
        self.sequence += 1
        
        event = {
            "version": self.version,
            "eventId": str(uuid.uuid4()),
            "sequence": self.sequence,
            "timestamp": int(time.time() * 1000),
            "type": event_type,
            "executionId": self.execution_id,
            "jobId": self.job_id,
            "payload": payload
        }
        
        try:
            line = json.dumps(event, default=str, ensure_ascii=False)
        except Exception:
            line = json.dumps({
                "type": event_type,
                "payload": {"error": "event_serialization_failed"},
                "executionId": self.execution_id,
                "jobId": self.job_id,
            }, default=str)
        try:
            from engine.utf8_io import write_line
            write_line(f"[EVENT] {line}")
        except Exception:
            try:
                print(f"[EVENT] {line}", flush=True)
            except Exception:
                try:
                    sys.stdout.buffer.write(f"[EVENT] {line}\n".encode("utf-8", errors="replace"))
                    sys.stdout.buffer.flush()
                except Exception:
                    pass
        return event

# Global instance initialized during execute-job
_global_emitter = EventEmitter()

def setup_emitter(execution_id, job_id):
    global _global_emitter
    _global_emitter = EventEmitter(execution_id, job_id)

def emit_event(event_type, **payload):
    return _global_emitter.emit(event_type, **payload)
