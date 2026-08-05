//! Lossless Stream Copy Container Remuxer

use crate::core::grammers::ffmpeg::find_ffmpeg_binary;
use std::path::Path;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub fn remux_lossless(input_path: &Path, output_path: &Path) -> Result<(), String> {
    let ff_path =
        find_ffmpeg_binary().ok_or_else(|| "FFmpeg binary not found for remux".to_string())?;

    let mut cmd = Command::new(&ff_path);
    cmd.arg("-hide_banner")
        .arg("-y")
        .arg("-i")
        .arg(input_path)
        .arg("-c")
        .arg("copy")
        .arg(output_path);

    #[cfg(windows)]
    cmd.creation_flags(0x08000000);

    let output = cmd
        .output()
        .map_err(|e| format!("failed to execute ffmpeg remux: {e}"))?;

    if output.status.success() && output_path.exists() {
        Ok(())
    } else {
        Err(format!(
            "FFmpeg remux failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}
