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
use std::sync::atomic::{AtomicU16, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

static PORT: AtomicU16 = AtomicU16::new(0);
static REGISTRY_DIR: OnceLock<PathBuf> = OnceLock::new();
static LIVE: OnceLock<Arc<RwLock<HashMap<String, StreamEntry>>>> = OnceLock::new();
static LAST_STREAM_ACTIVITY_MS: AtomicU64 = AtomicU64::new(0);

pub fn record_stream_activity() {
    let now = now_ms() as u64;
    LAST_STREAM_ACTIVITY_MS.store(now, Ordering::Relaxed);
}

pub fn has_active_streams() -> bool {
    let map = live_map().read();
    map.values().any(|entry| {
        !entry.done
            && !entry.cancelled
            && !entry.paused
            && !is_progressive_entry_stalled(entry)
    })
}

pub fn is_streaming_recently_active(within_secs: u64) -> bool {
    let last = LAST_STREAM_ACTIVITY_MS.load(Ordering::Relaxed);
    if last > 0 {
        let now = now_ms() as u64;
        if now.saturating_sub(last) < within_secs * 1000 {
            return true;
        }
    }
    has_active_streams()
}

const HOT_HEAD_MAX_BYTES_PER_STREAM: usize = 2 * 1024 * 1024; // 2 MiB per stream
const HOT_HEAD_MAX_STREAMS: usize = 4; // Max 4 streams = 8 MiB strict memory ceiling
/// A progressive worker that has not committed a byte for this long cannot
/// satisfy a browser Range request anymore.  Keep this deliberately shorter
/// than the HTTP read timeout: the UI can renew the MTProto worker before the
/// player burns through its small startup buffer.
pub const PROGRESSIVE_STREAM_STALL_AFTER_MS: u128 = 12_000;

static HOT_HEAD_CACHE: OnceLock<RwLock<HashMap<String, Arc<Vec<u8>>>>> = OnceLock::new();

fn hot_head_map() -> &'static RwLock<HashMap<String, Arc<Vec<u8>>>> {
    HOT_HEAD_CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

pub fn get_hot_head(sid: &str) -> Option<Arc<Vec<u8>>> {
    hot_head_map().read().get(sid).cloned()
}

pub fn put_hot_head(sid: &str, data: &[u8]) {
    if data.is_empty() {
        return;
    }
    let take_len = data.len().min(HOT_HEAD_MAX_BYTES_PER_STREAM);
    let mut map = hot_head_map().write();
    if map.len() >= HOT_HEAD_MAX_STREAMS && !map.contains_key(sid) {
        if let Some(first_key) = map.keys().next().cloned() {
            map.remove(&first_key);
        }
    }
    map.insert(sid.to_string(), Arc::new(data[..take_len].to_vec()));
}

pub fn remove_hot_head(sid: &str) {
    hot_head_map().write().remove(sid);
}

pub fn clear_hot_head_cache() {
    hot_head_map().write().clear();
}

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
    /// The fill worker has not committed a range recently.  This is distinct
    /// from an explicit error: a fresh preview RPC can preserve the sparse
    /// bytes and reconnect instead of making the user wait for an HTTP timeout.
    pub stalled: bool,
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

pub fn merge_ranges(ranges: &[(u64, u64)]) -> Vec<(u64, u64)> {
    if ranges.is_empty() {
        return vec![];
    }
    let mut sorted = ranges.to_vec();
    sorted.sort_by_key(|r| r.0);
    let mut out = vec![sorted[0]];
    for (s, e) in sorted.into_iter().skip(1) {
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
    let sorted = merge_ranges(ranges);
    for &(s, e) in &sorted {
        if s <= start && start < e {
            return e;
        }
    }
    start
}

pub fn filled_bytes(ranges: &[(u64, u64)]) -> u64 {
    ranges.iter().map(|(s, e)| e.saturating_sub(*s)).sum()
}

/// An incomplete, unpaused entry is only considered live while it is making
/// observable progress.  Telegram sockets can become silently wedged without
/// producing an RPC error, so `done == false` alone is not a liveness signal.
pub fn is_progressive_entry_stalled(entry: &StreamEntry) -> bool {
    !entry.done
        && !entry.cancelled
        && !entry.paused
        && entry.error.is_none()
        && now_ms().saturating_sub(entry.updated_at_ms) > PROGRESSIVE_STREAM_STALL_AFTER_MS
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mp4Layout {
    pub ftyp_offset: Option<u64>,
    pub ftyp_size: Option<u64>,
    pub moov_offset: Option<u64>,
    pub moov_size: Option<u64>,
    pub mdat_offset: Option<u64>,
    pub mdat_size: Option<u64>,
    pub moov_position: String,
}

pub fn inspect_mp4_layout(path: &Path) -> Mp4Layout {
    let mut layout = Mp4Layout {
        ftyp_offset: None,
        ftyp_size: None,
        moov_offset: None,
        moov_size: None,
        mdat_offset: None,
        mdat_size: None,
        moov_position: "unknown".into(),
    };

    let Ok(mut f) = File::open(path) else {
        return layout;
    };
    let Ok(file_len) = f.metadata().map(|m| m.len()) else {
        return layout;
    };

    let mut pos = 0u64;
    let mut header_buf = [0u8; 16];

    while pos < file_len {
        if f.seek(SeekFrom::Start(pos)).is_err() {
            break;
        }
        if f.read_exact(&mut header_buf[..8]).is_err() {
            break;
        }

        let size32 =
            u32::from_be_bytes([header_buf[0], header_buf[1], header_buf[2], header_buf[3]]) as u64;
        let box_type = [header_buf[4], header_buf[5], header_buf[6], header_buf[7]];

        let (header_len, box_size) = if size32 == 1 {
            if f.read_exact(&mut header_buf[8..16]).is_err() {
                break;
            }
            let size64 = u64::from_be_bytes([
                header_buf[8],
                header_buf[9],
                header_buf[10],
                header_buf[11],
                header_buf[12],
                header_buf[13],
                header_buf[14],
                header_buf[15],
            ]);
            (16, size64)
        } else if size32 == 0 {
            (8, file_len.saturating_sub(pos))
        } else {
            (8, size32)
        };

        if box_size < header_len {
            break;
        }

        match &box_type {
            b"ftyp" => {
                layout.ftyp_offset = Some(pos);
                layout.ftyp_size = Some(box_size);
            }
            b"moov" => {
                layout.moov_offset = Some(pos);
                layout.moov_size = Some(box_size);
            }
            b"mdat" => {
                layout.mdat_offset = Some(pos);
                layout.mdat_size = Some(box_size);
            }
            _ => {}
        }

        pos = pos.saturating_add(box_size);
    }

    if let (Some(moov_off), Some(mdat_off)) = (layout.moov_offset, layout.mdat_offset) {
        if moov_off < mdat_off {
            layout.moov_position = "head".into();
        } else {
            layout.moov_position = "tail".into();
        }
    }

    log::info!(
        "[MP4_LAYOUT] ftyp={:?} moov={:?} mdat={:?} pos={}",
        layout.ftyp_offset,
        layout.moov_offset,
        layout.mdat_offset,
        layout.moov_position
    );

    layout
}

/// DemandRangeReader: reads requested sparse ranges on-demand from disk file without downloading full file to 100%.
struct DemandRangeReader {
    file: File,
    stream_id: String,
    position: u64,
    end_exclusive: u64,
    wait_for_growth: bool,
}

impl Read for DemandRangeReader {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        if output.is_empty() || self.position >= self.end_exclusive {
            return Ok(0);
        }

        let mut waited = 0;
        let mut seek_signaled = false;
        loop {
            let Some(entry) = get_entry(&self.stream_id) else {
                return Ok(0);
            };

            let ranges = merge_ranges(&entry.ranges);
            let available_end = contiguous_end_from(&ranges, self.position).min(self.end_exclusive);
            if available_end > self.position {
                let count = (available_end - self.position).min(output.len() as u64) as usize;

                // Fast-Path: Zero-latency read from in-memory hot-head cache if position falls within cached buffer
                if let Some(hot_head) = get_hot_head(&self.stream_id) {
                    let head_len = hot_head.len() as u64;
                    if self.position < head_len {
                        let available_in_ram = head_len.min(available_end);
                        if available_in_ram > self.position {
                            let ram_count = ((available_in_ram - self.position) as usize).min(count);
                            let start_idx = self.position as usize;
                            output[..ram_count].copy_from_slice(&hot_head[start_idx..start_idx + ram_count]);
                            self.position = self.position.saturating_add(ram_count as u64);
                            return Ok(ram_count);
                        }
                    }
                }

                self.file.seek(SeekFrom::Start(self.position))?;
                let read = self.file.read(&mut output[..count])?;
                // Populate hot-head cache when reading head bytes to accelerate subsequent seek/playback loops
                if self.position == 0 && read > 0 {
                    put_hot_head(&self.stream_id, &output[..read]);
                }
                self.position = self.position.saturating_add(read as u64);
                return Ok(read);
            }

            if entry.error.is_some() {
                return Ok(0);
            }

            if !self.wait_for_growth || entry.done || waited > 30_000 {
                return Ok(0);
            }

            // Auto-signal demand if entry is cancelled/paused or waiting for bytes
            if !seek_signaled || waited % 1000 == 0 {
                let _ = crate::core::grammers::stream::request_progressive_range(
                    &self.stream_id,
                    self.position,
                );
                seek_signaled = true;
            }

            thread::sleep(Duration::from_millis(25));
            waited += 25;
        }
    }
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
    REGISTRY_DIR.get().map(|d| d.join(format!("{sid}.json")))
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
    entry.ranges = merge_ranges(&entry.ranges);
    entry.updated_at_ms = now_ms();

    // Read existing entry ONCE to avoid repeated lock acquisitions.
    let existing_opt = live_map().read().get(&entry.stream_id).cloned();

    if let Some(ref existing) = existing_opt {
        // BUG-FIX: PRESERVE TAIL-FETCH RANGES.
        // The fill loop passes only its own sequential ranges, which would silently
        // overwrite any tail-fetch ranges already stored in the global entry.
        // After the tail-fetch task writes the last ~1 MB (containing the MOOV atom),
        // the very next fill-loop upsert_entry call would erase those tail ranges,
        // making the MOOV bytes invisible to handle_stream when the browser issues a
        // suffix range request. Merging here ensures tail bytes are never discarded.
        if !entry.cancelled {
            let mut all = entry.ranges.clone();
            all.extend(existing.ranges.iter().copied());
            entry.ranges = merge_ranges(&all);
        }

        // Inherit moov_ready_cached from the existing live entry so the cache is
        // never lost between fill-loop iterations.  Every chunk update rebuilds a
        // fresh StreamEntry literal with moov_ready_cached: false, so without this
        // inheritance the cache resets on every call — making it useless.
        if !entry.moov_ready_cached && existing.moov_ready_cached {
            entry.moov_ready_cached = true;
        }
        // Also inherit moov_tail_fetching so the flag isn't reset by fill-loop upserts.
        if existing.moov_tail_fetching && !entry.moov_tail_fetching {
            entry.moov_tail_fetching = true;
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

/// Mark the metadata-tail probe as finished without letting a concurrent fill
/// update re-inherit the old `true` value.  The fill loop intentionally omits
/// its tail state so it cannot erase an in-flight probe; completion therefore
/// needs this narrow, explicit transition.
pub fn finish_moov_tail_fetch(sid: &str) {
    let completed = {
        let mut map = live_map().write();
        let Some(entry) = map.get_mut(sid) else {
            return;
        };
        entry.moov_tail_fetching = false;
        entry.updated_at_ms = now_ms();
        entry.clone()
    };
    save_entry_disk(&completed);
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
    remove_hot_head(sid);
    live_map().write().remove(sid);
    if let Some(p) = registry_path(sid) {
        let _ = fs::remove_file(p);
    }
}

/// Drop every progressive stream registry entry from memory and disk.
///
/// Cache clearing must invalidate both layers. Removing only the `.partial`
/// files leaves a live entry that can hand the UI a stale Range URL after a
/// clear, while removing only the map allows the JSON registry to resurrect it.
pub fn clear_all_entries() -> usize {
    clear_hot_head_cache();
    let ids: Vec<String> = live_map().read().keys().cloned().collect();
    let count = ids.len();
    live_map().write().clear();

    if let Some(dir) = REGISTRY_DIR.get() {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|ext| ext.to_str()) == Some("json") {
                    let _ = fs::remove_file(path);
                }
            }
        }
    }
    count
}

/// Prune entries that have completed or cancelled and have not been accessed for `ttl`.
pub fn prune_expired_entries(ttl: Duration) -> usize {
    let now = now_ms();
    let ttl_ms = ttl.as_millis();
    let mut to_remove = Vec::new();

    {
        let map = live_map().read();
        for (sid, entry) in map.iter() {
            if entry.done || entry.cancelled || entry.error.is_some() {
                if now.saturating_sub(entry.updated_at_ms) > ttl_ms {
                    to_remove.push(sid.clone());
                }
            }
        }
    }

    let pruned_count = to_remove.len();
    for sid in to_remove {
        remove_entry(&sid);
    }
    pruned_count
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
            stalled: false,
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
            let stalled = is_progressive_entry_stalled(&e);
            let status = if e.cancelled {
                "cancelled"
            } else if e.error.is_some() {
                "error"
            } else if e.done {
                "done"
            } else if stalled {
                "stalled"
            } else {
                "downloading"
            };
            // Align with Python first_play tiers (~96–384 KiB). Too-high thresholds
            // leave UI stuck on "Buffering" while bytes already sit on disk.
            let first_play = super::streaming_policy::first_play_bytes(total);
            // moov_ready is cached by upsert_entry — no disk scan on every poll.
            // Also treat as ready when tail-fetch task is in progress (MOOV will arrive from end).
            let moov_ready =
                !is_mp4_entry(&e) || e.done || e.moov_ready_cached || e.moov_tail_fetching;
            let stream_ready = e.done || (prefix >= first_play.min(total.max(1)) && moov_ready);
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
                stalled,
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
        Header::from_bytes(
            &b"Cache-Control"[..],
            &b"no-store, no-cache, must-revalidate"[..],
        )
        .unwrap(),
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

fn parse_range(header: Option<&str>, total_size: u64) -> Option<(u64, Option<u64>)> {
    let h = header?;
    let h = h.trim();
    if !h.starts_with("bytes=") {
        return None;
    }
    let spec = h[6..].split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    if a.is_empty() {
        let suffix: u64 = b.parse().ok()?;
        if suffix == 0 || total_size == 0 {
            return None;
        }
        let start = total_size.saturating_sub(suffix);
        Some((start, Some(total_size.saturating_sub(1))))
    } else {
        let start: u64 = a.parse().ok()?;
        let end: Option<u64> = if b.is_empty() {
            None
        } else {
            Some(b.parse().ok()?)
        };
        Some((start, end))
    }
}

fn bounded_response_end(start: u64, requested_end: Option<u64>, solid_end: u64) -> u64 {
    let response_cap = start.saturating_add(16 * 1024 * 1024).min(solid_end);
    match requested_end {
        Some(end) => end.saturating_add(1).min(response_cap),
        None => response_cap,
    }
}

fn handle_register(mut request: Request) {
    record_stream_activity();
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

/// An orphan `.partial` file cannot be recovered safely. Progressive files are
/// preallocated to their final logical length, so metadata alone cannot
/// distinguish a complete file from sparse holes. Without registry byte ranges,
/// fail closed and let the frontend request a fresh stream.
fn try_recover_partial(sid: &str) -> Option<StreamEntry> {
    let _ = sid;
    None
}

fn handle_stream(request: Request, sid: &str) {
    record_stream_activity();
    let mut entry = match get_entry(sid) {
        Some(e) if !e.cancelled => e,
        Some(_e) if _e.cancelled => {
            let mut res =
                Response::from_string("Stream cancelled").with_status_code(StatusCode(410));
            for h in cors_headers() {
                res.add_header(h);
            }
            let _ = request.respond(res);
            return;
        }
        _ => match try_recover_partial(sid) {
            Some(recovered) => recovered,
            None => {
                let mut res =
                    Response::from_string("Stream expired").with_status_code(StatusCode(404));
                for h in cors_headers() {
                    res.add_header(h);
                }
                let _ = request.respond(res);
                return;
            }
        },
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
    let total = if entry.total_size > 0 {
        entry.total_size
    } else {
        fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
    };

    let range_hdr = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Range") || h.field.equiv("range"))
        .map(|h| h.value.as_str().to_string());

    let req_range = parse_range(range_hdr.as_deref(), total);
    let req_start = req_range.map(|(s, _)| s).unwrap_or(0);

    // If start is beyond total size, return RFC 7233 416 Range Not Satisfiable
    if req_start >= total && total > 0 {
        let mut res =
            Response::from_string("Range Not Satisfiable").with_status_code(StatusCode(416));
        for h in cors_headers() {
            res.add_header(h);
        }
        if let Ok(h) =
            Header::from_bytes(&b"Content-Range"[..], format!("bytes */{total}").as_bytes())
        {
            res.add_header(h);
        }
        let _ = request.respond(res);
        return;
    }

    // FIX Bug #1: Jika stream masih mengisi, trigger upstream fetch dan tunggu bytes di req_start.
    // Bug lama: `r` di-clone dari entry.ranges SEBELUM get_entry() dipanggil di dalam loop,
    // sehingga contiguous_end_from selalu mengecek snapshot stale yang tidak pernah berubah
    // → h_now tidak pernah > req_start → timeout 45 detik → buffer stuck.
    // Fix: hapus clone redundan, cek h_now SETELAH entry di-refresh via get_entry().
    if !entry.done {
        let have = contiguous_end_from(&entry.ranges, req_start);
        if have <= req_start {
            let _ = crate::core::grammers::stream::request_progressive_range(sid, req_start);
            if entry.paused || entry.cancelled {
                entry.paused = false;
                entry.cancelled = false;
                upsert_entry(entry.clone());
            }
            let mut waited = 0u32;
            let mut last_seek_resend_ms = 0u32;
            while waited < 45_000 {
                thread::sleep(Duration::from_millis(25));
                waited += 25;
                // SEEK FIX #3: Re-kirim seek request setiap 2 detik.
                // Bug lama: seek dikirim hanya 1x di atas. Jika fill-loop sedang di tengah
                // batch dan interruptible-break terjadi tapi timing menyebabkan seek sudah
                // di-take dan fill-loop ke posisi yang salah, re-send setiap 2s memastikan
                // fill-loop akhirnya mendapat seek target yang benar.
                if waited.saturating_sub(last_seek_resend_ms) >= 2_000 {
                    let _ =
                        crate::core::grammers::stream::request_progressive_range(sid, req_start);
                    last_seek_resend_ms = waited;
                }
                match get_entry(sid) {
                    Some(updated) => {
                        entry = updated;
                        // Cek SETELAH refresh entry — bukan snapshot stale
                        let h_now = contiguous_end_from(&entry.ranges, req_start);
                        if h_now > req_start || entry.done {
                            break;
                        }
                    }
                    None => break,
                }
            }
        }
    }

    let ranges = if entry.done && entry.ranges.is_empty() {
        vec![(0, total)]
    } else {
        entry.ranges.clone()
    };
    let prefix = contiguous_from_zero(&ranges);
    let filled = filled_bytes(&ranges);

    let is_head = request.method() == &Method::Head;

    // BUG-FIX: Cap each HTTP response to 16 MB using bounded_response_end.
    //
    // Previously, a bare `Range: bytes=0-` caused the server to promise the
    // ENTIRE file in a single 206 response (e.g. Content-Range: bytes 0-379899999/379900000).
    // Chrome then held open one huge streaming read and never made a separate
    // suffix range request to fetch the MOOV atom from the tail.
    //
    // With the 16 MB cap:
    //  • Chrome receives `Content-Range: bytes 0-16777215/379900000`.
    //  • After parsing ftyp + the start of mdat with no moov in sight, Chrome
    //    issues a suffix request (e.g. `Range: bytes=-2097152`) to locate moov.
    //  • The tail-fetch task has already written those bytes (and they are now
    //    preserved thanks to the range-merge fix in upsert_entry).
    //  • Chrome gets moov, begins decoding, and playback starts within seconds.
    let (start, end_incl, status) = if let Some((rs, re)) = req_range {
        let start = rs;
        // bounded_response_end caps to start + 16 MB, honouring an explicit
        // end if it is smaller. Returns an exclusive endpoint.
        let end_excl = bounded_response_end(start, re, total);
        let end_incl = end_excl.saturating_sub(1).min(total.saturating_sub(1));
        (start, end_incl, 206)
    } else {
        // No Range header: serve first 16 MB as 206 so browsers can
        // immediately follow up with a suffix request when needed.
        let end_excl = bounded_response_end(0, None, total);
        let end_incl = end_excl.saturating_sub(1).min(total.saturating_sub(1));
        let st = if end_excl >= total { 200 } else { 206 };
        (0, end_incl, st)
    };

    let length = end_incl.saturating_sub(start).saturating_add(1);

    log::info!(
        "[REAL_HTTP_RANGE][CAP16] sid={sid} req={:?} -> status={status} cr=bytes {start}-{end_incl}/{total} len={length} done={}",
        range_hdr,
        entry.done
    );

    let mime = if entry.mime.is_empty() {
        "application/octet-stream"
    } else {
        &entry.mime
    };

    if is_head {
        let mut res = Response::empty(StatusCode(status));
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
        if let Ok(h) = Header::from_bytes(&b"Content-Length"[..], format!("{length}").as_bytes()) {
            res.add_header(h);
        }
        let _ = request.respond(res);
        return;
    }

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

    let reader = DemandRangeReader {
        file,
        stream_id: sid.to_string(),
        position: start,
        end_exclusive: end_incl.saturating_add(1),
        wait_for_growth: !entry.done,
    };

    let cr_str = if status == 206 {
        format!("bytes {start}-{end_incl}/{total}")
    } else {
        format!("bytes 0-{}/{total}", total.saturating_sub(1))
    };

    log::info!(
        "[REAL_HTTP_RANGE] ts={} sid={sid} req={:?} status={status} cr=\"{cr_str}\" len={length} tg_downloaded={filled} intervals_count={}",
        now_ms(),
        range_hdr,
        ranges.len()
    );

    let mut res = Response::new(
        StatusCode(status),
        Vec::new(),
        reader,
        usize::try_from(length).ok(),
        None,
    )
    .with_chunked_threshold(usize::MAX);
    for h in cors_headers() {
        res.add_header(h);
    }
    if let Ok(h) = Header::from_bytes(&b"Content-Type"[..], mime.as_bytes()) {
        res.add_header(h);
    }
    res.add_header(Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap());
    res.add_header(Header::from_bytes(&b"X-Content-Type-Options"[..], &b"nosniff"[..]).unwrap());
    if status == 206 {
        if let Ok(h) = Header::from_bytes(&b"Content-Range"[..], cr_str.as_bytes()) {
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
        let sid = url
            .trim_start_matches("/unregister/")
            .split('?')
            .next()
            .unwrap_or("");
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
                            let mut res =
                                Response::from_string(body).with_status_code(StatusCode(410));
                            for h in cors_headers() {
                                res.add_header(h);
                            }
                            let _ = request.respond(res);
                            return;
                        }
                        e.paused = action == "pause";
                        upsert_entry(e);
                        let mut res =
                            Response::from_string(action).with_status_code(StatusCode(200));
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
        let sid = url
            .trim_start_matches("/status/")
            .split('?')
            .next()
            .unwrap_or("");
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

    if (method == Method::Get || method == Method::Head) && (url == "/proxy_remote" || url.starts_with("/proxy_remote?") || url.starts_with("/proxy_remote/")) {
        handle_remote_proxy(request);
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

fn handle_remote_proxy(request: Request) {
    let raw_url = request.url().to_string();
    let query_str = raw_url.split_once('?').map(|x| x.1).unwrap_or("");
    let mut target_url = String::new();
    let mut referer = "https://streamrizz.com/".to_string();

    for pair in query_str.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if let Ok(decoded_k) = urlencoding::decode(k) {
                if let Ok(decoded_v) = urlencoding::decode(v) {
                    if decoded_k == "url" {
                        target_url = decoded_v.to_string();
                    } else if decoded_k == "referer" {
                        referer = decoded_v.to_string();
                    }
                }
            }
        }
    }

    if target_url.trim().is_empty() {
        let mut res = Response::from_string("missing url parameter").with_status_code(StatusCode(400));
        for h in cors_headers() {
            res.add_header(h);
        }
        let _ = request.respond(res);
        return;
    }

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(45))
        .redirects(8)
        .build();

    let is_head = request.method() == &Method::Head;
    let mut upstream_req = if is_head {
        agent.head(&target_url)
    } else {
        agent.get(&target_url)
    };

    upstream_req = upstream_req
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .set("Referer", &referer);

    for hdr in request.headers() {
        if hdr.field.equiv("range") {
            upstream_req = upstream_req.set("Range", hdr.value.as_str());
        }
    }

    match upstream_req.call() {
        Ok(resp) => {
            let status = resp.status();
            let content_type = resp.header("content-type").unwrap_or("video/mp4").to_string();
            let content_range = resp.header("content-range").map(|s| s.to_string());
            let content_len = resp.header("content-length").and_then(|s| s.parse::<u64>().ok());

            let reader: Box<dyn std::io::Read + Send + 'static> = if is_head {
                Box::new(std::io::empty())
            } else {
                Box::new(resp.into_reader())
            };
            let mut out_res = Response::new(
                StatusCode(status),
                vec![],
                reader,
                if is_head { Some(0) } else { content_len.map(|l| l as usize) },
                None,
            );

            for h in cors_headers() {
                out_res.add_header(h);
            }
            if let Ok(h) = Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()) {
                out_res.add_header(h);
            }
            if let Ok(h) = Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]) {
                out_res.add_header(h);
            }
            if let Some(cr) = content_range {
                if let Ok(h) = Header::from_bytes(&b"Content-Range"[..], cr.as_bytes()) {
                    out_res.add_header(h);
                }
            }
            let _ = request.respond(out_res);
        }
        Err(e) => {
            let mut res = Response::from_string(format!("Proxy upstream error: {e}"))
                .with_status_code(StatusCode(502));
            for h in cors_headers() {
                res.add_header(h);
            }
            let _ = request.respond(res);
        }
    }
}

pub fn get_port() -> u16 {
    PORT.load(Ordering::SeqCst)
}

/// Start server on 127.0.0.1:0 (ephemeral). Idempotent.
pub fn ensure_started(registry: PathBuf) -> u16 {
    let current = PORT.load(Ordering::SeqCst);
    if current != 0 {
        return current;
    }
    let reg_dir = if registry.is_dir() {
        registry
    } else {
        registry.parent().map(|p| p.to_path_buf()).unwrap_or(registry)
    };
    let _ = fs::create_dir_all(&reg_dir);
    let _ = REGISTRY_DIR.set(reg_dir);

    let server = match Server::http("127.0.0.1:0") {
        Ok(s) => s,
        Err(_) => return 0,
    };
    let addr: SocketAddr = server
        .server_addr()
        .to_ip()
        .unwrap_or_else(|| SocketAddr::from(([127, 0, 0, 1], 0)));
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
        let r = merge_ranges(&[(0, 100), (100, 200), (300, 400)]);
        assert_eq!(r, vec![(0, 200), (300, 400)]);

        assert_eq!(contiguous_from_zero(&r), 200);
        assert_eq!(contiguous_end_from(&r, 300), 400);
    }

    #[test]
    fn response_never_exceeds_requested_http_range() {
        assert_eq!(
            bounded_response_end(0, Some(1_048_575), 32_000_000),
            1_048_576
        );
        assert_eq!(bounded_response_end(10_000, Some(19_999), 50_000), 20_000);
        assert_eq!(bounded_response_end(0, None, 80_000_000), 16 * 1024 * 1024);
    }

    #[test]
    fn incomplete_unpaused_entry_becomes_stalled_after_progress_deadline() {
        let entry = StreamEntry {
            stream_id: "stalled".into(),
            path: "C:/temp/stalled.partial".into(),
            total_size: 10,
            mime: "video/mp4".into(),
            label: "stalled.mp4".into(),
            done: false,
            ranges: vec![(0, 1)],
            cancelled: false,
            error: None,
            paused: false,
            updated_at_ms: now_ms().saturating_sub(PROGRESSIVE_STREAM_STALL_AFTER_MS + 1),
            moov_ready_cached: false,
            moov_tail_fetching: false,
        };
        assert!(is_progressive_entry_stalled(&entry));
    }

    #[test]
    fn paused_or_completed_entry_is_not_reported_as_stalled() {
        let mut entry = StreamEntry {
            stream_id: "complete".into(),
            path: "C:/temp/complete.partial".into(),
            total_size: 10,
            mime: "video/mp4".into(),
            label: "complete.mp4".into(),
            done: true,
            ranges: vec![(0, 10)],
            cancelled: false,
            error: None,
            paused: false,
            updated_at_ms: 0,
            moov_ready_cached: true,
            moov_tail_fetching: false,
        };
        assert!(!is_progressive_entry_stalled(&entry));
        entry.done = false;
        entry.paused = true;
        assert!(!is_progressive_entry_stalled(&entry));
    }
}
