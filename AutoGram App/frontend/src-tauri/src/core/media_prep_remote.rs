//! Remote media download, DoH DNS resolution, HLS streaming, and format sniffing for Studio media prep.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use std::time::{SystemTime, UNIX_EPOCH};

use super::{
    emit_transfer_event, find_ffmpeg_binary, is_remote_url, path_policy, probe_audio_metadata,
    probe_video_metadata, tg_log, unique_name, BACKEND,
};

use std::net::ToSocketAddrs;

struct SmartDoHResolver;

impl ureq::Resolver for SmartDoHResolver {
    fn resolve(&self, netloc: &str) -> std::io::Result<Vec<std::net::SocketAddr>> {
        // 1. Try standard system DNS first
        if let Ok(addrs) = netloc.to_socket_addrs() {
            let list: Vec<std::net::SocketAddr> = addrs.collect();
            if !list.is_empty() {
                return Ok(list);
            }
        }

        // 2. Extract host and port
        let (host, port) = if let Some((h, p)) = netloc.rsplit_once(':') {
            (h, p.parse::<u16>().unwrap_or(443))
        } else {
            (netloc, 443)
        };

        if let Ok(ip) = host.parse::<std::net::IpAddr>() {
            return Ok(vec![std::net::SocketAddr::new(ip, port)]);
        }

        // 3. Fallback: Query Cloudflare DoH (1.1.1.1)
        let doh_url = format!("https://1.1.1.1/dns-query?name={}&type=A", urlencoding::encode(host));
        let doh_agent = ureq::builder()
            .timeout_connect(std::time::Duration::from_secs(5))
            .timeout_read(std::time::Duration::from_secs(5))
            .build();

        if let Ok(resp) = doh_agent
            .get(&doh_url)
            .set("Accept", "application/dns-json")
            .call()
        {
            if let Ok(json_val) = resp.into_json::<serde_json::Value>() {
                if let Some(answers) = json_val.get("Answer").and_then(|v| v.as_array()) {
                    let mut resolved = Vec::new();
                    for ans in answers {
                        if ans.get("type").and_then(|t| t.as_u64()) == Some(1) {
                            if let Some(ip_str) = ans.get("data").and_then(|d| d.as_str()) {
                                if let Ok(ip) = ip_str.parse::<std::net::IpAddr>() {
                                    resolved.push(std::net::SocketAddr::new(ip, port));
                                }
                            }
                        }
                    }
                    if !resolved.is_empty() {
                        return Ok(resolved);
                    }
                }
            }
        }

        // 4. Fallback: Query Google DoH (8.8.8.8)
        let google_doh_url = format!("https://dns.google/resolve?name={}&type=A", urlencoding::encode(host));
        if let Ok(resp) = doh_agent
            .get(&google_doh_url)
            .set("Accept", "application/dns-json")
            .call()
        {
            if let Ok(json_val) = resp.into_json::<serde_json::Value>() {
                if let Some(answers) = json_val.get("Answer").and_then(|v| v.as_array()) {
                    let mut resolved = Vec::new();
                    for ans in answers {
                        if ans.get("type").and_then(|t| t.as_u64()) == Some(1) {
                            if let Some(ip_str) = ans.get("data").and_then(|d| d.as_str()) {
                                if let Ok(ip) = ip_str.parse::<std::net::IpAddr>() {
                                    resolved.push(std::net::SocketAddr::new(ip, port));
                                }
                            }
                        }
                    }
                    if !resolved.is_empty() {
                        return Ok(resolved);
                    }
                }
            }
        }

        Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("DoH DNS resolution failed for host: {netloc}"),
        ))
    }
}

pub fn create_resilient_http_agent() -> ureq::Agent {
    ureq::builder()
        .timeout_connect(std::time::Duration::from_secs(20))
        .timeout_read(std::time::Duration::from_secs(300))
        .redirects(8)
        .resolver(SmartDoHResolver)
        .build()
}

