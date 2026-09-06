use super::{Job, MuxSpec};
use std::{io::Read, path::{Path, PathBuf}, process::{Command, Stdio}, sync::atomic::Ordering, time::Duration};

pub(super) fn binaries() -> Result<(PathBuf, PathBuf), String> {
    let ffmpeg = crate::core::grammers::ffmpeg::find_ffmpeg_binary().ok_or("remote_download_ffmpeg_missing")?;
    let ffprobe = ffmpeg.with_file_name(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" });
    if !ffprobe.is_file() { return Err("remote_download_ffmpeg_missing".into()); }
    Ok((ffmpeg, ffprobe))
}

/// Drain pipes concurrently; never wait on a child with a full stderr pipe.
/// Pause terminates only this job's subprocess, then restarts the local phase
/// on resume. Downloaded inputs are retained, so no media is downloaded again.
pub(super) fn process(command: &mut Command, job: &Job) -> Result<Vec<u8>, String> {
    loop {
        job.checkpoint()?;
        #[cfg(windows)]
        { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
        let mut child = command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .spawn().map_err(|_| "remote_download_ffmpeg_failed")?;
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let out = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let mut stream = stdout;
            let _ = (&mut stream).take(1024 * 1024).read_to_end(&mut bytes);
            let _ = std::io::copy(&mut stream, &mut std::io::sink());
            bytes
        });
        let err = std::thread::spawn(move || { let _ = std::io::copy(&mut { stderr }, &mut std::io::sink()); });
        let mut interrupted = false;
        let status = loop {
            if job.control.load(Ordering::SeqCst) != 0 {
                let _ = child.kill();
                let _ = child.wait();
                interrupted = true;
                break None;
            }
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(_) => { let _ = child.kill(); let _ = child.wait(); break None; }
            }
        };
        let bytes = out.join().unwrap_or_default();
        let _ = err.join();
        if interrupted { job.checkpoint()?; continue; }
        if !status.is_some_and(|s| s.success()) { return Err("remote_download_ffmpeg_failed".into()); }
        return Ok(bytes);
    }
}

fn probe(ffprobe: &Path, path: &Path, job: &Job) -> Result<serde_json::Value, String> {
    let bytes = process(Command::new(ffprobe).args(["-v", "error", "-show_streams", "-show_format", "-of", "json"]).arg(path), job)?;
    serde_json::from_slice(&bytes).map_err(|_| "remote_download_invalid_media".into())
}

pub(super) fn assemble(video: &Path, audio: &Path, output: &Path, spec: &MuxSpec, job: &Job) -> Result<(), String> {
    let (ffmpeg, ffprobe) = binaries()?;
    let input = probe(&ffprobe, video, job)?;
    let source = input["streams"].as_array().and_then(|s| s.iter().find(|s| s["codec_type"] == "video"))
        .ok_or("remote_download_invalid_media")?;
    let source_height = source["height"].as_u64().unwrap_or(0);
    let source_width = source["width"].as_u64().unwrap_or(0);
    if source_height == 0 || spec.expected_height.is_some_and(|h| h as u64 != source_height) {
        return Err("remote_download_wrong_resolution".into());
    }
    let input_duration = input["format"]["duration"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
    if let Some(expected) = spec.expected_duration_sec.filter(|v| v.is_finite() && *v > 0.0) {
        if (input_duration - expected).abs() > (expected * 0.02).max(2.0) { return Err("remote_download_wrong_duration".into()); }
    }
    let mut command = Command::new(&ffmpeg);
    command.args(["-y", "-nostdin", "-hide_banner", "-v", "error", "-xerror", "-i"]).arg(video)
        .arg("-i").arg(audio).args(["-map", "0:v:0", "-map", "1:a:0"]);
    if spec.transcode_video {
        if spec.output_ext != "mp4" { return Err("remote_download_invalid_mux".into()); }
        command.args(["-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p"]);
    } else { command.args(["-c:v", "copy"]); }
    match spec.output_ext.as_str() {
        "mp4" => { command.args(["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]); }
        "webm" => { command.args(["-c:a", "libopus", "-b:a", "160k"]); }
        "mkv" => { command.args(["-c:a", "copy"]); }
        _ => return Err("remote_download_invalid_mux".into()),
    }
    // Do not use -shortest: missing/truncated audio must not silently cut 4K video.
    command.arg(output);
    process(&mut command, job)?;
    job.phase("verify");
    let result = probe(&ffprobe, output, job)?;
    let streams = result["streams"].as_array().ok_or("remote_download_invalid_media")?;
    let video_result = streams.iter().find(|s| s["codec_type"] == "video").ok_or("remote_download_invalid_media")?;
    if video_result["height"].as_u64() != Some(source_height) || video_result["width"].as_u64() != Some(source_width)
        || !streams.iter().any(|s| s["codec_type"] == "audio") {
        return Err("remote_download_invalid_media".into());
    }
    let duration = result["format"]["duration"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
    if duration <= 0.0 || (input_duration - duration).abs() > (input_duration * 0.02).max(2.0) {
        return Err("remote_download_wrong_duration".into());
    }
    // Decode a bounded sample of both tracks before publishing. Full-file decode
    // is deliberately not claimed: it would double the cost of every 4K download.
    process(Command::new(ffmpeg).args(["-v", "error", "-xerror", "-i"]).arg(output)
        .args(["-t", "1", "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"]), job)?;
    Ok(())
}
