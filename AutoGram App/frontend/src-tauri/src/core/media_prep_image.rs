//! Image transcoding helpers (WebP, HEIC, AVIF, RAW, sticker lossless PNG & high-quality JPEG) for Studio media prep.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::{find_ffmpeg_binary, tg_log, unique_name, BACKEND};

/// Transcode WebP / sticker formats to 100% true lossless PNG (png)
/// preserving original dimensions, alpha transparency, and visual quality (no quality loss).
/// Used when the output will be sent as a Document (file preserved intact, no server recompression).
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

    let output = cmd
        .output()
        .map_err(|e| format!("spawn ffmpeg failed: {e}"))?;
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

/// Transcode WebP / sticker formats directly to high-quality JPEG for Telegram native Photo albums.
///
/// Rationale: Telegram's server always re-encodes any image uploaded as a native Photo to its own
/// internal JPEG format (~Q87–92). Sending PNG (lossless) as the source means two format
/// conversions happen: WebP → PNG (us) then PNG → JPEG (Telegram server, unknown quality).
/// By transcoding directly to JPEG Q92 here, only ONE lossy step occurs in the app under our
/// control; Telegram's subsequent JPEG→JPEG re-encoding at a similar quality level introduces
/// negligible additional degradation — far less than a fresh lossless→lossy conversion would.
///
/// `-q:v 2` in ffmpeg MJPEG scale (1=best … 31=worst) produces approximately JPEG Q92–95.
pub fn transcode_webp_to_jpeg_for_photo(path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path);
    if !p.is_file() {
        return Err(format!("file not found: {path}"));
    }
    let Some(ff) = find_ffmpeg_binary() else {
        return Err("ffmpeg binary not found for WebP→JPEG conversion".into());
    };

    let out_jpg = unique_name("transcoded_photo", "jpg");

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
        // q:v 2 ≈ JPEG Q92–95. High quality, single controlled lossy step.
        "-q:v",
        "2",
    ]);
    cmd.arg(&out_jpg);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("spawn ffmpeg failed: {e}"))?;
    if output.status.success() && out_jpg.is_file() {
        let sz = fs::metadata(&out_jpg).map(|m| m.len()).unwrap_or(0);
        if sz > 0 {
            tg_log::info(
                BACKEND,
                "webp_transcode_jpeg_ok",
                format!("input={path} output={} size={sz}", out_jpg.display()),
            );
            return Ok(out_jpg);
        }
    }

    let err_msg = String::from_utf8_lossy(&output.stderr);
    Err(format!("ffmpeg webp→jpeg conversion failed: {err_msg}"))
}

