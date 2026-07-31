//! Image manipulation, JPEG unstripping, dark card detection, and FFmpeg binary frame extraction.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use grammers_client::media::{Downloadable, Media, PhotoSize};
use super::session::BACKEND;
use super::thumbs::convert_avcc_to_annexb;
use crate::core::tg_log;

pub fn unstrip_jpeg(data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < 3 || data[0] != 0x01 {
        return None;
    }
    let w = data[1] as usize;
    let h = data[2] as usize;
    let scan = &data[3..];
    let mut header = vec![
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
        0x00, 0x60, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x28, 0x1c, 0x1e, 0x23, 0x1e, 0x19, 0x28,
        0x23, 0x21, 0x23, 0x2d, 0x2a, 0x28, 0x30, 0x3c, 0x64, 0x41, 0x3c, 0x37, 0x37, 0x3c, 0x7b, 0x58,
        0x5d, 0x49, 0x64, 0x91, 0x80, 0x99, 0x96, 0x8f, 0x80, 0x8c, 0x8a, 0xa0, 0xb4, 0xe6, 0xc3, 0xa0,
        0xaa, 0xda, 0xad, 0x8a, 0x8c, 0xc8, 0xff, 0x8c, 0xdc, 0xf0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0xff, 0xff, 0xdb, 0x00, 0x43, 0x01, 0x2b, 0x2d, 0x2d, 0x3c, 0x35, 0x3c, 0x76, 0x41, 0x41,
        0x76, 0xf8, 0xa5, 0x8c, 0xa5, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8,
        0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8,
        0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8, 0xf8,
        0xff, 0xc0, 0x00, 0x11, 0x08, (h & 0xff) as u8, (w & 0xff) as u8, 0x03, 0x01, 0x21, 0x00, 0x02,
        0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01,
        0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
        0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03, 0x03,
        0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00, 0x04,
        0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81,
        0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82,
        0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36,
        0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56,
        0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76,
        0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95,
        0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3,
        0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca,
        0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7,
        0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xc4, 0x00,
        0x1f, 0x01, 0x00, 0x03, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4,
        0x00, 0xb5, 0x11, 0x00, 0x02, 0x01, 0x02, 0x04, 0x04, 0x03, 0x04, 0x07, 0x05, 0x04, 0x04, 0x00,
        0x01, 0x02, 0x77, 0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51,
        0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23,
        0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18,
        0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
        0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65,
        0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84,
        0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2,
        0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9,
        0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7,
        0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5,
        0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11,
        0x00, 0x3f, 0x00,
    ];
    header.extend_from_slice(scan);
    header.push(0xff);
    header.push(0xd9);
    Some(header)
}


pub fn find_ffmpeg_binary() -> Option<std::path::PathBuf> {
    if let Some(path) = which_path("ffmpeg") {
        return Some(path);
    }
    let mut search_dirs = Vec::new();
    if let Ok(cd) = std::env::current_dir() {
        let mut cur = Some(cd.as_path());
        while let Some(dir) = cur {
            search_dirs.push(dir.to_path_buf());
            cur = dir.parent();
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.parent();
        while let Some(dir) = cur {
            search_dirs.push(dir.to_path_buf());
            cur = dir.parent();
        }
    }

    let sub_paths = [
        "worker/venv/Lib/site-packages/imageio_ffmpeg/binaries",
        "AutoGram App/worker/venv/Lib/site-packages/imageio_ffmpeg/binaries",
        "../worker/venv/Lib/site-packages/imageio_ffmpeg/binaries",
        "../../worker/venv/Lib/site-packages/imageio_ffmpeg/binaries",
        "cache/bin",
        "bin",
    ];

    for base in &search_dirs {
        for sub in &sub_paths {
            let candidate_dir = base.join(sub);
            if candidate_dir.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&candidate_dir) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.is_file() {
                            let name = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                            if name.starts_with("ffmpeg") && (name.ends_with(".exe") || !cfg!(windows)) {
                                return Some(p);
                            }
                        }
                    }
                }
            }
        }
    }

    // Check common Windows installation & application locations (up to depth 4 for nested software like CapCut, FormatFactory, BlueStacks)
    if cfg!(windows) {
        let mut win_dirs = Vec::new();
        if let Ok(pf) = std::env::var("ProgramFiles") {
            win_dirs.push(std::path::PathBuf::from(pf));
        }
        if let Ok(pfx86) = std::env::var("ProgramFiles(x86)") {
            win_dirs.push(std::path::PathBuf::from(pfx86));
        }
        if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
            win_dirs.push(std::path::PathBuf::from(local_app));
        }
        win_dirs.push(std::path::PathBuf::from("C:\\ffmpeg"));
        win_dirs.push(std::path::PathBuf::from("C:\\Tools"));

        for base in win_dirs {
            if let Some(p) = search_ffmpeg_recursive(&base, 4) {
                return Some(p);
            }
        }
    }

    None
}

