//! download_registry.rs — Active Downloads File Registry & Cleanup (Rust)
//!
//! Port of Python `download_registry.py`:
//! Tracks in-progress file downloads in `worker/temp/drive_active_downloads.json`
//! so that user cancellation/Stop wps incomplete `.part` and partial files cleanly.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::jobs_db::resolve_migrator_db;
use super::tg_log;

const BACKEND: &str = "download_registry";

static REGISTRY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct RegistryData {
    pub paths: Vec<String>,
    pub updated: f64,
}

fn get_registry_path() -> PathBuf {
    let db_path = resolve_migrator_db();
    if let Some(worker) = db_path.parent().and_then(|p| p.parent()) {
        worker.join("temp").join("drive_active_downloads.json")
    } else {
        PathBuf::from("temp/drive_active_downloads.json")
    }
}

fn load_unlocked() -> HashSet<String> {
    let p = get_registry_path();
    if !p.is_file() {
        return HashSet::new();
    }
    let Ok(content) = std::fs::read_to_string(&p) else {
        return HashSet::new();
    };
    let Ok(data) = serde_json::from_str::<RegistryData>(&content) else {
        return HashSet::new();
    };
    data.paths.into_iter().collect()
}

fn save_unlocked(paths: &HashSet<String>) {
    let p = get_registry_path();
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut sorted: Vec<String> = paths.iter().cloned().collect();
    sorted.sort();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);

    let data = RegistryData {
        paths: sorted,
        updated: now,
    };

    if let Ok(json) = serde_json::to_string_pretty(&data) {
        let tmp = p.with_extension("tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(tmp, p);
        }
    }
}

pub fn register_download_path(dest: &str) {
    let s = dest.trim();
    if s.is_empty() {
        return;
    }
    let canon = PathBuf::from(s).display().to_string();
    let _guard = REGISTRY_LOCK.lock();
    let mut set = load_unlocked();
    set.insert(canon);
    save_unlocked(&set);
}

pub fn unregister_download_path(dest: &str) {
    let s = dest.trim();
    if s.is_empty() {
        return;
    }
    let canon = PathBuf::from(s).display().to_string();
    let _guard = REGISTRY_LOCK.lock();
    let mut set = load_unlocked();
    set.remove(&canon);
    save_unlocked(&set);
}

pub fn list_active_download_paths() -> Vec<String> {
    let _guard = REGISTRY_LOCK.lock();
    let set = load_unlocked();
    let mut vec: Vec<String> = set.into_iter().collect();
    vec.sort();
    vec
}

pub fn clear_download_registry() {
    let _guard = REGISTRY_LOCK.lock();
    save_unlocked(&HashSet::new());
    let p = get_registry_path();
    if p.is_file() {
        let _ = std::fs::remove_file(p);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    pub deleted: Vec<String>,
    pub failed: Vec<String>,
    pub count: usize,
}

/// Delete incomplete download artifacts: dest + dest.part.
pub fn cleanup_paths(paths: &[String]) -> CleanupResult {
    let mut deleted = Vec::new();
    let mut failed = Vec::new();

    for raw in paths {
        let p = Path::new(raw);
        let part = PathBuf::from(format!("{}.part", raw));

        // Wipe .part
        if part.is_file() {
            if std::fs::remove_file(&part).is_ok() {
                deleted.push(part.display().to_string());
            } else {
                failed.push(part.display().to_string());
            }
        }

        // Wipe destination file if incomplete
        if p.is_file() {
            if std::fs::remove_file(p).is_ok() {
                deleted.push(p.display().to_string());
            } else {
                failed.push(p.display().to_string());
            }
        }
    }

    let count = deleted.len();
    tg_log::info(
        BACKEND,
        "cleanup_paths",
        format!("Cleaned {count} temporary files"),
    );

    CleanupResult {
        deleted,
        failed,
        count,
    }
}
