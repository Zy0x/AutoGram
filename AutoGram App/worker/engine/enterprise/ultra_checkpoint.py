import time
import uuid
import json

class UltraScaleCheckpointWriter:
    def __init__(self, memory_store=None, cloud_backup=None, disk_path="checkpoints"):
        self.tiers = {
            "memory": {"interval": 30, "ttl": 300},      # Every 30s, keep 5 min
            "disk": {"interval": 300, "ttl": 86400},     # Every 5 min, keep 24h
            "cloud": {"interval": 3600, "ttl": 2592000}, # Every hour, keep 30 days
        }
        self.memory_store = memory_store or {}
        self.cloud_backup = cloud_backup
        self.disk_path = disk_path

    def write_checkpoint(self, job, tier):
        import time
        checkpoint = {
            "job_id": job.id,
            "timestamp": time.time(),
            "last_committed_sequence": getattr(job, 'last_committed', 0),
            "mapping_table_checksum": getattr(job, 'mapping_checksum', lambda: '0')(),
            "resume_token": str(uuid.uuid4()),
            "worker_states": [getattr(w, 'state', 'IDLE') for w in getattr(job, 'workers', [])],
            "queue_snapshot": getattr(getattr(job, 'queue', None), 'snapshot', lambda: [])(),
            "source_fingerprint": getattr(getattr(job, 'source', None), 'get_fingerprint', lambda: 'N/A')(),
            "pending_references": [ref.file_id for ref in getattr(job, 'get_pending_references', lambda: [])()],
            "version": "4.0"
        }

        if tier == "memory":
            self.memory_store[job.id] = checkpoint
        elif tier == "disk":
            import os
            os.makedirs(self.disk_path, exist_ok=True)
            path = os.path.join(self.disk_path, f"{job.id}.json")
            # Write to temporary file first then rename for atomic write
            temp_path = f"{path}.tmp"
            with open(temp_path, 'w') as f:
                json.dump(checkpoint, f)
            os.replace(temp_path, path)
        elif tier == "cloud" and self.cloud_backup:
            self.cloud_backup.upload(f"checkpoints/{job.id}/{int(time.time())}.json", checkpoint)


class CheckpointRecovery:
    def __init__(self, db, writer=None):
        self.db = db
        self.writer = writer or UltraScaleCheckpointWriter()

    def recover(self, job_id, logger=None):
        # Try tiers in order: memory -> disk -> cloud
        for tier in ["memory", "disk", "cloud"]:
            checkpoint = self.try_load(tier, job_id)
            if checkpoint and self.validate_checksum(checkpoint):
                if logger:
                    logger.info("Recovered checkpoint from %s" % tier)
                return checkpoint

        # All tiers failed — attempt reconstruction from mapping table
        if logger:
            logger.warning("All checkpoint tiers failed. Reconstructing from mapping table...")
        return self.reconstruct_from_mapping_table(job_id)

    def try_load(self, tier, job_id):
        if tier == "memory":
            return self.writer.memory_store.get(job_id)
        elif tier == "disk":
            import os
            path = os.path.join(self.writer.disk_path, f"{job_id}.json")
            if os.path.exists(path):
                with open(path, 'r') as f:
                    return json.load(f)
        # Cloud load not implemented for placeholder
        return None

    def validate_checksum(self, checkpoint):
        # Placeholder validation
        return True

    def reconstruct_from_mapping_table(self, job_id):
        # Last resort: rebuild checkpoint from SQLite mapping table
        mappings = getattr(self.db, 'get_all_mappings', lambda x: [])(job_id)

        verified = [m for m in mappings if getattr(m, 'status', None) == "VERIFIED"]
        failed = [m for m in mappings if getattr(m, 'status', None) == "FAILED"]
        
        last_committed = max((getattr(m, 'sequence_id', 0) for m in verified), default=0)

        class Checkpoint:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)

        return Checkpoint(
            job_id=job_id,
            last_committed_sequence=last_committed,
            verified_count=len(verified),
            failed_count=len(failed),
            source_fingerprint=getattr(self, 'get_source_fingerprint_from_mappings', lambda x: 'N/A')(mappings),
            reconstructed=True  # Flag as reconstructed (less reliable)
        )
