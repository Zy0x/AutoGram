//! Temp Storage Lifecycle & Auto LRU Purge Manager

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageBudget {
    pub max_temp_bytes: u64,
    pub purge_threshold_ratio: f32, // e.g. 0.90 for 90%
}

impl Default for StorageBudget {
    fn default() -> Self {
        Self {
            max_temp_bytes: 20 * 1024 * 1024 * 1024, // 20 GB default
            purge_threshold_ratio: 0.90,
        }
    }
}

pub struct StorageManager {
    pub temp_dir: PathBuf,
    pub budget: StorageBudget,
}

impl StorageManager {
    pub fn new(temp_dir: PathBuf, budget: StorageBudget) -> Self {
        let _ = fs::create_dir_all(&temp_dir);
        Self { temp_dir, budget }
    }

    pub fn purge_lru(&self) -> Result<u64, String> {
        if !self.temp_dir.exists() {
            return Ok(0);
        }

        let mut total_freed = 0u64;
        let mut entries = Vec::new();

        if let Ok(dir_entries) = fs::read_dir(&self.temp_dir) {
            for entry in dir_entries.flatten() {
                let path = entry.path();
                if let Ok(meta) = entry.metadata() {
                    let modified = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    entries.push((path, meta.len(), modified));
                }
            }
        }

        // Sort by modified time ascending (oldest first)
        entries.sort_by_key(|e| e.2);

        for (path, size, _) in entries {
            if fs::remove_file(&path).is_ok() {
                total_freed += size;
            }
        }

        Ok(total_freed)
    }
}
