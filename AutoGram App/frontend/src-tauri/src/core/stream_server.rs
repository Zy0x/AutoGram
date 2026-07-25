//! Local progressive media HTTP Range server (Rust).
//!
//! Python Telethon only downloads bytes and publishes a registry JSON.
//! Serving Range requests here cuts Python/aiohttp RAM for playback.
//!
//! Dual-path: if registry missing, Python's own aiohttp port still works.

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

static PORT: AtomicU16 = AtomicU16::new(0);
static REGISTRY_DIR: OnceLock<PathBuf> = OnceLock::new();
static LIVE: OnceLock<Arc<RwLock<HashMap<String, StreamEntry>>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEntry {
    pub stream_id: String,
    pub path: String,
    pub total_size: u64,
    pub mime: String,
    pub label: String,
    pub done: bool,
    /// Half-open ranges [start, end)
    pub ranges: Vec<(u64, u64)>,
    pub cancelled: bool,
    pub error: Option<String>,
    #[serde(default)]
    pub paused: bool,
    pub updated_at_ms: u128,
    /// Cached moov atom detection — set once in upsert_entry, never re-scanned on status polls.
    /// Non-MP4 files default to true. MP4 files are scanned once when bytes arrive.
    #[serde(default)]
    pub moov_ready_cached: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamStatusDto {
    pub status: String,
    pub stream_id: String,
    pub path: String,
    pub total: u64,
    pub downloaded: u64,
    pub downloaded_filled: u64,
    pub prefix_bytes: u64,
    pub percent: f64,
    pub done: bool,
    pub mime_type: String,
    pub backend: String,
    pub stream_ready: bool,
    pub moov_ready: bool,
    pub seek_capable: bool,
    pub paused: bool,
    pub error: Option<String>,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn live_map() -> &'static Arc<RwLock<HashMap<String, StreamEntry>>> {
    LIVE.get_or_init(|| Arc::new(RwLock::new(HashMap::new())))
}

#[allow(dead_code)]
pub fn set_registry_dir(dir: PathBuf) {
    let _ = REGISTRY_DIR.set(dir);
}

#[allow(dead_code)]
pub fn registry_dir() -> Option<&'static PathBuf> {
    REGISTRY_DIR.get()
}

pub fn stream_port() -> u16 {
    PORT.load(Ordering::SeqCst)
}

fn merge_ranges(mut ranges: Vec<(u64, u64)>) -> Vec<(u64, u64)> {
    if ranges.is_empty() {
        return ranges;
    }
    ranges.sort_by_key(|r| r.0);
    let mut out = vec![ranges[0]];
    for (s, e) in ranges.into_iter().skip(1) {
        let last = out.last_mut().unwrap();
        if s <= last.1 {
            last.1 = last.1.max(e);
        } else {
            out.push((s, e));
        }
    }
    out
}

fn contiguous_from_zero(ranges: &[(u64, u64)]) -> u64 {
    if ranges.is_empty() || ranges[0].0 > 0 {
        return 0;
    }
    ranges[0].1
}

fn contiguous_end_from(ranges: &[(u64, u64)], start: u64) -> u64 {
    for &(s, e) in ranges {
        if s <= start && start < e {
            return e;
        }
        if s > start {
            break;
        }
    }
    start
}

fn filled_bytes(ranges: &[(u64, u64)]) -> u64 {
    ranges.iter().map(|(s, e)| e.saturating_sub(*s)).sum()
}

