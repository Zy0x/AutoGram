//! Grammers migration runner — Forward MVP + Clean Copy foundation.
//!
//! Clean Copy: download source media → 4-level dedupe → re-upload → ledger + resume.
//! Levels: Message ID, Telegram unique id (media fingerprint), SHA256, Filename+Size.
//! FloodWait: sleep and retry the same item.

use std::path::PathBuf;
use std::thread;
use std::time::Duration;

use serde::Serialize;

use super::grammers_ops::{self, resolve_sessions_dir};
use super::hash_util;
use super::jobs_db;
use super::session_guard::{self, SessionPurpose};
use super::telegram_ops::TelegramIdentity;
use super::tg_error::{TgError, TgErrorCode};
use super::tg_log;

const BACKEND: &str = "migration_run";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationRunResult {
    pub status: String,
    pub job_id: i64,
    pub execution_id: i64,
    pub forwarded: i64,
    pub skipped: i64,
    pub failed: i64,
    pub message: String,
    pub backend: String,
    pub mode: String,
}

fn is_clean_copy_mode(mode: &str) -> bool {
    let m = mode.to_ascii_lowercase();
    m.contains("clean") || m.contains("copy") || m.contains("reupload") || m.contains("re-upload")
}

fn flood_wait_secs(err: &str) -> Option<u64> {
    let low = err.to_ascii_lowercase();
    if !low.contains("flood") && !low.contains("wait") {
        return None;
    }
    // "wait 32s" / "FLOOD_WAIT_32" / "Tunggu 32 detik"
    for part in low.split(|c: char| !c.is_ascii_digit()) {
        if let Ok(n) = part.parse::<u64>() {
            if (1..3600).contains(&n) {
                return Some(n);
            }
        }
    }
    Some(30)
}

fn sleep_flood(secs: u64) {
    let secs = secs.clamp(1, 600);
    tg_log::warn(BACKEND, "flood_wait", format!("sleeping {secs}s"));
    thread::sleep(Duration::from_secs(secs));
}

/// Entry: choose Forward vs Clean Copy from job.transfer_mode.
pub fn run_job_forward_mvp(
    job_id: i64,
    api_id: i64,
    api_hash: &str,
    max_messages: usize,
) -> Result<MigrationRunResult, String> {
    let job = jobs_db::get_job(job_id)?.ok_or_else(|| format!("job {job_id} not found"))?;
    let mode = job
        .transfer_mode
        .clone()
        .unwrap_or_else(|| "Clean Copy".into());
    // The legacy Grammers helper accepts one identity only. Never pretend that
    // a cross-account Fast Forward is safe; route it to Clean Copy where the
    // destination account can be added explicitly by the next engine layer.
    if !is_clean_copy_mode(&mode) {
        if let Some(raw) = job.config_json.as_deref().and_then(|v| super::forwarder_contract::normalize_job_config_json(v).ok()) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
                let source_account = value.pointer("/source/account_id").and_then(|v| v.as_str()).unwrap_or("");
                let destination_account = value.pointer("/destination/account_id").and_then(|v| v.as_str()).unwrap_or("");
                if !source_account.is_empty() && !destination_account.is_empty() && source_account != destination_account {
                    return run_clean_copy(job_id, api_id, api_hash, max_messages);
                }
            }
        }
    }
    if is_clean_copy_mode(&mode) {
        run_clean_copy(job_id, api_id, api_hash, max_messages)
    } else {
        run_forward(job_id, api_id, api_hash, max_messages)
    }
}

