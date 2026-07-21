"""
telegram_resilient.py
─────────────────────
Per-destination Circuit Breaker + Adaptive Rate Limiter for all
Telegram API calls made during pre-scan and duplicate verification.

Circuit Breaker states:
    CLOSED    — Normal operation.
    OPEN      — Too many consecutive failures; calls are blocked.
    HALF_OPEN — Testing recovery: limited calls allowed.

Usage:
    resilient = TelegramResilientClient(client, entity_id)
    async for msg in resilient.iter_messages_safe(entity, **kwargs):
        process(msg)
    msg = await resilient.get_messages_safe(entity, ids=[mid])
"""
from __future__ import annotations

import asyncio
import logging
import random
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional

from telethon import TelegramClient
from telethon.errors import FloodWaitError

log = logging.getLogger(__name__)


# ──────────────────────────────────────────────
# Adaptive Rate Limiter
# ──────────────────────────────────────────────

@dataclass
class AdaptiveRateLimiter:
    """Tracks per-destination API delay and adjusts based on success/failure."""

    initial_delay: float = 0.3    # seconds between requests
    min_delay:     float = 0.05
    max_delay:     float = 5.0
    success_decay: float = 0.90   # multiply on success
    failure_mult:  float = 2.0    # multiply on failure
    jitter_range:  float = 0.30   # ±30% jitter

    _delays:              Dict[str, float] = field(default_factory=dict)
    _consecutive_flood:   Dict[str, int]   = field(default_factory=dict)

    def delay_for(self, entity_id: str) -> float:
        return self._delays.get(str(entity_id), self.initial_delay)

    def report_success(self, entity_id: str) -> None:
        eid = str(entity_id)
        cur = self._delays.get(eid, self.initial_delay)
        new = max(self.min_delay, cur * self.success_decay)
        self._delays[eid] = new
        self._consecutive_flood[eid] = 0

    def report_floodwait(self, entity_id: str, wait_seconds: float) -> float:
        """Returns actual delay to sleep."""
        eid = str(entity_id)
        cur = self._delays.get(eid, self.initial_delay)
        new = min(self.max_delay, max(cur * self.failure_mult, wait_seconds * 0.5))
        jitter = new * self.jitter_range * (2 * random.random() - 1)
        new = max(self.min_delay, new + jitter)
        self._delays[eid] = new
        self._consecutive_flood[eid] = self._consecutive_flood.get(eid, 0) + 1
        return new

    def consecutive_floodwaits(self, entity_id: str) -> int:
        return self._consecutive_flood.get(str(entity_id), 0)

    async def wait(self, entity_id: str) -> None:
        delay = self.delay_for(entity_id)
        if delay > 0:
            await asyncio.sleep(delay)


# ──────────────────────────────────────────────
# Circuit Breaker
# ──────────────────────────────────────────────

class CircuitBreakerOpen(Exception):
    """Raised when the circuit breaker is OPEN for a destination."""
    def __init__(self, entity_id: str, resume_at: float):
        self.entity_id = entity_id
        self.resume_at = resume_at
        super().__init__(
            f"Circuit breaker OPEN for {entity_id}, "
            f"resumes at {time.strftime('%H:%M:%S', time.localtime(resume_at))}"
        )


@dataclass
class PerDestinationCircuitBreaker:
    """State machine: CLOSED → OPEN → HALF_OPEN → CLOSED."""

    failure_threshold:    int   = 3      # consecutive failures to open
    recovery_timeout:     float = 300.0  # seconds before HALF_OPEN attempt
    half_open_max_calls:  int   = 2      # calls allowed in HALF_OPEN

    _state:        Dict[str, str]   = field(default_factory=dict)   # CLOSED/OPEN/HALF_OPEN
    _fail_count:   Dict[str, int]   = field(default_factory=dict)
    _open_until:   Dict[str, float] = field(default_factory=dict)
    _half_calls:   Dict[str, int]   = field(default_factory=dict)

    def state(self, entity_id: str) -> str:
        eid = str(entity_id)
        if eid not in self._state:
            return "CLOSED"
        if self._state[eid] == "OPEN":
            if time.time() >= self._open_until.get(eid, 0):
                self._state[eid] = "HALF_OPEN"
                self._half_calls[eid] = 0
        return self._state[eid]

    def can_proceed(self, entity_id: str) -> bool:
        s = self.state(entity_id)
        if s == "CLOSED":
            return True
        if s == "OPEN":
            return False
        # HALF_OPEN
        eid = str(entity_id)
        if self._half_calls.get(eid, 0) < self.half_open_max_calls:
            self._half_calls[eid] = self._half_calls.get(eid, 0) + 1
            return True
        return False

    def resume_at(self, entity_id: str) -> float:
        return self._open_until.get(str(entity_id), time.time())

    def record_success(self, entity_id: str) -> None:
        eid = str(entity_id)
        self._state[eid] = "CLOSED"
        self._fail_count[eid] = 0
        self._half_calls[eid] = 0

    def record_failure(self, entity_id: str, extra_delay: float = 0.0) -> bool:
        """Returns True if the circuit just opened."""
        eid = str(entity_id)
        self._fail_count[eid] = self._fail_count.get(eid, 0) + 1
        if self._fail_count[eid] >= self.failure_threshold:
            self._state[eid] = "OPEN"
            self._open_until[eid] = time.time() + self.recovery_timeout + extra_delay
            return True
        return False


