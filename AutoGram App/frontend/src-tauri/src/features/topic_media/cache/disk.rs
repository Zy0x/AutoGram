//! Level 2 WebP disk cache manager with atomic writes.

use std::fs;
use std::path::{Path, PathBuf};

pub fn get_account_cache_dir(account_id: &str) -> PathBuf {
    let mut dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    dir.push("app-data");
    dir.push("accounts");
    dir.push(account_id);
    dir.push("media-cache");
    dir.push("thumbnails");
    dir
}

pub fn save_thumbnail_atomic(
    account_id: &str,
    file_basename: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let cache_dir = get_account_cache_dir(account_id);
    fs::create_dir_all(&cache_dir).map_err(|e| format!("Failed create cache dir: {e}"))?;

    let tmp_path = cache_dir.join(format!("{file_basename}.tmp"));
    let final_path = cache_dir.join(format!("{file_basename}.webp"));

    fs::write(&tmp_path, bytes).map_err(|e| format!("Failed write tmp thumb: {e}"))?;
    fs::rename(&tmp_path, &final_path).map_err(|e| format!("Failed rename thumb: {e}"))?;

    Ok(final_path)
}
