from .database import get_mapping

class EnterpriseDuplicateChecker:
    def __init__(self, job_id: str):
        self.job_id = job_id
        
    def is_duplicate(self, source_chat_id: int, source_msg_id: int) -> bool:
        """
        Check if message was already migrated successfully in this job
        using the mapping table.
        """
        mapping = get_mapping(self.job_id, source_chat_id, source_msg_id)
        if mapping and mapping.get('status') in ['COMMITTED', 'VERIFIED']:
            return True
        return False
        
    def get_dest_msg_id(self, source_chat_id: int, source_msg_id: int) -> int:
        mapping = get_mapping(self.job_id, source_chat_id, source_msg_id)
        if mapping and mapping.get('status') in ['COMMITTED', 'VERIFIED']:
            return mapping.get('dest_msg_id')
        return None
