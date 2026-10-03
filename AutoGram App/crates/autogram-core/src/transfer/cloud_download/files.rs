use super::{DownloadError, DownloadRecord, DownloadState};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

pub(crate) fn normalize_target(path: &Path) -> Result<PathBuf, DownloadError> {
    if !path.is_absolute() {
        return Err(DownloadError::InvalidRequest);
    }
    let name = path
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or(DownloadError::InvalidRequest)?;
    // Validate, never silently choose a different destination or an NTFS alternate data stream.
    if name != crate::transfer::download::sanitize_download_filename(name) {
        return Err(DownloadError::InvalidRequest);
    }
    let parent = path.parent().ok_or(DownloadError::InvalidRequest)?;
    let parent =
        fs::canonicalize(parent).map_err(|e| DownloadError::io("resolve_target_parent", e))?;
    if !parent.is_dir() {
        return Err(DownloadError::InvalidRequest);
    }
    Ok(parent.join(name))
}

pub(crate) struct OwnedFile {
    file: File,
    path: PathBuf,
    pub identity: String,
}

impl OwnedFile {
    pub fn open(record: &DownloadRecord) -> Result<Self, DownloadError> {
        let path = record.request.temp_path();
        if normalize_target(path)? != path
            || normalize_target(record.request.output_path())? != record.request.output_path()
        {
            return Err(DownloadError::Ownership);
        }
        if record.file_identity.is_none() && record.checkpoint_bytes != 0 {
            return Err(DownloadError::Ownership);
        }
        let file = if record.file_identity.is_none() {
            if record.state != DownloadState::Queued {
                return Err(DownloadError::InvalidState);
            }
            match fs::symlink_metadata(record.request.output_path()) {
                Ok(_) => return Err(DownloadError::DestinationExists),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(DownloadError::io("check_output", e)),
            }
            OpenOptions::new()
                .read(true)
                .write(true)
                .create_new(true)
                .open(path)
                .map_err(|e| {
                    if e.kind() == std::io::ErrorKind::AlreadyExists {
                        DownloadError::Ownership
                    } else {
                        DownloadError::io("create_owned_temp", e)
                    }
                })?
        } else {
            ensure_regular(path)?;
            OpenOptions::new()
                .read(true)
                .write(true)
                .open(path)
                .map_err(|e| DownloadError::io("open_owned_temp", e))?
        };
        match file.try_lock() {
            Ok(()) => {}
            Err(std::fs::TryLockError::WouldBlock) => return Err(DownloadError::Busy),
            Err(std::fs::TryLockError::Error(e)) => {
                return Err(DownloadError::io("lock_owned_temp", e))
            }
        }
        let (identity, links) = file_identity(&file)?;
        if record
            .file_identity
            .as_ref()
            .is_some_and(|expected| expected != &identity)
        {
            return Err(DownloadError::Ownership);
        }
        let max_links = if matches!(
            record.state,
            DownloadState::Publishing | DownloadState::Completed
        ) {
            2
        } else {
            1
        };
        if links > max_links {
            return Err(DownloadError::Ownership);
        }
        let result = Self {
            file,
            path: path.to_owned(),
            identity,
        };
        result.verify_path()?;
        // Makes the creation durable before saving its ownership in SQLite.
        result
            .file
            .sync_all()
            .map_err(|e| DownloadError::io("sync_owned_temp", e))?;
        sync_parent(path)?;
        Ok(result)
    }

    pub fn verify_path(&self) -> Result<(), DownloadError> {
        ensure_regular(&self.path)?;
        let observed =
            File::open(&self.path).map_err(|e| DownloadError::io("verify_owned_path", e))?;
        if file_identity(&observed)?.0 != self.identity {
            return Err(DownloadError::Ownership);
        }
        Ok(())
    }

    pub fn resume(&mut self, record: &DownloadRecord) -> Result<Sha256, DownloadError> {
        self.verify_path()?;
        let length = self
            .file
            .metadata()
            .map_err(|e| DownloadError::io("temp_metadata", e))?
            .len();
        if length < record.checkpoint_bytes || length > record.request.expected_size() {
            return Err(DownloadError::Integrity);
        }
        let hasher = self.hash_prefix(record.checkpoint_bytes)?;
        if digest(&hasher) != record.checkpoint_sha256 {
            return Err(DownloadError::Integrity);
        }
        if length != record.checkpoint_bytes {
            self.file
                .set_len(record.checkpoint_bytes)
                .map_err(|e| DownloadError::io("truncate_owned_tail", e))?;
            self.file
                .sync_all()
                .map_err(|e| DownloadError::io("sync_resume", e))?;
        }
        self.file
            .seek(SeekFrom::Start(record.checkpoint_bytes))
            .map_err(|e| DownloadError::io("seek_resume", e))?;
        Ok(hasher)
    }

