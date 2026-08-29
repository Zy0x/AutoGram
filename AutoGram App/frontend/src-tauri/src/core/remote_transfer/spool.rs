use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

use super::models::RemoteTransferJob;
use crate::core::path_policy;

const MIN_SAFETY_MARGIN_BYTES: u64 = 256 * 1024 * 1024; // 256 MiB
const THUMBNAIL_HEADROOM_BYTES: u64 = 5 * 1024 * 1024;  // 5 MiB

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpoolManifest {
    pub job_id: String,
    pub source_url: String,
    pub filename: String,
    pub total_size: Option<u64>,
    pub downloaded_bytes: u64,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub status: String,
    pub storage_policy: String,
    pub custom_disk_path: Option<String>,
}

pub fn resolve_spool_root() -> PathBuf {
    let base = crate::core::jobs_db::resolve_migrator_db()
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("database"));
    let spool_dir = base.join("spool");
    let _ = fs::create_dir_all(&spool_dir);
    spool_dir
}

fn sanitize_id(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

pub fn job_part_path(job_id: &str) -> PathBuf {
    let safe_id = sanitize_id(job_id);
    resolve_spool_root().join(format!("{safe_id}.part"))
}

pub fn job_manifest_path(job_id: &str) -> PathBuf {
    let safe_id = sanitize_id(job_id);
    resolve_spool_root().join(format!("{safe_id}.manifest.json"))
}

pub fn job_lock_path(job_id: &str) -> PathBuf {
    let safe_id = sanitize_id(job_id);
    resolve_spool_root().join(format!("{safe_id}.lock"))
}

pub fn calculate_required_disk_space(source_size: Option<u64>) -> u64 {
    let size = source_size.unwrap_or(50 * 1024 * 1024); // default estimate 50MB
    let margin = (size / 10).max(MIN_SAFETY_MARGIN_BYTES);
    size.saturating_add(margin).saturating_add(THUMBNAIL_HEADROOM_BYTES)
}

#[cfg(target_os = "windows")]
pub fn get_available_disk_space(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    let target = if path.is_file() {
        path.parent().unwrap_or(path)
    } else {
        path
    };
    let wide_path: Vec<u16> = target.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut free_bytes_available = 0u64;
    let mut total_number_of_bytes = 0u64;
    let mut total_number_of_free_bytes = 0u64;
    extern "system" {
        fn GetDiskFreeSpaceExW(
            lpDirectoryName: *const u16,
            lpFreeBytesAvailableToCaller: *mut u64,
            lpTotalNumberOfBytes: *mut u64,
            lpTotalNumberOfFreeBytes: *mut u64,
        ) -> i32;
    }
    let success = unsafe {
        GetDiskFreeSpaceExW(
            wide_path.as_ptr(),
            &mut free_bytes_available,
            &mut total_number_of_bytes,
            &mut total_number_of_free_bytes,
        )
    };
    if success != 0 {
        Some(free_bytes_available)
    } else {
        None
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_available_disk_space(_path: &Path) -> Option<u64> {
    None
}

pub fn acquire_job_lock(job_id: &str) -> Result<File, String> {
    let lock_p = job_lock_path(job_id);
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&lock_p)
        .map_err(|e| format!("acquire lock failed: {e}"))?;
    let pid = std::process::id();
    let _ = write!(file, "{pid}");
    Ok(file)
}

pub fn release_job_lock(job_id: &str) {
    let lock_p = job_lock_path(job_id);
    let _ = fs::remove_file(lock_p);
}

pub fn write_manifest(manifest: &SpoolManifest) -> Result<(), String> {
    let manifest_p = job_manifest_path(&manifest.job_id);
    let data = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("serialize manifest: {e}"))?;
    let tmp = manifest_p.with_extension("tmp");
    fs::write(&tmp, data).map_err(|e| format!("write manifest tmp: {e}"))?;
    fs::rename(&tmp, &manifest_p).map_err(|e| format!("persist manifest: {e}"))?;
    Ok(())
}

pub fn read_manifest(job_id: &str) -> Option<SpoolManifest> {
    let manifest_p = job_manifest_path(job_id);
    let data = fs::read_to_string(manifest_p).ok()?;
    serde_json::from_str(&data).ok()
}

pub fn cleanup_job_spool(job_id: &str) {
    let part_p = job_part_path(job_id);
    let manifest_p = job_manifest_path(job_id);
    let lock_p = job_lock_path(job_id);
    let _ = fs::remove_file(part_p);
    let _ = fs::remove_file(manifest_p);
    let _ = fs::remove_file(lock_p);
}
