//! Local file hashing (Rust) — duplicate / fingerprint without Python.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufReader, Read};

use super::path_policy;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHashResult {
    pub path: String,
    pub size: u64,
    pub sha256: String,
    pub backend: String,
}

pub fn sha256_file(path: &str) -> Result<FileHashResult, String> {
    let p = path_policy::assert_safe_transfer_path(path)?;
    if !p.is_file() {
        return Err("file not found".into());
    }
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    let file = File::open(&p).map_err(|e| e.to_string())?;
    let mut reader = BufReader::with_capacity(256 * 1024, file);
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    Ok(FileHashResult {
        path: p.to_string_lossy().into_owned(),
        size: meta.len(),
        sha256: hex::encode(digest),
        backend: "rust".into(),
    })
}

/// Quick fingerprint: size + sha256 of first/last 64KiB (for huge files).
pub fn quick_fingerprint(path: &str) -> Result<FileHashResult, String> {
    let p = path_policy::assert_safe_transfer_path(path)?;
    if !p.is_file() {
        return Err("file not found".into());
    }
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    let size = meta.len();
    if size <= 256 * 1024 {
        return sha256_file(path);
    }
    let mut file = File::open(&p).map_err(|e| e.to_string())?;
    let mut head = vec![0u8; 64 * 1024];
    let mut tail = vec![0u8; 64 * 1024];
    use std::io::{Read, Seek, SeekFrom};
    file.read_exact(&mut head).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::End(-(64 * 1024))).map_err(|e| e.to_string())?;
    file.read_exact(&mut tail).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(&(size.to_le_bytes()));
    hasher.update(&head);
    hasher.update(&tail);
    Ok(FileHashResult {
        path: p.to_string_lossy().into_owned(),
        size,
        sha256: hex::encode(hasher.finalize()),
        backend: "rust".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn hashes_small_file() {
        let dir = std::env::temp_dir().join("ag_hash_test");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("a.bin");
        let mut f = std::fs::File::create(&path).unwrap();
        write!(f, "hello").unwrap();
        let r = sha256_file(path.to_str().unwrap()).unwrap();
        assert_eq!(r.size, 5);
        assert_eq!(r.sha256.len(), 64);
    }
}