    fn hash_prefix(&mut self, length: u64) -> Result<Sha256, DownloadError> {
        self.file
            .seek(SeekFrom::Start(0))
            .map_err(|e| DownloadError::io("seek_hash", e))?;
        let mut hasher = Sha256::new();
        let mut remaining = length;
        let mut buffer = vec![0; crate::transfer::download::DOWNLOAD_CHUNK_SIZE as usize];
        while remaining > 0 {
            let count = remaining.min(buffer.len() as u64) as usize;
            self.file
                .read_exact(&mut buffer[..count])
                .map_err(|e| DownloadError::io("hash_prefix", e))?;
            hasher.update(&buffer[..count]);
            remaining -= count as u64;
        }
        Ok(hasher)
    }

    pub fn append(&mut self, bytes: &[u8]) -> Result<(), DownloadError> {
        self.verify_path()?;
        if file_identity(&self.file)?.1 != 1 {
            return Err(DownloadError::Ownership);
        }
        self.file
            .write_all(bytes)
            .map_err(|e| DownloadError::io("write_chunk", e))?;
        self.file
            .sync_all()
            .map_err(|e| DownloadError::io("sync_chunk", e))
    }

    pub fn verify_full(&mut self, size: u64, expected: &str) -> Result<(), DownloadError> {
        self.verify_path()?;
        if self
            .file
            .metadata()
            .map_err(|e| DownloadError::io("verify_size", e))?
            .len()
            != size
            || digest(&self.hash_prefix(size)?) != expected
        {
            return Err(DownloadError::Integrity);
        }
        Ok(())
    }

    /// Hard link creation is atomic and refuses existing targets on Windows/Unix.
    /// Retain the owned staging name for recovery; never delete/rename/overwrite a caller file.
    pub fn publish(&self, output: &Path, recovering: bool) -> Result<(), DownloadError> {
        self.verify_path()?;
        match fs::hard_link(&self.path, output) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && recovering => {
                ensure_regular(output)?;
                let existing =
                    File::open(output).map_err(|e| DownloadError::io("open_published", e))?;
                if file_identity(&existing)?.0 != self.identity {
                    return Err(DownloadError::DestinationExists);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(DownloadError::DestinationExists)
            }
            Err(e) => return Err(DownloadError::io("publish_no_replace", e)),
        }
        self.verify_path()?;
        let output_file =
            File::open(output).map_err(|e| DownloadError::io("verify_published", e))?;
        if file_identity(&output_file)?.0 != self.identity {
            return Err(DownloadError::Ownership);
        }
        self.file
            .sync_all()
            .map_err(|e| DownloadError::io("sync_published", e))?;
        sync_parent(output)
    }
}

pub(crate) fn digest(hasher: &Sha256) -> String {
    hex::encode(hasher.clone().finalize())
}

fn ensure_regular(path: &Path) -> Result<(), DownloadError> {
    let metadata =
        fs::symlink_metadata(path).map_err(|e| DownloadError::io("check_owned_file", e))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(DownloadError::Ownership);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(DownloadError::Ownership);
        }
    }
    Ok(())
}

#[cfg(unix)]
fn file_identity(file: &File) -> Result<(String, u64), DownloadError> {
    use std::os::unix::fs::MetadataExt;
    let m = file
        .metadata()
        .map_err(|e| DownloadError::io("file_identity", e))?;
    Ok((format!("unix:{}:{}", m.dev(), m.ino()), m.nlink()))
}

#[cfg(windows)]
fn file_identity(file: &File) -> Result<(String, u64), DownloadError> {
    use std::os::windows::io::AsRawHandle;
    #[repr(C)]
    #[derive(Default)]
    struct Information {
        attributes: u32,
        creation: [u32; 2],
        access: [u32; 2],
        write: [u32; 2],
        volume: u32,
        size_high: u32,
        size_low: u32,
        links: u32,
        index_high: u32,
        index_low: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileInformationByHandle(handle: *mut std::ffi::c_void, info: *mut Information)
            -> i32;
    }
    let mut info = Information::default();
    // SAFETY: file owns a live OS handle, and info is a correctly sized/aligned output struct.
    let ok = unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) };
    if ok == 0 {
        return Err(DownloadError::io(
            "file_identity",
            std::io::Error::last_os_error(),
        ));
    }
    Ok((
        format!(
            "windows:{}:{}:{}",
            info.volume, info.index_high, info.index_low
        ),
        info.links as u64,
    ))
}

#[cfg(unix)]
fn sync_parent(path: &Path) -> Result<(), DownloadError> {
    File::open(path.parent().ok_or(DownloadError::InvalidRequest)?)
        .and_then(|f| f.sync_all())
        .map_err(|e| DownloadError::io("sync_parent", e))
}
// Windows flushes file contents via sync_all; opening a directory for FlushFileBuffers is unsupported.
#[cfg(windows)]
fn sync_parent(_: &Path) -> Result<(), DownloadError> {
    Ok(())
}
