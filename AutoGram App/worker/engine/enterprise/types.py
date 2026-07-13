from enum import Enum
from dataclasses import dataclass
from typing import Optional, List, Dict, Any

class QualityMode(str, Enum):
    ORIGINAL = "ORIGINAL"
    HIGH_QUALITY = "HIGH_QUALITY"
    SMART = "SMART"

@dataclass
class MediaCapability:
    real_mime: str
    real_format: str
    dimensions: Optional[tuple]
    duration: Optional[int]
    bitrate: Optional[int]
    file_size: int
    telegram_support: bool
    recommended_mode: QualityMode

@dataclass
class TransferTask:
    sequence_id: int
    job_id: str
    source_chat_id: int
    source_msg_id: int
    dest_chat_id: int
    quality_mode: QualityMode
    message_obj: Any
    file_size: int = 0
    file_path: Optional[str] = None
    dependencies: List['Dependency'] = None
    
    def __post_init__(self):
        if self.dependencies is None:
            self.dependencies = []

@dataclass
class Dependency:
    type: str # "REPLY", "ALBUM"
    target_sequence_id: int

@dataclass
class PreparedTask:
    task: TransferTask
    bytes: Optional[bytes] = None
    file_path: Optional[str] = None
    method: str = "sendDocument"
    kwargs: Dict[str, Any] = None

    def __post_init__(self):
        if self.kwargs is None:
            self.kwargs = {}

@dataclass
class UploadedMessage:
    message_id: int
    date: Any
    media: Any
    document: Any
    caption: str
    reply_to_message_id: Optional[int]
    media_group_id: Optional[int]
