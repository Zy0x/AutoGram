//! Studio orchestrator — Rust owns queue order.
//!
//! Upload steps use Grammers only. There is no Python/Telethon runtime fallback.

use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};

use super::autogram_core;
use super::autogram_core::transfer::{
    classify_prepared_delivery, normalize_caption, CaptionOverflowPolicy, DeliveryClassification,
    MediaCategory, PayloadClass, QualityMode, TransferFeatureFlags,
};
use super::grammers_ops::{self, resolve_sessions_dir};
use super::job_queue::{self, CreateTransferRequest, ItemState, TransferRecord, TransferState};
use super::media_prep;
use super::session_guard::{self, SessionPurpose};
use super::telegram_ops::TelegramIdentity;
use super::tg_log;

#[path = "studio_orch_album.rs"]
mod studio_orch_album;
use studio_orch_album::run_intelligent_album;

static ORCH_JOB_SEQ: AtomicI64 = AtomicI64::new(993_100);

fn option_bool(options: &serde_json::Value, snake: &str, camel: &str, default: bool) -> bool {
    options
        .get(snake)
        .or_else(|| options.get(camel))
        .and_then(|value| value.as_bool())
        .unwrap_or(default)
}

fn is_nonstandard_image_source(path: &str) -> bool {
    let p = std::path::Path::new(path);
    super::autogram_core::transfer::is_nonstandard_image_ext(p)
}

/// A non-standard image that was deliberately left untouched must remain a
/// Telegram document. This source-path guard is intentionally independent of
/// magic-byte classification: files carrying JPEG bytes under a `.webp` name
/// are still governed by the user's lossless/raw delivery choice and must not
/// be silently renamed or recompressed by Telegram as native photos.
fn apply_nonstandard_source_document_guard(
    source_path: &str,
    transformed: bool,
    classification: &mut DeliveryClassification,
) -> bool {
    if transformed || !is_nonstandard_image_source(source_path) {
        return false;
    }
    if classification.payload_class == PayloadClass::NativeVisual {
        classification.payload_class = PayloadClass::DocumentGroup;
    }
    classification.as_document = true;
    classification.reason_code = "untransformed_nonstandard_source_document".into();
    true
}

fn option_usize(options: &serde_json::Value, snake: &str, camel: &str, default: usize) -> usize {
    options
        .get(snake)
        .or_else(|| options.get(camel))
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .unwrap_or(default)
}

/// Read the resolver-produced adaptive pair for one queue item. The pair is
/// optional and credential-free; malformed entries are ignored so legacy queue
/// records continue through the ordinary direct-URL path.
fn remote_mux_for_item(
    options: &serde_json::Value,
    item_index: usize,
) -> Option<(String, String, String)> {
    let value = options
        .get("remote_muxes")
        .or_else(|| options.get("remoteMuxes"))?
        .as_array()?
        .get(item_index)?;
    if value.is_null() {
        return None;
    }
    let video_url = value
        .get("videoUrl")
        .or_else(|| value.get("video_url"))
        .and_then(|value| value.as_str())?
        .trim();
    let audio_url = value
        .get("audioUrl")
        .or_else(|| value.get("audio_url"))
        .and_then(|value| value.as_str())?
        .trim();
    let output_ext = value
        .get("outputExt")
        .or_else(|| value.get("output_ext"))
        .and_then(|value| value.as_str())
        .unwrap_or("mp4")
        .trim()
        .to_ascii_lowercase();
    if !(video_url.starts_with("http://") || video_url.starts_with("https://"))
        || !(audio_url.starts_with("http://") || audio_url.starts_with("https://"))
        || !matches!(output_ext.as_str(), "mp4" | "webm" | "mkv")
    {
        return None;
    }
    Some((video_url.to_string(), audio_url.to_string(), output_ext))
}

fn effective_upload_limit(rec: &TransferRecord, runtime_limit: u64) -> u64 {
    rec.options
        .get("account_max_file_size_bytes")
        .or_else(|| rec.options.get("max_file_size_bytes"))
        .and_then(|value| value.as_u64())
        .map(|configured| configured.min(runtime_limit))
        .unwrap_or(runtime_limit)
}

fn approved_alternate_sessions(rec: &TransferRecord) -> Vec<String> {
    rec.options
        .get("alternate_account_pool")
        .or_else(|| rec.options.get("alternateAccountPool"))
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn item_spoiler(options: &serde_json::Value, item_index: usize) -> bool {
    option_bool(options, "spoiler", "spoiler", false)
        || options
            .get("spoiler_item_indices")
            .or_else(|| options.get("spoilerItemIndices"))
            .and_then(|value| value.as_array())
            .is_some_and(|indices| {
                indices
                    .iter()
                    .filter_map(|value| value.as_u64())
                    .any(|value| value as usize == item_index)
            })
}

#[allow(clippy::too_many_arguments)]
fn prepare_with_receipt(
    transfer_id: &str,
    source_path: &str,
    quality_mode: Option<&str>,
    hardware_override: Option<&str>,
    encoder_strategy: Option<&str>,
    encoder_resource_profile: Option<&str>,
    encoder_max_parallel: usize,
    encoder_allow_software_fallback: bool,
    target_max_bytes: Option<u64>,
    video_transcode_scope: Option<&str>,
    video_transcode_formats: Option<&[String]>,
    image_transcode_scope: Option<&str>,
    image_transcode_target: Option<&str>,
    image_transcode_formats: Option<&[String]>,
    app: Option<&tauri::AppHandle>,
    item_index: usize,
) -> Result<media_prep::PreparedUploadArtifact, String> {
    let receipt_id = format!("{transfer_id}:encoder:{item_index}");
    let strategy = encoder_strategy.unwrap_or("auto_adaptive");
    super::autogram_core::transfer::begin_encoder_receipt(
        &receipt_id,
        transfer_id,
        item_index,
        strategy,
        hardware_override,
        &json!({
            "sourcePath": source_path,
            "qualityMode": quality_mode,
            "resourceProfile": encoder_resource_profile.unwrap_or("balanced"),
            "maxParallel": encoder_max_parallel,
            "allowSoftwareFallback": encoder_allow_software_fallback,
            "targetMaxBytes": target_max_bytes,
        }),
    )?;
    match media_prep::prepare_upload_artifact_with_policy(
        source_path,
        quality_mode,
        hardware_override,
        encoder_strategy,
        encoder_resource_profile,
        encoder_max_parallel,
        encoder_allow_software_fallback,
        target_max_bytes,
        video_transcode_scope,
        video_transcode_formats,
        image_transcode_scope,
        image_transcode_target,
        image_transcode_formats,
        app,
        item_index,
    ) {
        Ok(artifact) => {
            let size = std::fs::metadata(&artifact.prepared_path)
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            let output = json!({
                "preparedPath": &artifact.prepared_path,
                "transformed": artifact.transformed,
                "nativeVisualValidated": artifact.native_visual_validated,
                "transformAction": artifact.transform_action,
                "size": size,
            });
            super::autogram_core::transfer::finish_encoder_receipt(
                &receipt_id,
                if artifact.transformed {
                    "COMPLETED"
                } else {
                    "PASSTHROUGH"
                },
                Some(&output),
                &json!({ "exists": size > 0, "size": size }),
            )?;
            Ok(artifact)
        }
        Err(error) => {
            let _ = super::autogram_core::transfer::finish_encoder_receipt::<serde_json::Value, _>(
                &receipt_id,
                "FAILED",
                None,
                &json!({ "error": &error }),
            );
            Err(error)
        }
    }
}

fn serialized_label<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| "unknown".into())
}

