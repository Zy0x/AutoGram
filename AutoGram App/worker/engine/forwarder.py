import os
import datetime
import asyncio
from telethon import TelegramClient
from telethon.errors import FloodWaitError, ChatForwardsRestrictedError, ChatWriteForbiddenError, UserBannedInChannelError, ChatIdInvalidError
from telethon.tl.types import MessageMediaDocument, MessageMediaPhoto, DocumentAttributeVideo, DocumentAttributeAudio
from .smart_throttle import SmartThrottle
from .duplicate_checker import DuplicateChecker
import json
import sys
import time
from database.queries import create_task, update_task_status, log_duplicate, update_execution_progress, update_execution_status, get_execution, get_failed_source_message_ids
from .events import emit_event

class MigrationForwarder:
    """Mesin Eksekusi Telegram dengan Filter Lanjutan dan Mode Dry Run."""
    
    def __init__(self, client: TelegramClient, source_entity, dest_entity, execution_id, config):
        self.client = client
        self.source = source_entity
        self.dest = dest_entity
        self.execution_id = execution_id
        self.config = config
        self.throttle = SmartThrottle(
            base_delay_min=config.get('delay_min', 2.0),
            base_delay_max=config.get('delay_max', 5.0)
        )
        self.duplicate_checker = DuplicateChecker(str(self.dest))
        self.has_failed_tasks = False
        self.success_count = 0
        self.skipped_count = 0
        self.failed_count_val = 0
        self.start_time = None

    def _passes_media_filter(self, media) -> bool:
        f = self.config['media_filter']
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
            if media.document.mime_type == 'image/gif' or media.document.mime_type == 'video/mp4':
                if getattr(media.document, 'mime_type', '') == 'image/gif':
                    is_gif = True
                    is_doc = False
                
        if f == "photo" and is_photo: return True
        if f == "video" and is_video: return True
        if f == "document" and is_doc: return True
        if f == "audio" and is_audio: return True
        if f == "voice" and is_voice: return True
        if f == "gif" and is_gif: return True
        
        if f == "Foto" and is_photo: return True
        if f == "Video" and is_video: return True
        if f == "Dokumen" and is_doc: return True
        if f == "Audio" and is_audio: return True
        
        return False

    def _passes_size_filter(self, media) -> bool:
        min_mb = self.config.get('size_min_mb') or 0
        max_mb = self.config.get('size_max_mb') or 0
        
        if min_mb == 0 and max_mb == 0: return True
            
        size_bytes = 0
        if isinstance(media, MessageMediaDocument):
            size_bytes = media.document.size
        elif isinstance(media, MessageMediaPhoto):
            size_bytes = max([sz.size for sz in media.photo.sizes if hasattr(sz, 'size')] + [0])
            
        size_mb = size_bytes / (1024 * 1024)
        
        if min_mb > 0 and size_mb < min_mb: return False
        if max_mb > 0 and size_mb > max_mb: return False
        return True

    async def execute_migration(self, limit=10):
        self.start_time = time.time()
        job_id = self.config.get('job_id')
        emit_event('ExecutionStarting', execution_id=self.execution_id, jobId=job_id, limit=limit)
        
        if self.config.get('transfer_mode') == "Fast Forward":
            from .fast_forward import FastForwardEngine
            ff_engine = FastForwardEngine(self.client, self.source, self.dest, self.execution_id, self.config)
            try:
                await ff_engine.execute_migration(limit=limit)
                return
            except Exception as e:
                if str(e) == "CHAT_RESTRICTED_FALLBACK":
                    self.config['transfer_mode'] = 'Clean Copy'
                    emit_event('LogEvent', level='WARNING', message='Beralih ke Clean Copy Speed karena restriksi')
                else:
                    raise e

        emit_event('ExecutionStarted', execution_id=self.execution_id, jobId=job_id, limit=limit)
        
        processed_count = 0
        total_size_bytes = 0
        dry_run = self.config['dry_run']
        reverse_flag = (self.config.get('fetch_direction') == "Oldest First")
        
        last_processed_id = 0
        if self.execution_id:
            execution_data = get_execution(self.execution_id)
            if execution_data:
                last_processed_id = execution_data.get('last_processed_id') or 0
                processed_count = execution_data.get('processed_messages') or 0
        
        target_topic = self.config.get('source_topic_id')
        iter_kwargs = {'reverse': reverse_flag}
        if target_topic:
            iter_kwargs['reply_to'] = target_topic
            
        start_date_str = self.config.get('start_date')
        end_date_str = self.config.get('end_date')
        start_date = datetime.datetime.strptime(start_date_str, "%Y-%m-%d").date() if start_date_str else None
        end_date = datetime.datetime.strptime(end_date_str, "%Y-%m-%d").date() if end_date_str else None
        
        if last_processed_id > 0:
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

            mode = self.config['transfer_mode']
            
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
                await self.throttle.human_delay(mode=mode)
            
            try:
                caption_text = ""
                for _, m, _ in item_ids:
                    if m.message:
                        caption_text = m.message
                        break

                rule = self.config.get('caption_rule', '')
                if rule == "remove" or rule == "Remove Caption":
                    caption_text = ""
                elif rule == "strip_links" or rule == "Strip Links (Hapus URL)":
                    import re
                    caption_text = re.sub(r'http[s]?://\S+', '', caption_text)
                elif str(rule).lower().startswith("custom:"):
                    caption_text = rule.split(":", 1)[1]

                first_msg = item_ids[0][1]
                if not dry_run and (getattr(first_msg, 'noforwards', False) or getattr(first_msg.chat, 'noforwards', False)):
                    if self.config.get('auto_fallback') and mode in ['Fast Forward', 'Instant Clone']:
                        emit_event('FallbackTriggered', reason='Chat restricted', new_mode='Clean Copy')
                        mode = 'Clean Copy'
                    elif mode in ['Fast Forward', 'Instant Clone']:
                        for t_id, _, _ in item_ids:
                            update_task_status(t_id, "FAILED", error_category="Permission Denied", error_message="Chat restricted and fallback disabled")
                            self.failed_count_val += 1
                        raise StopAsyncIteration("Fatal Error: Chat Restricted")

                sent_msg = None
                if not dry_run:
                    if mode == 'Fast Forward':
                        sent_msg = await self.client.forward_messages(
                            self.dest, 
                            messages=[m for _, m, _ in item_ids], 
                            top_msg_id=self.config.get('dest_topic_id')
                        )
                    elif mode == 'Instant Clone':
                        sent_msg = await self.client.send_file(
                            self.dest,
                            file=[m.media for _, m, _ in item_ids],
                            caption=caption_text,
                            reply_to=self.config.get('dest_topic_id')
                        )
                    elif mode == 'Clean Copy':
                        downloaded_paths = []
                        try:
                            for idx, (_, m, _) in enumerate(item_ids):
                                fpath = await self.client.download_media(m, file=f"temp_album_{m.id}")
                                if fpath:
                                    downloaded_paths.append(fpath)
                                    
                            if downloaded_paths:
                                sent_msg = await self.client.send_file(
                                    self.dest,
                                    file=downloaded_paths,
                                    caption=caption_text,
                                    reply_to=self.config.get('dest_topic_id')
                                )
                            else:
                                raise Exception("Gagal mengunduh isi album.")
                        finally:
                            for fpath in downloaded_paths:
                                try:
                                    if os.path.exists(fpath):
                                        os.remove(fpath)
                                except: pass
                    
                    sent_msg_id = sent_msg[-1].id if isinstance(sent_msg, list) else sent_msg.id if sent_msg else 0
                else:
                    sent_msg_id = 0
                
                for t_id, m, f_uid in item_ids:
                    update_task_status(t_id, "DONE", sent_msg_id)
                    self.success_count += 1
                    emit_event('TaskCompleted', task_id=t_id, target_message_id=sent_msg_id)
                    if f_uid and not dry_run:
                        log_duplicate(f_uid, str(self.dest), sent_msg_id)
                
                if self.execution_id:
                    update_execution_progress(self.execution_id, item_ids[-1][1].id, processed_count, limit)
                    emit_event('ProgressUpdated', processed=processed_count, total=limit, current_id=item_ids[-1][1].id)
                    
                if not dry_run:
                    self.throttle.reset_health()
                
            except FloodWaitError as e:
                emit_event('FloodWait', seconds=e.seconds)
                if e.seconds > 900:
                    print(f"[ERROR] FloodWait terlalu lama ({e.seconds} detik > 900 detik). Membatalkan migrasi untuk keamanan.", file=sys.stderr)
                    raise e
                    
                if not dry_run:
                    await self.throttle.handle_flood_wait(e)
                try:
                    if not dry_run:
                        if mode == 'Fast Forward':
                            sent_msg = await self.client.forward_messages(self.dest, messages=[m for _, m, _ in item_ids], top_msg_id=self.config.get('dest_topic_id'))
                        else:
                            raise e
                        sent_msg_id = sent_msg[-1].id if isinstance(sent_msg, list) else sent_msg.id if sent_msg else 0
                    else:
                        sent_msg_id = 0
                        
                    for t_id, m, f_uid in item_ids:
                        update_task_status(t_id, "DONE", sent_msg_id)
                        self.success_count += 1
                        emit_event('TaskCompleted', task_id=t_id, target_message_id=sent_msg_id)
                        if f_uid and not dry_run: log_duplicate(f_uid, str(self.dest), sent_msg_id)
                except Exception as retry_e:
                    self.has_failed_tasks = True
                    for t_id, _, _ in item_ids: 
                        update_task_status(t_id, "FAILED", error_category="FloodWait", error_message=str(retry_e))
                        self.failed_count_val += 1
                        emit_event('TaskFailed', task_id=t_id, error=str(retry_e))
            
            except (ChatWriteForbiddenError, UserBannedInChannelError, ChatIdInvalidError) as e:
                self.has_failed_tasks = True
                for t_id, _, _ in item_ids: 
                    update_task_status(t_id, "FAILED", error_category="Permission Denied", error_message=str(e))
                    self.failed_count_val += 1
                    emit_event('TaskFailed', task_id=t_id, error=str(e))
                raise StopAsyncIteration(f"Fatal Error: Banned or No Permission - {str(e)}")
                
            except StopAsyncIteration:
                raise
                
            except Exception as e:
                self.has_failed_tasks = True
                for t_id, _, _ in item_ids: 
                    update_task_status(t_id, "FAILED", error_category="General", error_message=str(e))
                    self.failed_count_val += 1
                    emit_event('TaskFailed', task_id=t_id, error=str(e))
                
            buffer.clear()
            current_group_id = None


        async def message_generator():
            if self.config.get('is_retry') and self.execution_id:
                failed_ids = get_failed_source_message_ids(self.execution_id)
                failed_ids.sort(reverse=not reverse_flag)
                for i in range(0, len(failed_ids), 100):
                    chunk = failed_ids[i:i+100]
                    msgs = await self.client.get_messages(self.source, ids=chunk)
                    for m in msgs:
                        if m: yield m
            else:
                async for m in self.client.iter_messages(self.source, **iter_kwargs):
                    yield m

        try:
            async for message in message_generator():
                if self.execution_id:
                    execution_state = get_execution(self.execution_id)
                    # Handle state machine interruptions (PAUSING, STOPPING)
                    if execution_state:
                        status = execution_state.get('status')
                        if status == 'PAUSING':
                            emit_event('StateTransition', from_state='PAUSING', to_state='PAUSED')
                            await flush_buffer()
                            return
                        elif status == 'PAUSED':
                            # Should technically never happen mid-loop unless modified externally without PAUSING first
                            return
                        elif status == 'STOPPING':
                            emit_event('StateTransition', from_state='STOPPING', to_state='STOPPED')
                            await flush_buffer()
                            return
                        elif status == 'CANCELLED':
                            await flush_buffer()
                            return

                if limit > 0 and processed_count + len(buffer) >= limit:
                    await flush_buffer()
                    break
                    
                msg_date = message.date.date() if message.date else None
                if msg_date:
                    if start_date and msg_date < start_date:
                        if reverse_flag: continue
                        else: break
                    if end_date and msg_date > end_date:
                        if reverse_flag: break
                        else: continue
                    
                if not message.media and not message.text:
                    continue

                if message.media and not self._passes_media_filter(message.media):
                    continue
                    
                if message.media and not self._passes_size_filter(message.media):
                    continue

                file_uid = None
                if message.media and hasattr(message.media, 'document'):
                    file_uid = str(message.media.document.id)
                elif message.media and hasattr(message.media, 'photo'):
                    file_uid = str(message.media.photo.id)
                    
                if file_uid:
                    dup_target_msg_id = self.duplicate_checker.get_duplicate_message_id(file_unique_id=file_uid)
                    if dup_target_msg_id and self.config.get('duplicate_action', 'Skip') == "Skip":
                        processed_count += 1
                        self.skipped_count += 1
                        task_id = create_task(self.execution_id, message.id, file_uid, None, None, None, "SKIPPED")
                        emit_event('TaskSkipped', task_id=task_id, reason="Duplicate")
                        if self.execution_id: 
                            update_execution_progress(self.execution_id, message.id, processed_count, limit)
                            emit_event('ProgressUpdated', processed=processed_count, total=limit, current_id=message.id)
                        continue

                # BUFFER LOGIC
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
                        
            # Flush sisa buffer di akhir iterasi
            await flush_buffer()
            
            if self.execution_id:
                execution_state = get_execution(self.execution_id)
                if execution_state and execution_state.get('status') == 'RUNNING':
                    final_state = 'PARTIAL_SUCCESS' if self.has_failed_tasks else 'COMPLETED'
                    duration = time.time() - self.start_time
                    
                    # Update database first
                    update_execution_status(self.execution_id, final_state)
                    
                    # Emit final summary event
                    emit_event('ExecutionFinished', 
                        final_state=final_state,
                        status=final_state,
                        processed=processed_count,
                        success=self.success_count,
                        failed=self.failed_count_val,
                        skipped=self.skipped_count,
                        duration=duration,
                        total=limit,
                        jobId=self.config.get('job_id')
                    )
        except StopAsyncIteration as e:
            emit_event('FatalError', error=str(e))
            raise e
