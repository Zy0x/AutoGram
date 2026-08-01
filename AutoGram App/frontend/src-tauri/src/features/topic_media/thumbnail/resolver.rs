//! Progressive Document Thumbnail Resolver orchestration.

use super::super::models::{ThumbnailMode, ThumbnailSource, ThumbnailStatus, TopicMediaItem};
use super::fallback_icon::get_smart_icon_name;
use super::format_registry::{get_format_capability, PreviewCapability};
use super::mode_profile::{get_mode_profile, ModeProfile};

pub struct ThumbnailResolutionResult {
    pub source: ThumbnailSource,
    pub status: ThumbnailStatus,
    pub icon_fallback: &'static str,
}

pub fn resolve_thumbnail_strategy(
    item: &TopicMediaItem,
    mode: ThumbnailMode,
) -> ThumbnailResolutionResult {
    let profile = get_mode_profile(mode);
    let icon_fallback = get_smart_icon_name(item.mime_type.as_deref(), &item.file_name);

    if item.has_server_thumb {
        return ThumbnailResolutionResult {
            source: ThumbnailSource::TelegramPhotoThumb,
            status: ThumbnailStatus::Ready,
            icon_fallback,
        };
    }

    let cap = get_format_capability(item.mime_type.as_deref(), &item.file_name);
    match cap {
        PreviewCapability::PartialImageDecode => ThumbnailResolutionResult {
            source: ThumbnailSource::PartialImage,
            status: ThumbnailStatus::Pending,
            icon_fallback,
        },
        PreviewCapability::IndexedVideoSeek => ThumbnailResolutionResult {
            source: ThumbnailSource::PartialVideoFrame,
            status: ThumbnailStatus::Pending,
            icon_fallback,
        },
        PreviewCapability::PdfFirstPage => ThumbnailResolutionResult {
            source: ThumbnailSource::PdfFirstPage,
            status: ThumbnailStatus::Pending,
            icon_fallback,
        },
        _ => ThumbnailResolutionResult {
            source: ThumbnailSource::SmartIcon,
            status: ThumbnailStatus::Ready,
            icon_fallback,
        },
    }
}
