use std::path::Path;

/// Atomic same-volume publication, without replacement on Windows (including
/// exFAT, where hard links are unavailable). The staging file is already closed.
#[cfg(windows)]
pub(super) fn publish(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" { fn MoveFileW(existing: *const u16, new: *const u16) -> i32; }
    let source: Vec<_> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<_> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: Both arrays are NUL-terminated and remain alive for the call.
    if unsafe { MoveFileW(source.as_ptr(), destination.as_ptr()) } == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(windows))]
pub(super) fn publish(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::hard_link(source, destination)
}
