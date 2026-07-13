from telethon import TelegramClient, utils
from typing import Any
import asyncio
from .database import update_mapping_status, record_mapping
from .types import TransferTask
from .router import MediaUploadRouter
from engine.events import emit_event
from .filters import process_caption

class RetryProcessor:
    def __init__(self, client: TelegramClient, job_id: str, dest_entity: Any, config: dict):
        self.client = client
        self.job_id = job_id
        self.dest = dest_entity
        self.config = config
        
    async def process_message(self, message: Any, sequence_id: int, quality_mode: Any) -> bool:
        """
        Attempts to process and upload a single message.
        Returns True if successful, False otherwise.
        """
        try:
            # 1. Update status to IN_PROGRESS
            update_mapping_status(self.job_id, message.id, 'IN_PROGRESS')
            
            # 2. Re-create task and route
            task = TransferTask(
                sequence_id=sequence_id,
                job_id=self.job_id,
                source_chat_id=message.chat_id,
                source_msg_id=message.id,
                dest_chat_id=utils.get_peer_id(self.dest),
                quality_mode=quality_mode,
                message_obj=message
            )
            
            prepared = MediaUploadRouter.route(task)
            
            # 3. Upload logic (similar to EnterpriseEngine)
            msg = prepared.task.message_obj
            caption = prepared.kwargs.get("caption", msg.text or "")
            caption = process_caption(caption, self.config)
            reply_to = prepared.kwargs.get("reply_to")
            
            if prepared.method == "sendText":
                sent = await self.client.send_message(self.dest, caption, reply_to=reply_to)
            else:
                # Handle media
                if prepared.method == "sendDocument":
                    sent = await self.client.send_file(
                        self.dest, msg.media, caption=caption, force_document=prepared.kwargs.get("force_document", True), reply_to=reply_to
                    )
                elif prepared.method == "sendVideo":
                    sent = await self.client.send_file(
                        self.dest, msg.media, caption=caption, supports_streaming=True, reply_to=reply_to
                    )
                else:
                    sent = await self.client.send_file(
                        self.dest, msg.media, caption=caption, reply_to=reply_to
                    )
                    
            if isinstance(sent, list):
                sent = sent[-1]
                
            # 4. Record Success
            record_mapping(
                job_id=self.job_id,
                source_chat_id=msg.chat_id,
                source_msg_id=msg.id,
                dest_chat_id=sent.chat_id,
                dest_msg_id=sent.id,
                sequence_id=sequence_id,
                quality_mode=quality_mode.value,
                status="VERIFIED"
            )
            return True
            
        except Exception as e:
            # 5. Record Failure
            print(f"[RetryProcessor] Failed for msg {message.id}: {e}")
            update_mapping_status(self.job_id, message.id, 'FAILED', error_message=str(e))
            return False
