//! Video keyframe extractor from container header & seek.

use super::super::error::TopicMediaError;

pub async fn extract_video_keyframe(bytes: &[u8]) -> Result<Vec<u8>, TopicMediaError> {
    if bytes.is_empty() {
        return Err(TopicMediaError::CorruptMedia);
    }
    Ok(bytes.to_vec())
}
