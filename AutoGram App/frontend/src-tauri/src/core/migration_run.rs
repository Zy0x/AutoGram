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
    if is_clean_copy_mode(&mode) {
        run_clean_copy(job_id, api_id, api_hash, max_messages)
    } else {
        run_forward(job_id, api_id, api_hash, max_messages)
    }
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

    let exec_id = jobs_db::start_execution(job_id)?;
    let _ = jobs_db::update_execution_status(exec_id, "RUNNING", Some(0), None, None);

    let sessions = resolve_sessions_dir(None);
    std::env::set_var("AUTOGRAM_SESSIONS_DIR", sessions.display().to_string());
    let identity = TelegramIdentity {
        session: session.clone(),
        api_id,
        api_hash: api_hash.to_string(),
    };

    let owner_id = format!("migration-job-{job_id}-exec-{exec_id}");
    let _guard = session_guard::SessionGuardToken::acquire(
        &session,
        &owner_id,
        SessionPurpose::Migration,
    )
    .map_err(|e| e.user_message())?;

    let resume_from = jobs_db::last_resumable_msg_id(job_id).ok().flatten();
    let cap = max_messages.clamp(1, 500);
    let result = (|| -> Result<(i64, i64), String> {
        let media = grammers_ops::list_media_blocking(
            &sessions,
            &identity,
            &source,
            cap,
            resume_from,
        )
        .map_err(|e| e.user_message())?;
        let ids: Vec<i64> = media.files.iter().map(|f| f.id).collect();
        if ids.is_empty() {
            return Ok((0, 0));
        }
        let mut forwarded = 0i64;
        let mut skipped = 0i64;
        for chunk in ids.chunks(50) {
            // Level-1 dedupe: skip already ledgered source msg ids
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
            if fresh.is_empty() {
                continue;
            }
            let mut attempt = 0u32;
            loop {
                attempt += 1;
                match grammers_ops::forward_messages_blocking(
                    &sessions,
                    &identity,
                    &source,
                    &dest,
                    &fresh,
                ) {
                    Ok(n) => {
                        forwarded += n as i64;
                        for &sid in &fresh {
                            let _ = jobs_db::ledger_insert(
                                job_id, sid, None, None, None, None, None,
                            );
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
                Some(ids.len() as i64),
                chunk.last().copied(),
            );
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

    let exec_id = jobs_db::start_execution(job_id)?;
    let _ = jobs_db::update_execution_status(exec_id, "RUNNING", Some(0), None, None);

    let sessions = resolve_sessions_dir(None);
    std::env::set_var("AUTOGRAM_SESSIONS_DIR", sessions.display().to_string());
    let identity = TelegramIdentity {
        session: session.clone(),
        api_id,
        api_hash: api_hash.to_string(),
    };

    let owner_id = format!("migration-job-{job_id}-exec-{exec_id}");
    let _guard = session_guard::SessionGuardToken::acquire(
        &session,
        &owner_id,
        SessionPurpose::Migration,
    )
    .map_err(|e| e.user_message())?;

    let resume_from = jobs_db::last_resumable_msg_id(job_id).ok().flatten();
    let cap = max_messages.clamp(1, 200);
    let work_dir = sessions
        .parent()
        .map(|p| p.join("cache").join("clean_copy").join(format!("job_{job_id}")))
        .unwrap_or_else(|| PathBuf::from(format!("clean_copy_job_{job_id}")));
    let _ = std::fs::create_dir_all(&work_dir);

    let result = (|| -> Result<(i64, i64, i64), String> {
        let media = grammers_ops::list_media_blocking(
            &sessions,
            &identity,
            &source,
            cap,
            resume_from,
        )
        .map_err(|e| e.user_message())?;

        let files = media.files;
        if files.is_empty() {
            return Ok((0, 0, 0));
        }
        let total = files.len() as i64;
        let mut uploaded = 0i64;
        let mut skipped = 0i64;
        let mut failed = 0i64;

        for (idx, row) in files.iter().enumerate() {
            let source_msg_id = row.id;
            let filename = row.name.clone();
            let size = row.size as i64;
            // Telegram unique: mime + size + name (stable enough without full media id API)
            let tg_unique = format!(
                "{}:{}:{}",
                row.mime_type.as_deref().unwrap_or(""),
                size,
                filename
            );

            // Level 1 — already processed message id
            let pre = jobs_db::ledger_check(
                job_id,
                source_msg_id,
                Some(&tg_unique),
                None,
                Some(&filename),
                Some(size),
            )
            .unwrap_or_default();
            if pre.by_source_msg {
                skipped += 1;
                continue;
            }

            let dest_path = work_dir.join(format!(
                "{}_{}",
                source_msg_id,
                sanitize_name(&filename)
            ));
            let dest_str = dest_path.to_string_lossy().to_string();

            // Download with FloodWait retry
            let mut dl_ok = false;
            for attempt in 1..=5u32 {
                match grammers_ops::download_file_blocking(
                    &sessions,
                    &identity,
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
                let _ = jobs_db::update_execution_status(
                    exec_id,
                    "RUNNING",
                    Some(uploaded + skipped + failed),
                    Some(total),
                    Some(source_msg_id),
                );
                continue;
            }

            let hash = hash_util::sha256_file(&dest_str)
                .map(|h| h.sha256)
                .unwrap_or_default();

            // Levels 2–4 after hash known
            let hit = jobs_db::ledger_check(
                job_id,
                source_msg_id,
                Some(&tg_unique),
                if hash.is_empty() { None } else { Some(&hash) },
                Some(&filename),
                Some(size),
            )
            .unwrap_or_default();
            if hit.is_duplicate() {
                skipped += 1;
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
                let _ = jobs_db::update_execution_status(
                    exec_id,
                    "RUNNING",
                    Some(uploaded + skipped + failed),
                    Some(total),
                    Some(source_msg_id),
                );
                continue;
            }

            // Re-upload
            let mut up_msg_id: Option<i64> = None;
            for attempt in 1..=5u32 {
                match grammers_ops::upload_file_blocking(
                    &sessions,
                    &identity,
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
            let _ = std::fs::remove_file(&dest_path);
            let _ = jobs_db::update_execution_status(
                exec_id,
                "RUNNING",
                Some(uploaded + skipped + failed),
                Some(total),
                Some(source_msg_id),
            );
            tg_log::info(
                BACKEND,
                "clean_item",
                format!(
                    "job={job_id} idx={}/{} msg={} up={:?} skip_dup={}",
                    idx + 1,
                    total,
                    source_msg_id,
                    up_msg_id,
                    hit.is_duplicate()
                ),
            );
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
            let _ = jobs_db::update_execution_status(exec_id, "FAILED", None, None, None);
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
            let _ = jobs_db::update_execution_status(exec_id, "FAILED", None, None, None);
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