fn persist_prepared_decision(
    rec: &TransferRecord,
    item_index: usize,
    source_path: &str,
    prepared_path: &str,
    classification: &DeliveryClassification,
    runtime_limit: u64,
) -> Result<(), String> {
    let (analysis_key, _, _) =
        super::autogram_core::transfer::analysis_cache_key(std::path::Path::new(prepared_path));
    let profile_json = serde_json::to_vec(&rec.options).map_err(|error| error.to_string())?;
    let profile_digest = super::autogram_core::transfer::sha256_bytes(&profile_json);
    let capability_digest = super::autogram_core::transfer::sha256_bytes(
        format!("{}|{}", rec.session, runtime_limit).as_bytes(),
    );
    let decision_key = super::autogram_core::transfer::sha256_bytes(
        format!("{analysis_key}|{profile_digest}|{capability_digest}").as_bytes(),
    );
    super::autogram_core::transfer::persist_transfer_decision(
        &decision_key,
        &analysis_key,
        &profile_digest,
        &capability_digest,
        classification,
    )?;
    super::autogram_core::transfer::record_transfer_item_decision(
        &rec.transfer_id,
        item_index,
        source_path,
        prepared_path,
        &serialized_label(&classification.category),
        &serialized_label(&classification.payload_class),
        &serialized_label(&classification.transform),
        "PREPARED",
        &classification.reason_code,
    )
}

#[derive(Debug, Clone)]
struct PreparedLedgerIdentity {
    prepared_path: String,
    sha256: String,
    filename: String,
    size: u64,
    payload_class: String,
}

