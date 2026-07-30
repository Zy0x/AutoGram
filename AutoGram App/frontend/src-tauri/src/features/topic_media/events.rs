//! Context-bound Tauri batch event emitter for Topic Media engine.

use tauri::{AppHandle, Emitter};

use super::error::TopicMediaError;
use super::models::{ThumbnailBatchEvent, TopicMediaDeltaEvent};

pub const EVENT_DELTA: &str = "topic-media://delta";
pub const EVENT_THUMBNAIL_BATCH: &str = "topic-media://thumbnail-batch";
pub const EVENT_DOWNLOAD_PROGRESS: &str = "topic-media://download-progress";

pub fn emit_delta_event(
    app: &AppHandle,
    payload: &TopicMediaDeltaEvent,
) -> Result<(), TopicMediaError> {
    app.emit(EVENT_DELTA, payload)
        .map_err(|e| TopicMediaError::Internal(format!("Failed emit delta event: {e}")))
}

pub fn emit_thumbnail_batch_event(
    app: &AppHandle,
    payload: &ThumbnailBatchEvent,
) -> Result<(), TopicMediaError> {
    app.emit(EVENT_THUMBNAIL_BATCH, payload)
        .map_err(|e| TopicMediaError::Internal(format!("Failed emit thumbnail batch event: {e}")))
}