fn search_ffmpeg_recursive(dir: &std::path::Path, max_depth: usize) -> Option<std::path::PathBuf> {
    if max_depth == 0 || !dir.is_dir() {
        return None;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        let mut subdirs = Vec::new();
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                let name = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                if name.starts_with("ffmpeg") && (name.ends_with(".exe") || !cfg!(windows)) {
                    return Some(p);
                }
            } else if p.is_dir() {
                subdirs.push(p);
            }
        }
        for sub in subdirs {
            if let Some(found) = search_ffmpeg_recursive(&sub, max_depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

fn which_path(cmd: &str) -> Option<std::path::PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let full = if cfg!(windows) { dir.join(format!("{cmd}.exe")) } else { dir.join(cmd) };
        if full.is_file() {
            return Some(full);
        }
    }
    None
}

/// Phase 1: Runtime AV1 decoder capability probe.
/// Cached in a OnceLock so the subprocess is only spawned once per app session.
/// Returns true if the bundled FFmpeg binary was compiled with libdav1d, libaom, or any AV1 decoder.
pub fn ffmpeg_supports_av1(ff_exe: &std::path::Path) -> bool {

    static CACHE: OnceLock<bool> = OnceLock::new();
    *CACHE.get_or_init(|| {
        let Ok(out) = std::process::Command::new(ff_exe)
            .args(&["-hide_banner", "-codecs"])
            .output()
        else {
            return false;
        };
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        let combined = format!("{stdout}{stderr}");
        combined.contains("libdav1d")
            || combined.contains("libaom")
            || combined.contains("av1 ")
            || combined.contains("av1,")
    })
}

fn generate_video_fallback_card() -> Option<Vec<u8>> {
    if let Some(ff_exe) = find_ffmpeg_binary() {
        let temp_dir = std::env::temp_dir();
        let rand_id = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let frame_path = temp_dir.join(format!("autogram_fallback_vidcard_{rand_id}.jpg"));

        let status = std::process::Command::new(&ff_exe)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-y")
            .arg("-f")
            .arg("lavfi")
            .arg("-i")
            .arg("color=c=0x0f172a:s=480x270")
            .arg("-vframes")
            .arg("1")
            .arg("-q:v")
            .arg("3")
            .arg(&frame_path)
            .output();

        if status.is_ok() && frame_path.exists() {
            if let Ok(b) = std::fs::read(&frame_path) {
                let _ = std::fs::remove_file(&frame_path);
                if b.len() >= 256 {
                    return Some(b);
                }
            }
        }
    }
    Some(get_static_fallback_jpeg())
}

