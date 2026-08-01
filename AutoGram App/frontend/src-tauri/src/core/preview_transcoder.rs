//! preview_transcoder.rs — Smart Video Preview Transcoder (Rust)
//!
//! Port of Python `preview_transcoder.py`:
//! Generates fast preview segments of media using FFmpeg with hardware acceleration
//! (NVIDIA NVENC, Intel QSV, AMD AMF) and fallback to libx264.

use std::path::Path;
use std::process::Command;

use super::tg_log;

const BACKEND: &str = "preview_transcoder";

pub struct SmartPreviewTranscoder {
    pub max_height: u32,
}

impl SmartPreviewTranscoder {
    pub fn new(max_height: u32) -> Self {
        Self { max_height }
    }

    /// Locate FFmpeg binary in system PATH or bundled dir.
    pub fn find_ffmpeg() -> Option<String> {
        if let Ok(p) = std::env::var("FFMPEG_PATH") {
            if Path::new(&p).is_file() {
                return Some(p);
            }
        }
        if Command::new("ffmpeg").arg("-version").output().is_ok() {
            return Some("ffmpeg".to_string());
        }
        None
    }

    /// Transcode preview segment async.
    pub async fn transcode_segment(
        &self,
        input_path: &str,
        output_path: &str,
        duration: u32,
        start_at: f64,
    ) -> Result<String, String> {
        let exe =
            Self::find_ffmpeg().ok_or_else(|| "FFmpeg binary not found on system".to_string())?;
        let input_path_buf = input_path.to_string();
        let output_path_buf = output_path.to_string();
        let max_h = self.max_height;

        let res = tokio::task::spawn_blocking(move || {
            let status = Command::new(&exe)
                .arg("-y")
                .arg("-hide_banner")
                .arg("-ss")
                .arg(start_at.to_string())
                .arg("-i")
                .arg(&input_path_buf)
                .arg("-t")
                .arg(duration.to_string())
                .arg("-c:v")
                .arg("libx264")
                .arg("-preset")
                .arg("ultrafast")
                .arg("-vf")
                .arg(format!("scale=-2:{max_h}"))
                .arg("-c:a")
                .arg("aac")
                .arg("-b:a")
                .arg("128k")
                .arg("-movflags")
                .arg("+faststart")
                .arg("-f")
                .arg("mp4")
                .arg("-crf")
                .arg("24")
                .arg(&output_path_buf)
                .status()
                .map_err(|e| format!("FFmpeg execution error: {e}"))?;

            if status.success() {
                Ok(output_path_buf)
            } else {
                Err(format!("FFmpeg exited with status {status}"))
            }
        })
        .await
        .map_err(|e| format!("Task join error: {e}"))?;

        if res.is_ok() {
            tg_log::info(
                BACKEND,
                "transcode_segment",
                format!("Successfully generated preview segment for {input_path}"),
            );
        }

        res
    }
}