pub fn resolve_social_media_direct_url(url: &str) -> Option<String> {
    let u_lower = url.to_ascii_lowercase();
    if (u_lower.contains("tiktok.com") || u_lower.contains("douyin.com"))
        && !u_lower.contains("tiktokcdn")
        && !u_lower.contains(".mp4")
    {
        let api_url = format!(
            "https://www.tikwm.com/api/?url={}&hd=1",
            urlencoding::encode(url)
        );
        let agent = create_resilient_http_agent();
        if let Ok(resp) = agent.get(&api_url).call() {
            if let Ok(json_val) = resp.into_json::<serde_json::Value>() {
                if let Some(data) = json_val.get("data") {
                    if let Some(hdplay) = data.get("hdplay").and_then(|v| v.as_str()) {
                        let direct = if hdplay.starts_with("http") {
                            hdplay.to_string()
                        } else {
                            format!("https://www.tikwm.com{hdplay}")
                        };
                        return Some(direct);
                    }
                    if let Some(play) = data.get("play").and_then(|v| v.as_str()) {
                        let direct = if play.starts_with("http") {
                            play.to_string()
                        } else {
                            format!("https://www.tikwm.com{play}")
                        };
                        return Some(direct);
                    }
                    if let Some(images) = data.get("images").and_then(|v| v.as_array()) {
                        if let Some(first_img) = images.first().and_then(|v| v.as_str()) {
                            let direct = if first_img.starts_with("http") {
                                first_img.to_string()
                            } else {
                                format!("https://www.tikwm.com{first_img}")
                            };
                            return Some(direct);
                        }
                    }
                }
            }
        }
    }
    None
}

pub fn resolve_pikpak_direct_url(url: &str) -> Option<String> {
    let u_lower = url.to_ascii_lowercase();
    if !u_lower.contains("pikpak") || !u_lower.contains("/s/") {
        return None;
    }
    let parsed = url::Url::parse(url).ok()?;
    let path = parsed.path();
    let share_id = if let Some(idx) = path.find("/s/") {
        let seg = &path[idx + 3..];
        seg.split('/').next()?.to_string()
    } else {
        return None;
    };
    if share_id.is_empty() {
        return None;
    }

    let pass_code = parsed
        .query_pairs()
        .find(|(k, _)| k == "pwd" || k == "pass_code" || k == "code" || k == "passcode")
        .map(|(_, v)| v.to_string())
        .unwrap_or_default();

    let client_id = "YUMx5nI8ZU8Ap8pm";
    let client_version = "undefined";
    let package_name = "drive.mypikpak.com";
    let timestamp = "1787297641205";
    let device_id = format!("{:032x}", rand::random::<u128>());

    let salts = [
        "fyZ4+p77W1U4zcWBUwefAIFhFxvADWtT1wzolCxhg9q7etmGUjXr",
        "uSUX02HYJ1IkyLdhINEFcCf7l2",
        "iWt97bqD/qvjIaPXB2Ja5rsBWtQtBZZmaHH2rMR41",
        "3binT1s/5a1pu3fGsN",
        "8YCCU+AIr7pg+yd7CkQEY16lDMwi8Rh4WNp5",
        "DYS3StqnAEKdGddRP8CJrxUSFh",
        "crquW+4",
        "ryKqvW9B9hly+JAymXCIfag5Z",
        "Hr08T/NDTX1oSJfHk90c",
        "i",
    ];

    let mut current_salt = format!(
        "{}{}{}{}{}",
        client_id, client_version, package_name, device_id, timestamp
    );
    for salt in salts {
        let digest = md5::compute(format!("{}{}", current_salt, salt).as_bytes());
        current_salt = format!("{:x}", digest);
    }
    let captcha_sign = format!("1.{}", current_salt);

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(10))
        .timeout_read(std::time::Duration::from_secs(15))
        .build();

    let init_body = serde_json::json!({
        "client_id": client_id,
        "device_id": device_id,
        "action": "GET:/drive/v1/share",
        "meta": {
            "captcha_sign": captcha_sign,
            "client_version": client_version,
            "package_name": package_name,
            "user_id": "",
            "timestamp": timestamp
        }
    });

    let init_resp = agent
        .post("https://user.mypikpak.com/v1/shield/captcha/init")
        .set("Content-Type", "application/json")
        .set(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        )
        .set("x-device-id", &device_id)
        .set("x-client-id", client_id)
        .send_json(init_body)
        .ok()?;

    let init_val: serde_json::Value = init_resp.into_json().ok()?;
    let captcha_token = init_val.get("captcha_token")?.as_str()?;

    let mut share_url = format!(
        "https://api-drive.mypikpak.com/drive/v1/share?share_id={}",
        urlencoding::encode(&share_id)
    );
    if !pass_code.is_empty() {
        share_url.push_str(&format!("&pass_code={}", urlencoding::encode(&pass_code)));
    }

    let share_resp = agent
        .get(&share_url)
        .set(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        )
        .set("x-device-id", &device_id)
        .set("x-client-id", client_id)
        .set("x-captcha-token", captcha_token)
        .set("Accept", "application/json")
        .call()
        .ok()?;

    let share_val: serde_json::Value = share_resp.into_json().ok()?;
    let files = share_val.get("files")?.as_array()?;
    let first_file = files.first()?;

    if let Some(link) = first_file.get("web_content_link").and_then(|v| v.as_str()) {
        if link.starts_with("http") {
            return Some(link.to_string());
        }
    }
    if let Some(link) = first_file
        .get("links")
        .and_then(|l| l.get("download"))
        .and_then(|d| d.get("url"))
        .and_then(|u| u.as_str())
    {
        if link.starts_with("http") {
            return Some(link.to_string());
        }
    }
    None
}

