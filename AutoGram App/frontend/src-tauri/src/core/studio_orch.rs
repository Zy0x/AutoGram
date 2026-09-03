//! Studio orchestrator — Rust owns queue order.
//!
//! Upload steps use Grammers only. There is no Python/Telethon runtime fallback.

use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::thread;
use std::time::Duration;

use super::autogram_core::transfer::{
    apply_album_caption_policy, build_album_plan, classify_prepared_delivery, normalize_caption,
    AlbumCompatibilityKey, AlbumFailurePolicy, AlbumPackingPolicy, AlbumPlanOptions,
    CaptionOverflowPolicy, DeliveryClassification, MediaCategory, PayloadClass, PreparedAlbumItem,
    QualityMode, TransferFeatureFlags,
};
use super::grammers_ops::{self, resolve_sessions_dir};
use super::job_queue::{self, CreateTransferRequest, ItemState, TransferRecord, TransferState};
use super::media_prep;
use super::session_guard::{self, SessionPurpose};
use super::telegram_ops::TelegramIdentity;
use super::tg_log;

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
    if let Ok(mut f) = std::fs::File::open(p) {
        use std::io::Read;
        let mut header = [0u8; 8];
        let n = f.read(&mut header).unwrap_or(0);
        if n >= 3 && header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF {
            return false;
        }
        if n >= 8
            && header[0] == 0x89
            && header[1] == 0x50
            && header[2] == 0x4E
            && header[3] == 0x47
            && header[4] == 0x0D
            && header[5] == 0x0A
            && header[6] == 0x1A
            && header[7] == 0x0A
        {
            return false;
        }
    }
    p.extension()
        .and_then(|value| value.to_str())
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "webp"
                    | "heic"
                    | "heif"
                    | "hif"
                    | "avif"
                    | "avis"
                    | "jxl"
                    | "bmp"
                    | "tif"
                    | "tiff"
                    | "svg"
                    | "svgz"
                    | "psd"
                    | "psb"
                    | "tga"
                    | "dds"
                    | "exr"
                    | "hdr"
                    | "ico"
                    | "cur"
                    | "raw"
                    | "dng"
                    | "cr2"
                    | "cr3"
                    | "nef"
                    | "nrw"
                    | "arw"
                    | "srf"
                    | "sr2"
                    | "orf"
                    | "rw2"
                    | "pef"
                    | "raf"
                    | "srw"
                    | "x3f"
                    | "erf"
                    | "kdc"
                    | "dcr"
                    | "mef"
                    | "mos"
                    | "mrw"
            )
        })
        .unwrap_or(false)
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

fn effective_upload_limit(rec: &TransferRecord, runtime_limit: u64) -> u64 {
    rec.options
        .get("account_max_file_size_bytes")
        .or_else(|| rec.options.get("max_file_size_bytes"))
        .and_then(|value| value.as_u64())
        .map(|configured| configured.min(runtime_limit))
        .unwrap_or(runtime_limit)
}

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

