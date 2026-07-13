import asyncio
import time
import random
import json
from telethon import TelegramClient
from telethon.tl.functions.messages import ForwardMessagesRequest
from telethon.errors import FloodWaitError, ChatWriteForbiddenError, ChatForwardsRestrictedError, UserBannedInChannelError, ChatIdInvalidError
from telethon.tl.types import MessageMediaDocument, MessageMediaPhoto, DocumentAttributeVideo, DocumentAttributeAudio

from database.queries import create_task, update_task_status, update_execution_progress, update_execution_status, get_execution, log_duplicate
from .events import emit_event
import sys
import os

class ForwardResult:
    def __init__(self, status, messages=None, retry_after=0, fallback_required=False, error=None):
        self.status = status
        self.messages = messages or []
        self.retry_after = retry_after
        self.fallback_required = fallback_required
        self.error = error

class FilterResult:
    def __init__(self, passed, reason=None, filter_type=None):
        self.passed = passed
        self.reason = reason
        self.filter_type = filter_type

class FastForwardProgress:
    def __init__(self, total_messages):
        self.total = total_messages
        self.processed = 0
        self.success = 0
        self.failed = 0
        self.skipped = 0
        self.floodwait_count = 0
        self.start_time = time.time()

    @property
    def percentage(self):
        return (self.processed / self.total) * 100 if self.total > 0 else 0

    @property
    def eta_seconds(self):
        if self.processed == 0:
            return None
        elapsed = time.time() - self.start_time
        rate = self.processed / elapsed
        remaining = self.total - self.processed
        return remaining / rate if rate > 0 else None

class ForwardBatchBuilder:
    def __init__(self, max_batch_size=100):
        self.max_batch_size = max_batch_size

    def build_batches(self, messages):
        batches = []
        current_batch = []
        current_album_id = None

        for msg in messages:
            if msg.grouped_id:
                if msg.grouped_id != current_album_id:
                    if current_batch:
                        batches.append(current_batch)
                        current_batch = []
                    current_album_id = msg.grouped_id
                
                current_batch.append(msg)
                
                if self.is_album_complete(msg, messages):
                    batches.append(current_batch)
                    current_batch = []
                    current_album_id = None
            else:
                if current_album_id:
                    batches.append(current_batch)
                    current_batch = []
                    current_album_id = None
                
                current_batch.append(msg)
                if len(current_batch) >= self.max_batch_size:
                    batches.append(current_batch)
                    current_batch = []

        if current_batch:
            batches.append(current_batch)
        return batches

    def is_album_complete(self, msg, all_messages):
        idx = all_messages.index(msg)
        if idx + 1 >= len(all_messages):
            return True
        next_msg = all_messages[idx + 1]
        return next_msg.grouped_id != msg.grouped_id

class PerChatRateLimiter:
    def __init__(self, base_delay=1.0):
        self.last_send = {}
        self.min_interval = base_delay
        self.pressure_scores = {}

    async def wait_if_needed(self, chat_id):
        now = time.time()
        if chat_id in self.last_send:
            elapsed = now - self.last_send[chat_id]
            if elapsed < self.min_interval:
                wait_time = self.min_interval - elapsed
                jitter = random.uniform(0.0, 0.3)
                await asyncio.sleep(wait_time + jitter)
        
        self.last_send[chat_id] = time.time()

    def record_floodwait(self, chat_id, retry_after):
        self.pressure_scores[chat_id] = self.pressure_scores.get(chat_id, 0) + 1
        self.min_interval = min(self.min_interval * 1.2, 5.0)

