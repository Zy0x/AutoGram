use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use parking_lot::RwLock;
use sha2::{Digest, Sha256};
use tauri::Emitter;

use super::models::{
    RemotePreflightReport, RemotePreflightRequest, RemoteRecoveryItem, RemoteTransferEvent,
    RemoteTransferJob, RemoteTransferMetrics, RemoteTransferMode, RemoteTransferState,
    StorageLocalPolicy,
};
use super::spool::{
    acquire_job_lock, calculate_required_disk_space, cleanup_job_spool, get_available_disk_space,
    job_manifest_path, job_part_path, release_job_lock, resolve_spool_root, write_manifest,
    SpoolManifest,
};
use super::store::RemoteTransferStore;
use crate::core::grammers_ops::media_transfer::{
    remote_extension, remote_head, REMOTE_CLOUD_FETCH_MAX_BYTES,
};
use crate::core::media_prep::{create_resilient_http_agent, download_remote_thumbnail};
use crate::core::path_policy;
use crate::core::telegram_ops::{TelegramIdentity, UploadStepResult};

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub struct RemoteTransferEngine;

impl RemoteTransferEngine {
    pub fn preflight(request: &RemotePreflightRequest) -> Result<RemotePreflightReport, String> {
        let url = request.url.trim();
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err("Invalid URL: must start with http:// or https://".to_string());
        }

        let (size, content_type) = remote_head(url).map_err(|e| e.user_message())?;
        let ext = remote_extension(url, &content_type);
        let filename = if let Some(ref custom) = request.custom_filename {
            if !custom.trim().is_empty() {
                custom.trim().to_string()
            } else {
                format!("Remote_Media.{ext}")
            }
        } else {
            let seg = url.split('?').next().unwrap_or(url);
            let raw = seg.rsplit('/').next().unwrap_or("Remote_Media");
            if raw.contains('.') {
                raw.to_string()
            } else {
                format!("{raw}.{ext}")
            }
        };

        let spool_root = resolve_spool_root();
        let required_disk = calculate_required_disk_space(size);
        let available_disk = get_available_disk_space(&spool_root);
        let has_sufficient_disk = available_disk.map(|a| a >= required_disk).unwrap_or(true);

        let requested_mode = request
            .mode
            .as_deref()
            .map(RemoteTransferMode::from_str_lenient)
            .unwrap_or(RemoteTransferMode::Auto);

        let requested_policy = request
            .storage_policy
            .as_deref()
            .map(StorageLocalPolicy::from_str_lenient)
            .unwrap_or(StorageLocalPolicy::Telegram);

        let cloud_eligible = size.is_some_and(|s| s <= REMOTE_CLOUD_FETCH_MAX_BYTES)
            && !url.contains("twimg.com")
            && !url.contains("tiktok.com");

        let recommended_mode = if !has_sufficient_disk && cloud_eligible {
            RemoteTransferMode::DirectCloudFetch
        } else {
            RemoteTransferMode::StorageLocal
        };

        let resolved_mode = match requested_mode {
            RemoteTransferMode::Auto => recommended_mode,
            other => other,
        };

        let download_quota = size.unwrap_or(0);
        let upload_quota = if resolved_mode == RemoteTransferMode::DirectCloudFetch {
            0
        } else {
            size.unwrap_or(0)
        };