fn is_hls_stream_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.contains(".m3u8")
        || lower.contains("manifest/hls_playlist")
        || lower.contains("format=m3u8")
        || lower.contains("protocol=m3u8")
}

pub fn download_hls_stream_ffmpeg(
    url: &str,
    app: Option<&tauri::AppHandle>,
    item_index: usize,
) -> Result<PathBuf, String> {
    let ff = find_ffmpeg_binary().ok_or_else(|| "FFmpeg binary not found for HLS download".to_string())?;
    let dest = unique_name("remote_hls", "mp4");

    tg_log::info(
        BACKEND,
        "download_hls_stream_start",
        format!("Downloading HLS stream via FFmpeg: url='{}' dest='{}'", &url[..url.len().min(100)], dest.display()),
    );

    let mut cmd = Command::new(&ff);
    cmd.args([
        "-y",
        "-nostdin",
        "-user_agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 AutoGram/3.5",
        "-reconnect",
        "1",
        "-reconnect_at_eof",
        "1",
        "-reconnect_streamed",
        "1",
        "-reconnect_delay_max",
        "5",
        "-i",
        url,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
    ]);
    cmd.arg(&dest);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    emit_transfer_event(
        app,
        "StudioProgress",
        serde_json::json!({
            "item_index": item_index,
            "percent": 10.0,
            "transferred": 0,
            "total": 0,
            "phase": "download"
        }),
    );

    let mut child = cmd.spawn().map_err(|e| format!("failed to spawn ffmpeg: {e}"))?;

    loop {
        if crate::core::job_queue::is_any_transfer_cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_file(&dest);
            return Err("download cancelled by user".into());
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    let _ = fs::remove_file(&dest);
                    return Err(format!("FFmpeg failed to download HLS stream (exit code {status:?})"));
                }
                break;
            }
            Ok(None) => {
                if let Ok(meta) = fs::metadata(&dest) {
                    let len = meta.len();
                    emit_transfer_event(
                        app,
                        "StudioProgress",
                        serde_json::json!({
                            "item_index": item_index,
                            "percent": 50.0,
                            "transferred": len,
                            "total": 0,
                            "phase": "download"
                        }),
                    );
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = fs::remove_file(&dest);
                return Err(format!("FFmpeg process wait error: {e}"));
            }
        }
    }

    let meta = fs::metadata(&dest).map_err(|e| format!("failed to get metadata of downloaded stream: {e}"))?;
    if meta.len() < 1024 {
        let _ = fs::remove_file(&dest);
        return Err("downloaded stream is empty or truncated".into());
    }

    path_policy::assert_safe_transfer_path(dest.to_str().unwrap_or(""))
        .map_err(|e| e.to_string())?;

    tg_log::info(
        BACKEND,
        "download_hls_stream_done",
        format!("HLS download complete: {} bytes, dest='{}'", meta.len(), dest.display()),
    );

    Ok(dest)
}