fn range_contains_atom(path: &Path, ranges: &[(u64, u64)], atom: &[u8; 4]) -> bool {
    let Ok(mut file) = File::open(path) else {
        return false;
    };
    for &(start, end) in ranges {
        if end <= start {
            continue;
        }
        // Scan only the edges of an available island. MP4 metadata is normally
        // in the head or tail, and status polling must remain bounded.
        let len = (end - start).min(2 * 1024 * 1024) as usize;
        let mut buf = vec![0u8; len];
        if file.seek(SeekFrom::Start(start)).is_ok() {
            if let Ok(n) = file.read(&mut buf) {
                if buf[..n].windows(4).any(|w| w == atom) {
                    return true;
                }
            }
        }
        if end - start > 2 * 1024 * 1024 {
            let tail_start = end.saturating_sub(2 * 1024 * 1024);
            if file.seek(SeekFrom::Start(tail_start)).is_ok() {
                if let Ok(n) = file.read(&mut buf) {
                    if buf[..n].windows(4).any(|w| w == atom) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

fn registry_path(sid: &str) -> Option<PathBuf> {
    REGISTRY_DIR
        .get()
        .map(|d| d.join(format!("{sid}.json")))
}

fn load_entry_disk(sid: &str) -> Option<StreamEntry> {
    let p = registry_path(sid)?;
    let data = fs::read_to_string(p).ok()?;
    serde_json::from_str(&data).ok()
}

fn save_entry_disk(entry: &StreamEntry) {
    if let Some(dir) = REGISTRY_DIR.get() {
        let _ = fs::create_dir_all(dir);
        if let Ok(data) = serde_json::to_string(entry) {
            let p = dir.join(format!("{}.json", entry.stream_id));
            let _ = fs::write(p, data);
        }
    }
}

fn is_mp4_entry(entry: &StreamEntry) -> bool {
    let lower = entry.label.to_ascii_lowercase();
    entry.mime.eq_ignore_ascii_case("video/mp4")
        || entry.mime.eq_ignore_ascii_case("video/quicktime")
        || lower.ends_with(".mp4")
        || lower.ends_with(".m4v")
        || lower.ends_with(".mov")
}

pub fn upsert_entry(mut entry: StreamEntry) -> StreamEntry {
    entry.ranges = merge_ranges(entry.ranges);
    entry.updated_at_ms = now_ms();
    // Cache moov detection ONCE here (not on every status poll).
    // Non-MP4 or completed files are always ready; MP4 is scanned once
    // per upsert until the atom is found — O(1) subsequent polls.
    if !entry.moov_ready_cached && !entry.cancelled {
        if entry.done || !is_mp4_entry(&entry) {
            entry.moov_ready_cached = true;
        } else {
            entry.moov_ready_cached =
                range_contains_atom(Path::new(&entry.path), &entry.ranges, b"moov");
        }
    }
    save_entry_disk(&entry);
    live_map()
        .write()
        .insert(entry.stream_id.clone(), entry.clone());
    entry
}

pub fn get_entry(sid: &str) -> Option<StreamEntry> {
    if let Some(e) = live_map().read().get(sid).cloned() {
        return Some(e);
    }
    if let Some(e) = load_entry_disk(sid) {
        live_map().write().insert(sid.to_string(), e.clone());
        return Some(e);
    }
    None
}

pub fn remove_entry(sid: &str) {
    live_map().write().remove(sid);
    if let Some(p) = registry_path(sid) {
        let _ = fs::remove_file(p);
    }
}

pub fn status_of(sid: &str) -> StreamStatusDto {
    match get_entry(sid) {
        None => StreamStatusDto {
            status: "missing".into(),
            stream_id: sid.into(),
            path: String::new(),
            total: 0,
            downloaded: 0,
            downloaded_filled: 0,
            prefix_bytes: 0,
            percent: 0.0,
            done: false,
            mime_type: String::new(),
            backend: "rust".into(),
            stream_ready: false,
            moov_ready: false,
            seek_capable: false,
            paused: false,
            error: None,
        },
        Some(e) => {
            let prefix = contiguous_from_zero(&e.ranges);
            let filled = filled_bytes(&e.ranges);
            let total = e.total_size;
            let pct = if total > 0 {
                (prefix as f64) * 100.0 / (total as f64)
            } else {
                0.0
            };
            let status = if e.cancelled {
                "cancelled"
            } else if e.error.is_some() {
                "error"
            } else if e.done {
                "done"
            } else {
                "downloading"
            };
            // Align with Python first_play tiers (~96–384 KiB). Too-high thresholds
            // leave UI stuck on "Buffering" while bytes already sit on disk.
            let first_play = super::streaming_policy::first_play_bytes(total);
            // moov_ready is cached by upsert_entry — no disk scan on every poll.
            let moov_ready = !is_mp4_entry(&e) || e.done || e.moov_ready_cached;
            let stream_ready =
                e.done || (prefix >= first_play.min(total.max(1)) && moov_ready);
            StreamStatusDto {
                status: status.into(),
                stream_id: e.stream_id,
                path: e.path,
                total,
                downloaded: prefix,
                downloaded_filled: filled,
                prefix_bytes: prefix,
                percent: (pct * 100.0).round() / 100.0,
                done: e.done,
                mime_type: e.mime,
                backend: "rust".into(),
                stream_ready,
                moov_ready,
                seek_capable: !e.done && !e.cancelled,
                paused: e.paused,
                error: e.error,
            }
        }
    }
}

fn cors_headers() -> Vec<Header> {
    vec![
        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
        Header::from_bytes(
            &b"Access-Control-Allow-Methods"[..],
            &b"GET, HEAD, OPTIONS, POST"[..],
        )
        .unwrap(),
        Header::from_bytes(
            &b"Access-Control-Allow-Headers"[..],
            &b"Range, Content-Type"[..],
        )
        .unwrap(),
        Header::from_bytes(
            &b"Access-Control-Expose-Headers"[..],
            &b"Content-Length, Content-Range, Accept-Ranges, X-AutoGram-Available, X-AutoGram-Filled, X-AutoGram-Backend"[..],
        )
        .unwrap(),
        Header::from_bytes(&b"Cache-Control"[..], &b"no-cache"[..]).unwrap(),
        Header::from_bytes(&b"X-AutoGram-Backend"[..], &b"rust"[..]).unwrap(),
    ]
}

fn parse_stream_id(url: &str) -> Option<String> {
    // /stream/{id} or /stream/{id}/filename
    let path = url.split('?').next().unwrap_or(url);
    let mut parts = path.split('/').filter(|p| !p.is_empty());
    if parts.next()? != "stream" {
        return None;
    }
    parts.next().map(|s| s.to_string())
}

fn parse_range(header: Option<&str>) -> Option<(u64, Option<u64>)> {
    let h = header?;
    if !h.starts_with("bytes=") {
        return None;
    }
    let spec = h[6..].split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    let start: u64 = if a.is_empty() { 0 } else { a.parse().ok()? };
    let end: Option<u64> = if b.is_empty() {
        None
    } else {
        Some(b.parse().ok()?)
    };
    Some((start, end))
}

fn handle_register(mut request: Request) {
    let mut body = String::new();
    let _ = request.as_reader().read_to_string(&mut body);
    match serde_json::from_str::<StreamEntry>(&body) {
        Ok(entry) => {
            let sid = entry.stream_id.clone();
            upsert_entry(entry);
            let mut res = Response::from_string(format!(r#"{{"ok":true,"stream_id":"{sid}"}}"#))
                .with_status_code(StatusCode(200));
            for h in cors_headers() {
                res.add_header(h);
            }
            let _ = request.respond(res);
        }
        Err(e) => {
            let mut res = Response::from_string(format!(r#"{{"ok":false,"error":"{e}"}}"#))
                .with_status_code(StatusCode(400));
            for h in cors_headers() {
                res.add_header(h);
            }
            let _ = request.respond(res);
        }
    }
}

fn handle_stream(request: Request, sid: &str) {
    let mut entry = match get_entry(sid) {
        Some(e) if !e.cancelled => e,
        _ => {
            let mut res = Response::from_string("Stream expired").with_status_code(StatusCode(404));
            for h in cors_headers() {
                res.add_header(h);
            }
            let _ = request.respond(res);
            return;
        }
    };

    let path = PathBuf::from(&entry.path);
    if !path.is_file() {
        let mut res = Response::from_string("File missing").with_status_code(StatusCode(404));
        for h in cors_headers() {
            res.add_header(h);
        }
        let _ = request.respond(res);
        return;
    }

    let range_hdr = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Range") || h.field.equiv("range"))
        .map(|h| h.value.as_str().to_string());

    let req_start = parse_range(range_hdr.as_deref()).map(|(s, _)| s).unwrap_or(0);

    // If stream is still filling, wait briefly for data at requested start
    if !entry.done {
        let mut waited = 0;
        while waited < 1500 {
            let r = if entry.ranges.is_empty() {
                vec![]
            } else {
                entry.ranges.clone()
            };
            let have = contiguous_end_from(&r, req_start);
            if have > req_start || entry.done {
                break;
            }
            thread::sleep(Duration::from_millis(50));
            waited += 50;
            if let Some(updated) = get_entry(sid) {
                entry = updated;
            } else {
                break;
            }
        }
    }

    let total = if entry.total_size > 0 {
        entry.total_size
    } else {
        fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
    };

    let ranges = if entry.done && entry.ranges.is_empty() {
        vec![(0, total)]
    } else {
        entry.ranges.clone()
    };
    let prefix = contiguous_from_zero(&ranges);
    let filled = filled_bytes(&ranges);

    // Default: first solid slice (fast start)
    let (start, end_incl, status) = if let Some((rs, re)) = parse_range(range_hdr.as_deref()) {
        let start = rs;
        let mut have_end = contiguous_end_from(&ranges, start);
        if have_end <= start && !entry.done {
            // Tell the Grammers fill loop to jump here before we wait. This is
            // the critical path for scrub/seek on a partially downloaded file.
            let _ = super::grammers_media::request_progressive_range(sid, start);
            // Auto-resume download if it was paused by a browser pause event
            if entry.paused {
                entry.paused = false;
                upsert_entry(entry.clone());
            }

            // Wait up to 8 seconds for Telegram download to reach start
            let mut waited = 0;
            while waited < 8000 {
                let r = if entry.ranges.is_empty() {
                    vec![]
                } else {
                    entry.ranges.clone()
                };
                let have = contiguous_end_from(&r, start);
                if have > start || entry.done {
                    have_end = have;
                    break;
                }
                thread::sleep(Duration::from_millis(50));
                waited += 50;
                if let Some(updated) = get_entry(sid) {
                    entry = updated;
                } else {
                    break;
                }
            }

            if have_end <= start && !entry.done {
                let mut res = Response::from_string("Range Not Satisfiable")
                    .with_status_code(StatusCode(416));
                for h in cors_headers() {
                    res.add_header(h);
                }
                if let Ok(h) = Header::from_bytes(&b"Content-Range"[..], format!("bytes */{total}").as_bytes()) {
                    res.add_header(h);
                }
                let _ = request.respond(res);
                return;
            }
        }
        let solid_end = if entry.done {
            total
        } else {
            have_end
        };
        let mut end = re.map(|e| e + 1).unwrap_or(solid_end).min(solid_end);
        if end <= start {
            end = (start + 1).min(solid_end.max(start + 1));
        }
        // Progressive stream range chunk size (up to 16 MiB for high speed smooth video buffering)
        if re.is_none() && !entry.done {
            let cap = (start + 16 * 1024 * 1024).min(solid_end);
            end = end.min(cap).max(start.saturating_add(1).min(solid_end));
        }
        if end <= start && solid_end > start {
            end = solid_end;
        }
        if end <= start {
            let mut res = Response::from_string("range not satisfiable")
                .with_status_code(StatusCode(416));
            for h in cors_headers() {
                res.add_header(h);
            }
            let _ = request.respond(res);
            return;
        }
        (start, end - 1, 206)
    } else {
        // Full GET incomplete → 206 solid prefix only
        if !entry.done {
            let solid = prefix.max(1).min(total.max(1));
            (0, solid.saturating_sub(1), 206)
        } else {
            (0, total.saturating_sub(1), 200)
        }
    };

    let length = end_incl.saturating_sub(start).saturating_add(1);
    let mut file = match File::open(&path) {
        Ok(f) => f,
        Err(_) => {
            let mut res = Response::from_string("open failed").with_status_code(StatusCode(500));
            for h in cors_headers() {
                res.add_header(h);
            }
            let _ = request.respond(res);
            return;
        }
    };
    if file.seek(SeekFrom::Start(start)).is_err() {
        let mut res = Response::from_string("seek failed").with_status_code(StatusCode(500));
        for h in cors_headers() {
            res.add_header(h);
        }
        let _ = request.respond(res);
        return;
    }

    let mut buf = vec![0u8; length.min(8 * 1024 * 1024) as usize];
    let mut out = Vec::with_capacity(length as usize);
    let mut remaining = length;
    while remaining > 0 {
        let chunk = remaining.min(buf.len() as u64) as usize;
        match file.read(&mut buf[..chunk]) {
            Ok(0) => break,
            Ok(n) => {
                out.extend_from_slice(&buf[..n]);
                remaining -= n as u64;
            }
            Err(_) => break,
        }
    }

    let mime = if entry.mime.is_empty() {
        "application/octet-stream"
    } else {
        &entry.mime
    };

    let mut res = Response::from_data(out).with_status_code(StatusCode(status));
    for h in cors_headers() {
        res.add_header(h);
    }
    if let Ok(h) = Header::from_bytes(&b"Content-Type"[..], mime.as_bytes()) {
        res.add_header(h);
    }
    res.add_header(Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap());
    if status == 206 {
        let cr = format!("bytes {start}-{end_incl}/{total}");
        if let Ok(h) = Header::from_bytes(&b"Content-Range"[..], cr.as_bytes()) {
            res.add_header(h);
        }
    }
    let avail = format!("{prefix}");
    let fill = format!("{filled}");
    if let Ok(h) = Header::from_bytes(&b"X-AutoGram-Available"[..], avail.as_bytes()) {
        res.add_header(h);
    }
    if let Ok(h) = Header::from_bytes(&b"X-AutoGram-Filled"[..], fill.as_bytes()) {
        res.add_header(h);
    }
    let _ = request.respond(res);
}

fn handle(request: Request) {
    let url = request.url().to_string();
    let method = request.method().clone();

    if method == Method::Options {
        let mut res = Response::empty(StatusCode(204));
        for h in cors_headers() {
            res.add_header(h);
        }
        let _ = request.respond(res);
        return;
    }

    if method == Method::Post && (url == "/register" || url.starts_with("/register?")) {
        handle_register(request);
        return;
    }

    if method == Method::Post && url.starts_with("/unregister/") {
        let sid = url.trim_start_matches("/unregister/").split('?').next().unwrap_or("");
        remove_entry(sid);
        let mut res = Response::from_string(r#"{"ok":true}"#).with_status_code(StatusCode(200));
        for h in cors_headers() {
            res.add_header(h);
        }
        let _ = request.respond(res);
        return;
    }

    // /stream/{id}/pause | /stream/{id}/resume — mirrors Python endpoints for UI
    if method == Method::Post {
        if let Some(rest) = url.strip_prefix("/stream/") {
            let mut parts = rest.split('/').filter(|p| !p.is_empty());
            if let (Some(sid), Some(action)) = (parts.next(), parts.next()) {
                let action = action.split('?').next().unwrap_or(action);
                if action == "pause" || action == "resume" {
                    if let Some(mut e) = get_entry(sid) {
                        e.paused = action == "pause";
                        upsert_entry(e);
                        let mut res = Response::from_string(action).with_status_code(StatusCode(200));
                        for h in cors_headers() {
                            res.add_header(h);
                        }
                        let _ = request.respond(res);
                        return;
                    }
                }
            }
        }
    }

    if (method == Method::Get || method == Method::Head) && url.starts_with("/stream/") {
        if let Some(sid) = parse_stream_id(&url) {
            if method == Method::Head {
                // lightweight status via headers only
                let st = status_of(&sid);
                let mut res = Response::empty(if st.status == "missing" {
                    StatusCode(404)
                } else {
                    StatusCode(200)
                });
                for h in cors_headers() {
                    res.add_header(h);
                }
                let _ = request.respond(res);
                return;
            }
            handle_stream(request, &sid);
            return;
        }
    }

    if method == Method::Get && url.starts_with("/status/") {
        let sid = url.trim_start_matches("/status/").split('?').next().unwrap_or("");
        let st = status_of(sid);
        let body = serde_json::to_string(&st).unwrap_or_else(|_| "{}".into());
        let mut res = Response::from_string(body).with_status_code(StatusCode(200));
        for h in cors_headers() {
            res.add_header(h);
        }
        if let Ok(h) = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]) {
            res.add_header(h);
        }
        let _ = request.respond(res);
        return;
    }

    if method == Method::Get && (url == "/health" || url.starts_with("/health?")) {
        let mut res = Response::from_string(r#"{"ok":true,"backend":"rust"}"#)
            .with_status_code(StatusCode(200));
        for h in cors_headers() {
            res.add_header(h);
        }
        let _ = request.respond(res);
        return;
    }

    let mut res = Response::from_string("not found").with_status_code(StatusCode(404));
    for h in cors_headers() {
        res.add_header(h);
    }
    let _ = request.respond(res);
}

/// Start server on 127.0.0.1:0 (ephemeral). Idempotent.
pub fn ensure_started(registry: PathBuf) -> u16 {
    let current = PORT.load(Ordering::SeqCst);
    if current != 0 {
        return current;
    }
    let _ = REGISTRY_DIR.set(registry);
    let _ = fs::create_dir_all(REGISTRY_DIR.get().unwrap());

    let server = match Server::http("127.0.0.1:0") {
        Ok(s) => s,
        Err(_) => return 0,
    };
    let addr: SocketAddr = server.server_addr().to_ip().unwrap_or_else(|| {
        SocketAddr::from(([127, 0, 0, 1], 0))
    });
    let port = addr.port();
    PORT.store(port, Ordering::SeqCst);

    thread::Builder::new()
        .name("autogram-stream".into())
        .spawn(move || {
            for request in server.incoming_requests() {
                // Range handlers may wait for Telegram bytes. Keep status,
                // resume, and parallel media requests responsive meanwhile.
                let _ = thread::Builder::new()
                    .name("autogram-range".into())
                    .spawn(move || handle(request));
            }
        })
        .ok();

    // Brief wait so bind is visible
    thread::sleep(Duration::from_millis(30));
    port
}

/// Register a complete local file for Range serving; returns stream URL.
pub fn register_local_file(
    path: &str,
    total_size: u64,
    mime: &str,
    label: &str,
) -> Result<(String, String, u16), String> {
    let port = stream_port();
    if port == 0 {
        return Err("stream server not started".into());
    }
    let p = Path::new(path);
    if !p.is_file() {
        return Err("file not found".into());
    }
    let size = if total_size > 0 {
        total_size
    } else {
        fs::metadata(p).map(|m| m.len()).unwrap_or(0)
    };
    let sid = {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut h = DefaultHasher::new();
        path.hash(&mut h);
        now_ms().hash(&mut h);
        format!("{:016x}", h.finish())
    };
    let entry = StreamEntry {
        stream_id: sid.clone(),
        path: p.to_string_lossy().into_owned(),
        total_size: size,
        mime: if mime.is_empty() {
            "application/octet-stream".into()
        } else {
            mime.into()
        },
        label: label.into(),
        done: true,
        ranges: vec![(0, size)],
        cancelled: false,
        error: None,
        paused: false,
        updated_at_ms: now_ms(),
        moov_ready_cached: true, // complete local file — always ready
    };
    upsert_entry(entry);
    let safe = label
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(80)
        .collect::<String>();
    let safe = if safe.is_empty() {
        "media".into()
    } else {
        safe
    };
    let url = format!("http://127.0.0.1:{port}/stream/{sid}/{safe}");
    Ok((sid, url, port))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_and_prefix() {
        let r = merge_ranges(vec![(0, 100), (100, 200), (300, 400)]);
        assert_eq!(r, vec![(0, 200), (300, 400)]);
        assert_eq!(contiguous_from_zero(&r), 200);
        assert_eq!(contiguous_end_from(&r, 300), 400);
    }
}