fn get_static_fallback_jpeg() -> Vec<u8> {
    vec![
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
        0x00, 0x60, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
        0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
        0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
        0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
        0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xdb, 0x00, 0x43, 0x01, 0x09, 0x09,
        0x09, 0x0c, 0x0b, 0x0c, 0x18, 0x0d, 0x0d, 0x18, 0x32, 0x21, 0x1c, 0x21, 0x32, 0x32, 0x32, 0x32,
        0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32,
        0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32,
        0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x0e, 0x01, 0xe0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01,
        0x03, 0x11, 0x01, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01,
        0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
        0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04,
        0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05,
        0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1,
        0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a,
        0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38,
        0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
        0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78,
        0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97,
        0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5,
        0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3,
        0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9,
        0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xc4, 0x00, 0x1f, 0x01,
        0x00, 0x03, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x11,
        0x00, 0x02, 0x01, 0x02, 0x04, 0x04, 0x03, 0x04, 0x07, 0x05, 0x04, 0x04, 0x00, 0x01, 0x02, 0x77,
        0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
        0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xA1, 0xB1, 0xC1, 0x09, 0x23, 0x33, 0x52, 0xF0,
        0x15, 0x62, 0x72, 0xD1, 0x0A, 0x16, 0x24, 0x34, 0xE1, 0x25, 0xF1, 0x17, 0x18, 0x19, 0x1A, 0x26,
        0x27, 0x28, 0x29, 0x2A, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
        0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
        0x69, 0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
        0x88, 0x89, 0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5,
        0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3,
        0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA,
        0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8,
        0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x0C, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3F, 0x00,
        0xF9, 0xFE, 0x8A, 0x28, 0x00, 0x00, 0xFF, 0xD9,
    ]
}

pub fn is_fallback_black_card_bytes(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return true;
    }
    if bytes == get_static_fallback_jpeg() {
        return true;
    }
    // Solid dark slate / black fallback JPEG generated by FFmpeg lavfi color=c=0x0f172a
    // Size is typically 400-3200 bytes and starts with JPEG header \xFF\xD8
    if bytes.len() >= 64 && bytes.len() <= 3200 && bytes.starts_with(&[0xff, 0xd8]) {
        if bytes.windows(4).any(|w| w == b"JFIF" || w == b"Exif") {
            if bytes.len() <= 2400 {
                return true;
            }
        }
    }
    false
}

