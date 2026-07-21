"""Ghost Session Manager untuk AutoGram (V2 - In-Memory Views)."""

import os
from pathlib import Path

WORKER_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SESSION_DIR = Path(WORKER_ROOT) / 'sessions'


class GhostSessionManager:
    """
    Manages in-memory ghost views for Telegram sessions.
    No SQLite files are cloned or copied.
    """

    GHOST_SUFFIX = '_migration'
    PREVIEW_SUFFIX = '_preview'

    @classmethod
    def ensure_ghost(cls, session_name: str, suffix: str = None) -> str:
        """
        Returns a ghost session name format.
        Create client logic in core/client.py will intercept this and run in-memory.
        """
        # If session_name already has a known suffix, do not double append
        if any(s in session_name for s in [cls.GHOST_SUFFIX, cls.PREVIEW_SUFFIX]):
            return session_name

        suffix = suffix or cls.GHOST_SUFFIX
        ghost_name = f"{session_name}{suffix}"
        
        # Best-effort: clear old ghost files for this name
        cls.cleanup_ghost(session_name, suffix)
        return ghost_name

    @classmethod
    def cleanup_stale_ghosts(cls, session_name: str, suffix: str = None, max_age_seconds: int = 900):
        """Clean up stale ghost session files on disk if they exist."""
        cls.cleanup_ghost(session_name, suffix)

    @classmethod
    def cleanup_ghost(cls, session_name: str, suffix: str = None):
        """Clean up ghost session files on disk if they exist."""
        # Clean both suffix patterns just in case
        for s in [cls.GHOST_SUFFIX, cls.PREVIEW_SUFFIX]:
            name = f"{session_name}{s}"
            for ext in [".session", ".session-journal", ".session-wal", ".session-shm"]:
                path = SESSION_DIR / f"{name}{ext}"
                try:
                    if path.exists():
                        path.unlink()
                except Exception:
                    pass

    @classmethod
    def cleanup_all_ghosts(cls, session_name: str):
        """Clean up all ghost session files for this session."""
        cls.cleanup_ghost(session_name, cls.GHOST_SUFFIX)
        cls.cleanup_ghost(session_name, cls.PREVIEW_SUFFIX)
