import os
from typing import Optional
from database.db import get_connection

class MoovSidecarManager:
    def __init__(self, cache_dir: str):
        self.cache_dir = os.path.abspath(cache_dir)
        os.makedirs(self.cache_dir, exist_ok=True)

    def save(self, file_id: str, moov_data: bytes) -> None:
        """Simpan moov atom ke disk untuk penggunaan permanen."""
        try:
            sidecar_path = os.path.join(self.cache_dir, f"{file_id}.moov")
            with open(sidecar_path, 'wb') as f:
                f.write(moov_data)

            conn = get_connection()
            conn.execute("""
                INSERT OR REPLACE INTO moov_sidecar 
                (file_id, sidecar_path, size, created_at) 
                VALUES (?, ?, ?, datetime('now'))
            """, (file_id, sidecar_path, len(moov_data)))
            conn.commit()
        except Exception:
            pass

    def load(self, file_id: str) -> Optional[bytes]:
        """Load moov atom dari sidecar (0.1ms)."""
        try:
            conn = get_connection()
            row = conn.execute(
                "SELECT sidecar_path FROM moov_sidecar WHERE file_id = ?",
                (file_id,)
            ).fetchone()

            if row and os.path.exists(row[0]):
                with open(row[0], 'rb') as f:
                    return f.read()
        except Exception:
            pass
        return None
