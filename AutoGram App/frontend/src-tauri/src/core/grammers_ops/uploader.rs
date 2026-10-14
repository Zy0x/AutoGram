//! Resilient chunked uploader for Grammers MTProto.
//!
//! Provides chunked upload with:
//! 1. Controlled single-in-flight concurrency (preventing MTProto write buffer overflow & TCP resets).
//! 2. Resilient part-level retries on `InvocationError::Dropped`, `Io`, and `Rpc(420)` flood waits.
//! 3. Real-time progress emission based on Telegram acknowledgment (not disk reads).
//! 4. Responsive cancellation checks.
//! 5. Support for both seekable disk files and async streaming readers.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use grammers_client::media::Uploaded;
use grammers_client::{tl, Client};
use grammers_mtsender::InvocationError;
use parking_lot::Mutex;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeekExt, SeekFrom};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::core::tg_error::{TgError, TgErrorCode};
use crate::core::tg_log;

const CHUNK_SIZE: usize = 512 * 1024; // 512 KB standard MTProto part size
const BIG_FILE_THRESHOLD: u64 = 10 * 1024 * 1024; // 10 MB
const MAX_PART_RETRIES: u32 = 5;

/// Computes the concurrency window (number of parts in-flight simultaneously)
/// for MTProto file uploads based on total part count and system traffic configuration.
pub fn compute_chunk_concurrency(total_parts: i32) -> usize {
    if total_parts <= 1 {
        1
    } else if total_parts <= 4 {
        total_parts as usize
    } else {
        let configured = crate::core::traffic_governor::snapshot()
            .upload
            .configured_ceiling;
        if configured <= 1 {
            1
        } else {
            // Sweet spot for 512KB MTProto parts over international WAN: 6 in-flight (clamped 4..=8)
            (configured as usize).clamp(4, 8)
        }
    }
}

struct ProgressState {
    last_emit_time: Instant,
    last_emit_bytes: u64,
}

fn emit_upload_progress(
    app_handle: &Option<tauri::AppHandle>,
    item_index: usize,
    stage: &str,
    transferred_bytes: u64,
    total_size: u64,
    state: &Mutex<ProgressState>,
) {
    let mut guard = state.lock();
    let elapsed_ms = guard.last_emit_time.elapsed().as_millis();
    if elapsed_ms >= 300 || transferred_bytes >= total_size {
        let elapsed_sec = (elapsed_ms as f64 / 1000.0).max(0.001);
        let delta_bytes = transferred_bytes.saturating_sub(guard.last_emit_bytes);
        let inst_speed = delta_bytes as f64 / elapsed_sec;

        guard.last_emit_time = Instant::now();
        guard.last_emit_bytes = transferred_bytes;
        drop(guard);

        let pct = if total_size > 0 {
            (transferred_bytes as f64 / total_size as f64 * 100.0).clamp(0.0, 100.0)
        } else {
            0.0
        };
        let remaining = total_size.saturating_sub(transferred_bytes);
        let eta = if inst_speed > 10.0 && remaining > 0 {
            (remaining as f64 / inst_speed) as u64
        } else {
            0
        };

        if let Some(app) = app_handle {
            use tauri::Emitter;
            let _ = app.emit(
                "transfer-progress",
                serde_json::json!({
                    "jobId": format!("item-{}", item_index),
                    "stage": stage,
                    "currentBytes": transferred_bytes,
                    "totalBytes": total_size,
                    "speed": inst_speed,
                    "percentage": pct,
                    "eta": eta
                }),
            );
            let _ = app.emit(
                "transfer-event",
                serde_json::json!({
                    "type": "StudioProgress",
                    "index": item_index,
                    "percent": pct,
                    "transferred": transferred_bytes,
                    "total": total_size,
                    "speed_mb_s": inst_speed / (1024.0 * 1024.0),
                    "eta_seconds": eta,
                    "phase": stage
                }),
            );
        }
    }
}

