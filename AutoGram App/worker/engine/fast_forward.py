"""
Fast Forward engine — Telegram native forward (batch), with resume, pause,
duplicate skip, filters, throttle, and target message mapping.
"""
from __future__ import annotations

import asyncio
import os
import random
import time
from typing import Any, Dict, List, Optional, Tuple

from telethon import TelegramClient
from telethon.errors import (
    FloodWaitError,
    ChatWriteForbiddenError,
    ChatForwardsRestrictedError,
    UserBannedInChannelError,
    ChatIdInvalidError,
)
from telethon.tl.functions.messages import ForwardMessagesRequest
from telethon.tl.types import Message, UpdateMessageID, UpdateNewMessage, UpdateNewChannelMessage

from database.queries import (
    create_tasks_batch,
    update_task_status_batch,
    update_execution_progress,
    update_execution_status,
    get_execution,
    log_duplicates_batch,
    get_failed_source_message_ids,
)
from .events import emit_event
from .pause_control import should_pause, resolve_final_state
from .smart_throttle import SmartThrottle
from .duplicate_checker import DuplicateChecker
from .enterprise.filters import (
    passes_media_filter,
    passes_size_filter,
    message_in_date_range,
)


class ChatRestrictedFallback(Exception):
    """Raised when source forbids forwarding and auto_fallback should take over."""

    def __init__(self, reason: str = "Chat restricted"):
        super().__init__(reason)
        self.reason = reason


class ForwardResult:
    def __init__(
        self,
        status: str,
        messages=None,
        sent_messages=None,
        retry_after: int = 0,
        fallback_required: bool = False,
        error: str = None,
    ):
        self.status = status
        self.messages = messages or []
        self.sent_messages = sent_messages or []
        self.retry_after = retry_after
        self.fallback_required = fallback_required
        self.error = error


class FastForwardProgress:
    def __init__(self, total_messages: int = 0):
        self.total = total_messages
        self.processed = 0
        self.success = 0
        self.failed = 0
        self.skipped = 0
        self.floodwait_count = 0
        self.start_time = time.time()

    @property
    def percentage(self) -> float:
        return (self.processed / self.total) * 100 if self.total > 0 else 0.0

    @property
    def eta_seconds(self) -> Optional[float]:
        if self.processed == 0:
            return None
        elapsed = time.time() - self.start_time
        if elapsed <= 0:
            return None
        rate = self.processed / elapsed
        remaining = max(0, (self.total or self.processed) - self.processed)
        return remaining / rate if rate > 0 else None

    @property
    def speed(self) -> float:
        elapsed = time.time() - self.start_time
        if elapsed <= 0:
            return 0.0
        return round(self.processed / elapsed, 2)


