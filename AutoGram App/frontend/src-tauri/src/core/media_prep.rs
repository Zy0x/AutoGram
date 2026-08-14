//! Local media prep for Studio: remote URL fetch + optional ffmpeg reencode + thumbnail extraction.
//! Pure Rust orchestration (external ffmpeg binary for encode/thumbnail).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Condvar, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use super::grammers_media::find_ffmpeg_binary;
use super::hardware_capability::{
    detect_hardware_capabilities, parse_specific_encoder_device, resolve_encoder_from_preference,
    smoke_test_encoder, smoke_test_encoder_on_device,
};
use super::path_policy;
use super::tg_log;

const BACKEND: &str = "media_prep";

static ACTIVE_ENCODERS: Mutex<usize> = Mutex::new(0);
static ENCODER_CAPACITY: Condvar = Condvar::new();

struct EncoderPermit;

impl EncoderPermit {
    fn acquire(max_parallel: usize) -> Self {
        let limit = max_parallel.clamp(1, 4);
        let mut active = ACTIVE_ENCODERS
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        while *active >= limit {
            active = ENCODER_CAPACITY
                .wait(active)
                .unwrap_or_else(|error| error.into_inner());
        }
        *active += 1;
        Self
    }
}

impl Drop for EncoderPermit {
    fn drop(&mut self) {
        let mut active = ACTIVE_ENCODERS
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *active = active.saturating_sub(1);
        ENCODER_CAPACITY.notify_one();
    }
}

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

fn emit_transfer_event(
    app: Option<&tauri::AppHandle>,
    event_type: &str,
    payload: serde_json::Value,
) {
    if let Some(app) = app {
        use tauri::Emitter;
        let mut map = payload;
        if let Some(obj) = map.as_object_mut() {
            obj.insert(
                "type".to_string(),
                serde_json::Value::String(event_type.to_string()),
            );
        }
        let _ = app.emit("transfer-event", map);
    }
}