/// Validate a migration against the live Grammers session without creating an
/// execution row, writing the dedupe ledger, forwarding, downloading, or
/// uploading anything.  Reading one item from each peer also proves that both
/// access hashes resolve for the selected account.
pub fn dry_run_job(job_id: i64, api_id: i64, api_hash: &str) -> Result<MigrationRunResult, String> {
    let _ = jobs_db::log_job_event(job_id, "DRY_RUN", "Validating source and destination", None);
    let job = jobs_db::get_job(job_id)?.ok_or_else(|| format!("job {job_id} not found"))?;
    let source = job
        .source_entity_id
        .clone()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "source_entity_id missing".to_string())?;
    let dest = job
        .target_entity_id
        .clone()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "target_entity_id missing".to_string())?;
    let session = job
        .profile_name
        .clone()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "session/profile_name missing".to_string())?;
    let sessions = resolve_sessions_dir(None);
    std::env::set_var("AUTOGRAM_SESSIONS_DIR", sessions.display().to_string());
    let identity = TelegramIdentity {
        session: session.clone(),
        api_id,
        api_hash: api_hash.to_string(),
    };
    let owner_id = format!("migration-job-{job_id}-dry-run");
    let _guard =
        session_guard::SessionGuardToken::acquire(&session, &owner_id, SessionPurpose::Migration)
            .map_err(|e| e.user_message())?;

    let source_probe = grammers_ops::list_media_blocking(&sessions, &identity, &source, 1, None)
        .map_err(|e| e.user_message())?;
    let destination_probe = grammers_ops::list_media_blocking(&sessions, &identity, &dest, 1, None)
        .map_err(|e| e.user_message())?;

    tg_log::info(
        BACKEND,
        "dry_run_ok",
        format!(
            "job={job_id} source_visible={} destination_visible={}",
            source_probe.files.len(),
            destination_probe.files.len()
        ),
    );
    let _ = jobs_db::log_job_event(
        job_id,
        "DRY_RUN",
        "Validation completed without changing Telegram data",
        None,
    );

    Ok(MigrationRunResult {
        status: "success".into(),
        job_id,
        execution_id: 0,
        forwarded: 0,
        skipped: 0,
        failed: 0,
        message: "Dry-run validated the Grammers session, source, and destination; no Telegram data was changed.".into(),
        backend: "grammers".into(),
        mode: "dry_run".into(),
    })
}

