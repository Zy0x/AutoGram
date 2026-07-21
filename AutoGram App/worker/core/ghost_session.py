"""Ghost Session Manager untuk AutoGram."""

import os
import shutil
import time
import glob
from pathlib import Path

WORKER_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SESSION_DIR = Path(WORKER_ROOT) / 'sessions'


class GhostSessionManager:
    """Manages atomic clones of Telegram session files."""

    GHOST_SUFFIX = '_migration'
    PREVIEW_SUFFIX = '_preview'

    @classmethod
    def ensure_ghost(cls, session_name: str, suffix: str = None) -> str:
        """
        Ensures a ghost session exists. 
        Uses dynamic suffixes on Windows to avoid WinError 32 (file in use).
        """
        # If session_name already has a known suffix, do not double append
        if any(s in session_name for s in [cls.GHOST_SUFFIX, cls.PREVIEW_SUFFIX]):
            return session_name

        suffix = suffix or cls.GHOST_SUFFIX
        
        # Proactively cleanup old ghost files before creating a new one
        try:
            cls.cleanup_stale_ghosts(session_name, suffix)
        except Exception:
            pass

        # Use dynamic suffix to prevent WinError 32 on Windows
        # Example: Lavender_preview_171819
        timestamp = int(time.time())
        ghost_name = f"{session_name}{suffix}_{timestamp}"
        
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
                
                # Explicitly close connections BEFORE performing file operations (os.replace)
                # to prevent file lock (WinError 32) on Windows
                dest_conn.close()
                dest_conn = None
                src_conn.close()
                src_conn = None
                
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
                        try:
                            ghost_path.unlink()
                        except Exception:
                            pass
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
    def cleanup_stale_ghosts(cls, session_name: str, suffix: str = None, max_age_seconds: int = 900):
        """Removes ghost files older than max_age_seconds (default 15 mins)."""
        suffix = suffix or cls.GHOST_SUFFIX
        # Match pattern: session_name_suffix_*
        pattern = str(SESSION_DIR / f"{session_name}{suffix}_*")
        
        for file_path in glob.glob(pattern):
            try:
                p = Path(file_path)
                # Check file age
                if time.time() - p.stat().st_mtime > max_age_seconds:
                    # Try to delete session and its journals
                    base_name = p.stem # filename without extension
                    for ext in ['.session', '.session-wal', '.session-shm', '.session.journal']:
                        f = SESSION_DIR / f'{base_name}{ext}'
                        if f.exists():
                            try:
                                f.unlink()
                            except OSError:
                                pass
            except Exception:
                pass

    @classmethod
    def cleanup_ghost(cls, session_name: str, suffix: str = None):
        """Cleans up all ghost sessions matching the prefix/suffix."""
        suffix = suffix or cls.GHOST_SUFFIX
        pattern = str(SESSION_DIR / f"{session_name}{suffix}_*")
        
        for file_path in glob.glob(pattern):
            try:
                p = Path(file_path)
                base_name = p.stem
                for ext in ['.session', '.session-wal', '.session-shm', '.session.journal']:
                    f = SESSION_DIR / f'{base_name}{ext}'
                    if f.exists():
                        try:
                            f.unlink()
                        except OSError:
                            pass
            except Exception:
                pass

    @classmethod
    def cleanup_all_ghosts(cls, session_name: str):
        for suffix in [cls.GHOST_SUFFIX, cls.PREVIEW_SUFFIX]:
            cls.cleanup_ghost(session_name, suffix)