/// Download remote URL to a temp file under path policy (max up to 4GB Telegram limit).
pub fn download_remote_url(
    url: &str,
    app: Option<&tauri::AppHandle>,
    item_index: usize,
) -> Result<PathBuf, String> {
    let url = url.trim();
    if !is_remote_url(url) {
        return Err("not a remote URL".into());
    }
    tg_log::info(
        BACKEND,
        "remote_download_start",
        url.chars().take(120).collect::<String>(),
    );

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(20))
        .timeout_read(std::time::Duration::from_secs(300))
        .redirects(8)
        .build();

    let mut req = agent.get(url);
    req = req.set(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 AutoGram/3.5",
    );
    req = req.set("Accept", "*/*");
    req = req.set("Accept-Language", "en-US,en;q=0.9,id;q=0.8");

    // Add Referer for sensitive platforms if applicable
    if url.contains("pixiv.net") || url.contains("pximg.net") {
        req = req.set("Referer", "https://www.pixiv.net/");
    } else if url.contains("tiktok.com") {
        req = req.set("Referer", "https://www.tiktok.com/");
    }

    let resp = req.call().map_err(|e| format!("download failed: {e}"))?;

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
    // Full 4GB limit for Telegram Premium / large files
    let max = 4096 * 1024 * 1024usize;
    let mut buf = [0u8; 128 * 1024];
    let mut written: usize = 0;
    let mut last_emit_ms = 0u128;

    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("read body: {e}"))?;
        if n == 0 {
            break;
        }
        written = written.saturating_add(n);
        
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);

        if now_ms.saturating_sub(last_emit_ms) > 200 || written == n {
            last_emit_ms = now_ms;
            if let Some(total) = content_length {
                if total > 0 {
                    let pct = (written as f64 / total as f64 * 100.0).min(99.9);
                    emit_transfer_event(
                        app,
                        "StudioProgress",
                        serde_json::json!({
                            "item_index": item_index,
                            "percent": pct,
                            "transferred": written,
                            "total": total,
                            "phase": "download"
                        }),
                    );
                }
            } else {
                emit_transfer_event(
                    app,
                    "StudioProgress",
                    serde_json::json!({
                        "item_index": item_index,
                        "percent": 50.0,
                        "transferred": written,
                        "total": 0,
                        "phase": "download"
                    }),
                );
            }
        }

        if written > max {
            let _ = fs::remove_file(&dest);
            return Err("remote file exceeds maximum 4GB limit".into());
        }
        file.write_all(&buf[..n])
            .map_err(|e| format!("write temp: {e}"))?;
    }

    if written < 16 {
        let _ = fs::remove_file(&dest);
        return Err("remote file empty or connection closed prematurely".into());
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

fn target_video_bitrate(
    duration_seconds: f64,
    planning_bytes: u64,
    audio_bitrate: &str,
    quality_mode: &str,
) -> Option<u64> {
    if !duration_seconds.is_finite() || duration_seconds <= 0.0 || planning_bytes < 1_000_000 {
        return None;
    }
    let audio_bps = audio_bitrate
        .trim_end_matches('k')
        .parse::<u64>()
        .ok()?
        .saturating_mul(1_000);
    let total_bps = ((planning_bytes as f64 * 8.0) / duration_seconds) as u64;
    let video_bps = total_bps.saturating_sub(audio_bps).saturating_sub(64_000);
    let quality_floor = if quality_mode.contains("HIGH") {
        600_000
    } else {
        350_000
    };
    (video_bps >= quality_floor).then_some(video_bps.min(50_000_000))
}

fn adjusted_target_planning_bytes(current_plan: u64, hard_limit: u64, actual_bytes: u64) -> u64 {
    current_plan
        .saturating_mul(hard_limit)
        .checked_div(actual_bytes.max(1))
        .unwrap_or(current_plan)
        .saturating_mul(95)
        / 100
}

/// Extract basic video metadata (width, height, duration in seconds) using ffprobe.
/// Returns (width, height, duration_secs) or defaults (0, 0, 0).
pub fn probe_video_metadata(path: &str) -> (u32, u32, f64) {
    let Some(ff) = find_ffmpeg_binary() else {
        return (0, 0, 0.0);
    };
    // Try ffprobe first (same dir as ffmpeg)
    let ffprobe = ff
        .parent()
        .map(|p| p.join("ffprobe"))
        .unwrap_or_else(|| PathBuf::from("ffprobe"));

    let mut cmd = Command::new(&ffprobe);
    cmd.args([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,duration",
        "-of",
        "default=noprint_wrappers=1:nokey=0",
        path,
    ]);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let Ok(output) = cmd.output() else {
        // Fallback: use ffmpeg -i for basic info
        return probe_video_metadata_ffmpeg_fallback(path, &ff);
    };

    let text = String::from_utf8_lossy(&output.stdout);
    let mut width = 0u32;
    let mut height = 0u32;
    let mut duration = 0.0f64;

    for line in text.lines() {
        if let Some(val) = line.strip_prefix("width=") {
            width = val.trim().parse().unwrap_or(0);
        } else if let Some(val) = line.strip_prefix("height=") {
            height = val.trim().parse().unwrap_or(0);
        } else if let Some(val) = line.strip_prefix("duration=") {
            if val.trim() != "N/A" {
                duration = val.trim().parse().unwrap_or(0.0);
            }
        }
    }

    (width, height, duration)
}

fn probe_video_metadata_ffmpeg_fallback(path: &str, ff: &Path) -> (u32, u32, f64) {
    let mut cmd = Command::new(ff);
    cmd.args(["-hide_banner", "-i", path]);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    // ffmpeg -i prints to stderr and exits with error
    let Ok(output) = cmd.output() else {
        return (0, 0, 0.0);
    };

    let text = String::from_utf8_lossy(&output.stderr);
    let mut width = 0u32;
    let mut height = 0u32;
    let mut duration = 0.0f64;

    for line in text.lines() {
        // Look for "Stream #0:0: Video: ... 1920x1080"
        if line.contains("Video:") {
            // Find resolution pattern like "1920x1080"
            for token in line.split_whitespace() {
                let parts: Vec<&str> = token.trim_end_matches(',').split('x').collect();
                if parts.len() == 2 {
                    if let (Ok(w), Ok(h)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
                        if w > 16 && h > 16 && w < 8000 && h < 8000 {
                            width = w;
                            height = h;
                        }
                    }
                }
            }
        }
        // Look for "Duration: 00:01:23.45"
        if line.trim_start().starts_with("Duration:") {
            if let Some(dur_str) = line.split_whitespace().nth(1) {
                let dur_str = dur_str.trim_end_matches(',');
                let parts: Vec<&str> = dur_str.split(':').collect();
                if parts.len() == 3 {
                    let h: f64 = parts[0].parse().unwrap_or(0.0);
                    let m: f64 = parts[1].parse().unwrap_or(0.0);
                    let s: f64 = parts[2].parse().unwrap_or(0.0);
                    duration = h * 3600.0 + m * 60.0 + s;
                }
            }
        }
    }

    (width, height, duration)
}

/// Extract a single JPEG thumbnail frame from a video file for use as Telegram thumbnail.
/// Returns the path to the temporary JPEG file, or None if extraction failed.
/// The caller is responsible for deleting this file after upload.
pub fn extract_video_thumbnail(path: &str) -> Option<PathBuf> {
    let p = Path::new(path);
    if !p.is_file() {
        return None;
    }
    let ext = p
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let is_video = matches!(
        ext.as_str(),
        "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "3gp" | "flv" | "ts"
    );
    let is_image = matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "tiff"
    );
    if !is_video && !is_image {
        return None;
    }

    let Some(ff) = find_ffmpeg_binary() else {
        tg_log::warn(BACKEND, "thumbnail_skip", "ffmpeg not found");
        return None;
    };

    let out = unique_name("thumb", "jpg");

    // Get video duration to seek to a representative frame (10% into video for videos, 0s for images)
    let (width, height, duration) = probe_video_metadata(path);
    let seek_time = if is_image {
        0.0
    } else if duration > 0.0 {
        (duration * 0.1).min(10.0) // seek to 10% or max 10s
    } else {
        0.0
    };

    // Thumbnail: max 320px wide, maintain aspect ratio, JPEG quality 85
    let thumb_width = if width > 0 && height > 0 {
        320u32.min(width)
    } else {
        320
    };
    let scale_filter = format!("scale={}:-2", thumb_width);

    let mut cmd = Command::new(&ff);
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-ss",
        &format!("{:.1}", seek_time),
        "-i",
        path,
        "-an",
        "-vframes",
        "1",
        "-vf",
        &scale_filter,
        "-q:v",
        "3",
        "-f",
        "image2",
        out.to_str().unwrap_or("thumb.jpg"),
    ]);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());

    match cmd.status() {
        Ok(s) if s.success() && out.is_file() => {
            let sz = fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
            if sz > 128 {
                tg_log::info(
                    BACKEND,
                    "thumbnail_ok",
                    format!("path={} size={sz} seek={seek_time:.1}s", out.display()),
                );
                Some(out)
            } else {
                let _ = fs::remove_file(&out);
                tg_log::warn(BACKEND, "thumbnail_empty", format!("size={sz}"));
                None
            }
        }
        Ok(s) => {
            tg_log::warn(BACKEND, "thumbnail_fail", format!("status={s}"));
            let _ = fs::remove_file(&out);
            None
        }
        Err(e) => {
            tg_log::warn(BACKEND, "thumbnail_spawn", e.to_string());
            None
        }
    }
}

