import os
import math
import gc
import uuid

class BufferLocation:
    def __init__(self, type_str, path, size=0):
        self.type = type_str
        self.path = path
        self.size = size

class TieredBufferManager:
    def __init__(self, cleanup_queue=None):
        self.tiers = {
            "RAM": {"max_size": 512 * 1024 * 1024, "priority": 1},      # 512 MB
            "SSD": {"max_size": 10 * 1024 * 1024 * 1024, "priority": 2}, # 10 GB
            "Archive": {"max_size": None, "priority": 3},                # Unlimited
        }
        self.current_ram_usage = 0
        self.cleanup_queue = cleanup_queue

    def allocate_buffer(self, file_size, priority="normal"):
        # Determine where to store file based on size and priority
        if file_size < 10 * 1024 * 1024 and self.current_ram_usage < self.tiers["RAM"]["max_size"]:
            # Small files (< 10MB) go to RAM
            self.current_ram_usage += file_size
            return BufferLocation(type_str="RAM", path=None, size=file_size)

        elif file_size < 100 * 1024 * 1024:
            # Medium files (10-100MB) go to SSD temp
            # Using current working directory or a temp dir if specified
            return BufferLocation(type_str="SSD", path=f"data/temp/{uuid.uuid4()}", size=file_size)

        else:
            # Large files (> 100MB) use memory-mapped disk
            return BufferLocation(type_str="SSD_MMAP", path=f"data/temp/{uuid.uuid4()}", size=file_size)

    def release_buffer(self, location):
        # Release buffer and update accounting
        if location.type == "RAM":
            self.current_ram_usage -= location.size
        else:
            # Async cleanup of disk files
            if self.cleanup_queue and location.path:
                self.cleanup_queue.put(location.path)

class StreamingUploader:
    def __init__(self, api, file_id=None):
        self.api = api
        self.file_id = file_id

    def upload_large_file(self, file_path, chunk_size=524288):
        # Upload file without loading into RAM
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File {file_path} not found")
            
        file_size = os.path.getsize(file_path)
        total_parts = math.ceil(file_size / chunk_size)

        with open(file_path, 'rb') as f:
            for part_index in range(total_parts):
                chunk = f.read(chunk_size)
                # Upload chunk via MTProto
                self.api.upload_file_part(
                    file_id=self.file_id,
                    part_index=part_index,
                    bytes=chunk
                )
                # Immediate GC hint
                del chunk
                gc.collect()
