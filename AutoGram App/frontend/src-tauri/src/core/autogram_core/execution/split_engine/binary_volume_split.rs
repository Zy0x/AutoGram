//! Raw Byte Binary Volume Split Engine for Archives and Documents

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinaryVolumePart {
    pub index: usize,
    pub filename: String,
    pub path: PathBuf,
    pub size: u64,
    pub sha256: String,
}

pub fn split_binary_volume(
    input_path: &Path,
    output_dir: &Path,
    max_volume_bytes: u64,
) -> Result<Vec<BinaryVolumePart>, String> {
    let mut file = File::open(input_path).map_err(|e| format!("open input: {e}"))?;
    let orig_filename = input_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file.bin".to_string());

    let mut parts = Vec::new();
    let mut buffer = vec![0u8; 1024 * 1024]; // 1MB buffer
    let mut part_index = 1;

    loop {
        let part_name = format!("{orig_filename}.part{:03}", part_index);
        let part_path = output_dir.join(&part_name);
        let mut part_file = File::create(&part_path).map_err(|e| format!("create part: {e}"))?;
        let mut written_for_part = 0u64;

        while written_for_part < max_volume_bytes {
            let to_read = (max_volume_bytes - written_for_part).min(buffer.len() as u64) as usize;
            let count = file.read(&mut buffer[..to_read]).map_err(|e| format!("read input: {e}"))?;
            if count == 0 {
                break;
            }
            part_file.write_all(&buffer[..count]).map_err(|e| format!("write part: {e}"))?;
            written_for_part += count as u64;
        }

        if written_for_part == 0 {
            let _ = std::fs::remove_file(&part_path);
            break;
        }

        let hash = crate::core::autogram_core::reliability::calculate_file_sha256(&part_path)
            .unwrap_or_default();

        parts.push(BinaryVolumePart {
            index: part_index,
            filename: part_name,
            path: part_path,
            size: written_for_part,
            sha256: format!("sha256:{hash}"),
        });

        part_index += 1;
    }

    Ok(parts)
}
