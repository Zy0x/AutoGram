from .types import TransferTask, QualityMode, PreparedTask
from telethon.tl.types import MessageMediaDocument, MessageMediaPhoto, DocumentAttributeVideo, DocumentAttributeAudio

class MediaUploadRouter:
    @staticmethod
    def route(task: TransferTask) -> PreparedTask:
        # Defaults
        prepared = PreparedTask(task=task)
        
        # Determine actual media type from message_obj if present
        msg = task.message_obj
        
        if task.quality_mode == QualityMode.ORIGINAL:
            # Force everything to be a document
            prepared.method = "sendDocument"
            prepared.kwargs = {"force_document": True}
        
        elif task.quality_mode == QualityMode.HIGH_QUALITY:
            if msg and msg.media:
                if isinstance(msg.media, MessageMediaPhoto):
                    prepared.method = "sendPhoto"
                elif isinstance(msg.media, MessageMediaDocument):
                    is_video = False
                    is_audio = False
                    is_voice = False
                    is_gif = False
                    for attr in msg.media.document.attributes:
                        if isinstance(attr, DocumentAttributeVideo):
                            is_video = True
                        elif isinstance(attr, DocumentAttributeAudio):
                            if attr.voice:
                                is_voice = True
                            else:
                                is_audio = True
                    if msg.media.document.mime_type in ('image/gif', 'video/mp4') and not is_video:
                        if getattr(msg.media.document, 'mime_type', '') == 'image/gif':
                            is_gif = True
                            
                    if is_video:
                        prepared.method = "sendVideo"
                        prepared.kwargs = {"supports_streaming": True}
                    elif is_audio or is_voice:
                        prepared.method = "sendAudio"
                    elif is_gif:
                        prepared.method = "sendAnimation"
                    else:
                        # Fallback for documents
                        prepared.method = "sendDocument"
                        prepared.kwargs = {"force_document": True}
            else:
                prepared.method = "sendDocument"
                
        elif task.quality_mode == QualityMode.SMART:
            # Smart delegates mapping to HQ or ORIGINAL based on extension.
            # Usually handled by the Strategy or Engine beforehand.
            # Assuming it resolved to HQ or ORIGINAL internally before reaching here.
            pass
            
        return prepared
