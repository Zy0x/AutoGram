import asyncio
import datetime
from telethon import TelegramClient, events
from telethon.errors import FloodWaitError
from database.db import get_connection
from .smart_throttle import SmartThrottle
from .forwarder import MigrationForwarder

class SyncEngine:
    def __init__(self, client: TelegramClient, source_entity, dest_entity, config):
        self.client = client
        self.source = source_entity
        self.dest = dest_entity
        self.config = config
        self.queue = asyncio.Queue()
        self.is_running = False
        
        # Reuse existing forwarder for checking filters and applying rules
        self.forwarder = MigrationForwarder(client, source_entity, dest_entity, "SYNC_JOB", config)
        self.throttle = SmartThrottle(
            base_delay_min=config.get('delay_min', 2.0),
            base_delay_max=config.get('delay_max', 5.0)
        )
        self.mirror_edits = config.get('mirror_edits', True)
        self.mirror_deletions = config.get('mirror_deletions', True)
        self.db_conn = get_connection()

    def __del__(self):
        if hasattr(self, 'db_conn'):
            try:
                self.db_conn.close()
            except: pass

    def _save_mapping(self, source_id, dest_id):
        self.db_conn.execute('''
            INSERT INTO message_mappings (source_chat_id, source_message_id, dest_chat_id, dest_message_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(source_chat_id, source_message_id) DO UPDATE SET
            dest_message_id=excluded.dest_message_id, last_updated=CURRENT_TIMESTAMP
        ''', (str(self.source), source_id, str(self.dest), dest_id))
        self.db_conn.commit()

    def _get_dest_id(self, source_id):
        cur = self.db_conn.execute('''
            SELECT dest_message_id FROM message_mappings 
            WHERE source_chat_id = ? AND source_message_id = ? AND is_deleted = 0
        ''', (str(self.source), source_id))
        row = cur.fetchone()
        return row[0] if row else None
            
    def _mark_deleted(self, source_id):
        self.db_conn.execute('''
            UPDATE message_mappings SET is_deleted = 1, last_updated=CURRENT_TIMESTAMP
            WHERE source_chat_id = ? AND source_message_id = ?
        ''', (str(self.source), source_id))
        self.db_conn.commit()

    async def _handle_new_message(self, message):
        if not message.media and not message.text:
            return
            
        # Apply filters via forwarder
        if message.media and not self.forwarder._passes_media_filter(message.media):
            return
        if message.media and not self.forwarder._passes_size_filter(message.media):
            return
            
        try:
            # Process text and caption
            new_text = message.text
            if message.media:
                new_text = self.forwarder._apply_caption_rule(message.text)
                
            if self.config.get('hide_trace'):
                dest_msg = await self.client.send_message(self.dest, new_text, file=message.media)
            else:
                dest_msg = await self.client.forward_messages(self.dest, message)
                
            print(f"[SYNC] Mirrored new message {message.id} -> {dest_msg.id}", flush=True)
            self._save_mapping(message.id, dest_msg.id)
            
        except FloodWaitError as e:
            print(f"[SYNC] FloodWait for {e.seconds}s", flush=True)
            await asyncio.sleep(e.seconds)
            try:
                # Retry once
                if self.config.get('hide_trace'):
                    dest_msg = await self.client.send_message(self.dest, new_text, file=message.media)
                else:
                    dest_msg = await self.client.forward_messages(self.dest, message)
                self._save_mapping(message.id, dest_msg.id)
                print(f"[SYNC] Mirrored new message {message.id} -> {dest_msg.id} (after retry)", flush=True)
            except Exception as retry_e:
                print(f"[SYNC] Error mirroring message {message.id} after retry: {retry_e}", flush=True)
        except Exception as e:
            print(f"[SYNC] Error mirroring message {message.id}: {e}", flush=True)

    async def _handle_edit_message(self, message):
        dest_id = self._get_dest_id(message.id)
        if not dest_id:
            return # We don't have a record of mirroring this message
            
        new_text = message.text
        # If custom caption is enabled, we keep the custom caption, ignoring source edit for text.
        # But if it's 'keep' or 'remove', we apply the rule to the edited text.
        rule = self.config.get('caption_rule')
        if rule == 'custom':
            # Ignore the source edit text, retain our custom caption
            new_text = self.config.get('custom_caption', '')
        elif rule == 'remove':
            new_text = ""
        
        try:
            await self.client.edit_message(self.dest, dest_id, text=new_text, file=message.media)
            print(f"[SYNC] Mirrored edit for message {message.id} -> {dest_id}", flush=True)
        except FloodWaitError as e:
            await asyncio.sleep(e.seconds)
            try:
                await self.client.edit_message(self.dest, dest_id, text=new_text, file=message.media)
            except: pass
        except Exception as e:
            print(f"[SYNC] Error editing message {message.id}: {e}", flush=True)

    async def _handle_delete_message(self, deleted_ids):
        for msg_id in deleted_ids:
            dest_id = self._get_dest_id(msg_id)
            if dest_id:
                try:
                    await self.client.delete_messages(self.dest, [dest_id])
                    self._mark_deleted(msg_id)
                    print(f"[SYNC] Mirrored deletion for message {msg_id} -> {dest_id}", flush=True)
                except Exception as e:
                    print(f"[SYNC] Error deleting message {msg_id}: {e}", flush=True)

    async def _worker_loop(self):
        print("[SYNC] Worker loop started", flush=True)
        while self.is_running:
            try:
                # Wait for next event
                event_type, payload = await self.queue.get()
                
                # Apply Throttle Delay (Anti-Ban)
                if self.config.get('throttle_active'):
                    await self.throttle.wait()
                    
                if event_type == 'new':
                    await self._handle_new_message(payload)
                elif event_type == 'edit':
                    await self._handle_edit_message(payload)
                elif event_type == 'delete':
                    await self._handle_delete_message(payload)
                    
                self.queue.task_done()
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[SYNC] Worker loop error: {e}", flush=True)
                await asyncio.sleep(5)

    async def _catchup_phase(self):
        print("[SYNC] Starting catch-up phase...", flush=True)
        # We need to fetch messages that we missed.
        cur = self.db_conn.execute('''
            SELECT source_message_id FROM message_mappings 
            WHERE source_chat_id = ? 
            ORDER BY source_message_id DESC LIMIT 1
        ''', (str(self.source),))
        row = cur.fetchone()
        last_msg_id = row[0] if row else 0

        if last_msg_id > 0:
            print(f"[SYNC] Catching up from message ID {last_msg_id}...", flush=True)
            async for message in self.client.iter_messages(self.source, min_id=last_msg_id, reverse=True):
                if not message.media and not message.text:
                    continue
                # Instead of putting into the queue which might delay starting the listener,
                # we can queue it for the worker to process.
                await self.queue.put(('new', message))
        print("[SYNC] Catch-up phase complete.", flush=True)

    async def run(self):
        self.is_running = True
        
        if self.config.get('sync_catchup'):
            await self._catchup_phase()
            
        @self.client.on(events.NewMessage(chats=self.source))
        async def on_new_message(event):
            await self.queue.put(('new', event.message))
            
        if self.mirror_edits:
            @self.client.on(events.MessageEdited(chats=self.source))
            async def on_edit_message(event):
                await self.queue.put(('edit', event.message))
                
        if self.mirror_deletions:
            @self.client.on(events.MessageDeleted(chats=self.source))
            async def on_delete_message(event):
                await self.queue.put(('delete', event.deleted_ids))
                
        print("[SYNC] Daemon listening for events...", flush=True)
        
        # Start worker loop
        worker = asyncio.create_task(self._worker_loop())
        
        try:
            # Keep the main loop alive
            while self.is_running:
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            self.is_running = False
        finally:
            worker.cancel()
            self.client.remove_event_handler(on_new_message)
            if self.mirror_edits:
                self.client.remove_event_handler(on_edit_message)
            if self.mirror_deletions:
                self.client.remove_event_handler(on_delete_message)
            print("[SYNC] Daemon stopped.", flush=True)
