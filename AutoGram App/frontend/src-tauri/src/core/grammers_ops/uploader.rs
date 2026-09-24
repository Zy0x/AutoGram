//! Resilient chunked uploader for Grammers MTProto.
//!
//! Provides chunked upload with:
//! 1. Controlled single-in-flight concurrency (preventing MTProto write buffer overflow & TCP resets).
//! 2. Resilient part-level retries on `InvocationError::Dropped`, `Io`, and `Rpc(420)` flood waits.
//! 3. Real-time progress emission based on Telegram acknowledgment (not disk reads).
//! 4. Responsive cancellation checks.
//! 5. Support for both seekable disk files and async streaming readers.

use std::path::Path;
use std::time::{Duration, Instant};

use grammers_client::media::Uploaded;
use grammers_client::{tl, Client};
use grammers_mtsender::InvocationError;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeekExt, SeekFrom};

use crate::core::tg_error::{TgError, TgErrorCode};
use crate::core::tg_log;

const CHUNK_SIZE: usize = 512 * 1024; // 512 KB standard MTProto part size
const BIG_FILE_THRESHOLD: u64 = 10 * 1024 * 1024; // 10 MB
const MAX_PART_RETRIES: u32 = 5;

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

    let mut transferred_bytes: u64 = 0;
    let mut last_emit_time = Instant::now();
    let mut last_emit_bytes: u64 = 0;

    tg_log::info(
        "uploader",
        "upload_start",
        format!(
            "file='{}' size={} parts={} is_big={} item={}",
            display_filename, file_size, total_parts, is_big, item_index
        ),
    );

    for part_idx in 0..total_parts {
        let chunk_offset = part_idx as u64 * CHUNK_SIZE as u64;
        let chunk_len = ((file_size - chunk_offset) as usize).min(CHUNK_SIZE);
        let mut chunk_buf = vec![0u8; chunk_len];

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

            file.seek(SeekFrom::Start(chunk_offset)).await.map_err(|e| {
                TgError::new(
                    TgErrorCode::Io,
                    format!("failed to seek to offset {chunk_offset}: {e}"),
                )
            })?;
            file.read_exact(&mut chunk_buf).await.map_err(|e| {
                TgError::new(
                    TgErrorCode::Io,
                    format!("failed to read chunk {part_idx} at offset {chunk_offset}: {e}"),
                )
            })?;

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
                Ok(true) => {
                    if let Some(ref mut ctx) = md5_ctx {
                        ctx.consume(&chunk_buf);
                    }
                    break;
                }
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

        transferred_bytes += chunk_len as u64;
        crate::core::traffic_governor::record_bytes(
            crate::core::traffic_governor::TransferDirection::Upload,
            chunk_len as u64,
        );

        let elapsed_ms = last_emit_time.elapsed().as_millis();
        if elapsed_ms >= 300 || transferred_bytes == file_size {
            let elapsed_sec = (elapsed_ms as f64 / 1000.0).max(0.001);
            let delta_bytes = transferred_bytes.saturating_sub(last_emit_bytes);
            let inst_speed = delta_bytes as f64 / elapsed_sec;

            last_emit_time = Instant::now();
            last_emit_bytes = transferred_bytes;

            let pct = if file_size > 0 {
                (transferred_bytes as f64 / file_size as f64 * 100.0).clamp(0.0, 100.0)
            } else {
                0.0
            };
            let remaining = file_size.saturating_sub(transferred_bytes);
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
                        "totalBytes": file_size,
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
                        "total": file_size,
                        "speed_mb_s": inst_speed / (1024.0 * 1024.0),
                        "eta_seconds": eta,
                        "phase": stage
                    }),
                );
            }
        }
    }

    tg_log::info(
        "uploader",
        "upload_ok",
        format!(
            "file='{}' uploaded {} bytes in {} parts",
            display_filename, transferred_bytes, total_parts
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

    let mut transferred_bytes: u64 = 0;
    let mut last_emit_time = Instant::now();
    let mut last_emit_bytes: u64 = 0;

    for part_idx in 0..total_parts {
        let expected_chunk_len = ((total_size - transferred_bytes) as usize).min(CHUNK_SIZE);
        let mut chunk_buf = vec![0u8; expected_chunk_len];

        // Read chunk from stream
        let mut read_bytes = 0usize;
        while read_bytes < expected_chunk_len {
            let n = reader.read(&mut chunk_buf[read_bytes..]).await.map_err(|e| {
                TgError::new(TgErrorCode::Io, format!("failed to read from stream: {e}"))
            })?;
            if n == 0 {
                break;
            }
            read_bytes += n;
        }
        chunk_buf.truncate(read_bytes);

        if chunk_buf.is_empty() {
            if part_idx == total_parts - 1 {
                break;
            } else {
                return Err(TgError::new(
                    TgErrorCode::Io,
                    format!("unexpected EOF in stream at part {part_idx}/{total_parts}"),
                ));
            }
        }

        let chunk_len = chunk_buf.len();

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
                Ok(true) => {
                    if let Some(ref mut ctx) = md5_ctx {
                        ctx.consume(&chunk_buf);
                    }
                    break;
                }
                Ok(false) => {
                    if attempt >= MAX_PART_RETRIES {
                        return Err(TgError::new(
                            TgErrorCode::Io,
                            format!("server failed to store stream part {part_idx} after {attempt} attempts"),
                        ));
                    }
                    tokio::time::sleep(Duration::from_millis(400 * attempt as u64)).await;
                }
                Err(err) => {
                    if attempt >= MAX_PART_RETRIES {
                        return Err(TgError::new(
                            TgErrorCode::Io,
                            format!("upload stream part {part_idx} failed: {err}"),
                        ));
                    }

                    match &err {
                        InvocationError::Rpc(rpc) if rpc.code == 420 => {
                            let wait_secs = rpc.value.unwrap_or(1) as u64;
                            tokio::time::sleep(Duration::from_secs(wait_secs + 1)).await;
                        }
                        InvocationError::Dropped => {
                            tokio::time::sleep(Duration::from_millis(300 * attempt as u64)).await;
                        }
                        _ => {
                            tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
                        }
                    }
                }
            }
        }

        transferred_bytes += chunk_len as u64;
        crate::core::traffic_governor::record_bytes(
            crate::core::traffic_governor::TransferDirection::Upload,
            chunk_len as u64,
        );

        let elapsed_ms = last_emit_time.elapsed().as_millis();
        if elapsed_ms >= 300 || transferred_bytes == total_size {
            let elapsed_sec = (elapsed_ms as f64 / 1000.0).max(0.001);
            let delta_bytes = transferred_bytes.saturating_sub(last_emit_bytes);
            let inst_speed = delta_bytes as f64 / elapsed_sec;

            last_emit_time = Instant::now();
            last_emit_bytes = transferred_bytes;

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
