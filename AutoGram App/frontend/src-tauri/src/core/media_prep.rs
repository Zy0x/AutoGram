//! Local media prep for Studio: remote URL fetch + optional ffmpeg reencode.
//! Pure Rust orchestration (external ffmpeg binary for encode).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use super::grammers_media::find_ffmpeg_binary;
use super::path_policy;
use super::tg_log;

const BACKEND: &str = "media_prep";

fn temp_dir() -> PathBuf {
    let base = std::env::temp_dir().join("autogram_studio_prep");
    let _ = fs::create_dir_all(&base);
    base
}

fn unique_name(prefix: &str, ext: &str) -> PathBuf {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    temp_dir().join(format!("{prefix}_{ms}_{}.{}", std::process::id(), ext))
}

/// True if path looks like an http(s) URL.
pub fn is_remote_url(path: &str) -> bool {
    let p = path.trim().to_ascii_lowercase();
    p.starts_with("http://") || p.starts_with("https://")
}

/// Download remote URL to a temp file under path policy (max ~200MB).
pub fn download_remote_url(url: &str) -> Result<PathBuf, String> {
    let url = url.trim();
    if !is_remote_url(url) {
        return Err("not a remote URL".into());
    }
    tg_log::info(BACKEND, "remote_download_start", url.chars().take(80).collect::<String>());

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(15))
        .timeout_read(std::time::Duration::from_secs(120))
        .build();
    let resp = agent
        .get(url)
        .set("User-Agent", "AutoGram/2.0")
        .call()
        .map_err(|e| format!("download failed: {e}"))?;

    let content_type = resp
        .header("content-type")
        .unwrap_or("application/octet-stream")
        .to_string();
    let ext = ext_from_url_or_ctype(url, &content_type);
    let dest = unique_name("remote", &ext);

    use std::io::{Read, Write};
    let mut reader = resp.into_reader();
    let mut file = fs::File::create(&dest).map_err(|e| format!("create temp: {e}"))?;
    let max = 200 * 1024 * 1024usize;
    let mut buf = [0u8; 64 * 1024];
    let mut written: usize = 0;
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("read body: {e}"))?;
        if n == 0 {
            break;
        }
        written = written.saturating_add(n);
        if written > max {
            let _ = fs::remove_file(&dest);
            return Err("remote file > 200MB (limit)".into());
        }
        file.write_all(&buf[..n])
            .map_err(|e| format!("write temp: {e}"))?;
    }
    if written < 16 {
        let _ = fs::remove_file(&dest);
        return Err("remote file empty".into());
    }
    path_policy::assert_safe_transfer_path(dest.to_str().unwrap_or(""))
        .map_err(|e| e.to_string())?;
    tg_log::info(
        BACKEND,
        "remote_download_ok",
        format!("bytes={written} path={}", dest.display()),
    );
    Ok(dest)
}

fn ext_from_url_or_ctype(url: &str, ctype: &str) -> String {
    if let Some(path) = url.split('?').next() {
        if let Some(ext) = Path::new(path).extension().and_then(|s| s.to_str()) {
            let e = ext.to_ascii_lowercase();
            if e.len() <= 5 && e.chars().all(|c| c.is_ascii_alphanumeric()) {
                return e;
            }
        }
    }
    let c = ctype.to_ascii_lowercase();
    if c.contains("jpeg") || c.contains("jpg") {
        return "jpg".into();
    }
    if c.contains("png") {
        return "png".into();
    }
    if c.contains("webp") {
        return "webp".into();
    }
    if c.contains("mp4") {
        return "mp4".into();
    }
    if c.contains("webm") {
        return "webm".into();
    }
    if c.contains("gif") {
        return "gif".into();
    }
    "bin".into()
}

/// Quality preset parameters for video transcoding
struct QualityPreset {
    vf_scale: &'static str,
    crf: &'static str,
    max_rate: &'static str,
    buf_size: &'static str,
    audio_bitrate: &'static str,
}

