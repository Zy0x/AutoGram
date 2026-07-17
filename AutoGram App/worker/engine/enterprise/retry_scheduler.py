import asyncio
import time
import random
from telethon import TelegramClient, utils
from telethon.errors import FloodWaitError
from .retry_scanner import RetryScanner, Action
from .retry_processor import RetryProcessor
from .filters import passes_media_filter, passes_size_filter, message_in_date_range
from .engine import EnterpriseEngine # For determining quality mode
from .database import get_stalled_in_progress, update_mapping_status, get_mapping
from engine.events import emit_event
from engine.pause_control import should_pause, resolve_final_state
from database.queries import update_execution_progress, update_execution_status

class RetryScheduler:
    def __init__(self, client: TelegramClient, source_entity, dest_entity, execution_id, config):
        self.client = client
        self.config = config
        self.job_id = config.get('job_id')
        self.execution_id = execution_id
        self.source = source_entity
        self.dest = dest_entity
        self.scanner = RetryScanner(self.job_id)
        self.processor = RetryProcessor(client, self.job_id, dest_entity, self.config)
        self.rerun_mode = config.get('rerun_mode', 'RESUME')
        
        # We need a dummy engine just to reuse _determine_mode
        self._dummy_engine = EnterpriseEngine(client, source_entity, dest_entity, execution_id, config)
        
        self.success_count = 0
        self.skipped_count = 0
        self.failed_count_val = 0
        self.flood_wait_count = 0
        self.flood_wait_reset_time = time.time()
        
    async def execute_migration(self, limit=10):
        start_time = time.time()
        emit_event('ExecutionStarting', execution_id=self.execution_id, jobId=self.job_id, limit=limit, mode=f"RETRY_{self.rerun_mode}")
        emit_event('ExecutionStarted', execution_id=self.execution_id, jobId=self.job_id, limit=limit, mode=f"RETRY_{self.rerun_mode}")
        
        # 1. Clean up stalled IN_PROGRESS jobs
        stalled = get_stalled_in_progress(self.job_id, timeout_minutes=15)
        for s in stalled:
            update_mapping_status(self.job_id, s['source_msg_id'], 'FAILED', error_message='Stalled (Timeout)')
            print(f"[RetryScheduler] Marked stalled message {s['source_msg_id']} as FAILED")
            
        # 2. Get Range based on mode
        if self.rerun_mode == 'RESUME':
            start_msg_id, end_msg_id = self.scanner.get_retry_range()
            print(f"[RetryScheduler] Smart Resume from message ID: {start_msg_id}")
        else:
            start_msg_id = 0 # OVERWRITE or SMART_SYNC start from the very beginning
            
        # 3. Iteration params
        reverse_flag = (self.config.get('fetch_direction') == "Oldest First")
        iter_kwargs = {'reverse': reverse_flag}
        
        if self.config.get('source_topic_id'):
            iter_kwargs['reply_to'] = self.config.get('source_topic_id')
            
        if start_msg_id > 0:
            if reverse_flag:
                iter_kwargs['offset_id'] = start_msg_id - 1
            else:
                iter_kwargs['offset_id'] = start_msg_id + 1
                
        processed_count = 0
        paused = False
        total_display = limit if limit and limit > 0 else 0
        dry_run = bool(self.config.get('dry_run'))
        
        # SMART_SYNC state
        sync_sample_rate = 0.05
        sync_deleted_count = 0
        sync_checked_count = 0
        live_check_calls = 0
        live_check_start_time = time.time()
        max_live_calls_per_min = 10 # Default for 14-30 days
        
        # OVERWRITE state
        overwrite_speed = 0.2 # msg per sec
        overwrite_batch = 0
        
        natural_end = False
        try:
            async for message in self.client.iter_messages(self.source, **iter_kwargs):
                if limit > 0 and processed_count >= limit:
                    break

                if should_pause(self.execution_id):
                    paused = True
                    break

                if not message_in_date_range(message, self.config):
                    continue
                    
                if not message.media and not message.text:
                    continue
                    
                if message.media and not passes_media_filter(message.media, self.config):
                    continue
                    
                if message.media and not passes_size_filter(message.media, self.config):
                    continue
                    
                processed_count += 1
                source_msg_id = message.id
                
                # FloodWait reset (per hour logic)
                if time.time() - self.flood_wait_reset_time > 3600:
                    self.flood_wait_count = 0
                    self.flood_wait_reset_time = time.time()
                
                # Default Action from scanner
                action = self.scanner.scan_message(source_msg_id)
                
                if self.rerun_mode == 'OVERWRITE':
                    # OVERWRITE overrides SKIP to PROCESS
                    if action == Action.SKIP:
                        action = Action.PROCESS
                    
                    # Safety Gate Throttling
                    overwrite_batch += 1
                    if overwrite_batch % 100 == 0:
                        overwrite_speed += 0.1
                    
                    delay = 1.0 / overwrite_speed if overwrite_speed > 0 else 5.0
                    await asyncio.sleep(delay)
                    
                    if overwrite_batch % 50 == 0:
                        rest = random.uniform(30.0, 60.0)
                        print(f"[RetryScheduler] Overwrite resting for {rest:.1f}s")
                        await asyncio.sleep(rest)
                
                elif self.rerun_mode == 'SMART_SYNC':
                    if action == Action.SKIP:
                        # Adaptive Sampling: Always check the first one, then use sample rate
                        if sync_checked_count == 0 or random.random() < sync_sample_rate:
                            # Do Live Check
                            if time.time() - live_check_start_time > 60:
                                live_check_calls = 0
                                live_check_start_time = time.time()
                                
                            if live_check_calls < max_live_calls_per_min:
                                live_check_calls += 1
                                sync_checked_count += 1
                                source_peer_id = utils.get_peer_id(self.source)
                                mapping = get_mapping(self.job_id, source_peer_id, source_msg_id)
                                if mapping and mapping['dest_msg_id']:
                                    try:
                                        check_msgs = await self.client.get_messages(self.dest, ids=[mapping['dest_msg_id']])
                                        if not check_msgs or check_msgs[0] is None:
                                            # Deleted!
                                            sync_deleted_count += 1
                                            action = Action.PROCESS # Re-upload
                                            print(f"[SMART_SYNC] Message {source_msg_id} was deleted at dest. Reprocessing.")
                                            
                                            # Escalate sampling
                                            deletion_rate = sync_deleted_count / sync_checked_count
                                            if deletion_rate > 0.2:
                                                raise Exception("Deletion rate exceeds 20%. Aborting SMART_SYNC. Please use OVERWRITE or FRESH START.")
                                            elif deletion_rate > 0.1:
                                                sync_sample_rate = 0.2
                                            elif deletion_rate > 0:
                                                sync_sample_rate = 0.1
                                    except FloodWaitError as e:
                                        print(f"[SMART_SYNC] FloodWait {e.seconds}s during live check. Skipping batch.")
                                        sync_sample_rate = max(0.01, sync_sample_rate - 0.02)
                                        await asyncio.sleep(e.seconds)
                                    except Exception as e:
                                        pass
                
                # Execute Action
                if action == Action.SKIP:
                    self.skipped_count += 1
                    emit_event('TaskSkipped', task_id=str(source_msg_id), reason=f"Verified Duplicate ({self.rerun_mode})")
                elif action in [Action.PROCESS, Action.RETRY]:
                    if dry_run:
                        self.skipped_count += 1
                        emit_event('TaskSkipped', task_id=str(source_msg_id), reason='Dry run')
                    else:
                        quality_mode = self._dummy_engine._determine_mode(message)
                        try:
                            success = await self.processor.process_message(message, sequence_id=processed_count, quality_mode=quality_mode)
                            if success:
                                self.success_count += 1
                            else:
                                self.failed_count_val += 1
                        except FloodWaitError as e:
                            self.flood_wait_count += 1
                            if self.rerun_mode == 'OVERWRITE' and self.flood_wait_count >= 2:
                                raise Exception("Auto-stop: FloodWait > 2 per hour in OVERWRITE mode.")
                            await asyncio.sleep(e.seconds)
                            self.failed_count_val += 1
                elif action == Action.WAIT:
                    self.skipped_count += 1
                    emit_event('TaskSkipped', task_id=str(source_msg_id), reason="Still In Progress")
                    
                if self.execution_id:
                    update_execution_progress(self.execution_id, source_msg_id, processed_count, total_display or None)
                    emit_event('ProgressUpdated', processed=processed_count, total=total_display, current_id=source_msg_id, success=self.success_count, skipped=self.skipped_count, failed=self.failed_count_val)

                if limit > 0 and processed_count >= limit:
                    break
            else:
                natural_end = True
                    
        except Exception as e:
            emit_event('FatalError', error=str(e))
            if self.execution_id:
                try:
                    update_execution_status(self.execution_id, 'FAILED', error_message=str(e))
                except Exception:
                    pass
            # Clean return — avoid bubbling crash into asyncio/process teardown
            return
            
        duration = time.time() - start_time
        final_state = resolve_final_state(
            paused=paused,
            failed_count=self.failed_count_val,
            processed_count=processed_count,
            limit=limit or 0,
            natural_end=natural_end or (not paused),
        )
        if limit > 0 and processed_count >= limit:
            final_state = 'PARTIAL_SUCCESS' if self.failed_count_val > 0 else 'COMPLETED'
        if self.execution_id:
            try:
                update_execution_status(self.execution_id, final_state)
            except Exception:
                pass
            
        emit_event('ExecutionFinished', 
            final_state=final_state,
            status=final_state,
            processed=processed_count,
            success=self.success_count,
            failed=self.failed_count_val,
            skipped=self.skipped_count,
            duration=duration,
            total=total_display,
            jobId=self.job_id
        )
