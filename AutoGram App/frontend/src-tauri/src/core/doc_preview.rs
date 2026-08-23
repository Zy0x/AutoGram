//! Local document / code preview — pure Rust, no Python/Telethon.
//! Used when a cache path already exists so UI skips HTTP stream fetch.

use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::Path;

use super::path_policy;

const TEXT_INLINE_MAX: u64 = 2 * 1024 * 1024;

const TEXT_EXTS: &[&str] = &[
    "txt",
    "text",
    "json",
    "jsonc",
    "json5",
    "jsonl",
    "ndjson",
    "md",
    "markdown",
    "mdx",
    "rst",
    "csv",
    "tsv",
    "log",
    "xml",
    "yaml",
    "yml",
    "ini",
    "cfg",
    "conf",
    "config",
    "properties",
    "env",
    "toml",
    "plist",
    "lock",
    "html",
    "htm",
    "xhtml",
    "css",
    "scss",
    "sass",
    "less",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "ts",
    "tsx",
    "vue",
    "svelte",
    "astro",
    "py",
    "pyi",
    "pyw",
    "rb",
    "php",
    "pl",
    "pm",
    "sh",
    "bash",
    "zsh",
    "fish",
    "ps1",
    "psm1",
    "bat",
    "cmd",
    "lua",
    "r",
    "jl",
    "ex",
    "exs",
    "erl",
    "clj",
    "cljs",
    "scala",
    "kt",
    "kts",
    "swift",
    "dart",
    "groovy",
    "gradle",
    "c",
    "cc",
    "cpp",
    "cxx",
    "h",
    "hh",
    "hpp",
    "hxx",
    "m",
    "mm",
    "cs",
    "fs",
    "fsx",
    "go",
    "rs",
    "java",
    "sql",
    "prisma",
    "graphql",
    "gql",
    "proto",
    "dockerfile",
    "makefile",
    "cmake",
    "tf",
    "hcl",
    "nix",
    "vim",
    "diff",
    "patch",
    "http",
    "rest",
];

