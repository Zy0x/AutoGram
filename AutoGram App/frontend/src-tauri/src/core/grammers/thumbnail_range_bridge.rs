//! Transient local HTTP Range Bridge for FFmpeg seekable video thumbnail extraction.
//!
//! Spawns an ephemeral `tiny_http` server on 127.0.0.1:0 for the duration of a video frame extraction.
//! Translates HTTP `Range: bytes=start-end` requests into targeted Grammers MTProto `iter_download` chunk requests.
//! Returns HTTP status `206 Partial Content` with accurate byte boundaries, enabling FFmpeg to seek
//! atom `moov` tables and AV1 sequence headers on demand without full media file downloads or truncated MP4 corruption.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use grammers_client::media::Media;
use grammers_client::Client;
use tiny_http::{Header, Method, Response, Server, StatusCode};

use crate::core::tg_log;

const BACKEND: &str = "grammers_range_bridge";
const DEFAULT_CHUNK_SIZE: u64 = 256 * 1024; // 256 KB chunk size for MTProto

pub struct RangeBridgeHandle {
    pub url: String,
    pub cumulative_bytes: Arc<std::sync::atomic::AtomicU64>,
    stop_signal: Arc<AtomicBool>,
}

impl RangeBridgeHandle {
    pub fn stop(&self) {
        if !self.stop_signal.swap(true, Ordering::Relaxed) {
            let total = self.cumulative_bytes.load(Ordering::Relaxed);
            tg_log::info(
                BACKEND,
                "range_bridge_stopped",
                format!("url='{}' cumulative_bytes={total}", self.url),
            );
        }
    }
}

impl Drop for RangeBridgeHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Spawns a transient HTTP server listening on 127.0.0.1:0 bound to a specific Grammers media item.
/// Returns a `RangeBridgeHandle` containing the local HTTP stream URL (e.g. `http://127.0.0.1:54321/thumb.mp4`).
pub fn spawn_range_bridge(
    rt: &tokio::runtime::Handle,
    client: Client,
    media: Media,
    total_size: u64,
    max_budget: u64,
    session_name: impl Into<String>,
) -> Option<RangeBridgeHandle> {
    let session = session_name.into();
    let server = Server::http("127.0.0.1:0").ok()?;
    let port = server.server_addr().to_ip().map(|a| a.port())?;
    let url = format!("http://127.0.0.1:{port}/thumb.mp4");

    tg_log::info(
        BACKEND,
        "range_bridge_started",
        format!("url='{url}' total_size={total_size} max_budget={max_budget} session={session}"),
    );

    let stop_signal = Arc::new(AtomicBool::new(false));
    let stop_ref = stop_signal.clone();
    let cumulative_bytes = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let cum_ref = cumulative_bytes.clone();
    let rt_handle = rt.clone();
    let url_log = url.clone();

    std::thread::spawn(move || {
        let range_cache = Arc::new(parking_lot::Mutex::new(std::collections::HashMap::<(u64, usize), Vec<u8>>::new()));
        while !stop_ref.load(Ordering::Relaxed) {
            let req = match server.recv_timeout(Duration::from_millis(250)) {
                Ok(Some(r)) => r,
                Ok(None) => continue,
                Err(_) => break,
            };

            if stop_ref.load(Ordering::Relaxed) {
                break;
            }

            if req.method() == &Method::Head {
                let mut res = Response::empty(StatusCode(200));
                res.add_header(Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap());
                res.add_header(Header::from_bytes(&b"Content-Length"[..], total_size.to_string().as_bytes()).unwrap());
                res.add_header(Header::from_bytes(&b"Content-Type"[..], &b"video/mp4"[..]).unwrap());
                let _ = req.respond(res);
                continue;
            }

            if req.method() != &Method::Get {
                let res = Response::empty(StatusCode(405));
                let _ = req.respond(res);
                continue;
            }

            let current_cum = cum_ref.load(Ordering::Relaxed);
            if current_cum >= max_budget {
                tg_log::warn(
                    BACKEND,
                    "range_bridge_budget_exceeded",
                    format!("url='{url_log}' cumulative={current_cum} max_budget={max_budget}"),
                );
                let mut res = Response::empty(StatusCode(416));
                res.add_header(
                    Header::from_bytes(
                        &b"Content-Range"[..],
                        format!("bytes */{total_size}").as_bytes(),
                    )
                    .unwrap(),
                );
                let _ = req.respond(res);
                break;
            }

            let range_hdr = req
                .headers()
                .iter()
                .find(|h| h.field.equiv("Range") || h.field.equiv("range"))
                .map(|h| h.value.as_str().to_string());

            let (req_start, req_end_opt) = parse_range(range_hdr.as_deref()).unwrap_or((0, None));
            if req_start >= total_size {
                let mut res = Response::empty(StatusCode(416));
                res.add_header(
                    Header::from_bytes(
                        &b"Content-Range"[..],
                        format!("bytes */{total_size}").as_bytes(),
                    )
                    .unwrap(),
                );
                let _ = req.respond(res);
                continue;
            }

            let max_fetch = 2 * 1024 * 1024u64;
            let req_end = req_end_opt.unwrap_or(total_size.saturating_sub(1));
            let actual_end = req_end.min(req_start + max_fetch - 1).min(total_size.saturating_sub(1));
            let fetch_len = (actual_end - req_start + 1) as usize;

            tg_log::info(
                BACKEND,
                "range_bridge_request",
                format!("offset={req_start} requested_length={fetch_len}"),
            );

            let client_cloned = client.clone();
            let media_cloned = media.clone();
            let session_cloned = session.clone();

            let cache_key = (req_start, fetch_len);
            let cached_bytes = {
                let guard = range_cache.lock();
                guard.get(&cache_key).cloned()
            };

            let bytes_res = if let Some(bytes) = cached_bytes {
                Ok(bytes)
            } else {
                let res = rt_handle.block_on(async move {
                    fetch_range_bytes(&client_cloned, &media_cloned, req_start, fetch_len, total_size, &session_cloned).await
                });
                if let Ok(ref bytes) = res {
                    let mut guard = range_cache.lock();
                    if guard.len() < 16 {
                        guard.insert(cache_key, bytes.clone());
                    }
                }
                res
            };

            match bytes_res {
                Ok(bytes) => {
                    let body_len = bytes.len() as u64;
                    let new_cum = cum_ref.fetch_add(body_len, Ordering::Relaxed) + body_len;

                    tg_log::info(
                        BACKEND,
                        "range_bridge_response",
                        format!("status=206 bytes={body_len} cumulative_bytes={new_cum}"),
                    );

                    let resp_end = req_start + body_len.saturating_sub(1);
                    let mut res = Response::from_data(bytes).with_status_code(StatusCode(206));
                    res.add_header(Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap());
                    res.add_header(
                        Header::from_bytes(
                            &b"Content-Range"[..],
                            format!("bytes {req_start}-{resp_end}/{total_size}").as_bytes(),
                        )
                        .unwrap(),
                    );
                    res.add_header(Header::from_bytes(&b"Content-Length"[..], body_len.to_string().as_bytes()).unwrap());
                    res.add_header(Header::from_bytes(&b"Content-Type"[..], &b"video/mp4"[..]).unwrap());
                    let _ = req.respond(res);
                }
                Err(e) => {
                    tg_log::warn(
                        BACKEND,
                        "range_fetch_failed",
                        format!("start={req_start} len={fetch_len} err={e}"),
                    );
                    let res = Response::empty(StatusCode(500));
                    let _ = req.respond(res);
                }
            }
        }
    });

    Some(RangeBridgeHandle {
        url,
        cumulative_bytes,
        stop_signal,
    })
}

