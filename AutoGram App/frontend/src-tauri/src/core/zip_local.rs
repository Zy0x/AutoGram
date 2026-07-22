//! Local ZIP list / single-entry extract (Rust). Telegram download stays Python.

use serde::Serialize;
use std::fs::File;
use std::io::Read;
use zip::CompressionMethod;
use zip::ZipArchive;

use super::path_policy;

const MAX_LIST: usize = 8000;
const MAX_ENTRY: usize = 12 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipEntry {
    pub name: String,
    pub size: u64,
    pub compressed_size: u64,
    pub is_dir: bool,
    pub method: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipListResult {
    pub entries: Vec<ZipEntry>,
    pub count: usize,
    pub truncated: bool,
    pub total_entries: usize,
    pub total_uncompressed: u64,
    pub archive_size: u64,
    pub source: String,
    pub backend: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipEntryPreview {
    pub name: String,
    pub size: u64,
    pub text_content: Option<String>,
    pub is_binary: bool,
    pub backend: String,
}

pub fn list_zip(path: &str) -> Result<ZipListResult, String> {
    let p = path_policy::assert_safe_transfer_path(path)?;
    if !p.is_file() {
        return Err("ZIP cache missing".into());
    }
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    let file = File::open(&p).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
    let total_entries = archive.len();
    let mut entries = Vec::new();
    let mut total_uncompressed = 0u64;
    let limit = total_entries.min(MAX_LIST);
    for i in 0..limit {
        let f = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = f.name().replace('\\', "/");
        let is_dir = f.is_dir() || name.ends_with('/');
        let sz = f.size();
        if !is_dir {
            total_uncompressed = total_uncompressed.saturating_add(sz);
        }
        entries.push(ZipEntry {
            name,
            size: sz,
            compressed_size: f.compressed_size(),
            is_dir,
            method: match f.compression() {
                CompressionMethod::Stored => 0,
                CompressionMethod::Deflated => 8,
                _ => 0,
            },
        });
    }
    Ok(ZipListResult {
        entries: entries.clone(),
        count: entries.len(),
        truncated: total_entries > MAX_LIST,
        total_entries,
        total_uncompressed,
        archive_size: meta.len(),
        source: "local".into(),
        backend: "rust".into(),
    })
}

pub fn preview_zip_entry(path: &str, entry_name: &str) -> Result<ZipEntryPreview, String> {
    let p = path_policy::assert_safe_transfer_path(path)?;
    let file = File::open(&p).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut f = archive
        .by_name(entry_name)
        .map_err(|_| format!("entry not found: {entry_name}"))?;
    if f.is_dir() {
        return Ok(ZipEntryPreview {
            name: entry_name.into(),
            size: 0,
            text_content: None,
            is_binary: false,
            backend: "rust".into(),
        });
    }
    let size = f.size();
    if size as usize > MAX_ENTRY {
        return Ok(ZipEntryPreview {
            name: entry_name.into(),
            size,
            text_content: Some(format!(
                "[Entry too large for inline preview — {size} bytes]"
            )),
            is_binary: true,
            backend: "rust".into(),
        });
    }
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let nulls = buf.iter().filter(|&&b| b == 0).count();
    let is_binary = nulls > 8.max(buf.len() / 50);
    let text = if is_binary {
        None
    } else {
        Some(String::from_utf8_lossy(&buf).into_owned())
    };
    Ok(ZipEntryPreview {
        name: entry_name.into(),
        size,
        text_content: text,
        is_binary,
        backend: "rust".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    #[test]
    fn lists_zip() {
        let dir = std::env::temp_dir().join("ag_zip_local");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("t.zip");
        {
            let f = File::create(&path).unwrap();
            let mut z = ZipWriter::new(f);
            z.start_file("hi.txt", SimpleFileOptions::default()).unwrap();
            z.write_all(b"hello zip").unwrap();
            z.finish().unwrap();
        }
        let list = list_zip(path.to_str().unwrap()).unwrap();
        assert_eq!(list.count, 1);
        assert_eq!(list.entries[0].name, "hi.txt");
        let prev = preview_zip_entry(path.to_str().unwrap(), "hi.txt").unwrap();
        assert_eq!(prev.text_content.unwrap(), "hello zip");
    }
}