class FastForwardEngine:
    """
    Production Fast Forward path:
    - Streams messages (album-aware batches), no full-history preload
    - Resume via last_processed_id / min_id / max_id
    - Pause → PAUSED (not COMPLETED)
    - Duplicate skip: source message id + file unique id
    - Size/date/media filters via canonical config keys
    - Parses target message IDs from forward results
    - SmartThrottle + FloodWait retry with backoff
    - Respects auto_fallback via ChatRestrictedFallback
    """

    MAX_BATCH = 50
    MAX_FLOOD_RETRIES = 3

    def __init__(
        self,
        client: TelegramClient,
        source_entity,
        dest_entity,
        execution_id,
        config: dict,
    ):
        self.client = client
        self.source = source_entity
        self.dest = dest_entity
        self.execution_id = execution_id
        self.config = config or {}

        delay_min = float(self.config.get("delay_min", 1.0) or 1.0)
        delay_max = float(self.config.get("delay_max", 3.0) or 3.0)
        # Fast Forward defaults slightly snappier than Clean Copy unless throttle enabled
        if not self.config.get("throttle_active"):
            delay_min = min(delay_min, 1.0)
            delay_max = min(delay_max, 2.5)
        self.throttle = SmartThrottle(base_delay_min=delay_min, base_delay_max=delay_max)

        dest_key = self._entity_key(dest_entity)
        self.dup = DuplicateChecker(dest_key)
        self.source_key = self._entity_key(source_entity)

        total_limit = int(self.config.get("limit") or 0)
        self.progress = FastForwardProgress(total_limit)
        self.dry_run = bool(self.config.get("dry_run", False))
        self.paused = False
        self.natural_end = False
        try:
            configured_batch = int(self.config.get("ff_batch_size") or 0)
        except (TypeError, ValueError):
            configured_batch = 0
        # Auto-size batch for huge migrations (10k–100k): larger batches reduce
        # RTT overhead while AIMD still shrinks on FloodWait.
        if configured_batch <= 0:
            if total_limit >= 50_000:
                configured_batch = 50
            elif total_limit >= 10_000:
                configured_batch = 40
            elif total_limit >= 1_000:
                configured_batch = 30
            else:
                configured_batch = 25
        self.batch_size = max(1, min(self.MAX_BATCH, configured_batch))
        self._batch_success_streak = 0
        # Suppress per-task events at scale (UI flood / memory)
        self.detailed_task_events = bool(self.config.get("detailed_task_events", False))
        if total_limit >= 1000 and "detailed_task_events" not in self.config:
            self.detailed_task_events = False
        # Progress DB write cadence for 100k-scale jobs
        self._progress_emit_every = 1
        if total_limit >= 100_000:
            self._progress_emit_every = 25
        elif total_limit >= 10_000:
            self._progress_emit_every = 10
        elif total_limit >= 1_000:
            self._progress_emit_every = 5

    def _record_batch_success(self) -> None:
        """AIMD growth: cautiously increase after sustained successful batches."""
        self._batch_success_streak += 1
        if self._batch_success_streak >= 4 and self.batch_size < self.MAX_BATCH:
            self.batch_size = min(self.MAX_BATCH, self.batch_size + 5)
            self._batch_success_streak = 0

    def _record_batch_pressure(self) -> None:
        """AIMD backoff: halve the next batch after Telegram pressure/errors."""
        self.batch_size = max(1, self.batch_size // 2)
        self._batch_success_streak = 0

    @staticmethod
    def _entity_key(entity) -> str:
        for attr in ("channel_id", "user_id", "chat_id", "id"):
            if hasattr(entity, attr) and getattr(entity, attr) is not None:
                return str(getattr(entity, attr))
        return str(entity)

    def _file_meta(self, message: Message) -> Tuple[Optional[str], Optional[str], Optional[int]]:
        file_uid = None
        file_name = None
        file_size = None
        media = getattr(message, "media", None)
        if not media:
            return None, None, None
        if hasattr(media, "document") and media.document:
            file_uid = str(media.document.id)
            file_size = getattr(media.document, "size", None)
            for attr in media.document.attributes:
                if getattr(attr, "file_name", None):
                    file_name = attr.file_name
                    break
        elif hasattr(media, "photo") and media.photo:
            file_uid = str(media.photo.id)
        return file_uid, file_name, file_size

    def _msgid_key(self, source_message_id: int) -> str:
        return f"msgid:{self.source_key}:{source_message_id}"

    def _is_duplicate(self, message: Message) -> Optional[int]:
        """Return existing target_message_id if should skip."""
        dup_action = self.config.get("duplicate_action") or self.config.get("dupAction") or "Skip"
        is_retry = bool(self.config.get("is_retry"))
        rerun_mode = self.config.get("rerun_mode", "RESUME")
        if is_retry and rerun_mode == "OVERWRITE":
            return None
        if dup_action != "Skip":
            return None

        # Level 0: source message id (most reliable for native forward)
        hit = self.dup.get_duplicate_message_id(file_unique_id=self._msgid_key(message.id))
        if hit:
            return hit

        file_uid, file_name, file_size = self._file_meta(message)
        if file_uid:
            hit = self.dup.get_duplicate_message_id(
                file_unique_id=file_uid, file_name=file_name, file_size=file_size
            )
            if hit:
                return hit
        return None

    def _passes_filters(self, message: Message) -> bool:
        if not message_in_date_range(message, self.config):
            return False
        if not message.media and not (message.text or message.message):
            return False
        if message.media:
            if not passes_media_filter(message.media, self.config):
                return False
            if not passes_size_filter(message.media, self.config):
                return False
        return True

    def _extract_sent_from_updates(self, result) -> List[Any]:
        """Parse ForwardMessagesRequest Updates into message-like objects with .id."""
        sent: List[Any] = []
        if result is None:
            return sent
        # Prefer random_id → id map when present
        id_by_random: Dict[int, int] = {}
        updates = getattr(result, "updates", None) or []
        for u in updates:
            if isinstance(u, UpdateMessageID):
                id_by_random[getattr(u, "random_id", 0)] = getattr(u, "id", 0)
        for u in updates:
            msg = None
            if isinstance(u, (UpdateNewMessage, UpdateNewChannelMessage)):
                msg = getattr(u, "message", None)
            if msg is not None and getattr(msg, "id", None) is not None:
                sent.append(msg)
        # Fallback: unique ids from UpdateMessageID in arrival order
        if not sent and id_by_random:
            for rid in sorted(id_by_random.keys()):
                mid = id_by_random[rid]
                if mid:
                    sent.append(type("Msg", (), {"id": mid})())
        return sent

    async def forward_batch(self, messages: List[Message]) -> ForwardResult:
        if not messages:
            return ForwardResult(status="SUCCESS", messages=[], sent_messages=[])

        if self.dry_run:
            return ForwardResult(status="SUCCESS", messages=messages, sent_messages=[])

        # Check shared rate limiter
        try:
            if hasattr(self.client, "session") and hasattr(self.client.session, "filename"):
                from core.shared_state import SharedRateLimiter
                delay = SharedRateLimiter.get_delay(self.client.session.filename)
                if delay > 0:
                    return ForwardResult(
                        status="FLOOD_WAIT",
                        retry_after=int(delay),
                        messages=messages,
                    )
        except Exception:
            pass

        try:
            await self.throttle.human_delay(
                mode="Fast Forward", batch_size=len(messages)
            )
            # Telethon helper forward_messages() has NO top_msg_id — use raw request
            # so forum/topic destinations work when dest_topic_id is set.
            dest_topic = self.config.get("dest_topic_id")
            from_peer = await self.client.get_input_entity(self.source)
            to_peer = await self.client.get_input_entity(self.dest)
            req_kwargs = {
                "from_peer": from_peer,
                "id": [m.id for m in messages],
                "to_peer": to_peer,
                "random_id": [
                    int.from_bytes(os.urandom(8), "big", signed=True) for _ in messages
                ],
                "drop_author": False,
                "drop_media_captions": False,
            }
            if dest_topic:
                req_kwargs["top_msg_id"] = int(dest_topic)

            result = await self.client(ForwardMessagesRequest(**req_kwargs))
            sent_list = self._extract_sent_from_updates(result)
            # If parsing failed, still treat as success if no exception (IDs optional)
            return ForwardResult(status="SUCCESS", messages=messages, sent_messages=sent_list)

        except FloodWaitError as e:
            self.progress.floodwait_count += 1
            try:
                if hasattr(self.client, "session") and hasattr(self.client.session, "filename"):
                    from core.shared_state import SharedRateLimiter
                    SharedRateLimiter.record_flood_wait(self.client.session.filename, int(e.seconds))
            except Exception:
                pass
            return ForwardResult(
                status="FLOOD_WAIT",
                retry_after=int(e.seconds),
                messages=messages,
            )

        except (ChatForwardsRestrictedError,) as e:
            return ForwardResult(
                status="RESTRICTED",
                fallback_required=True,
                messages=messages,
                error=str(e),
            )

        except (ChatWriteForbiddenError, UserBannedInChannelError, ChatIdInvalidError) as e:
            return ForwardResult(status="ERROR", error=str(e), messages=messages)

        except Exception as e:
            err = str(e).lower()
            if "forward" in err and ("restrict" in err or "forbidden" in err):
                return ForwardResult(
                    status="RESTRICTED",
                    fallback_required=True,
                    messages=messages,
                    error=str(e),
                )
            return ForwardResult(status="ERROR", error=str(e), messages=messages)

    def _map_sent_ids(
        self, source_msgs: List[Message], sent_msgs: List[Any]
    ) -> Dict[int, int]:
        """Map source message id → destination message id (positional)."""
        mapping: Dict[int, int] = {}
        if not sent_msgs:
            return mapping
        # Prefer positional pairing (forward preserves order)
        for i, src in enumerate(source_msgs):
            if i < len(sent_msgs) and sent_msgs[i] is not None:
                tid = getattr(sent_msgs[i], "id", None)
                if tid is not None:
                    mapping[src.id] = int(tid)
        return mapping

    async def _handle_batch(self, batch: List[Message], limit: int) -> bool:
        """
        Process one batch. Returns False if caller should stop (pause/restrict/fatal).
        """
        if not batch:
            return True

        # Resolve duplicate keys for the whole batch with one DB connection.
        dup_action = self.config.get("duplicate_action") or self.config.get("dupAction") or "Skip"
        skip_duplicates = not (
            bool(self.config.get("is_retry"))
            and self.config.get("rerun_mode", "RESUME") == "OVERWRITE"
        ) and dup_action == "Skip"

        message_meta = []
        duplicate_keys = []
        for message in batch:
            file_uid, file_name, file_size = self._file_meta(message)
            msgid_key = self._msgid_key(message.id)
            keys = [msgid_key]
            if file_uid:
                keys.append(str(file_uid))
            if file_name is not None and file_size is not None:
                keys.append(f"name:{file_name}|{file_size}")
            message_meta.append((message, file_uid, file_name, file_size, keys))
            if skip_duplicates:
                duplicate_keys.extend(keys)

        duplicate_hits = (
            self.dup.get_duplicate_message_ids(duplicate_keys)
            if skip_duplicates
            else {}
        )

        task_rows = []
        decisions = []
        for message, file_uid, file_name, file_size, keys in message_meta:
            dup_target = next(
                (duplicate_hits[key] for key in keys if duplicate_hits.get(key)),
                None,
            )
            status = "SKIPPED" if dup_target is not None else "RUNNING"
            task_rows.append(
                (
                    self.execution_id,
                    message.id,
                    file_uid,
                    None,
                    file_name,
                    file_size,
                    status,
                )
            )
            decisions.append((message, file_uid, dup_target))

        task_ids = create_tasks_batch(task_rows)
        if len(task_ids) != len(decisions):
            raise RuntimeError("Task batch insert returned an invalid task-id count")

        self.progress.processed += len(batch)
        to_send: List[Message] = []
        task_meta: List[Tuple[int, Message, Optional[str]]] = []  # task_id, msg, file_uid

        for task_id, (message, file_uid, dup_target) in zip(task_ids, decisions):
            if dup_target is not None:
                self.progress.skipped += 1
                if self.detailed_task_events:
                    emit_event(
                        "TaskSkipped",
                        task_id=task_id,
                        reason="Duplicate",
                        source_message_id=message.id,
                    )
                continue

            task_meta.append((task_id, message, file_uid))
            to_send.append(message)
            if self.detailed_task_events:
                emit_event(
                    "TaskStarted", task_id=task_id, source_message_id=message.id
                )

        emit_event(
            "BatchStarted",
            count=len(to_send),
            skipped=len(batch) - len(to_send),
            first_source_id=batch[0].id,
            last_source_id=batch[-1].id,
            batch_size=self.batch_size,
        )

        if not to_send:
            emit_event("BatchSkipped", count=len(batch), reason="Duplicate")
            self._emit_progress(limit, batch[-1].id if batch else 0)
            return True

        res = await self.forward_batch(to_send)

        # FloodWait: retry with SmartThrottle
        attempt = 0
        while res.status == "FLOOD_WAIT" and attempt < self.MAX_FLOOD_RETRIES:
            attempt += 1
            self._record_batch_pressure()
            emit_event("FloodWait", seconds=res.retry_after, attempt=attempt)
            try:
                # Build a fake FloodWaitError-like wait via throttle
                wait = int(res.retry_after) + random.uniform(2, 5)
                if wait > 900:
                    emit_event(
                        "FatalError",
                        error=f"FloodWait too long ({res.retry_after}s). Stopping for safety.",
                    )
                    update_task_status_batch([
                        (
                            "FAILED",
                            None,
                            "FloodWait",
                            f"FloodWait {res.retry_after}s too long",
                            task_id,
                        )
                        for task_id, _, _ in task_meta
                    ])
                    self.progress.failed += len(task_meta)
                    emit_event(
                        "BatchFailed",
                        count=len(task_meta),
                        error="FloodWait too long",
                    )
                    return False
                await asyncio.sleep(wait)
                self.throttle.base_delay_min += 0.5
                self.throttle.base_delay_max += 1.0
            except Exception:
                await asyncio.sleep(int(res.retry_after) + 3)
            res = await self.forward_batch(to_send)

        if res.status == "RESTRICTED":
            emit_event(
                "FallbackTriggered",
                reason=res.error or "Forward restricted",
                new_mode="Clean Copy",
            )
            # Mark in-flight tasks failed so Clean Copy can pick them up as needed
            update_task_status_batch([
                (
                    "FAILED",
                    None,
                    "Restricted",
                    res.error or "Forward restricted",
                    task_id,
                )
                for task_id, _, _ in task_meta
            ])
            self.progress.failed += len(task_meta)
            emit_event(
                "BatchFailed",
                count=len(task_meta),
                error=res.error or "Restricted",
            )
            if self.config.get("auto_fallback"):
                raise ChatRestrictedFallback(res.error or "Forward restricted")
            return False

        if res.status == "SUCCESS":
            id_map = self._map_sent_ids(to_send, res.sent_messages)
            status_rows = []
            duplicate_rows = []
            for t_id, m, file_uid in task_meta:
                target_id = id_map.get(m.id, 0)
                status_rows.append(("DONE", target_id if target_id else 0, None, None, t_id))
                self.progress.success += 1
                if self.detailed_task_events:
                    emit_event(
                        "TaskCompleted",
                        task_id=t_id,
                        target_message_id=target_id or 0,
                    )
                if not self.dry_run:
                    duplicate_rows.append(
                        (
                            self._msgid_key(m.id),
                            self.dup.target_entity_id,
                            target_id or 0,
                        )
                    )
                    if file_uid:
                        duplicate_rows.append(
                            (file_uid, self.dup.target_entity_id, target_id or 0)
                        )
            update_task_status_batch(status_rows)
            if duplicate_rows:
                log_duplicates_batch(duplicate_rows)
            emit_event(
                "BatchCompleted",
                count=len(task_meta),
                first_source_id=to_send[0].id,
                last_source_id=to_send[-1].id,
            )
            self._record_batch_success()
            if not self.dry_run:
                self.throttle.reset_health()
        else:
            self.progress.failed += len(task_meta)
            self._record_batch_pressure()
            update_task_status_batch([
                (
                    "FAILED",
                    None,
                    "General",
                    res.error or "Forward failed",
                    task_id,
                )
                for task_id, _, _ in task_meta
            ])
            emit_event(
                "BatchFailed",
                count=len(task_meta),
                error=res.error or "Forward failed",
            )

        last_id = batch[-1].id
        self._emit_progress(limit, last_id)
        return True

    def _emit_progress(self, limit: int, current_id: int, *, force: bool = False) -> None:
        total = limit if limit and limit > 0 else self.progress.processed
        every = max(1, int(getattr(self, "_progress_emit_every", 1) or 1))
        if (
            not force
            and every > 1
            and self.progress.processed % every != 0
            and (not limit or self.progress.processed < limit)
        ):
            return
        if self.execution_id:
            update_execution_progress(
                self.execution_id,
                current_id,
                self.progress.processed,
                limit if limit and limit > 0 else None,
            )
        emit_event(
            "ProgressUpdated",
            processed=self.progress.processed,
            total=total,
            current_id=current_id,
            success=self.progress.success,
            skipped=self.progress.skipped,
            failed=self.progress.failed,
            speed=self.progress.speed,
            eta=self.progress.eta_seconds,
            batch_size=self.batch_size,
        )

    async def _iter_messages(self, limit: int):
        reverse_flag = self.config.get("fetch_direction") == "Oldest First"
        is_retry = bool(self.config.get("is_retry"))
        rerun_mode = self.config.get("rerun_mode", "RESUME")

        # Resume from last_processed_id
        last_processed_id = 0
        if self.execution_id and not is_retry:
            execution_data = get_execution(self.execution_id)
            if execution_data:
                last_processed_id = execution_data.get("last_processed_id") or 0
                prev_processed = execution_data.get("processed_messages") or 0
                if prev_processed and self.progress.processed == 0:
                    self.progress.processed = int(prev_processed)

        # Retry RESUME with prior failed ids only
        prior_exec = self.config.get("prior_execution_id")
        if is_retry and rerun_mode == "RESUME" and prior_exec:
            try:
                failed_ids = get_failed_source_message_ids(prior_exec)
            except Exception:
                failed_ids = []
            if failed_ids:
                failed_ids.sort(reverse=not reverse_flag)
                for i in range(0, len(failed_ids), 100):
                    chunk = failed_ids[i : i + 100]
                    msgs = await self.client.get_messages(self.source, ids=chunk)
                    for m in msgs:
                        if m:
                            yield m
                return

        # Soft resume on retry without failed-id list
        if is_retry and rerun_mode == "RESUME" and last_processed_id <= 0:
            execution_data = get_execution(self.execution_id) if self.execution_id else None
            if execution_data:
                last_processed_id = execution_data.get("last_processed_id") or 0

        iter_kwargs: Dict[str, Any] = {"reverse": reverse_flag}
        target_topic = self.config.get("source_topic_id")
        if target_topic:
            iter_kwargs["reply_to"] = target_topic

        if last_processed_id > 0 and (not is_retry or rerun_mode == "RESUME"):
            if reverse_flag:
                iter_kwargs["min_id"] = last_processed_id
            else:
                iter_kwargs["max_id"] = last_processed_id

        async for m in self.client.iter_messages(self.source, **iter_kwargs):
            yield m

    async def execute_migration(self, limit: int = 0):
        job_id = self.config.get("job_id")
        emit_event(
            "ExecutionStarted",
            execution_id=self.execution_id,
            jobId=job_id,
            limit=limit,
            mode="Fast Forward",
        )

        # Preflight
        try:
            full = await self.client.get_entity(self.source)
            if bool(getattr(full, "noforwards", False)):
                reason = "Source chat has forwarding restricted (noforwards)"
                emit_event("FallbackTriggered", reason=reason, new_mode="Clean Copy")
                if self.config.get("auto_fallback"):
                    raise ChatRestrictedFallback(reason)
                if self.execution_id:
                    update_execution_status(
                        self.execution_id,
                        "FAILED",
                        "Forward restricted; Auto-Fallback disabled",
                    )
                emit_event(
                    "ExecutionFinished",
                    final_state="FAILED",
                    status="FAILED",
                    processed=0,
                    success=0,
                    failed=0,
                    skipped=0,
                    duration=0,
                    total=limit,
                    jobId=job_id,
                    error=reason,
                )
                return
        except ChatRestrictedFallback:
            raise
        except Exception:
            pass

        buffer: List[Message] = []
        current_group_id = None
        stop = False
        scanned = 0
        # Safety: stop iterating after N raw messages when filters reject most history
        # (e.g. date range with no matches). 0 = unlimited / auto for large limits.
        try:
            max_scan = int(self.config.get("max_scan") or 0)
        except (TypeError, ValueError):
            max_scan = 0
        if max_scan <= 0 and limit and limit > 0:
            # Bound worst-case O(history) when filters are sparse, without
            # materializing the full chat into memory.
            max_scan = max(limit * 20, 50_000)
            if limit >= 100_000:
                max_scan = max(limit * 5, 500_000)

        async def flush() -> bool:
            nonlocal buffer, current_group_id
            if not buffer:
                return True
            batch = list(buffer)
            buffer.clear()
            current_group_id = None
            return await self._handle_batch(batch, limit)

        try:
            async for message in self._iter_messages(limit):
                if should_pause(self.execution_id):
                    self.paused = True
                    await flush()
                    break

                if limit > 0 and self.progress.processed >= limit:
                    self.natural_end = True
                    break

                scanned += 1
                if max_scan > 0 and scanned >= max_scan:
                    self.natural_end = True
                    emit_event(
                        "LogEvent",
                        level="INFO",
                        message=f"max_scan={max_scan} reached (processed={self.progress.processed})",
                    )
                    break

                if not self._passes_filters(message):
                    continue

                # Would exceed limit — flush current and stop after
                if (
                    limit > 0
                    and self.progress.processed + len(buffer) >= limit
                    and not (
                        current_group_id is not None
                        and message.grouped_id == current_group_id
                    )
                ):
                    ok = await flush()
                    if not ok:
                        stop = True
                    self.natural_end = True
                    break

                remaining = (
                    (limit - self.progress.processed) if limit and limit > 0 else None
                )
                if remaining is not None and remaining <= 0:
                    self.natural_end = True
                    break

                # Album-aware streaming (always Follow Source for FF)
                if message.grouped_id:
                    # Never mix ordinary messages and an album in one request.
                    if buffer and current_group_id is None:
                        ok = await flush()
                        if not ok:
                            stop = True
                            break
                    elif current_group_id and message.grouped_id != current_group_id:
                        ok = await flush()
                        if not ok:
                            stop = True
                            break
                        if should_pause(self.execution_id):
                            self.paused = True
                            break
                    current_group_id = message.grouped_id
                    buffer.append(message)
                    # If next won't fit in limit, still complete album if already started
                    if remaining is not None and len(buffer) >= remaining and limit > 0:
                        # Keep collecting album pieces only if still same group later
                        pass
                    if len(buffer) >= self.MAX_BATCH:
                        ok = await flush()
                        if not ok:
                            stop = True
                            break
                else:
                    # Finish an open album before collecting ordinary messages.
                    if current_group_id is not None:
                        ok = await flush()
                        if not ok:
                            stop = True
                            break
                    buffer.append(message)
                    ordinary_cap = self.batch_size
                    if remaining is not None:
                        ordinary_cap = max(1, min(ordinary_cap, remaining))
                    if len(buffer) >= ordinary_cap:
                        ok = await flush()
                        if not ok:
                            stop = True
                            break

                if should_pause(self.execution_id):
                    self.paused = True
                    break

                if limit > 0 and self.progress.processed >= limit:
                    self.natural_end = True
                    break

            if not self.paused and not stop:
                await flush()
                if limit <= 0 or self.progress.processed >= limit or not stop:
                    self.natural_end = True

        except ChatRestrictedFallback:
            raise
        except Exception as e:
            emit_event("FatalError", error=str(e))
            if self.execution_id:
                update_execution_status(self.execution_id, "FAILED", str(e))
            emit_event(
                "ExecutionFinished",
                final_state="FAILED",
                status="FAILED",
                processed=self.progress.processed,
                success=self.progress.success,
                failed=self.progress.failed,
                skipped=self.progress.skipped,
                duration=time.time() - self.progress.start_time,
                total=limit,
                jobId=job_id,
            )
            raise

        final_state = resolve_final_state(
            paused=self.paused,
            failed_count=self.progress.failed,
            processed_count=self.progress.processed,
            limit=limit or 0,
            natural_end=self.natural_end and not self.paused,
        )
        if self.execution_id:
            update_execution_status(self.execution_id, final_state)

        emit_event(
            "ExecutionFinished",
            final_state=final_state,
            status=final_state,
            processed=self.progress.processed,
            success=self.progress.success,
            failed=self.progress.failed,
            skipped=self.progress.skipped,
            duration=time.time() - self.progress.start_time,
            total=limit,
            speed=self.progress.speed,
            eta=None if final_state != "PAUSED" else self.progress.eta_seconds,
            jobId=job_id,
        )