pub fn extract_ffmpeg_frame_sync(sample_bytes: &[u8], quality: &str, ext_hint: &str) -> Option<Vec<u8>> {
    let ff_exe = find_ffmpeg_binary()?;
    let mode = quality.to_lowercase();
    let sharp = mode.contains("jelas") || mode.contains("sharp");
    let saver = mode.contains("hemat") || mode.contains("saver");

    let (scale_arg, q_val) = if sharp {
        ("scale=-2:720,format=yuv420p", "2")
    } else if saver {
        ("scale=-2:360,format=yuv420p", "6")
    } else {
        ("scale=-2:480,format=yuv420p", "3")
    };

    let is_av1 = ext_hint == "av1"
        || sample_bytes.windows(4).any(|w| w == b"av01")
        || sample_bytes.windows(4).any(|w| w == b"av1C");

    let av1_hwaccel_args: &[&str] = &["-hwaccel", "none"];

    let temp_dir = std::env::temp_dir();
    static FF_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let seq = FF_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let rand_id = format!("{pid}_{seq}_{nanos}");
    let ext = if ext_hint.is_empty() { "mp4" } else { ext_hint };
    let sample_path = temp_dir.join(format!("autogram_vid_sample_{rand_id}.{ext}"));
    let frame_path = temp_dir.join(format!("autogram_vid_frame_{rand_id}.jpg"));

    let _ = std::fs::write(&sample_path, sample_bytes);

    let check_frame_file = || -> Option<Vec<u8>> {
        if frame_path.exists() {
            if let Ok(b) = std::fs::read(&frame_path) {
                if b.len() >= 800 && !is_fallback_black_card_bytes(&b) {
                    return Some(b);
                }
            }
        }
        None
    };

    let av1_decoders: &[&[&str]] = if is_av1 {
        &[&["-c:v", "libdav1d"], &["-c:v", "av1"], &[]]
    } else {
        &[&[]]
    };

    let mut result = None;
    let mut err1 = String::new();

    // Pass 1: Direct start of stream (-ss 0) to extract first keyframe from sample without seeking past EOF
    for c_arg in av1_decoders {
        let status1 = std::process::Command::new(&ff_exe)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-y")
            .arg("-err_detect")
            .arg("ignore_err")
            .arg("-fflags")
            .arg("+genpts+discardcorrupt")
            .args(av1_hwaccel_args)
            .args(*c_arg)
            .arg("-ss")
            .arg("0")
            .arg("-i")
            .arg(&sample_path)
            .arg("-an")
            .arg("-vframes")
            .arg("1")
            .arg("-vf")
            .arg(scale_arg)
            .arg("-q:v")
            .arg(q_val)
            .arg(&frame_path)
            .output();

        if let Ok(ref out) = status1 {
            err1 = String::from_utf8_lossy(&out.stderr).trim().to_string();
            if let Some(b) = check_frame_file() {
                result = Some(b);
                break;
            }
        }
    }

    // Pass 2: Output-level seek (-ss 00:00:00.100 after -i) fallback
    if result.is_none() {
        let _ = std::process::Command::new(&ff_exe)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-y")
            .args(av1_hwaccel_args)
            .arg("-i")
            .arg(&sample_path)
            .arg("-ss")
            .arg("00:00:00.100")
            .arg("-an")
            .arg("-vframes")
            .arg("1")
            .arg("-vf")
            .arg(scale_arg)
            .arg("-q:v")
            .arg(q_val)
            .arg(&frame_path)
            .output();

        result = check_frame_file();
    }

    // Pass 3: Seek to 0.5s (-ss 00:00:00.500)
    if result.is_none() {
        let _ = std::process::Command::new(&ff_exe)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-y")
            .args(av1_hwaccel_args)
            .arg("-ss")
            .arg("00:00:00.500")
            .arg("-i")
            .arg(&sample_path)
            .arg("-an")
            .arg("-vframes")
            .arg("1")
            .arg("-vf")
            .arg(scale_arg)
            .arg("-q:v")
            .arg(q_val)
            .arg(&frame_path)
            .output();

        result = check_frame_file();
    }

    // Pass 4: Seek to 1.0s (-ss 00:00:01)
    if result.is_none() {
        let _ = std::process::Command::new(&ff_exe)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-y")
            .args(av1_hwaccel_args)
            .arg("-ss")
            .arg("00:00:01")
            .arg("-i")
            .arg(&sample_path)
            .arg("-an")
            .arg("-vframes")
            .arg("1")
            .arg("-vf")
            .arg(scale_arg)
            .arg("-q:v")
            .arg(q_val)
            .arg(&frame_path)
            .output();

        result = check_frame_file();
    }

    // Pass 5: Seek to 2.0s (-ss 00:00:02)
    if result.is_none() {
        let _ = std::process::Command::new(&ff_exe)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-y")
            .args(av1_hwaccel_args)
            .arg("-ss")
            .arg("00:00:02")
            .arg("-i")
            .arg(&sample_path)
            .arg("-an")
            .arg("-vframes")
            .arg("1")
            .arg("-vf")
            .arg(scale_arg)
            .arg("-q:v")
            .arg(q_val)
            .arg(&frame_path)
            .output();

        result = check_frame_file();
    }

    // Pass 3: Output-level seek (-ss 00:00:00.100 after -i) fallback
    if result.is_none() {
        let _ = std::process::Command::new(&ff_exe)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-y")
            .args(av1_hwaccel_args)      // Phase 2: disable HW accel for AV1
            .arg("-i")
            .arg(&sample_path)
            .arg("-ss")
            .arg("00:00:00.100")
            .arg("-an")
            .arg("-vframes")
            .arg("1")
            .arg("-vf")
            .arg(scale_arg)
            .arg("-q:v")
            .arg(q_val)
            .arg(&frame_path)
            .output();

        result = check_frame_file();
    }

    // Pass 4: Low-strictness / ignore-err decode for partial AV1/HEVC streams
    if result.is_none() {
        let status4 = std::process::Command::new(&ff_exe)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-probesize")
            .arg("2M")
            .arg("-analyzeduration")
            .arg("2M")
            .arg("-err_detect")
            .arg("ignore_err")
            .arg("-y")
            .args(av1_hwaccel_args)      // Phase 2: disable HW accel for AV1
            .arg("-i")
            .arg(&sample_path)
            .arg("-an")
            .arg("-vframes")
            .arg("1")
            .arg("-vf")
            .arg(scale_arg)
            .arg("-q:v")
            .arg(q_val)
            .arg(&frame_path)
            .output();

        result = check_frame_file();
        if result.is_none() {
            if let Ok(out) = status4 {
                let err2 = String::from_utf8_lossy(&out.stderr).trim().to_string();
                tg_log::warn(
                    BACKEND,
                    "ffmpeg_frame_failed",
                    &format!("size={} ext={ext} av1={is_av1} err1='{err1}' err2='{err2}'", sample_bytes.len()),
                );
            }
        }
    }

    // Pass 5: Direct bitstream / mdat payload snapshot extraction.
    // For AV1: extract raw OBU bytes from mdat and try av1/libdav1d demuxers (do NOT run Annex-B conversion).
    // For H.264/HEVC: convert AVCC length-prefixes to Annex-B start codes, then try h264/hevc/m4v demuxers.
    if result.is_none() && sample_bytes.len() >= 128 {
        if let Some(mdat_pos) = sample_bytes.windows(4).position(|w| w == b"mdat") {
            let stream_start = mdat_pos + 4;
            if stream_start < sample_bytes.len() {
                let raw_slice = &sample_bytes[stream_start..];

                // Phase 4: AV1 OBU path — separate from H.264/HEVC to avoid Annex-B corruption.
                // AV1 OBUs use a completely different framing than NAL units; running
                // convert_avcc_to_annexb on them corrupts the OBU headers.
                if is_av1 {
                    let stream_path = temp_dir.join(format!("autogram_vid_stream_{rand_id}.obu"));
                    if std::fs::write(&stream_path, raw_slice).is_ok() {
                        for (fmt, codec_hint) in [
                            ("av1", "libdav1d"),
                            ("av1", "libaom-av1"),
                            ("av1", "av1"),
                        ] {
                            let mut cmd = std::process::Command::new(&ff_exe);
                            cmd.arg("-hide_banner")
                                .arg("-loglevel").arg("quiet")
                                .arg("-hwaccel").arg("none")
                                .arg("-f").arg(fmt)
                                .arg("-c:v").arg(codec_hint)
                                .arg("-err_detect").arg("ignore_err")
                                .arg("-i").arg(&stream_path)
                                .arg("-an")
                                .arg("-vframes").arg("1")
                                .arg("-vf").arg(scale_arg)
                                .arg("-q:v").arg(q_val)
                                .arg(&frame_path);
                            let _ = cmd.output();
                            result = check_frame_file();
                            if result.is_some() {
                                tg_log::warn(
                                    BACKEND,
                                    "ffmpeg_pass5_av1_success",
                                    &format!("Raw OBU extracted using -f {fmt} -c:v {codec_hint} from mdat offset {stream_start}"),
                                );
                                break;
                            }
                        }
                        let _ = std::fs::remove_file(&stream_path);
                    }
                }

                // Fallback: legacy H.264/HEVC Annex-B rescue (existing logic, not touched for AV1)
                if result.is_none() && !is_av1 {
                    let annexb_bytes = convert_avcc_to_annexb(raw_slice);
                    let stream_path = temp_dir.join(format!("autogram_vid_stream_{rand_id}.bin"));
                    if std::fs::write(&stream_path, &annexb_bytes).is_ok() {
                        for fmt in ["h264", "hevc", "m4v", "mpegts"] {
                            let _ = std::process::Command::new(&ff_exe)
                                .arg("-hide_banner")
                                .arg("-loglevel")
                                .arg("quiet")
                                .arg("-y")
                                .arg("-f")
                                .arg(fmt)
                                .arg("-err_detect")
                                .arg("ignore_err")
                                .arg("-i")
                                .arg(&stream_path)
                                .arg("-an")
                                .arg("-vframes")
                                .arg("1")
                                .arg("-vf")
                                .arg(scale_arg)
                                .arg("-q:v")
                                .arg(q_val)
                                .arg(&frame_path)
                                .output();

                            result = check_frame_file();
                            if result.is_some() {
                                tg_log::warn(
                                    BACKEND,
                                    "ffmpeg_pass5_success",
                                    &format!("Raw bitstream snapshot extracted using -f {fmt} from mdat offset {stream_start}"),
                                );
                                break;
                            }
                        }
                        let _ = std::fs::remove_file(&stream_path);
                    }
                }
            }
        }
    }

    let _ = std::fs::remove_file(&sample_path);
    let _ = std::fs::remove_file(&frame_path);

    result
}