/// Download remote URL to a temp file under path policy (max up to 4GB Telegram limit).
pub fn download_remote_url(
    url: &str,
    app: Option<&tauri::AppHandle>,
    item_index: usize,
) -> Result<PathBuf, String> {
    let url_str = url.trim();
    if !is_remote_url(url_str) {
        return Err("not a remote URL".into());
    }

    let resolved_url = resolve_social_media_direct_url(url_str)
        .or_else(|| resolve_pikpak_direct_url(url_str))
        .unwrap_or_else(|| url_str.to_string());
    let url = resolved_url.as_str();

    if is_hls_stream_url(url) {
        if let Ok(path) = download_hls_stream_ffmpeg(url, app, item_index) {
            return Ok(path);
        }
    }

    tg_log::info(
        BACKEND,
        "remote_download_start",
        url.chars().take(120).collect::<String>(),
    );

    let agent = create_resilient_http_agent();

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

    if content_type.to_lowercase().contains("mpegurl") {
        return download_hls_stream_ffmpeg(url, app, item_index);
    }

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
    let mut is_first_chunk = true;

    loop {
        if crate::core::job_queue::is_any_transfer_cancelled() {
            let _ = fs::remove_file(&dest);
            return Err("download cancelled by user".into());
        }
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("read body: {e}"))?;
        if n == 0 {
            break;
        }

        if is_first_chunk {
            is_first_chunk = false;
            if buf[..n].starts_with(b"#EXTM3U") {
                drop(file);
                let _ = fs::remove_file(&dest);
                return download_hls_stream_ffmpeg(url, app, item_index);
            }
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

    let detected_ext = if ext == "bin" || ext.is_empty() {
        if let Some(sniffed) = sniff_actual_media_extension(&dest) {
            sniffed.to_string()
        } else {
            let (w, h, _) = probe_video_metadata(dest.to_str().unwrap_or(""));
            if w > 0 && h > 0 {
                "mp4".to_string()
            } else {
                let (dur, _, _) = probe_audio_metadata(dest.to_str().unwrap_or(""));
                if dur > 0.0 {
                    "mp3".to_string()
                } else {
                    ext
                }
            }
        }
    } else {
        ext
    };

    let final_dest = if detected_ext != "bin"
        && !dest
            .to_string_lossy()
            .ends_with(&format!(".{detected_ext}"))
    {
        let new_dest = unique_name("remote", &detected_ext);
        if fs::rename(&dest, &new_dest).is_ok() {
            new_dest
        } else {
            dest
        }
    } else {
        dest
    };

    path_policy::assert_safe_transfer_path(final_dest.to_str().unwrap_or(""))
        .map_err(|e| e.to_string())?;
    tg_log::info(
        BACKEND,
        "remote_download_ok",
        format!("bytes={written} path={}", final_dest.display()),
    );
    Ok(final_dest)
}

/// Materialize a YouTube/DASH adaptive pair into one local playable file.
///
/// Resolver output deliberately contains the original signed URLs instead of
/// inventing a browser URL. This function is the only place that turns the
/// verified `video-only + audio-only` pair into a container suitable for
/// Telegram and normal media players. The video stream is copied losslessly;
/// audio is encoded to the target container's broadly supported codec (AAC for
/// MP4, Opus for WebM). Temporary inputs are always removed on success, error,
/// or cancellation.
pub fn download_and_mux_remote(
    video_url: &str,
    audio_url: &str,
    output_ext: &str,
    app: Option<&tauri::AppHandle>,
    item_index: usize,
) -> Result<PathBuf, String> {
    let video_url = video_url.trim();
    let audio_url = audio_url.trim();
    if !is_remote_url(video_url) || !is_remote_url(audio_url) {
        return Err("mux source URLs must use http or https".into());
    }
    crate::core::remote_link_resolver::ensure_public_remote_url(video_url)?;
    crate::core::remote_link_resolver::ensure_public_remote_url(audio_url)?;

    let output_ext = match output_ext.trim().to_ascii_lowercase().as_str() {
        "mp4" => "mp4",
        "webm" => "webm",
        "mkv" => "mkv",
        _ => return Err("unsupported mux output container".into()),
    };

    // Fail before downloading either adaptive stream when the bundled/custom
    // FFmpeg binary is unavailable. This avoids wasting the user's bandwidth
    // on inputs that cannot be combined locally.
    let ffmpeg = find_ffmpeg_binary()
        .ok_or_else(|| "FFmpeg binary not found; cannot combine adaptive video and audio".to_string())?;

    emit_transfer_event(
        app,
        "StudioProgress",
        serde_json::json!({
            "item_index": item_index,
            "percent": 1.0,
            "transferred": 0,
            "total": 0,
            "phase": "mux_prepare"
        }),
    );

    let video_path = match download_remote_url(video_url, app, item_index) {
        Ok(path) => path,
        Err(error) => return Err(format!("video-only download failed: {error}")),
    };
    let audio_path = match download_remote_url(audio_url, app, item_index) {
        Ok(path) => path,
        Err(error) => {
            let _ = fs::remove_file(&video_path);
            return Err(format!("audio-only download failed: {error}"));
        }
    };

    let output_path = unique_name("youtube_mux", output_ext);
    let mut command = Command::new(&ffmpeg);
    command.args(["-y", "-nostdin", "-hide_banner", "-loglevel", "error"]);
    command.args(["-i", video_path.to_string_lossy().as_ref()]);
    command.args(["-i", audio_path.to_string_lossy().as_ref()]);
    command.args(["-map", "0:v:0", "-map", "1:a:0"]);
    command.args(["-c:v", "copy"]);
    if output_ext == "webm" {
        command.args(["-c:a", "libopus", "-b:a", "160k"]);
    } else if output_ext == "mp4" {
        // AAC keeps MP4 playable in WebView2, Telegram clients, and common
        // desktop/mobile players even when the selected companion is Opus.
        command.args(["-c:a", "aac", "-b:a", "192k"]);
        command.args(["-movflags", "+faststart"]);
    } else {
        command.args(["-c:a", "copy"]);
    }
    command.args(["-shortest", output_path.to_string_lossy().as_ref()]);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    emit_transfer_event(
        app,
        "StudioProgress",
        serde_json::json!({
            "item_index": item_index,
            "percent": 75.0,
            "transferred": 0,
            "total": 0,
            "phase": "mux"
        }),
    );

    use std::process::Stdio;
    command.stdout(Stdio::null()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| {
            let _ = fs::remove_file(&video_path);
            let _ = fs::remove_file(&audio_path);
            format!("failed to start FFmpeg mux: {error}")
        })?;
    loop {
        if crate::core::job_queue::is_any_transfer_cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_file(&video_path);
            let _ = fs::remove_file(&audio_path);
            let _ = fs::remove_file(&output_path);
            return Err("adaptive mux cancelled by user".into());
        }
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(250)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_file(&video_path);
                let _ = fs::remove_file(&audio_path);
                let _ = fs::remove_file(&output_path);
                return Err(format!("FFmpeg mux wait failed: {error}"));
            }
        }
    }
    let result = child.wait_with_output();
    let _ = fs::remove_file(&video_path);
    let _ = fs::remove_file(&audio_path);
    let output = match result {
        Ok(output) if output.status.success() => output,
        Ok(output) => {
            let _ = fs::remove_file(&output_path);
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("FFmpeg mux failed: {}", stderr.trim()));
        }
        Err(error) => {
            let _ = fs::remove_file(&output_path);
            return Err(format!("failed to start FFmpeg mux: {error}"));
        }
    };

    let size = fs::metadata(&output_path)
        .map(|meta| meta.len())
        .map_err(|error| {
            let _ = fs::remove_file(&output_path);
            format!("mux output metadata failed: {error}")
        })?;
    if size < 1024 {
        let _ = fs::remove_file(&output_path);
        return Err("FFmpeg mux produced an empty or truncated output".into());
    }
    let (width, height, duration) = probe_video_metadata(output_path.to_string_lossy().as_ref());
    if width == 0 || height == 0 || duration <= 0.0 {
        let _ = fs::remove_file(&output_path);
        return Err("FFmpeg mux output failed media validation".into());
    }
    path_policy::assert_safe_transfer_path(output_path.to_string_lossy().as_ref())
        .map_err(|error| {
            let _ = fs::remove_file(&output_path);
            error.to_string()
        })?;

    let _ = output;
    emit_transfer_event(
        app,
        "StudioProgress",
        serde_json::json!({
            "item_index": item_index,
            "percent": 100.0,
            "transferred": size,
            "total": size,
            "phase": "mux_done"
        }),
    );
    Ok(output_path)
}