fn duplicate_skip_enabled(rec: &TransferRecord, source_path: &str) -> bool {
    let force_all = rec
        .options
        .get("force_upload")
        .or_else(|| rec.options.get("forceUpload"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    if force_all {
        return false;
    }
    let policy_skips = rec
        .options
        .get("duplicate_policy")
        .or_else(|| rec.options.get("duplicatePolicy"))
        .and_then(|value| value.as_str())
        .map(|value| value.eq_ignore_ascii_case("SKIP"))
        .unwrap_or(false);
    if !policy_skips {
        return false;
    }
    !rec.options
        .get("duplicate_force_upload_paths")
        .or_else(|| rec.options.get("duplicateForceUploadPaths"))
        .and_then(|value| value.as_array())
        .is_some_and(|paths| {
            paths
                .iter()
                .filter_map(|value| value.as_str())
                .any(|value| value == source_path)
        })
}

fn duplicate_match_for_source(
    rec: &TransferRecord,
    topic_id: Option<i64>,
    source_path: &str,
) -> Result<Option<super::autogram_core::transfer::UploadLedgerMatch>, String> {
    if !duplicate_skip_enabled(rec, source_path) || media_prep::is_remote_url(source_path) {
        return Ok(None);
    }
    let path = std::path::Path::new(source_path);
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    super::autogram_core::transfer::find_source_upload_ledger_match(
        &rec.session,
        &rec.chat_id,
        topic_id,
        path,
        filename,
    )
    .map(|opt| opt.map(|(matched, _, _)| matched))
}

fn prepared_ledger_identity(
    prepared_path: &str,
    classification: &DeliveryClassification,
) -> Result<PreparedLedgerIdentity, String> {
    let path = std::path::Path::new(prepared_path);
    Ok(PreparedLedgerIdentity {
        prepared_path: prepared_path.to_string(),
        sha256: super::autogram_core::transfer::sha256_file(path)?,
        filename: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
            .to_string(),
        size: std::fs::metadata(path)
            .map(|metadata| metadata.len())
            .map_err(|error| format!("read prepared identity: {error}"))?,
        payload_class: serialized_label(&classification.payload_class),
    })
}

fn duplicate_match_for_prepared(
    rec: &TransferRecord,
    topic_id: Option<i64>,
    source_path: &str,
    identity: &PreparedLedgerIdentity,
) -> Result<Option<super::autogram_core::transfer::UploadLedgerMatch>, String> {
    if !duplicate_skip_enabled(rec, source_path) {
        return Ok(None);
    }
    super::autogram_core::transfer::find_upload_ledger_match(
        &rec.session,
        &rec.chat_id,
        topic_id,
        &identity.sha256,
        &identity.filename,
        identity.size,
    )
}

fn persist_upload_ledger_binding(
    rec: &TransferRecord,
    topic_id: Option<i64>,
    uploader_account_id: &str,
    telegram_message_id: Option<i64>,
    item_index: usize,
    identity: &PreparedLedgerIdentity,
) {
    if let Err(error) = super::autogram_core::transfer::record_upload_ledger(
        uploader_account_id,
        &rec.chat_id,
        topic_id,
        telegram_message_id,
        None,
        &identity.sha256,
        &identity.filename,
        identity.size,
        &identity.payload_class,
    ) {
        tg_log::warn(
            "studio_orch",
            "upload_ledger_persist_failed",
            format!("transfer={} error={error}", rec.transfer_id),
        );
    }

    // Preflight sees the original source path, while the final duplicate guard sees
    // the prepared artifact. Persist both identities so the next preflight can skip
    // immediately without repeating preparation, while retaining the final-output
    // guard for transforms whose bytes differ from the source.
    let Some(source_item) = rec.items.iter().find(|item| item.index == item_index) else {
        return;
    };
    if media_prep::is_remote_url(&source_item.path) || source_item.path == identity.prepared_path {
        return;
    }
    let source_path = std::path::Path::new(&source_item.path);
    let source_identity =
        super::autogram_core::transfer::sha256_file(source_path).and_then(|sha256| {
            Ok(PreparedLedgerIdentity {
                prepared_path: source_item.path.clone(),
                sha256,
                filename: source_path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("file")
                    .to_string(),
                size: std::fs::metadata(source_path)
                    .map(|metadata| metadata.len())
                    .map_err(|error| format!("read source identity: {error}"))?,
                payload_class: identity.payload_class.clone(),
            })
        });
    match source_identity {
        Ok(source_identity) if source_identity.sha256 != identity.sha256 => {
            if let Err(error) = super::autogram_core::transfer::record_upload_ledger(
                uploader_account_id,
                &rec.chat_id,
                topic_id,
                telegram_message_id,
                None,
                &source_identity.sha256,
                &source_identity.filename,
                source_identity.size,
                &source_identity.payload_class,
            ) {
                tg_log::warn(
                    "studio_orch",
                    "upload_source_ledger_persist_failed",
                    format!(
                        "transfer={} index={} error={error}",
                        rec.transfer_id, item_index
                    ),
                );
            }
        }
        Ok(_) => {}
        Err(error) => tg_log::warn(
            "studio_orch",
            "upload_source_ledger_identity_failed",
            format!(
                "transfer={} index={} error={error}",
                rec.transfer_id, item_index
            ),
        ),
    }
}

fn persist_upload_ledger_for_path(
    rec: &TransferRecord,
    topic_id: Option<i64>,
    uploader_account_id: &str,
    telegram_message_id: Option<i64>,
    item_index: usize,
    prepared_path: &str,
    as_document: bool,
) {
    let path = std::path::Path::new(prepared_path);
    let identity = super::autogram_core::transfer::sha256_file(path).and_then(|sha256| {
        Ok(PreparedLedgerIdentity {
            prepared_path: prepared_path.to_string(),
            sha256,
            filename: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("file")
                .to_string(),
            size: std::fs::metadata(path)
                .map(|metadata| metadata.len())
                .map_err(|error| format!("read prepared identity: {error}"))?,
            payload_class: if as_document {
                "document_group".into()
            } else {
                "native_visual".into()
            },
        })
    });
    match identity {
        Ok(identity) => persist_upload_ledger_binding(
            rec,
            topic_id,
            uploader_account_id,
            telegram_message_id,
            item_index,
            &identity,
        ),
        Err(error) => tg_log::warn(
            "studio_orch",
            "upload_ledger_identity_failed",
            format!("transfer={} error={error}", rec.transfer_id),
        ),
    }
}

fn emit_album_item_result(
    app: Option<&tauri::AppHandle>,
    index: usize,
    state: &ItemState,
    message_id: Option<i64>,
    error: Option<String>,
) {
    if let Some(app) = app {
        use tauri::Emitter;
        let status = match state {
            ItemState::Done => "done",
            ItemState::Skipped => "skipped",
            ItemState::UnknownCommit => "unknown_commit",
            ItemState::Reconciling => "reconciling",
            _ => "failed",
        };
        let _ = app.emit(
            "transfer-event",
            serde_json::json!({
                "type": "StudioItemDone",
                "index": index,
                "status": status,
                "message_id": message_id,
                "error": error,
            }),
        );
    }
}

fn handle_oversize_prepared(
    app: Option<&tauri::AppHandle>,
    rec: &TransferRecord,
    tid: &str,
    sessions: &std::path::Path,
    identity: &TelegramIdentity,
    topic_id: Option<i64>,
    silent: bool,
    spoiler: bool,
    schedule_at: Option<i64>,
    send_as: Option<&str>,
    item_index: usize,
    caption: &str,
    prepared_path: &str,
    actual_size: u64,
    runtime_limit: u64,
    as_document: bool,
    album_context: bool,
    allow_structural_replan: bool,
) -> Result<Option<bool>, String> {
    let limit = effective_upload_limit(rec, runtime_limit);
    if actual_size <= limit {
        return Ok(None);
    }
    if !allow_structural_replan {
        return Err(format!(
            "album_replan_confirmation_required: item {item_index} exceeds account limit"
        ));
    }
    let action = rec
        .options
        .get("oversize_action")
        .or_else(|| rec.options.get("oversizeAction"))
        .and_then(|value| value.as_str())
        .unwrap_or("split");
    match action {
        "skip" => {
            let message =
                format!("oversize_skip: {actual_size} bytes exceeds account limit {limit}");
            let state = ItemState::Skipped;
            job_queue::update_item(tid, item_index, state.clone(), None, Some(message.clone()))?;
            emit_album_item_result(app, item_index, &state, None, Some(message));
            Ok(Some(true))
        }
        "alternate_account" => {
            if !option_bool(
                &rec.options,
                "alternate_identity_approved",
                "alternateIdentityApproved",
                false,
            ) {
                return Err(
                    "ALTERNATE_IDENTITY_CHANGE: explicit sender approval is required".into(),
                );
            }
            if album_context {
                match rec
                    .options
                    .get("album_alternate_strategy")
                    .or_else(|| rec.options.get("albumAlternateStrategy"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("cancel_group")
                {
                    "separate_item" => {}
                    "move_whole_group" => {
                        return Err("album_whole_alternate_replan_required: whole-group eligibility must be proven before any item is sent".into())
                    }
                    _ => return Err("album_alternate_cancelled_by_policy".into()),
                }
            }
            let approved_sessions = approved_alternate_sessions(rec);
            let alternate = match grammers_ops::resolve_approved_alternate_identity(
                sessions,
                identity,
                &rec.chat_id,
                actual_size,
                &approved_sessions,
            ) {
                Ok(alt) => alt,
                Err(err) => {
                    let fallback_action = rec
                        .options
                        .get("oversize_fallback_action")
                        .or_else(|| rec.options.get("oversizeFallbackAction"))
                        .and_then(|value| value.as_str())
                        .unwrap_or("split");

                    crate::core::tg_log::warn(
                        "studio_orch",
                        "alternate_account_fallback",
                        format!("No eligible premium session ({err}). Using fallback strategy '{fallback_action}'"),
                    );

                    match fallback_action {
                        "skip" => {
                            let message = format!("oversize_skip: {actual_size} bytes exceeds limit {limit} and no premium session is available");
                            let state = ItemState::Skipped;
                            job_queue::update_item(
                                tid,
                                item_index,
                                state.clone(),
                                None,
                                Some(message.clone()),
                            )?;
                            emit_album_item_result(app, item_index, &state, None, Some(message));
                            return Ok(Some(true));
                        }
                        _ => {
                            // Fall back to split parts engine
                            return Ok(None);
                        }
                    }
                }
            };
            let result = grammers_ops::upload_file_blocking_topic_with_delivery(
                sessions,
                &alternate,
                &rec.chat_id,
                prepared_path,
                caption,
                as_document,
                silent,
                spoiler,
                item_index,
                topic_id,
                schedule_at,
                send_as.map(str::to_string),
                app.cloned(),
                Some(tid.to_string()),
            )
            .map_err(|error| error.user_message())?;
            if !matches!(result.status.as_str(), "done" | "success") {
                return Err(result
                    .error
                    .unwrap_or_else(|| "alternate account delivery failed".into()));
            }
            super::autogram_core::transfer::record_alternate_upload(
                tid,
                item_index,
                &alternate.session,
                result.message_id,
            )?;
            persist_upload_ledger_for_path(
                rec,
                topic_id,
                &alternate.session,
                result.message_id,
                item_index,
                prepared_path,
                as_document,
            );
            let state = ItemState::Done;
            job_queue::update_item(tid, item_index, state.clone(), result.message_id, None)?;
            emit_album_item_result(app, item_index, &state, result.message_id, None);
            Ok(Some(true))
        }
        _ => {
            let split_root = std::env::temp_dir()
                .join("autogram-transfer-split")
                .join(format!("{tid}-{item_index}"));
            let part_limit = limit
                .saturating_mul(95)
                .checked_div(100)
                .unwrap_or(0)
                .max(1);
            let mut bundle =
                super::autogram_core::execution::split_engine::split_with_public_manifest(
                    std::path::Path::new(prepared_path),
                    &split_root,
                    part_limit,
                )?;
            let _ = job_queue::update_item(tid, item_index, ItemState::Uploading, None, None);
            let mut message_ids = Vec::new();
            for part in &bundle.parts {
                let result = grammers_ops::upload_file_blocking_topic_with_delivery(
                    sessions,
                    identity,
                    &rec.chat_id,
                    part.path.to_string_lossy().as_ref(),
                    "",
                    true,
                    silent,
                    spoiler,
                    item_index,
                    topic_id,
                    schedule_at,
                    send_as.map(str::to_string),
                    app.cloned(),
                    Some(tid.to_string()),
                )
                .map_err(|error| error.user_message())?;
                if !matches!(result.status.as_str(), "done" | "success") {
                    return Err(result
                        .error
                        .unwrap_or_else(|| "split part delivery failed".into()));
                }
                if let Some(message_id) = result.message_id {
                    message_ids.push(message_id);
                }
            }
            bundle.manifest.telegram_message_ids = message_ids.clone();
            bundle.manifest.write_to(&bundle.manifest_path)?;
            let manifest_result = grammers_ops::upload_file_blocking_topic_with_delivery(
                sessions,
                identity,
                &rec.chat_id,
                bundle.manifest_path.to_string_lossy().as_ref(),
                caption,
                true,
                silent,
                spoiler,
                item_index,
                topic_id,
                schedule_at,
                send_as.map(str::to_string),
                app.cloned(),
                Some(tid.to_string()),
            )
            .map_err(|error| error.user_message())?;
            if !matches!(manifest_result.status.as_str(), "done" | "success") {
                return Err(manifest_result
                    .error
                    .unwrap_or_else(|| "split manifest delivery failed".into()));
            }
            let state = ItemState::Done;
            job_queue::update_item(
                tid,
                item_index,
                state.clone(),
                manifest_result.message_id,
                None,
            )?;
            emit_album_item_result(app, item_index, &state, manifest_result.message_id, None);
            persist_upload_ledger_for_path(
                rec,
                topic_id,
                &identity.session,
                manifest_result.message_id,
                item_index,
                prepared_path,
                true,
            );
            let _ = std::fs::remove_dir_all(&split_root);
            Ok(Some(true))
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchStartResult {
    pub transfer_id: String,
    pub mode: String,
    pub items: usize,
    pub message: String,
}

/// Create queue entry only (UI may list it before run).
pub fn enqueue(req: CreateTransferRequest) -> Result<TransferRecord, String> {
    job_queue::create_transfer(req)
}

fn finalize_transfer(tid: &str, items_len: usize, mode: &str) -> OrchStartResult {
    if let Some(r) = job_queue::get_transfer(tid) {
        if r.state == TransferState::Running {
            let st = if r.failed_count == 0 && r.done_count > 0 {
                TransferState::Completed
            } else if r.done_count == 0 && r.failed_count > 0 {
                TransferState::Failed
            } else if r.done_count + r.failed_count >= r.items.len() {
                TransferState::Completed
            } else {
                TransferState::Failed
            };
            let _ = job_queue::set_transfer_state(tid, st);
        }
    }
    let final_rec = job_queue::get_transfer(tid);
    let durable_state = match final_rec.as_ref().map(|record| &record.state) {
        Some(TransferState::Completed) => "COMPLETED",
        Some(TransferState::Cancelled) => "CANCELLED",
        _ => "FAILED",
    };
    let _ = super::autogram_core::transfer::update_transfer_run_state(tid, durable_state);
    let msg = match final_rec {
        Some(r) if r.failed_count == 0 => {
            format!("Orchestrated upload complete: {} done", r.done_count)
        }
        Some(r) => format!(
            "Orchestrated upload finished: {} done, {} failed",
            r.done_count, r.failed_count
        ),
        None => "Orchestrated upload finished".into(),
    };
    OrchStartResult {
        transfer_id: tid.to_string(),
        mode: mode.into(),
        items: items_len,
        message: msg,
    }
}

fn run_orchestrated_grammers(
    app: Option<&tauri::AppHandle>,
    req: &CreateTransferRequest,
) -> Result<OrchStartResult, String> {
    let rec = job_queue::create_transfer(req.clone())?;
    let tid = rec.transfer_id.clone();
    let feature_flags = TransferFeatureFlags::resolve();
    job_queue::clear_cancel_flag_for(&tid);
    job_queue::set_transfer_state(&tid, TransferState::Running)?;
    super::autogram_core::transfer::freeze_transfer_run(
        &tid,
        &json!({
            "profile": rec.options,
            "resolvedFeatureFlags": feature_flags,
        }),
    )?;

    if let Some(app) = app {
        use tauri::Emitter;
        let _ = app.emit(
            "transfer-event",
            serde_json::json!({
                "type": "StudioStarted",
                "items": rec.items.len(),
                "mode": "upload"
                ,"engineMode": feature_flags.engine_mode()
            }),
        );
    }

    // Shared transfer lease — blocks exclusive Telethon dual-open, coexists with Studio.
    let session_name = req.session.trim();
    let _session_guard = if !session_name.is_empty() {
        Some(
            session_guard::SessionGuardToken::acquire(
                session_name,
                &format!("transfer-{tid}"),
                SessionPurpose::Transfer,
            )
            .map_err(|e| e.user_message())?,
        )
    } else {
        None
    };

    let sessions = resolve_sessions_dir(None);
    std::env::set_var("AUTOGRAM_SESSIONS_DIR", sessions.display().to_string());

    // Best-effort import Telethon session → Grammers JSON once
    let _ = grammers_ops::import_session_blocking(&sessions, &rec.session);

    let identity = TelegramIdentity {
        session: rec.session.clone(),
        api_id: rec.api_id,
        api_hash: req.api_hash.clone(),
    };
    let account_capability =
        grammers_ops::resolve_account_capability_blocking(&sessions, &identity);
    if let Some(app) = app {
        use tauri::Emitter;
        let _ = app.emit(
            "transfer-event",
            json!({
                "type": "TransferCapabilityResolved",
                "source": account_capability.source,
                "isPremium": account_capability.is_premium,
                "maxParts": account_capability.max_parts,
                "partSize": account_capability.selected_part_size,
                "effectiveMaxBytes": account_capability.effective_max_bytes,
                "captionLimit": account_capability.caption_limit,
            }),
        );
    }

    // as_document from options
    // In transfer-v4, ORIGINAL means preserve each prepared artifact without a
    // lossy transform; it does not mean that every artifact must be sent as a
    // Telegram document.  The per-item classifier below is the authority for
    // WebP/HEIC/images/videos.  Forcing ORIGINAL here used to overwrite that
    // decision and made mixed albums and explicit image conversion conflict.
    let as_doc = !feature_flags.transfer_v4
        || rec
            .options
            .get("quality_mode")
            .or_else(|| rec.options.get("qualityMode"))
            .and_then(|v| v.as_str())
            .map(|s| s.eq_ignore_ascii_case("DOCUMENT"))
            .unwrap_or(false)
        || rec
            .options
            .get("force_document")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        || rec
            .options
            .get("presentation_override")
            .or_else(|| rec.options.get("presentationOverride"))
            .and_then(|v| v.as_str())
            .map(|value| value == "force_document" || value == "document")
            .unwrap_or(false);
    let silent = rec
        .options
        .get("silent")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
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

    tg_log::info(
        "studio_orch",
        "grammers_start",
        format!(
            "transfer={} items={} chat={}",
            tid,
            rec.items.len(),
            rec.chat_id
        ),
    );

    let album = feature_flags.intelligent_albums
        && (rec
            .options
            .get("group_as_album")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
            || rec
                .options
                .get("groupAsAlbum")
                .and_then(|v| v.as_bool())
                .unwrap_or(false));

    let topic_id = rec.topic_id.filter(|t| *t > 0).or_else(|| {
        rec.options
            .get("topic_id")
            .and_then(|v| v.as_i64())
            .or_else(|| rec.options.get("topicId").and_then(|v| v.as_i64()))
            .filter(|t| *t > 0)
    });

    let prevent_sticker = option_bool(
        &rec.options,
        "prevent_sticker_conversion",
        "preventStickerConversion",
        false,
    );

    let raw_quality_mode = rec
        .options
        .get("quality_mode")
        .and_then(|v| v.as_str())
        .or_else(|| rec.options.get("qualityMode").and_then(|v| v.as_str()));

    let album_quality_mode_str = if prevent_sticker {
        format!("{}_PREVENT_STICKER", raw_quality_mode.unwrap_or("SEIMBANG"))
    } else {
        raw_quality_mode.unwrap_or("").to_string()
    };
    let album_quality_mode = if album_quality_mode_str.is_empty() {
        None
    } else {
        Some(album_quality_mode_str.as_str())
    };

    let album_hardware_override = rec
        .options
        .get("reencodeHardware")
        .and_then(|v| v.as_str())
        .or_else(|| {
            rec.options
                .get("hardware_override")
                .and_then(|v| v.as_str())
        });
    if album && rec.items.len() >= 2 {
        return run_intelligent_album(
            app,
            &rec,
            &tid,
            &sessions,
            &identity,
            topic_id,
            album_quality_mode,
            album_hardware_override,
            silent,
            account_capability.effective_max_bytes,
            account_capability.caption_limit,
            feature_flags,
        );
    }

    let quality_mode = if feature_flags.transfer_v4 {
        let base_m = rec
            .options
            .get("quality_mode")
            .and_then(|v| v.as_str())
            .or_else(|| rec.options.get("qualityMode").and_then(|v| v.as_str()))
            .unwrap_or("");
        if prevent_sticker {
            Some(format!("{base_m}_PREVENT_STICKER"))
        } else {
            Some(base_m.to_string())
        }
    } else if prevent_sticker {
        Some("PREVENT_STICKER".into())
    } else {
        Some("ORIGINAL".into())
    };

    // Read user GPU/hardware preference from Transfer Settings UI
    let hardware_override = rec
        .options
        .get("reencodeHardware")
        .and_then(|v| v.as_str())
        .or_else(|| {
            rec.options
                .get("hardware_override")
                .and_then(|v| v.as_str())
        })
        .map(|s| s.to_string());
    let encoder_strategy = if feature_flags.encoder_orchestration {
        rec.options
            .get("encoder_strategy")
            .or_else(|| rec.options.get("encoderStrategy"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
    } else {
        Some("disable_reencode".into())
    };
    let encoder_resource_profile = rec
        .options
        .get("encoder_resource_profile")
        .or_else(|| rec.options.get("encoderResourceProfile"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
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

    let caption_policy = CaptionOverflowPolicy::parse(
        rec.options
            .get("caption_overflow_policy")
            .or_else(|| rec.options.get("captionOverflowPolicy"))
            .and_then(|value| value.as_str()),
    );
    let normalized_captions: HashMap<usize, String> = rec
        .items
        .iter()
        .map(|item| {
            normalize_caption(
                &item.caption,
                account_capability.caption_limit,
                caption_policy,
            )
            .map(|normalized| (item.index, normalized.value))
        })
        .collect::<Result<_, _>>()?;

    let mut any_ok = false;
    let mut first_fatal: Option<String> = None;

    for item in &rec.items {
        let item_caption = normalized_captions
            .get(&item.index)
            .map(String::as_str)
            .unwrap_or_default();
        job_queue::wait_while_transfer_paused(&tid)?;
        let spoiler = item_spoiler(&rec.options, item.index);
        if job_queue::is_transfer_cancelled(&tid) {
            tg_log::info(
                "studio_orch",
                "cancel_detected",
                format!("Transfer {tid} cancelled by user"),
            );
            let _ = job_queue::set_transfer_state(&tid, job_queue::TransferState::Cancelled);
            let _ = super::autogram_core::transfer::update_transfer_run_state(&tid, "CANCELLED");
            if let Some(app) = app {
                use tauri::Emitter;
                let _ = app.emit(
                    "transfer-event",
                    serde_json::json!({
                        "type": "StudioFinished",
                        "status": "cancelled",
                        "transferId": tid
                    }),
                );
            }
            return Err("Transfer cancelled by user".to_string());
        }

        let file_name = std::path::Path::new(&item.path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&item.path)
            .to_string();

        if let Some(app) = app {
            use tauri::Emitter;
            let _ = app.emit(
                "transfer-event",
                serde_json::json!({
                    "type": "StudioItemStarted",
                    "index": item.index,
                    "path": file_name,
                    "size": item.size
                }),
            );
        }

        let _ = job_queue::update_item(&tid, item.index, ItemState::Preparing, None, None);
        // Remote URLs use a dedicated transport path: Telegram external media
        // for small objects, or a bounded in-memory pipe for larger objects.
        // This deliberately bypasses media_prep's temp-file downloader.
        if media_prep::is_remote_url(&item.path)
            && remote_mux_for_item(&rec.options, item.index).is_none()
        {
            let remote_as_document = as_doc
                || rec
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
            let thumbnail_url = rec
                .options
                .get("thumbnail_urls")
                .or_else(|| rec.options.get("thumbnailUrls"))
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.get(item.index).or_else(|| arr.first()))
                .and_then(|v| v.as_str());
            match grammers_ops::upload_remote_url_blocking_topic_with_app(
                &sessions,
                &identity,
                &rec.chat_id,
                &item.path,
                item_caption,
                remote_as_document,
                silent,
                spoiler,
                item.index,
                topic_id,
                schedule_at,
                app.cloned(),
                Some(tid.clone()),
                remote_engine_mode,
                thumbnail_url,
            ) {
                Ok(result) => {
                    any_ok = true;
                    let _ = job_queue::update_item(
                        &tid,
                        item.index,
                        ItemState::Done,
                        result.message_id,
                        None,
                    );
                    if let Some(app) = app {
                        use tauri::Emitter;
                        let _ = app.emit(
                            "transfer-event",
                            serde_json::json!({
                                "type": "StudioItemDone",
                                "index": item.index,
                                "status": "done",
                                "message_id": result.message_id,
                                "path": file_name,
                                "engine": result.backend,
                            }),
                        );
                    }
                }
                Err(error) => {
                    let message = error.user_message();
                    let _ = job_queue::update_item(
                        &tid,
                        item.index,
                        ItemState::Failed,
                        None,
                        Some(message.clone()),
                    );
                    if let Some(app) = app {
                        use tauri::Emitter;
                        let _ = app.emit(
                            "transfer-event",
                            serde_json::json!({
                                "type": "StudioItemDone",
                                "index": item.index,
                                "status": "failed",
                                "error": message,
                                "path": file_name,
                            }),
                        );
                    }
                    if first_fatal.is_none() {
                        first_fatal = Some(message);
                    }
                }
            }
            continue;
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
                    let msg = format!("adaptive mux: {error}");
                    let _ = job_queue::update_item(
                        &tid,
                        item.index,
                        ItemState::Failed,
                        None,
                        Some(msg.clone()),
                    );
                    if let Some(app) = app {
                        use tauri::Emitter;
                        let _ = app.emit(
                            "transfer-event",
                            serde_json::json!({
                                "type": "StudioItemDone",
                                "index": item.index,
                                "status": "failed",
                                "error": msg,
                                "path": file_name,
                            }),
                        );
                    }
                    if first_fatal.is_none() {
                        first_fatal = Some(msg);
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

        if muxed_remote_path.is_none() {
            if let Some(ledger_match) =
                duplicate_match_for_source(&rec, topic_id, &item.path)?
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
                    job_queue::update_item(
                        &tid,
                        item.index,
                        state.clone(),
                        None,
                        Some(reason.clone()),
                    )?;
                    super::autogram_core::transfer::record_transfer_item_decision(
                        &tid,
                        item.index,
                        &item.path,
                        &item.path,
                        "unknown",
                        "native_visual",
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

        // Remote URL download + optional ffmpeg reencode (no Telethon), pass user hardware preference
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
        let prepared_artifact = match prepare_with_receipt(
            &tid,
            preparation_source,
            quality_mode.as_deref(),
            hardware_override.as_deref(),
            encoder_strategy.as_deref(),
            encoder_resource_profile.as_deref(),
            encoder_max_parallel,
            encoder_allow_software_fallback,
            Some(effective_upload_limit(
                &rec,
                account_capability.effective_max_bytes,
            )),
            video_transcode_scope,
            video_transcode_formats.as_deref(),
            image_transcode_scope,
            image_transcode_target,
            image_transcode_formats.as_deref(),
            app,
            item.index,
        ) {
            Ok(mut v) => {
                if let Some(path) = muxed_remote_path.as_ref() {
                    v.cleanup_paths.push(path.clone());
                }
                v
            }
            Err(e) => {
                if let Some(path) = muxed_remote_path.as_ref() {
                    let _ = std::fs::remove_file(path);
                }
                let msg = format!("prepare: {e}");
                let _ = job_queue::update_item(
                    &tid,
                    item.index,
                    ItemState::Failed,
                    None,
                    Some(msg.clone()),
                );
                if let Some(app) = app {
                    use tauri::Emitter;
                    let _ = app.emit(
                        "transfer-event",
                        serde_json::json!({
                            "type": "StudioItemDone",
                            "index": item.index,
                            "status": "failed",
                            "error": msg,
                            "path": file_name
                        }),
                    );
                }
                if first_fatal.is_none() {
                    first_fatal = Some(msg);
                }
                continue;
            }
        };
        let local_path = prepared_artifact.prepared_path.clone();

        let actual_upload_size = std::fs::metadata(&local_path)
            .map(|m| m.len())
            .unwrap_or(item.size);
        let mut delivery = classify_prepared_delivery(
            std::path::Path::new(&local_path),
            QualityMode::parse(quality_mode.as_deref()),
            prepared_artifact.transformed,
            prepared_artifact.native_visual_validated,
        );
        delivery.transform = prepared_artifact.transform_action;
        let pres_override = rec
            .options
            .get("presentation_override")
            .or_else(|| rec.options.get("presentationOverride"))
            .and_then(|value| value.as_str());
        if let Some(pres) = pres_override {
            if pres == "force_document" || pres == "document" {
                delivery.as_document = true;
            } else if pres == "original" || pres == "standard" {
                if matches!(
                    delivery.category,
                    super::autogram_core::transfer::MediaCategory::Mp4Video
                        | super::autogram_core::transfer::MediaCategory::JpegImage
                        | super::autogram_core::transfer::MediaCategory::PngImage
                        | super::autogram_core::transfer::MediaCategory::Audio
                ) {
                    delivery.as_document = false;
                }
            }
        }
        apply_nonstandard_source_document_guard(
            &item.path,
            prepared_artifact.transformed,
            &mut delivery,
        );
        let item_as_document =
            if pres_override == Some("original") || pres_override == Some("standard") {
                delivery.as_document
            } else {
                as_doc || delivery.as_document
            };
        persist_prepared_decision(
            &rec,
            item.index,
            &item.path,
            &local_path,
            &delivery,
            account_capability.effective_max_bytes,
        )?;
        let ledger_identity = prepared_ledger_identity(&local_path, &delivery)?;
        if let Some(ledger_match) =
            duplicate_match_for_prepared(&rec, topic_id, &item.path, &ledger_identity)?
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
                job_queue::update_item(
                    &tid,
                    item.index,
                    state.clone(),
                    None,
                    Some(reason.clone()),
                )?;
                super::autogram_core::transfer::record_transfer_item_decision(
                    &tid,
                    item.index,
                    &item.path,
                    &local_path,
                    &serialized_label(&delivery.category),
                    &serialized_label(&delivery.payload_class),
                    &serialized_label(&delivery.transform),
                    "SKIPPED",
                    "duplicate_exact_sha256",
                )?;
                emit_album_item_result(app, item.index, &state, None, Some(reason));
                any_ok = true;
                prepared_artifact.cleanup();
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
        if actual_upload_size > effective_upload_limit(&rec, account_capability.effective_max_bytes)
            && !feature_flags.oversize_routing
        {
            let message = format!(
                "OVERSIZE_ROUTING_DISABLED: item {} is {actual_upload_size} bytes; effective limit is {}",
                item.index,
                effective_upload_limit(&rec, account_capability.effective_max_bytes)
            );
            let state = ItemState::Failed;
            let _ = job_queue::update_item(
                &tid,
                item.index,
                state.clone(),
                None,
                Some(message.clone()),
            );
            emit_album_item_result(app, item.index, &state, None, Some(message.clone()));
            if first_fatal.is_none() {
                first_fatal = Some(message);
            }
            prepared_artifact.cleanup();
            continue;
        }
        match handle_oversize_prepared(
            app,
            &rec,
            &tid,
            &sessions,
            &identity,
            topic_id,
            silent,
            spoiler,
            schedule_at,
            send_as.as_deref(),
            item.index,
            item_caption,
            &local_path,
            actual_upload_size,
            account_capability.effective_max_bytes,
            item_as_document,
            false,
            true,
        ) {
            Ok(Some(success)) => {
                any_ok |= success;
                prepared_artifact.cleanup();
                continue;
            }
            Err(error) => {
                let state = ItemState::Failed;
                let _ = job_queue::update_item(
                    &tid,
                    item.index,
                    state.clone(),
                    None,
                    Some(error.clone()),
                );
                emit_album_item_result(app, item.index, &state, None, Some(error.clone()));
                if first_fatal.is_none() {
                    first_fatal = Some(error);
                }
                prepared_artifact.cleanup();
                continue;
            }
            Ok(None) => {}
        }
        let _ = job_queue::update_item(&tid, item.index, ItemState::Uploading, None, None);
        if let Some(app) = app {
            use tauri::Emitter;
            let _ = app.emit(
                "transfer-event",
                serde_json::json!({
                    "type": "StudioProgress",
                    "index": item.index,
                    "percent": 0.0,
                    "transferred": 0,
                    "total": actual_upload_size,
                    "item_total": actual_upload_size,
                    "phase": "upload"
                }),
            );
        }

        match grammers_ops::upload_file_blocking_topic_with_delivery(
            &sessions,
            &identity,
            &rec.chat_id,
            &local_path,
            item_caption,
            item_as_document,
            silent,
            spoiler,
            item.index,
            topic_id,
            schedule_at,
            send_as.clone(),
            app.cloned(),
            Some(tid.clone()),
        ) {
            Ok(r) => {
                let st = match r.status.as_str() {
                    "done" | "success" => {
                        any_ok = true;
                        ItemState::Done
                    }
                    "skipped" => {
                        any_ok = true;
                        ItemState::Skipped
                    }
                    _ => ItemState::Failed,
                };
                let _ = job_queue::update_item(
                    &tid,
                    item.index,
                    st.clone(),
                    r.message_id,
                    r.error.clone(),
                );
                if matches!(st, ItemState::Done) {
                    persist_upload_ledger_binding(
                        &rec,
                        topic_id,
                        &identity.session,
                        r.message_id,
                        item.index,
                        &ledger_identity,
                    );
                }
                if let Some(app) = app {
                    use tauri::Emitter;
                    let status_str = if st == ItemState::Done {
                        "done"
                    } else if st == ItemState::Skipped {
                        "skipped"
                    } else {
                        "failed"
                    };
                    let _ = app.emit(
                        "transfer-event",
                        serde_json::json!({
                            "type": "StudioItemDone",
                            "index": item.index,
                            "status": status_str,
                            "message_id": r.message_id,
                            "error": r.error,
                            "path": file_name
                        }),
                    );
                }
                if r.error.is_some() && first_fatal.is_none() {
                    first_fatal = r.error;
                }
            }
            Err(e) => {
                let msg = e.user_message();
                tg_log::warn("studio_orch", "grammers_item_fail", &msg);
                let _ = job_queue::update_item(
                    &tid,
                    item.index,
                    ItemState::Failed,
                    None,
                    Some(msg.clone()),
                );
                if let Some(app) = app {
                    use tauri::Emitter;
                    let _ = app.emit(
                        "transfer-event",
                        serde_json::json!({
                            "type": "StudioItemDone",
                            "index": item.index,
                            "status": "failed",
                            "error": msg,
                            "path": file_name
                        }),
                    );
                }
                if first_fatal.is_none() {
                    first_fatal = Some(msg);
                }
                if matches!(
                    e.code(),
                    super::tg_error::TgErrorCode::NotAuthorized
                        | super::tg_error::TgErrorCode::SessionMissing
                        | super::tg_error::TgErrorCode::SessionImportFailed
                        | super::tg_error::TgErrorCode::NotConfigured
                ) {
                    prepared_artifact.cleanup();
                    let _ = job_queue::set_transfer_state(&tid, TransferState::Failed);
                    let _ =
                        super::autogram_core::transfer::update_transfer_run_state(&tid, "FAILED");
                    if let Some(app) = app {
                        use tauri::Emitter;
                        let _ = app.emit(
                            "transfer-event",
                            serde_json::json!({
                                "type": "StudioFailed",
                                "error": first_fatal.clone().unwrap_or_else(|| e.to_string())
                            }),
                        );
                    }
                    return Err(format!(
                        "grammers unavailable: {}",
                        first_fatal.unwrap_or_else(|| e.to_string())
                    ));
                }
            }
        }
        prepared_artifact.cleanup();
    }

    if !any_ok {
        let _ = job_queue::set_transfer_state(&tid, TransferState::Failed);
        let _ = super::autogram_core::transfer::update_transfer_run_state(&tid, "FAILED");
        if let Some(app) = app {
            use tauri::Emitter;
            let _ = app.emit(
                "transfer-event",
                serde_json::json!({
                    "type": "StudioFailed",
                    "error": first_fatal.clone().unwrap_or_else(|| "unknown".into())
                }),
            );
        }
        return Err(format!(
            "grammers upload all failed: {}",
            first_fatal.unwrap_or_else(|| "unknown".into())
        ));
    }

    if let Some(app) = app {
        use tauri::Emitter;
        let _ = app.emit(
            "transfer-event",
            serde_json::json!({
                "type": "StudioFinished"
            }),
        );
    }

    Ok(finalize_transfer(
        &tid,
        rec.items.len(),
        "rust_orch_grammers",
    ))
}

/// Run orchestrated transfer — **Grammers only** (Telethon studio-serve removed).
pub fn run_orchestrated_blocking(
    app: Option<&tauri::AppHandle>,
    req: &CreateTransferRequest,
) -> Result<OrchStartResult, String> {
    match run_orchestrated_grammers(app, req) {
        Ok(r) => {
            tg_log::info("studio_orch", "done", format!("mode={}", r.mode));
            Ok(r)
        }
        Err(e) => {
            tg_log::error("studio_orch", "grammers_failed", e.as_str());
            Err(format!(
                "Upload Grammers gagal (Telethon dinonaktifkan): {e}"
            ))
        }
    }
}

pub fn next_orch_job_id() -> i64 {
    ORCH_JOB_SEQ.fetch_add(1, Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transfer_with_options(options: serde_json::Value) -> TransferRecord {
        TransferRecord {
            transfer_id: "duplicate-choice-test".into(),
            session: "Lavender".into(),
            api_id: 1,
            chat_id: "me".into(),
            topic_id: None,
            state: TransferState::Queued,
            items: Vec::new(),
            options,
            created_at_ms: 0,
            updated_at_ms: 0,
            done_count: 0,
            failed_count: 0,
            logs: Vec::new(),
        }
    }

    #[test]
    fn job_id_increments() {
        let a = next_orch_job_id();
        let b = next_orch_job_id();
        assert!(b > a);
    }

    #[test]
    fn duplicate_force_upload_is_scoped_to_the_selected_source_path() {
        let rec = transfer_with_options(json!({
            "duplicate_policy": "SKIP",
            "duplicate_force_upload_paths": ["C:\\media\\chosen.jpg"],
        }));
        assert!(!duplicate_skip_enabled(&rec, "C:\\media\\chosen.jpg"));
        assert!(duplicate_skip_enabled(&rec, "C:\\media\\other.jpg"));
    }

    #[test]
    fn untransformed_webp_source_overrides_native_magic_byte_classification() {
        let mut classification = DeliveryClassification {
            category: MediaCategory::JpegImage,
            payload_class: PayloadClass::NativeVisual,
            transform: super::super::autogram_core::transfer::TransformAction::PassThrough,
            as_document: false,
            reason_code: "prepared_native_visual".into(),
        };

        assert!(apply_nonstandard_source_document_guard(
            r"E:\upload\mislabelled.webp",
            false,
            &mut classification,
        ));
        assert_eq!(classification.payload_class, PayloadClass::DocumentGroup);
        assert!(classification.as_document);
        assert_eq!(
            classification.reason_code,
            "untransformed_nonstandard_source_document"
        );
    }

    #[test]
    fn transformed_webp_source_can_be_delivered_as_native_visual() {
        let mut classification = DeliveryClassification {
            category: MediaCategory::JpegImage,
            payload_class: PayloadClass::NativeVisual,
            transform: super::super::autogram_core::transfer::TransformAction::Reencode,
            as_document: false,
            reason_code: "prepared_native_visual".into(),
        };

        assert!(!apply_nonstandard_source_document_guard(
            r"E:\upload\converted.webp",
            true,
            &mut classification,
        ));
        assert_eq!(classification.payload_class, PayloadClass::NativeVisual);
        assert!(!classification.as_document);
    }

    #[test]
    fn adaptive_mux_pair_is_read_only_from_verified_queue_metadata() {
        let options = json!({
            "remote_muxes": [
                {
                    "videoUrl": "https://video.googlevideo.com/videoplayback?itag=400",
                    "audioUrl": "https://audio.googlevideo.com/videoplayback?itag=140",
                    "outputExt": "mp4"
                },
                null
            ]
        });
        let pair = remote_mux_for_item(&options, 0).expect("mux metadata should parse");
        assert_eq!(pair.2, "mp4");
        assert_eq!(pair.0, "https://video.googlevideo.com/videoplayback?itag=400");
        assert!(remote_mux_for_item(&options, 1).is_none());
    }

    #[test]
    fn malformed_adaptive_mux_metadata_falls_back_to_ordinary_remote_path() {
        let options = json!({
            "remote_muxes": [{
                "videoUrl": "file:///unsafe",
                "audioUrl": "https://audio.googlevideo.com/videoplayback?itag=140",
                "outputExt": "mp4"
            }]
        });
        assert!(remote_mux_for_item(&options, 0).is_none());
    }
}