/// Parses standard `Range: bytes=start-end` or `bytes=start-` header values.
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

/// Fetches target range [offset, offset + length) from Telegram MTProto using Grammers `iter_download`.
async fn fetch_range_bytes(
    client: &Client,
    media: &Media,
    offset: u64,
    length: usize,
    total_size: u64,
    session_name: &str,
) -> Result<Vec<u8>, String> {
    if offset >= total_size || length == 0 {
        return Ok(Vec::new());
    }

    let doc = match media {
        Media::Document(d) => d,
        _ => return Err("Media is not a document".to_string()),
    };

    if let Some(rem_secs) = crate::core::session_rate::flood_remaining_secs(session_name) {
        if rem_secs > 0 {
            tg_log::warn(
                BACKEND,
                "range_fetch_flood_active",
                format!("session={session_name} flood_remaining={rem_secs}s. Failing range fetch fast to protect MTProto session."),
            );
            return Err(format!("FLOOD_WAIT active ({rem_secs}s)"));
        }
    }

    let chunk_size = DEFAULT_CHUNK_SIZE;
    let start_chunk = (offset / chunk_size) as i32;
    let start_chunk_byte = (start_chunk as u64) * chunk_size;
    let byte_offset_in_first_chunk = (offset - start_chunk_byte) as usize;

    let target_length_with_offset = byte_offset_in_first_chunk + length;

    let mut collected = Vec::with_capacity(target_length_with_offset + chunk_size as usize);
    let mut retry_count = 0;

    loop {
        let mut iter = client
            .iter_download(doc)
            .chunk_size(chunk_size as i32)
            .skip_chunks(start_chunk + (collected.len() as u64 / chunk_size) as i32);

        let mut err_occurred = None;
        while collected.len() < target_length_with_offset {
            match iter.next().await {
                Ok(Some(chunk)) => {
                    if chunk.is_empty() {
                        break;
                    }
                    collected.extend_from_slice(&chunk);
                }
                Ok(None) => break,
                Err(e) => {
                    err_occurred = Some(e);
                    break;
                }
            }
        }

        if let Some(e) = err_occurred {
            let err_str = e.to_string();
            if let Some(secs) = crate::core::session_rate::parse_flood_secs(&err_str) {
                crate::core::session_rate::note_flood_wait(session_name, secs);
                tg_log::warn(
                    BACKEND,
                    "range_fetch_flood_wait",
                    format!("session={session_name} FLOOD_WAIT ({secs}s) hit during range fetch. Auto-retrying after wait..."),
                );
                if retry_count < 1 && secs <= 25 {
                    retry_count += 1;
                    tokio::time::sleep(Duration::from_secs(u64::from(secs) + 1)).await;
                    continue;
                }
            }
            return Err(format!("iter_download error: {err_str}"));
        }
        break;
    }

    if collected.len() <= byte_offset_in_first_chunk {
        return Ok(Vec::new());
    }

    let end_idx = (byte_offset_in_first_chunk + length).min(collected.len());
    Ok(collected[byte_offset_in_first_chunk..end_idx].to_vec())
}
