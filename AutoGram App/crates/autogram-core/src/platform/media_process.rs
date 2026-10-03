//! Bounded subprocesses owned by the media engine, never the user's desktop app.
use std::{io::{Read, Result as IoResult}, process::{Command, Output, Stdio}, time::{Duration, Instant}};

const MAX_CAPTURE_BYTES: usize = 1024 * 1024;

fn drain(mut pipe: impl Read) -> IoResult<Vec<u8>> {
    let mut captured = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        let count = pipe.read(&mut buffer)?;
        if count == 0 { break; }
        let remaining = MAX_CAPTURE_BYTES.saturating_sub(captured.len());
        captured.extend_from_slice(&buffer[..count.min(remaining)]);
        // Keep draining beyond the capture limit so a noisy encoder cannot deadlock.
    }
    Ok(captured)
}

pub(crate) fn run_media_command(mut command: Command, timeout: Duration) -> Result<Output, String> {
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| "media_process_unavailable".to_string())?;
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let out_reader = std::thread::spawn(move || drain(stdout));
    let err_reader = std::thread::spawn(move || drain(stderr));
    let start = Instant::now();
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err("media_process_timeout".to_string());
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err("media_process_wait_failed".to_string());
            }
        }
    };
    let stdout = out_reader.join().map_err(|_| "media_stdout_failed")?
        .map_err(|_| "media_stdout_failed")?;
    let stderr = err_reader.join().map_err(|_| "media_stderr_failed")?
        .map_err(|_| "media_stderr_failed")?;
    Ok(Output { status: result?, stdout, stderr })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn drains_noisy_output_without_unbounded_allocation() {
        let data = vec![b'x'; MAX_CAPTURE_BYTES * 3];
        assert_eq!(drain(data.as_slice()).unwrap().len(), MAX_CAPTURE_BYTES);
    }
    #[test]
    fn missing_binary_is_an_error_not_success() {
        let command = Command::new("autogram-deliberately-missing-media-tool");
        assert_eq!(run_media_command(command, Duration::from_secs(1)).unwrap_err(), "media_process_unavailable");
    }
}
