"""
smart_scanner.py
─────────────────
Fase 1 — Smart Adaptive Pre-Scan for Media Studio transfer.

Scans the destination Telegram entity and builds an in-memory lookup
index (fingerprint_hash → message_id) WITHOUT downloading any file.

Scan modes
──────────
    normal   : Recent 1,000 messages only. Fast, covers most cases.
    smart    : 1,000 recent + adaptive historical sampling that
               drills deeper when duplicates are found.  [DEFAULT]
    forensic : Full scan with checkpointing. Very slow for large channels.

Topic filtering
───────────────
    selected_only          : Only messages whose reply-to == topic_id
    selected_plus_general  : topic_id messages + general (None / 1)
    all_topics             : All messages regardless of topic

Events emitted
──────────────
    StudioScanProgress — one per batch:
        { phase, scanned, totalEstimated, elapsedSeconds,
          estimatedTotalSeconds, stats }
    StudioScanComplete — once when done:
        { indexSize, skippedMessages, durationSeconds, stats }
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from engine.fingerprint_engine import MediaFingerprint
from engine.telegram_resilient import TelegramResilientClient, CircuitBreakerOpen

log = logging.getLogger(__name__)

# In-memory index type: fingerprint_hash → message_id
ScanIndex = Dict[str, int]

# Secondary index: (file_name_lower, file_size) → message_id
NameSizeIndex = Dict[Tuple[str, int], int]


@dataclass
class ScanStats:
    recent_scanned:   int = 0
    sampled_scanned:  int = 0
    db_cached_loaded: int = 0
    new_from_tg:      int = 0
    duplicate_hits:   int = 0
    skipped_no_media: int = 0
    circuit_open:     bool = False

    @property
    def total_scanned(self) -> int:
        return self.recent_scanned + self.sampled_scanned

    def to_dict(self) -> Dict[str, Any]:
        return {
            "recentScanned":   self.recent_scanned,
            "sampledScanned":  self.sampled_scanned,
            "dbCachedLoaded":  self.db_cached_loaded,
            "newFromTg":       self.new_from_tg,
            "duplicateHits":   self.duplicate_hits,
            "skippedNoMedia":  self.skipped_no_media,
            "circuitOpen":     self.circuit_open,
            "totalScanned":    self.total_scanned,
        }


class SmartScanner:
    """
    Builds the destination scan index used for duplicate detection.

    Parameters
    ----------
    resilient   : TelegramResilientClient wrapping the active Telethon client
    entity      : Resolved Telethon entity for the destination
    entity_id   : str entity ID (for DB cache key)
    topic_id    : Optional topic/thread ID to filter messages
    topic_scope : 'selected_only' | 'selected_plus_general' | 'all_topics'
    scan_mode   : 'normal' | 'smart' | 'forensic'
    emit_fn     : Callable for event emission (event_type, **payload)
    db_cache_fn : Optional callable() → List[dict] to load pre-cached
                  entries from destination_scan_cache table.
    save_cache_fn: Optional callable(entries: List[dict]) to persist new
                  scan results to destination_scan_cache.
    """

    RECENT_LIMIT       = 1_000
    BATCH_SIZE         = 100
    SAMPLING_START     = 1_000   # offset after recent scan
    SAMPLING_INIT_STEP = 1_000
    SAMPLING_MAX_STEP  = 32_000
    SAMPLING_EMPTY_STOP = 3     # consecutive empty batches → stop

    def __init__(
        self,
        resilient: TelegramResilientClient,
        entity,
        entity_id: str,
        *,
        topic_id: Optional[int] = None,
        topic_scope: str = "selected_plus_general",
        scan_mode: str = "smart",
        emit_fn: Optional[Callable] = None,
        db_cache_fn: Optional[Callable] = None,
        save_cache_fn: Optional[Callable] = None,
        job_id: str = "",
    ):
        self.resilient      = resilient
        self.entity         = entity
        self.entity_id      = str(entity_id)
        self.topic_id       = topic_id
        self.topic_scope    = topic_scope
        self.scan_mode      = scan_mode
        self._emit          = emit_fn or (lambda t, **kw: None)
        self._db_cache_fn   = db_cache_fn
        self._save_cache_fn = save_cache_fn
        self.job_id         = job_id

        # Output indices
        self.index:       ScanIndex     = {}
        self.ns_index:    NameSizeIndex = {}  # (name_lower, size) → msg_id
        self.uid_index:   Dict[str, int] = {} # file_unique_id → msg_id
        self.stats:       ScanStats     = ScanStats()
        self._start_time: float         = 0.0
        self._new_entries: List[dict]   = []  # for DB cache save

    # ────────────────────────────────────────────────────────────────
    # Public entry point
    # ────────────────────────────────────────────────────────────────

    async def run(self) -> ScanIndex:
        """
        Execute the full scan and return the fingerprint index.
        Also populates self.ns_index and self.uid_index.
        """
        self._start_time = time.time()

        # Phase 0: Load DB cache
        await self._phase_cache_warmup()

        # Phase 1: Recent deep scan (last RECENT_LIMIT messages)
        await self._phase_recent()

        # Phase 2: Historical sampling (smart/forensic mode only)
        if self.scan_mode in ("smart", "forensic") and not self.stats.circuit_open:
            await self._phase_sampling()

        # Phase 3: Full forensic scan (forensic only)
        if self.scan_mode == "forensic" and not self.stats.circuit_open:
            await self._phase_forensic()

        # Persist new entries to DB cache
        if self._new_entries and self._save_cache_fn:
            try:
                self._save_cache_fn(self._new_entries)
            except Exception as exc:
                log.warning("[SmartScanner] Failed to save cache: %s", exc)

        elapsed = time.time() - self._start_time
        self._emit(
            "StudioScanComplete",
            jobId=self.job_id,
            indexSize=len(self.index),
            durationSeconds=round(elapsed, 1),
            stats=self.stats.to_dict(),
        )
        log.info("[SmartScanner] Done. Index=%d entries in %.1fs", len(self.index), elapsed)
        return self.index

    # ────────────────────────────────────────────────────────────────
    # Phase 0 — DB Cache Warmup
    # ────────────────────────────────────────────────────────────────

    async def _phase_cache_warmup(self) -> None:
        if not self._db_cache_fn:
            return
        self._emit("StudioScanProgress", jobId=self.job_id, phase="cache_warmup",
                   scanned=0, totalEstimated=None, elapsedSeconds=0,
                   estimatedTotalSeconds=None, stats=self.stats.to_dict())
        try:
            entries = self._db_cache_fn()
            for e in entries:
                self._ingest_cache_entry(e)
                self.stats.db_cached_loaded += 1
            log.info("[SmartScanner] Loaded %d entries from DB cache", len(entries))
        except Exception as exc:
            log.warning("[SmartScanner] Cache warmup error: %s", exc)

    def _ingest_cache_entry(self, entry: dict) -> None:
        """Add a DB-cached entry to all indices."""
        msg_id  = entry.get("message_id")
        fhash   = entry.get("fingerprint_hash")
        fname   = (entry.get("file_name") or "").lower()
        fsize   = entry.get("file_size")
        fuid    = entry.get("file_unique_id")
        alive   = bool(entry.get("is_alive", True))

        if not msg_id or not alive:
            return
        if fhash:
            self.index[fhash] = msg_id
        if fname and fsize:
            self.ns_index[(fname, fsize)] = msg_id
        if fuid:
            self.uid_index[fuid] = msg_id

    # ────────────────────────────────────────────────────────────────
    # Phase 1 — Recent Deep Scan
    # ────────────────────────────────────────────────────────────────

    async def _phase_recent(self) -> None:
        total_est = self.RECENT_LIMIT
        scanned   = 0

        def on_batch(cnt: int):
            nonlocal scanned
            scanned = cnt
            elapsed = time.time() - self._start_time
            rate    = cnt / elapsed if elapsed > 0 else 1
            eta     = (total_est - cnt) / rate if rate > 0 else None
            self._emit(
                "StudioScanProgress",
                jobId=self.job_id,
                phase="recent",
                scanned=cnt,
                totalEstimated=total_est,
                elapsedSeconds=round(elapsed, 1),
                estimatedTotalSeconds=round(eta, 0) if eta else None,
                stats=self.stats.to_dict(),
            )

        try:
            async for msg in self.resilient.iter_messages_safe(
                self.entity,
                limit=self.RECENT_LIMIT,
                batch_size=self.BATCH_SIZE,
                reply_to=self._reply_to_filter(),
                emit_batch_cb=on_batch,
            ):
                self._process_message(msg)
                self.stats.recent_scanned += 1

        except CircuitBreakerOpen:
            self.stats.circuit_open = True
            log.warning("[SmartScanner] Circuit open during recent scan")

    # ────────────────────────────────────────────────────────────────
    # Phase 2 — Historical Adaptive Sampling
    # ────────────────────────────────────────────────────────────────

    async def _phase_sampling(self) -> None:
        step          = self.SAMPLING_INIT_STEP
        offset        = self.SAMPLING_START
        empty_streak  = 0
        total_sampled = 0

        while True:
            if self.stats.circuit_open:
                break

            hits_before = len(self.index)
            batch_count = 0

            try:
                async for msg in self.resilient.iter_messages_safe(
                    self.entity,
                    limit=self.BATCH_SIZE,
                    batch_size=self.BATCH_SIZE,
                    offset_id=offset,
                    reply_to=self._reply_to_filter(),
                ):
                    self._process_message(msg)
                    batch_count += 1
                    self.stats.sampled_scanned += 1
                    total_sampled += 1

            except CircuitBreakerOpen:
                self.stats.circuit_open = True
                break

            hits_after  = len(self.index)
            hits_in_batch = hits_after - hits_before

            elapsed = time.time() - self._start_time
            self._emit(
                "StudioScanProgress",
                jobId=self.job_id,
                phase="sampling",
                scanned=self.stats.total_scanned,
                totalEstimated=None,
                elapsedSeconds=round(elapsed, 1),
                estimatedTotalSeconds=None,
                stats=self.stats.to_dict(),
            )

            if batch_count == 0:
                break  # reached end of history

            # Adaptive step adjustment
            if hits_in_batch > 5:
                step = max(self.BATCH_SIZE, step // 2)
                empty_streak = 0
            elif hits_in_batch == 0:
                empty_streak += 1
                if empty_streak >= self.SAMPLING_EMPTY_STOP:
                    log.info("[SmartScanner] 3 empty batches, stopping sampling")
                    break
                step = min(self.SAMPLING_MAX_STEP, step * 2)
            else:
                empty_streak = 0
                step = min(self.SAMPLING_MAX_STEP, step * 2)

            offset += batch_count

    # ────────────────────────────────────────────────────────────────
    # Phase 3 — Forensic Full Scan
    # ────────────────────────────────────────────────────────────────

    async def _phase_forensic(self) -> None:
        """Full unlimited scan with checkpointing every 1000 messages."""
        offset   = self.RECENT_LIMIT
        scanned  = self.stats.total_scanned

        while True:
            if self.stats.circuit_open:
                break

            batch_count = 0
            try:
                async for msg in self.resilient.iter_messages_safe(
                    self.entity,
                    limit=self.BATCH_SIZE,
                    batch_size=self.BATCH_SIZE,
                    offset_id=offset,
                    reply_to=self._reply_to_filter(),
                ):
                    self._process_message(msg)
                    batch_count += 1
                    self.stats.sampled_scanned += 1
                    scanned += 1

            except CircuitBreakerOpen:
                self.stats.circuit_open = True
                break

            if batch_count == 0:
                break

            elapsed = time.time() - self._start_time
            self._emit(
                "StudioScanProgress",
                jobId=self.job_id,
                phase="forensic",
                scanned=scanned,
                totalEstimated=None,
                elapsedSeconds=round(elapsed, 1),
                estimatedTotalSeconds=None,
                stats=self.stats.to_dict(),
            )

            offset += batch_count

            # Yield control to event loop regularly
            await asyncio.sleep(0)

    # ────────────────────────────────────────────────────────────────
    # Helpers
    # ────────────────────────────────────────────────────────────────

    def _reply_to_filter(self) -> Optional[int]:
        """Return the `reply_to` param for iter_messages based on topic scope."""
        if self.topic_scope == "all_topics":
            return None
        if self.topic_id is not None:
            return self.topic_id
        return None

    def _passes_topic_filter(self, msg) -> bool:
        """Check if a message belongs to the allowed topic scope."""
        if self.topic_scope == "all_topics":
            return True
        if self.topic_id is None:
            return True

        msg_topic = getattr(msg, "reply_to", None)
        if msg_topic is not None:
            top_id = getattr(msg_topic, "reply_to_top_id", None)
            reply_id = getattr(msg_topic, "reply_to_msg_id", None)
            effective_topic_id = top_id or reply_id
            if self.topic_scope == "selected_only":
                return effective_topic_id == self.topic_id
            # selected_plus_general: also include msgs without topic (general)
            return effective_topic_id == self.topic_id or effective_topic_id in (None, 1)
        # No reply_to → general chat message
        if self.topic_scope == "selected_plus_general":
            return True
        return False

    def _process_message(self, msg) -> None:
        """Extract fingerprint from a Telegram message and update indices."""
        if not self._passes_topic_filter(msg):
            return

        if not getattr(msg, "media", None):
            self.stats.skipped_no_media += 1
            return

        fp = MediaFingerprint.from_telegram_message(msg)
        if fp is None:
            self.stats.skipped_no_media += 1
            return

        mid = msg.id
        now = int(time.time())

        if fp.primary_hash and fp.primary_hash not in self.index:
            self.index[fp.primary_hash] = mid
            self.stats.new_from_tg += 1

            # Cache entry for DB persistence
            self._new_entries.append({
                "target_entity_id": self.entity_id,
                "topic_id":         self.topic_id,
                "file_unique_id":   fp.file_unique_id,
                "file_name":        fp.file_name,
                "file_size":        fp.file_size,
                "media_type":       fp.media_type,
                "fingerprint_tier": fp.tier,
                "fingerprint_hash": fp.primary_hash,
                "width":            fp.width,
                "height":           fp.height,
                "duration":         fp.duration,
                "mime_type":        fp.mime_type,
                "message_id":       mid,
                "scanned_at":       now,
                "is_alive":         1,
            })
        else:
            self.stats.duplicate_hits += 1

        # Secondary hashes
        for sh in fp.secondary_hashes:
            if sh not in self.index:
                self.index[sh] = mid

        # Name+Size index
        if fp.file_name and fp.file_size:
            key = (fp.file_name.lower(), fp.file_size)
            if key not in self.ns_index:
                self.ns_index[key] = mid

        # file_unique_id index
        if fp.file_unique_id and fp.file_unique_id not in self.uid_index:
            self.uid_index[fp.file_unique_id] = mid

    # ── Public lookup helpers ────────────────────────────────────────

    def lookup(self, fp: MediaFingerprint, *, strict: bool = False) -> Optional[int]:
        """
        Check if a source fingerprint matches anything in the index.
        Returns the destination message_id or None.
        """
        from engine.fingerprint_engine import match_fingerprints

        # Direct primary hash lookup (O(1))
        if fp.primary_hash and fp.primary_hash in self.index:
            return self.index[fp.primary_hash]

        # SHA-256 exact match
        if fp.sha256 and f"sha256:{fp.sha256}" in self.index:
            return self.index[f"sha256:{fp.sha256}"]

        # Secondary hash lookup
        for sh in fp.secondary_hashes:
            if sh in self.index:
                return self.index[sh]

        if not strict:
            # Name+Size fallback
            if fp.file_name and fp.file_size:
                key = (fp.file_name.lower(), fp.file_size)
                mid = self.ns_index.get(key)
                if mid:
                    return mid

            # file_unique_id fallback
            if fp.file_unique_id:
                mid = self.uid_index.get(fp.file_unique_id)
                if mid:
                    return mid

        return None