/// Transcode non-standard images (WebP, HEIC, AVIF, TIFF, BMP, PSD, RAW, etc.)
/// to 100% Lossless PNG (bit-exact RGBA) or Maximum Fidelity JPEG (Q100 4:4:4)
pub fn maybe_transcode_image_for_telegram(
    path: &str,
    target_format: Option<&str>,
    image_transcode_scope: Option<&str>,
    image_transcode_formats: Option<&[String]>,
    item_index: usize,
) -> Result<String, String> {
    let p = Path::new(path);
    let ext = p
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if ext == "jpg" || ext == "jpeg" || ext == "jfif" {
        return Ok(path.to_string());
    }

    if let Ok(mut f) = std::fs::File::open(p) {
        use std::io::Read;
        let mut header = [0u8; 3];
        if f.read_exact(&mut header).is_ok()
            && header[0] == 0xFF
            && header[1] == 0xD8
            && header[2] == 0xFF
        {
            return Ok(path.to_string());
        }
    }

    let scope = image_transcode_scope.unwrap_or("all_incompatible");
    let should_transcode = match scope {
        "none" => false,
        "common_web" => matches!(
            ext.as_str(),
            "png" | "webp" | "heic" | "heif" | "hif" | "avif" | "avis" | "jxl"
        ),
        "graphics_raw" => matches!(
            ext.as_str(),
            "bmp"
                | "tiff"
                | "tif"
                | "svg"
                | "svgz"
                | "psd"
                | "psb"
                | "tga"
                | "dds"
                | "exr"
                | "hdr"
                | "ico"
                | "raw"
                | "dng"
                | "cr2"
                | "cr3"
                | "nef"
                | "nrw"
                | "arw"
                | "orf"
                | "rw2"
                | "pef"
                | "raf"
        ),
        "custom" => {
            if let Some(custom_list) = image_transcode_formats {
                custom_list.iter().any(|f| f.eq_ignore_ascii_case(&ext))
            } else {
                matches!(
                    ext.as_str(),
                    "png"
                        | "webp"
                        | "heic"
                        | "heif"
                        | "avif"
                        | "jxl"
                        | "bmp"
                        | "tiff"
                        | "tif"
                        | "svg"
                        | "psd"
                        | "raw"
                        | "dng"
                )
            }
        }
        _ => matches!(
            ext.as_str(),
            "png"
                | "webp"
                | "heic"
                | "heif"
                | "hif"
                | "avif"
                | "avis"
                | "jxl"
                | "bmp"
                | "tiff"
                | "tif"
                | "svg"
                | "svgz"
                | "psd"
                | "psb"
                | "tga"
                | "dds"
                | "exr"
                | "hdr"
                | "ico"
                | "cur"
                | "raw"
                | "dng"
                | "cr2"
                | "cr3"
                | "nef"
                | "nrw"
                | "arw"
                | "srf"
                | "sr2"
                | "orf"
                | "rw2"
                | "pef"
                | "raf"
                | "srw"
                | "x3f"
        ),
    };

    if !should_transcode {
        return Ok(path.to_string());
    }

    let ffmpeg_path = match find_ffmpeg_binary() {
        Some(p) => p,
        None => {
            tg_log::warn(
                BACKEND,
                "image_transcode_no_ffmpeg",
                "FFmpeg not found; skipping image transcode",
            );
            return Ok(path.to_string());
        }
    };

    let target_fmt = target_format.unwrap_or("jpg").to_ascii_lowercase();
    let is_target_png = target_fmt == "png";

    let temp_dir = std::env::temp_dir();
    let out_ext = if is_target_png { "png" } else { "jpg" };
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let out_file = temp_dir.join(format!(
        "{}_{}_{}.{}",
        stem,
        std::process::id(),
        item_index,
        out_ext
    ));

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.arg("-y").arg("-i").arg(path);

    if is_target_png {
        // 100% Bit-exact Lossless RGBA
        cmd.arg("-pix_fmt")
            .arg("rgba")
            .arg("-compression_level")
            .arg("1");
    } else {
        // 100% Maximum Quality JPEG (Q100, 4:4:4 Chroma)
        cmd.arg("-pix_fmt")
            .arg("yuvj444p")
            .arg("-q:v")
            .arg("1")
            .arg("-qmin")
            .arg("1");
    }

    cmd.arg(&out_file);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    match cmd.status() {
        Ok(status) if status.success() && out_file.exists() => {
            if let Ok(meta) = fs::metadata(&out_file) {
                if meta.len() > 0 {
                    tg_log::info(
                        BACKEND,
                        "image_transcode_ok",
                        format!(
                            "src={} target={} out={} bytes={}",
                            path,
                            out_ext,
                            out_file.display(),
                            meta.len()
                        ),
                    );
                    return Ok(out_file.display().to_string());
                }
            }
        }
        Ok(status) => {
            tg_log::warn(BACKEND, "image_transcode_fail", format!("status={status}"));
        }
        Err(e) => {
            tg_log::warn(BACKEND, "image_transcode_err", e.to_string());
        }
    }

    let _ = fs::remove_file(&out_file);
    Ok(path.to_string())
}
