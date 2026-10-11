//! Exclusive, nonblocking OS locks whose lifetime is the owning file descriptor.
//! Rust 1.97's standard-library locking does not implement Android. Use Bionic's
//! flock there; never replace cross-process exclusion with an in-memory mutex.
use std::{fs::File, io};

pub fn try_lock_exclusive(file: &File) -> io::Result<()> {
    #[cfg(target_os = "android")]
    {
        use std::os::fd::AsRawFd;
        // SAFETY: the descriptor is borrowed from a live File; flock retains no
        // pointers. Closing this File releases the lock even after process death.
        let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if result == 0 { Ok(()) } else { Err(io::Error::last_os_error()) }
    }
    #[cfg(not(target_os = "android"))]
    { file.try_lock().map_err(io::Error::from) }
}
