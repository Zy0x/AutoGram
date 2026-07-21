"""
Shared cross-process state for AutoGram workers (V2 DB-backed rate limiter).
"""

import os
import time
from pathlib import Path
from database.db import get_connection


class SharedRateLimiter:
    """SQLite-backed distributed rate limiter (completely zero file-based locks)."""

    @classmethod
    def _ensure_table(cls):
        conn = get_connection()
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS shared_rate_state (
                    account_id TEXT PRIMARY KEY,
                    flood_wait_until REAL DEFAULT 0,
                    seconds INTEGER DEFAULT 0,
                    severity INTEGER DEFAULT 0,
                    recorded_at REAL DEFAULT 0
                )
            """)
            conn.commit()
        except Exception:
            pass
        finally:
            conn.close()

    @classmethod
    def record_flood_wait(cls, account_id: str, seconds: int):
        cls._ensure_table()
        acc_id = str(Path(account_id).stem)
        conn = get_connection()
        try:
            now = time.time()
            row = conn.execute("SELECT severity, flood_wait_until FROM shared_rate_state WHERE account_id = ?", (acc_id,)).fetchone()
            severity = 0
            current_until = 0
            if row:
                severity = row[0]
                current_until = row[1]

            new_until = max(current_until, now + seconds)
            new_severity = min(severity + 1, 10)

            conn.execute("""
                INSERT INTO shared_rate_state (account_id, flood_wait_until, seconds, severity, recorded_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(account_id) DO UPDATE SET
                    flood_wait_until = excluded.flood_wait_until,
                    seconds = excluded.seconds,
                    severity = excluded.severity,
                    recorded_at = excluded.recorded_at
            """, (acc_id, new_until, seconds, new_severity, now))
            conn.commit()
        except Exception:
            pass
        finally:
            conn.close()

    @classmethod
    def get_delay(cls, account_id: str) -> float:
        cls._ensure_table()
        acc_id = str(Path(account_id).stem)
        conn = get_connection()
        try:
            row = conn.execute("SELECT flood_wait_until, severity FROM shared_rate_state WHERE account_id = ?", (acc_id,)).fetchone()
            if not row:
                return 0.0
            until, severity = row[0], row[1]
            remaining = until - time.time()
            if remaining <= 0:
                return 0.0
            buffer = 2 + (severity * 0.5)
            return remaining + buffer
        except Exception:
            return 0.0
        finally:
            conn.close()

    @classmethod
    def clear_account(cls, account_id: str):
        cls._ensure_table()
        acc_id = str(Path(account_id).stem)
        conn = get_connection()
        try:
            conn.execute("DELETE FROM shared_rate_state WHERE account_id = ?", (acc_id,))
            conn.commit()
        except Exception:
            pass
        finally:
            conn.close()

    @classmethod
    def is_throttled(cls, account_id: str) -> bool:
        return cls.get_delay(account_id) > 0