        Ok(RemotePreflightReport {
            url: url.to_string(),
            filename,
            mime_type: content_type,
            size_bytes: size,
            etag: None,
            thumbnail_url: None,
            recommended_mode: recommended_mode.as_str().to_string(),
            resolved_mode: resolved_mode.as_str().to_string(),
            storage_policy: requested_policy.as_str().to_string(),
            spool_path: spool_root.to_string_lossy().to_string(),
            required_disk_bytes: required_disk,
            available_disk_bytes: available_disk,
            has_sufficient_disk,
            estimated_download_quota_bytes: download_quota,
            estimated_upload_quota_bytes: upload_quota,
            supports_http_range_resume: true,
            cloud_fetch_eligible: cloud_eligible,
            retention_policy_label: match requested_policy {
                StorageLocalPolicy::CustomDisk => "Persist to local disk",
                StorageLocalPolicy::DiskAndTelegram => "Keep local copy & upload to Telegram",
                StorageLocalPolicy::Telegram => "Upload to Telegram then delete spool",
            }
            .to_string(),
        })
    }

    pub fn execute_job_sync(
        job_id: &str,
        identity: &TelegramIdentity,
        app: Option<&tauri::AppHandle>,
    ) -> Result<UploadStepResult, String> {
        let mut job = RemoteTransferStore::get_job(job_id)?
            .ok_or_else(|| format!("Job {job_id} not found"))?;

        let _lock = acquire_job_lock(job_id)?;
        RemoteTransferStore::append_event(job_id, "started", None)?;

        match job.mode {
            RemoteTransferMode::DirectCloudFetch => {
                Self::execute_cloud_fetch(&mut job, identity, app)
            }
            RemoteTransferMode::StorageLocal | RemoteTransferMode::Auto => {
                Self::execute_storage_local(&mut job, identity, app)
            }
        }
    }

    fn execute_cloud_fetch(
        job: &mut RemoteTransferJob,
        identity: &TelegramIdentity,
        app: Option<&tauri::AppHandle>,
    ) -> Result<UploadStepResult, String> {
        RemoteTransferStore::update_job_state(&job.job_id, RemoteTransferState::CloudSubmitting, None)?;
        emit_progress(app, &job.job_id, "cloud_submitting", 10.0, 0, job.source_size.unwrap_or(0), 0.0, 0.0);

        let sessions = crate::core::grammers_ops::resolve_sessions_dir(None);
        let dest = job.destination_id.as_deref().unwrap_or("me");
        let caption = job.source_filename.as_deref().unwrap_or("Remote Media");

        match crate::core::grammers_ops::upload_remote_url_blocking_topic_with_app(
            &sessions,
            identity,
            dest,
            &job.source_url,
            caption,
            false,
            false,
            false,
            0,
            job.destination_topic_id,
            None,
            app.cloned(),
            Some(job.job_id.clone()),
            "cloud_fetch",
            job.thumbnail_url.as_deref(),
        ) {
            Ok(result) => {
                RemoteTransferStore::mark_job_completed(&job.job_id, result.message_id, None)?;
                RemoteTransferStore::append_event(&job.job_id, "done", None)?;
                emit_progress(app, &job.job_id, "done", 100.0, job.source_size.unwrap_or(0), job.source_size.unwrap_or(0), 0.0, 0.0);
                release_job_lock(&job.job_id);
                Ok(result)
            }
            Err(e) => {
                // Auto fallback to Storage Local if cloud fetch fails
                let err_msg = e.user_message();
                RemoteTransferStore::append_event(&job.job_id, "cloud_failed_fallback_local", Some(&err_msg))?;
                job.mode = RemoteTransferMode::StorageLocal;
                RemoteTransferStore::insert_job(job)?;
                Self::execute_storage_local(job, identity, app)
            }
        }
    }

    fn execute_storage_local(
        job: &mut RemoteTransferJob,
        identity: &TelegramIdentity,
        app: Option<&tauri::AppHandle>,
    ) -> Result<UploadStepResult, String> {
        let part_p = job_part_path(&job.job_id);
        let manifest_p = job_manifest_path(&job.job_id);

        // 1. Reserving Disk & Pre-check
        RemoteTransferStore::update_job_state(&job.job_id, RemoteTransferState::ReservingDisk, None)?;
        let required_space = calculate_required_disk_space(job.source_size);
        if let Some(avail) = get_available_disk_space(&resolve_spool_root()) {
            if avail < required_space {
                let err = format!("Insufficient disk space: required {required_space} bytes, available {avail} bytes");
                RemoteTransferStore::update_job_state(&job.job_id, RemoteTransferState::Failed, Some(&err))?;
                release_job_lock(&job.job_id);
                return Err(err);
            }
        }

        // 2. Resumable HTTP Range Download
        RemoteTransferStore::update_job_state(&job.job_id, RemoteTransferState::Downloading, None)?;
        let existing_bytes = fs::metadata(&part_p).map(|m| m.len()).unwrap_or(0);
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .open(&part_p)
            .map_err(|e| format!("open part file: {e}"))?;

        if existing_bytes > 0 {
            file.seek(SeekFrom::Start(existing_bytes))
                .map_err(|e| format!("seek part file: {e}"))?;
        }

        let agent = create_resilient_http_agent();
        let mut req = agent.get(&job.source_url);
        req = req.set(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 AutoGram/4.0",
        );
        req = req.set("Accept", "*/*");
        if job.source_url.contains("twimg.com") || job.source_url.contains("x.com") || job.source_url.contains("twitter.com") {
            req = req.set("Referer", "https://x.com/");
        } else if job.source_url.contains("pixiv.net") || job.source_url.contains("pximg.net") {
            req = req.set("Referer", "https://www.pixiv.net/");
        } else if job.source_url.contains("tiktok.com") || job.source_url.contains("tikwm.com") {
            req = req.set("Referer", "https://www.tiktok.com/");
        }

        if existing_bytes > 0 {
            req = req.set("Range", &format!("bytes={existing_bytes}-"));
            if let Some(ref etag) = job.source_etag {
                req = req.set("If-Range", etag);
            }
        }

        let resp = req.call().map_err(|e| format!("download request failed: {e}"))?;
        let status = resp.status();

        let total_size = if status == 206 {
            // Partial content resumed
            let content_len = resp.header("content-length").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
            existing_bytes + content_len
        } else {
            // Full content restarted
            if existing_bytes > 0 {
                let _ = file.set_len(0);
                let _ = file.seek(SeekFrom::Start(0));
            }
            resp.header("content-length").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0)
        };

        job.source_size = Some(total_size);
        if let Some(etag) = resp.header("etag") {
            job.source_etag = Some(etag.to_string());
        }
        if let Some(lm) = resp.header("last-modified") {
            job.source_last_modified = Some(lm.to_string());
        }

        let mut manifest = SpoolManifest {
            job_id: job.job_id.clone(),
            source_url: job.source_url.clone(),
            filename: job.source_filename.clone().unwrap_or_else(|| "Remote_Media.mp4".into()),
            total_size: Some(total_size),
            downloaded_bytes: existing_bytes,
            etag: job.source_etag.clone(),
            last_modified: job.source_last_modified.clone(),
            created_at_ms: job.created_at_ms,
            updated_at_ms: now_ms(),
            status: "downloading".into(),
            storage_policy: job.storage_policy.as_str().into(),
            custom_disk_path: job.custom_disk_path.clone(),
        };
        let _ = write_manifest(&manifest);

        let mut reader = resp.into_reader();
        let mut buf = [0u8; 64 * 1024];
        let mut downloaded = if status == 206 { existing_bytes } else { 0 };
        let mut last_emit = Instant::now();
        let mut last_bytes = downloaded;

        loop {
            // Check cancellation / pause
            if crate::core::job_queue::is_transfer_cancelled(&job.job_id) {
                RemoteTransferStore::update_job_state(&job.job_id, RemoteTransferState::Cancelled, None)?;
                cleanup_job_spool(&job.job_id);
                release_job_lock(&job.job_id);
                return Err("Transfer cancelled by user".into());
            }

            let n = reader.read(&mut buf).map_err(|e| format!("read error: {e}"))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n]).map_err(|e| format!("write part error: {e}"))?;
            downloaded += n as u64;

            if last_emit.elapsed() >= Duration::from_millis(250) {
                let elapsed_sec = last_emit.elapsed().as_secs_f64();
                let speed_mb_s = if elapsed_sec > 0.0 {
                    (downloaded.saturating_sub(last_bytes) as f64) / (1024.0 * 1024.0 * elapsed_sec)
                } else {
                    0.0
                };
                let pct = if total_size > 0 {
                    (downloaded as f64 / total_size as f64 * 50.0).min(50.0)
                } else {
                    25.0
                };
                emit_progress(app, &job.job_id, "downloading", pct, downloaded, total_size, speed_mb_s, 0.0);
                let _ = RemoteTransferStore::update_job_download_progress(&job.job_id, downloaded, Some(total_size));
                manifest.downloaded_bytes = downloaded;
                manifest.updated_at_ms = now_ms();
                let _ = write_manifest(&manifest);
                last_emit = Instant::now();
                last_bytes = downloaded;
            }
        }

        let _ = file.flush();
        drop(file);

        // 3. Staged & Verifying
        RemoteTransferStore::update_job_state(&job.job_id, RemoteTransferState::Staged, None)?;
        manifest.status = "staged".into();
        let _ = write_manifest(&manifest);

        // 4. Handle Custom Disk storage if requested
        if let Some(ref dest_dir) = job.custom_disk_path {
            if job.storage_policy == StorageLocalPolicy::CustomDisk
                || job.storage_policy == StorageLocalPolicy::DiskAndTelegram
            {
                let target_dir = PathBuf::from(dest_dir);
                let _ = fs::create_dir_all(&target_dir);
                let final_target = target_dir.join(&manifest.filename);
                if job.storage_policy == StorageLocalPolicy::CustomDisk {
                    let _ = fs::rename(&part_p, &final_target);
                } else {
                    let _ = fs::copy(&part_p, &final_target);
                }
            }
        }

        if job.storage_policy == StorageLocalPolicy::CustomDisk {
            RemoteTransferStore::mark_job_completed(&job.job_id, None, None)?;
            cleanup_job_spool(&job.job_id);
            release_job_lock(&job.job_id);
            emit_progress(app, &job.job_id, "done", 100.0, downloaded, total_size, 0.0, 0.0);
            return Ok(UploadStepResult {
                status: "done".into(),
                message_id: None,
                error: None,
                index: 0,
                backend: Some("custom_disk".into()),
            });
        }

        // 5. Uploading to Telegram
        RemoteTransferStore::update_job_state(&job.job_id, RemoteTransferState::Uploading, None)?;
        manifest.status = "uploading".into();
        let _ = write_manifest(&manifest);

        let sessions = crate::core::grammers_ops::resolve_sessions_dir(None);
        let dest = job.destination_id.as_deref().unwrap_or("me");
        let caption = job.source_filename.as_deref().unwrap_or(&manifest.filename);

        let part_str = part_p.to_string_lossy().to_string();
        let upload_res = crate::core::grammers_ops::media_transfer::upload_file_blocking_topic_with_app(
            &sessions,
            identity,
            dest,
            &part_str,
            caption,
            false,
            false,
            0,
            job.destination_topic_id,
            app.cloned(),
            Some(job.job_id.clone()),
        );

        match upload_res {
            Ok(result) => {
                RemoteTransferStore::mark_job_completed(&job.job_id, result.message_id, None)?;
                manifest.status = "done".into();
                let _ = write_manifest(&manifest);

                // Auto-cleanup spool if retention policy is Telegram (default)
                if job.storage_policy == StorageLocalPolicy::Telegram {
                    cleanup_job_spool(&job.job_id);
                }
                release_job_lock(&job.job_id);
                emit_progress(app, &job.job_id, "done", 100.0, total_size, total_size, 0.0, 0.0);
                Ok(result)
            }
            Err(e) => {
                let err_msg = e.user_message();
                RemoteTransferStore::update_job_state(&job.job_id, RemoteTransferState::Failed, Some(&err_msg))?;
                manifest.status = "failed".into();
                let _ = write_manifest(&manifest);
                release_job_lock(&job.job_id);
                Err(err_msg)
            }
        }
    }

    pub fn pause_job(job_id: &str) -> Result<(), String> {
        RemoteTransferStore::update_job_state(job_id, RemoteTransferState::Paused, None)?;
        RemoteTransferStore::append_event(job_id, "paused", None)?;
        release_job_lock(job_id);
        Ok(())
    }

    pub fn cancel_job(job_id: &str) -> Result<(), String> {
        RemoteTransferStore::update_job_state(job_id, RemoteTransferState::Cancelled, None)?;
        RemoteTransferStore::append_event(job_id, "cancelled", None)?;
        cleanup_job_spool(job_id);
        release_job_lock(job_id);
        Ok(())
    }

    pub fn cleanup_job(job_id: &str) -> Result<(), String> {
        cleanup_job_spool(job_id);
        release_job_lock(job_id);
        Ok(())
    }
}

fn emit_progress(
    app: Option<&tauri::AppHandle>,
    job_id: &str,
    phase: &str,
    percent: f64,
    transferred: u64,
    total: u64,
    dl_speed: f64,
    up_speed: f64,
) {
    if let Some(app_h) = app {
        let _ = app_h.emit(
            "transfer-event",
            serde_json::json!({
                "type": "RemoteTransferProgress",
                "jobId": job_id,
                "phase": phase,
                "percent": percent,
                "transferred": transferred,
                "total": total,
                "downloadSpeedMbS": dl_speed,
                "uploadSpeedMbS": up_speed
            }),
        );
        let _ = app_h.emit(
            "transfer-event",
            serde_json::json!({
                "type": "StudioProgress",
                "item_index": 0,
                "percent": percent,
                "transferred": transferred,
                "total": total,
                "phase": phase
            }),
        );
    }
}
