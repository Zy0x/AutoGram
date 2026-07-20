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
            import sqlite3
            temp_path = ghost_path.with_suffix('.session.tmp')
            backup_success = False
            
            src_conn = None
            dest_conn = None
            try:
                # Try SQLite Online Backup API first (safe, atomic, handles WAL)
                src_conn = sqlite3.connect(str(original_path), timeout=5.0)
                # Quick sanity check on source connection
                src_conn.execute("PRAGMA schema_version;")
                
                if temp_path.exists():
                    try:
                        temp_path.unlink()
                    except OSError:
                        pass
                        
                dest_conn = sqlite3.connect(str(temp_path))
                src_conn.backup(dest_conn)
                backup_success = True
                
                if temp_path.exists():
                    if ghost_path.exists():
                        try:
                            ghost_path.unlink()
                        except OSError:
                            pass
                    os.replace(str(temp_path), str(ghost_path))
                    
                    # Clean up old journal/WAL files on destination if they exist
                    # (since backup is a single consolidated file, previous WAL files can conflict)
                    for ext in ['.session-wal', '.session-shm']:
                        journal = ghost_path.with_suffix(ext)
                        if journal.exists():
                            try:
                                journal.unlink()
                            except OSError:
                                pass
            except Exception as e:
                try:
                    import logging
                    logging.warning(f"[GhostSession] SQLite backup failed, falling back to file copy: {e}")
                except Exception:
                    pass
            finally:
                if src_conn is not None:
                    try:
                        src_conn.close()
                    except Exception:
                        pass
                if dest_conn is not None:
                    try:
                        dest_conn.close()
                    except Exception:
                        pass
            
            if not backup_success:
                # Fallback: copy file directly
                try:
                    shutil.copy2(str(original_path), str(temp_path))
                    if ghost_path.exists():
                        ghost_path.unlink()
                    os.replace(str(temp_path), str(ghost_path))
                    
                    # Copy companion journal/wal files if they exist to keep session completely synced
                    for ext in ['.session-wal', '.session-shm']:
                        orig_journal = original_path.with_suffix(ext)
                        ghost_journal = ghost_path.with_suffix(ext)
                        if orig_journal.exists():
                            try:
                                shutil.copy2(str(orig_journal), str(ghost_journal))
                            except Exception:
                                pass
                except Exception:
                    try:
                        shutil.copy2(str(original_path), str(ghost_path))
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
