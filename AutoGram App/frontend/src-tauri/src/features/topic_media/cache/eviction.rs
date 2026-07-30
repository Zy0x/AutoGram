//! Cache eviction policy and cleanup routines.

use std::fs;
use std::path::Path;

pub fn cleanup_temp_cache_files(dir: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("tmp") {
                let _ = fs::remove_file(path);
            }
        }
    }
}