fn run_forward(
    job_id: i64,
    api_id: i64,
    api_hash: &str,
    max_messages: usize,
) -> Result<MigrationRunResult, String> {
    let job = jobs_db::get_job(job_id)?.ok_or_else(|| format!("job {job_id} not found"))?;
    let source = job
        .source_entity_id
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "source_entity_id missing".to_string())?;
    let dest = job
        .target_entity_id
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "target_entity_id missing".to_string())?;
    let session = job
        .profile_name
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "session/profile_name missing".to_string())?;
    let canonical = job.config_json.as_deref().and_then(|raw| super::forwarder_contract::normalize_job_config_json(raw).ok()).and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
    let source_account_id = canonical.as_ref().and_then(|v| v.pointer("/source/account_id")).and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or(&session).to_string();
    let destination_account_id = canonical.as_ref().and_then(|v| v.pointer("/destination/account_id")).and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or(&session).to_string();
    let destination_topic_id = canonical.as_ref().and_then(|v| v.pointer("/destination/topic_id")).and_then(|v| v.as_i64());

    let exec_id = jobs_db::start_execution(job_id)?;
    let _ = jobs_db::update_execution_status(exec_id, "RUNNING", Some(0), None, None);
    let _ = jobs_db::log_job_event(job_id, "RUNNING", "Native Grammers forward started", None);

    let sessions = resolve_sessions_dir(None);
    std::env::set_var("AUTOGRAM_SESSIONS_DIR", sessions.display().to_string());
    let identity = TelegramIdentity { session: session.clone(), api_id, api_hash: api_hash.to_string() };
    let owner_id = format!("migration-job-{job_id}-exec-{exec_id}");
    let _guard = session_guard::SessionGuardToken::acquire(&session, &owner_id, SessionPurpose::Migration)
        .map_err(|e| e.user_message())?;

    let mut current_offset = jobs_db::last_resumable_msg_id(job_id).ok().flatten();
    let batch_size = if max_messages > 0 {
        max_messages.clamp(1, 200)
    } else {
        100
    };
    let max_total = if max_messages > 0 {
        max_messages
    } else {
        usize::MAX
    };

    let result = (|| -> Result<(i64, i64), String> {
        let mut forwarded = 0i64;
        let mut skipped = 0i64;

        loop {
            if jobs_db::is_execution_cancelled(exec_id) {
                return Err("Job execution dibatalkan oleh pengguna".into());
            }

            let fetch_cap = (max_total - (forwarded + skipped) as usize).min(batch_size);
            if fetch_cap == 0 {
                break;
            }

            let _ = jobs_db::update_execution_status(
                exec_id,
                "SCANNING",
                Some(forwarded + skipped),
                None,
                current_offset,
            );
            let media = grammers_ops::list_media_blocking(
                &sessions,
                &identity,
                &source,
                fetch_cap,
                current_offset,
            )
            .map_err(|e| e.user_message())?;

            let ids: Vec<i64> = media.files.iter().map(|f| f.id).collect();
            if ids.is_empty() {
                break;
            }

            for chunk in ids.chunks(50) {
                if jobs_db::is_execution_cancelled(exec_id) {
                    return Err("Job execution dibatalkan oleh pengguna".into());
                }

                // Level-1 dedupe: skip already ledgered source msg ids
                for &source_id in chunk {
                    let _ = jobs_db::upsert_forwarder_task(exec_id, source_id, "DEDUPLICATING", "QUEUED");
                }
                let fresh: Vec<i64> = chunk
                    .iter()
                    .copied()
                    .filter(|&id| {
                        !jobs_db::ledger_check(job_id, id, None, None, None, None)
                            .map(|h| h.by_source_msg)
                            .unwrap_or(false)
                    })
                    .collect();
                skipped += (chunk.len() - fresh.len()) as i64;
                for &source_id in chunk {
                    if !fresh.contains(&source_id) {
                        if let Ok(task_id) = jobs_db::upsert_forwarder_task(exec_id, source_id, "DEDUPLICATING", "SKIPPED") {
                            let _ = jobs_db::complete_forwarder_task(task_id, "SKIPPED", Some("DUPLICATE_MESSAGE_ID"), None);
                        }
                    }
                }
                if fresh.is_empty() {
                    continue;
                }
                let _ = jobs_db::update_execution_status(
                    exec_id,
                    "FORWARDING",
                    Some(forwarded + skipped),
                    Some((forwarded + skipped) + (ids.len() as i64)),
                    current_offset,
                );
                let mut attempt = 0u32;
                loop {
                    attempt += 1;
                    match grammers_ops::forward_messages_blocking(
                        &sessions, &identity, &source, &dest, &fresh,
                    ) {
                        Ok(n) => {
                            forwarded += n as i64;
                            for &sid in &fresh {
                                let _ = jobs_db::ledger_insert(
                                    job_id, sid, None, None, None, None, None,
                                );
                                if let Ok(task_id) = jobs_db::upsert_forwarder_task(exec_id, sid, "COMMITTING", "COMPLETED") {
                                    let _ = jobs_db::complete_forwarder_task(task_id, "COMPLETED", None, None);
                                }
                                let _ = jobs_db::forwarder_ledger_insert(job_id, &source_account_id, &destination_account_id, &dest, destination_topic_id, sid, None, None, None, None, None, "transferred");
                            }
                            break;
                        }
                        Err(e) => {
                            let msg = e.user_message();
                            if let Some(secs) = flood_wait_secs(&msg) {
                                if attempt < 5 {
                                    sleep_flood(secs);
                                    continue;
                                }
                            }
                            return Err(msg);
                        }
                    }
                }
                let _ = jobs_db::update_execution_status(
                    exec_id,
                    "RUNNING",
                    Some(forwarded + skipped),
                    Some((forwarded + skipped) + (ids.len() as i64)),
                    chunk.last().copied(),
                );
            }

            if let Some(&last_id) = ids.last() {
                current_offset = Some(last_id);
            } else {
                break;
            }

            if max_messages > 0 && (forwarded + skipped) as usize >= max_messages {
                break;
            }
        }
        Ok((forwarded, skipped))
    })();

    finish_result(job_id, exec_id, &session, "forward", result)
}

