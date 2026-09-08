use super::*;
use std::{io::{Read, Write}, net::TcpListener, sync::atomic::AtomicBool, time::Instant};

fn job() -> Arc<Job> {
    Arc::new(Job { control: AtomicU8::new(0), snapshot: Mutex::new(Snapshot {
        id: "fixture".into(), filename: "fixture.bin".into(), directory: String::new(),
        state: "downloading".into(), phase: "download".into(), downloaded: 0, total: 0, output_bytes: 0, error: None,
    }) })
}
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!("autogram-local-test-{}-{}-{}", std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(), SEQ.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir(&dir).unwrap();
        Self(dir)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        // Test-created directory only, never a user-provided path.
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct Server {
    url: String, stopped: Arc<AtomicBool>, handle: Option<std::thread::JoinHandle<()>>,
    requests: Arc<Mutex<Vec<String>>>,
}
impl Drop for Server {
    fn drop(&mut self) { self.stopped.store(true, Ordering::Relaxed); if let Some(h) = self.handle.take() { h.join().unwrap(); } }
}
fn server(data: Arc<Vec<u8>>, mode: &'static str, slow: bool) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/video", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();
    let stopped = Arc::new(AtomicBool::new(false));
    let requests = Arc::new(Mutex::new(Vec::new()));
    let captured = requests.clone();
    let truncated_once = Arc::new(AtomicBool::new(false));
    let stop = stopped.clone();
    let handle = std::thread::spawn(move || {
        let mut workers = Vec::new();
        while !stop.load(Ordering::Relaxed) {
            let (mut stream, _) = match listener.accept() {
                Ok(s) => s, Err(_) => { std::thread::sleep(Duration::from_millis(5)); continue; }
            };
            let data = data.clone();
            let captured = captured.clone();
            let truncated_once = truncated_once.clone();
            workers.push(std::thread::spawn(move || {
                // Windows accepted sockets inherit the listener's nonblocking mode.
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                stream.set_write_timeout(Some(Duration::from_secs(2))).unwrap();
                let mut request = Vec::new();
                let mut byte = [0];
                while request.len() < 10000 {
                    if stream.read(&mut byte).unwrap_or(0) == 0 { return; }
                    request.push(byte[0]);
                    if request.ends_with(b"\r\n\r\n") { break; }
                }
                let request = String::from_utf8_lossy(&request).into_owned();
                captured.lock().unwrap().push(request.clone());
                if mode == "redirect_retry" && request.starts_with("GET /video ") {
                    let _ = stream.write_all(b"HTTP/1.1 302 Found\r\nLocation: /file\r\nSet-Cookie: secret=must-not-forward\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    return;
                }
                let request = request.to_lowercase();
                let range = request.lines().find_map(|line| line.strip_prefix("range: bytes="))
                    .and_then(|r| r.split_once('-')).map(|(s,e)| (s.parse::<usize>().unwrap(), e.parse::<usize>().unwrap()));
                let (start, end) = if mode == "ignore" { (0, data.len()-1) } else { range.unwrap_or((0,data.len()-1)) };
                let code = if mode == "ignore" { "200 OK" } else { "206 Partial Content" };
                let start_header = if mode == "bad_range" && end > 0 { start + 1 } else { start };
                let mime = if mode == "manifest" { "application/vnd.apple.mpegurl" } else { "application/octet-stream" };
                let header = format!("HTTP/1.1 {code}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nContent-Range: bytes {start_header}-{end}/{}\r\nETag: \"fixture\"\r\nConnection: close\r\n\r\n", end-start+1, data.len());
                if stream.write_all(header.as_bytes()).is_err() { return; }
                let truncate = mode == "truncate" || (mode == "redirect_retry" && end > start
                    && !truncated_once.swap(true, Ordering::SeqCst));
                let body_end = if truncate && end > start { start + (end-start)/2 } else { end };
                for chunk in data[start..=body_end].chunks(16384) {
                    if stream.write_all(chunk).is_err() { break; }
                    if slow { std::thread::sleep(Duration::from_millis(10)); }
                }
                let _ = stream.shutdown(std::net::Shutdown::Write);
            }));
        }
        for worker in workers { worker.join().unwrap(); }
    });
    Server { url, stopped, handle: Some(handle), requests }
}

fn payload() -> Arc<Vec<u8>> { Arc::new((0..9*1024*1024+123).map(|n| (n % 251) as u8).collect()) }

#[test]
fn parallel_ranges_preserve_every_byte_and_ignore_range_fallback() {
    let data = payload();
    for mode in ["ranges", "ignore"] {
        let server = server(data.clone(), mode, false);
        let temp = Temp::new();
        let output = temp.0.join("file.part");
        let job = job();
        http::download(&server.url, &output, 4, &job, None).unwrap_or_else(|e| panic!("mode={mode}, error={e}, bytes={}", job.snapshot.lock().unwrap().downloaded));
        assert_eq!(std::fs::read(&output).unwrap(), *data);
        assert_eq!(job.snapshot.lock().unwrap().downloaded, data.len() as u64);
    }
}

#[test]
fn rejects_invalid_ranges_manifests_and_truncated_data() {
    for mode in ["bad_range", "manifest", "truncate"] {
        let server = server(Arc::new(vec![42; 20000]), mode, false);
        let temp = Temp::new();
        assert!(http::download(&server.url, &temp.0.join("file.part"), 4, &job(), None).is_err(), "{mode}");
    }
}

#[test]
fn pause_freezes_progress_resume_completes_and_cancel_is_job_scoped() {
    let data = payload();
    let server = server(data.clone(), "ranges", true);
    let temp = Temp::new();
    let first = job();
    let output = temp.0.join("file.part");
    std::thread::scope(|scope| {
        let running = scope.spawn(|| http::download(&server.url, &output, 4, &first, None));
        let deadline = Instant::now() + Duration::from_secs(10);
        while first.snapshot.lock().unwrap().downloaded == 0 { assert!(Instant::now() < deadline); std::thread::sleep(Duration::from_millis(10)); }
        first.control.store(1, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(100));
        let frozen = first.snapshot.lock().unwrap().downloaded;
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(first.snapshot.lock().unwrap().downloaded, frozen);
        first.control.store(0, Ordering::SeqCst);
        running.join().unwrap().unwrap();
    });
    assert_eq!(std::fs::read(output).unwrap(), *data);
    let cancelled = job();
    cancelled.control.store(2, Ordering::SeqCst);
    assert!(http::download(&server.url, &temp.0.join("cancel.part"), 4, &cancelled, None).is_err());
    assert!(first.checkpoint().is_ok());
}

#[test]
fn cancellation_cleans_partial_and_never_publishes() {
    let server = server(payload(), "ranges", true);
    let temp = Temp::new();
    let job = job();
    let request = DownloadRequest { url: server.url.clone(), filename: "result.bin".into(), directory: temp.0.to_string_lossy().into(), connections: Some(4), mux: None, referer: None };
    std::thread::scope(|scope| {
        let running = scope.spawn(|| run(&request, &job));
        let deadline = Instant::now() + Duration::from_secs(10);
        while job.snapshot.lock().unwrap().downloaded == 0 { assert!(Instant::now() < deadline); std::thread::sleep(Duration::from_millis(10)); }
        job.control.store(2, Ordering::SeqCst);
        assert_eq!(running.join().unwrap().unwrap_err(), "remote_download_cancelled");
    });
    assert_eq!(std::fs::read_dir(&temp.0).unwrap().count(), 0);
}

#[test]
fn publication_never_overwrites_and_filename_blocks_traversal() {
    let temp = Temp::new();
    let source = temp.0.join("source");
    let destination = temp.0.join("destination");
    std::fs::write(&source, b"new").unwrap();
    std::fs::write(&destination, b"existing").unwrap();
    assert!(publish::publish(&source, &destination).is_err());
    assert_eq!(std::fs::read(&destination).unwrap(), b"existing");
    std::fs::remove_file(&destination).unwrap();
    publish::publish(&source, &destination).unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"new");
    for name in ["../bad", "C:\\bad", "NUL.mp4", "bad.", ""] { assert!(validate_filename(name).is_err()); }
}

#[test]
fn referer_strips_userinfo_fragment_and_preserves_source_path_query() {
    assert_eq!(http::sanitize_referer("https://user:secret@93.184.216.34/Folder/Source%20Page?Token=AbC&part=2#private").unwrap(),
        "https://93.184.216.34/Folder/Source%20Page?Token=AbC&part=2");
    assert_eq!(http::sanitize_referer("http://93.184.216.34:8080/source").unwrap(),
        "http://93.184.216.34:8080/source");
    assert_eq!(http::sanitize_referer("https://[2606:4700:4700::1111]/source").unwrap(),
        "https://[2606:4700:4700::1111]/source");
}

#[test]
fn referer_rejects_non_public_urls_and_header_injection() {
    for raw in ["", "relative/page", "file:///source", "ftp://93.184.216.34/source", "data:text/plain,source",
        "http://localhost/source", "http://host.local/source", "http://127.0.0.1:80/source",
        "http://10.0.0.1/source", "http://169.254.169.254/source", "http://100.64.0.1/source",
        "http://224.0.0.1/source", "http://[::1]/source", "http://[::ffff:127.0.0.1]/source",
        "http://[fc00::1]/source", "http://[ff02::1]/source",
        "https://93.184.216.34/source\r\nCookie: secret", "https://93.184.216.34/\tpage",
        "https://93.184.216.34/#\0secret"] {
        assert_eq!(http::sanitize_referer(raw).unwrap_err(), "remote_download_invalid_url");
    }
}

#[test]
fn referer_request_contract_accepts_legacy_absent_null_and_explicit_values() {
    let legacy = serde_json::json!({ "url": "https://93.184.216.34/file", "filename": "file.bin", "directory": "unused" });
    let absent: DownloadRequest = serde_json::from_value(legacy.clone()).unwrap();
    assert!(absent.referer.is_none());
    let mut with_referer = legacy;
    with_referer["referer"] = serde_json::Value::Null;
    assert!(serde_json::from_value::<DownloadRequest>(with_referer.clone()).unwrap().referer.is_none());
    with_referer["referer"] = serde_json::json!("https://93.184.216.34/source");
    assert_eq!(serde_json::from_value::<DownloadRequest>(with_referer).unwrap().referer.as_deref(),
        Some("https://93.184.216.34/source"));
}

fn assert_referer_headers(requests: &[String], expected: &str) {
    assert!(!requests.is_empty());
    for request in requests {
        let headers: Vec<_> = request.lines().filter_map(|line| line.split_once(':')).collect();
        let referers: Vec<_> = headers.iter().filter(|(name, _)| name.eq_ignore_ascii_case("referer"))
            .map(|(_, value)| value.trim()).collect();
        assert_eq!(referers, vec![expected]);
        assert!(!headers.iter().any(|(name, _)| ["authorization", "proxy-authorization", "cookie"]
            .iter().any(|forbidden| name.eq_ignore_ascii_case(forbidden))));
    }
}

#[test]
fn source_referer_survives_probe_parallel_ranges_redirects_and_retry_without_credentials() {
    let data = payload();
    let server = server(data.clone(), "redirect_retry", false);
    let temp = Temp::new();
    let request = DownloadRequest {
        url: server.url.clone(), filename: "result.bin".into(), directory: temp.0.to_string_lossy().into(),
        connections: Some(4), mux: None,
        referer: Some("https://user:secret@93.184.216.34/Source/Page?Token=AbC#fragment".into()),
    };
    run(&request, &job()).unwrap();
    assert_eq!(std::fs::read(temp.0.join("result.bin")).unwrap(), *data);
    let requests = server.requests.lock().unwrap();
    assert_referer_headers(&requests, "https://93.184.216.34/Source/Page?Token=AbC");
    // Probe plus three chunks, each redirected; a truncated chunk adds a retry.
    assert!(requests.len() >= 10);
    assert!(requests.iter().any(|r| r.starts_with("GET /file ")));
    assert_eq!(std::fs::read_dir(&temp.0).unwrap().count(), 1);
}

#[test]
fn absent_referer_preserves_origin_default_and_explicit_works_without_ranges() {
    for explicit in [None, Some("https://93.184.216.34/Exact/Source?q=Case")] {
        let data = Arc::new(vec![42; 20000]);
        let server = server(data.clone(), "ignore", false);
        let temp = Temp::new();
        let output = temp.0.join("file.part");
        http::download(&server.url, &output, 4, &job(), explicit).unwrap();
        assert_eq!(std::fs::read(output).unwrap(), *data);
        let default = format!("{}/", url::Url::parse(&server.url).unwrap().origin().ascii_serialization());
        assert_referer_headers(&server.requests.lock().unwrap(), explicit.unwrap_or(&default));
    }
}

#[test]
fn invalid_referer_is_rejected_before_download_network_or_output_creation() {
    let server = server(Arc::new(vec![42; 20]), "ranges", false);
    let temp = Temp::new();
    let output = temp.0.join("file.part");
    assert_eq!(http::download(&server.url, &output, 4, &job(), Some("http://127.0.0.1/source")).unwrap_err(),
        "remote_download_invalid_url");
    assert!(!output.exists());
    assert!(server.requests.lock().unwrap().is_empty());
}

#[test]
fn ffmpeg_2160p_two_stream_output_has_audio_and_preserves_dimensions() {
    let (ffmpeg, _) = mux::binaries().expect("FFmpeg/ffprobe fixture prerequisites");
    let temp = Temp::new();
    let video = temp.0.join("video.webm");
    let audio = temp.0.join("audio.m4a");
    let output = temp.0.join("result.mp4");
    let job = job();
    mux::process(std::process::Command::new(&ffmpeg).args(["-y", "-v", "error", "-f", "lavfi", "-i", "color=blue:s=3840x2160:r=2:d=1", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-an"]).arg(&video), &job).unwrap();
    mux::process(std::process::Command::new(&ffmpeg).args(["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac"]).arg(&audio), &job).unwrap();
    let spec = MuxSpec { video_url: String::new(), audio_url: String::new(), output_ext: "mp4".into(), expected_height: Some(2160), expected_duration_sec: Some(1.0), transcode_video: true };
    mux::assemble(&video, &audio, &output, &spec, &job).unwrap();
    assert!(std::fs::metadata(output).unwrap().len() > 1024);
    let wrong = MuxSpec { expected_height: Some(1080), ..spec };
    assert_eq!(mux::assemble(&video, &audio, &temp.0.join("wrong.mp4"), &wrong, &job).unwrap_err(), "remote_download_wrong_resolution");
}
