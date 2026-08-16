//! Offset-Based Byte Resume Tracker

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadResumeState {
    pub file_id: String,
    pub uploaded_bytes: u64,
    pub completed_parts: Vec<i32>,
    pub file_hash: String,
}

impl UploadResumeState {
    pub fn new(file_id: impl Into<String>, file_hash: impl Into<String>) -> Self {
        Self {
            file_id: file_id.into(),
            uploaded_bytes: 0,
            completed_parts: Vec::new(),
            file_hash: file_hash.into(),
        }
    }

    pub fn mark_part_completed(&mut self, part_index: i32, bytes_added: u64) {
        if !self.completed_parts.contains(&part_index) {
            self.completed_parts.push(part_index);
            self.uploaded_bytes += bytes_added;
        }
    }
}
