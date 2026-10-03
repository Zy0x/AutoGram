//! Actual available-to-caller filesystem bytes. Never substitute a quota/estimate.
use super::storage_provider::StorageError;
use std::path::{Path, PathBuf};

fn query_directory(path: &str) -> Result<PathBuf, StorageError> {
    if path.trim().is_empty() || path.contains('\0') {
        return Err(StorageError::IoError("invalid_storage_path".into()));
    }
    if path.contains("://") {
        return Err(StorageError::UnsupportedPlatform("uri_requires_platform_adapter".into()));
    }
    let requested = Path::new(path);
    let existing = match requested.try_exists().map_err(storage_io_error)? {
        true => requested,
        false => requested.parent().filter(|p| !p.as_os_str().is_empty())
            .ok_or_else(|| StorageError::NotFound("storage_parent_missing".into()))?,
    };
    let resolved = existing.canonicalize().map_err(storage_io_error)?;
    if resolved.is_dir() {
        Ok(resolved)
    } else {
        resolved.parent().map(Path::to_path_buf)
            .ok_or_else(|| StorageError::NotFound("storage_parent_missing".into()))
    }
}

pub(crate) fn storage_io_error(error: std::io::Error) -> StorageError {
    use std::io::ErrorKind;
    match error.kind() {
        ErrorKind::NotFound => StorageError::NotFound("storage_path_missing".into()),
        ErrorKind::PermissionDenied => StorageError::PermissionDenied("storage_access_denied".into()),
        _ => StorageError::IoError(format!("storage_io_{:?}", error.kind())),
    }
}

pub fn available_storage_bytes(path: &str) -> Result<u64, StorageError> {
    let directory = query_directory(path)?;
    os_available_bytes(&directory)
}

#[cfg(windows)]
fn os_available_bytes(directory: &Path) -> Result<u64, StorageError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = directory.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut available = 0u64;
    // SAFETY: canonical path is NUL terminated; writable output lives through call.
    let result = unsafe {
        GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, std::ptr::null_mut(), std::ptr::null_mut())
    };
    if result == 0 { Err(storage_io_error(std::io::Error::last_os_error())) }
    else { Ok(available) }
}

#[cfg(unix)]
fn os_available_bytes(directory: &Path) -> Result<u64, StorageError> {
    use std::{ffi::CString, mem::MaybeUninit, os::unix::ffi::OsStrExt};
    let path = CString::new(directory.as_os_str().as_bytes())
        .map_err(|_| StorageError::IoError("invalid_storage_path".into()))?;
    let mut info = MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: valid C string and correctly sized writable OS structure.
    if unsafe { libc::statvfs(path.as_ptr(), info.as_mut_ptr()) } != 0 {
        return Err(storage_io_error(std::io::Error::last_os_error()));
    }
    // SAFETY: successful statvfs initialized the structure.
    let info = unsafe { info.assume_init() };
    // Use blocks available to this caller, not reserved root-only free blocks.
    (info.f_bavail as u64).checked_mul(info.f_frsize as u64)
        .ok_or_else(|| StorageError::IoError("storage_capacity_overflow".into()))
}

#[cfg(not(any(windows, unix)))]
fn os_available_bytes(_: &Path) -> Result<u64, StorageError> {
    Err(StorageError::UnsupportedPlatform("storage_capacity_unavailable".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::storage_provider::{AndroidStorageProvider, DesktopStorageProvider, StorageProvider};

    #[test]
    fn both_providers_measure_the_same_actual_filesystem() {
        let root = std::env::temp_dir().canonicalize().unwrap();
        let path = root.to_str().unwrap();
        let desktop = DesktopStorageProvider::new().available_space(path).unwrap();
        let android = AndroidStorageProvider::new(path.into()).available_space(path).unwrap();
        // Other processes can allocate/free disk concurrently. Never expect a fixed quota.
        assert!(desktop.abs_diff(android) < 256 * 1024 * 1024);
        assert_eq!(query_directory(path).unwrap(), root);
        assert_eq!(query_directory(&root.join("autogram-uncreated-target.mp4").to_string_lossy()).unwrap(), root);
    }

    #[test]
    fn invalid_uri_and_missing_paths_never_return_invented_capacity() {
        for path in ["", "  ", "bad\0path", "content://documents/private", "https://example.com/file"] {
            assert!(available_storage_bytes(path).is_err());
        }
        let missing = std::env::temp_dir().join(format!("autogram-missing-{}", rand::random::<u64>()));
        assert!(available_storage_bytes(&missing.join("nested/file").to_string_lossy()).is_err());
        assert!(!missing.exists()); // Querying cannot create directories.
    }
}
