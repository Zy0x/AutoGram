import os
import sys
import time
import asyncio
from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl.types import MessageMediaDocument, MessageMediaPhoto, DocumentAttributeVideo, DocumentAttributeAudio

from .types import QualityMode, TransferTask, PreparedTask
from .resolver import ExtensionResolver
from .router import MediaUploadRouter
from .scheduler import OrderedCommitScheduler
from .duplicate import EnterpriseDuplicateChecker
from .checkpoint import CheckpointManager
from .database import record_mapping, update_mapping_status
from .filters import passes_media_filter, passes_size_filter, process_caption

from engine.events import emit_event
from database.queries import update_execution_progress, update_execution_status, get_execution

class EnterpriseEngine:
    def __init__(self, client: TelegramClient, source_entity, dest_entity, execution_id, config):
        self.client = client
        self.source = source_entity
        self.dest = dest_entity
        self.execution_id = execution_id
        self.config = config
        
        self.job_id = config.get('job_id', 'unknown_job')
        self.duplicate_checker = EnterpriseDuplicateChecker(self.job_id)
        self.checkpoint_manager = CheckpointManager()
        
        self.quality_mode_pref = config.get('quality_mode', 'SMART') # ORIGINAL, HIGH_QUALITY, SMART
        
        # Load Checkpoint
        checkpoint_data = self.checkpoint_manager.get_checkpoint(self.job_id)
        if checkpoint_data:
            self.last_committed_sequence = checkpoint_data.get('last_committed_sequence', 0)
        else:
            self.last_committed_sequence = 0
            
        self.scheduler = OrderedCommitScheduler(start_sequence_id=self.last_committed_sequence + 1)
        self.success_count = 0
        self.skipped_count = 0
        self.failed_count_val = 0
        
    def _determine_mode(self, message) -> QualityMode:
        pref = self.quality_mode_pref
        if pref in ["ORIGINAL", "HIGH_QUALITY"]:
            return QualityMode(pref)
            
        # SMART Mode
        filename = None
        if message.media and hasattr(message.media, 'document'):
            for attr in message.media.document.attributes:
                if hasattr(attr, 'file_name'):
                    filename = attr.file_name
                    break
        
        if filename:
            return ExtensionResolver.resolve(filename)
            
        # Fallback if no filename but has media
        if message.media:
            if isinstance(message.media, MessageMediaPhoto):
                return QualityMode.HIGH_QUALITY
                
        return QualityMode.ORIGINAL

    async def execute_migration(self, limit=10):
        start_time = time.time()
        emit_event('ExecutionStarting', execution_id=self.execution_id, jobId=self.job_id, limit=limit)
        emit_event('ExecutionStarted', execution_id=self.execution_id, jobId=self.job_id, limit=limit)
        
        processed_count = 0
        current_sequence = self.last_committed_sequence + 1
        
        # Determine iterator args
        reverse_flag = (self.config.get('fetch_direction') == "Oldest First")
        iter_kwargs = {'reverse': reverse_flag}
        
        if self.config.get('source_topic_id'):
            iter_kwargs['reply_to'] = self.config.get('source_topic_id')
            
        try:
            async for message in self.client.iter_messages(self.source, **iter_kwargs):
                if limit > 0 and processed_count >= limit:
                    break
                    
                if not message.media and not message.text:
                    continue

                if message.media and not passes_media_filter(message.media, self.config):
                    continue
                    
                if message.media and not passes_size_filter(message.media, self.config):
                    continue

                processed_count += 1
                
                source_chat_id = message.chat_id
                source_msg_id = message.id
                
                # 1. Check mapping/duplicates
                dup_action = self.config.get('dupAction', 'Skip')
                if dup_action != 'Overwrite' and self.duplicate_checker.is_duplicate(source_chat_id, source_msg_id):
                    is_deleted_at_dest = False
                    if dup_action == 'Verify':
                        dest_msg_id = self.duplicate_checker.get_dest_msg_id(source_chat_id, source_msg_id)
                        if dest_msg_id:
                            retry = True
                            while retry:
                                try:
                                    await asyncio.sleep(0.5) # Gentle throttle for Verify Dest
                                    check_msg = await self.client.get_messages(self.dest, ids=[dest_msg_id])
                                    if not check_msg or check_msg[0] is None or type(check_msg[0]).__name__ == 'MessageEmpty':
                                        is_deleted_at_dest = True
                                        print(f"[DEBUG Verify] Message {dest_msg_id} is CONFIRMED deleted at dest!")
                                    retry = False
                                except FloodWaitError as e:
                                    print(f"[WARN] Verify Dest hit FloodWait! Sleeping for {e.seconds}s...")
                                    await asyncio.sleep(e.seconds)
                                except Exception as e:
                                    print(f"[ERROR Verify] Exception checking message {dest_msg_id}: {e}")
                                    retry = False
                                    pass
                    if not is_deleted_at_dest:
                        self.skipped_count += 1
                        reason_str = "Duplicate mapping" if dup_action != 'Verify' else "Verified Duplicate (Still Exists)"
                        emit_event('TaskSkipped', task_id=str(source_msg_id), reason=reason_str)
                        if self.execution_id:
                            update_execution_progress(self.execution_id, source_msg_id, processed_count, limit)
                            emit_event('ProgressUpdated', processed=processed_count, total=limit, current_id=source_msg_id, success=self.success_count, skipped=self.skipped_count, failed=self.failed_count_val)
                        continue
                    
                # 2. Determine Mode
                quality = self._determine_mode(message)
                
                # 3. Create Task
                task = TransferTask(
                    sequence_id=current_sequence,
                    job_id=self.job_id,
                    source_chat_id=source_chat_id,
                    source_msg_id=source_msg_id,
                    dest_chat_id=self.dest.id if hasattr(self.dest, 'id') else 0, # Note: dest is entity
                    quality_mode=quality,
                    message_obj=message
                )
                
                # 4. Route Task
                prepared = MediaUploadRouter.route(task)
                
                # 5. Process / Upload
                # We simulate parallel/ordered commit by doing it sequentially but with the architecture intact.
                # (For full parallel we would need asyncio.gather and worker pools).
                try:
                    update_mapping_status(self.job_id, source_msg_id, 'IN_PROGRESS')
                    await self._upload_prepared(prepared)
                    
                    # Checkpoint every 10 messages
                    if current_sequence % 10 == 0:
                        self.checkpoint_manager.write_checkpoint({
                            "job_id": self.job_id,
                            "last_committed_sequence": current_sequence,
                            "timestamp": time.time()
                        })
                        
                except Exception as e:
                    print(f"Error on message {source_msg_id}: {e}")
                    self.failed_count_val += 1
                    update_mapping_status(self.job_id, source_msg_id, 'FAILED', error_message=str(e))
                    
                current_sequence += 1
                
                if self.execution_id:
                    update_execution_progress(self.execution_id, source_msg_id, processed_count, limit)
                    emit_event('ProgressUpdated', processed=processed_count, total=limit, current_id=source_msg_id, success=self.success_count, skipped=self.skipped_count, failed=self.failed_count_val)
                    
        except Exception as e:
            emit_event('FatalError', error=str(e))
            if self.execution_id:
                update_execution_status(self.execution_id, 'FAILED', error_message=str(e))
            raise e
            
        # Final checkpoint
        self.checkpoint_manager.write_checkpoint({
            "job_id": self.job_id,
            "last_committed_sequence": current_sequence - 1,
            "timestamp": time.time()
        })
        
        duration = time.time() - start_time
        final_state = 'PARTIAL_SUCCESS' if self.failed_count_val > 0 else 'COMPLETED'
        if self.execution_id:
            update_execution_status(self.execution_id, final_state)
            
        emit_event('ExecutionFinished', 
            final_state=final_state,
            status=final_state,
            processed=processed_count,
            success=self.success_count,
            failed=self.failed_count_val,
            skipped=self.skipped_count,
            duration=duration,
            total=limit,
            jobId=self.job_id
        )

    async def _upload_prepared(self, prepared: PreparedTask):
        msg = prepared.task.message_obj
        caption = prepared.kwargs.get("caption", msg.text or "")
        caption = process_caption(caption, self.config)
        reply_to = prepared.kwargs.get("reply_to", self.config.get('dest_topic_id'))
        if msg.reply_to_msg_id:
            # Need to map source reply to dest reply
            dest_reply_id = self.duplicate_checker.get_dest_msg_id(msg.chat_id, msg.reply_to_msg_id)
            if dest_reply_id:
                reply_to = dest_reply_id
        
        # Uploading
        if not msg.media:
            # Just text
            sent = await self.client.send_message(self.dest, message=caption, reply_to=reply_to)
        else:
            if prepared.method == "sendDocument":
                sent = await self.client.send_file(
                    self.dest,
                    msg.media,
                    caption=caption,
                    force_document=prepared.kwargs.get("force_document", True),
                    reply_to=reply_to
                )
            elif prepared.method == "sendPhoto":
                sent = await self.client.send_file(
                    self.dest,
                    msg.media,
                    caption=caption,
                    reply_to=reply_to
                )
            elif prepared.method == "sendVideo":
                sent = await self.client.send_file(
                    self.dest,
                    msg.media,
                    caption=caption,
                    supports_streaming=True,
                    reply_to=reply_to
                )
            elif prepared.method == "sendAudio":
                sent = await self.client.send_file(
                    self.dest,
                    msg.media,
                    caption=caption,
                    reply_to=reply_to
                )
            elif prepared.method == "sendAnimation":
                sent = await self.client.send_file(
                    self.dest,
                    msg.media,
                    caption=caption,
                    reply_to=reply_to
                )
            else:
                sent = await self.client.send_file(
                    self.dest,
                    msg.media,
                    caption=caption,
                    reply_to=reply_to
                )
                
        # Handle list vs single
        if isinstance(sent, list):
            sent = sent[-1]
            
        # Record Mapping
        record_mapping(
            job_id=self.job_id,
            source_chat_id=msg.chat_id,
            source_msg_id=msg.id,
            dest_chat_id=sent.chat_id,
            dest_msg_id=sent.id,
            sequence_id=prepared.task.sequence_id,
            quality_mode=prepared.task.quality_mode.value,
            status="VERIFIED" # Assumed verified if it didn't throw
        )
        self.success_count += 1