fn run_clean_copy(
    job_id: i64,
    api_id: i64,
    api_hash: &str,
    max_messages: usize,
) -> Result<MigrationRunResult, String> {
    let job = jobs_db::get_job(job_id)?.ok_or_else(|| format!("job {job_id} not found"))?;
    let source = job
        .source_entity_id
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "source_entity_id missing".to_string())?;
    let dest = job
        .target_entity_id
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "target_entity_id missing".to_string())?;
    let session = job
        .profile_name
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "session/profile_name missing".to_string())?;
    let canonical = job.config_json.as_deref().and_then(|raw| super::forwarder_contract::normalize_job_config_json(raw).ok()).and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
    let forwarder_config = job.config_json.as_deref()
        .and_then(|raw| super::forwarder_contract::normalize_job_config_v2(serde_json::from_str(raw).ok()?).ok());
    let source_account_id = canonical.as_ref().and_then(|v| v.pointer("/source/account_id")).and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or(&session).to_string();
    let destination_account_id = canonical.as_ref().and_then(|v| v.pointer("/destination/account_id")).and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or(&session).to_string();
    let destination_topic_id = canonical.as_ref().and_then(|v| v.pointer("/destination/topic_id")).and_then(|v| v.as_i64());

    let exec_id = jobs_db::start_execution(job_id)?;
    let _ = jobs_db::update_execution_status(exec_id, "RUNNING", Some(0), None, None);
    let _ = jobs_db::log_job_event(
        job_id,
        "RUNNING",
        "Native Grammers clean copy started",
        None,
    );

    let sessions = resolve_sessions_dir(None);
    std::env::set_var("AUTOGRAM_SESSIONS_DIR", sessions.display().to_string());
    let source_session = if source_account_id.is_empty() { session.clone() } else { source_account_id.clone() };
    let destination_session = if destination_account_id.is_empty() { session.clone() } else { destination_account_id.clone() };
    let source_identity = TelegramIdentity { session: source_session.clone(), api_id, api_hash: api_hash.to_string() };
    let destination_identity = TelegramIdentity { session: destination_session.clone(), api_id, api_hash: api_hash.to_string() };
    let owner_id = format!("migration-job-{job_id}-exec-{exec_id}");
    let _source_guard = session_guard::SessionGuardToken::acquire(&source_session, &owner_id, SessionPurpose::Migration)
        .map_err(|e| e.user_message())?;
    let _destination_guard = if destination_session != source_session {
        Some(session_guard::SessionGuardToken::acquire(&destination_session, &owner_id, SessionPurpose::Migration)
            .map_err(|e| e.user_message())?)
    } else { None };

    let mut current_offset = jobs_db::last_resumable_msg_id(job_id).ok().flatten();
    let batch_size = if max_messages > 0 {
        max_messages.clamp(1, 200)
    } else {
        100
    };
    let max_total = if max_messages > 0 {
        max_messages
    } else {
        usize::MAX
    };

    let work_dir = sessions
        .parent()
        .map(|p| {
            p.join("cache")
                .join("clean_copy")
                .join(format!("job_{job_id}"))
        })
        .unwrap_or_else(|| PathBuf::from(format!("clean_copy_job_{job_id}")));
    let _ = std::fs::create_dir_all(&work_dir);

    let result = (|| -> Result<(i64, i64, i64), String> {
        let mut uploaded = 0i64;
        let mut skipped = 0i64;
        let mut failed = 0i64;

        loop {
            if jobs_db::is_execution_cancelled(exec_id) {
                return Err("Job execution dibatalkan oleh pengguna".into());
            }

            let fetch_cap = (max_total - (uploaded + skipped + failed) as usize).min(batch_size);
            if fetch_cap == 0 {
                break;
            }

            let _ = jobs_db::update_execution_status(
                exec_id,
                "SCANNING",
                Some(uploaded + skipped + failed),
                None,
                current_offset,
            );
            let media = grammers_ops::list_media_blocking(
                &sessions,
                &source_identity,
                &source,
                fetch_cap,
                current_offset,
            )
            .map_err(|e| e.user_message())?;

            let files = media.files;
            if files.is_empty() {
                break;
            }

            for (idx, row) in files.iter().enumerate() {
                if jobs_db::is_execution_cancelled(exec_id) {
                    return Err("Job execution dibatalkan oleh pengguna".into());
                }

                let source_msg_id = row.id;
                let filename = row.name.clone();
                let size = row.size as i64;
                let task_id = jobs_db::upsert_forwarder_task(exec_id, source_msg_id, "QUEUED", "QUEUED").ok();

                if let Some(ref cfg) = forwarder_config {
                    match super::forwarder_engine::evaluate_item(cfg, row) {
                        super::forwarder_engine::ItemDecision::Skip(reason) => {
                            skipped += 1;
                            if let Some(id) = task_id { let _ = jobs_db::complete_forwarder_task(id, "SKIPPED", Some(reason), None); }
                            let _ = jobs_db::log_job_event(job_id, "FILTERING", &format!("source_message_id={source_msg_id} skipped: {reason}"), None);
                            continue;
                        }
                        super::forwarder_engine::ItemDecision::AskUser(reason) => {
                            let payload = serde_json::json!({"source_message_id": source_msg_id, "filename": filename, "size": size}).to_string();
                            let _ = jobs_db::insert_decision(job_id, Some(exec_id), task_id, "RESTRICTION", reason, &payload);
                            if let Some(id) = task_id { let _ = jobs_db::complete_forwarder_task(id, "WAITING_USER", Some(reason), None); }
                            return Err(format!("USER_DECISION_REQUIRED:{source_msg_id}"));
                        }
                        super::forwarder_engine::ItemDecision::Transfer => {}
                    }
                }
                let tg_unique = format!(
                    "{}:{}:{}:{}",
                    row.id,
                    row.mime_type.as_deref().unwrap_or(""),
                    size,
                    filename
                );

                // Level 1 — already processed message id
                let pre = jobs_db::forwarder_ledger_check(job_id, &source_account_id, &destination_account_id, &dest, destination_topic_id, source_msg_id, Some(&tg_unique), None, Some(&filename), Some(size))
                .unwrap_or_default();
                if pre.by_source_msg {
                    skipped += 1;
                    if let Some(id) = task_id { let _ = jobs_db::complete_forwarder_task(id, "SKIPPED", Some("DUPLICATE_MESSAGE_ID"), None); }
                    continue;
                }

                let dest_path =
                    work_dir.join(format!("{}_{}", source_msg_id, sanitize_name(&filename)));
                let dest_str = dest_path.to_string_lossy().to_string();

                // Download with FloodWait retry
                let _ = jobs_db::update_execution_status(
                    exec_id,
                    "DOWNLOADING",
                    Some(uploaded + skipped + failed),
                    Some((uploaded + skipped + failed) + (files.len() as i64)),
                    Some(source_msg_id),
                );
                let mut dl_ok = false;
                for attempt in 1..=5u32 {
                    if jobs_db::is_execution_cancelled(exec_id) {
                        let _ = std::fs::remove_file(&dest_path);
                        return Err("Job execution dibatalkan oleh pengguna".into());
                    }

                    match grammers_ops::download_file_blocking(
                        &sessions,
                        &source_identity,
                        &source,
                        source_msg_id,
                        &dest_str,
                    ) {
                        Ok(_) => {
                            dl_ok = true;
                            break;
                        }
                        Err(e) => {
                            let msg = e.user_message();
                            if let Some(secs) = flood_wait_secs(&msg) {
                                sleep_flood(secs);
                                continue;
                            }
                            if attempt >= 5 {
                                tg_log::error(BACKEND, "download_fail", &msg);
                                failed += 1;
                            }
                        }
                    }
                }
                if !dl_ok {
                    if let Some(id) = task_id { let _ = jobs_db::complete_forwarder_task(id, "FAILED", Some("DOWNLOAD_NOT_ALLOWED"), None); }
                    let _ = jobs_db::update_execution_status(
                        exec_id,
                        "RUNNING",
                        Some(uploaded + skipped + failed),
                        Some((uploaded + skipped + failed) + (files.len() as i64)),
                        Some(source_msg_id),
                    );
                    continue;
                }

                let hash = hash_util::sha256_file(&dest_str)
                    .map(|h| h.sha256)
                    .unwrap_or_default();

                // Levels 2–4 after hash known
                let hit = jobs_db::forwarder_ledger_check(job_id, &source_account_id, &destination_account_id, &dest, destination_topic_id, source_msg_id, Some(&tg_unique), if hash.is_empty() { None } else { Some(&hash) }, Some(&filename), Some(size))
                .unwrap_or_default();
                if hit.is_duplicate() {
                    skipped += 1;
                    let reason = if hit.by_telegram_unique { "DUPLICATE_UNIQUE_ID" } else if hit.by_sha256 { "DUPLICATE_SHA256" } else { "DUPLICATE_NAME_SIZE" };
                    if let Some(id) = task_id { let _ = jobs_db::complete_forwarder_task(id, "SKIPPED", Some(reason), None); }
                    let _ = std::fs::remove_file(&dest_path);
                    let _ = jobs_db::ledger_insert(
                        job_id,
                        source_msg_id,
                        None,
                        Some(&tg_unique),
                        if hash.is_empty() { None } else { Some(&hash) },
                        Some(&filename),
                        Some(size),
                    );
                    let _ = jobs_db::forwarder_ledger_insert(job_id, &source_account_id, &destination_account_id, &dest, destination_topic_id, source_msg_id, None, Some(&tg_unique), if hash.is_empty() { None } else { Some(&hash) }, Some(&filename), Some(size), "skipped_duplicate");
                    let _ = jobs_db::update_execution_status(
                        exec_id,
                        "RUNNING",
                        Some(uploaded + skipped + failed),
                        Some((uploaded + skipped + failed) + (files.len() as i64)),
                        Some(source_msg_id),
                    );
                    continue;
                }

                // Re-upload
                let _ = jobs_db::update_execution_status(
                    exec_id,
                    "UPLOADING",
                    Some(uploaded + skipped + failed),
                    Some((uploaded + skipped + failed) + (files.len() as i64)),
                    Some(source_msg_id),
                );
                let mut up_msg_id: Option<i64> = None;
                for attempt in 1..=5u32 {
                    if jobs_db::is_execution_cancelled(exec_id) {
                        let _ = std::fs::remove_file(&dest_path);
                        return Err("Job execution dibatalkan oleh pengguna".into());
                    }

                    match grammers_ops::upload_file_blocking(
                        &sessions,
                        &destination_identity,
                        &dest,
                        &dest_str,
                        "",
                        row.as_document,
                        true,
                        idx,
                    ) {
                        Ok(step) => {
                            up_msg_id = step.message_id.filter(|m| *m > 0);
                            uploaded += 1;
                            if let Some(id) = task_id {
                                let ids = serde_json::to_string(&up_msg_id.iter().copied().collect::<Vec<_>>()).unwrap_or_else(|_| "[]".into());
                                let _ = jobs_db::complete_forwarder_task(id, "COMPLETED", None, Some(&ids));
                            }
                            break;
                        }
                        Err(e) => {
                            let msg = e.user_message();
                            if let Some(secs) = flood_wait_secs(&msg) {
                                sleep_flood(secs);
                                continue;
                            }
                            if attempt >= 5 {
                                tg_log::error(BACKEND, "upload_fail", &msg);
                                failed += 1;
                                if let Some(id) = task_id { let _ = jobs_db::complete_forwarder_task(id, "FAILED", Some("DESTINATION_PERMISSION_DENIED"), None); }
                            }
                        }
                    }
                }

                let _ = jobs_db::ledger_insert(
                    job_id,
                    source_msg_id,
                    up_msg_id,
                    Some(&tg_unique),
                    if hash.is_empty() { None } else { Some(&hash) },
                    Some(&filename),
                    Some(size),
                );
                let _ = jobs_db::forwarder_ledger_insert(job_id, &source_account_id, &destination_account_id, &dest, destination_topic_id, source_msg_id, up_msg_id, Some(&tg_unique), if hash.is_empty() { None } else { Some(&hash) }, Some(&filename), Some(size), if up_msg_id.is_some() { "transferred" } else { "failed" });
                let _ = std::fs::remove_file(&dest_path);
                let _ = jobs_db::update_execution_status(
                    exec_id,
                    "RUNNING",
                    Some(uploaded + skipped + failed),
                    Some((uploaded + skipped + failed) + (files.len() as i64)),
                    Some(source_msg_id),
                );
                tg_log::info(
                    BACKEND,
                    "clean_item",
                    format!(
                        "job={job_id} idx={}/{} msg={} up={:?} skip_dup={}",
                        idx + 1,
                        files.len(),
                        source_msg_id,
                        up_msg_id,
                        hit.is_duplicate()
                    ),
                );
            }

            if let Some(last_row) = files.last() {
                current_offset = Some(last_row.id);
            } else {
                break;
            }

            if max_messages > 0 && (uploaded + skipped + failed) as usize >= max_messages {
                break;
            }
        }
        Ok((uploaded, skipped, failed))
    })();

    match result {
        Ok((uploaded, skipped, failed)) => {
            let status = if failed > 0 && uploaded == 0 {
                "FAILED"
            } else {
                "COMPLETED"
            };
            let _ = jobs_db::update_execution_status(
                exec_id,
                status,
                Some(uploaded + skipped + failed),
                Some(uploaded + skipped + failed),
                None,
            );
            let _ = jobs_db::log_job_event(
                job_id,
                status,
                &format!(
                    "Clean Copy finished: {uploaded} uploaded, {skipped} skipped, {failed} failed"
                ),
                None,
            );
            Ok(MigrationRunResult {
                status: if status == "COMPLETED" {
                    "success".into()
                } else {
                    "partial".into()
                },
                job_id,
                execution_id: exec_id,
                forwarded: uploaded,
                skipped,
                failed,
                message: format!(
                    "Clean Copy: {uploaded} uploaded, {skipped} skipped (dedupe), {failed} failed"
                ),
                backend: "grammers".into(),
                mode: "clean_copy".into(),
            })
        }
        Err(e) => {
            if e.starts_with("USER_DECISION_REQUIRED:") {
                let _ = jobs_db::update_execution_status(exec_id, "WAITING_USER", None, None, None);
                let _ = jobs_db::log_job_event(job_id, "WAITING_USER", &e, None);
                return Ok(MigrationRunResult { status: "waiting_user".into(), job_id, execution_id: exec_id, forwarded: 0, skipped: 0, failed: 0, message: "User decision required".into(), backend: "grammers".into(), mode: "clean_copy".into() });
            }
            let cancelled = e.to_ascii_lowercase().contains("dibatalkan");
            let _ = jobs_db::update_execution_status(
                exec_id,
                if cancelled { "CANCELLED" } else { "FAILED" },
                None,
                None,
                None,
            );
            let _ = jobs_db::log_job_event(
                job_id,
                if cancelled { "CANCELLED" } else { "FAILED" },
                &e,
                None,
            );
            tg_log::error(BACKEND, "clean_copy_fail", &e);
            if e.to_ascii_lowercase().contains("not authorized") {
                return Err(format!(
                    "Session '{session}' not authorized di Grammers. Login ulang di Accounts. Detail: {e}"
                ));
            }
            Err(e)
        }
    }
}

