//! Shared Studio Orchestrator Utilities & Preflight Ledger Guards.
//!
//! Extracted from `studio_orch.rs` to maintain strict adherence to the
//! 2,000-line modularization boundary (Rule 17) and provide shared source
//! preflight guards across single and album pipelines.

use serde::Serialize;
use serde_json::json;
use std::path::{Path, PathBuf};

use crate::core::autogram_core;
use crate::core::autogram_core::transfer::{
    classify_prepared_delivery, normalize_caption, CaptionOverflowPolicy, DeliveryClassification,
    MediaCategory, PayloadClass, QualityMode, TransferFeatureFlags,
};
use crate::core::grammers_ops;
use crate::core::job_queue::{self, ItemState, TransferRecord};
use crate::core::media_prep;
use crate::core::telegram_ops::TelegramIdentity;
use crate::core::tg_log;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum SourceFilePreflight {
    Valid { path: PathBuf, size: u64 },
    NotFound(String),
    Empty(String),
}

/// Preflight check for local source media before processing or album aggregation.
/// Fast zero-overhead verification preventing corrupted 0-byte or missing files
/// from contaminating album collages or causing Telegram MTProto rejected uploads.
pub(crate) fn check_source_file_preflight(path_str: &str) -> SourceFilePreflight {
    let p = Path::new(path_str);
    if !p.exists() || !p.is_file() {
        return SourceFilePreflight::NotFound(path_str.to_string());
    }
    match std::fs::metadata(p) {
        Ok(meta) => {
            let len = meta.len();
            if len == 0 {
                SourceFilePreflight::Empty(path_str.to_string())
            } else {
                SourceFilePreflight::Valid {
                    path: p.to_path_buf(),
                    size: len,
                }
            }
        }
        Err(_) => SourceFilePreflight::NotFound(path_str.to_string()),
    }
}

pub(crate) fn option_bool(options: &serde_json::Value, snake: &str, camel: &str, default: bool) -> bool {
    options
        .get(snake)
        .or_else(|| options.get(camel))
        .and_then(|value| value.as_bool())
        .unwrap_or(default)
}

pub(crate) fn option_usize(options: &serde_json::Value, snake: &str, camel: &str, default: usize) -> usize {
    options
        .get(snake)
        .or_else(|| options.get(camel))
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .unwrap_or(default)
}

pub(crate) fn is_nonstandard_image_source(path: &str) -> bool {
    let p = std::path::Path::new(path);
    crate::core::autogram_core::transfer::is_nonstandard_image_ext(p)
}

