"""Session Authority System (SAS) for AutoGram.
Provides single source of truth for Telegram session and in-memory ghost derivation.
"""

import asyncio
import logging
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Literal, Optional, Set
import uuid

from telethon import TelegramClient
from telethon.sessions import StringSession

logger = logging.getLogger('autogram.sas')


class GhostSessionView:
    """Ephemeral, non-persisted view into the canonical session."""

    def __init__(
        self,
        view_id: str,
        purpose: Literal['streaming', 'preview', 'migration', 'query'],
        string_session_str: str,
        expires_in_seconds: int = 30,
        parent_nonce: int = 0,
    ):
        self.view_id = view_id
        self.purpose = purpose
        self.created_at = datetime.utcnow()
        self.expires_at = self.created_at + timedelta(seconds=expires_in_seconds)
        self.string_session = StringSession(string_session_str)
        self.client: Optional[TelegramClient] = None
        self.parent_nonce = parent_nonce
        self.borrowed_senders: Set[uuid.UUID] = set()
        self.active_tasks: Set[asyncio.Task] = set()

    @property
    def is_expired(self) -> bool:
        return datetime.utcnow() > self.expires_at

    async def disconnect(self):
        """Clean up all active tasks and disconnect client."""
        # Cancel tasks
        for task in list(self.active_tasks):
            if not task.done():
                task.cancel()
        if self.active_tasks:
            await asyncio.gather(*self.active_tasks, return_exceptions=True)
            self.active_tasks.clear()

        # Disconnect client
        if self.client:
            try:
                if self.client.is_connected():
                    await self.client.disconnect()
            except Exception as e:
                logger.warning(f"Error disconnecting ghost client {self.view_id}: {e}")
            finally:
                self.client = None