/// Transcode WebP / sticker formats to 100% true lossless PNG (png)
/// preserving original dimensions, alpha transparency, and visual quality (no quality loss)
/// for native compatibility with Telegram MTProto Photo Albums (InputMediaUploadedPhoto).
pub fn transcode_sticker_media_to_image_lossless(path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path);
    if !p.is_file() {
        return Err(format!("file not found: {path}"));
    }
    let Some(ff) = find_ffmpeg_binary() else {
        return Err("ffmpeg binary not found for WebP conversion".into());
    };

    let out_png = unique_name("transcoded_photo", "png");

    let mut cmd = Command::new(&ff);
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        path,
        "-vframes",
        "1",
        "-compression_level",
        "1",
    ]);
    cmd.arg(&out_png);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = cmd.output().map_err(|e| format!("spawn ffmpeg failed: {e}"))?;
    if output.status.success() && out_png.is_file() {
        let sz = fs::metadata(&out_png).map(|m| m.len()).unwrap_or(0);
        if sz > 0 {
            tg_log::info(
                BACKEND,
                "webp_transcode_png_ok",
                format!("input={path} output={} size={sz}", out_png.display()),
            );
            return Ok(out_png);
        }
    }

    let err_msg = String::from_utf8_lossy(&output.stderr);
    Err(format!("ffmpeg webp conversion failed: {err_msg}"))
}

