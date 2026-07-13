from typing import List, Dict, Set
from .types import TransferTask
import logging

class OrderedCommitScheduler:
    def __init__(self, start_sequence_id=1):
        self.next_expected_sequence = start_sequence_id
        self.ready_buffer: Dict[int, TransferTask] = {}
        self.committed_sequences: Set[int] = set()
        
    def add_to_ready_buffer(self, task: TransferTask):
        self.ready_buffer[task.sequence_id] = task
        
    def get_committable_tasks(self) -> List[TransferTask]:
        committable = []
        
        while self.next_expected_sequence in self.ready_buffer:
            task = self.ready_buffer[self.next_expected_sequence]
            
            # Check dependencies
            deps_met = True
            for dep in task.dependencies:
                if dep.target_sequence_id not in self.committed_sequences:
                    deps_met = False
                    break
                    
            if deps_met:
                committable.append(task)
                self.ready_buffer.pop(self.next_expected_sequence)
                self.next_expected_sequence += 1
            else:
                # Still waiting for dependency (though it should be monotonic)
                # If monotonic, it shouldn't be waiting for a higher seq id,
                # but if it's waiting for a lower one that failed, we could have a problem.
                # However, since we only increment next_expected_sequence when ALL lower ones are committed,
                # if this is the next_expected_sequence, all lower ones MUST be in committed_sequences.
                # Therefore deps_met should logically always be True if sequence is monotonic.
                break
                
        return committable
        
    def mark_committed(self, sequence_id: int):
        self.committed_sequences.add(sequence_id)
        
    def get_pending_count(self):
        return len(self.ready_buffer)