class SessionAuthority:
    """Singleton managing the canonical SQLite session and generating StringSessions."""

    _instance: Optional['SessionAuthority'] = None
    _lock: asyncio.Lock = asyncio.Lock()

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            # We will initialize inside the lock in get_instance()
            pass
        return super().__new__(cls)

    @classmethod
    async def get_instance(
        cls,
        canonical_session_path: Optional[Path] = None,
        api_id: Optional[int] = None,
        api_hash: Optional[str] = None,
    ) -> 'SessionAuthority':
        async with cls._lock:
            if cls._instance is None:
                if not canonical_session_path or not api_id or not api_hash:
                    raise ValueError(
                        "SessionAuthority must be initialized with canonical_session_path, api_id, and api_hash first."
                    )
                cls._instance = super().__new__(cls)
                await cls._instance._init(canonical_session_path, api_id, api_hash)
            return cls._instance

    async def _init(self, canonical_session_path: Path, api_id: int, api_hash: str):
        self._canonical_session_path = Path(canonical_session_path)
        self._api_id = api_id
        self._api_hash = api_hash
        self._canonical_client: Optional[TelegramClient] = None
        self._session_nonce = 0

        # Concurrency Control
        self._write_mutex = asyncio.Lock()
        self._read_semaphore = asyncio.Semaphore(8)
        self._ghost_registry: Dict[str, GhostSessionView] = {}
        self._is_frozen = False

        # Periodic cleanup of expired ghosts
        self._cleanup_task = asyncio.create_task(self._ghost_auto_cleanup_loop())

    async def _ghost_auto_cleanup_loop(self):
        while True:
            try:
                await asyncio.sleep(5)
                await self.cleanup_expired_ghosts()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in ghost auto cleanup loop: {e}", exc_info=True)

    async def cleanup_expired_ghosts(self):
        expired_ids = []
        for view_id, ghost in list(self._ghost_registry.items()):
            if ghost.is_expired:
                expired_ids.append(view_id)

        for view_id in expired_ids:
            await self.release_ghost(view_id)

    async def get_canonical_client(self) -> TelegramClient:
        """Get or initialize the logged-in canonical client."""
        if self._canonical_client is None:
            # Import create_client here to prevent circular imports
            from core.client import create_client
            session_name = self._canonical_session_path.stem
            self._canonical_client = await create_client(
                session_name=session_name,
                api_id_arg=self._api_id,
                api_hash_arg=self._api_hash
            )
        return self._canonical_client

    async def acquire_ghost(
        self,
        purpose: Literal['streaming', 'preview', 'migration', 'query'],
        ttl_seconds: int = 30,
    ) -> GhostSessionView:
        """Borrow an ephemeral memory session view without duplicating the SQLite file."""
        if self._is_frozen:
            raise RuntimeError("Session registry is currently frozen for exclusive write operations.")

        # Ensure ttl_seconds does not exceed 30s mandate
        ttl_seconds = min(ttl_seconds, 30)

        # Acquire read permission
        await self._read_semaphore.acquire()

        try:
            canonical_client = await self.get_canonical_client()
            session_str = StringSession.save(canonical_client.session)

            self._session_nonce += 1
            view_id = str(uuid.uuid4())

            ghost = GhostSessionView(
                view_id=view_id,
                purpose=purpose,
                string_session_str=session_str,
                expires_in_seconds=ttl_seconds,
                parent_nonce=self._session_nonce
            )

            # Isolated connection parameters to avoid fingerprinting
            device_model = f"AutoGram Ghost {purpose.capitalize()}"
            system_version = "V2-Reborn"
            app_version = "2.1.52"

            ghost.client = TelegramClient(
                ghost.string_session,
                self._api_id,
                self._api_hash,
                device_model=device_model,
                system_version=system_version,
                app_version=app_version,
                connection_retries=15,
                retry_delay=3,
                auto_reconnect=True,
                flood_sleep_threshold=86400
            )
            ghost.client.request_retries = 10

            self._ghost_registry[view_id] = ghost
            logger.debug(f"ghost.acquire.success: view_id={view_id}, purpose={purpose}, nonce={self._session_nonce}")
            return ghost

        except Exception as e:
            self._read_semaphore.release()
            logger.error(f"ghost.acquire.failed: purpose={purpose}, error={e}", exc_info=True)
            raise

    async def release_ghost(self, view_id: str):
        """Release a borrowed ghost session and clean up resources."""
        ghost = self._ghost_registry.pop(view_id, None)
        if ghost:
            try:
                await ghost.disconnect()
                logger.debug(f"ghost.release.success: view_id={view_id}")
            except Exception as e:
                logger.error(f"ghost.release.failed: view_id={view_id}, error={e}", exc_info=True)
            finally:
                self._read_semaphore.release()

    async def acquire_exclusive_write(self, timeout_seconds: float = 5.0) -> bool:
        """Coordinate write operations by pausing new ghosts and waiting for current ones to expire."""
        await self._write_mutex.acquire()
        self._is_frozen = True

        # Wait for all active read semaphore slots to be returned
        start_time = time.monotonic()
        while time.monotonic() - start_time < timeout_seconds:
            # Check if there are active ghosts
            if not self._ghost_registry:
                # PRAGMA wal_checkpoint(PASSIVE)
                try:
                    canonical_client = await self.get_canonical_client()
                    # Perform passive checkpoint
                    canonical_client.session._conn.execute("PRAGMA wal_checkpoint(PASSIVE);")
                except Exception as e:
                    logger.warning(f"Passive checkpoint failed: {e}")
                return True
            await asyncio.sleep(0.1)

        # Timeout reached, release write mutex and unfreeze
        self._is_frozen = False
        self._write_mutex.release()
        logger.warning("Exclusive write lock acquisition timed out waiting for ghost views.")
        return False

    def release_exclusive_write(self):
        """Release write locks and resume read operations."""
        self._is_frozen = False
        try:
            self._write_mutex.release()
            logger.debug("Exclusive write lock released.")
        except RuntimeError:
            # Mutex wasn't locked
            pass

    async def close(self):
        """Close canonical client and cleanup all active ghosts."""
        if self._cleanup_task:
            self._cleanup_task.cancel()

        # Release all active ghosts
        for view_id in list(self._ghost_registry.keys()):
            await self.release_ghost(view_id)

        if self._canonical_client:
            try:
                await self._canonical_client.disconnect()
            except Exception as e:
                logger.warning(f"Error disconnecting canonical client: {e}")
            finally:
                self._canonical_client = None
