from enum import Enum
from typing import Tuple, Dict, Any
from .database import (
    get_min_failed_msg_id,
    get_min_pending_msg_id,
    get_max_verified_msg_id,
    get_mapping_by_msg_id
)

class Action(Enum):
    PROCESS = "PROCESS"
    SKIP = "SKIP"
    RETRY = "RETRY"
    WAIT = "WAIT"

class RetryScanner:
    def __init__(self, job_id: str, max_retries: int = 3):
        self.job_id = job_id
        self.max_retries = max_retries
        
    def get_retry_range(self) -> Tuple[int, int]:
        """
        Determines the optimal start point (offset_id) to skip verified messages.
        Returns a tuple: (start_msg_id, end_msg_id)
        """
        min_failed = get_min_failed_msg_id(self.job_id)
        min_pending = get_min_pending_msg_id(self.job_id)
        
        # If there are no failed and no pending, we don't have to start from the beginning
        # We start right after max_verified
        if min_failed is None and min_pending is None:
            max_verified = get_max_verified_msg_id(self.job_id)
            return max_verified, float('inf')
            
        start_id = min(
            min_failed or float('inf'),
            min_pending or float('inf')
        )
        
        if start_id == float('inf'):
            start_id = 0
            
        return int(start_id), float('inf')
        
    def scan_message(self, source_msg_id: int) -> Action:
        """
        Evaluates a single message id to determine what action to take.
        """
        mapping = get_mapping_by_msg_id(self.job_id, source_msg_id)
        if not mapping:
            return Action.PROCESS
            
        status = mapping.get('status')
        retry_count = mapping.get('retry_count', 0)
        
        if status in ['VERIFIED', 'COMMITTED']:
            return Action.SKIP
            
        if status == 'IN_PROGRESS':
            # This is handled by RetryScheduler which checks stalled jobs
            return Action.WAIT
            
        if status == 'FAILED':
            if retry_count >= self.max_retries:
                return Action.SKIP # Max retries reached
            return Action.RETRY
            
        if status == 'PENDING':
            return Action.PROCESS
            
        return Action.PROCESS