/// Extract a 1-frame WebP/JPEG thumbnail from a seekable HTTP Range URL (e.g. from `spawn_range_bridge`).
/// Enforces software decoding (`-hwaccel none`), `libdav1d`/`av1` decoder, 5-second process timeout,
/// and stderr output trimming to prevent terminal log spamming.
pub fn extract_ffmpeg_frame_from_url(
    input_url: &str,
    quality: &str,
    is_av1: bool,
) -> Option<Vec<u8>> {
    let ff_exe = find_ffmpeg_binary()?;

    if is_av1 && !ffmpeg_supports_av1(&ff_exe) {
        tg_log::info(
            BACKEND,
            "av1_decoder_unavailable",
            "Bundled FFmpeg lacks libdav1d/AV1 decoder support; falling back to smart file icon",
        );
        return None;
    }

    let mode = quality.to_lowercase();
    let sharp = mode.contains("jelas") || mode.contains("sharp");
    let saver = mode.contains("hemat") || mode.contains("saver");

    let (scale_arg, q_val) = if sharp {
        ("scale=-2:720,format=yuv420p", "2")
    } else if saver {
        ("scale=-2:360,format=yuv420p", "6")
    } else {
        ("scale=-2:480,format=yuv420p", "3")
    };

    let temp_dir = std::env::temp_dir();
    static FF_URL_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let seq = FF_URL_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let rand_id = format!("{pid}_{seq}_{nanos}");
    let frame_path = temp_dir.join(format!("autogram_vid_urlframe_{rand_id}.jpg"));

    let decoders: &[&[&str]] = if is_av1 {
        &[&["-c:v", "libdav1d"], &["-c:v", "av1"], &[]]
    } else {
        &[&[]]
    };

    let mut result = None;

    for c_arg in decoders {
        let mut cmd = std::process::Command::new(&ff_exe);
        cmd.arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-nostdin")
            .arg("-y")
            .arg("-err_detect")
            .arg("ignore_err")
            .arg("-fflags")
            .arg("+genpts+discardcorrupt")
            .arg("-hwaccel")
            .arg("none")
            .args(*c_arg)
            .arg("-ss")
            .arg("0")
            .arg("-i")
            .arg(input_url)
            .arg("-an")
            .arg("-vframes")
            .arg("1")
            .arg("-vf")
            .arg(scale_arg)
            .arg("-q:v")
            .arg(q_val)
            .arg(&frame_path);

        let output = match cmd.output() {
            Ok(out) => out,
            Err(_) => continue,
        };

        if frame_path.exists() {
            if let Ok(b) = std::fs::read(&frame_path) {
                let _ = std::fs::remove_file(&frame_path);
                if b.len() >= 800 && !is_fallback_black_card_bytes(&b) {
                    result = Some(b);
                    break;
                }
            }
        }

        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.is_empty() {
            let trimmed = if stderr.len() > 1024 {
                format!("{}... [trimmed]", &stderr[..1024])
            } else {
                stderr.trim().to_string()
            };
            tg_log::warn(
                BACKEND,
                "ffmpeg_url_extract_warn",
                format!("is_av1={is_av1} err='{trimmed}'"),
            );
        }
    }

    if frame_path.exists() {
        let _ = std::fs::remove_file(&frame_path);
    }

    result
}