import json
import os
import hashlib
from database.db import get_connection

class CheckpointManager:
    def __init__(self, checkpoint_dir="checkpoints"):
        self.checkpoint_dir = checkpoint_dir
        if not os.path.exists(self.checkpoint_dir):
            os.makedirs(self.checkpoint_dir, exist_ok=True)
            
    def write_checkpoint(self, data: dict):
        # Hash data to create resume token
        data_str = json.dumps(data, sort_keys=True)
        resume_token = hashlib.sha256(data_str.encode()).hexdigest()
        data["resume_token"] = resume_token
        
        job_id = data.get("job_id")
        file_path = os.path.join(self.checkpoint_dir, f"{job_id}.json")
        
        with open(file_path, 'w') as f:
            f.write(json.dumps(data, indent=4))
            f.flush()
            os.fsync(f.fileno())
            
        # Write to DB for consistency
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS checkpoints (
                job_id TEXT PRIMARY KEY,
                resume_token TEXT,
                data_json TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            INSERT INTO checkpoints (job_id, resume_token, data_json)
            VALUES (?, ?, ?)
            ON CONFLICT(job_id) DO UPDATE SET
                resume_token=excluded.resume_token,
                data_json=excluded.data_json,
                updated_at=CURRENT_TIMESTAMP
        ''', (job_id, resume_token, json.dumps(data)))
        conn.commit()
        conn.close()

    def get_checkpoint(self, job_id: str) -> dict:
        file_path = os.path.join(self.checkpoint_dir, f"{job_id}.json")
        if os.path.exists(file_path):
            with open(file_path, 'r') as f:
                data = json.load(f)
                return data
        
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT name FROM sqlite_master WHERE type='table' AND name='checkpoints'
        ''')
        if cursor.fetchone():
            cursor.execute('SELECT data_json FROM checkpoints WHERE job_id = ?', (job_id,))
            row = cursor.fetchone()
            conn.close()
            if row:
                return json.loads(row[0])
        else:
            conn.close()
        return None

    def delete_checkpoint(self, job_id: str):
        file_path = os.path.join(self.checkpoint_dir, f"{job_id}.json")
        if os.path.exists(file_path):
            os.remove(file_path)
            
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT name FROM sqlite_master WHERE type='table' AND name='checkpoints'
        ''')
        if cursor.fetchone():
            cursor.execute('DELETE FROM checkpoints WHERE job_id = ?', (job_id,))
            conn.commit()
        conn.close()
