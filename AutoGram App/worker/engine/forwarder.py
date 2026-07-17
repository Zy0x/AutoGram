import os
import datetime
import asyncio
import sys
import time

from telethon import TelegramClient
from telethon.errors import (
    FloodWaitError,
    ChatWriteForbiddenError,
    UserBannedInChannelError,
    ChatIdInvalidError,
)
from telethon.tl.types import MessageMediaDocument, MessageMediaPhoto, DocumentAttributeVideo, DocumentAttributeAudio

from .smart_throttle import SmartThrottle
from .duplicate_checker import DuplicateChecker
from database.queries import (
    create_task,
    update_task_status,
    log_duplicate,
    update_execution_progress,
    update_execution_status,
    get_execution,
    get_failed_source_message_ids,
)
from .events import emit_event
from engine.pause_control import should_pause
from engine.enterprise.filters import message_in_date_range, process_caption


class MigrationForwarder:
    """
    Router + legacy Instant Clone / Clean Copy path.

    Fast Forward always runs via FastForwardEngine. On ChatRestrictedFallback
    with auto_fallback, hands off to EnterpriseEngine Clean Copy.
    """

    def __init__(self, client: TelegramClient, source_entity, dest_entity, execution_id, config):
        self.client = client
        self.source = source_entity
        self.dest = dest_entity
        self.execution_id = execution_id
        self.config = config
        self.throttle = SmartThrottle(
            base_delay_min=config.get('delay_min', 2.0),
            base_delay_max=config.get('delay_max', 5.0),
        )
        self.duplicate_checker = DuplicateChecker(str(self.dest))
        self.has_failed_tasks = False
        self.success_count = 0
        self.skipped_count = 0
        self.failed_count_val = 0
        self.start_time = None

    def _passes_media_filter(self, media) -> bool:
        f = self.config.get('media_filter', 'all')
        if f in ("all", "Semua"):
            return True

        is_photo = isinstance(media, MessageMediaPhoto)
        is_video = False
        is_audio = False
        is_voice = False
        is_gif = False
        is_doc = False

        if isinstance(media, MessageMediaDocument):
            is_doc = True
            for attr in media.document.attributes:
                if isinstance(attr, DocumentAttributeVideo):
                    is_video = True
                    is_doc = False
                elif isinstance(attr, DocumentAttributeAudio):
                    if attr.voice:
                        is_voice = True
                    else:
                        is_audio = True
                    is_doc = False
            mime = getattr(media.document, 'mime_type', '') or ''
            if mime == 'image/gif':
                is_gif = True
                is_doc = False

        if f in ("photo", "Foto") and is_photo:
            return True
        if f in ("video", "Video") and is_video:
            return True
        if f in ("document", "Dokumen") and is_doc:
            return True
        if f in ("audio", "Audio") and is_audio:
            return True
        if f in ("voice", "Voice") and is_voice:
            return True
        if f in ("gif", "GIF") and is_gif:
            return True
        return False

    def _passes_size_filter(self, media) -> bool:
        min_mb = self.config.get('size_min_mb') or self.config.get('min_size_mb') or 0
        max_mb = self.config.get('size_max_mb') or self.config.get('max_size_mb') or 0

        if min_mb == 0 and max_mb == 0:
            return True

        size_bytes = 0
        if isinstance(media, MessageMediaDocument):
            size_bytes = media.document.size
        elif isinstance(media, MessageMediaPhoto):
            size_bytes = max([sz.size for sz in media.photo.sizes if hasattr(sz, 'size')] + [0])

        size_mb = size_bytes / (1024 * 1024)
        if min_mb > 0 and size_mb < min_mb:
            return False
        if max_mb > 0 and size_mb > max_mb:
            return False
        return True

    def _seed_enterprise_mapping_from_ff_tasks(self):
        """Mark FF-completed source messages as VERIFIED in enterprise message_mapping."""
        if not self.execution_id:
            return
        import sqlite3
        from database.db import get_connection
        from engine.enterprise.database import record_mapping

        job_id = self.config.get('job_id')
        if job_id is None:
            return
        source_chat_id = (
            getattr(self.source, 'channel_id', None)
            or getattr(self.source, 'chat_id', None)
            or getattr(self.source, 'user_id', None)
            or 0
        )
        dest_chat_id = (
            getattr(self.dest, 'channel_id', None)
            or getattr(self.dest, 'chat_id', None)
            or getattr(self.dest, 'user_id', None)
            or 0
        )

        conn = get_connection()
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            '''
            SELECT source_message_id, target_message_id FROM tasks
            WHERE execution_id = ? AND status = 'DONE' AND source_message_id IS NOT NULL
            ''',
            (self.execution_id,),
        )
        rows = cur.fetchall()
        conn.close()
        seq = 1
        for r in rows:
            sid = r['source_message_id']
            tid = r['target_message_id'] or 0
            try:
                record_mapping(
                    job_id,
                    source_chat_id,
                    sid,
                    dest_chat_id,
                    tid,
                    seq,
                    'FF_NATIVE',
                    'VERIFIED',
                )
                seq += 1
            except Exception:
                continue

    async def execute_migration(self, limit=10):
        self.start_time = time.time()
        job_id = self.config.get('job_id')
        emit_event('ExecutionStarting', execution_id=self.execution_id, jobId=job_id, limit=limit)

        mode = self.config.get('transfer_mode') or self.config.get('mode') or 'Clean Copy'

        # ── Fast Forward: single production engine ──────────────────────────
        if mode == "Fast Forward":
            from .fast_forward import FastForwardEngine, ChatRestrictedFallback

            ff_engine = FastForwardEngine(
                self.client, self.source, self.dest, self.execution_id, self.config
            )
            try:
                await ff_engine.execute_migration(limit=limit)
                return
            except ChatRestrictedFallback as e:
                if not self.config.get('auto_fallback'):
                    emit_event(
                        'FatalError',
                        error=f"Forward restricted and Auto-Fallback is off: {e.reason}",
                    )
                    if self.execution_id:
                        update_execution_status(
                            self.execution_id,
                            'FAILED',
                            f"Forward restricted (auto_fallback=off): {e.reason}",
                        )
                    emit_event(
                        'ExecutionFinished',
                        final_state='FAILED',
                        status='FAILED',
                        processed=ff_engine.progress.processed,
                        success=ff_engine.progress.success,
                        failed=ff_engine.progress.failed,
                        skipped=ff_engine.progress.skipped,
                        duration=time.time() - self.start_time,
                        total=limit,
                        jobId=job_id,
                    )
                    return

                self.config['transfer_mode'] = 'Clean Copy'
                self.config['mode'] = 'Clean Copy'
                self.config['fell_back_from_ff'] = True
                emit_event(
                    'FallbackTriggered',
                    reason=e.reason,
                    new_mode='Clean Copy',
                    from_mode='Fast Forward',
                )
                emit_event(
                    'LogEvent',
                    level='WARNING',
                    message=f'Beralih ke Clean Copy (Enterprise) karena restriksi: {e.reason}',
                )
                try:
                    self._seed_enterprise_mapping_from_ff_tasks()
                except Exception as seed_err:
                    emit_event('LogEvent', level='WARNING', message=f'Mapping seed partial: {seed_err}')
                try:
                    from engine.enterprise.engine import EnterpriseEngine

                    enterprise = EnterpriseEngine(
                        self.client, self.source, self.dest, self.execution_id, self.config
                    )
                    await enterprise.execute_migration(limit=limit)
                    return
                except Exception as ee:
                    emit_event('FatalError', error=f"Clean Copy fallback failed: {ee}")
                    if self.execution_id:
                        update_execution_status(self.execution_id, 'FAILED', str(ee))
                    raise

        # ── Legacy path: Instant Clone / accidental Clean Copy via forwarder ─
        emit_event('ExecutionStarted', execution_id=self.execution_id, jobId=job_id, limit=limit)

        processed_count = 0
        total_size_bytes = 0
        dry_run = bool(self.config.get('dry_run'))
        reverse_flag = self.config.get('fetch_direction') == "Oldest First"
        total_display = limit if limit and limit > 0 else 0
        rerun_mode = self.config.get('rerun_mode', 'RESUME')
        is_retry = bool(self.config.get('is_retry'))

        last_processed_id = 0
        if self.execution_id and not is_retry:
            execution_data = get_execution(self.execution_id)
            if execution_data:
                last_processed_id = execution_data.get('last_processed_id') or 0
                processed_count = execution_data.get('processed_messages') or 0

        target_topic = self.config.get('source_topic_id')
        iter_kwargs = {'reverse': reverse_flag}
        if target_topic:
            iter_kwargs['reply_to'] = target_topic

        if last_processed_id > 0 and (not is_retry or rerun_mode == 'RESUME'):
            if reverse_flag:
                iter_kwargs['min_id'] = last_processed_id
            else:
                iter_kwargs['max_id'] = last_processed_id

        buffer = []
        current_group_id = None
        album_handling = self.config.get('album_handling', 'Follow Source')

        async def flush_buffer():
            nonlocal buffer, processed_count, total_size_bytes, current_group_id
            if not buffer:
                return

            mode_local = self.config.get('transfer_mode') or self.config.get('mode') or 'Clean Copy'

            item_ids = []
            for m in buffer:
                processed_count += 1
                f_uid = None
                if m.media and hasattr(m.media, 'document'):
                    f_uid = str(m.media.document.id)
                elif m.media and hasattr(m.media, 'photo'):
                    f_uid = str(m.media.photo.id)

                task_id = create_task(self.execution_id, m.id, f_uid, None, None, None, "RUNNING")
                item_ids.append((task_id, m, f_uid))
                emit_event('TaskStarted', task_id=task_id, source_message_id=m.id)

            if not dry_run:
                await self.throttle.human_delay(mode=mode_local)

            try:
                caption_text = ""
                for _, m, _ in item_ids:
                    if m.message:
                        caption_text = m.message
                        break
                caption_text = process_caption(caption_text, self.config)

                sent_msg = None
                if not dry_run:
                    if mode_local == 'Instant Clone':
                        sent_msg = await self.client.send_file(
                            self.dest,
                            file=[m.media for _, m, _ in item_ids if m.media],
                            caption=caption_text,
                            reply_to=self.config.get('dest_topic_id'),
                        )
                    else:
                        downloaded_paths = []
                        try:
                            for _, m, _ in item_ids:
                                fpath = await self.client.download_media(m, file=f"temp_album_{m.id}")
                                if fpath:
                                    downloaded_paths.append(fpath)

                            if downloaded_paths:
                                sent_msg = await self.client.send_file(
                                    self.dest,
                                    file=downloaded_paths,
                                    caption=caption_text,
                                    reply_to=self.config.get('dest_topic_id'),
                                )
                            elif any((m.text or m.message) for _, m, _ in item_ids):
                                text_body = caption_text or next(
                                    (m.text or m.message for _, m, _ in item_ids if (m.text or m.message)),
                                    "",
                                )
                                sent_msg = await self.client.send_message(
                                    self.dest,
                                    text_body,
                                    reply_to=self.config.get('dest_topic_id'),
                                )
                            else:
                                raise Exception("Gagal mengunduh isi album.")
                        finally:
                            for fpath in downloaded_paths:
                                try:
                                    if os.path.exists(fpath):
                                        os.remove(fpath)
                                except Exception:
                                    pass

                    sent_msg_id = (
                        sent_msg[-1].id
                        if isinstance(sent_msg, list)
                        else sent_msg.id
                        if sent_msg
                        else 0
                    )
                else:
                    sent_msg_id = 0

                for t_id, m, f_uid in item_ids:
                    update_task_status(t_id, "DONE", sent_msg_id)
                    self.success_count += 1
                    emit_event('TaskCompleted', task_id=t_id, target_message_id=sent_msg_id)
                    if f_uid and not dry_run:
                        log_duplicate(f_uid, str(self.dest), sent_msg_id)

                if self.execution_id:
                    update_execution_progress(
                        self.execution_id, item_ids[-1][1].id, processed_count, limit
                    )
                    emit_event(
                        'ProgressUpdated',
                        processed=processed_count,
                        total=limit,
                        current_id=item_ids[-1][1].id,
                    )

                if not dry_run:
                    self.throttle.reset_health()

            except FloodWaitError as e:
                emit_event('FloodWait', seconds=e.seconds)
                if e.seconds > 900:
                    print(
                        f"[ERROR] FloodWait terlalu lama ({e.seconds} detik > 900 detik). Membatalkan migrasi untuk keamanan.",
                        file=sys.stderr,
                    )
                    raise e

                if not dry_run:
                    await self.throttle.handle_flood_wait(e)
                try:
                    if not dry_run:
                        if mode_local == 'Instant Clone':
                            sent_msg = await self.client.send_file(
                                self.dest,
                                file=[m.media for _, m, _ in item_ids if m.media],
                                caption=caption_text,
                                reply_to=self.config.get('dest_topic_id'),
                            )
                        else:
                            raise e
                        sent_msg_id = (
                            sent_msg[-1].id
                            if isinstance(sent_msg, list)
                            else sent_msg.id
                            if sent_msg
                            else 0
                        )
                    else:
                        sent_msg_id = 0

                    for t_id, m, f_uid in item_ids:
                        update_task_status(t_id, "DONE", sent_msg_id)
                        self.success_count += 1
                        emit_event('TaskCompleted', task_id=t_id, target_message_id=sent_msg_id)
                        if f_uid and not dry_run:
                            log_duplicate(f_uid, str(self.dest), sent_msg_id)
                except Exception as retry_e:
                    self.has_failed_tasks = True
                    for t_id, _, _ in item_ids:
                        update_task_status(
                            t_id, "FAILED", error_category="FloodWait", error_message=str(retry_e)
                        )
                        self.failed_count_val += 1
                        emit_event('TaskFailed', task_id=t_id, error=str(retry_e))

            except (ChatWriteForbiddenError, UserBannedInChannelError, ChatIdInvalidError) as e:
                self.has_failed_tasks = True
                for t_id, _, _ in item_ids:
                    update_task_status(
                        t_id, "FAILED", error_category="Permission Denied", error_message=str(e)
                    )
                    self.failed_count_val += 1
                    emit_event('TaskFailed', task_id=t_id, error=str(e))
                raise StopAsyncIteration(f"Fatal Error: Banned or No Permission - {str(e)}")

            except StopAsyncIteration:
                raise

            except Exception as e:
                self.has_failed_tasks = True
                for t_id, _, _ in item_ids:
                    update_task_status(
                        t_id, "FAILED", error_category="General", error_message=str(e)
                    )
                    self.failed_count_val += 1
                    emit_event('TaskFailed', task_id=t_id, error=str(e))

            buffer.clear()
            current_group_id = None

        async def message_generator():
            prior_exec = self.config.get('prior_execution_id')
            if is_retry and rerun_mode == 'RESUME' and prior_exec:
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
            async for m in self.client.iter_messages(self.source, **iter_kwargs):
                yield m

        try:
            async for message in message_generator():
                if should_pause(self.execution_id):
                    await flush_buffer()
                    if self.execution_id:
                        update_execution_status(self.execution_id, 'PAUSED')
                    emit_event(
                        'ExecutionFinished',
                        final_state='PAUSED',
                        status='PAUSED',
                        processed=processed_count,
                        total=total_display,
                        jobId=job_id,
                    )
                    return

                if limit > 0 and processed_count + len(buffer) >= limit:
                    await flush_buffer()
                    break

                if not message_in_date_range(message, self.config):
                    continue

                if not message.media and not message.text:
                    continue

                if message.media and not self._passes_media_filter(message.media):
                    continue

                if message.media and not self._passes_size_filter(message.media):
                    continue

                file_uid = None
                file_name = None
                file_size = None
                if message.media and hasattr(message.media, 'document') and message.media.document:
                    file_uid = str(message.media.document.id)
                    file_size = getattr(message.media.document, 'size', None)
                    for attr in message.media.document.attributes:
                        if hasattr(attr, 'file_name') and attr.file_name:
                            file_name = attr.file_name
                            break
                elif message.media and hasattr(message.media, 'photo') and message.media.photo:
                    file_uid = str(message.media.photo.id)

                dup_action = self.config.get('duplicate_action') or self.config.get('dupAction', 'Skip')
                skip_dups = dup_action == 'Skip' and not (is_retry and rerun_mode == 'OVERWRITE')
                if file_uid and skip_dups:
                    dup_target_msg_id = self.duplicate_checker.get_duplicate_message_id(
                        file_unique_id=file_uid, file_name=file_name, file_size=file_size
                    )
                    if dup_target_msg_id:
                        processed_count += 1
                        self.skipped_count += 1
                        task_id = create_task(
                            self.execution_id, message.id, file_uid, None, None, None, "SKIPPED"
                        )
                        emit_event('TaskSkipped', task_id=task_id, reason="Duplicate")
                        if self.execution_id:
                            update_execution_progress(
                                self.execution_id, message.id, processed_count, total_display or None
                            )
                            emit_event(
                                'ProgressUpdated',
                                processed=processed_count,
                                total=total_display,
                                current_id=message.id,
                                success=self.success_count,
                                skipped=self.skipped_count,
                                failed=self.failed_count_val,
                            )
                        continue

                if album_handling == "Force Split":
                    buffer.append(message)
                    await flush_buffer()
                elif album_handling == "Follow Source":
                    if message.grouped_id:
                        if current_group_id and message.grouped_id != current_group_id:
                            await flush_buffer()
                        current_group_id = message.grouped_id
                        buffer.append(message)
                    else:
                        await flush_buffer()
                        buffer.append(message)
                        await flush_buffer()
                elif album_handling == "Force Group":
                    buffer.append(message)
                    if len(buffer) >= 10:
                        await flush_buffer()

            await flush_buffer()

            if self.execution_id:
                execution_state = get_execution(self.execution_id)
                if execution_state and execution_state.get('status') == 'RUNNING':
                    final_state = 'PARTIAL_SUCCESS' if self.has_failed_tasks else 'COMPLETED'
                    duration = time.time() - self.start_time
                    update_execution_status(self.execution_id, final_state)
                    emit_event(
                        'ExecutionFinished',
                        final_state=final_state,
                        status=final_state,
                        processed=processed_count,
                        success=self.success_count,
                        failed=self.failed_count_val,
                        skipped=self.skipped_count,
                        duration=duration,
                        total=limit,
                        jobId=self.config.get('job_id'),
                    )
        except StopAsyncIteration as e:
            emit_event('FatalError', error=str(e))
            raise e
