//! Container Repair Engine
//! Fixes corrupted MP4 headers, MOOV atom position, and broken index tables using FFmpeg faststart stream copy.

use crate::core::grammers::ffmpeg::find_ffmpeg_binary;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepairResult {
    pub success: bool,
    pub output_path: String,
    pub repaired_by: String,
    pub message: String,
}

pub fn repair_mp4_container(input_path: &Path, output_path: &Path) -> Result<RepairResult, String> {
    let ff_path = find_ffmpeg_binary()
        .ok_or_else(|| "FFmpeg binary not found for container repair".to_string())?;

    let mut cmd = Command::new(&ff_path);
    cmd.arg("-hide_banner")
        .arg("-y")
        .arg("-i")
        .arg(input_path)
        .arg("-c")
        .arg("copy")
        .arg("-movflags")
        .arg("faststart")
        .arg(output_path);

    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let output = cmd
        .output()
        .map_err(|e| format!("failed to execute ffmpeg repair: {e}"))?;

    if output.status.success() && output_path.exists() {
        Ok(RepairResult {
            success: true,
            output_path: output_path.to_string_lossy().to_string(),
            repaired_by: "ffmpeg_faststart_stream_copy".to_string(),
            message: "MOOV atom moved to front and container repaired successfully".to_string(),
        })
    } else {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        Err(format!("FFmpeg repair failed: {err_msg}"))
    }
}
