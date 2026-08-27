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
    if max_volume_bytes == 0 {
        return Err("max_volume_bytes must be greater than zero".into());
    }
    std::fs::create_dir_all(output_dir).map_err(|e| format!("create split dir: {e}"))?;
    let mut file = File::open(input_path).map_err(|e| format!("open input: {e}"))?;
    let input_size = file
        .metadata()
        .map_err(|e| format!("input metadata: {e}"))?
        .len();
    let orig_filename = input_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file.bin".to_string());

    let mut parts = Vec::new();
    let mut buffer = vec![0u8; 1024 * 1024]; // 1MB buffer
    let mut part_index = 1usize;
    let total_parts = input_size.div_ceil(max_volume_bytes) as usize;

    loop {
        let part_name = format!("{orig_filename}.agpart.{part_index:04}-of-{total_parts:04}");
        let part_path = output_dir.join(&part_name);
        let mut part_file = File::create(&part_path).map_err(|e| format!("create part: {e}"))?;
        let mut written_for_part = 0u64;

        while written_for_part < max_volume_bytes {
            let to_read = (max_volume_bytes - written_for_part).min(buffer.len() as u64) as usize;
            let count = file
                .read(&mut buffer[..to_read])
                .map_err(|e| format!("read input: {e}"))?;
            if count == 0 {
                break;
            }
            part_file
                .write_all(&buffer[..count])
                .map_err(|e| format!("write part: {e}"))?;
            written_for_part += count as u64;
        }

        if written_for_part == 0 {
            let _ = std::fs::remove_file(&part_path);
            break;
        }

        let hash = crate::reliability::calculate_file_sha256(&part_path).unwrap_or_default();

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_parts_are_bounded_and_reconstruct_exactly() {
        let root = std::env::temp_dir().join(format!("autogram-split-{}", std::process::id()));
        let input = root.join("fixture.bin");
        let output = root.join("parts");
        std::fs::create_dir_all(&root).unwrap();
        let original: Vec<u8> = (0..=255).cycle().take(2_600).collect();
        std::fs::write(&input, &original).unwrap();
        let parts = split_binary_volume(&input, &output, 1_000).unwrap();
        assert_eq!(parts.len(), 3);
        assert!(parts.iter().all(|part| part.size <= 1_000));
        assert!(parts[0].filename.ends_with(".agpart.0001-of-0003"));
        let reconstructed: Vec<u8> = parts
            .iter()
            .flat_map(|part| std::fs::read(&part.path).unwrap())
            .collect();
        assert_eq!(reconstructed, original);
        let _ = std::fs::remove_dir_all(root);
    }
}
