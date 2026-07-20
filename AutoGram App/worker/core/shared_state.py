"""
Shared cross-process state for AutoGram workers.
"""

import json
import os
import time
from pathlib import Path
from typing import Dict

try:
    import fcntl
    HAS_FCNTL = True
except ImportError:
    HAS_FCNTL = False
    try:
        import msvcrt
        HAS_MSVCRT = True
    except ImportError:
        HAS_MSVCRT = False

WORKER_ROOT = os.environ.get(
    'AUTOMIGRAM_WORKER_ROOT',
    os.path.dirname(os.path.dirname(__file__))
)


class SharedRateLimiter:
    """File-based shared rate limiter."""

    _STATE_FILE = Path(WORKER_ROOT) / '.shared_rate_state.json'
    _LOCK_FILE = Path(WORKER_ROOT) / '.shared_rate_state.lock'

    @classmethod
    def _acquire_lock(cls):
        cls._LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
        cls._lock_fd = open(cls._LOCK_FILE, 'w')
        if HAS_FCNTL:
            fcntl.flock(cls._lock_fd.fileno(), fcntl.LOCK_EX)
        elif HAS_MSVCRT:
            # Position at 0, lock 1 byte using blocking LK_LOCK
            cls._lock_fd.seek(0)
            msvcrt.locking(cls._lock_fd.fileno(), msvcrt.LK_LOCK, 1)

    @classmethod
    def _release_lock(cls):
        if hasattr(cls, '_lock_fd') and cls._lock_fd:
            try:
                if HAS_FCNTL:
                    fcntl.flock(cls._lock_fd.fileno(), fcntl.LOCK_UN)
                elif HAS_MSVCRT:
                    cls._lock_fd.seek(0)
                    msvcrt.locking(cls._lock_fd.fileno(), msvcrt.LK_UNLCK, 1)
            except Exception:
                pass
            finally:
                cls._lock_fd.close()
                cls._lock_fd = None

    @classmethod
    def _load(cls) -> Dict:
        if not cls._STATE_FILE.exists():
            return {}
        try:
            with open(cls._STATE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}

    @classmethod
    def _save(cls, state: Dict):
        tmp_file = cls._STATE_FILE.with_suffix('.tmp')
        try:
            with open(tmp_file, 'w', encoding='utf-8') as f:
                json.dump(state, f, indent=2)
            if tmp_file.exists():
                if cls._STATE_FILE.exists():
                    cls._STATE_FILE.unlink()
                os.replace(str(tmp_file), str(cls._STATE_FILE))
        except Exception:
            try:
                tmp_file.unlink()
            except OSError:
                pass

    @classmethod
    def record_flood_wait(cls, account_id: str, seconds: int):
        # Normalize account_id to the base filename of session (e.g. Lavender)
        acc_id = str(Path(account_id).stem)
        cls._acquire_lock()
        try:
            state = cls._load()
            now = time.time()
            existing = state.get(acc_id, {})
            current_until = existing.get('until', 0)
            severity = existing.get('severity', 0)
            new_until = max(current_until, now + seconds)
            state[acc_id] = {
                'until': new_until,
                'seconds': seconds,
                'severity': min(severity + 1, 10),
                'recorded_at': now,
            }
            cls._save(state)
        finally:
            cls._release_lock()

    @classmethod
    def get_delay(cls, account_id: str) -> float:
        acc_id = str(Path(account_id).stem)
        state = cls._load()
        entry = state.get(acc_id)
        if not entry:
            return 0.0
        remaining = entry['until'] - time.time()
        if remaining <= 0:
            return 0.0
        severity = entry.get('severity', 1)
        buffer = 2 + (severity * 0.5)
        return remaining + buffer

    @classmethod
    def clear_account(cls, account_id: str):
        acc_id = str(Path(account_id).stem)
        cls._acquire_lock()
        try:
            state = cls._load()
            if acc_id in state:
                del state[acc_id]
                cls._save(state)
        finally:
            cls._release_lock()

    @classmethod
    def is_throttled(cls, account_id: str) -> bool:
        return cls.get_delay(account_id) > 0
