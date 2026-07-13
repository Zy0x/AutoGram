from telethon.tl.types import MessageMediaPhoto, MessageMediaDocument, DocumentAttributeVideo, DocumentAttributeAudio
import re

def passes_media_filter(media, config) -> bool:
    if not config: return True
    f = config.get('media_filter', 'all')
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

def passes_size_filter(media, config) -> bool:
    if not config: return True
    min_mb = config.get('size_min_mb') or 0
    max_mb = config.get('size_max_mb') or 0
    
    try:
        min_mb = float(min_mb)
    except:
        min_mb = 0.0
    try:
        max_mb = float(max_mb)
    except:
        max_mb = 0.0
    
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

def process_caption(caption_text: str, config: dict) -> str:
    if not caption_text:
        return ""
    rule = config.get("caption_rule", "")
    if rule == "remove" or rule == "Remove Caption":
        return ""
    elif rule == "strip_links" or rule == "Strip Links (Hapus URL)":
        return re.sub(r"http[s]?://\S+", "", caption_text)
    elif str(rule).lower().startswith("custom:"):
        return rule.split(":", 1)[1]
    return caption_text
