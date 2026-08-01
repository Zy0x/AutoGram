//! Local ZIP list / single-entry extract (Rust).
//! Remote Telegram range access is provided by the Grammers sparse ZIP engine.

use base64::Engine;
use serde::Serialize;
use std::fs::File;
use std::io::{Read, Seek};
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
    #[serde(default)]
    pub encrypted: bool,
    #[serde(default)]
    pub local_header_offset: u64,
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
    pub data_url: Option<String>,
    pub mime_type: Option<String>,
    pub is_binary: bool,
    pub encrypted: bool,
    pub backend: String,
}

/// Sanitize entry path to prevent Zip Slip (path traversal ../)
pub fn sanitize_zip_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let mut parts = Vec::new();
    for part in normalized.split('/') {
        if part == ".." || part == "." || part.is_empty() {
            continue;
        }
        parts.push(part);
    }
    let result = parts.join("/");
    if normalized.ends_with('/') && !result.is_empty() {
        format!("{result}/")
    } else {
        result
    }
}

pub fn list_zip(path: &str) -> Result<ZipListResult, String> {
    let p = path_policy::assert_safe_transfer_path(path)?;
    if !p.is_file() {
        return Err("File cache ZIP tidak ditemukan di sistem lokal.".into());
    }
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.len() == 0 {
        return Err("Berkas cache ZIP kosong (0 byte). Silakan coba muat ulang.".into());
    }

    let file = File::open(&p).map_err(|e| format!("Gagal membuka berkas ZIP: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| {
        let msg = e.to_string();
        if msg.contains("Could not find EOCD") {
            "Indeks ZIP tidak valid atau unduhan berkas belum selesai (EOCD missing).".into()
        } else {
            msg
        }
    })?;

    let total_entries = archive.len();
    let mut entries = Vec::new();
    let mut total_uncompressed = 0u64;
    let limit = total_entries.min(MAX_LIST);

    for i in 0..limit {
        let f = archive.by_index_raw(i).map_err(|e| {
            let msg = e.to_string();
            if msg.contains("Password required") {
                "Indeks ZIP dienkripsi dengan password.".to_string()
            } else {
                msg
            }
        })?;

        let raw_name = f.name().replace('\\', "/");
        let name = sanitize_zip_path(&raw_name);
        let is_dir = f.is_dir() || name.ends_with('/') || raw_name.ends_with('/');
        let sz = f.size();

        if !is_dir {
            total_uncompressed = total_uncompressed.saturating_add(sz);
        }

        entries.push(ZipEntry {
            name: if name.is_empty() { raw_name } else { name },
            size: sz,
            compressed_size: f.compressed_size(),
            is_dir,
            method: match f.compression() {
                CompressionMethod::Stored => 0,
                CompressionMethod::Deflated => 8,
                CompressionMethod::Bzip2 => 12,
                CompressionMethod::Zstd => 93,
                _ => 0,
            },
            encrypted: f.encrypted(),
            local_header_offset: f.header_start(),
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

fn detect_media_mime(name: &str) -> Option<(&'static str, &'static str)> {
    let lower = name.to_lowercase();
    if lower.ends_with(".png") {
        Some(("image", "image/png"))
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        Some(("image", "image/jpeg"))
    } else if lower.ends_with(".gif") {
        Some(("image", "image/gif"))
    } else if lower.ends_with(".webp") {
        Some(("image", "image/webp"))
    } else if lower.ends_with(".svg") {
        Some(("image", "image/svg+xml"))
    } else if lower.ends_with(".bmp") {
        Some(("image", "image/bmp"))
    } else if lower.ends_with(".avif") {
        Some(("image", "image/avif"))
    } else if lower.ends_with(".heic") || lower.ends_with(".heif") {
        Some(("image", "image/heic"))
    } else if lower.ends_with(".ico") {
        Some(("image", "image/x-icon"))
    } else if lower.ends_with(".mp4") {
        Some(("video", "video/mp4"))
    } else if lower.ends_with(".webm") {
        Some(("video", "video/webm"))
    } else if lower.ends_with(".mov") {
        Some(("video", "video/quicktime"))
    } else if lower.ends_with(".mkv") {
        Some(("video", "video/x-matroska"))
    } else if lower.ends_with(".avi") {
        Some(("video", "video/x-msvideo"))
    } else if lower.ends_with(".m4v") {
        Some(("video", "video/x-m4v"))
    } else if lower.ends_with(".mp3") {
        Some(("audio", "audio/mpeg"))
    } else if lower.ends_with(".ogg") {
        Some(("audio", "audio/ogg"))
    } else if lower.ends_with(".wav") {
        Some(("audio", "audio/wav"))
    } else if lower.ends_with(".m4a") || lower.ends_with(".aac") {
        Some(("audio", "audio/mp4"))
    } else if lower.ends_with(".flac") {
        Some(("audio", "audio/flac"))
    } else if lower.ends_with(".opus") {
        Some(("audio", "audio/ogg"))
    } else if lower.ends_with(".pdf") {
        Some(("document", "application/pdf"))
    } else {
        None
    }
}

fn is_known_text_file(name: &str) -> bool {
    let n = name.to_lowercase();
    n.ends_with(".txt")
        || n.ends_with(".md")
        || n.ends_with(".json")
        || n.ends_with(".csv")
        || n.ends_with(".log")
        || n.ends_with(".xml")
        || n.ends_with(".html")
        || n.ends_with(".htm")
        || n.ends_with(".css")
        || n.ends_with(".js")
        || n.ends_with(".ts")
        || n.ends_with(".tsx")
        || n.ends_with(".jsx")
        || n.ends_with(".py")
        || n.ends_with(".rs")
        || n.ends_with(".yml")
        || n.ends_with(".yaml")
        || n.ends_with(".ini")
        || n.ends_with(".toml")
        || n.ends_with(".sh")
        || n.ends_with(".bat")
        || n.ends_with(".sql")
        || n.ends_with(".env")
        || n.ends_with(".c")
        || n.ends_with(".cpp")
        || n.ends_with(".h")
        || n.ends_with(".hpp")
        || n.ends_with(".java")
        || n.ends_with(".kt")
        || n.ends_with(".go")
        || n.ends_with(".php")
}

fn find_entry_index<R: Read + Seek>(archive: &mut ZipArchive<R>, name: &str) -> Option<usize> {
    let clean = sanitize_zip_path(name);
    let target = name.replace('\\', "/");
    for i in 0..archive.len() {
        if let Some(fn_raw) = archive.name_for_index(i) {
            let fn_clean = sanitize_zip_path(fn_raw);
            let fn_target = fn_raw.replace('\\', "/");
            if fn_raw == name || fn_target == target || fn_clean == clean {
                return Some(i);
            }
        }
    }
    None
}

pub fn preview_zip_entry_from_archive<R: Read + Seek>(
    mut archive: ZipArchive<R>,
    entry_name: &str,
    password: Option<&str>,
) -> Result<ZipEntryPreview, String> {
    let idx = match find_entry_index(&mut archive, entry_name) {
        Some(i) => i,
        None => return Err(format!("Entri tidak ditemukan: {entry_name}")),
    };

    let mut f = if let Some(pass) = password {
        archive
            .by_index_decrypt(idx, pass.as_bytes())
            .map_err(|e| match e {
                zip::result::ZipError::InvalidPassword => "bad_password".into(),
                _ => format!("Gagal membaca entri {entry_name}: {e}"),
            })?
    } else {
        match archive.by_index(idx) {
            Ok(entry) => entry,
            Err(zip::result::ZipError::UnsupportedArchive("Password required to decrypt file"))
            | Err(zip::result::ZipError::InvalidPassword) => {
                return Ok(ZipEntryPreview {
                    name: entry_name.into(),
                    size: 0,
                    text_content: None,
                    data_url: None,
                    mime_type: None,
                    is_binary: true,
                    encrypted: true,
                    backend: "rust".into(),
                });
            }
            Err(e) => return Err(format!("Gagal membaca entri {entry_name}: {e}")),
        }
    };

    if f.is_dir() {
        return Ok(ZipEntryPreview {
            name: entry_name.into(),
            size: 0,
            text_content: None,
            data_url: None,
            mime_type: None,
            is_binary: false,
            encrypted: false,
            backend: "rust".into(),
        });
    }

    let size = f.size();
    if size as usize > MAX_ENTRY {
        return Ok(ZipEntryPreview {
            name: entry_name.into(),
            size,
            text_content: Some(format!(
                "[Berkas terlalu besar untuk pratinjau langsung — {size} byte]"
            )),
            data_url: None,
            mime_type: None,
            is_binary: true,
            encrypted: false,
            backend: "rust".into(),
        });
    }

    let mut buf = Vec::new();
    if let Err(e) = f.read_to_end(&mut buf) {
        let err_str = e.to_string();
        if err_str.contains("password") || err_str.contains("Password") {
            return Ok(ZipEntryPreview {
                name: entry_name.into(),
                size,
                text_content: None,
                data_url: None,
                mime_type: None,
                is_binary: true,
                encrypted: true,
                backend: "rust".into(),
            });
        }
        return Err(err_str);
    }

    Ok(build_zip_entry_preview(entry_name, size, buf))
}

const MAX_INLINE_MEDIA_BASE64: usize = 15 * 1024 * 1024;

pub fn build_zip_entry_preview(entry_name: &str, size: u64, buf: Vec<u8>) -> ZipEntryPreview {
    let media_mime = detect_media_mime(entry_name);
    if let Some((_kind, mime)) = media_mime {
        if buf.len() > MAX_INLINE_MEDIA_BASE64 {
            return ZipEntryPreview {
                name: entry_name.into(),
                size,
                text_content: None,
                data_url: None,
                mime_type: Some(mime.to_string()),
                is_binary: true,
                encrypted: false,
                backend: "rust".into(),
            };
        }
        let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
        let data_url = format!("data:{mime};base64,{encoded}");
        return ZipEntryPreview {
            name: entry_name.into(),
            size,
            text_content: None,
            data_url: Some(data_url),
            mime_type: Some(mime.to_string()),
            is_binary: true,
            encrypted: false,
            backend: "rust".into(),
        };
    }

    let is_text_ext = is_known_text_file(entry_name);
    let nulls = buf.iter().filter(|&&b| b == 0).count();
    let is_binary = if is_text_ext {
        false
    } else {
        nulls > 8.max(buf.len() / 50)
    };

    let text = if is_binary {
        None
    } else {
        Some(String::from_utf8_lossy(&buf).into_owned())
    };

    ZipEntryPreview {
        name: entry_name.into(),
        size,
        text_content: text,
        data_url: None,
        mime_type: if is_binary {
            None
        } else {
            Some("text/plain".into())
        },
        is_binary,
        encrypted: false,
        backend: "rust".into(),
    }
}

pub fn preview_zip_entry(
    path: &str,
    entry_name: &str,
    password: Option<&str>,
) -> Result<ZipEntryPreview, String> {
    let p = path_policy::assert_safe_transfer_path(path)?;
    let file = File::open(&p).map_err(|e| format!("Gagal membuka cache ZIP: {e}"))?;
    let archive = ZipArchive::new(file).map_err(|e| {
        let msg = e.to_string();
        if msg.contains("Could not find EOCD") {
            "Indeks ZIP tidak valid atau unduhan berkas belum selesai (EOCD missing).".into()
        } else {
            msg
        }
    })?;
    preview_zip_entry_from_archive(archive, entry_name, password)
}

pub fn extract_zip_entry_from_archive<R: Read + Seek>(
    mut archive: ZipArchive<R>,
    entry_name: &str,
    dest_path: &str,
    password: Option<&str>,
) -> Result<u64, String> {
    let dst_p = match path_policy::assert_safe_transfer_path(dest_path) {
        Ok(p) => p,
        Err(_) => std::path::PathBuf::from(dest_path),
    };

    let idx = match find_entry_index(&mut archive, entry_name) {
        Some(i) => i,
        None => return Err(format!("Entri tidak ditemukan: {entry_name}")),
    };

    let mut entry_file = if let Some(pass) = password {
        archive
            .by_index_decrypt(idx, pass.as_bytes())
            .map_err(|e| match e {
                zip::result::ZipError::InvalidPassword => "bad_password".into(),
                _ => format!("Gagal membaca entri {entry_name}: {e}"),
            })?
    } else {
        match archive.by_index(idx) {
            Ok(entry) => entry,
            Err(zip::result::ZipError::UnsupportedArchive("Password required to decrypt file"))
            | Err(zip::result::ZipError::InvalidPassword) => return Err("bad_password".into()),
            Err(e) => return Err(format!("Gagal membaca entri {entry_name}: {e}")),
        }
    };

    if entry_file.is_dir() {
        if let Err(e) = std::fs::create_dir_all(&dst_p) {
            return Err(format!("Gagal membuat folder tujuan: {e}"));
        }
        return Ok(0);
    }

    if let Some(parent) = dst_p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let mut out_file =
        File::create(&dst_p).map_err(|e| format!("Gagal membuat file tujuan: {e}"))?;
    let bytes_written = std::io::copy(&mut entry_file, &mut out_file)
        .map_err(|e| format!("Gagal menulis data ekstraksi: {e}"))?;

    Ok(bytes_written)
}

pub fn extract_zip_entry(
    archive_path: &str,
    entry_name: &str,
    dest_path: &str,
    password: Option<&str>,
) -> Result<u64, String> {
    let src_p = path_policy::assert_safe_transfer_path(archive_path)?;
    let file = File::open(&src_p).map_err(|e| format!("Gagal membuka berkas ZIP: {e}"))?;
    let archive = ZipArchive::new(file).map_err(|e| {
        let msg = e.to_string();
        if msg.contains("Could not find EOCD") {
            "Indeks ZIP tidak valid atau unduhan berkas belum selesai (EOCD missing).".into()
        } else {
            msg
        }
    })?;
    extract_zip_entry_from_archive(archive, entry_name, dest_path, password)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
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
            z.start_file("hi.txt", SimpleFileOptions::default())
                .unwrap();
            z.write_all(b"hello zip").unwrap();
            z.finish().unwrap();
        }
        let list = list_zip(path.to_str().unwrap()).unwrap();
        assert_eq!(list.count, 1);
        assert_eq!(list.entries[0].name, "hi.txt");
        let prev = preview_zip_entry(path.to_str().unwrap(), "hi.txt", None).unwrap();
        assert_eq!(prev.text_content.unwrap(), "hello zip");
    }

    #[test]
    fn extracts_zip_entry() {
        let dir = std::env::temp_dir().join("ag_zip_extract_test");
        let _ = std::fs::create_dir_all(&dir);
        let zip_path = dir.join("archive.zip");
        let target_path = dir.join("out.txt");
        {
            let f = File::create(&zip_path).unwrap();
            let mut z = ZipWriter::new(f);
            z.start_file("data.txt", SimpleFileOptions::default())
                .unwrap();
            z.write_all(b"extracted content").unwrap();
            z.finish().unwrap();
        }
        let bytes = extract_zip_entry(
            zip_path.to_str().unwrap(),
            "data.txt",
            target_path.to_str().unwrap(),
            None,
        )
        .unwrap();
        assert_eq!(bytes, 17);
        let read_back = std::fs::read_to_string(&target_path).unwrap();
        assert_eq!(read_back, "extracted content");
    }

    #[test]
    fn previews_supported_media_without_a_second_file_read() {
        let image = build_zip_entry_preview("cover.png", 8, b"\x89PNGdata".to_vec());
        assert_eq!(image.mime_type.as_deref(), Some("image/png"));
        assert!(image
            .data_url
            .as_deref()
            .unwrap_or_default()
            .starts_with("data:image/png;base64,"));

        let pdf = build_zip_entry_preview("manual.pdf", 8, b"%PDF-1.7".to_vec());
        assert_eq!(pdf.mime_type.as_deref(), Some("application/pdf"));
        assert!(pdf
            .data_url
            .as_deref()
            .unwrap_or_default()
            .starts_with("data:application/pdf;base64,"));
    }

    #[test]
    fn extracted_nested_zip_can_be_listed_independently() {
        let mut inner_bytes = Cursor::new(Vec::new());
        {
            let mut inner = ZipWriter::new(&mut inner_bytes);
            inner
                .start_file("nested/readme.md", SimpleFileOptions::default())
                .unwrap();
            inner.write_all(b"nested payload").unwrap();
            inner.finish().unwrap();
        }

        let dir = std::env::temp_dir().join("ag_zip_nested_test");
        let _ = std::fs::create_dir_all(&dir);
        let outer_path = dir.join("outer.zip");
        let extracted_path = dir.join("inner.zip");
        {
            let output = File::create(&outer_path).unwrap();
            let mut outer = ZipWriter::new(output);
            outer
                .start_file("archives/inner.zip", SimpleFileOptions::default())
                .unwrap();
            outer.write_all(inner_bytes.get_ref()).unwrap();
            outer.finish().unwrap();
        }

        extract_zip_entry(
            outer_path.to_str().unwrap(),
            "archives/inner.zip",
            extracted_path.to_str().unwrap(),
            None,
        )
        .unwrap();
        let nested = list_zip(extracted_path.to_str().unwrap()).unwrap();
        assert_eq!(nested.count, 1);
        assert_eq!(nested.entries[0].name, "nested/readme.md");
    }
}
