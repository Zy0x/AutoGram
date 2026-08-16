use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

pub const DOWNLOAD_CHUNK_SIZE: u64 = 512 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownloadConflictPolicy {
    Ask,
    Rename,
    Overwrite,
    Skip,
}

impl DownloadConflictPolicy {
    pub fn parse(value: Option<&str>) -> Self {
        match value.unwrap_or("overwrite") {
            "ask" => Self::Ask,
            "rename" => Self::Rename,
            "skip" => Self::Skip,
            _ => Self::Overwrite,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ask => "ask",
            Self::Rename => "rename",
            Self::Overwrite => "overwrite",
            Self::Skip => "skip",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownloadIntegrity {
    Size,
    Sha256,
}

impl DownloadIntegrity {
    pub fn parse(value: Option<&str>) -> Self {
        if matches!(value, Some("sha256")) {
            Self::Sha256
        } else {
            Self::Size
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Size => "size",
            Self::Sha256 => "sha256",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DownloadDestinationPlan {
    Download {
        final_path: PathBuf,
        partial_path: PathBuf,
        replaces_existing: bool,
    },
    SkipExisting {
        final_path: PathBuf,
    },
}

pub fn sanitize_download_filename(value: &str) -> String {
    let mut sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    sanitized = sanitized.trim().trim_end_matches(['.', ' ']).to_string();
    if sanitized.is_empty() || matches!(sanitized.as_str(), "." | "..") {
        sanitized = "download".into();
    }
    let base = sanitized
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end_matches(['.', ' '])
        .to_ascii_uppercase();
    let reserved = matches!(
        base.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    );
    if reserved {
        sanitized.insert(0, '_');
    }
    if sanitized.chars().count() > 240 {
        sanitized = sanitized.chars().take(240).collect();
        sanitized = sanitized.trim_end_matches(['.', ' ']).to_string();
    }
    sanitized
}

pub fn sanitize_download_path(path: &Path) -> PathBuf {
    let Some(filename) = path.file_name().and_then(|value| value.to_str()) else {
        return path.to_path_buf();
    };
    path.parent()
        .unwrap_or_else(|| Path::new("."))
        .join(sanitize_download_filename(filename))
}

pub fn partial_path_for(final_path: &Path) -> PathBuf {
    let mut value = final_path.as_os_str().to_os_string();
    value.push(".autogrampart");
    PathBuf::from(value)
}

pub fn resolve_download_destination(
    requested_path: &Path,
    policy: DownloadConflictPolicy,
) -> Result<DownloadDestinationPlan, String> {
    if !requested_path.exists() {
        return Ok(DownloadDestinationPlan::Download {
            final_path: requested_path.to_path_buf(),
            partial_path: partial_path_for(requested_path),
            replaces_existing: false,
        });
    }

    match policy {
        DownloadConflictPolicy::Ask => {
            Err("DOWNLOAD_CONFLICT_REQUIRES_DECISION: destination already exists".into())
        }
        DownloadConflictPolicy::Skip => Ok(DownloadDestinationPlan::SkipExisting {
            final_path: requested_path.to_path_buf(),
        }),
        DownloadConflictPolicy::Overwrite => Ok(DownloadDestinationPlan::Download {
            final_path: requested_path.to_path_buf(),
            partial_path: partial_path_for(requested_path),
            replaces_existing: true,
        }),
        DownloadConflictPolicy::Rename => {
            let parent = requested_path.parent().unwrap_or_else(|| Path::new("."));
            let stem = requested_path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("download");
            let extension = requested_path.extension().and_then(|value| value.to_str());
            for suffix in 1..=100_000usize {
                let name = match extension {
                    Some(extension) if !extension.is_empty() => {
                        format!("{stem} ({suffix}).{extension}")
                    }
                    _ => format!("{stem} ({suffix})"),
                };
                let candidate = parent.join(name);
                let partial = partial_path_for(&candidate);
                if !candidate.exists() && !partial.exists() {
                    return Ok(DownloadDestinationPlan::Download {
                        final_path: candidate,
                        partial_path: partial,
                        replaces_existing: false,
                    });
                }
            }
            Err("unable to allocate a unique download filename".into())
        }
    }
}

/// Return a safe resume boundary. A trailing partial Telegram chunk is
/// discarded so `skip_chunks` and the local write offset remain identical.
pub fn prepare_partial_for_resume(
    partial_path: &Path,
    expected_size: u64,
    resume_enabled: bool,
) -> Result<u64, String> {
    if !resume_enabled || !partial_path.exists() {
        if partial_path.exists() {
            fs::remove_file(partial_path)
                .map_err(|error| format!("remove stale partial: {error}"))?;
        }
        return Ok(0);
    }
    let current_size = fs::metadata(partial_path)
        .map_err(|error| format!("read partial metadata: {error}"))?
        .len();
    if current_size > expected_size {
        fs::remove_file(partial_path)
            .map_err(|error| format!("remove oversized partial: {error}"))?;
        return Ok(0);
    }
    if current_size == expected_size {
        return Ok(current_size);
    }
    let aligned = current_size - (current_size % DOWNLOAD_CHUNK_SIZE);
    if aligned != current_size {
        OpenOptions::new()
            .write(true)
            .open(partial_path)
            .and_then(|file| file.set_len(aligned))
            .map_err(|error| format!("truncate partial to chunk boundary: {error}"))?;
    }
    Ok(aligned)
}

pub fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| format!("open for SHA-256: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("read for SHA-256: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub fn sha256_bytes(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub fn open_partial_for_append(path: &Path, offset: u64) -> Result<File, String> {
    let mut file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("open partial download: {error}"))?;
    file.set_len(offset)
        .map_err(|error| format!("set partial length: {error}"))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| format!("seek partial download: {error}"))?;
    Ok(file)
}

/// Finalize only after integrity checks pass. Existing output is first moved
/// to a recoverable sibling backup, then restored if the final rename fails.
pub fn finalize_partial(
    partial_path: &Path,
    final_path: &Path,
    replaces_existing: bool,
) -> Result<(), String> {
    if !replaces_existing || !final_path.exists() {
        return fs::rename(partial_path, final_path)
            .map_err(|error| format!("finalize download: {error}"));
    }

    let mut backup_name = final_path.as_os_str().to_os_string();
    backup_name.push(".autogrambak");
    let backup_path = PathBuf::from(backup_name);
    if backup_path.exists() {
        return Err("download backup path already exists; manual recovery required".into());
    }
    fs::rename(final_path, &backup_path)
        .map_err(|error| format!("stage existing destination: {error}"))?;
    match fs::rename(partial_path, final_path) {
        Ok(()) => {
            fs::remove_file(&backup_path)
                .map_err(|error| format!("remove finalized backup: {error}"))?;
            Ok(())
        }
        Err(error) => {
            let _ = fs::rename(&backup_path, final_path);
            Err(format!("finalize download: {error}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn test_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "autogram-download-test-{name}-{}",
            rand::random::<u64>()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn rename_policy_preserves_extension() {
        let root = test_root("rename");
        let requested = root.join("photo.jpg");
        fs::write(&requested, b"existing").unwrap();
        let plan =
            resolve_download_destination(&requested, DownloadConflictPolicy::Rename).unwrap();
        match plan {
            DownloadDestinationPlan::Download { final_path, .. } => {
                assert_eq!(final_path.file_name().unwrap(), "photo (1).jpg");
            }
            _ => panic!("expected renamed download"),
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn partial_resume_truncates_unverified_tail() {
        let root = test_root("resume");
        let partial = root.join("file.bin.autogrampart");
        let mut file = File::create(&partial).unwrap();
        file.write_all(&vec![7u8; DOWNLOAD_CHUNK_SIZE as usize + 19])
            .unwrap();
        let offset = prepare_partial_for_resume(&partial, DOWNLOAD_CHUNK_SIZE * 3, true).unwrap();
        assert_eq!(offset, DOWNLOAD_CHUNK_SIZE);
        assert_eq!(fs::metadata(&partial).unwrap().len(), DOWNLOAD_CHUNK_SIZE);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn overwrite_finalization_restores_or_replaces_safely() {
        let root = test_root("finalize");
        let final_path = root.join("output.bin");
        let partial_path = partial_path_for(&final_path);
        fs::write(&final_path, b"old").unwrap();
        fs::write(&partial_path, b"new").unwrap();
        finalize_partial(&partial_path, &final_path, true).unwrap();
        assert_eq!(fs::read(&final_path).unwrap(), b"new");
        assert!(!partial_path.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn filename_sanitizer_blocks_traversal_and_windows_devices() {
        assert_eq!(
            sanitize_download_filename("../bad:name?.txt"),
            ".._bad_name_.txt"
        );
        assert_eq!(sanitize_download_filename("CON.txt"), "_CON.txt");
        assert_eq!(sanitize_download_filename("report. "), "report");
    }
}