/// Optional lean reencode for Telegram-friendly MP4 (when quality_mode suggests it).
/// Returns the original path when the selected mode safely permits passthrough;
/// strict encoder strategies return an error when their contract cannot be met.
///
/// `hardware_override`: user-specified encoder preference from Transfer Settings UI.
///   - None or "auto" → auto-detect best available
///   - "nvenc" → force NVIDIA NVENC
///   - "amf" → force AMD AMF
///   - "qsv" → force Intel Quick Sync
///   - "cpu" → force CPU x264
pub fn maybe_reencode_for_telegram(
    path: &str,
    quality_mode: Option<&str>,
    hardware_override: Option<&str>,
    encoder_strategy: Option<&str>,
    resource_profile: Option<&str>,
    max_parallel: usize,
    allow_software_fallback: bool,
    target_max_bytes: Option<u64>,
    target_planning_bytes: Option<u64>,
    target_attempt: u8,
    app: Option<&tauri::AppHandle>,
    item_index: usize,
) -> Result<String, String> {
    let strategy = encoder_strategy.unwrap_or("auto_adaptive");
    let strict_hardware = matches!(strategy, "hardware_only" | "specific_device");
    let strict_software = strategy == "software_only";
    if encoder_strategy
        .map(|value| value.eq_ignore_ascii_case("disable_reencode"))
        .unwrap_or(false)
    {
        tg_log::info(BACKEND, "reencode_disabled_by_profile", path);
        return Ok(path.to_string());
    }
    let mode = quality_mode.unwrap_or("").to_ascii_uppercase();

    let p = Path::new(path);
    if !p.is_file() {
        return Ok(path.to_string());
    }
    let ext = p
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    // 1:1 Lossless conversion for WebP / Sticker media if prevent_sticker_conversion is requested
    // or if sending in photo albums where Telegram API rejects raw .webp with MEDIA_EMPTY (400)
    if ext == "webp" || ext == "tgs" {
        let prevent_sticker = mode.contains("PREVENT_STICKER")
            || mode.contains("PHOTO")
            || mode.contains("VISUAL")
            || mode.contains("SEIMBANG")
            || mode.contains("HEMAT")
            || mode.contains("JELAS")
            || mode.contains("HIGH")
            || mode.contains("LOW")
            || mode.contains("AUTO");

        if prevent_sticker {
            match transcode_sticker_media_to_image_lossless(path) {
                Ok(out_path) => {
                    return Ok(out_path.display().to_string());
                }
                Err(e) => {
                    tg_log::warn(BACKEND, "webp_transcode_failed", e);
                }
            }
        }
    }

    // ORIGINAL / DOCUMENT / UNCOMPRESSED / RAW / LOSSLESS / PASSTHROUGH / empty → skip video reencode
    if mode.is_empty()
        || mode.contains("ORIGINAL")
        || mode.contains("DOCUMENT")
        || mode.contains("UNCOMPRESSED")
        || mode.contains("RAW")
        || mode.contains("LOSSLESS")
        || mode.contains("PASSTHROUGH")
        || mode.contains("SKIP")
    {
        return Ok(path.to_string());
    }

    let is_video = matches!(
        ext.as_str(),
        "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "3gp"
    );
    if !is_video {
        return Ok(path.to_string());
    }

    let source_analysis = super::autogram_core::transfer::analyze_media(p);
    let input_size = fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    let hard_target_bytes = target_max_bytes.filter(|limit| *limit > 0 && input_size > *limit);
    if source_analysis.is_hdr() || source_analysis.has_preservation_sensitive_streams() {
        tg_log::warn(
            BACKEND,
            "reencode_preservation_guard",
            "HDR, subtitle, attachment, data, or multi-audio streams require an explicit preservation decision",
        );
        return Ok(path.to_string());
    }

    // Container extension alone is not proof of native playback compatibility.
    if ext == "mp4"
        && source_analysis.is_validated_native_video()
        && hard_target_bytes.is_none()
        && !mode.contains("FORCE_REENCODE")
        && !mode.contains("ALWAYS_REENCODE")
    {
        tg_log::info(
            BACKEND,
            "reencode_passthrough",
            format!("Direct upload passthrough for mp4 video: {path}"),
        );
        return Ok(path.to_string());
    }
    let Some(ff) = find_ffmpeg_binary() else {
        tg_log::warn(BACKEND, "reencode_skip", "ffmpeg not found");
        if strict_hardware || strict_software {
            return Err("encoder_toolchain_unavailable: FFmpeg binary not found".into());
        }
        return Ok(path.to_string());
    };

    if ext != "mp4" && hard_target_bytes.is_none() && source_analysis.lossless_mp4_remux_feasible()
    {
        let remuxed = unique_name("remux", "mp4");
        let mut command = Command::new(&ff);
        command.args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-i",
            path,
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c:v",
            "copy",
            "-c:a",
            "copy",
            "-map_metadata",
            "0",
            "-map_chapters",
            "0",
            "-movflags",
            "+faststart",
        ]);
        command.arg(&remuxed);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        match command.status() {
            Ok(status) if status.success() && remuxed.is_file() => {
                let validation = super::autogram_core::transfer::analyze_media(&remuxed);
                if validation.is_validated_native_video() {
                    tg_log::info(BACKEND, "lossless_remux_selected", "explicit stream map");
                    return Ok(remuxed.display().to_string());
                }
                let _ = fs::remove_file(&remuxed);
                tg_log::warn(
                    BACKEND,
                    "lossless_remux_validation_failed",
                    "remux output was not native-playback compatible",
                );
            }
            Ok(status) => {
                tg_log::warn(BACKEND, "lossless_remux_failed", format!("status={status}"))
            }
            Err(error) => tg_log::warn(BACKEND, "lossless_remux_spawn", error.to_string()),
        }
    }

    let preset = resolve_quality_preset(&mode);
    let out = unique_name("reenc", "mp4");
    let planning_bytes = hard_target_bytes.map(|hard_limit| {
        target_planning_bytes.unwrap_or_else(|| hard_limit.saturating_mul(95) / 100)
    });
    let planned_video_bitrate = match planning_bytes {
        Some(bytes) => {
            let Some(duration) = source_analysis.duration_seconds else {
                tg_log::warn(
                    BACKEND,
                    "target_size_duration_unavailable",
                    "target-size encode deferred to oversize resolver because duration is unavailable",
                );
                return Ok(path.to_string());
            };
            let Some(bitrate) = target_video_bitrate(duration, bytes, preset.audio_bitrate, &mode)
            else {
                tg_log::warn(
                    BACKEND,
                    "target_size_quality_floor",
                    "target-size bitrate would cross the bounded quality floor",
                );
                return Ok(path.to_string());
            };
            Some(bitrate)
        }
        None => None,
    };

    // Resolve encoder: user preference takes priority, fallback to auto-detect
    let hw_pref = match strategy {
        "software_only" | "software_preferred" => "cpu",
        _ => hardware_override.unwrap_or("auto"),
    };
    let selected_device = parse_specific_encoder_device(&hw_pref.to_ascii_lowercase());
    if strategy == "specific_device" && selected_device.is_none() {
        return Err(
            "specific_device_required: select an explicitly routable physical encoder device"
                .into(),
        );
    }
    if let Some(device) = selected_device.as_ref() {
        let capabilities = detect_hardware_capabilities();
        let is_current_and_routable = capabilities.gpu.iter().any(|gpu| {
            gpu.backend_id == device.backend_id
                && gpu.device_index == device.device_index
                && gpu.device_id.eq_ignore_ascii_case(&device.device_id)
                && gpu.supported
                && gpu.supports_explicit_selection
        });
        if !is_current_and_routable {
            return Err(
                "specific_device_unavailable: selected physical encoder is stale, unsupported, or cannot be routed explicitly"
                    .into(),
            );
        }
    }
    let (mut v_codec, mut encoder_display) = resolve_encoder_from_preference(hw_pref);
    if strict_hardware && v_codec == "libx264" {
        return Err(
            "hardware_only_no_valid_device: no usable hardware encoder was selected".into(),
        );
    }
    let smoke_result = if let Some(device) = selected_device.as_ref() {
        smoke_test_encoder_on_device(&v_codec, device.device_index)
    } else {
        smoke_test_encoder(&v_codec)
    };
    if let Err(error) = smoke_result {
        tg_log::warn(BACKEND, "encoder_smoke_failed", &error);
        if v_codec != "libx264" && allow_software_fallback && !strict_hardware {
            smoke_test_encoder("libx264")?;
            v_codec = "libx264".into();
            encoder_display = "CPU x264 fallback".into();
            tg_log::info(BACKEND, "software_fallback_selected", &error);
        } else {
            return Err(error);
        }
    }
    let _encoder_permit = EncoderPermit::acquire(max_parallel);
    let thread_count = match resource_profile.unwrap_or("balanced") {
        "eco" => "2".to_string(),
        "custom" => std::thread::available_parallelism()
            .map(|value| (value.get() / 2).max(1).to_string())
            .unwrap_or_else(|_| "2".into()),
        _ => "0".into(),
    };

    tg_log::info(
        BACKEND,
        "reencode_start",
        format!("encoder={encoder_display} hw_pref={hw_pref} mode={mode}"),
    );

    emit_transfer_event(
        app,
        "StudioReencodeStarted",
        serde_json::json!({
            "index": item_index,
            "backend": hw_pref,
            "encoder": encoder_display,
            "planned_target_bytes": planning_bytes.unwrap_or(input_size),
            "target_attempt": target_attempt,
            "planned_video_bitrate": planned_video_bitrate,
        }),
    );

    use std::io::BufRead;
    use std::process::Stdio;

    // Build GPU-specific optimization args
    let mut extra_args: Vec<String> = Vec::new();

    if let Some(bitrate) = planned_video_bitrate {
        extra_args.extend(["-b:v".to_string(), bitrate.to_string()]);
    }

    if v_codec == "h264_nvenc" {
        if let Some(device) = selected_device.as_ref() {
            extra_args.extend(["-gpu".to_string(), device.device_index.to_string()]);
        }
        // NVENC: use VBR rate control for better quality/speed balance
        extra_args.extend([
            "-rc".to_string(),
            "vbr".to_string(),
            "-cq".to_string(),
            preset.crf.to_string(),
            "-spatial_aq".to_string(),
            "1".to_string(),
        ]);
        if planned_video_bitrate.is_none() {
            extra_args.extend(["-b:v".to_string(), "0".to_string()]);
        }
    } else if v_codec == "h264_amf" {
        // AMF: quality mode for better GPU utilization
        extra_args.extend(["-quality".to_string(), "speed".to_string()]);
    } else if v_codec == "h264_qsv" {
        // QSV: global quality for Intel GPU
        extra_args.extend([
            "-global_quality".to_string(),
            preset.crf.to_string(),
            "-look_ahead".to_string(),
            "1".to_string(),
        ]);
    }

    let mut child_cmd = Command::new(&ff);
    child_cmd.args([
        "-y",
        "-progress",
        "pipe:1",
        "-nostats",
        "-threads",
        &thread_count,
        "-i",
        path,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        preset.vf_scale,
        "-c:v",
        &v_codec,
    ]);

    // Add GPU-specific extra args
    for arg in &extra_args {
        child_cmd.arg(arg);
    }

    // For CPU encoding only, use CRF mode
    if v_codec == "libx264" && planned_video_bitrate.is_none() {
        child_cmd.args(["-preset", "veryfast", "-crf", preset.crf]);
    } else if v_codec == "libx264" {
        child_cmd.args(["-preset", "veryfast"]);
    }

    let target_max_rate = planned_video_bitrate
        .map(|bitrate| bitrate.saturating_mul(105) / 100)
        .map(|bitrate| bitrate.to_string());
    let target_buffer_size = planned_video_bitrate
        .map(|bitrate| bitrate.saturating_mul(2))
        .map(|bitrate| bitrate.to_string());
    let max_rate = target_max_rate.as_deref().unwrap_or(preset.max_rate);
    let buffer_size = target_buffer_size.as_deref().unwrap_or(preset.buf_size);

    child_cmd
        .args([
            "-maxrate",
            max_rate,
            "-bufsize",
            buffer_size,
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
            drop(_encoder_permit);
            if v_codec != "libx264" && allow_software_fallback && !strict_hardware {
                return maybe_reencode_for_telegram(
                    path,
                    quality_mode,
                    Some("cpu"),
                    Some("software_only"),
                    resource_profile,
                    max_parallel,
                    false,
                    target_max_bytes,
                    target_planning_bytes,
                    target_attempt,
                    app,
                    item_index,
                );
            }
            return Err(format!("encoder_spawn_failed: {e}"));
        }
    };

    let stdout = child.stdout.take();
    if let Some(stdout) = stdout {
        let reader = std::io::BufReader::new(stdout);
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
                let processed_bytes = (pct / 100.0 * input_size as f64) as u64;

                emit_transfer_event(
                    app,
                    "StudioReencodeProgress",
                    serde_json::json!({
                        "index": item_index,
                        "percent": pct,
                        "fps": fps,
                        "speed_x": speed_x,
                        "eta_s": eta_s,
                        "encoder": encoder_display,
                    }),
                );

                if let Some(app) = app {
                    use tauri::Emitter;
                    let _ = app.emit(
                        "transfer-progress",
                        serde_json::json!({
                            "jobId": format!("item-{}", item_index),
                            "stage": "encode",
                            "currentBytes": processed_bytes,
                            "totalBytes": input_size,
                            "speed": speed_x,
                            "percentage": pct,
                            "fps": fps,
                            "eta": eta_s as u64
                        }),
                    );
                }
            }
        }
    }

    let status = child.wait();
    match status {
        Ok(s) if s.success() && out.is_file() => {
            let sz = fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
            if sz > 64 {
                if let (Some(hard_limit), Some(current_plan)) = (hard_target_bytes, planning_bytes)
                {
                    if sz > hard_limit && target_attempt < 2 {
                        let adjusted_plan =
                            adjusted_target_planning_bytes(current_plan, hard_limit, sz);
                        tg_log::warn(
                            BACKEND,
                            "target_size_retry",
                            format!(
                                "attempt={} actual={} hard_limit={} next_plan={}",
                                target_attempt + 1,
                                sz,
                                hard_limit,
                                adjusted_plan
                            ),
                        );
                        let _ = fs::remove_file(&out);
                        drop(_encoder_permit);
                        return maybe_reencode_for_telegram(
                            path,
                            quality_mode,
                            hardware_override,
                            encoder_strategy,
                            resource_profile,
                            max_parallel,
                            allow_software_fallback,
                            target_max_bytes,
                            Some(adjusted_plan),
                            target_attempt + 1,
                            app,
                            item_index,
                        );
                    }
                    if sz > hard_limit {
                        tg_log::warn(
                            BACKEND,
                            "target_size_exhausted",
                            format!(
                                "actual={sz} hard_limit={hard_limit}; forwarding to oversize resolver"
                            ),
                        );
                    }
                }
                tg_log::info(
                    BACKEND,
                    "reencode_ok",
                    format!("encoder={encoder_display} out={} bytes={sz}", out.display()),
                );
                emit_transfer_event(
                    app,
                    "StudioReencodeDone",
                    serde_json::json!({
                        "index": item_index,
                        "output_bytes": sz,
                        "total": sz,
                        "encoder": encoder_display
                    }),
                );
                return Ok(out.display().to_string());
            }
        }
        Ok(s) => {
            tg_log::warn(
                BACKEND,
                "reencode_fail",
                format!("encoder={encoder_display} mode={mode} status={s}"),
            );
        }
        Err(e) => {
            tg_log::warn(BACKEND, "reencode_spawn", e.to_string());
        }
    }
    let _ = fs::remove_file(&out);
    if v_codec != "libx264" && allow_software_fallback && !strict_hardware {
        tg_log::warn(
            BACKEND,
            "encoder_runtime_fallback",
            "hardware encode failed; retrying once with CPU x264",
        );
        drop(_encoder_permit);
        return maybe_reencode_for_telegram(
            path,
            quality_mode,
            Some("cpu"),
            Some("software_only"),
            resource_profile,
            max_parallel,
            false,
            target_max_bytes,
            target_planning_bytes,
            target_attempt,
            app,
            item_index,
        );
    }
    Err(format!(
        "encoder_output_invalid: {encoder_display} did not produce a valid output"
    ))
}

