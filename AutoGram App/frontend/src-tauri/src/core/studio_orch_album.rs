//! Intelligent Album Orchestration & Streaming Group Dispatch.
//!
//! Extracted from `studio_orch.rs` to comply with the 2,000-line modularization
//! boundary (Rule 17) and enhanced with pre-transcode source duplicate detection
//! plus streaming album group flushing for large batches.

use serde_json::json;
use std::collections::HashMap;
use std::path::Path;

use crate::core::album_account_pool::AlbumAccountPool;
use super::autogram_core::transfer::{
    apply_album_caption_policy, build_album_plan, classify_prepared_delivery, normalize_caption,
    AlbumCompatibilityKey, AlbumFailurePolicy, AlbumPackingPolicy, AlbumPlan, AlbumPlanOptions,
    CaptionOverflowPolicy, MediaCategory, PayloadClass, PreparedAlbumItem, QualityMode,
    TransferFeatureFlags,
};
use super::grammers_ops;
use super::job_queue::{self, ItemState, TransferRecord, TransferState};
use super::media_prep;
use super::tg_log;
use super::{
    apply_nonstandard_source_document_guard, approved_alternate_sessions,
    duplicate_match_for_prepared, duplicate_match_for_source, effective_upload_limit,
    emit_album_item_result, finalize_transfer, handle_oversize_prepared, item_spoiler, option_bool,
    option_usize, persist_prepared_decision, persist_upload_ledger_binding, prepare_with_receipt,
    prepared_ledger_identity, remote_mux_for_item, serialized_label, OrchStartResult,
    PreparedLedgerIdentity, TelegramIdentity,
};

fn requests_whole_album_alternate(rec: &TransferRecord) -> bool {
    rec.options
        .get("oversize_action")
        .or_else(|| rec.options.get("oversizeAction"))
        .and_then(|value| value.as_str())
        == Some("alternate_account")
        && rec
            .options
            .get("album_alternate_strategy")
            .or_else(|| rec.options.get("albumAlternateStrategy"))
            .and_then(|value| value.as_str())
            == Some("move_whole_group")
}

fn persist_transfer_log(tid: &str, level: &str, operation: &str, message: impl AsRef<str>) {
    let message = message.as_ref();
    let _ = job_queue::append_log(tid, level, operation, message);
    crate::core::transfer_journal::TransferJournal::new(tid).append(
        operation,
        json!({
            "level": level,
            "message": message,
        }),
    );
}

fn format_telegram_log_message(
    media_desc: &str,
    err: &crate::core::tg_error::TgError,
    action_desc: &str,
) -> String {
    let rpc = err.rpc_name().unwrap_or(match err.code() {
        crate::core::tg_error::TgErrorCode::Timeout => "WORKER_BUSY_TOO_LONG_RETRY",
        crate::core::tg_error::TgErrorCode::FloodWait => "FLOOD_WAIT",
        _ => "RPC_ERROR",
    });
    let code_str = format!("{:?}", err.code());
    let user_msg = err.user_message();
    let reason = match err.code() {
        crate::core::tg_error::TgErrorCode::Timeout => {
            "Server datacenter Telegram sibuk atau membutuhkan waktu lebih lama untuk indexing video besar."
        }
        crate::core::tg_error::TgErrorCode::FloodWait => {
            "Akun melebihi kuota laju permintaan Telegram sementara."
        }
        crate::core::tg_error::TgErrorCode::PeerFlood => {
            "Terjadi pembatasan aksi dari Telegram (PEER_FLOOD)."
        }
        _ => user_msg.as_str(),
    };
    format!(
        "Media [{media_desc}] terkena limit/status server Telegram [{rpc} ({code_str})]. Alasan: {reason} | Aksi: {action_desc}"
    )
}

fn wait_retry_with_cancel(app: Option<&tauri::AppHandle>, tid: &str, seconds: u32) -> bool {
    use tauri::Emitter;
    if let Some(app) = app {
        let _ = app.emit(
            "transfer-event",
            serde_json::json!({
                "type": "FloodWait",
                "seconds": seconds,
                "job_id": tid,
            }),
        );
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(seconds as u64);
    let mut last_tick = seconds;
    while std::time::Instant::now() < deadline {
        if job_queue::is_transfer_cancelled(tid) {
            if let Some(app) = app {
                let _ = app.emit(
                    "transfer-event",
                    serde_json::json!({
                        "type": "FloodWaitResolved",
                        "job_id": tid,
                    }),
                );
            }
            return false;
        }
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        let rem_secs = remaining.as_secs() as u32;
        if rem_secs < last_tick {
            last_tick = rem_secs;
            if let Some(app) = app {
                let _ = app.emit(
                    "transfer-event",
                    serde_json::json!({
                        "type": "FloodWaitTick",
                        "remaining": rem_secs,
                        "job_id": tid,
                    }),
                );
            }
        }
        std::thread::sleep(remaining.min(std::time::Duration::from_millis(200)));
    }
    let is_cancelled = job_queue::is_transfer_cancelled(tid);
    if let Some(app) = app {
        let _ = app.emit(
            "transfer-event",
            serde_json::json!({
                "type": "FloodWaitResolved",
                "job_id": tid,
            }),
        );
    }
    !is_cancelled
}

fn sleep_inter_batch_pacing(tid: &str, millis: u64) -> bool {
    job_queue::sleep_inter_batch_pacing(tid, millis)
}

fn is_video_extension(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "mp4" | "mkv" | "mov" | "webm" | "avi" | "wmv" | "ts" | "m4v" | "flv" | "3gp"
    )
}

