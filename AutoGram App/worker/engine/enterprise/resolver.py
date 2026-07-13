from .types import QualityMode

class ExtensionResolver:
    ORIGINAL_EXTS = {
        # Documents/Office
        '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.txt', '.csv',
        # Archives
        '.zip', '.rar', '.7z', '.tar', '.gz',
        # RAW/Pro Photo
        '.raw', '.cr2', '.nef', '.arw', '.dng',
        # Vector
        '.svg', '.ai', '.eps',
        # Pro Video
        '.prores', '.dnxhd', '.mxf',
        # Pro Audio
        '.wav', '.aiff', '.dsd',
        # Executable/Database/Code
        '.apk', '.exe', '.dmg', '.sql', '.db', '.mdb',
        '.js', '.py', '.cpp', '.c', '.html', '.css', '.json'
    }

    HQ_EXTS = {
        # Raster Image
        '.jpeg', '.jpg', '.png', '.webp', '.heic',
        # Common Video
        '.mp4', '.mov', '.avi', '.mkv',
        # Common Audio
        '.mp3', '.aac', '.flac', '.ogg'
    }

    @staticmethod
    def resolve(filename: str) -> QualityMode:
        if not filename:
            return QualityMode.ORIGINAL
            
        import os
        ext = os.path.splitext(filename)[1].lower()
        
        if ext in ExtensionResolver.HQ_EXTS:
            return QualityMode.HIGH_QUALITY
        # Default fallback is ORIGINAL for safety
        return QualityMode.ORIGINAL