class FastForwardEngine:
    def __init__(self, client: TelegramClient, source_entity, dest_entity, execution_id, config):
        self.client = client
        self.source = source_entity
        self.dest = dest_entity
        self.execution_id = execution_id
        self.config = config
        
        base_delay = config.get('delay_min', 1.0)
        self.rate_limiter = PerChatRateLimiter(base_delay=base_delay)
        
        total_limit = config.get('limit', 0)
        self.progress = FastForwardProgress(total_limit)
        self.batch_builder = ForwardBatchBuilder(max_batch_size=100)
        self.dry_run = config.get('dry_run', False)

    def _passes_media_filter(self, media) -> bool:
        f = self.config.get('media_filter', 'Semua')
        if f == "all" or f == "Semua": return True
            
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
                    if attr.voice: is_voice = True
                    else: is_audio = True
                    is_doc = False
            if media.document.mime_type in ('image/gif', 'video/mp4'):
                if getattr(media.document, 'mime_type', '') == 'image/gif':
                    is_gif = True
                    is_doc = False
                
        if f in ("photo", "Foto") and is_photo: return True
        if f in ("video", "Video") and is_video: return True
        if f in ("document", "Dokumen") and is_doc: return True
        if f in ("audio", "Audio") and is_audio: return True
        if f in ("voice", "Voice") and is_voice: return True
        if f in ("gif", "GIF") and is_gif: return True
        return False

    def _passes_size_filter(self, media) -> bool:
        min_mb = self.config.get('min_size_mb', 0)
        max_mb = self.config.get('max_size_mb', 0)
        if min_mb == 0 and max_mb == 0: return True
            
        size_bytes = 0
        if isinstance(media, MessageMediaDocument):
            size_bytes = media.document.size
        elif isinstance(media, MessageMediaPhoto):
            size_bytes = max([getattr(sz, 'size', 0) for sz in media.photo.sizes] + [0])
            
        size_mb = size_bytes / (1024 * 1024)
        if min_mb > 0 and size_mb < min_mb: return False
        if max_mb > 0 and size_mb > max_mb: return False
        return True

    async def forward_batch(self, messages):
        dest_peer = await self.client.get_input_entity(self.dest)
        source_peer = await self.client.get_input_entity(self.source)
        
        if not self.dry_run:
            dest_id_for_rate = getattr(dest_peer, 'channel_id', getattr(dest_peer, 'user_id', getattr(dest_peer, 'chat_id', 0)))
            await self.rate_limiter.wait_if_needed(dest_id_for_rate)
            
            jitter = random.uniform(0.8, 1.3)
            await asyncio.sleep(self.rate_limiter.min_interval * jitter)

        msg_ids = [m.id for m in messages]
        try:
            if not self.dry_run:
                # Use native forward API
                result = await self.client(ForwardMessagesRequest(
                    from_peer=source_peer,
                    id=msg_ids,
                    to_peer=dest_peer,
                    drop_author=False,
                    drop_media_captions=False,
                    noforwards=False,
                    background=False,
                    with_my_score=False,
                    top_msg_id=self.config.get('dest_topic_id'),
                    schedule_date=None,
                    send_as=None
                ))
            return ForwardResult(status="SUCCESS", messages=messages)

        except FloodWaitError as e:
            if hasattr(dest_peer, 'channel_id'):
                self.rate_limiter.record_floodwait(dest_peer.channel_id, e.seconds)
            return ForwardResult(status="FLOOD_WAIT", retry_after=e.seconds, messages=messages)

        except (ChatWriteForbiddenError, ChatForwardsRestrictedError) as e:
            return ForwardResult(status="RESTRICTED", fallback_required=True, messages=messages, error=str(e))

        except Exception as e:
            return ForwardResult(status="ERROR", error=str(e), messages=messages)

    async def execute_migration(self, limit):
        emit_event('ExecutionStarted', execution_id=self.execution_id, jobId=self.config.get('job_id'), limit=limit)
        
        reverse_flag = (self.config.get('fetch_direction') == "Oldest First")
        iter_kwargs = {'reverse': reverse_flag}
        
        target_topic = self.config.get('source_topic_id')
        if target_topic:
            iter_kwargs['reply_to'] = target_topic

        # Ambil pesan dan simpan di buffer untuk batching
        all_messages_to_process = []
        async for m in self.client.iter_messages(self.source, **iter_kwargs):
            if not m.media and not m.text: continue
            if m.media and not self._passes_media_filter(m.media): continue
            if m.media and not self._passes_size_filter(m.media): continue
            
            all_messages_to_process.append(m)
            if len(all_messages_to_process) >= limit > 0:
                break
                
        batches = self.batch_builder.build_batches(all_messages_to_process)
        
        for batch in batches:
            if self.execution_id:
                exec_data = get_execution(self.execution_id)
                if exec_data and exec_data.get('status') in ['PAUSING', 'STOPPING', 'CANCELLED']:
                    emit_event('StateTransition', from_state=exec_data.get('status'), to_state='PAUSED')
                    break
            
            # Setup tasks in DB
            task_ids = []
            for m in batch:
                self.progress.processed += 1
                t_id = create_task(self.execution_id, m.id, None, None, None, None, "RUNNING")
                task_ids.append((t_id, m))
                emit_event('TaskStarted', task_id=t_id, source_message_id=m.id)

            res = await self.forward_batch(batch)
            
            if res.status == "SUCCESS":
                for t_id, m in task_ids:
                    update_task_status(t_id, "DONE", 0) # Dest ID mapping needs result parsing, simplify for now
                    self.progress.success += 1
                    emit_event('TaskCompleted', task_id=t_id, target_message_id=0)
            elif res.status == "FLOOD_WAIT":
                self.progress.floodwait_count += 1
                emit_event('FloodWait', seconds=res.retry_after)
                await asyncio.sleep(res.retry_after)
                # Retry once
                res_retry = await self.forward_batch(batch)
                if res_retry.status == "SUCCESS":
                    for t_id, m in task_ids:
                        update_task_status(t_id, "DONE", 0)
                        self.progress.success += 1
                        emit_event('TaskCompleted', task_id=t_id, target_message_id=0)
                else:
                    self.progress.failed += len(batch)
                    for t_id, m in task_ids:
                        update_task_status(t_id, "FAILED", error_category="FloodWait", error_message=res_retry.error or "Failed on retry")
                        emit_event('TaskFailed', task_id=t_id, error="Failed on retry")
            elif res.status == "RESTRICTED":
                emit_event('FallbackTriggered', reason=res.error, new_mode='Clean Copy')
                raise Exception("CHAT_RESTRICTED_FALLBACK")
            else:
                self.progress.failed += len(batch)
                for t_id, m in task_ids:
                    update_task_status(t_id, "FAILED", error_category="General", error_message=res.error)
                    emit_event('TaskFailed', task_id=t_id, error=res.error)
                    
            if self.execution_id:
                update_execution_progress(self.execution_id, batch[-1].id, self.progress.processed, limit)
                emit_event('ProgressUpdated', processed=self.progress.processed, total=limit, current_id=batch[-1].id, speed=round(self.progress.processed/(time.time()-self.progress.start_time),2), eta=self.progress.eta_seconds)

        final_state = 'PARTIAL_SUCCESS' if self.progress.failed > 0 else 'COMPLETED'
        if self.execution_id:
            update_execution_status(self.execution_id, final_state)
            
        emit_event('ExecutionFinished', 
            final_state=final_state,
            status=final_state,
            processed=self.progress.processed,
            success=self.progress.success,
            failed=self.progress.failed,
            skipped=self.progress.skipped,
            duration=time.time() - self.progress.start_time,
            total=limit,
            jobId=self.config.get('job_id')
        )
