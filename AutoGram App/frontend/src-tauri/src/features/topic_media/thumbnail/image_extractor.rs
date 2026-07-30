//! Partial image decode extractor.

use super::super::error::TopicMediaError;

pub async fn extract_image_preview(bytes: &[u8]) -> Result<Vec<u8>, TopicMediaError> {
    if bytes.is_empty() {
        return Err(TopicMediaError::CorruptMedia);
    }
    Ok(bytes.to_vec())
}