/// Downloads a remote thumbnail image (e.g. from Twitter/TikTok/YouTube) into a temporary JPG file.
pub fn download_remote_thumbnail(thumb_url: &str) -> Option<PathBuf> {
    let thumb_url = thumb_url.trim();
    if thumb_url.is_empty() || !(thumb_url.starts_with("http://") || thumb_url.starts_with("https://")) {
        return None;
    }
    let agent = create_resilient_http_agent();
    let mut req = agent.get(thumb_url);
    req = req.set(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 AutoGram/4.0",
    );
    req = req.set("Accept", "image/*,*/*");
    if thumb_url.contains("twimg.com") || thumb_url.contains("x.com") || thumb_url.contains("twitter.com") {
        req = req.set("Referer", "https://x.com/");
    } else if thumb_url.contains("pixiv.net") || thumb_url.contains("pximg.net") {
        req = req.set("Referer", "https://www.pixiv.net/");
    } else if thumb_url.contains("tiktok.com") || thumb_url.contains("tikwm.com") {
        req = req.set("Referer", "https://www.tiktok.com/");
    }
    let resp = req.call().ok()?;
    let dest = unique_name("remote_thumb", "jpg");
    use std::io::{Read, Write};
    let mut reader = resp.into_reader();
    let mut file = fs::File::create(&dest).ok()?;
    let mut buf = [0u8; 16 * 1024];
    let mut total_read = 0usize;
    while let Ok(n) = reader.read(&mut buf) {
        if n == 0 {
            break;
        }
        total_read += n;
        if total_read > 5 * 1024 * 1024 {
            break;
        }
        if file.write_all(&buf[..n]).is_err() {
            let _ = fs::remove_file(&dest);
            return None;
        }
    }
    if total_read > 32 {
        Some(dest)
    } else {
        let _ = fs::remove_file(&dest);
        None
    }
}