#[derive(Debug, Clone)]
pub struct PreparedUploadArtifact {
    pub source_path: String,
    pub prepared_path: String,
    pub cleanup_paths: Vec<PathBuf>,
    pub transformed: bool,
    pub native_visual_validated: bool,
    pub transform_action: super::autogram_core::transfer::TransformAction,
}

impl PreparedUploadArtifact {
    pub fn cleanup(self) {
        for path in self.cleanup_paths {
            let _ = fs::remove_file(path);
        }
    }
}

/// Resolve and materialize a Studio item before delivery. Every temporary file
/// is retained in the receipt so multi-stage URL -> encode flows cannot leak.
pub fn prepare_upload_artifact_with_policy(
    path: &str,
    quality_mode: Option<&str>,
    hardware_override: Option<&str>,
    encoder_strategy: Option<&str>,
    encoder_resource_profile: Option<&str>,
    encoder_max_parallel: usize,
    encoder_allow_software_fallback: bool,
    target_max_bytes: Option<u64>,
    app: Option<&tauri::AppHandle>,
    item_index: usize,
) -> Result<PreparedUploadArtifact, String> {
    let mut cleanup_paths = Vec::new();
    let local = if is_remote_url(path) {
        let downloaded = download_remote_url(path, app, item_index)?;
        cleanup_paths.push(downloaded.clone());
        downloaded.display().to_string()
    } else {
        path_policy::assert_safe_transfer_path(path).map_err(|e| e.to_string())?;
        path.to_string()
    };
    let prepared = maybe_reencode_for_telegram(
        &local,
        quality_mode,
        hardware_override,
        encoder_strategy,
        encoder_resource_profile,
        encoder_max_parallel,
        encoder_allow_software_fallback,
        target_max_bytes,
        None,
        0,
        app,
        item_index,
    )?;
    let transformed = prepared != local;
    let transform_action = if !transformed {
        super::autogram_core::transfer::TransformAction::PassThrough
    } else if std::path::Path::new(&prepared)
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.starts_with("remux_"))
    {
        super::autogram_core::transfer::TransformAction::LosslessRemux
    } else {
        super::autogram_core::transfer::TransformAction::Reencode
    };
    if transformed {
        cleanup_paths.push(PathBuf::from(&prepared));
    }
    let source_analysis =
        super::autogram_core::transfer::analyze_media(std::path::Path::new(&local));
    let prepared_path_obj = std::path::Path::new(&prepared);
    let prepared_analysis = super::autogram_core::transfer::analyze_media(prepared_path_obj);
    let is_image_output = matches!(
        prepared_analysis.category,
        super::autogram_core::transfer::MediaCategory::JpegImage
            | super::autogram_core::transfer::MediaCategory::PngImage
            | super::autogram_core::transfer::MediaCategory::WebpImage
    ) || prepared_path_obj
        .extension()
        .and_then(|s| s.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp"))
        .unwrap_or(false);

    if transformed {
        let validation_error = if is_image_output {
            let exists_and_nonempty = prepared_path_obj.is_file()
                && fs::metadata(prepared_path_obj).map(|m| m.len()).unwrap_or(0) > 0;
            if !exists_and_nonempty {
                Some("encoder_output_invalid: transcoded image output file is missing or empty".into())
            } else {
                None
            }
        } else if !prepared_path_obj.is_file()
            || fs::metadata(prepared_path_obj).map(|m| m.len()).unwrap_or(0) == 0
        {
            Some("encoder_output_invalid: transcoded video output file is missing or empty".into())
        } else if prepared_analysis.probe_available && prepared_analysis.probe_error.is_none() {
            if !prepared_analysis.is_validated_native_video() {
                Some(
                    "encoder_output_invalid: prepared output is not a Telegram-native H.264/AAC MP4"
                        .into(),
                )
            } else if transform_action == super::autogram_core::transfer::TransformAction::Reencode {
                match (
                    source_analysis.duration_seconds,
                    prepared_analysis.duration_seconds,
                ) {
                    (Some(source_duration), Some(output_duration)) => {
                        let tolerance = (source_duration * 0.02).max(2.0);
                        ((source_duration - output_duration).abs() > tolerance).then(|| {
                            format!(
                                "encoder_duration_mismatch: source={source_duration:.3}s output={output_duration:.3}s tolerance={tolerance:.3}s"
                            )
                        })
                    }
                    _ => None,
                }
            } else {
                None
            }
        } else {
            // ffprobe is unavailable or could not probe, but ffmpeg exit status succeeded and output file exists & non-empty
            None
        };
        if let Some(error) = validation_error {
            for cleanup_path in cleanup_paths {
                let _ = fs::remove_file(cleanup_path);
            }
            return Err(error);
        }
    }
    let native_visual_validated = if is_image_output {
        prepared_path_obj.is_file()
    } else {
        match prepared_analysis.category {
            super::autogram_core::transfer::MediaCategory::JpegImage
            | super::autogram_core::transfer::MediaCategory::PngImage => true,
            super::autogram_core::transfer::MediaCategory::Mp4Video => {
                prepared_analysis.is_validated_native_video()
            }
            _ => false,
        }
    };
    Ok(PreparedUploadArtifact {
        source_path: path.to_string(),
        prepared_path: prepared,
        cleanup_paths,
        transformed,
        native_visual_validated,
        transform_action,
    })
}

