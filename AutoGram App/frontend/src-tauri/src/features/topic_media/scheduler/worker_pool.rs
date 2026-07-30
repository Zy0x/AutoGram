//! Per-DC and per-account worker pool semaphore allocation.

use std::sync::Arc;
use tokio::sync::Semaphore;

pub struct WorkerPoolConfig {
    pub max_thumb_workers: usize,
    pub max_preview_workers: usize,
    pub max_download_workers: usize,
}

impl Default for WorkerPoolConfig {
    fn default() -> Self {
        Self {
            max_thumb_workers: 4,
            max_preview_workers: 2,
            max_download_workers: 2,
        }
    }
}

pub struct DcWorkerPool {
    pub thumb_sem: Arc<Semaphore>,
    pub preview_sem: Arc<Semaphore>,
    pub download_sem: Arc<Semaphore>,
}

impl DcWorkerPool {
    pub fn new(cfg: WorkerPoolConfig) -> Self {
        Self {
            thumb_sem: Arc::new(Semaphore::new(cfg.max_thumb_workers)),
            preview_sem: Arc::new(Semaphore::new(cfg.max_preview_workers)),
            download_sem: Arc::new(Semaphore::new(cfg.max_download_workers)),
        }
    }
}
