use serde::{Deserialize, Serialize};
use std::path::Path;

use super::{
    analyze_media, classify_prepared_delivery, normalize_caption, utf16_len, CaptionOverflowPolicy,
    MediaCategory, PayloadClass, QualityMode, TransferFeatureFlags, TransformAction,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityPreflightRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub paths: Vec<String>,
    pub quality_mode: Option<String>,
    pub presentation_override: Option<String>,
    pub group_as_album: bool,
    pub album_group_size: Option<usize>,
    pub album_avoid_single: Option<bool>,
    pub duplicate_policy: Option<String>,
    pub prevent_sticker_conversion: Option<bool>,
    pub oversize_action: Option<String>,
    pub global_caption: Option<String>,
    pub caption_overflow_policy: Option<String>,
    pub destination_id: Option<String>,
    pub topic_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityPreflightDuplicateMatch {
    pub match_level: String,
    pub telegram_message_id: Option<i64>,
    pub telegram_unique_id: Option<String>,
    pub existing_name: String,
    pub existing_size: u64,
    pub existing_payload_class: String,
    pub destination_id: String,
    pub topic_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityPreflightItem {
    pub index: usize,
    pub source_path: String,
    pub source_name: String,
    pub source_size: u64,
    pub category: MediaCategory,
    pub transform: TransformAction,
    pub payload_class: PayloadClass,
    pub as_document: bool,
    pub album_eligible: bool,
    pub reason_code: String,
    pub warnings: Vec<String>,
    pub rejected_alternatives: Vec<String>,
    pub requires_confirmation: bool,
    pub duplicate_match: Option<QualityPreflightDuplicateMatch>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityPreflightReport {
    pub schema_version: u32,
    pub capability_source: String,
    pub engine_mode: String,
    pub effective_max_bytes: u64,
    pub caption_limit: u32,
    pub caption_length_utf16: usize,
    pub caption_summary_index: Option<usize>,
    pub caption_warnings: Vec<String>,
    pub has_blocking_issues: bool,
    pub items: Vec<QualityPreflightItem>,
    pub requires_confirmation: bool,
    pub album_is_provisional: bool,
    pub transform_convert_count: usize,
    pub transform_reencode_count: usize,
    pub album_grid_size: usize,
    pub planned_album_sizes: Vec<usize>,
}

fn album_partition_sizes(total: usize, requested: usize, avoid_single: bool) -> Vec<usize> {
    let target = requested.clamp(2, 10);
    if total == 0 {
        return Vec::new();
    }
    let mut sizes = Vec::new();
    let mut remaining = total;
    while remaining > target {
        sizes.push(target);
        remaining -= target;
    }
    if remaining > 0 {
        sizes.push(remaining);
    }
    if avoid_single && sizes.len() >= 2 && sizes.last() == Some(&1) {
        let donor = sizes.len() - 2;
        if sizes[donor] > 2 {
            sizes[donor] -= 1;
            *sizes.last_mut().expect("album remainder") = 2;
        }
    }
    sizes
}

fn source_name(path: &str, index: usize) -> String {
    if path.starts_with("http://") || path.starts_with("https://") {
        return path
            .split(['/', '?', '#'])
            .filter(|part| !part.is_empty())
            .next_back()
            .unwrap_or("remote-file")
            .to_string();
    }
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| format!("item-{}", index + 1))
}

fn is_remote(path: &str) -> bool {
    path.starts_with("http://") || path.starts_with("https://")
}

fn duplicate_probe_enabled(request: &QualityPreflightRequest) -> bool {
    !request
        .duplicate_policy
        .as_deref()
        .is_some_and(|policy| policy.eq_ignore_ascii_case("FORCE_UPLOAD"))
}

pub fn build_quality_preflight(
    request: &QualityPreflightRequest,
    capability_source: &str,
    effective_max_bytes: u64,
    caption_limit: u32,
    encoder_available: bool,
    feature_flags: TransferFeatureFlags,
) -> QualityPreflightReport {
    let mode = if feature_flags.transfer_v4 {
        QualityMode::parse(request.quality_mode.as_deref())
    } else {
        QualityMode::Document
    };
    let force_document = matches!(
        request.presentation_override.as_deref(),
        Some("force_document") | Some("document")
    );
    let mut items = Vec::with_capacity(request.paths.len());

    for (index, source) in request.paths.iter().enumerate() {
        let remote = is_remote(source);
        let source_path = Path::new(source);
        let source_size = if remote {
            0
        } else {
            std::fs::metadata(source_path)
                .map(|metadata| metadata.len())
                .unwrap_or(0)
        };
        let analysis = (!remote).then(|| analyze_media(source_path));
        let category = analysis
            .as_ref()
            .map(|value| value.category)
            .unwrap_or(MediaCategory::UnknownBinary);
        let mut warnings = Vec::new();
        let mut rejected = Vec::new();
        let mut requires_confirmation = false;

        let ext_lower = source_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let is_webp_sticker =
            category == MediaCategory::WebpImage || ext_lower == "webp" || ext_lower == "tgs";
        let prevent_sticker = request.prevent_sticker_conversion.unwrap_or(false)
            || request.group_as_album
            || request
                .quality_mode
                .as_deref()
                .unwrap_or("")
                .to_ascii_uppercase()
                .contains("PREVENT_STICKER")
            || request
                .quality_mode
                .as_deref()
                .unwrap_or("")
                .to_ascii_uppercase()
                .contains("PHOTO")
            || request
                .quality_mode
                .as_deref()
                .unwrap_or("")
                .to_ascii_uppercase()
                .contains("VISUAL")
            || request
                .quality_mode
                .as_deref()
                .unwrap_or("")
                .to_ascii_uppercase()
                .contains("SEIMBANG")
            || request
                .quality_mode
                .as_deref()
                .unwrap_or("")
                .to_ascii_uppercase()
                .contains("HEMAT")
            || request
                .quality_mode
                .as_deref()
                .unwrap_or("")
                .to_ascii_uppercase()
                .contains("JELAS")
            || request
                .quality_mode
                .as_deref()
                .unwrap_or("")
                .to_ascii_uppercase()
                .contains("HIGH")
            || request
                .quality_mode
                .as_deref()
                .unwrap_or("")
                .to_ascii_uppercase()
                .contains("LOW")
            || request
                .quality_mode
                .as_deref()
                .unwrap_or("")
                .to_ascii_uppercase()
                .contains("AUTO");

        let (transform, payload_class, as_document, reason_code) = if force_document || mode == QualityMode::Document {
            (
                TransformAction::PassThrough,
                PayloadClass::DocumentGroup,
                true,
                "presentation_forced_document".to_string(),
            )
        } else if mode == QualityMode::Original {
            let is_supported_visual = matches!(
                category,
                MediaCategory::JpegImage
                    | MediaCategory::PngImage
                    | MediaCategory::WebpImage
                    | MediaCategory::Mp4Video
            ) || (remote && (source.ends_with(".jpg") || source.ends_with(".jpeg") || source.ends_with(".png") || source.ends_with(".mp4") || source.contains("photomode") || source.contains("tiktok") || source.contains("instagram")));
            let is_supported_audio = category == MediaCategory::Audio;
            if is_supported_visual {
                (
                    TransformAction::PassThrough,
                    PayloadClass::NativeVisual,
                    false,
                    "original_passthrough_visual".to_string(),
                )
            } else if is_supported_audio {
                (
                    TransformAction::PassThrough,
                    PayloadClass::AudioGroup,
                    false,
                    "original_passthrough_audio".to_string(),
                )
            } else {
                rejected.push("original_forbids_transform".into());
                (
                    TransformAction::PassThrough,
                    PayloadClass::OriginalDocumentBatch,
                    true,
                    "original_generic_document".to_string(),
                )
            }
        } else if remote {
            warnings.push("remote_analysis_deferred".into());
            requires_confirmation = true;
            let looks_like_photo = source.ends_with(".jpg")
                || source.ends_with(".jpeg")
                || source.ends_with(".png")
                || source.contains("photomode")
                || source.contains("image");
            let looks_like_audio = source.ends_with(".mp3")
                || source.ends_with(".m4a")
                || source.contains("audio")
                || source.contains("music");
            if looks_like_photo {
                (
                    TransformAction::PassThrough,
                    PayloadClass::NativeVisual,
                    false,
                    "remote_visual_stream".to_string(),
                )
            } else if looks_like_audio {
                (
                    TransformAction::PassThrough,
                    PayloadClass::AudioGroup,
                    false,
                    "remote_audio_stream".to_string(),
                )
            } else {
                (
                    TransformAction::PassThrough,
                    PayloadClass::NativeVisual,
                    false,
                    "remote_video_stream".to_string(),
                )
            }
        } else if is_webp_sticker && prevent_sticker {
            (
                TransformAction::ConvertWebpPng,
                PayloadClass::NativeVisual,
                false,
                "convert_webp_png_lossless".to_string(),
            )
        } else if category == MediaCategory::OtherVideo
            && analysis
                .as_ref()
                .is_some_and(|value| value.lossless_mp4_remux_feasible())
        {
            rejected.push("lossy_reencode_not_needed".into());
            (
                TransformAction::LosslessRemux,
                PayloadClass::NativeVisual,
                false,
                "lossless_remux_preferred".to_string(),
            )
        } else if matches!(
            category,
            MediaCategory::Mp4Video | MediaCategory::OtherVideo
        ) && analysis.as_ref().is_some_and(|value| {
            !value.is_validated_native_video()
                && !value.has_preservation_sensitive_streams()
                && !value.is_hdr()
        }) && encoder_available
        {
            warnings.push("lossy_reencode_planned".into());
            requires_confirmation = true;
            (
                TransformAction::Reencode,
                PayloadClass::NativeVisual,
                false,
                "native_video_reencode_planned".to_string(),
            )
        } else {
            let delivery = classify_prepared_delivery(
                source_path,
                mode,
                false,
                analysis
                    .as_ref()
                    .is_some_and(|value| value.is_validated_native_video()),
            );
            if matches!(
                category,
                MediaCategory::Mp4Video | MediaCategory::OtherVideo
            ) && delivery.as_document
            {
                warnings.push(
                    if analysis
                        .as_ref()
                        .is_some_and(|value| value.has_preservation_sensitive_streams())
                    {
                        "preservation_sensitive_streams".into()
                    } else if analysis.as_ref().is_some_and(|value| value.is_hdr()) {
                        "hdr_requires_explicit_policy".into()
                    } else {
                        "native_video_validation_unavailable".into()
                    },
                );
                rejected.push("unsafe_native_payload".into());
            }
            (
                delivery.transform,
                delivery.payload_class,
                delivery.as_document,
                delivery.reason_code,
            )
        };

        if source_size > effective_max_bytes && effective_max_bytes > 0 {
            warnings.push(format!(
                "oversize_requires_{}",
                request.oversize_action.as_deref().unwrap_or("decision")
            ));
            requires_confirmation = true;
        }
        let album_eligible = request.group_as_album
            && matches!(
                payload_class,
                PayloadClass::NativeVisual
                    | PayloadClass::DocumentGroup
                    | PayloadClass::AudioGroup
                    | PayloadClass::OriginalDocumentBatch
            );
        let duplicate_check_enabled = duplicate_probe_enabled(request);
        let duplicate_match = if duplicate_check_enabled && !remote && source_size > 0 {
            request
                .destination_id
                .as_deref()
                .and_then(|destination_id| {
                    super::sha256_file(source_path)
                        .ok()
                        .and_then(|source_sha256| {
                            super::find_upload_ledger_match(
                                &request.session,
                                destination_id,
                                request.topic_id,
                                &source_sha256,
                                &source_name(source, index),
                                source_size,
                            )
                            .ok()
                            .flatten()
                        })
                        .map(|ledger_match| QualityPreflightDuplicateMatch {
                            match_level: ledger_match.match_level,
                            telegram_message_id: ledger_match.telegram_message_id,
                            telegram_unique_id: ledger_match.telegram_unique_id,
                            existing_name: ledger_match.filename,
                            existing_size: ledger_match.file_size,
                            existing_payload_class: ledger_match.payload_class,
                            destination_id: destination_id.to_string(),
                            topic_id: request.topic_id,
                        })
                })
        } else {
            None
        };
        if duplicate_match.is_some() {
            requires_confirmation = true;
        }
        items.push(QualityPreflightItem {
            index,
            source_path: source.clone(),
            source_name: source_name(source, index),
            source_size,
            category,
            transform,
            payload_class,
            as_document,
            album_eligible,
            reason_code,
            warnings,
            rejected_alternatives: rejected,
            requires_confirmation,
            duplicate_match,
        });
    }
    let caption = request.global_caption.as_deref().unwrap_or_default().trim();
    let caption_length_utf16 = utf16_len(caption);
    let caption_policy = CaptionOverflowPolicy::parse(request.caption_overflow_policy.as_deref());
    let mut caption_warnings = Vec::new();
    let mut has_blocking_issues = false;
    if !caption.is_empty() {
        match normalize_caption(caption, caption_limit, caption_policy) {
            Ok(normalized) if normalized.truncated => {
                caption_warnings.push("caption_will_truncate".into());
            }
            Ok(_) => {}
            Err(_) => {
                caption_warnings.push("caption_overflow_will_fail".into());
                has_blocking_issues = true;
            }
        }
    }
    let caption_summary_index = if request.group_as_album && !caption.is_empty() {
        items.first().map(|item| item.index)
    } else {
        None
    };
    let requires_confirmation =
        items.iter().any(|item| item.requires_confirmation) || !caption_warnings.is_empty();
    let transform_convert_count = items
        .iter()
        .filter(|item| item.transform == TransformAction::ConvertWebpPng)
        .count();
    let transform_reencode_count = items
        .iter()
        .filter(|item| item.transform == TransformAction::Reencode)
        .count();

    let album_grid_size = request.album_group_size.unwrap_or(10).clamp(2, 10);
    let planned_album_sizes = if request.group_as_album {
        let eligible_count = items.iter().filter(|item| item.album_eligible).count();
        album_partition_sizes(
            eligible_count,
            album_grid_size,
            request.album_avoid_single.unwrap_or(true),
        )
    } else {
        Vec::new()
    };
    QualityPreflightReport {
        schema_version: 2,
        capability_source: capability_source.to_string(),
        engine_mode: feature_flags.engine_mode().into(),
        effective_max_bytes,
        caption_limit,
        caption_length_utf16,
        caption_summary_index,
        caption_warnings,
        has_blocking_issues,
        items,
        requires_confirmation,
        album_is_provisional: request.group_as_album,
        transform_convert_count,
        transform_reencode_count,
        album_grid_size,
        planned_album_sizes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn request(path: &Path, mode: &str) -> QualityPreflightRequest {
        QualityPreflightRequest {
            session: "test".into(),
            api_id: 1,
            api_hash: String::new(),
            paths: vec![path.display().to_string()],
            quality_mode: Some(mode.into()),
            presentation_override: Some("automatic".into()),
            group_as_album: true,
            album_group_size: Some(10),
            album_avoid_single: Some(true),
            duplicate_policy: Some("SKIP".into()),
            prevent_sticker_conversion: None,
            oversize_action: Some("split".into()),
            global_caption: None,
            caption_overflow_policy: Some("truncate_with_warning".into()),
            destination_id: None,
            topic_id: None,
        }
    }

    #[test]
    fn original_never_proposes_a_transform() {
        let path = std::env::temp_dir().join("autogram-preflight-original.jpg");
        fs::write(&path, [0xff, 0xd8, 0xff, 0xdb]).unwrap();
        let report = build_quality_preflight(
            &request(&path, "ORIGINAL"),
            "fallback",
            10,
            1_024,
            true,
            TransferFeatureFlags::default(),
        );
        assert_eq!(report.items[0].transform, TransformAction::PassThrough);
        assert!(!report.items[0].as_document);
        assert_eq!(report.items[0].payload_class, PayloadClass::NativeVisual);
    }

    #[test]
    fn document_mode_forces_generic_document_preflight() {
        let path = std::env::temp_dir().join("autogram-preflight-doc.jpg");
        fs::write(&path, [0xff, 0xd8, 0xff, 0xdb]).unwrap();
        let report = build_quality_preflight(
            &request(&path, "DOCUMENT"),
            "fallback",
            10,
            1_024,
            true,
            TransferFeatureFlags::default(),
        );
        assert_eq!(report.items[0].transform, TransformAction::PassThrough);
        assert!(report.items[0].as_document);
    }

    #[test]
    fn remote_input_requires_confirmation() {
        let mut request = request(Path::new("unused"), "SMART");
        request.paths = vec!["https://example.invalid/clip.mp4".into()];
        let report = build_quality_preflight(
            &request,
            "fallback",
            u64::MAX,
            1_024,
            true,
            TransferFeatureFlags::default(),
        );
        assert_eq!(report.items[0].transform, TransformAction::PassThrough);
        assert!(report.items[0].requires_confirmation);
    }

    #[test]
    fn custom_album_grid_size_seven_plans_seven_plus_three() {
        let mut request = request(Path::new("unused"), "SMART");
        request.paths = (0..10)
            .map(|index| format!("https://example.invalid/{index}.jpg"))
            .collect();
        request.album_group_size = Some(7);
        let report = build_quality_preflight(
            &request,
            "live",
            u64::MAX,
            1_024,
            true,
            TransferFeatureFlags::default(),
        );
        assert_eq!(report.album_grid_size, 7);
        assert_eq!(report.planned_album_sizes, vec![7, 3]);
    }

    #[test]
    fn force_upload_skips_the_preflight_duplicate_probe() {
        let mut request = request(Path::new("unused"), "SMART");
        request.duplicate_policy = Some("FORCE_UPLOAD".into());
        assert!(!duplicate_probe_enabled(&request));
        request.duplicate_policy = Some("SKIP".into());
        assert!(duplicate_probe_enabled(&request));
    }

    #[test]
    fn preflight_explains_album_caption_assignment_and_runtime_truncation() {
        let mut request = request(Path::new("unused"), "SMART");
        request.paths = vec![
            "https://example.invalid/one.bin".into(),
            "https://example.invalid/two.bin".into(),
        ];
        request.global_caption = Some("😀😀😀".into());
        let report = build_quality_preflight(
            &request,
            "live",
            u64::MAX,
            4,
            true,
            TransferFeatureFlags::default(),
        );
        assert_eq!(report.caption_length_utf16, 6);
        assert_eq!(report.caption_summary_index, Some(0));
        assert_eq!(report.caption_warnings, vec!["caption_will_truncate"]);
        assert!(!report.has_blocking_issues);
    }

    #[test]
    fn fail_policy_blocks_over_limit_caption_before_queueing() {
        let mut request = request(Path::new("unused"), "SMART");
        request.global_caption = Some("12345".into());
        request.caption_overflow_policy = Some("fail".into());
        let report = build_quality_preflight(
            &request,
            "live",
            u64::MAX,
            4,
            true,
            TransferFeatureFlags::default(),
        );
        assert!(report.has_blocking_issues);
        assert_eq!(report.caption_warnings, vec!["caption_overflow_will_fail"]);
    }

    #[test]
    fn safe_rollback_preflight_is_original_document_only() {
        let request = request(Path::new("unused.jpg"), "HIGH_QUALITY");
        let report = build_quality_preflight(
            &request,
            "fallback",
            u64::MAX,
            1_024,
            true,
            TransferFeatureFlags {
                transfer_v4: false,
                intelligent_albums: false,
                oversize_routing: false,
                encoder_orchestration: false,
                ..TransferFeatureFlags::default()
            },
        );
        assert_eq!(report.engine_mode, "safe_rollback");
        assert!(report.items[0].as_document);
        assert_eq!(report.items[0].transform, TransformAction::PassThrough);
    }
}
