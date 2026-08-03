//! Resource Scheduler Engine (GPU/CPU/RAM budget allocation)

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceBudget {
    pub max_cpu_threads: u32,
    pub max_ram_mb: u64,
    pub max_gpu_vram_mb: u64,
}

pub struct ResourceScheduler {
    pub budget: ResourceBudget,
}

impl ResourceScheduler {
    pub fn new(budget: ResourceBudget) -> Self {
        Self { budget }
    }

    pub fn auto_allocate() -> Self {
        Self {
            budget: ResourceBudget {
                max_cpu_threads: 4,
                max_ram_mb: 2048,
                max_gpu_vram_mb: 1024,
            },
        }
    }
}
