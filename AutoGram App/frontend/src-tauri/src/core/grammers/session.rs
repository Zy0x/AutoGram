//! Grammers session, paths, and client pool helpers.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const BACKEND: &str = "grammers";

pub fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

pub fn cache_root(sessions_dir: &Path) -> PathBuf {
    sessions_dir
        .parent()
        .map(|p| p.join("cache"))
        .unwrap_or_else(|| PathBuf::from("cache"))
}

pub fn preview_dir(sessions_dir: &Path) -> PathBuf {
    cache_root(sessions_dir).join("preview")
}

pub fn thumb_dir(sessions_dir: &Path) -> PathBuf {
    cache_root(sessions_dir).join("thumbs")
}