# ──────────────────────────────────────────────
# TelegramResilientClient
# ──────────────────────────────────────────────

class TelegramResilientClient:
    """
    Wraps a Telethon client with per-destination adaptive rate limiting
    and circuit breaker for scan and verify operations.

    Parameters
    ----------
    client      : Telethon TelegramClient
    entity_id   : Canonical string ID of the destination chat/channel
    emit_event  : Optional callable(event_type, **payload) for UI feedback
    """

    CB  = PerDestinationCircuitBreaker()   # shared across all instances
    RL  = AdaptiveRateLimiter()            # shared across all instances

    def __init__(
        self,
        client: TelegramClient,
        entity_id: str,
        emit_event_fn=None,
    ):
        self.client    = client
        self.entity_id = str(entity_id)
        self._emit     = emit_event_fn or (lambda t, **kw: None)

    # ── internal helpers ────────────────────────────────────────────

    def _check_cb(self) -> None:
        if not self.CB.can_proceed(self.entity_id):
            raise CircuitBreakerOpen(
                self.entity_id,
                self.CB.resume_at(self.entity_id),
            )

    async def _handle_floodwait(self, fw: FloodWaitError, context: str = "") -> None:
        wait = fw.seconds
        actual = self.RL.report_floodwait(self.entity_id, wait)
        consec = self.RL.consecutive_floodwaits(self.entity_id)
        log.warning("[TelegramResilient] FloodWait %ds (%s), sleeping %.1fs", wait, context, actual)

        opened = self.CB.record_failure(self.entity_id, extra_delay=wait)
        if opened:
            resume_at = self.CB.resume_at(self.entity_id)
            self._emit(
                "StudioCircuitBreaker",
                targetEntityId=self.entity_id,
                state="open",
                reason=f"FloodWait consecutifs: {consec}x",
                resumeAt=int(resume_at),
            )
            log.warning("[TelegramResilient] Circuit OPEN for %s until %s",
                        self.entity_id, time.strftime('%H:%M:%S', time.localtime(resume_at)))

        await asyncio.sleep(actual)

    # ── public API ──────────────────────────────────────────────────

    async def iter_messages_safe(
        self,
        entity,
        *,
        limit: Optional[int] = None,
        batch_size: int = 100,
        offset_id: int = 0,
        reply_to: Optional[int] = None,
        emit_batch_cb=None,
    ) -> AsyncIterator[Any]:
        """
        Async generator: yields messages one by one with rate limiting.
        Handles FloodWait via exponential backoff.
        `emit_batch_cb(fetched_count)` is called after each batch for progress.
        """
        fetched = 0
        remaining = limit  # None = unlimited
        current_offset = offset_id
        consec_conn_failures = 0

        while True:
            self._check_cb()

            batch = min(batch_size, remaining) if remaining is not None else batch_size
            if batch <= 0:
                break

            await self.RL.wait(self.entity_id)
            try:
                msgs: List[Any] = []
                kwargs: Dict[str, Any] = dict(
                    limit=batch,
                    offset_id=current_offset,
                )
                if reply_to is not None:
                    kwargs["reply_to"] = reply_to

                async for m in self.client.iter_messages(entity, **kwargs):
                    msgs.append(m)

                self.CB.record_success(self.entity_id)
                self.RL.report_success(self.entity_id)
                consec_conn_failures = 0

            except FloodWaitError as fw:
                await self._handle_floodwait(fw, "iter_messages")
                # Retry same batch — do NOT advance offset
                continue
            except CircuitBreakerOpen:
                raise
            except Exception as exc:
                if self._is_auth_key_unregistered_error(exc):
                    log.error("[TelegramResilient] Sesi Telegram tidak terdaftar (AUTH_KEY_UNREGISTERED): %s", exc)
                    self.CB.record_failure(self.entity_id)
                    raise RuntimeError("Sesi Telegram telah kedaluwarsa atau dicabut oleh Telegram (AUTH_KEY_UNREGISTERED). Silakan login ulang sesi ini.") from exc
                if self._is_connection_error(exc):
                    consec_conn_failures += 1
                    if consec_conn_failures <= 5:
                        log.warning("[TelegramResilient] Connection lost in iter_messages (attempt %d/5): %s. Reconnecting...", consec_conn_failures, exc)
                        self.CB.record_failure(self.entity_id)
                        try:
                            await self.client.disconnect()
                        except Exception:
                            pass
                        await asyncio.sleep(1.0 + consec_conn_failures * 1.5)
                        try:
                            await self.client.connect()
                        except Exception:
                            pass
                        continue

                log.warning("[TelegramResilient] iter_messages error: %s", exc)
                self.CB.record_failure(self.entity_id)
                break

            if not msgs:
                break

            for m in msgs:
                yield m
                fetched += 1

            if emit_batch_cb:
                try:
                    emit_batch_cb(fetched)
                except Exception:
                    pass

            if remaining is not None:
                remaining -= len(msgs)
                if remaining <= 0:
                    break

            if len(msgs) < batch:
                break  # reached end of history

            current_offset = msgs[-1].id

    async def get_messages_safe(
        self,
        entity,
        ids: List[int],
        *,
        max_retries: int = 2,
    ) -> List[Any]:
        """Wrapper around client.get_messages with retry logic."""
        attempt = 0
        consec_conn_failures = 0
        while True:
            self._check_cb()
            await self.RL.wait(self.entity_id)
            try:
                result = await self.client.get_messages(entity, ids=ids)
                self.CB.record_success(self.entity_id)
                self.RL.report_success(self.entity_id)
                return result if isinstance(result, list) else [result]
            except FloodWaitError as fw:
                await self._handle_floodwait(fw, "get_messages")
                attempt += 1
                if attempt > max_retries:
                    raise
                continue
            except CircuitBreakerOpen:
                raise
            except Exception as exc:
                if self._is_connection_error(exc):
                    consec_conn_failures += 1
                    if consec_conn_failures <= 3:
                        log.warning("[TelegramResilient] Connection lost in get_messages (attempt %d/3): %s. Reconnecting...", consec_conn_failures, exc)
                        self.CB.record_failure(self.entity_id)
                        try:
                            await self.client.disconnect()
                        except Exception:
                            pass
                        await asyncio.sleep(1.0 + consec_conn_failures * 1.5)
                        try:
                            await self.client.connect()
                        except Exception:
                            pass
                        continue

                log.warning("[TelegramResilient] get_messages error: %s", exc)
                self.CB.record_failure(self.entity_id)
                attempt += 1
                if attempt > max_retries:
                    raise
                continue

    async def get_file_safe(
        self,
        media_obj: Any,
        *,
        max_retries: int = 1,
    ) -> Optional[Any]:
        """
        Call client.get_file() to deep-verify a media object still exists.
        Returns the file object if valid, None on any error.
        """
        attempt = 0
        consec_conn_failures = 0
        while True:
            self._check_cb()
            await self.RL.wait(self.entity_id)
            try:
                result = await self.client.get_file(media_obj)
                self.CB.record_success(self.entity_id)
                self.RL.report_success(self.entity_id)
                return result
            except FloodWaitError as fw:
                await self._handle_floodwait(fw, "get_file")
                attempt += 1
                if attempt > max_retries:
                    return None
                continue
            except CircuitBreakerOpen:
                raise
            except Exception as exc:
                if self._is_connection_error(exc):
                    consec_conn_failures += 1
                    if consec_conn_failures <= 3:
                        log.warning("[TelegramResilient] Connection lost in get_file (attempt %d/3): %s. Reconnecting...", consec_conn_failures, exc)
                        self.CB.record_failure(self.entity_id)
                        try:
                            await self.client.disconnect()
                        except Exception:
                            pass
                        await asyncio.sleep(1.0 + consec_conn_failures * 1.5)
                        try:
                            await self.client.connect()
                        except Exception:
                            pass
                        continue

                attempt += 1
                if attempt > max_retries:
                    return None
                continue

    @staticmethod
    def _is_connection_error(exc: Exception) -> bool:
        if isinstance(exc, (ConnectionError, OSError)):
            return True
        msg = str(exc or "").lower()
        return any(
            x in msg
            for x in (
                "while disconnected",
                "not connected",
                "connection closed",
                "server closed the connection",
                "cannot send requests",
                "broken pipe",
                "connection reset",
                "socket",
            )
        )

    @staticmethod
    def _is_auth_key_unregistered_error(exc: Exception) -> bool:
        if exc is None:
            return False
        msg = str(exc or "").lower()
        return any(
            x in msg
            for x in (
                "the key is not registered in the system",
                "auth_key_unregistered",
                "authkeyunregistered",
                "user_deactivated",
                "session_revoked",
                "session_expired",
            )
        )