fn sniff_actual_media_extension(path: &Path) -> Option<&'static str> {
    if let Ok(mut file) = fs::File::open(path) {
        use std::io::Read;
        let mut magic = [0u8; 64];
        if let Ok(n) = file.read(&mut magic) {
            if n >= 4 {
                // JPEG
                if magic.starts_with(&[0xFF, 0xD8, 0xFF]) {
                    return Some("jpg");
                }
                // PNG
                if magic.starts_with(&[0x89, b'P', b'N', b'G']) {
                    return Some("png");
                }
                // GIF
                if magic.starts_with(b"GIF87a") || magic.starts_with(b"GIF89a") {
                    return Some("gif");
                }
                // WEBP / RIFF
                if n >= 12 && magic.starts_with(b"RIFF") && &magic[8..12] == b"WEBP" {
                    return Some("webp");
                }
                // WAV / RIFF
                if n >= 12 && magic.starts_with(b"RIFF") && &magic[8..12] == b"WAVE" {
                    return Some("wav");
                }
                // AVI / RIFF
                if n >= 12 && magic.starts_with(b"RIFF") && &magic[8..12] == b"AVI " {
                    return Some("avi");
                }
                // BMP
                if magic.starts_with(b"BM") {
                    return Some("bmp");
                }
                // TIFF (Little Endian / Big Endian)
                if magic.starts_with(b"II*\0") || magic.starts_with(b"MM\0*") {
                    return Some("tiff");
                }
                // Photoshop PSD
                if magic.starts_with(b"8BPS") {
                    return Some("psd");
                }
                // MP4 / MOV / M4V / 3GP / HEIC / AVIF / M4A (ftyp / moov / mdat)
                if (n >= 8 && &magic[4..8] == b"ftyp")
                    || (n >= 8 && &magic[4..8] == b"moov")
                    || (n >= 8 && &magic[4..8] == b"mdat")
                    || magic.starts_with(b"ftyp")
                    || magic.starts_with(b"moov")
                {
                    if n >= 12 && &magic[4..8] == b"ftyp" {
                        let brand = &magic[8..12];
                        if brand == b"heic"
                            || brand == b"heix"
                            || brand == b"hevc"
                            || brand == b"heim"
                            || brand == b"heis"
                            || brand == b"mif1"
                            || brand == b"msf1"
                        {
                            return Some("heic");
                        }
                        if brand == b"avif" || brand == b"avis" {
                            return Some("avif");
                        }
                        if brand == b"M4A " || brand == b"M4B " || brand == b"F4A " {
                            return Some("m4a");
                        }
                    }
                    return Some("mp4");
                }
                // Matroska / WebM
                if magic.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
                    return Some("mp4");
                }
                // MP3 (ID3 or sync frame)
                if magic.starts_with(b"ID3") || (magic[0] == 0xFF && (magic[1] & 0xE0) == 0xE0) {
                    return Some("mp3");
                }
                // AAC (ADTS)
                if magic[0] == 0xFF && (magic[1] & 0xF6) == 0xF0 {
                    return Some("aac");
                }
                // FLAC
                if magic.starts_with(b"fLaC") {
                    return Some("flac");
                }
                // AIFF
                if magic.starts_with(b"FORM") && n >= 12 && &magic[8..12] == b"AIFF" {
                    return Some("aiff");
                }
                // OGG / Opus / Vorbis
                if magic.starts_with(b"OggS") {
                    return Some("ogg");
                }
                // PDF
                if magic.starts_with(b"%PDF") {
                    return Some("pdf");
                }
                // 7-Zip
                if magic.starts_with(&[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]) {
                    return Some("7z");
                }
                // RAR
                if magic.starts_with(b"Rar!\x1a\x07\x00")
                    || magic.starts_with(b"Rar!\x1a\x07\x01\x00")
                {
                    return Some("rar");
                }
                // GZIP
                if magic.starts_with(&[0x1F, 0x8B]) {
                    return Some("gz");
                }
                // XZ
                if magic.starts_with(&[0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00]) {
                    return Some("xz");
                }
                // BZIP2
                if magic.starts_with(b"BZh") {
                    return Some("bz2");
                }
                // Zstandard
                if magic.starts_with(&[0x28, 0xB5, 0x2F, 0xFD]) {
                    return Some("zst");
                }
                // ZIP
                if magic.starts_with(&[0x50, 0x4B, 0x03, 0x04]) {
                    return Some("zip");
                }
            }
        }
    }
    None
}

fn ext_from_url_or_ctype(url: &str, ctype: &str) -> String {
    let u_lower = url.to_ascii_lowercase();
    if u_lower.contains("photomode-image") || u_lower.contains(".jpeg") || u_lower.contains(".jpg")
    {
        return "jpg".into();
    }
    if u_lower.contains("ies-music") || u_lower.contains("/music/") {
        return "mp3".into();
    }
    if u_lower.contains(".png") {
        return "png".into();
    }
    if u_lower.contains(".webp") {
        return "webp".into();
    }
    if u_lower.contains(".mp4") {
        return "mp4".into();
    }

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
    if c.contains("mp4") || c.contains("video_mp4") || c.contains("quicktime") {
        return "mp4".into();
    }
    if c.contains("webm") {
        return "webm".into();
    }
    if c.contains("gif") {
        return "gif".into();
    }
    if c.contains("audio/mpeg") || c.contains("audio/mp3") || c.contains("audio/aac") {
        return "mp3".into();
    }
    if c.contains("pdf") {
        return "pdf".into();
    }
    if c.contains("zip") {
        return "zip".into();
    }
    "bin".into()
}
