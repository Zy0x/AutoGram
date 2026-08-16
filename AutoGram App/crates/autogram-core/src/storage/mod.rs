//! Temp Storage Lifecycle & Auto Purge

pub mod storage_manager;

pub use storage_manager::{StorageBudget, StorageManager};

use std::path::PathBuf;

pub fn resolve_migrator_db() -> PathBuf {
    if let Ok(p) = std::env::var("AUTOGRAM_DB_PATH") {
        let pb = PathBuf::from(p);
        if !pb.as_os_str().is_empty() {
            return pb;
        }
    }
    // Check local data directory / database/telegram_migrator.db
    let default_db = PathBuf::from("database").join("telegram_migrator.db");
    if default_db.exists() {
        return default_db;
    }
    if let Ok(cwd) = std::env::current_dir() {
        let candidate = cwd.join("database").join("telegram_migrator.db");
        if candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from("telegram_migrator.db")
}
