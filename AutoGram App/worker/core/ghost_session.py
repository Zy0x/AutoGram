"""Ghost Session Manager untuk AutoGram."""

import os
import shutil
import time
from pathlib import Path

WORKER_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SESSION_DIR = Path(WORKER_ROOT) / 'sessions'


class GhostSessionManager:
    """Manages atomic clones of Telegram session files."""

    GHOST_SUFFIX = '_migration'
    PREVIEW_SUFFIX = '_preview'

    @classmethod
    def ensure_ghost(cls, session_name: str, suffix: str = None) -> str:
        # If session_name already has suffix, do not double append
        suffix = suffix or cls.GHOST_SUFFIX
        if session_name.endswith(suffix):
            return session_name

        ghost_name = f'{session_name}{suffix}'
        original_path = SESSION_DIR / f'{session_name}.session'
        ghost_path = SESSION_DIR / f'{ghost_name}.session'

        # Ensure directory exists
        SESSION_DIR.mkdir(parents=True, exist_ok=True)

        if not original_path.exists():
            raise FileNotFoundError(f'Original session not found: {original_path}')

        need_clone = True
        if ghost_path.exists():
            try:
                # If the ghost session was updated less than 5 minutes ago, reuse it
                ghost_age = time.time() - ghost_path.stat().st_mtime
                if ghost_age < 300:  # 5 minutes
                    need_clone = False
            except Exception:
                pass

        if need_clone:
            # We copy session file + journal files if WAL is used, but Telethon will rebuild them.
            # SQLite WAL mode session file copy: copy the main session file, SQLite handles recovery.
            temp_path = ghost_path.with_suffix('.session.tmp')
            try:
                shutil.copy2(str(original_path), str(temp_path))
                if ghost_path.exists():
                    ghost_path.unlink()
                os.replace(str(temp_path), str(ghost_path))
            except Exception:
                try:
                    shutil.copy2(str(original_path), str(ghost_path))
                except Exception:
                    pass

            # Copy companion journal/wal files if they exist to keep session completely synced
            for ext in ['.session-wal', '.session-shm']:
                orig_journal = original_path.with_suffix(ext)
                ghost_journal = ghost_path.with_suffix(ext)
                if orig_journal.exists():
                    try:
                        shutil.copy2(str(orig_journal), str(ghost_journal))
                    except Exception:
                        pass

        return ghost_name

    @classmethod
    def cleanup_ghost(cls, session_name: str, suffix: str = None):
        suffix = suffix or cls.GHOST_SUFFIX
        ghost_name = f'{session_name}{suffix}'
        ghost_path = SESSION_DIR / f'{ghost_name}.session'
        
        # Delete session file and potential WAL/journal files
        for ext in ['.session', '.session-wal', '.session-shm', '.session.journal']:
            f = SESSION_DIR / f'{ghost_name}{ext}'
            if f.exists():
                try:
                    f.unlink()
                except OSError:
                    pass

    @classmethod
    def cleanup_all_ghosts(cls, session_name: str):
        for suffix in [cls.GHOST_SUFFIX, cls.PREVIEW_SUFFIX]:
            cls.cleanup_ghost(session_name, suffix)