const OFFICE_EXTS: &[&str] = &["docx", "odt", "rtf", "xlsx", "ods", "pptx", "odp"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDocPreview {
    pub path: String,
    pub mime_type: String,
    pub size: u64,
    pub preview_kind: String,
    pub text_content: Option<String>,
    pub backend: String,
}

fn ext_of(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn guess_mime(ext: &str) -> String {
    match ext {
        "json" | "jsonc" | "json5" | "jsonl" => "application/json".into(),
        "md" | "markdown" | "mdx" => "text/markdown".into(),
        "html" | "htm" => "text/html".into(),
        "css" => "text/css".into(),
        "js" | "mjs" | "cjs" => "text/javascript".into(),
        "ts" | "tsx" => "text/typescript".into(),
        "xml" | "svg" => "application/xml".into(),
        "yaml" | "yml" => "text/yaml".into(),
        "pdf" => "application/pdf".into(),
        "py" => "text/x-python".into(),
        "rs" => "text/x-rust".into(),
        "go" => "text/x-go".into(),
        "java" => "text/x-java".into(),
        "sql" => "application/sql".into(),
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document".into(),
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".into(),
        "pptx" => {
            "application/vnd.openxmlformats-officedocument.presentationml.presentation".into()
        }
        "rtf" => "application/rtf".into(),
        _ => {
            if TEXT_EXTS.contains(&ext) {
                "text/plain".into()
            } else {
                "application/octet-stream".into()
            }
        }
    }
}

fn is_text_ext(ext: &str) -> bool {
    TEXT_EXTS.contains(&ext) || OFFICE_EXTS.contains(&ext)
}

pub fn is_plain_text_document_name(name: &str) -> bool {
    let ext = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    TEXT_EXTS.contains(&ext.as_str()) && !OFFICE_EXTS.contains(&ext.as_str())
}

fn looks_binary(raw: &[u8]) -> bool {
    if raw.is_empty() {
        return false;
    }
    let nulls = raw.iter().filter(|&&b| b == 0).count();
    nulls > 8.max(raw.len() / 50)
}

fn pretty_json(s: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(s) {
        Ok(v) => serde_json::to_string_pretty(&v).unwrap_or_else(|_| s.to_string()),
        Err(_) => s.to_string(),
    }
}

/// Build an inline code/text preview from a bounded MTProto prefix. Large
/// source files no longer need a full download before the first screen paints.
pub fn preview_text_sample(name: &str, raw: &[u8], total_size: u64) -> String {
    if looks_binary(raw) {
        return format!(
            "[Binary / non-text file — {total_size} bytes]\nBuka dengan aplikasi sistem atau Download."
        );
    }

    let ext = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let decoded = String::from_utf8_lossy(raw).into_owned();
    let mut body = if raw.len() as u64 >= total_size && ext == "json" {
        pretty_json(&decoded)
    } else {
        decoded
    };
    const MAX_CHARS: usize = 400_000;
    if body.chars().count() > MAX_CHARS {
        body = body.chars().take(MAX_CHARS).collect();
    }
    if (raw.len() as u64) < total_size {
        body.push_str("\n\n… (pratinjau awal; gunakan Download untuk file lengkap)");
    }
    body
}

fn extract_rtf_plain(raw: &[u8], max_chars: usize) -> Option<String> {
    let s = String::from_utf8_lossy(raw);
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            // skip control word
            while let Some(&n) = chars.peek() {
                if n.is_ascii_alphabetic() {
                    chars.next();
                } else {
                    break;
                }
            }
            while let Some(&n) = chars.peek() {
                if n.is_ascii_digit() || n == '-' {
                    chars.next();
                } else {
                    break;
                }
            }
            if chars.peek() == Some(&' ') {
                chars.next();
            }
            continue;
        }
        if c == '{' || c == '}' {
            continue;
        }
        out.push(c);
        if out.len() >= max_chars {
            out.push_str("\n\n… (dipotong)");
            break;
        }
    }
    let t = out.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

/// Strip XML tags lightly (fallback when structured parse unavailable).
fn strip_xml_text(data: &[u8], max_chars: usize) -> Option<String> {
    let s = String::from_utf8_lossy(data);
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        if c == '<' {
            in_tag = true;
            continue;
        }
        if c == '>' {
            in_tag = false;
            out.push(' ');
            continue;
        }
        if !in_tag {
            out.push(c);
            if out.len() >= max_chars {
                out.push_str("\n\n… (dipotong)");
                break;
            }
        }
    }
    let t = out.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

fn extract_office_zip(path: &Path, ext: &str, max_chars: usize) -> Option<String> {
    // Minimal OOXML/ODF text extract without extra deps: zip is optional.
    // Use std + manual ZIP via `zip` crate if present; otherwise return None
    // so caller falls back to Python/stream.
    let file = fs::File::open(path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let mut chunks: Vec<String> = Vec::new();

    let mut names: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        if let Ok(f) = archive.by_index(i) {
            names.push(f.name().to_string());
        }
    }

    let targets: Vec<String> = match ext {
        "docx" => names
            .into_iter()
            .filter(|n| n == "word/document.xml")
            .collect(),
        "odt" | "ods" | "odp" => names.into_iter().filter(|n| n == "content.xml").collect(),
        "xlsx" => names
            .into_iter()
            .filter(|n| n.ends_with("sharedStrings.xml") || n.contains("/worksheets/sheet"))
            .collect(),
        "pptx" => {
            let mut v: Vec<_> = names
                .into_iter()
                .filter(|n| n.starts_with("ppt/slides/slide") && n.ends_with(".xml"))
                .collect();
            v.sort();
            v
        }
        _ => Vec::new(),
    };

    for (i, name) in targets.iter().enumerate() {
        if i >= 24 {
            break;
        }
        if let Ok(mut f) = archive.by_name(name) {
            let mut buf = Vec::new();
            if f.read_to_end(&mut buf).is_ok() {
                if let Some(t) = strip_xml_text(&buf, max_chars) {
                    chunks.push(t);
                }
            }
        }
    }

    if chunks.is_empty() {
        return None;
    }
    let mut body = chunks.join("\n\n");
    if let Some((idx, _)) = body.char_indices().nth(max_chars) {
        body.truncate(idx);
        body.push_str("\n\n… (dipotong)");
    }
    Some(body)
}

/// Read local path and build in-app text preview (Rust-only).
pub fn preview_local_document(path: &str) -> Result<LocalDocPreview, String> {
    let p = path_policy::assert_safe_transfer_path(path)?;
    if !p.is_file() {
        return Err(format!("file not found: {}", p.display()));
    }
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    let size = meta.len();
    let ext = ext_of(&p);
    let mime = guess_mime(&ext);

    if ext == "pdf" {
        return Ok(LocalDocPreview {
            path: p.to_string_lossy().into_owned(),
            mime_type: mime,
            size,
            preview_kind: "pdf".into(),
            text_content: None,
            backend: "rust".into(),
        });
    }

    if !is_text_ext(&ext) {
        return Err(format!("unsupported local preview type: .{ext}"));
    }

    if size > TEXT_INLINE_MAX {
        return Ok(LocalDocPreview {
            path: p.to_string_lossy().into_owned(),
            mime_type: mime,
            size,
            preview_kind: "text".into(),
            text_content: Some(format!(
                "[File too large for inline preview — {size} bytes]\nUse Buka / Download."
            )),
            backend: "rust".into(),
        });
    }

    let max_chars = 400_000usize;
    let text_content = if OFFICE_EXTS.contains(&ext.as_str()) {
        if ext == "rtf" {
            let mut raw = Vec::new();
            fs::File::open(&p)
                .and_then(|mut f| f.read_to_end(&mut raw))
                .map_err(|e| e.to_string())?;
            extract_rtf_plain(&raw, max_chars)
        } else {
            extract_office_zip(&p, &ext, max_chars)
        }
    } else {
        let mut raw = Vec::new();
        fs::File::open(&p)
            .and_then(|mut f| f.read_to_end(&mut raw))
            .map_err(|e| e.to_string())?;
        if looks_binary(&raw) {
            Some(format!(
                "[Binary / non-text file — {size} bytes]\nBuka dengan aplikasi sistem atau Download."
            ))
        } else {
            let s = String::from_utf8_lossy(&raw).into_owned();
            let s = if ext == "json" || mime.contains("json") {
                pretty_json(&s)
            } else {
                s
            };
            let s = if s.chars().count() > max_chars {
                format!(
                    "{}{}",
                    s.chars().take(max_chars).collect::<String>(),
                    "\n\n… (dipotong)"
                )
            } else {
                s
            };
            Some(s)
        }
    };

    Ok(LocalDocPreview {
        path: p.to_string_lossy().into_owned(),
        mime_type: mime,
        size,
        preview_kind: "text".into(),
        text_content,
        backend: "rust".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn previews_json_file() {
        let dir = std::env::temp_dir().join("ag_rust_doc_preview");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("sample.json");
        let mut f = fs::File::create(&path).unwrap();
        write!(f, "{{\"a\":1}}").unwrap();
        let prev = preview_local_document(path.to_str().unwrap()).unwrap();
        assert_eq!(prev.backend, "rust");
        assert!(prev.text_content.unwrap().contains("\"a\""));
    }

    #[test]
    fn bounded_text_sample_is_unicode_safe_and_marks_partial_content() {
        let sample = "murid 🦀\n".repeat(60_000);
        let preview = preview_text_sample("notes.mdx", sample.as_bytes(), 9_000_000);
        assert!(preview.contains("murid 🦀"));
        assert!(preview.contains("pratinjau awal"));
        assert!(preview.chars().count() < 401_000);
    }
}
