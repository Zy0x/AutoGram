//! Chunked MTProto Uploader Module

use super::chunk_manager::ChunkAllocation;
use super::resume::UploadResumeState;

pub struct ChunkedUploader {
    pub allocation: ChunkAllocation,
    pub resume_state: UploadResumeState,
}

impl ChunkedUploader {
    pub fn new(allocation: ChunkAllocation, resume_state: UploadResumeState) -> Self {
        Self {
            allocation,
            resume_state,
        }
    }
}