fn resolve_quality_preset(mode: &str) -> QualityPreset {
    let m = mode.to_ascii_uppercase();
    if m.contains("HEMAT") || m.contains("COMPRESS") || m.contains("LOW") {
        QualityPreset {
            vf_scale: "scale='min(854,iw)':'-2'",
            crf: "28",
            max_rate: "600k",
            buf_size: "1200k",
            audio_bitrate: "96k",
        }
    } else if m.contains("JELAS") || m.contains("HIGH") || m.contains("HD") {
        QualityPreset {
            vf_scale: "scale='min(1920,iw)':'-2'",
            crf: "20",
            max_rate: "3500k",
            buf_size: "7000k",
            audio_bitrate: "192k",
        }
    } else {
        // Default: SEIMBANG / BALANCED / 720p
        QualityPreset {
            vf_scale: "scale='min(1280,iw)':'-2'",
            crf: "23",
            max_rate: "1500k",
            buf_size: "3000k",
            audio_bitrate: "128k",
        }
    }
}

/// Optional lean reencode for Telegram-friendly MP4 (when quality_mode suggests it).
/// Returns original path if reencode skipped/failed (best-effort).
pub fn maybe_reencode_for_telegram(path: &str, quality_mode: Option<&str>) -> String {
    let mode = quality_mode.unwrap_or("").to_ascii_uppercase();
    // ORIGINAL / DOCUMENT / empty → skip
    if mode.is_empty()
        || mode.contains("ORIGINAL")
        || mode.contains("DOCUMENT")
        || mode.contains("SKIP")
    {
        return path.to_string();
    }
    let p = Path::new(path);
    if !p.is_file() {
        return path.to_string();
    }
    let ext = p
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let is_video = matches!(
        ext.as_str(),
        "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "3gp"
    );
    if !is_video {
        return path.to_string();
    }
    let Some(ff) = find_ffmpeg_binary() else {
        tg_log::warn(BACKEND, "reencode_skip", "ffmpeg not found");
        return path.to_string();
    };

    let preset = resolve_quality_preset(&mode);
    let out = unique_name("reenc", "mp4");

    let status = Command::new(&ff)
        .args([
            "-y",
            "-i",
            path,
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-vf",
            preset.vf_scale,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            preset.crf,
            "-maxrate",
            preset.max_rate,
            "-bufsize",
            preset.buf_size,
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            preset.audio_bitrate,
            "-movflags",
            "+faststart",
            out.to_str().unwrap_or("out.mp4"),
        ])
        .status();
    match status {
        Ok(s) if s.success() && out.is_file() => {
            let sz = fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
            if sz > 64 {
                tg_log::info(
                    BACKEND,
                    "reencode_ok",
                    format!("preset={mode} out={} bytes={sz}", out.display()),
                );
                return out.display().to_string();
            }
        }
        Ok(s) => {
            tg_log::warn(BACKEND, "reencode_fail", format!("preset={mode} status={s}"));
        }
        Err(e) => {
            tg_log::warn(BACKEND, "reencode_spawn", e.to_string());
        }
    }
    let _ = fs::remove_file(&out);
    path.to_string()
}

/// Resolve a studio item path: download remote URL if needed, optional reencode.
/// Returns (local_path, cleanup_temp).
pub fn prepare_upload_path(
    path: &str,
    quality_mode: Option<&str>,
) -> Result<(String, Option<PathBuf>), String> {
    let mut temps: Vec<PathBuf> = Vec::new();
    let local = if is_remote_url(path) {
        let p = download_remote_url(path)?;
        temps.push(p.clone());
        p.display().to_string()
    } else {
        path_policy::assert_safe_transfer_path(path).map_err(|e| e.to_string())?;
        path.to_string()
    };
    let prepared = maybe_reencode_for_telegram(&local, quality_mode);
    if prepared != local {
        temps.push(PathBuf::from(&prepared));
    }
    let cleanup = temps.into_iter().last();
    Ok((prepared, cleanup))
}

pub fn cleanup_temp(path: Option<PathBuf>) {
    if let Some(p) = path {
        let _ = fs::remove_file(p);
    }
}