fn prepared_ledger_identity(
    prepared_path: &str,
    classification: &DeliveryClassification,
) -> Result<PreparedLedgerIdentity, String> {
    let path = std::path::Path::new(prepared_path);
    Ok(PreparedLedgerIdentity {
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
    if media_prep::is_remote_url(&source_item.path) {
        return;
    }
    let source_path = std::path::Path::new(&source_item.path);
    let source_identity =
        super::autogram_core::transfer::sha256_file(source_path).and_then(|sha256| {
            Ok(PreparedLedgerIdentity {
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

/// Persist a redacted transfer diagnostic in both the in-memory Transfer
/// Manager record and the append-only JSONL journal.  Telegram's native logs
/// remain useful for developers, while users get the same reason in the
/// transfer details (especially for album/grid fallback decisions).
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

/// Format an informative, complete diagnostic log entry for Telegram API/server events
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

fn run_intelligent_album(
    app: Option<&tauri::AppHandle>,
    rec: &TransferRecord,
    tid: &str,
    sessions: &std::path::Path,
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
    // One setting controls both album batch size and the Telegram grid. Legacy
    // packing presets must not silently override the user's selected size.
    let album_grid_size =
        option_usize(&rec.options, "album_group_size", "albumGroupSize", 10).clamp(2, 10);
    let packing = rec
        .options
        .get("album_packing")
        .or_else(|| rec.options.get("albumPacking"))
        .and_then(|value| value.as_str())
        .map(|value| match value.to_ascii_lowercase().as_str() {
            "balanced" => AlbumPackingPolicy::Balanced,
            "follow_selection" | "followselection" => AlbumPackingPolicy::FollowSelection,
            "never" | "disabled" => AlbumPackingPolicy::Never,
            "custom" => AlbumPackingPolicy::Custom,
            _ => {
                if album_grid_size == 10 {
                    AlbumPackingPolicy::Maximum
                } else {
                    AlbumPackingPolicy::Custom
                }
            }
        })
        .unwrap_or_else(|| {
            if album_grid_size == 10 {
                AlbumPackingPolicy::Maximum
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
            normalized_item_captions.insert(
                item.index,
                item_caption_str,
            );
        }
    }
    let mut album_summary_consumed = false;

    let mut artifacts: Vec<media_prep::PreparedUploadArtifact> = Vec::new();
    let mut prepared_items = Vec::new();
    let mut ledger_identities: HashMap<usize, PreparedLedgerIdentity> = HashMap::new();
    let mut any_ok = false;
    let mut first_error = None;
    let mut preparation_failed = false;
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
    for item in &rec.items {
        if let Err(error) = job_queue::wait_while_transfer_paused(tid) {
            for artifact in artifacts.drain(..) {
                artifact.cleanup();
            }
            let _ = job_queue::set_transfer_state(tid, TransferState::Cancelled);
            let _ = super::autogram_core::transfer::update_transfer_run_state(tid, "CANCELLED");
            return Err(error);
        }
        let spoiler = item_spoiler(&rec.options, item.index);
        let _ = job_queue::update_item(tid, item.index, ItemState::Preparing, None, None);

        // Direct handling for remote URLs: bypass local disk download & ffmpeg preparation
        if media_prep::is_remote_url(&item.path) {
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
            let file_name = if !item.caption.trim().is_empty() {
                item.caption.clone()
            } else {
                item.path
                    .rsplit('/')
                    .next()
                    .unwrap_or("remote_media")
                    .to_string()
            };

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
                &item.path,
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
                Ok(value) => {
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
        // Override classification for album-incompatible formats based on user settings.
        // Only active when album mode is used; WebP/OtherImage/GIF/TGS still in NativeVisual
        // after transcode will pass through (artifact.transformed guards that path).
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
            // Image formats: WebP (untranscoded), HEIC/BMP/TIFF/AVIF/SVG (OtherImage)
            let guarded_nonstandard_source = incompat_image_mode == "document"
                && apply_nonstandard_source_document_guard(
                    &item.path,
                    artifact.transformed,
                    &mut classification,
                );
            let is_incompat_image = matches!(
                classification.category,
                MediaCategory::WebpImage | MediaCategory::OtherImage
            ) && !artifact.transformed;
            // Animation/sticker: GIF, and OtherVideo (TGS/WebM sticker) when untranscoded
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
        // Silent MP4 files are supported natively in Telegram albums via MTProto
        // `nosound_video` flag on `InputMediaUploadedDocument`. They remain in
        // `PayloadClass::NativeVisual` so visual media groups stay contiguous.
        let force_single = false;
        // Persist the final delivery decision, including the silent-video
        // document override, so preflight/runtime/ledger all share one truth.
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
                artifacts.push(artifact);
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
        // A whole-group alternate move is resolved only after every album item has
        // completed local preparation. Sending an oversize member here would split
        // sender identity before album compatibility is frozen.
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
            artifacts.push(artifact);
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
                    artifacts.push(artifact);
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
                    artifacts.push(artifact);
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
        artifacts.push(artifact);
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
        for artifact in artifacts {
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
    let mut whole_album_identity: Option<TelegramIdentity> = None;
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
                whole_album_identity = Some(alternate);
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
                for artifact in artifacts {
                    artifact.cleanup();
                }
                let _ = job_queue::set_transfer_state(tid, TransferState::Failed);
                let _ = super::autogram_core::transfer::update_transfer_run_state(tid, "FAILED");
                return Err(message);
            }
        }
    }

    let delivery_identity = whole_album_identity.as_ref().unwrap_or(identity);
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
    persist_transfer_log(
        tid,
        "info",
        "album_plan_frozen",
        format!(
            "Rencana pengiriman media siap: {} grup album (partisi kolase: [{}]), {} berkas tunggal. Kebijakan: {packing:?}.",
            plan.groups.len(),
            if group_partition_summary.is_empty() { "0".to_string() } else { group_partition_summary },
            plan.singles.len()
        ),
    );

    for group in plan.groups {
        if let Err(error) = job_queue::wait_while_transfer_paused(tid) {
            for artifact in artifacts.drain(..) {
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
        let mut album_attempts = 0usize;
        let album_exec_res = loop {
            album_attempts += 1;
            let res = grammers_ops::upload_prepared_album_blocking_with_app(
                sessions,
                delivery_identity,
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
                Ok(ok_res) => break Ok(ok_res),
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
                    // Some Telegram album RPC failures are surfaced as a
                    // generic RPC error even though the server dropped the
                    // multipart request transiently. Retry those before
                    // degrading the whole group to singles; permanent ACL /
                    // media-shape errors still fail fast to fallback.
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
                    // An album request is not idempotent because Telegram's
                    // high-level `send_album` generates fresh random IDs.
                    // Idempotent retry using persisted random_ids:
                    // When Telegram encounters transient worker busy/timeout or flood wait,
                    // retrying with the exact same random_ids is safe and idempotent.
                    let is_retryable = !permanent_album_error
                        && matches!(
                            err.code(),
                            crate::core::tg_error::TgErrorCode::FloodWait
                                | crate::core::tg_error::TgErrorCode::Timeout
                                | crate::core::tg_error::TgErrorCode::Network
                                | crate::core::tg_error::TgErrorCode::Io
                        );
                    let item_names = group
                        .items
                        .iter()
                        .take(3)
                        .map(|i| Path::new(&i.path).file_name().and_then(|n| n.to_str()).unwrap_or("?"))
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
                        let wait_secs = err
                            .flood_wait_secs()
                            .unwrap_or_else(|| match err.code() {
                                crate::core::tg_error::TgErrorCode::Timeout => (6 + album_attempts * 2) as u32,
                                _ => (album_attempts * 3) as u32,
                            });
                        let retry_msg = format_telegram_log_message(
                            &media_desc,
                            &err,
                            &format!("Percobaan {album_attempts}/3. Menjeda {wait_secs}s untuk rekonsiliasi status server sebelum mencoba kembali."),
                        );
                        tg_log::warn(
                            "studio_orch",
                            "album_upload_network_retry",
                            format!("{retry_msg} (internal error: {})", err.user_message()),
                        );
                        persist_transfer_log(
                            tid,
                            "warn",
                            "album_upload_network_retry",
                            &retry_msg,
                        );
                        if !wait_retry_with_cancel(tid, wait_secs) {
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
                        any_ok = true;
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
                    if whole_album_identity.is_some() && matches!(state, ItemState::Done) {
                        if let Err(error) = super::autogram_core::transfer::record_alternate_upload(
                            tid,
                            result.index,
                            &delivery_identity.session,
                            result.message_id,
                        ) {
                            tg_log::warn(
                                "studio_orch",
                                "alternate_binding_persist_failed",
                                format!("transfer={tid} index={} error={error}", result.index),
                            );
                        }
                    }
                    if first_error.is_none() {
                        first_error = result.error;
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
                    for artifact in artifacts.drain(..) {
                        artifact.cleanup();
                    }
                    let _ = job_queue::set_transfer_state(tid, TransferState::Cancelled);
                    let _ = super::autogram_core::transfer::update_transfer_run_state(tid, "CANCELLED");
                    return Err("Transfer cancelled by user".into());
                }
                let item_names = group
                    .items
                    .iter()
                    .take(3)
                    .map(|i| Path::new(&i.path).file_name().and_then(|n| n.to_str()).unwrap_or("?"))
                    .collect::<Vec<_>>()
                    .join(", ");
                let media_desc = if group.items.len() > 3 {
                    format!("Album {} berkas: {}, dst", group.items.len(), item_names)
                } else {
                    format!("Album {} berkas: {}", group.items.len(), item_names)
                };
                let err_msg = error.user_message();
                persist_transfer_log(
                    tid,
                    "error",
                    "album_send_failed",
                    format_telegram_log_message(
                        &media_desc,
                        &error,
                        &format!("Menjalankan fallback otomatis: mengirim {} berkas secara mandiri (single).", group.items.len())
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
                    any_ok = true;
                    let state = ItemState::Done;
                    let _ =
                        job_queue::update_item(tid, *index, state.clone(), Some(*message_id), None);
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

                // Intelligent Fallback: Upload every item in the album group individually
                for item in group
                    .items
                    .iter()
                    .filter(|item| !recovered_indices.contains(&item.index))
                {
                    if let Err(error) = job_queue::wait_while_transfer_paused(tid) {
                        for artifact in artifacts.drain(..) {
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
                        super::autogram_core::transfer::resolve_single_media_caption(orig_path, &item.caption)
                    };

                    let mut single_attempts = 0usize;
                    let single_exec_res = loop {
                        single_attempts += 1;
                        let res = grammers_ops::upload_file_blocking_topic_with_delivery(
                            sessions,
                            delivery_identity,
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
                                // A single send can also have an unknown
                                // commit after transport loss. Retry only a
                                // server-declared FloodWait; all other errors
                                // are reconciled/finalized without re-upload.
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
                                    let filename = Path::new(&item.path).file_name().and_then(|n| n.to_str()).unwrap_or("?");
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
                                    if !wait_retry_with_cancel(tid, wait_secs) {
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
                                any_ok = true;
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
                            if whole_album_identity.is_some() && matches!(state, ItemState::Done) {
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
                                for artifact in artifacts.drain(..) {
                                    artifact.cleanup();
                                }
                                let _ = job_queue::set_transfer_state(tid, TransferState::Cancelled);
                                let _ = super::autogram_core::transfer::update_transfer_run_state(tid, "CANCELLED");
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
                            let filename = Path::new(&item.path).file_name().and_then(|n| n.to_str()).unwrap_or("?");
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
                                first_error = Some(message);
                            }
                        }
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
    }

    for item in plan.singles {
        if let Err(error) = job_queue::wait_while_transfer_paused(tid) {
            for artifact in artifacts.drain(..) {
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
                delivery_identity,
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
                            "single_upload_network_retry",
                            format!(
                                "Single upload attempt {}/3 failed with network error ({:?}): {}. Disconnecting socket pool and retrying in {}s...",
                                single_attempts, err.code(), err.user_message(), wait_secs
                            ),
                        );
                        grammers_ops::disconnect_cached_session(&delivery_identity.session);
                        if !wait_retry_with_cancel(tid, wait_secs) {
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
                    any_ok = true;
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
                emit_album_item_result(app, item.index, &state, result.message_id, result.error);
                if matches!(state, ItemState::Done) {
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
                if whole_album_identity.is_some() && matches!(state, ItemState::Done) {
                    if let Err(error) = super::autogram_core::transfer::record_alternate_upload(
                        tid,
                        item.index,
                        &delivery_identity.session,
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
                    for artifact in artifacts.drain(..) {
                        artifact.cleanup();
                    }
                    let _ = job_queue::set_transfer_state(tid, TransferState::Cancelled);
                    let _ = super::autogram_core::transfer::update_transfer_run_state(tid, "CANCELLED");
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
                let filename = Path::new(&item.path).file_name().and_then(|n| n.to_str()).unwrap_or("?");
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
                    first_error = Some(message);
                }
            }
        }
    }

    for artifact in artifacts {
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

/// Sleep between classified retries without making Stop wait for the full
/// FloodWait/backoff duration. Polling at 100ms keeps cancellation responsive
/// while preserving the server-provided cooldown when the transfer continues.
fn wait_retry_with_cancel(tid: &str, seconds: u32) -> bool {
    let deadline = std::time::Instant::now()
        + std::time::Duration::from_secs(seconds as u64);
    while std::time::Instant::now() < deadline {
        if job_queue::is_transfer_cancelled(tid) {
            return false;
        }
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        std::thread::sleep(remaining.min(std::time::Duration::from_millis(100)));
    }
    !job_queue::is_transfer_cancelled(tid)
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
        if media_prep::is_remote_url(&item.path) {
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
            &item.path,
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
            Ok(v) => v,
            Err(e) => {
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

#[cfg(any())]
/// Historical source retained outside the compiled runtime for migration archaeology only.
fn run_orchestrated_telethon_blocking(
    req: &CreateTransferRequest,
    daemon: &std::path::Path,
    python: &std::path::Path,
    env_extra: &[(String, String)],
) -> Result<OrchStartResult, String> {
    let api_hash = req.api_hash.clone();
    let rec = job_queue::create_transfer(req.clone())?;
    let tid = rec.transfer_id.clone();
    job_queue::set_transfer_state(&tid, TransferState::Running)?;

    let mut cmd = Command::new(python);
    cmd.arg("-u");
    cmd.arg(daemon);
    cmd.args([
        "--action",
        "studio-serve",
        "--session",
        &rec.session,
        "--api-id",
        &rec.api_id.to_string(),
        "--api-hash",
        &api_hash,
    ]);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    if let Some(parent) = daemon.parent() {
        cmd.current_dir(parent);
    }
    for (k, v) in env_extra {
        cmd.env(k, v);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn studio-serve: {e}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "no stdin for studio-serve".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "no stdout for studio-serve".to_string())?;

    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let mut ready = false;
    for _ in 0..200 {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                if line.contains("ready") {
                    ready = true;
                    break;
                }
            }
            Err(_) => break,
        }
    }
    if !ready {
        let _ = child.kill();
        return Err("studio-serve did not become ready".into());
    }

    let mut seq = 1i64;
    let mut write_cmd = |id: i64, mut body: serde_json::Value| -> Result<(), String> {
        if let Some(m) = body.as_object_mut() {
            m.insert("id".into(), json!(id.to_string()));
        }
        let line = serde_json::to_string(&body).map_err(|e| e.to_string())? + "\n";
        stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("stdin write: {e}"))?;
        stdin.flush().map_err(|e| format!("stdin flush: {e}"))
    };

    let mut read_reply = |want_id: &str| -> Result<serde_json::Value, String> {
        let mut line = String::new();
        for _ in 0..2000 {
            line.clear();
            let n = reader
                .read_line(&mut line)
                .map_err(|e| format!("stdout: {e}"))?;
            if n == 0 {
                return Err("studio-serve closed".into());
            }
            let t = line.trim();
            if !t.starts_with('{') {
                continue;
            }
            if t.contains("studio_event") {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(t) {
                let id = v
                    .get("id")
                    .map(|x| match x {
                        serde_json::Value::String(s) => s.clone(),
                        serde_json::Value::Number(n) => n.to_string(),
                        _ => String::new(),
                    })
                    .unwrap_or_default();
                if id == want_id || want_id.is_empty() {
                    if v.get("ok").and_then(|x| x.as_bool()) == Some(false) {
                        let err = v
                            .get("error")
                            .and_then(|x| x.as_str())
                            .unwrap_or("studio step failed");
                        return Err(err.to_string());
                    }
                    return Ok(v);
                }
            }
        }
        Err("timeout waiting studio reply".into())
    };

    let begin_id = seq;
    seq += 1;
    write_cmd(
        begin_id,
        json!({
            "cmd": "begin",
            "session": rec.session,
            "api_id": rec.api_id,
            "api_hash": api_hash,
            "chat_id": rec.chat_id,
            "options": rec.options,
            "transfer_id": tid,
        }),
    )?;
    read_reply(&begin_id.to_string())?;

    for item in &rec.items {
        let _ = job_queue::update_item(&tid, item.index, ItemState::Uploading, None, None);
        let id_num = seq;
        seq += 1;
        write_cmd(
            id_num,
            json!({
                "cmd": "upload_one",
                "transfer_id": tid,
                "item": {
                    "path": item.path,
                    "caption": item.caption,
                    "index": item.index,
                    "item_id": item.item_id,
                }
            }),
        )?;
        match read_reply(&id_num.to_string()) {
            Ok(v) => {
                let result = v.get("result").cloned().unwrap_or(json!({}));
                let status = result
                    .get("status")
                    .and_then(|x| x.as_str())
                    .unwrap_or("failed");
                let mid = result.get("message_id").and_then(|x| x.as_i64());
                let err = result
                    .get("error")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string());
                let st = match status {
                    "done" | "success" => ItemState::Done,
                    "skipped" => ItemState::Skipped,
                    _ => ItemState::Failed,
                };
                let _ = job_queue::update_item(&tid, item.index, st, mid, err);
            }
            Err(e) => {
                let _ = job_queue::update_item(&tid, item.index, ItemState::Failed, None, Some(e));
            }
        }
    }

    let fin = seq;
    let _ = write_cmd(fin, json!({"cmd": "finish"}));
    let _ = read_reply(&fin.to_string());
    let _ = write_cmd(fin + 1, json!({"cmd": "quit"}));
    thread::sleep(Duration::from_millis(200));
    let _ = child.kill();
    let _ = child.wait();

    Ok(finalize_transfer(
        &tid,
        rec.items.len(),
        "rust_orch_telethon_step",
    ))
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
}