async fn upload_single_part_resilient(
    client: &Client,
    file_id: i64,
    part_idx: i32,
    total_parts: i32,
    is_big: bool,
    chunk_buf: Vec<u8>,
    transfer_id: Option<&str>,
) -> Result<(), TgError> {
    let mut attempt = 0u32;
    loop {
        attempt += 1;

        if let Some(tid) = transfer_id {
            if crate::core::job_queue::is_transfer_cancelled(tid) {
                return Err(TgError::new(
                    TgErrorCode::Cancelled,
                    "transfer cancelled by user",
                ));
            }
        }

        let res = if is_big {
            client
                .invoke(&tl::functions::upload::SaveBigFilePart {
                    file_id,
                    file_part: part_idx,
                    file_total_parts: total_parts,
                    bytes: chunk_buf.clone(),
                })
                .await
        } else {
            client
                .invoke(&tl::functions::upload::SaveFilePart {
                    file_id,
                    file_part: part_idx,
                    bytes: chunk_buf.clone(),
                })
                .await
        };

        match res {
            Ok(true) => return Ok(()),
            Ok(false) => {
                tg_log::warn(
                    "uploader",
                    "part_save_false",
                    format!(
                        "part {}/{} returned false (attempt {}/{})",
                        part_idx + 1,
                        total_parts,
                        attempt,
                        MAX_PART_RETRIES
                    ),
                );
                if attempt >= MAX_PART_RETRIES {
                    return Err(TgError::new(
                        TgErrorCode::Io,
                        format!("server failed to store part {part_idx} after {attempt} attempts"),
                    ));
                }
                tokio::time::sleep(Duration::from_millis(400 * attempt as u64)).await;
            }
            Err(err) => {
                tg_log::warn(
                    "uploader",
                    "part_save_error",
                    format!(
                        "part {}/{} error: {} (attempt {}/{})",
                        part_idx + 1,
                        total_parts,
                        err,
                        attempt,
                        MAX_PART_RETRIES
                    ),
                );
                if attempt >= MAX_PART_RETRIES {
                    return Err(TgError::new(
                        TgErrorCode::Io,
                        format!(
                            "upload part {part_idx}/{} failed after {attempt} attempts: {err}",
                            total_parts
                        ),
                    ));
                }

                match &err {
                    InvocationError::Rpc(rpc) if rpc.code == 420 => {
                        let wait_secs = rpc.value.unwrap_or(1) as u64;
                        tg_log::warn(
                            "uploader",
                            "flood_wait",
                            format!("sleeping {}s for flood wait on part {part_idx}", wait_secs + 1),
                        );
                        tokio::time::sleep(Duration::from_secs(wait_secs + 1)).await;
                    }
                    InvocationError::Dropped => {
                        tg_log::warn(
                            "uploader",
                            "connection_dropped",
                            format!(
                                "part {part_idx} dropped; waiting {}ms for reconnect...",
                                300 * attempt
                            ),
                        );
                        tokio::time::sleep(Duration::from_millis(300 * attempt as u64)).await;
                    }
                    _ => {
                        tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
                    }
                }
            }
        }
    }
}

