//! Checkpoint Hash & Integrity Validator

use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Result as IoResult};
use std::path::Path;

pub fn calculate_file_sha256(path: &Path) -> IoResult<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];

    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

pub fn validate_checkpoint_hash(path: &Path, expected_hash: &str) -> bool {
    if !path.exists() {
        return false;
    }
    match calculate_file_sha256(path) {
        Ok(hash) => hash.eq_ignore_ascii_case(expected_hash),
        Err(_) => false,
    }
}