/// A non-standard image that was deliberately left untouched must remain a
/// Telegram document. This source-path guard is intentionally independent of
/// magic-byte classification: files carrying JPEG bytes under a `.webp` name
/// are still governed by the user's lossless/raw delivery choice and must not
/// be silently renamed or recompressed by Telegram as native photos.
pub(crate) fn apply_nonstandard_source_document_guard(
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

/// Read the resolver-produced adaptive pair for one queue item. The pair is
/// optional and credential-free; malformed entries are ignored so legacy queue
/// records continue through the ordinary direct-URL path.
pub(crate) fn remote_mux_for_item(
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

pub(crate) fn effective_upload_limit(rec: &TransferRecord, runtime_limit: u64) -> u64 {
    rec.options
        .get("account_max_file_size_bytes")
        .or_else(|| rec.options.get("max_file_size_bytes"))
        .and_then(|value| value.as_u64())
        .map(|configured| configured.min(runtime_limit))
        .unwrap_or(runtime_limit)
}

pub(crate) fn approved_alternate_sessions(rec: &TransferRecord) -> Vec<String> {
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

pub(crate) fn item_spoiler(options: &serde_json::Value, item_index: usize) -> bool {
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
pub(crate) fn prepare_with_receipt(
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
    crate::core::autogram_core::transfer::begin_encoder_receipt(
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
            crate::core::autogram_core::transfer::finish_encoder_receipt(
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
            let _ = crate::core::autogram_core::transfer::finish_encoder_receipt::<serde_json::Value, _>(
                &receipt_id,
                "FAILED",
                None,
                &json!({ "error": &error }),
            );
            Err(error)
        }
    }
}

pub(crate) fn serialized_label<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| "unknown".into())
}

pub(crate) fn persist_prepared_decision(
    rec: &TransferRecord,
    item_index: usize,
    source_path: &str,
    prepared_path: &str,
    classification: &DeliveryClassification,
    runtime_limit: u64,
) -> Result<(), String> {
    let (analysis_key, _, _) =
        crate::core::autogram_core::transfer::analysis_cache_key(std::path::Path::new(prepared_path));
    let profile_json = serde_json::to_vec(&rec.options).map_err(|error| error.to_string())?;
    let profile_digest = crate::core::autogram_core::transfer::sha256_bytes(&profile_json);
    let capability_digest = crate::core::autogram_core::transfer::sha256_bytes(
        format!("{}|{}", rec.session, runtime_limit).as_bytes(),
    );
    let decision_key = crate::core::autogram_core::transfer::sha256_bytes(
        format!("{analysis_key}|{profile_digest}|{capability_digest}").as_bytes(),
    );
    crate::core::autogram_core::transfer::persist_transfer_decision(
        &decision_key,
        &analysis_key,
        &profile_digest,
        &capability_digest,
        classification,
    )?;
    crate::core::autogram_core::transfer::record_transfer_item_decision(
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
pub(crate) struct PreparedLedgerIdentity {
    pub(crate) prepared_path: String,
    pub(crate) sha256: String,
    pub(crate) filename: String,
    pub(crate) size: u64,
    pub(crate) payload_class: String,
}

pub(crate) fn duplicate_skip_enabled(rec: &TransferRecord, source_path: &str) -> bool {
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

pub(crate) fn duplicate_match_for_source(
    rec: &TransferRecord,
    topic_id: Option<i64>,
    source_path: &str,
) -> Result<Option<crate::core::autogram_core::transfer::UploadLedgerMatch>, String> {
    if !duplicate_skip_enabled(rec, source_path) || media_prep::is_remote_url(source_path) {
        return Ok(None);
    }
    let path = std::path::Path::new(source_path);
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    crate::core::autogram_core::transfer::find_source_upload_ledger_match(
        &rec.session,
        &rec.chat_id,
        topic_id,
        path,
        filename,
    )
    .map(|opt| opt.map(|(matched, _, _)| matched))
}

pub(crate) fn prepared_ledger_identity(
    prepared_path: &str,
    classification: &DeliveryClassification,
) -> Result<PreparedLedgerIdentity, String> {
    let path = std::path::Path::new(prepared_path);
    Ok(PreparedLedgerIdentity {
        prepared_path: prepared_path.to_string(),
        sha256: crate::core::autogram_core::transfer::sha256_file(path)?,
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

pub(crate) fn duplicate_match_for_prepared(
    rec: &TransferRecord,
    topic_id: Option<i64>,
    source_path: &str,
    identity: &PreparedLedgerIdentity,
) -> Result<Option<crate::core::autogram_core::transfer::UploadLedgerMatch>, String> {
    if !duplicate_skip_enabled(rec, source_path) {
        return Ok(None);
    }
    crate::core::autogram_core::transfer::find_upload_ledger_match(
        &rec.session,
        &rec.chat_id,
        topic_id,
        &identity.sha256,
        &identity.filename,
        identity.size,
    )
}

pub(crate) fn persist_upload_ledger_binding(
    rec: &TransferRecord,
    topic_id: Option<i64>,
    uploader_account_id: &str,
    telegram_message_id: Option<i64>,
    item_index: usize,
    identity: &PreparedLedgerIdentity,
) {
    if let Err(error) = crate::core::autogram_core::transfer::record_upload_ledger(
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

    let Some(source_item) = rec.items.iter().find(|item| item.index == item_index) else {
        return;
    };
    if media_prep::is_remote_url(&source_item.path) || source_item.path == identity.prepared_path {
        return;
    }
    let source_path = std::path::Path::new(&source_item.path);
    let source_identity =
        crate::core::autogram_core::transfer::sha256_file(source_path).and_then(|sha256| {
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
            if let Err(error) = crate::core::autogram_core::transfer::record_upload_ledger(
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

pub(crate) fn persist_upload_ledger_for_path(
    rec: &TransferRecord,
    topic_id: Option<i64>,
    uploader_account_id: &str,
    telegram_message_id: Option<i64>,
    item_index: usize,
    prepared_path: &str,
    as_document: bool,
) {
    let path = std::path::Path::new(prepared_path);
    let identity = crate::core::autogram_core::transfer::sha256_file(path).and_then(|sha256| {
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
