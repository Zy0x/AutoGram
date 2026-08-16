//! Adaptive Chunk Allocation Engine
//! Computes optimal MTProto upload chunk sizes (e.g. 512KB for large files, 128KB for small files).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkAllocation {
    pub chunk_size: usize,
    pub total_chunks: usize,
    pub parallel_workers: usize,
}

pub fn calculate_chunk_allocation(
    file_size: u64,
    is_premium: bool,
    latency_ms: u32,
) -> ChunkAllocation {
    let chunk_size = if file_size > 10 * 1024 * 1024 {
        512 * 1024 // 512 KB
    } else if file_size > 1024 * 1024 {
        256 * 1024 // 256 KB
    } else {
        128 * 1024 // 128 KB
    };

    let total_chunks = ((file_size + chunk_size as u64 - 1) / chunk_size as u64) as usize;

    let parallel_workers = if is_premium && latency_ms < 100 {
        8
    } else if is_premium || latency_ms < 200 {
        4
    } else {
        2
    };

    ChunkAllocation {
        chunk_size,
        total_chunks,
        parallel_workers,
    }
}