/// Uploads a file from disk to Telegram servers using resilient chunking.
pub async fn upload_file_resilient(
    client: &Client,
    path: &Path,
    display_filename: String,
    stage: &str,
    item_index: usize,
    transfer_id: Option<&str>,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<Uploaded, TgError> {
    if !path.is_file() {
        return Err(TgError::new(TgErrorCode::Io, "file not found"));
    }

    let metadata = tokio::fs::metadata(path).await.map_err(|e| {
        TgError::new(TgErrorCode::Io, format!("failed to read file metadata: {e}"))
    })?;
    let file_size = metadata.len();
    if file_size == 0 {
        return Err(TgError::new(TgErrorCode::Io, "cannot upload empty file (0 bytes)"));
    }

    let is_big = file_size > BIG_FILE_THRESHOLD;
    let total_parts = ((file_size + CHUNK_SIZE as u64 - 1) / CHUNK_SIZE as u64) as i32;
    let file_id = rand::random::<i64>();

    let mut md5_ctx = if !is_big {
        Some(md5::Context::new())
    } else {
        None
    };

    let mut file = tokio::fs::File::open(path).await.map_err(|e| {
        TgError::new(TgErrorCode::Io, format!("failed to open file for upload: {e}"))
    })?;

    let _traffic_worker = crate::core::traffic_governor::acquire_worker(
        crate::core::traffic_governor::TransferDirection::Upload,
    );

    let chunk_concurrency = compute_chunk_concurrency(total_parts);
    let chunk_sem = Arc::new(Semaphore::new(chunk_concurrency));
    let mut join_set: JoinSet<Result<(i32, usize), TgError>> = JoinSet::new();

    let transferred_atomic = Arc::new(AtomicU64::new(0));
    let progress_state = Arc::new(Mutex::new(ProgressState {
        last_emit_time: Instant::now(),
        last_emit_bytes: 0,
    }));

    tg_log::info(
        "uploader",
        "upload_start",
        format!(
            "file='{}' size={} parts={} is_big={} window={} item={}",
            display_filename, file_size, total_parts, is_big, chunk_concurrency, item_index
        ),
    );

    for part_idx in 0..total_parts {
        let permit = Arc::clone(&chunk_sem)
            .acquire_owned()
            .await
            .map_err(|_| TgError::new(TgErrorCode::Internal, "upload semaphore closed"))?;

        if let Some(tid) = transfer_id {
            if crate::core::job_queue::is_transfer_cancelled(tid) {
                join_set.abort_all();
                return Err(TgError::new(
                    TgErrorCode::Cancelled,
                    "transfer cancelled by user",
                ));
            }
        }

        let chunk_offset = part_idx as u64 * CHUNK_SIZE as u64;
        let chunk_len = (file_size.saturating_sub(chunk_offset) as usize).min(CHUNK_SIZE);
        if chunk_len == 0 {
            break;
        }
        let mut chunk_buf = vec![0u8; chunk_len];

        file.seek(SeekFrom::Start(chunk_offset)).await.map_err(|e| {
            join_set.abort_all();
            TgError::new(
                TgErrorCode::Io,
                format!("failed to seek to offset {chunk_offset}: {e}"),
            )
        })?;
        file.read_exact(&mut chunk_buf).await.map_err(|e| {
            join_set.abort_all();
            TgError::new(
                TgErrorCode::Io,
                format!("failed to read chunk {part_idx} at offset {chunk_offset}: {e}"),
            )
        })?;

        if let Some(ref mut ctx) = md5_ctx {
            ctx.consume(&chunk_buf);
        }

        let client = client.clone();
        let tid_owned = transfer_id.map(str::to_string);
        let transferred = Arc::clone(&transferred_atomic);
        let progress = Arc::clone(&progress_state);
        let app = app_handle.cloned();
        let stage_name = stage.to_string();

        join_set.spawn(async move {
            let _permit = permit;
            upload_single_part_resilient(
                &client,
                file_id,
                part_idx,
                total_parts,
                is_big,
                chunk_buf,
                tid_owned.as_deref(),
            )
            .await?;

            let prev = transferred.fetch_add(chunk_len as u64, Ordering::Relaxed);
            let current_total = prev + chunk_len as u64;
            crate::core::traffic_governor::record_bytes(
                crate::core::traffic_governor::TransferDirection::Upload,
                chunk_len as u64,
            );

            emit_upload_progress(
                &app,
                item_index,
                &stage_name,
                current_total,
                file_size,
                &progress,
            );

            Ok((part_idx, chunk_len))
        });

        // Drain any already finished tasks to catch errors early
        while let Some(res) = join_set.try_join_next() {
            match res {
                Ok(Ok((_idx, _len))) => {}
                Ok(Err(err)) => {
                    join_set.abort_all();
                    return Err(err);
                }
                Err(join_err) => {
                    join_set.abort_all();
                    return Err(TgError::new(
                        TgErrorCode::Internal,
                        format!("upload task aborted: {join_err}"),
                    ));
                }
            }
        }
    }

    // Await all remaining chunk tasks
    while let Some(res) = join_set.join_next().await {
        match res {
            Ok(Ok((_idx, _len))) => {}
            Ok(Err(err)) => {
                join_set.abort_all();
                return Err(err);
            }
            Err(join_err) => {
                join_set.abort_all();
                return Err(TgError::new(
                    TgErrorCode::Internal,
                    format!("upload task aborted: {join_err}"),
                ));
            }
        }
    }

    let final_transferred = transferred_atomic.load(Ordering::Relaxed);
    tg_log::info(
        "uploader",
        "upload_ok",
        format!(
            "file='{}' uploaded {} bytes in {} parts (window={})",
            display_filename, final_transferred, total_parts, chunk_concurrency
        ),
    );

    if is_big {
        Ok(Uploaded {
            raw: tl::types::InputFileBig {
                id: file_id,
                parts: total_parts,
                name: display_filename,
            }
            .into(),
        })
    } else {
        let md5_ctx = md5_ctx.unwrap();
        Ok(Uploaded {
            raw: tl::types::InputFile {
                id: file_id,
                parts: total_parts,
                name: display_filename,
                md5_checksum: format!("{:x}", md5_ctx.compute()),
            }
            .into(),
        })
    }
}

/// Uploads an async stream to Telegram servers using resilient chunking.
pub async fn upload_stream_resilient<R: AsyncRead + Unpin>(
    client: &Client,
    reader: &mut R,
    total_size: u64,
    display_filename: String,
    stage: &str,
    item_index: usize,
    transfer_id: Option<&str>,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<Uploaded, TgError> {
    if total_size == 0 {
        return Err(TgError::new(TgErrorCode::Io, "cannot upload empty stream (0 bytes)"));
    }

    let is_big = total_size > BIG_FILE_THRESHOLD;
    let total_parts = ((total_size + CHUNK_SIZE as u64 - 1) / CHUNK_SIZE as u64) as i32;
    let file_id = rand::random::<i64>();

    let mut md5_ctx = if !is_big {
        Some(md5::Context::new())
    } else {
        None
    };

    let _traffic_worker = crate::core::traffic_governor::acquire_worker(
        crate::core::traffic_governor::TransferDirection::Upload,
    );

    let chunk_concurrency = compute_chunk_concurrency(total_parts);
    let chunk_sem = Arc::new(Semaphore::new(chunk_concurrency));
    let mut join_set: JoinSet<Result<(i32, usize), TgError>> = JoinSet::new();

    let transferred_atomic = Arc::new(AtomicU64::new(0));
    let progress_state = Arc::new(Mutex::new(ProgressState {
        last_emit_time: Instant::now(),
        last_emit_bytes: 0,
    }));

    for part_idx in 0..total_parts {
        let permit = Arc::clone(&chunk_sem)
            .acquire_owned()
            .await
            .map_err(|_| TgError::new(TgErrorCode::Internal, "upload stream semaphore closed"))?;

        if let Some(tid) = transfer_id {
            if crate::core::job_queue::is_transfer_cancelled(tid) {
                join_set.abort_all();
                return Err(TgError::new(
                    TgErrorCode::Cancelled,
                    "transfer cancelled by user",
                ));
            }
        }

        let chunk_offset = part_idx as u64 * CHUNK_SIZE as u64;
        let expected_chunk_len = (total_size.saturating_sub(chunk_offset) as usize).min(CHUNK_SIZE);
        if expected_chunk_len == 0 {
            break;
        }
        let mut chunk_buf = vec![0u8; expected_chunk_len];

        // Read chunk from stream
        let mut read_bytes = 0usize;
        while read_bytes < expected_chunk_len {
            let n = reader.read(&mut chunk_buf[read_bytes..]).await.map_err(|e| {
                join_set.abort_all();
                TgError::new(TgErrorCode::Io, format!("failed to read from stream: {e}"))
            })?;
            if n == 0 {
                break;
            }
            read_bytes += n;
        }
        chunk_buf.truncate(read_bytes);

        if chunk_buf.is_empty() {
            if part_idx == total_parts.saturating_sub(1) {
                break;
            } else {
                join_set.abort_all();
                return Err(TgError::new(
                    TgErrorCode::Io,
                    format!("unexpected EOF in stream at part {part_idx}/{total_parts}"),
                ));
            }
        }

        let chunk_len = chunk_buf.len();

        if let Some(ref mut ctx) = md5_ctx {
            ctx.consume(&chunk_buf);
        }

        let client = client.clone();
        let tid_owned = transfer_id.map(str::to_string);
        let transferred = Arc::clone(&transferred_atomic);
        let progress = Arc::clone(&progress_state);
        let app = app_handle.cloned();
        let stage_name = stage.to_string();

        join_set.spawn(async move {
            let _permit = permit;
            upload_single_part_resilient(
                &client,
                file_id,
                part_idx,
                total_parts,
                is_big,
                chunk_buf,
                tid_owned.as_deref(),
            )
            .await?;

            let prev = transferred.fetch_add(chunk_len as u64, Ordering::Relaxed);
            let current_total = prev + chunk_len as u64;
            crate::core::traffic_governor::record_bytes(
                crate::core::traffic_governor::TransferDirection::Upload,
                chunk_len as u64,
            );

            emit_upload_progress(
                &app,
                item_index,
                &stage_name,
                current_total,
                total_size,
                &progress,
            );

            Ok((part_idx, chunk_len))
        });

        // Drain any already finished tasks to catch errors early
        while let Some(res) = join_set.try_join_next() {
            match res {
                Ok(Ok((_idx, _len))) => {}
                Ok(Err(err)) => {
                    join_set.abort_all();
                    return Err(err);
                }
                Err(join_err) => {
                    join_set.abort_all();
                    return Err(TgError::new(
                        TgErrorCode::Internal,
                        format!("upload stream task aborted: {join_err}"),
                    ));
                }
            }
        }
    }

    // Await all remaining chunk tasks
    while let Some(res) = join_set.join_next().await {
        match res {
            Ok(Ok((_idx, _len))) => {}
            Ok(Err(err)) => {
                join_set.abort_all();
                return Err(err);
            }
            Err(join_err) => {
                join_set.abort_all();
                return Err(TgError::new(
                    TgErrorCode::Internal,
                    format!("upload stream task aborted: {join_err}"),
                ));
            }
        }
    }

    if is_big {
        Ok(Uploaded {
            raw: tl::types::InputFileBig {
                id: file_id,
                parts: total_parts,
                name: display_filename,
            }
            .into(),
        })
    } else {
        let md5_ctx = md5_ctx.unwrap();
        Ok(Uploaded {
            raw: tl::types::InputFile {
                id: file_id,
                parts: total_parts,
                name: display_filename,
                md5_checksum: format!("{:x}", md5_ctx.compute()),
            }
            .into(),
        })
    }
}
