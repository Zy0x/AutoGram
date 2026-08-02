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

fn emit_transfer_event(app: Option<&tauri::AppHandle>, event_type: &str, payload: serde_json::Value) {
    if let Some(app) = app {
        use tauri::Emitter;
        let mut map = payload;
        if let Some(obj) = map.as_object_mut() {
            obj.insert("type".to_string(), serde_json::Value::String(event_type.to_string()));
        }
        let _ = app.emit("transfer-event", map);
    }
}

/// Download remote URL to a temp file under path policy (max ~200MB).
pub fn download_remote_url(url: &str, app: Option<&tauri::AppHandle>, item_index: usize) -> Result<PathBuf, String> {
    let url = url.trim();
    if !is_remote_url(url) {
        return Err("not a remote URL".into());
    }
    tg_log::info(
        BACKEND,
        "remote_download_start",
        url.chars().take(80).collect::<String>(),
    );

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
    let content_length: Option<u64> = resp.header("content-length").and_then(|l| l.parse().ok());
    let ext = ext_from_url_or_ctype(url, &content_type);
    let dest = unique_name("remote", &ext);

    use std::io::{Read, Write};
    let mut reader = resp.into_reader();
    let mut file = fs::File::create(&dest).map_err(|e| format!("create temp: {e}"))?;
    let max = 200 * 1024 * 1024usize;
    let mut buf = [0u8; 64 * 1024];
    let mut written: usize = 0;
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("read body: {e}"))?;
        if n == 0 {
            break;
        }
        written = written.saturating_add(n);
        if let Some(total) = content_length {
            if total > 0 {
                let pct = (written as f64 / total as f64 * 100.0).min(99.0);
                emit_transfer_event(app, "StudioProgress", serde_json::json!({
                    "item_index": item_index,
                    "percent": pct,
                    "transferred": written,
                    "total": total,
                    "phase": "download"
                }));
            }
        }
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
pub fn maybe_reencode_for_telegram(path: &str, quality_mode: Option<&str>, app: Option<&tauri::AppHandle>, item_index: usize) -> String {
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
    let input_size = fs::metadata(p).map(|m| m.len()).unwrap_or(0);

    emit_transfer_event(app, "StudioReencodeStarted", serde_json::json!({
        "index": item_index,
        "backend": "GPU",
        "encoder": "H.264",
        "planned_target_bytes": input_size
    }));

    use std::io::BufRead;
    use std::process::Stdio;

    let mut child_cmd = Command::new(&ff);
    child_cmd.args([
        "-y",
        "-progress",
        "pipe:1",
        "-nostats",
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
    .stdout(Stdio::piped())
    .stderr(Stdio::null());

    let mut child = match child_cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            tg_log::warn(BACKEND, "reencode_spawn", e.to_string());
            return path.to_string();
        }
    };

    let stdout = child.stdout.take();
    if let Some(stdout) = stdout {
        let reader = std::io::BufReader::new(stdout);
        // Estimate video duration from file size (assuming ~2Mbps average bitrate) or standard 60s
        let est_duration_us = if input_size > 0 {
            ((input_size as f64 * 8.0) / 2_000_000.0 * 1_000_000.0).max(5_000_000.0)
        } else {
            60_000_000.0
        };

        let mut fps = 0.0f64;
        let mut speed_x = 1.0f64;
        let mut out_time_us = 0f64;

        for line in reader.lines().map_while(Result::ok) {
            let line = line.trim();
            if let Some(val) = line.strip_prefix("fps=") {
                fps = val.trim().parse().unwrap_or(fps);
            } else if let Some(val) = line.strip_prefix("speed=") {
                let s = val.trim().trim_end_matches('x');
                speed_x = s.parse().unwrap_or(speed_x);
            } else if let Some(val) = line.strip_prefix("out_time_us=") {
                out_time_us = val.trim().parse().unwrap_or(out_time_us);
            } else if line == "progress=continue" || line == "progress=end" {
                let pct = (out_time_us / est_duration_us * 100.0).clamp(1.0, 99.0);
                let remain_us = (est_duration_us - out_time_us).max(0.0);
                let eta_s = if speed_x > 0.05 {
                    (remain_us / 1_000_000.0 / speed_x).max(0.0)
                } else {
                    0.0
                };
                emit_transfer_event(app, "StudioReencodeProgress", serde_json::json!({
                    "index": item_index,
                    "percent": pct,
                    "fps": fps,
                    "speed_x": speed_x,
                    "eta_s": eta_s,
                    "backend": "GPU",
                    "encoder": "H.264"
                }));
            }
        }
    }

    let status = child.wait();
    match status {
        Ok(s) if s.success() && out.is_file() => {
            let sz = fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
            if sz > 64 {
                tg_log::info(
                    BACKEND,
                    "reencode_ok",
                    format!("preset={mode} out={} bytes={sz}", out.display()),
                );
                emit_transfer_event(app, "StudioReencodeDone", serde_json::json!({
                    "index": item_index,
                    "output_bytes": sz,
                    "backend": "GPU",
                    "encoder": "H.264"
                }));
                return out.display().to_string();
            }
        }
        Ok(s) => {
            tg_log::warn(
                BACKEND,
                "reencode_fail",
                format!("preset={mode} status={s}"),
            );
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
    app: Option<&tauri::AppHandle>,
    item_index: usize,
) -> Result<(String, Option<PathBuf>), String> {
    let mut temps: Vec<PathBuf> = Vec::new();
    let local = if is_remote_url(path) {
        let p = download_remote_url(path, app, item_index)?;
        temps.push(p.clone());
        p.display().to_string()
    } else {
        path_policy::assert_safe_transfer_path(path).map_err(|e| e.to_string())?;
        path.to_string()
    };
    let prepared = maybe_reencode_for_telegram(&local, quality_mode, app, item_index);
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