pub fn prepare_upload_artifact(
    path: &str,
    quality_mode: Option<&str>,
    hardware_override: Option<&str>,
    app: Option<&tauri::AppHandle>,
    item_index: usize,
) -> Result<PreparedUploadArtifact, String> {
    prepare_upload_artifact_with_policy(
        path,
        quality_mode,
        hardware_override,
        None,
        None,
        1,
        true,
        None,
        app,
        item_index,
    )
}

#[cfg(test)]
mod tests {
    use super::{adjusted_target_planning_bytes, target_video_bitrate, PreparedUploadArtifact};
    use std::{fs, path::PathBuf};

    #[test]
    fn prepared_artifact_cleanup_removes_every_stage() {
        let root = std::env::temp_dir().join(format!(
            "autogram-artifact-cleanup-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        fs::create_dir_all(&root).unwrap();
        let downloaded = root.join("downloaded.bin");
        let encoded = root.join("encoded.bin");
        fs::write(&downloaded, b"download").unwrap();
        fs::write(&encoded, b"encode").unwrap();

        PreparedUploadArtifact {
            source_path: "https://example.invalid/source".to_string(),
            prepared_path: encoded.display().to_string(),
            cleanup_paths: vec![downloaded.clone(), encoded.clone()],
            transformed: true,
            native_visual_validated: true,
            transform_action: super::super::autogram_core::transfer::TransformAction::Reencode,
        }
        .cleanup();

        assert!(!downloaded.exists());
        assert!(!encoded.exists());
        let _ = fs::remove_dir(PathBuf::from(root));
    }

    #[test]
    fn target_size_bitrate_reserves_audio_and_honors_quality_floor() {
        assert_eq!(
            target_video_bitrate(100.0, 20_000_000, "128k", "SMART"),
            Some(1_408_000)
        );
        assert_eq!(
            target_video_bitrate(100.0, 5_000_000, "128k", "HIGH_QUALITY"),
            None
        );
    }

    #[test]
    fn target_size_retry_reduces_planning_budget_with_headroom() {
        let adjusted = adjusted_target_planning_bytes(95_000_000, 100_000_000, 110_000_000);
        assert!(adjusted < 95_000_000);
        assert_eq!(adjusted, 82_045_454);
    }
}