fn finish_result(
    job_id: i64,
    exec_id: i64,
    session: &str,
    mode: &str,
    result: Result<(i64, i64), String>,
) -> Result<MigrationRunResult, String> {
    match result {
        Ok((forwarded, skipped)) => {
            let _ = jobs_db::update_execution_status(
                exec_id,
                "COMPLETED",
                Some(forwarded + skipped),
                Some(forwarded + skipped),
                None,
            );
            let _ = jobs_db::log_job_event(
                job_id,
                "COMPLETED",
                &format!("Forward finished: {forwarded} sent, {skipped} skipped"),
                None,
            );
            tg_log::info(
                BACKEND,
                "run_ok",
                format!("job={job_id} exec={exec_id} forwarded={forwarded} skipped={skipped}"),
            );
            Ok(MigrationRunResult {
                status: "success".into(),
                job_id,
                execution_id: exec_id,
                forwarded,
                skipped,
                failed: 0,
                message: format!(
                    "Forwarded {forwarded} messages, skipped {skipped} (Grammers {mode})"
                ),
                backend: "grammers".into(),
                mode: mode.into(),
            })
        }
        Err(e) => {
            let cancelled = e.to_ascii_lowercase().contains("dibatalkan");
            let _ = jobs_db::update_execution_status(
                exec_id,
                if cancelled { "CANCELLED" } else { "FAILED" },
                None,
                None,
                None,
            );
            let _ = jobs_db::log_job_event(
                job_id,
                if cancelled { "CANCELLED" } else { "FAILED" },
                &e,
                None,
            );
            tg_log::error(BACKEND, "run_fail", &e);
            if e.to_ascii_lowercase().contains("not authorized") {
                return Err(format!(
                    "Session '{session}' not authorized di Grammers. Login ulang di Accounts. Detail: {e}"
                ));
            }
            Err(e)
        }
    }
}

fn sanitize_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(80)
        .collect();
    if s.is_empty() {
        "file.bin".into()
    } else {
        s
    }
}

#[allow(dead_code)]
fn _code_ok() -> TgErrorCode {
    TgErrorCode::Internal
}

#[allow(dead_code)]
fn _tg_err_ok() -> TgError {
    TgError::new(TgErrorCode::Internal, "ok")
}