#[allow(clippy::too_many_arguments)]
fn execute_album_plan_chunk(
    app: Option<&tauri::AppHandle>,
    rec: &TransferRecord,
    tid: &str,
    sessions: &Path,
    pool: &mut AlbumAccountPool,
    topic_id: Option<i64>,
    silent: bool,
    plan: AlbumPlan,
    ledger_identities: &HashMap<usize, PreparedLedgerIdentity>,
    artifacts: &mut HashMap<usize, media_prep::PreparedUploadArtifact>,
    any_ok: &mut bool,
    first_error: &mut Option<String>,
) -> Result<(), String> {
    let primary_identity = pool.primary_identity();
    for group in plan.groups {
        if let Err(error) = job_queue::wait_while_transfer_paused(tid) {
            for (_, artifact) in artifacts.drain() {
                artifact.cleanup();
            }
            let _ = job_queue::set_transfer_state(tid, TransferState::Cancelled);
            let _ = super::autogram_core::transfer::update_transfer_run_state(tid, "CANCELLED");
            return Err(error);
        }
        super::autogram_core::transfer::validate_album_group_invariants(&group)?;
        let first_index = group.items.first().map(|item| item.index).unwrap_or(0);
        let commit_id = format!("{tid}:album:{first_index}");
        let indices: Vec<usize> = group.items.iter().map(|item| item.index).collect();
        let compatibility_key = group
            .items
            .first()
            .map(|item| item.key.clone())
            .ok_or_else(|| "album planner produced an empty group".to_string())?;
        let random_ids = super::autogram_core::transfer::create_album_commit(
            &commit_id,
            tid,
            &compatibility_key,
            &indices,
            &group,
        )?;
        super::autogram_core::transfer::update_album_commit(&commit_id, "COMMITTING", &[], None)?;
        for item in &group.items {
            let _ = job_queue::update_item(tid, item.index, ItemState::Uploading, None, None);
        }
        let upload_files: Vec<grammers_ops::AlbumUploadFile> = group
            .items
            .iter()
            .map(|item| grammers_ops::AlbumUploadFile {
                index: item.index,
                path: item.path.clone(),
                caption: item.caption.clone(),
                spoiler: item.spoiler,
            })
            .collect();
        let mut delivery_identity = pool.pick_sender_for_album(tid, app)?;
        let mut album_attempts = 0usize;
        let album_exec_res = loop {
            album_attempts += 1;
            let res = grammers_ops::upload_prepared_album_blocking_with_app(
                sessions,
                &delivery_identity,
                &rec.chat_id,
                &upload_files,
                group.as_document,
                silent,
                topic_id,
                app.cloned(),
                Some(tid.to_string()),
                compatibility_key.schedule_at,
                compatibility_key.send_as.clone(),
                Some(random_ids.clone()),
                Some(commit_id.clone()),
            );
            match res {
                Ok(ok_res) => {
                    pool.record_album_success(&delivery_identity.session, group.items.len(), tid);
                    break Ok(ok_res);
                }
                Err(err) => {
                    if job_queue::is_transfer_cancelled(tid) {
                        persist_transfer_log(
                            tid,
                            "warn",
                            "transfer_cancelled_during_album",
                            "cancel acknowledged before retry/fallback",
                        );
                        break Err(err);
                    }
                    let rpc_text = err.user_message().to_ascii_uppercase();
                    let permanent_album_error = [
                        "CHAT_WRITE_FORBIDDEN",
                        "CHAT_ADMIN_REQUIRED",
                        "MESSAGE_TOO_LONG",
                        "MEDIA_INVALID",
                        "MEDIA_EMPTY",
                        "FILE_REFERENCE",
                        "PEER_ID_INVALID",
                    ]
                    .iter()
                    .any(|needle| rpc_text.contains(needle));
                    let is_flood_wait = matches!(err.code(), crate::core::tg_error::TgErrorCode::FloodWait);
                    if is_flood_wait {
                        let wait_secs = err.flood_wait_secs().unwrap_or(30);
                        if let Some(alt_identity) = pool.record_album_floodwait(
                            &delivery_identity.session,
                            wait_secs,
                            tid,
                            app,
                        ) {
                            delivery_identity = alt_identity;
                            album_attempts = 0;
                            continue;
                        }
                    }
                    let is_retryable = !permanent_album_error
                        && (is_flood_wait
                            || matches!(
                                err.code(),
                                crate::core::tg_error::TgErrorCode::Timeout
                                    | crate::core::tg_error::TgErrorCode::Network
                                    | crate::core::tg_error::TgErrorCode::Io
                            ));
                    let item_names = group
                        .items
                        .iter()
                        .take(3)
                        .map(|i| {
                            Path::new(&i.path)
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("?")
                        })
                        .collect::<Vec<_>>()
                        .join(", ");
                    let media_desc = if group.items.len() > 3 {
                        format!("Album {} berkas: {}, dst", group.items.len(), item_names)
                    } else {
                        format!("Album {} berkas: {}", group.items.len(), item_names)
                    };

                    if !is_retryable && !permanent_album_error {
                        persist_transfer_log(
                            tid,
                            "warn",
                            "album_retry_suppressed",
                            format_telegram_log_message(
                                &media_desc,
                                &err,
                                "Mencoba rekonsiliasi riwayat lalu fallback ke pengiriman per berkas.",
                            ),
                        );
                    }
                    if is_retryable && album_attempts <= 3 {
                        let wait_secs = err.flood_wait_secs().unwrap_or_else(|| match err.code() {
                            crate::core::tg_error::TgErrorCode::Timeout => {
                                (6 + album_attempts * 2) as u32
                            }
                            _ => (album_attempts * 3) as u32,
                        });
                        let retry_msg = format_telegram_log_message(
                            &media_desc,
                            &err,
                            &format!(
                                "Percobaan {album_attempts}/3. Menjeda {wait_secs}s untuk rekonsiliasi status server sebelum mencoba kembali."
                            ),
                        );
                        tg_log::warn(
                            "studio_orch",
                            "album_upload_network_retry",
                            format!("{retry_msg} (internal error: {})", err.user_message()),
                        );
                        persist_transfer_log(tid, "warn", "album_upload_network_retry", &retry_msg);
                        if !wait_retry_with_cancel(app, tid, wait_secs) {
                            break Err(crate::core::tg_error::TgError::new(
                                crate::core::tg_error::TgErrorCode::Cancelled,
                                "transfer cancelled by user",
                            ));
                        }
                        continue;
                    }
                    break Err(err);
                }
            }
        };

        match album_exec_res {
            Ok(results) => {
                let mut message_ids = Vec::new();
                let mut all_committed = true;
                for result in results {
                    let is_grouped = matches!(result.status.as_str(), "done" | "success");
                    let is_delivered_single = result.status == "delivered_single";
                    let state = if is_grouped || is_delivered_single {
                        *any_ok = true;
                        ItemState::Done
                    } else {
                        all_committed = false;
                        ItemState::Failed
                    };
                    if is_delivered_single {
                        all_committed = false;
                        persist_transfer_log(
                            tid,
                            "warn",
                            "album_item_delivered_single",
                            format!(
                                "index={} message_id={:?} action=preserve_no_reupload reason={}",
                                result.index,
                                result.message_id,
                                result.error.as_deref().unwrap_or("telegram_layout_partial")
                            ),
                        );
                    }
                    if let Some(message_id) = result.message_id {
                        message_ids.push(message_id);
                    }
                    let _ = job_queue::update_item(
                        tid,
                        result.index,
                        state.clone(),
                        result.message_id,
                        result.error.clone(),
                    );
                    let _ = super::autogram_core::transfer::update_transfer_item_result(
                        tid,
                        result.index,
                        if matches!(state, ItemState::Done) { "DONE" } else { "FAILED" },
                        result.message_id,
                    );
                    emit_album_item_result(
                        app,
                        result.index,
                        &state,
                        result.message_id,
                        result.error.clone(),
                    );
                    if matches!(state, ItemState::Done) {
                        if let Some(ledger_identity) = ledger_identities.get(&result.index) {
                            persist_upload_ledger_binding(
                                rec,
                                topic_id,
                                &delivery_identity.session,
                                result.message_id,
                                result.index,
                                ledger_identity,
                            );
                        }
                    }
                    if (pool.is_multi_account() || delivery_identity.session != primary_identity.session) && matches!(state, ItemState::Done) {
                        if let Err(error) =
                            super::autogram_core::transfer::record_alternate_upload(
                                tid,
                                result.index,
                                &delivery_identity.session,
                                result.message_id,
                            )
                        {
                            tg_log::warn(
                                "studio_orch",
                                "alternate_binding_persist_failed",
                                format!("transfer={tid} index={} error={error}", result.index),
                            );
                        }
                    }
                    if first_error.is_none() {
                        *first_error = result.error;
                    }
                }
                super::autogram_core::transfer::update_album_commit(
                    &commit_id,
                    if all_committed {
                        "COMMITTED"
                    } else {
                        "REVIEW_REQUIRED"
                    },
                    &message_ids,
                    if all_committed {
                        None
                    } else {
                        Some("album result was partial")
                    },
                )?;
            }
            Err(error) => {
                if matches!(error.code(), crate::core::tg_error::TgErrorCode::Cancelled)
                    || job_queue::is_transfer_cancelled(tid)
                {
                    persist_transfer_log(
                        tid,
                        "warn",
                        "transfer_cancelled",
                        format!("album stopped before fallback: {}", error.user_message()),
                    );
                    for (_, artifact) in artifacts.drain() {
                        artifact.cleanup();
                    }
                    let _ = job_queue::set_transfer_state(tid, TransferState::Cancelled);
                    let _ =
                        super::autogram_core::transfer::update_transfer_run_state(tid, "CANCELLED");
                    return Err("Transfer cancelled by user".into());
                }
                let item_names = group
                    .items
                    .iter()
                    .take(3)
                    .map(|i| {
                        Path::new(&i.path)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("?")
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                let media_desc = if group.items.len() > 3 {
                    format!("Album {} berkas: {}, dst", group.items.len(), item_names)
                } else {
                    format!("Album {} berkas: {}", group.items.len(), item_names)
                };
                let err_msg = error.user_message();
                if matches!(error.code(), crate::core::tg_error::TgErrorCode::Timeout)
                    && group.items.len() >= 9
                {
                    persist_transfer_log(
                        tid,
                        "warn",
                        "album_worker_busy_fallback",
                        format!(
                            "Server Telegram kehabisan batas waktu indexing video paket {} berkas. Mengaktifkan Smart Fallback: sisa berkas dialirkan dengan aman agar tidak terjadi layout 9+1.",
                            group.items.len()
                        ),
                    );
                }
                persist_transfer_log(
                    tid,
                    "error",
                    "album_send_failed",
                    format_telegram_log_message(
                        &media_desc,
                        &error,
                        &format!(
                            "Menjalankan fallback otomatis: mengirim {} berkas secara mandiri (single).",
                            group.items.len()
                        ),
                    ),
                );
                tg_log::warn(
                    "studio_orch",
                    "album_failed_executing_intelligent_fallback",
                    format!(
                        "Album upload failed ({:?}: {}). Executing intelligent self-healing fallback: sending {} items individually as single messages...",
                        error.code(),
                        err_msg,
                        group.items.len()
                    ),
                );
                let recovered_pairs =
                    super::autogram_core::transfer::load_album_commit_recovered(&commit_id)
                        .unwrap_or_default();
                let recovered_indices: std::collections::HashSet<usize> =
                    recovered_pairs.iter().map(|(index, _)| *index).collect();
                let mut fallback_message_ids: Vec<i64> = recovered_pairs
                    .iter()
                    .map(|(_, message_id)| *message_id)
                    .collect();
                let mut fallback_complete = true;
                for (index, message_id) in &recovered_pairs {
                    *any_ok = true;
                    let state = ItemState::Done;
                    let _ =
                        job_queue::update_item(tid, *index, state.clone(), Some(*message_id), None);
                    let _ = super::autogram_core::transfer::update_transfer_item_result(
                        tid,
                        *index,
                        "DONE",
                        Some(*message_id),
                    );
                    emit_album_item_result(app, *index, &state, Some(*message_id), None);
                    if let Some(ledger_identity) = ledger_identities.get(index) {
                        persist_upload_ledger_binding(
                            rec,
                            topic_id,
                            &delivery_identity.session,
                            Some(*message_id),
                            *index,
                            ledger_identity,
                        );
                    }
                    persist_transfer_log(
                        tid,
                        "warn",
                        "album_partial_recovery_ack",
                        format!(
                            "index={} message_id={} action=skip_reupload",
                            index, message_id
                        ),
                    );
                }
                let _ = super::autogram_core::transfer::update_album_commit(
                    &commit_id,
                    "REVIEW_REQUIRED",
                    &fallback_message_ids,
                    Some(&format!("Fell back to individual uploads: {}", err_msg)),
                );

                for item in group
                    .items
                    .iter()
                    .filter(|item| !recovered_indices.contains(&item.index))
                {
                    if let Err(error) = job_queue::wait_while_transfer_paused(tid) {
                        for (_, artifact) in artifacts.drain() {
                            artifact.cleanup();
                        }
                        let _ = job_queue::set_transfer_state(tid, TransferState::Cancelled);
                        let _ = super::autogram_core::transfer::update_transfer_run_state(
                            tid,
                            "CANCELLED",
                        );
                        return Err(error);
                    }
                    let _ =
                        job_queue::update_item(tid, item.index, ItemState::Uploading, None, None);
                    let as_document = item.key.payload_class != PayloadClass::NativeVisual;
                    let effective_caption = {
                        let orig_path = rec
                            .items
                            .get(item.index)
                            .map(|i| i.path.as_str())
                            .unwrap_or(&item.path);
                        super::autogram_core::transfer::resolve_single_media_caption(
                            orig_path,
                            &item.caption,
                        )
                    };

                    let mut single_attempts = 0usize;
                    let single_exec_res = loop {
                        single_attempts += 1;
                        let res = grammers_ops::upload_file_blocking_topic_with_delivery(
                            sessions,
                            &delivery_identity,
                            &rec.chat_id,
                            &item.path,
                            &effective_caption,
                            as_document,
                            silent,
                            item.spoiler,
                            item.index,
                            topic_id,
                            item.key.schedule_at,
                            item.key.send_as.clone(),
                            app.cloned(),
                            Some(tid.to_string()),
                        );
                        match res {
                            Ok(ok_res) => break Ok(ok_res),
                            Err(err) => {
                                if job_queue::is_transfer_cancelled(tid) {
                                    break Err(crate::core::tg_error::TgError::new(
                                        crate::core::tg_error::TgErrorCode::Cancelled,
                                        "transfer cancelled by user",
                                    ));
                                }
                                let is_network = matches!(
                                    err.code(),
                                    crate::core::tg_error::TgErrorCode::FloodWait
                                );
                                if is_network && single_attempts <= 3 {
                                    let wait_secs = err
                                        .flood_wait_secs()
                                        .unwrap_or((single_attempts * 2) as u32);
                                    tg_log::warn(
                                        "studio_orch",
                                        "fallback_single_upload_retry",
                                        format!(
                                            "Fallback single upload attempt {}/3 encountered error ({:?}): {}. Retrying in {}s...",
                                            single_attempts, err.code(), err.user_message(), wait_secs
                                        ),
                                    );
                                    let filename = Path::new(&item.path)
                                        .file_name()
                                        .and_then(|n| n.to_str())
                                        .unwrap_or("?");
                                    let item_desc = format!("{filename} (indeks {})", item.index);
                                    persist_transfer_log(
                                        tid,
                                        "warn",
                                        "fallback_single_upload_retry",
                                        format_telegram_log_message(
                                            &item_desc,
                                            &err,
                                            &format!("Percobaan {single_attempts}/3. Menjeda {wait_secs}s sebelum mencoba kembali."),
                                        ),
                                    );
                                    if !wait_retry_with_cancel(app, tid, wait_secs) {
                                        break Err(crate::core::tg_error::TgError::new(
                                            crate::core::tg_error::TgErrorCode::Cancelled,
                                            "transfer cancelled by user",
                                        ));
                                    }
                                    continue;
                                }
                                break Err(err);
                            }
                        }
                    };

                    match single_exec_res {
                        Ok(result) => {
                            let state = if matches!(result.status.as_str(), "done" | "success") {
                                *any_ok = true;
                                ItemState::Done
                            } else {
                                fallback_complete = false;
                                ItemState::Failed
                            };
                            let _ = job_queue::update_item(
                                tid,
                                item.index,
                                state.clone(),
                                result.message_id,
                                result.error.clone(),
                            );
                            let _ = super::autogram_core::transfer::update_transfer_item_result(
                                tid,
                                item.index,
                                if matches!(state, ItemState::Done) { "DONE" } else { "FAILED" },
                                result.message_id,
                            );
                            emit_album_item_result(
                                app,
                                item.index,
                                &state,
                                result.message_id,
                                result.error,
                            );
                            if matches!(state, ItemState::Done) {
                                if let Some(message_id) = result.message_id {
                                    fallback_message_ids.push(message_id);
                                }
                                if let Some(ledger_identity) = ledger_identities.get(&item.index) {
                                    persist_upload_ledger_binding(
                                        rec,
                                        topic_id,
                                        &delivery_identity.session,
                                        result.message_id,
                                        item.index,
                                        ledger_identity,
                                    );
                                }
                            }
                            if (pool.is_multi_account() || delivery_identity.session != primary_identity.session) && matches!(state, ItemState::Done) {
                                if let Err(error) =
                                    super::autogram_core::transfer::record_alternate_upload(
                                        tid,
                                        item.index,
                                        &delivery_identity.session,
                                        result.message_id,
                                    )
                                {
                                    tg_log::warn(
                                        "studio_orch",
                                        "alternate_binding_persist_failed",
                                        format!(
                                            "transfer={tid} index={} error={error}",
                                            item.index
                                        ),
                                    );
                                }
                            }
                        }
                        Err(error) => {
                            if matches!(error.code(), crate::core::tg_error::TgErrorCode::Cancelled)
                                || job_queue::is_transfer_cancelled(tid)
                            {
                                for (_, artifact) in artifacts.drain() {
                                    artifact.cleanup();
                                }
                                let _ = job_queue::set_transfer_state(tid, TransferState::Cancelled);
                                let _ = super::autogram_core::transfer::update_transfer_run_state(
                                    tid,
                                    "CANCELLED",
                                );
                                persist_transfer_log(
                                    tid,
                                    "warn",
                                    "transfer_cancelled",
                                    format!("fallback upload stopped: {}", error.user_message()),
                                );
                                return Err("Transfer cancelled by user".into());
                            }
                            fallback_complete = false;
                            let message = error.user_message();
                            let filename = Path::new(&item.path)
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("?");
                            let item_desc = format!("{filename} (indeks {})", item.index);
                            persist_transfer_log(
                                tid,
                                "error",
                                "fallback_single_upload_failed",
                                format_telegram_log_message(
                                    &item_desc,
                                    &error,
                                    "Pengiriman gagal setelah batas percobaan habis.",
                                ),
                            );
                            let state = ItemState::Failed;
                            let _ = job_queue::update_item(
                                tid,
                                item.index,
                                state.clone(),
                                None,
                                Some(message.clone()),
                            );
                            emit_album_item_result(
                                app,
                                item.index,
                                &state,
                                None,
                                Some(message.clone()),
                            );
                            if first_error.is_none() {
                                *first_error = Some(message);
                            }
                        }
                    }
                    if !sleep_inter_batch_pacing(tid, 2750) {
                        return Err("Transfer cancelled by user".into());
                    }
                }
                let _ = super::autogram_core::transfer::update_album_commit(
                    &commit_id,
                    if fallback_complete {
                        "COMMITTED"
                    } else {
                        "REVIEW_REQUIRED"
                    },
                    &fallback_message_ids,
                    if fallback_complete {
                        None
                    } else {
                        Some("one or more fallback uploads failed")
                    },
                );
            }
        }
        for item in &group.items {
            if let Some(artifact) = artifacts.remove(&item.index) {
                artifact.cleanup();
            }
        }
        // Per-account micro-pacing and breathers are governed within AlbumAccountPool.
    }
    let total_singles = plan.singles.len();
    let mut singles_sent = 0usize;
    let mut had_floodwait = false;

    for item in plan.singles {
        if let Err(error) = job_queue::wait_while_transfer_paused(tid) {
            for (_, artifact) in artifacts.drain() {
                artifact.cleanup();
            }
            let _ = job_queue::set_transfer_state(tid, TransferState::Cancelled);
            let _ = super::autogram_core::transfer::update_transfer_run_state(tid, "CANCELLED");
            return Err(error);
        }
        let _ = job_queue::update_item(tid, item.index, ItemState::Uploading, None, None);
        let as_document = item.key.payload_class != PayloadClass::NativeVisual;
        let effective_caption = {
            let orig_path = rec
                .items
                .get(item.index)
                .map(|i| i.path.as_str())
                .unwrap_or(&item.path);
            super::autogram_core::transfer::resolve_single_media_caption(orig_path, &item.caption)
        };

        let mut single_attempts = 0usize;
        let single_exec_res = loop {
            single_attempts += 1;
            let res = grammers_ops::upload_file_blocking_topic_with_delivery(
                sessions,
                &primary_identity,
                &rec.chat_id,
                &item.path,
                &effective_caption,
                as_document,
                silent,
                item.spoiler,
                item.index,
                topic_id,
                item.key.schedule_at,
                item.key.send_as.clone(),
                app.cloned(),
                Some(tid.to_string()),
            );
            match res {
                Ok(ok_res) => break Ok(ok_res),
                Err(err) => {
                    if job_queue::is_transfer_cancelled(tid) {
                        break Err(crate::core::tg_error::TgError::new(
                            crate::core::tg_error::TgErrorCode::Cancelled,
                            "transfer cancelled by user",
                        ));
                    }
                    let is_flood_wait = matches!(err.code(), crate::core::tg_error::TgErrorCode::FloodWait);
                    if is_flood_wait {
                        had_floodwait = true;
                    }
                    let is_network = is_flood_wait
                        || matches!(
                            err.code(),
                            crate::core::tg_error::TgErrorCode::Network
                                | crate::core::tg_error::TgErrorCode::Io
                                | crate::core::tg_error::TgErrorCode::Timeout
                        );
                    if is_network && single_attempts <= 3 {
                        let wait_secs = err
                            .flood_wait_secs()
                            .unwrap_or((single_attempts * 2) as u32);
                        tg_log::warn(
                            "studio_orch",
                            "single_upload_network_retry",
                            format!(
                                "Single upload attempt {}/3 failed with network error ({:?}): {}. Disconnecting socket pool and retrying in {}s...",
                                single_attempts, err.code(), err.user_message(), wait_secs
                            ),
                        );
                        grammers_ops::disconnect_cached_session(&primary_identity.session);
                        if !wait_retry_with_cancel(app, tid, wait_secs) {
                            break Err(crate::core::tg_error::TgError::new(
                                crate::core::tg_error::TgErrorCode::Cancelled,
                                "transfer cancelled by user",
                            ));
                        }
                        continue;
                    }
                    break Err(err);
                }
            }
        };

        match single_exec_res {
            Ok(result) => {
                let state = if matches!(result.status.as_str(), "done" | "success") {
                    *any_ok = true;
                    ItemState::Done
                } else {
                    ItemState::Failed
                };
                let _ = job_queue::update_item(
                    tid,
                    item.index,
                    state.clone(),
                    result.message_id,
                    result.error.clone(),
                );
                let _ = super::autogram_core::transfer::update_transfer_item_result(
                    tid,
                    item.index,
                    if matches!(state, ItemState::Done) { "DONE" } else { "FAILED" },
                    result.message_id,
                );
                emit_album_item_result(app, item.index, &state, result.message_id, result.error);
                if matches!(state, ItemState::Done) {
                    if let Some(ledger_identity) = ledger_identities.get(&item.index) {
                        persist_upload_ledger_binding(
                            rec,
                            topic_id,
                            &primary_identity.session,
                            result.message_id,
                            item.index,
                            ledger_identity,
                        );
                    }
                }
                if pool.is_multi_account() && matches!(state, ItemState::Done) {
                    if let Err(error) = super::autogram_core::transfer::record_alternate_upload(
                        tid,
                        item.index,
                        &primary_identity.session,
                        result.message_id,
                    ) {
                        tg_log::warn(
                            "studio_orch",
                            "alternate_binding_persist_failed",
                            format!("transfer={tid} index={} error={error}", item.index),
                        );
                    }
                }
            }
            Err(error) => {
                if matches!(error.code(), crate::core::tg_error::TgErrorCode::Cancelled)
                    || job_queue::is_transfer_cancelled(tid)
                {
                    for (_, artifact) in artifacts.drain() {
                        artifact.cleanup();
                    }
                    let _ = job_queue::set_transfer_state(tid, TransferState::Cancelled);
                    let _ =
                        super::autogram_core::transfer::update_transfer_run_state(tid, "CANCELLED");
                    persist_transfer_log(
                        tid,
                        "warn",
                        "transfer_cancelled",
                        format!("single upload stopped: {}", error.user_message()),
                    );
                    return Err("Transfer cancelled by user".into());
                }
                let message = error.user_message();
                let state = ItemState::Failed;
                let _ = job_queue::update_item(
                    tid,
                    item.index,
                    state.clone(),
                    None,
                    Some(message.clone()),
                );
                emit_album_item_result(app, item.index, &state, None, Some(message.clone()));
                let filename = Path::new(&item.path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("?");
                let item_desc = format!("{filename} (indeks {})", item.index);
                persist_transfer_log(
                    tid,
                    "error",
                    "single_upload_failed",
                    format_telegram_log_message(
                        &item_desc,
                        &error,
                        "Pengiriman berkas tunggal gagal.",
                    ),
                );
                if first_error.is_none() {
                    *first_error = Some(message);
                }
            }
        }
        if let Some(artifact) = artifacts.remove(&item.index) {
            artifact.cleanup();
        }
        // Adaptive single message governor micro-pacing
        singles_sent += 1;
        if !job_queue::pace_single_message(tid, singles_sent, total_singles, had_floodwait) {
            return Err("Transfer cancelled by user".into());
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(super) fn run_intelligent_album(
    app: Option<&tauri::AppHandle>,
    rec: &TransferRecord,
    tid: &str,
    sessions: &Path,
    identity: &TelegramIdentity,
    topic_id: Option<i64>,
    quality_mode_value: Option<&str>,
    hardware_override: Option<&str>,
    silent: bool,
    runtime_limit: u64,
    caption_limit: u32,
    feature_flags: TransferFeatureFlags,
) -> Result<OrchStartResult, String> {
    let mode = QualityMode::parse(quality_mode_value);
    let album_grid_size =
        option_usize(&rec.options, "album_group_size", "albumGroupSize", 10).clamp(2, 10);
    let packing = rec
        .options
        .get("album_packing")
        .or_else(|| rec.options.get("albumPacking"))
        .and_then(|value| value.as_str())
        .map(|value| match value.to_ascii_lowercase().as_str() {
            "smart_adaptive" | "smartadaptive" | "adaptive" => AlbumPackingPolicy::SmartAdaptive,
            "balanced" => AlbumPackingPolicy::Balanced,
            "maximum" | "max" => AlbumPackingPolicy::Maximum,
            "follow_selection" | "followselection" => AlbumPackingPolicy::FollowSelection,
            "never" | "disabled" => AlbumPackingPolicy::Never,
            "custom" => AlbumPackingPolicy::Custom,
            _ => {
                if album_grid_size == 10 {
                    AlbumPackingPolicy::SmartAdaptive
                } else {
                    AlbumPackingPolicy::Custom
                }
            }
        })
        .unwrap_or_else(|| {
            if album_grid_size == 10 {
                AlbumPackingPolicy::SmartAdaptive
            } else {
                AlbumPackingPolicy::Custom
            }
        });
    let plan_options = AlbumPlanOptions {
        enabled: true,
        packing,
        custom_size: album_grid_size,
        avoid_single_remainder: option_bool(
            &rec.options,
            "album_avoid_single",
            "albumAvoidSingle",
            true,
        ),
        group_documents: option_bool(&rec.options, "group_documents", "groupDocuments", true),
        group_audio: option_bool(&rec.options, "group_audio", "groupAudio", true),
        group_original_documents: option_bool(
            &rec.options,
            "group_original_documents",
            "groupOriginalDocuments",
            true,
        ),
    };
    let failure_policy = AlbumFailurePolicy::parse(
        rec.options
            .get("album_failure_policy")
            .or_else(|| rec.options.get("albumFailurePolicy"))
            .and_then(|value| value.as_str()),
    );
    let whole_album_alternate_requested = requests_whole_album_alternate(rec);
    let primary_limit = effective_upload_limit(rec, runtime_limit);
    let caption_policy = CaptionOverflowPolicy::parse(
        rec.options
            .get("caption_overflow_policy")
            .or_else(|| rec.options.get("captionOverflowPolicy"))
            .and_then(|value| value.as_str()),
    );
    let album_summary = rec
        .options
        .get("global_caption")
        .or_else(|| rec.options.get("globalCaption"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            normalize_caption(value, caption_limit, caption_policy)
                .map(|normalized| normalized.value)
        })
        .transpose()?;
    let mut normalized_item_captions = HashMap::new();
    let is_album_grouping = option_bool(&rec.options, "group_as_album", "groupAsAlbum", true);
    if album_summary.is_none() {
        for item in &rec.items {
            let item_caption_str = if is_album_grouping {
                String::new()
            } else {
                normalize_caption(&item.caption, caption_limit, caption_policy)?.value
            };
            normalized_item_captions.insert(item.index, item_caption_str);
        }
    }
    let mut album_summary_consumed = false;

    let mut artifacts: HashMap<usize, media_prep::PreparedUploadArtifact> = HashMap::new();
    let mut prepared_items = Vec::new();
    let mut ledger_identities: HashMap<usize, PreparedLedgerIdentity> = HashMap::new();
    let mut any_ok = false;
    let mut first_error = None;
    let mut preparation_failed = false;
    let mut album_pool = AlbumAccountPool::new(sessions, identity, rec, &rec.chat_id);
    let schedule_at = rec
        .options
        .get("schedule_at")
        .or_else(|| rec.options.get("scheduleAt"))
        .and_then(|value| value.as_i64())
        .filter(|value| *value > 0);
    let send_as = rec
        .options
        .get("send_as")
        .or_else(|| rec.options.get("sendAs"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let encoder_strategy = rec
        .options
        .get("encoder_strategy")
        .or_else(|| rec.options.get("encoderStrategy"))
        .and_then(|value| value.as_str());
    let encoder_resource_profile = rec
        .options
        .get("encoder_resource_profile")
        .or_else(|| rec.options.get("encoderResourceProfile"))
        .and_then(|value| value.as_str());
    let encoder_max_parallel = option_usize(
        &rec.options,
        "encoder_max_parallel",
        "encoderMaxParallel",
        1,
    )
    .clamp(1, 4);
    let encoder_allow_software_fallback = option_bool(
        &rec.options,
        "encoder_allow_software_fallback",
        "encoderAllowSoftwareFallback",
        true,
    );

    let batch_has_video = rec.items.iter().any(|it| is_video_extension(&it.path));
    let can_stream_groups = !whole_album_alternate_requested
        && failure_policy.permits_structural_replan()
        && !matches!(packing, AlbumPackingPolicy::Never)
        && !(batch_has_video && matches!(packing, AlbumPackingPolicy::Maximum));
    let stream_group_size = match packing {
        AlbumPackingPolicy::Custom => album_grid_size,
        AlbumPackingPolicy::Balanced => 8,
        AlbumPackingPolicy::SmartAdaptive if batch_has_video => 8,
        _ => 10,
    };
    let stream_lookahead_tail = if batch_has_video
        && matches!(
            packing,
            AlbumPackingPolicy::SmartAdaptive | AlbumPackingPolicy::Balanced
        ) {
        8
    } else {
        2
    };

    for item in &rec.items {
        if let Err(error) = job_queue::wait_while_transfer_paused(tid) {
            for (_, artifact) in artifacts.drain() {
                artifact.cleanup();
            }
            let _ = job_queue::set_transfer_state(tid, TransferState::Cancelled);
            let _ = super::autogram_core::transfer::update_transfer_run_state(tid, "CANCELLED");
            return Err(error);
        }
        let spoiler = item_spoiler(&rec.options, item.index);
        let _ = job_queue::update_item(tid, item.index, ItemState::Preparing, None, None);

        if media_prep::is_remote_url(&item.path)
            && remote_mux_for_item(&rec.options, item.index).is_none()
        {
            let remote_as_document = rec
                .options
                .get("presentation_override")
                .or_else(|| rec.options.get("presentationOverride"))
                .and_then(|value| value.as_str())
                .is_some_and(|value| value == "document" || value == "force_document");
            let remote_engine_mode = rec
                .options
                .get("remote_engine_mode")
                .or_else(|| rec.options.get("remoteEngineMode"))
                .and_then(|value| value.as_str())
                .unwrap_or("auto");
            let item_caption = normalized_item_captions
                .get(&item.index)
                .cloned()
                .unwrap_or_else(|| item.caption.clone());

            let thumbnail_url = rec
                .options
                .get("thumbnail_urls")
                .or_else(|| rec.options.get("thumbnailUrls"))
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.get(item.index).or_else(|| arr.first()))
                .and_then(|v| v.as_str());

            match grammers_ops::upload_remote_url_blocking_topic_with_app(
                sessions,
                identity,
                &rec.chat_id,
                &item.path,
                &item_caption,
                remote_as_document,
                silent,
                spoiler,
                item.index,
                topic_id,
                schedule_at,
                app.cloned(),
                Some(tid.to_string()),
                remote_engine_mode,
                thumbnail_url,
            ) {
                Ok(result) => {
                    any_ok = true;
                    let state = ItemState::Done;
                    let _ = job_queue::update_item(
                        tid,
                        item.index,
                        state.clone(),
                        result.message_id,
                        None,
                    );
                    emit_album_item_result(app, item.index, &state, result.message_id, None);
                }
                Err(error) => {
                    let message = error.user_message();
                    let state = ItemState::Failed;
                    let _ = job_queue::update_item(
                        tid,
                        item.index,
                        state.clone(),
                        None,
                        Some(message.clone()),
                    );
                    emit_album_item_result(app, item.index, &state, None, Some(message.clone()));
                    if first_error.is_none() {
                        first_error = Some(message);
                    }
                }
            }
            continue;
        }

        // Fast pre-transcode duplicate check on original source file before running FFmpeg
        if !media_prep::is_remote_url(&item.path)
            && remote_mux_for_item(&rec.options, item.index).is_none()
        {
            if let Ok(Some(ledger_match)) = duplicate_match_for_source(rec, topic_id, &item.path) {
                if ledger_match.match_level == "exact_sha256" {
                    let reason = format!(
                        "duplicate_exact_sha256: existing_message_id={}",
                        ledger_match
                            .telegram_message_id
                            .map(|value| value.to_string())
                            .unwrap_or_else(|| "unknown".into())
                    );
                    let state = ItemState::Skipped;
                    job_queue::update_item(
                        tid,
                        item.index,
                        state.clone(),
                        None,
                        Some(reason.clone()),
                    )?;
                    let src_cat = super::autogram_core::transfer::classify_media(Path::new(&item.path));
                    super::autogram_core::transfer::record_transfer_item_decision(
                        tid,
                        item.index,
                        &item.path,
                        &item.path,
                        &serialized_label(&src_cat),
                        &ledger_match.payload_class,
                        "pass_through",
                        "SKIPPED",
                        "duplicate_exact_sha256",
                    )?;
                    emit_album_item_result(app, item.index, &state, None, Some(reason));
                    any_ok = true;
                    continue;
                }
            }
        }

        let muxed_remote_path = if let Some((video_url, audio_url, output_ext)) =
            remote_mux_for_item(&rec.options, item.index)
        {
            match media_prep::download_and_mux_remote(
                &video_url,
                &audio_url,
                &output_ext,
                app,
                item.index,
            ) {
                Ok(path) => Some(path),
                Err(error) => {
                    let message = format!("adaptive mux: {error}");
                    let state = ItemState::Failed;
                    let _ = job_queue::update_item(
                        tid,
                        item.index,
                        state.clone(),
                        None,
                        Some(message.clone()),
                    );
                    emit_album_item_result(app, item.index, &state, None, Some(message.clone()));
                    if first_error.is_none() {
                        first_error = Some(message);
                    }
                    continue;
                }
            }
        } else {
            None
        };
        let muxed_source_string = muxed_remote_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string());
        let preparation_source = muxed_source_string.as_deref().unwrap_or(&item.path);
        let mut prepared = None;
        let mut prepare_error = None;
        let video_transcode_scope = rec
            .options
            .get("video_transcode_scope")
            .or_else(|| rec.options.get("videoTranscodeScope"))
            .and_then(|v| v.as_str());
        let video_transcode_formats: Option<Vec<String>> = rec
            .options
            .get("video_transcode_formats")
            .or_else(|| rec.options.get("videoTranscodeFormats"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_ascii_lowercase()))
                    .collect()
            });
        let image_transcode_scope = rec
            .options
            .get("image_transcode_scope")
            .or_else(|| rec.options.get("imageTranscodeScope"))
            .and_then(|v| v.as_str());
        let image_transcode_target = rec
            .options
            .get("image_transcode_target")
            .or_else(|| rec.options.get("imageTranscodeTarget"))
            .and_then(|v| v.as_str());
        let image_transcode_formats: Option<Vec<String>> = rec
            .options
            .get("image_transcode_formats")
            .or_else(|| rec.options.get("imageTranscodeFormats"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_ascii_lowercase()))
                    .collect()
            });
        for attempt in 0..=1 {
            match prepare_with_receipt(
                tid,
                preparation_source,
                quality_mode_value,
                hardware_override,
                encoder_strategy,
                encoder_resource_profile,
                encoder_max_parallel,
                encoder_allow_software_fallback,
                Some(primary_limit),
                video_transcode_scope,
                video_transcode_formats.as_deref(),
                image_transcode_scope,
                image_transcode_target,
                image_transcode_formats.as_deref(),
                app,
                item.index,
            ) {
                Ok(mut value) => {
                    if let Some(path) = muxed_remote_path.as_ref() {
                        value.cleanup_paths.push(path.clone());
                    }
                    prepared = Some(value);
                    break;
                }
                Err(error) => {
                    prepare_error = Some(error);
                    if attempt == 0 {
                        tg_log::warn(
                            "studio_orch",
                            "album_prepare_retry",
                            format!("transfer={tid} index={} retry=1", item.index),
                        );
                    }
                }
            }
        }
        let Some(artifact) = prepared else {
            if let Some(path) = muxed_remote_path.as_ref() {
                let _ = std::fs::remove_file(path);
            }
            preparation_failed = true;
            let message = format!(
                "prepare: {}",
                prepare_error.unwrap_or_else(|| "unknown preparation failure".into())
            );
            let state = ItemState::Failed;
            let _ =
                job_queue::update_item(tid, item.index, state.clone(), None, Some(message.clone()));
            emit_album_item_result(app, item.index, &state, None, Some(message));
            continue;
        };
        let mut classification = classify_prepared_delivery(
            std::path::Path::new(&artifact.prepared_path),
            mode,
            artifact.transformed,
            artifact.native_visual_validated,
        );
        classification.transform = artifact.transform_action;
        match rec
            .options
            .get("presentation_override")
            .or_else(|| rec.options.get("presentationOverride"))
            .and_then(|value| value.as_str())
            .unwrap_or("automatic")
        {
            "force_document" | "document" => {
                classification.payload_class = PayloadClass::DocumentGroup;
                classification.as_document = true;
                classification.reason_code = "presentation_forced_document".into();
            }
            "force_native_media" | "original" | "native"
                if classification.payload_class != PayloadClass::NativeVisual =>
            {
                if matches!(
                    classification.category,
                    MediaCategory::JpegImage
                        | MediaCategory::PngImage
                        | MediaCategory::WebpImage
                        | MediaCategory::Mp4Video
                ) {
                    classification.payload_class = PayloadClass::NativeVisual;
                    classification.as_document = false;
                    classification.reason_code = "forced_native_media_passthrough".into();
                } else {
                    classification.reason_code = "unsafe_native_override_rejected".into();
                }
            }
            _ => {}
        }
        {
            let incompat_image_mode = rec
                .options
                .get("album_incompat_image_mode")
                .or_else(|| rec.options.get("albumIncompatImageMode"))
                .and_then(|v| v.as_str())
                .unwrap_or("document");
            let incompat_anim_mode = rec
                .options
                .get("album_incompat_anim_mode")
                .or_else(|| rec.options.get("albumIncompatAnimMode"))
                .and_then(|v| v.as_str())
                .unwrap_or("document");
            let guarded_nonstandard_source = incompat_image_mode == "document"
                && apply_nonstandard_source_document_guard(
                    &item.path,
                    artifact.transformed,
                    &mut classification,
                );
            let is_incompat_image = matches!(
                classification.category,
                MediaCategory::WebpImage | MediaCategory::OtherImage | MediaCategory::PngImage
            ) && !artifact.transformed;
            let is_incompat_anim = matches!(
                classification.category,
                MediaCategory::GifImage | MediaCategory::OtherVideo
            ) && !artifact.transformed;
            if (guarded_nonstandard_source || is_incompat_image)
                && incompat_image_mode == "document"
            {
                classification.payload_class = PayloadClass::DocumentGroup;
                classification.as_document = true;
                classification.reason_code = "album_incompat_image_as_document".into();
                tg_log::info(
                    "studio_orch",
                    "album_incompat_image_document",
                    format!(
                        "transfer={tid} index={} cat={:?}",
                        item.index, classification.category
                    ),
                );
            } else if is_incompat_anim && incompat_anim_mode == "document" {
                classification.payload_class = PayloadClass::DocumentGroup;
                classification.as_document = true;
                classification.reason_code = "album_incompat_anim_as_document".into();
                tg_log::info(
                    "studio_orch",
                    "album_incompat_anim_document",
                    format!(
                        "transfer={tid} index={} cat={:?}",
                        item.index, classification.category
                    ),
                );
            }
        }
        let force_single = false;
        persist_prepared_decision(
            rec,
            item.index,
            &item.path,
            &artifact.prepared_path,
            &classification,
            runtime_limit,
        )?;
        tg_log::debug(
            "studio_orch",
            "album_item_classified",
            format!(
                "index={} category={:?} payload_class={:?} native_validated={} transformed={} reason={}",
                item.index,
                classification.category,
                classification.payload_class,
                artifact.native_visual_validated,
                artifact.transformed,
                classification.reason_code
            ),
        );
        let ledger_identity = prepared_ledger_identity(&artifact.prepared_path, &classification)?;
        if let Some(ledger_match) =
            duplicate_match_for_prepared(rec, topic_id, &item.path, &ledger_identity)?
        {
            if ledger_match.match_level == "exact_sha256" {
                let reason = format!(
                    "duplicate_exact_sha256: existing_message_id={}",
                    ledger_match
                        .telegram_message_id
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "unknown".into())
                );
                let state = ItemState::Skipped;
                job_queue::update_item(tid, item.index, state.clone(), None, Some(reason.clone()))?;
                super::autogram_core::transfer::record_transfer_item_decision(
                    tid,
                    item.index,
                    &item.path,
                    &artifact.prepared_path,
                    &serialized_label(&classification.category),
                    &serialized_label(&classification.payload_class),
                    &serialized_label(&classification.transform),
                    "SKIPPED",
                    "duplicate_exact_sha256",
                )?;
                emit_album_item_result(app, item.index, &state, None, Some(reason));
                any_ok = true;
                artifact.cleanup();
                continue;
            }
            tg_log::info(
                "studio_orch",
                "duplicate_probable_not_skipped",
                format!(
                    "transfer={tid} index={} match={}",
                    item.index, ledger_match.match_level
                ),
            );
        }
        ledger_identities.insert(item.index, ledger_identity);
        let size = std::fs::metadata(&artifact.prepared_path)
            .map(|meta| meta.len())
            .unwrap_or(item.size);
        let item_caption = if let Some(summary) = album_summary.as_deref() {
            if size > primary_limit && !album_summary_consumed && prepared_items.is_empty() {
                summary
            } else {
                ""
            }
        } else {
            normalized_item_captions
                .get(&item.index)
                .map(String::as_str)
                .unwrap_or_default()
        };
        if size > primary_limit && !feature_flags.oversize_routing {
            preparation_failed = true;
            let message = format!(
                "OVERSIZE_ROUTING_DISABLED: item {} is {size} bytes; effective limit is {primary_limit}",
                item.index
            );
            let state = ItemState::Failed;
            let _ =
                job_queue::update_item(tid, item.index, state.clone(), None, Some(message.clone()));
            emit_album_item_result(app, item.index, &state, None, Some(message.clone()));
            if first_error.is_none() {
                first_error = Some(message);
            }
            artifact.cleanup();
            continue;
        }
        if !whole_album_alternate_requested {
            match handle_oversize_prepared(
                app,
                rec,
                tid,
                sessions,
                identity,
                topic_id,
                silent,
                spoiler,
                schedule_at,
                send_as.as_deref(),
                item.index,
                item_caption,
                &artifact.prepared_path,
                size,
                runtime_limit,
                classification.as_document,
                true,
                failure_policy.permits_structural_replan(),
            ) {
                Ok(Some(success)) => {
                    any_ok |= success;
                    let oversize_action = rec
                        .options
                        .get("oversize_action")
                        .or_else(|| rec.options.get("oversizeAction"))
                        .and_then(|value| value.as_str())
                        .unwrap_or("split");
                    if success
                        && size > primary_limit
                        && oversize_action != "skip"
                        && !item_caption.is_empty()
                    {
                        album_summary_consumed = true;
                    }
                    artifact.cleanup();
                    continue;
                }
                Err(error) => {
                    preparation_failed = true;
                    let state = ItemState::Failed;
                    let _ = job_queue::update_item(
                        tid,
                        item.index,
                        state.clone(),
                        None,
                        Some(error.clone()),
                    );
                    emit_album_item_result(app, item.index, &state, None, Some(error.clone()));
                    if first_error.is_none() {
                        first_error = Some(error);
                    }
                    artifact.cleanup();
                    continue;
                }
                Ok(None) => {}
            }
        }
        prepared_items.push(PreparedAlbumItem {
            index: item.index,
            path: artifact.prepared_path.clone(),
            caption: if album_summary.is_some() {
                String::new()
            } else {
                item_caption.to_string()
            },
            spoiler,
            size,
            key: AlbumCompatibilityKey {
                account_id: rec.session.clone(),
                peer_id: rec.chat_id.clone(),
                topic_id,
                reply_to: topic_id,
                send_as: send_as.clone(),
                schedule_at,
                silent,
                payload_class: classification.payload_class,
            },
            force_single,
        });
        artifacts.insert(item.index, artifact);

        // Streaming flush: as soon as we have at least `stream_group_size + stream_lookahead_tail`
        // compatible visual items prepared, flush the leading `stream_group_size` group immediately
        // so large transfers begin uploading right away without waiting for all 2,600+ items.
        if can_stream_groups
            && prepared_items.len() >= stream_group_size + stream_lookahead_tail
            && prepared_items.first().is_some_and(|first| {
                first.key.payload_class == PayloadClass::NativeVisual
                    && !first.force_single
                    && prepared_items
                        .iter()
                        .take(stream_group_size)
                        .all(|it| it.key == first.key && !it.force_single)
            })
        {
            let mut chunk_items: Vec<PreparedAlbumItem> =
                prepared_items.drain(0..stream_group_size).collect();
            let caption_assignment = apply_album_caption_policy(
                &mut chunk_items,
                if album_summary_consumed {
                    None
                } else {
                    album_summary.as_deref()
                },
                caption_limit,
                caption_policy,
            )?;
            if caption_assignment.item_index.is_some() {
                album_summary_consumed = true;
            }
            let chunk_options = AlbumPlanOptions {
                packing: AlbumPackingPolicy::Custom,
                custom_size: stream_group_size,
                ..plan_options.clone()
            };
            let chunk_plan = build_album_plan(chunk_items, &chunk_options);
            execute_album_plan_chunk(
                app,
                rec,
                tid,
                sessions,
                &mut album_pool,
                topic_id,
                silent,
                chunk_plan,
                &ledger_identities,
                &mut artifacts,
                &mut any_ok,
                &mut first_error,
            )?;
        }
    }

    if preparation_failed && !failure_policy.permits_structural_replan() {
        let message = format!(
            "album_atomic_preflight_failed: policy={failure_policy:?}; no album commit was attempted"
        );
        for item in &prepared_items {
            let state = ItemState::Failed;
            let _ =
                job_queue::update_item(tid, item.index, state.clone(), None, Some(message.clone()));
            emit_album_item_result(app, item.index, &state, None, Some(message.clone()));
        }
        for (_, artifact) in artifacts {
            artifact.cleanup();
        }
        let _ = job_queue::set_transfer_state(tid, TransferState::Failed);
        let _ = super::autogram_core::transfer::update_transfer_run_state(tid, "FAILED");
        return Err(message);
    }

    let largest_prepared_item = prepared_items
        .iter()
        .map(|item| item.size)
        .max()
        .unwrap_or(0);
    if whole_album_alternate_requested && largest_prepared_item > primary_limit {
        let alternate_result = if !failure_policy.permits_structural_replan() {
            Err(format!(
                "album_replan_confirmation_required: album contains an item larger than {primary_limit} bytes"
            ))
        } else if !option_bool(
            &rec.options,
            "alternate_identity_approved",
            "alternateIdentityApproved",
            false,
        ) {
            Err("ALTERNATE_IDENTITY_CHANGE: explicit sender approval is required".into())
        } else {
            grammers_ops::resolve_approved_alternate_identity(
                sessions,
                identity,
                &rec.chat_id,
                largest_prepared_item,
                &approved_alternate_sessions(rec),
            )
        };
        match alternate_result {
            Ok(alternate) => {
                for item in &mut prepared_items {
                    item.key.account_id = alternate.session.clone();
                }
                tg_log::info(
                    "studio_orch",
                    "album_whole_alternate_resolved",
                    format!(
                        "transfer={tid} sender={} items={} largest_bytes={largest_prepared_item}",
                        alternate.session,
                        prepared_items.len()
                    ),
                );
                album_pool = AlbumAccountPool::new(sessions, &alternate, rec, &rec.chat_id);
            }
            Err(error) => {
                let message = format!("album_whole_alternate_preflight_failed: {error}");
                for item in &prepared_items {
                    let state = ItemState::Failed;
                    let _ = job_queue::update_item(
                        tid,
                        item.index,
                        state.clone(),
                        None,
                        Some(message.clone()),
                    );
                    emit_album_item_result(app, item.index, &state, None, Some(message.clone()));
                }
                for (_, artifact) in artifacts {
                    artifact.cleanup();
                }
                let _ = job_queue::set_transfer_state(tid, TransferState::Failed);
                let _ = super::autogram_core::transfer::update_transfer_run_state(tid, "FAILED");
                return Err(message);
            }
        }
    }

    if !prepared_items.is_empty() {
        let caption_assignment = apply_album_caption_policy(
            &mut prepared_items,
            if album_summary_consumed {
                None
            } else {
                album_summary.as_deref()
            },
            caption_limit,
            caption_policy,
        )?;
        if caption_assignment.item_index.is_some() || caption_assignment.truncated {
            tg_log::info(
                "studio_orch",
                "album_caption_frozen",
                format!(
                    "transfer={tid} item_index={:?} original_utf16={} final_utf16={} truncated={}",
                    caption_assignment.item_index,
                    caption_assignment.original_utf16_len,
                    caption_assignment.final_utf16_len,
                    caption_assignment.truncated
                ),
            );
        }
        let plan = build_album_plan(prepared_items, &plan_options);
        tg_log::info(
            "studio_orch",
            "album_plan_frozen",
            format!(
                "transfer={tid} groups={} singles={} packing={packing:?}",
                plan.groups.len(),
                plan.singles.len()
            ),
        );
        let group_partition_summary = plan
            .groups
            .iter()
            .map(|g| g.items.len().to_string())
            .collect::<Vec<_>>()
            .join("+");
        let policy_name = match packing {
            AlbumPackingPolicy::SmartAdaptive => "Smart Auto-Adaptive (100% Anti-Split)",
            AlbumPackingPolicy::Balanced => "Safe Balanced (6-8)",
            AlbumPackingPolicy::Maximum => "Maximum 10 (Agresif)",
            AlbumPackingPolicy::Custom => "Custom Grid",
            AlbumPackingPolicy::FollowSelection => "Follow Selection",
            AlbumPackingPolicy::Never => "Never",
        };
        persist_transfer_log(
            tid,
            "info",
            "album_plan_frozen",
            format!(
                "Rencana pengiriman media siap: {} grup album (partisi kolase: [{}]), {} berkas tunggal. Strategi: {policy_name}.",
                plan.groups.len(),
                if group_partition_summary.is_empty() {
                    "0".to_string()
                } else {
                    group_partition_summary
                },
                plan.singles.len()
            ),
        );

        execute_album_plan_chunk(
            app,
            rec,
            tid,
            sessions,
            &mut album_pool,
            topic_id,
            silent,
            plan,
            &ledger_identities,
            &mut artifacts,
            &mut any_ok,
            &mut first_error,
        )?;
    }

    for (_, artifact) in artifacts {
        artifact.cleanup();
    }
    if any_ok {
        Ok(finalize_transfer(
            tid,
            rec.items.len(),
            "rust_orch_grammers_intelligent_album",
        ))
    } else {
        let _ = job_queue::set_transfer_state(tid, TransferState::Failed);
        let _ = super::autogram_core::transfer::update_transfer_run_state(tid, "FAILED");
        Err(format!(
            "grammers album upload failed: {}",
            first_error.unwrap_or_else(|| "no deliverable prepared output".into())
        ))
    }
}
