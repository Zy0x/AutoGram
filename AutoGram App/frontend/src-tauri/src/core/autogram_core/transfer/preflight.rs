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
    pub oversize_action: Option<String>,
    pub global_caption: Option<String>,
    pub caption_overflow_policy: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityPreflightItem {
    pub index: usize,
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
        QualityMode::Original
    };
    let force_document = request.presentation_override.as_deref() == Some("force_document");
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

        let (transform, payload_class, as_document, reason_code) = if remote {
            warnings.push("remote_analysis_deferred".into());
            requires_confirmation = true;
            (
                TransformAction::PassThrough,
                PayloadClass::DocumentGroup,
                true,
                "remote_analysis_deferred".to_string(),
            )
        } else if mode == QualityMode::Original {
            rejected.push("original_forbids_transform".into());
            (
                TransformAction::PassThrough,
                PayloadClass::OriginalDocumentBatch,
                true,
                "original_generic_document".to_string(),
            )
        } else if force_document {
            (
                TransformAction::PassThrough,
                PayloadClass::DocumentGroup,
                true,
                "presentation_forced_document".to_string(),
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
        items.push(QualityPreflightItem {
            index,
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
    QualityPreflightReport {
        schema_version: 1,
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
            oversize_action: Some("split".into()),
            global_caption: None,
            caption_overflow_policy: Some("truncate_with_warning".into()),
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
        assert!(report.items[0].as_document);
    }

    #[test]
    fn remote_input_is_never_guessed_native() {
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
        assert!(report.items[0].as_document);
        assert!(report.items[0].requires_confirmation);
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
