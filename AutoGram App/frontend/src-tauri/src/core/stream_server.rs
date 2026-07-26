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
    /// Set to true while an independent MOOV tail-fetch task is running or completed.
    /// When true, UI treats moov as ready so playback can start without waiting for MOOV in prefix.
    #[serde(default)]
    pub moov_tail_fetching: bool,
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
    pub moov_tail_fetching: bool,
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

pub fn filled_bytes(ranges: &[(u64, u64)]) -> u64 {
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
        // Scan edges of available range islands (up to 8 MB) to detect MOOV atom on large MP4 videos.
        let len = (end - start).min(8 * 1024 * 1024) as usize;
        let mut buf = vec![0u8; len];
        if file.seek(SeekFrom::Start(start)).is_ok() {
            if let Ok(n) = file.read(&mut buf) {
                if buf[..n].windows(4).any(|w| w == atom) {
                    return true;
                }
            }
        }
        if end - start > 8 * 1024 * 1024 {
            let tail_start = end.saturating_sub(8 * 1024 * 1024);
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

    // Inherit moov_ready_cached from the existing live entry so the cache is
    // never lost between fill-loop iterations.  Every chunk update rebuilds a
    // fresh StreamEntry literal with moov_ready_cached: false, so without this
    // inheritance the cache resets on every call — making it useless.
    if !entry.moov_ready_cached {
        if let Some(existing) = live_map().read().get(&entry.stream_id).cloned() {
            if existing.moov_ready_cached {
                entry.moov_ready_cached = true;
            }
            // Also inherit moov_tail_fetching so the flag isn't reset by fill-loop upserts.
            if existing.moov_tail_fetching && !entry.moov_tail_fetching {
                entry.moov_tail_fetching = true;
            }
        }
    }

    // If still not cached, scan now (once per upsert until found).
    // Non-MP4 or completed files are always ready.
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
            moov_tail_fetching: false,
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
            // Also treat as ready when tail-fetch task is in progress (MOOV will arrive from end).
            let moov_ready = !is_mp4_entry(&e) || e.done || e.moov_ready_cached || e.moov_tail_fetching;
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
                moov_tail_fetching: e.moov_tail_fetching,
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

/// BUG-1 FIX: Attempt to recover a stream session from an orphaned .partial
/// file in the preview cache when the in-memory / disk registry entry is gone.
/// Pattern: stream_id like "g42794-945520-59436" → preview/{sid}.partial
fn try_recover_partial(sid: &str) -> Option<StreamEntry> {
    let registry_dir = REGISTRY_DIR.get()?;
    // preview cache sits one level above the registry dir (e.g. …/cache/registry → …/cache/preview)
    let preview_dir = registry_dir.parent().unwrap_or(registry_dir).join("preview");
    let partial_path = preview_dir.join(format!("{sid}.partial"));
    if !partial_path.is_file() {
        return None;
    }
    let size = fs::metadata(&partial_path).ok()?.len();
    if size == 0 {
        return None;
    }
    // Infer mime from stream_id label portion ("ag_zip_upload_…sound_document…mp4" → video/mp4)
    let mime = if sid.to_ascii_lowercase().ends_with("mp4") {
        "video/mp4"
    } else {
        "application/octet-stream"
    }
    .to_string();
    let entry = StreamEntry {
        stream_id: sid.to_string(),
        path: partial_path.to_string_lossy().into_owned(),
        total_size: size,
        mime,
        label: format!("{sid}.partial"),
        done: false,
        ranges: vec![(0, size)], // treat all downloaded bytes as contiguous
        cancelled: false,
        error: None,
        paused: false,
        updated_at_ms: now_ms(),
        moov_ready_cached: false, // will be detected on first upsert
        moov_tail_fetching: false,
    };
    let entry = upsert_entry(entry);
    log::info!("[stream_server] auto-recovered session '{sid}' from .partial ({size}B)");
    Some(entry)
}

fn handle_stream(request: Request, sid: &str) {
    let mut entry = match get_entry(sid) {
        Some(e) if !e.cancelled => e,
        Some(e) if e.cancelled => {
            // If entry was marked cancelled but file on disk exists and has data,
            // allow serving existing bytes (or recover if whole partial is usable)
            let p = PathBuf::from(&e.path);
            if p.is_file() && fs::metadata(&p).map(|m| m.len()).unwrap_or(0) > 0 {
                e
            } else {
                match try_recover_partial(sid) {
                    Some(recovered) => recovered,
                    None => {
                        let mut res = Response::from_string("Stream cancelled").with_status_code(StatusCode(410));
                        for h in cors_headers() {
                            res.add_header(h);
                        }
                        let _ = request.respond(res);
                        return;
                    }
                }
            }
        }
        _ => {
            // BUG-1 FIX: Before giving up with 404, try recovering from orphaned .partial
            match try_recover_partial(sid) {
                Some(recovered) => recovered,
                None => {
                    let mut res = Response::from_string("Stream expired").with_status_code(StatusCode(404));
                    for h in cors_headers() {
                        res.add_header(h);
                    }
                    let _ = request.respond(res);
                    return;
                }
            }
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

        // Require at least 128 KiB (or remaining total) before serving Range when download is in progress.
        // Returning micro-chunks (e.g. 12 bytes) closes HTTP 206 responses prematurely, causing
        // Chromium's demuxer to freeze while video.paused remains false.
        let min_chunk: u64 = if total > start {
            (128 * 1024).min(total - start)
        } else {
            1
        };
        let want_end = (start + min_chunk).min(total);

        if have_end < want_end && !entry.done {
            // Tell the Grammers fill loop to jump here before we wait. This is
            // the critical path for scrub/seek on a partially downloaded file.
            let _ = super::grammers_media::request_progressive_range(sid, start);
            // Auto-resume download if it was paused by a browser pause event
            if entry.paused {
                entry.paused = false;
                upsert_entry(entry.clone());
            }

            // Wait up to 45 seconds (with fast 30ms ticks) for Telegram download to reach want_end
            let mut waited = 0;
            while waited < 45000 {
                let r = if entry.ranges.is_empty() {
                    vec![]
                } else {
                    entry.ranges.clone()
                };
                let have = contiguous_end_from(&r, start);
                if have >= want_end || have >= start + 65536 || entry.done {
                    have_end = have;
                    break;
                }
                thread::sleep(Duration::from_millis(30));
                waited += 30;
                if let Some(updated) = get_entry(sid) {
                    entry = updated;
                } else {
                    break;
                }
            }

            if have_end <= start && !entry.done {
                if start >= total {
                    // RFC 7233 Sec 4.4: 416 Range Not Satisfiable is for start >= total
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
                // Data still buffering for start < total — Return 503 Service Unavailable
                // so Chromium media engine retries cleanly without corrupting its demuxer with 1 byte responses.
                let mut res = Response::from_string("Media range still buffering")
                    .with_status_code(StatusCode(503));
                for h in cors_headers() {
                    res.add_header(h);
                }
                if let Ok(h) = Header::from_bytes(&b"Retry-After"[..], b"1") {
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
        let mut end = if !entry.done {
            solid_end
        } else {
            total
        };
        if let Some(requested_end) = re {
            let req_end = requested_end + 1;
            if req_end > solid_end {
                end = solid_end;
            } else {
                end = solid_end.min(req_end.max(solid_end.min(start + 16 * 1024 * 1024)));
            }
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
        // Non-Range GET request: RFC 7233 Sec 4.1 forbids sending 206 Partial Content
        // unless Range header was provided in request. Returning 206 without Range causes
        // Chromium MEDIA_ELEMENT_ERROR: Format error (Code 4).
        // Return 200 OK with available bytes + Accept-Ranges header so player can probe & Range seek.
        // IMPORTANT: Use total size as Content-Length (not prefix) for non-faststart MP4 files,
        // so Chromium media engine knows the full file size and will issue a Range request to
        // the MOOV tail. Without this, browser thinks file = prefix bytes and can't seek to MOOV.
        let solid = if entry.done { total } else { prefix.max(1).min(total.max(1)) };
        (0, solid.saturating_sub(1), 200)
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

    let out_len = out.len();
    let mut res = Response::from_data(out)
        .with_status_code(StatusCode(status))
        .with_chunked_threshold(usize::MAX);
    for h in cors_headers() {
        res.add_header(h);
    }
    if let Ok(h) = Header::from_bytes(&b"Content-Type"[..], mime.as_bytes()) {
        res.add_header(h);
    }
    // For non-Range 200 response: advertise total file size so browser's media engine
    // knows the true file length and can issue a Range request to seek to MOOV at tail.
    // For 206 Range response: use actual out_len (bytes being sent).
    let cl_val = if status == 200 && !entry.done && total > out_len as u64 {
        format!("{total}")
    } else {
        format!("{out_len}")
    };
    if let Ok(h) = Header::from_bytes(&b"Content-Length"[..], cl_val.as_bytes()) {
        res.add_header(h);
    }
    res.add_header(Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap());
    if status == 206 {
        let actual_end = if out_len > 0 { start + out_len as u64 - 1 } else { start };
        let cr = format!("bytes {start}-{actual_end}/{total}");
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
                        if e.cancelled && action == "resume" {
                            // Sesi dibatalkan — kembalikan 410 Gone agar frontend force re-RPC stream baru
                            let body = r#"{"ok":false,"reason":"cancelled","action":"re_rpc"}"#;
                            let mut res = Response::from_string(body).with_status_code(StatusCode(410));
                            for h in cors_headers() {
                                res.add_header(h);
                            }
                            let _ = request.respond(res);
                            return;
                        }
                        e.paused = action == "pause";
                        upsert_entry(e);
                        let mut res = Response::from_string(action).with_status_code(StatusCode(200));
                        for h in cors_headers() {
                            res.add_header(h);
                        }
                        let _ = request.respond(res);
                        return;
                    } else if action == "resume" {
                        // BUG-2 FIX: Session expired — return 410 Gone so frontend knows to
                        // force a full re-RPC (tg_preview_stream) instead of looping forever.
                        let body = r#"{"ok":false,"reason":"expired","action":"re_rpc"}"#;
                        let mut res = Response::from_string(body).with_status_code(StatusCode(410));
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
        moov_tail_fetching: false,
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
