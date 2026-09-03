use super::quality::PayloadClass;
use serde::{Deserialize, Serialize};

pub const TELEGRAM_ALBUM_MAX: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlbumPackingPolicy {
    Maximum,
    Balanced,
    Custom,
    FollowSelection,
    Never,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlbumFailurePolicy {
    AtomicStrict,
    RetryPrepare,
    ReplanGroup,
    SendRemaining,
    SendFailedSeparately,
    CancelGroup,
    BestEffortAdvanced,
}

impl AlbumFailurePolicy {
    pub fn parse(value: Option<&str>) -> Self {
        match value.unwrap_or("atomic_strict") {
            "retry_prepare" | "retry_group" => Self::RetryPrepare,
            "replan_group" => Self::ReplanGroup,
            "send_remaining" | "keep_delivered" => Self::SendRemaining,
            "send_failed_separately" => Self::SendFailedSeparately,
            "cancel_group" | "stop_group" => Self::CancelGroup,
            "best_effort_advanced" => Self::BestEffortAdvanced,
            _ => Self::AtomicStrict,
        }
    }

    pub fn permits_structural_replan(self) -> bool {
        matches!(
            self,
            Self::ReplanGroup
                | Self::SendRemaining
                | Self::SendFailedSeparately
                | Self::BestEffortAdvanced
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumCompatibilityKey {
    pub account_id: String,
    pub peer_id: String,
    pub topic_id: Option<i64>,
    pub reply_to: Option<i64>,
    pub send_as: Option<String>,
    pub schedule_at: Option<i64>,
    pub silent: bool,
    pub payload_class: PayloadClass,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedAlbumItem {
    pub index: usize,
    pub path: String,
    pub caption: String,
    pub spoiler: bool,
    pub size: u64,
    pub key: AlbumCompatibilityKey,
    /// Keep media native but send as a single when Telegram rejects the
    /// payload in `messages.sendMultiMedia` (for example silent video tracks).
    #[serde(default)]
    pub force_single: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlbumPlanOptions {
    pub enabled: bool,
    pub packing: AlbumPackingPolicy,
    pub custom_size: usize,
    pub avoid_single_remainder: bool,
    pub group_documents: bool,
    pub group_audio: bool,
    pub group_original_documents: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedAlbumGroup {
    pub items: Vec<PreparedAlbumItem>,
    pub as_document: bool,
    pub payload_class: PayloadClass,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AlbumPlan {
    pub groups: Vec<PlannedAlbumGroup>,
    pub singles: Vec<PreparedAlbumItem>,
    pub explanations: Vec<String>,
}

fn target_size(policy: AlbumPackingPolicy, custom: usize) -> usize {
    match policy {
        AlbumPackingPolicy::Maximum => TELEGRAM_ALBUM_MAX,
        AlbumPackingPolicy::Balanced => 6,
        AlbumPackingPolicy::Custom => custom.clamp(2, TELEGRAM_ALBUM_MAX),
        AlbumPackingPolicy::FollowSelection => TELEGRAM_ALBUM_MAX,
        AlbumPackingPolicy::Never => 1,
    }
}

fn partition_sizes(total: usize, target: usize, avoid_single: bool) -> Vec<usize> {
    if total == 0 {
        return vec![];
    }
    if target < 2 {
        return vec![1; total];
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
        let last_full = sizes.len() - 2;
        if sizes[last_full] > 2 {
            sizes[last_full] -= 1;
            *sizes.last_mut().unwrap() = 2;
        }
    }
    sizes
}

fn groupable(class: PayloadClass, _options: &AlbumPlanOptions) -> bool {
    match class {
        PayloadClass::NativeVisual => true,
        // Telegram's official `messages.sendMultiMedia` album contract is
        // limited to photo/video media. Documents and audio must be sent as
        // separate messages even when the UI toggle is enabled; attempting to
        // pack them creates partial albums or server-side rejection.
        PayloadClass::AudioGroup
        | PayloadClass::DocumentGroup
        | PayloadClass::SplitPartBatch
        | PayloadClass::OriginalDocumentBatch => false,
    }
}

fn is_video_path(path: &str) -> bool {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "mp4" | "mkv" | "mov" | "webm" | "avi" | "wmv" | "ts" | "m4v" | "flv" | "3gp"
    )
}

fn video_balanced_partition_sizes(total: usize, max_safe: usize) -> Vec<usize> {
    if total <= max_safe {
        return vec![total];
    }
    let k = (total + max_safe - 1) / max_safe;
    let base = total / k;
    let rem = total % k;
    (0..k)
        .map(|i| if i < rem { base + 1 } else { base })
        .collect()
}

pub fn build_album_plan(items: Vec<PreparedAlbumItem>, options: &AlbumPlanOptions) -> AlbumPlan {
    let mut plan = AlbumPlan::default();
    if !options.enabled || options.packing == AlbumPackingPolicy::Never {
        plan.singles = items;
        plan.explanations.push("album_disabled".into());
        return plan;
    }
    let target = target_size(options.packing, options.custom_size);
    let mut current_key: Option<AlbumCompatibilityKey> = None;
    let mut current_bucket: Vec<PreparedAlbumItem> = Vec::new();
    let flush_bucket = |plan: &mut AlbumPlan,
                            key: &mut Option<AlbumCompatibilityKey>,
                            bucket: &mut Vec<PreparedAlbumItem>| {
        let Some(bucket_key) = key.take() else { return; };
        if bucket.is_empty() { return; }
        let mut grouped = std::mem::take(bucket);
        let has_video = grouped.iter().any(|item| is_video_path(&item.path));
        let sizes = if options.packing == AlbumPackingPolicy::Custom {
            partition_sizes(grouped.len(), target, options.avoid_single_remainder)
        } else if has_video {
            let total_bytes: u64 = grouped.iter().map(|item| item.size).sum();
            let has_heavy_video = grouped.iter().any(|item| item.size >= 35 * 1024 * 1024);
            let total_mb = total_bytes / (1024 * 1024);

            if grouped.len() <= 10 {
                if !has_heavy_video && total_mb < 35 {
                    vec![grouped.len()]
                } else if grouped.len() == 9 && total_mb < 50 && !has_heavy_video {
                    // 9 videos forms a clean 3x3 square mosaic
                    vec![9]
                } else {
                    // Heavy 10-video batch will time out on Telegram DC; balance to 5+5
                    video_balanced_partition_sizes(grouped.len(), 5)
                }
            } else {
                // When more than 10 videos exist, prioritize Maximum 10 packing (e.g. 15 -> 10 + 5).
                // Sort videos by size ascending so that the 10 lightest videos cluster into the first group,
                // keeping the 10-item group lightweight (< 35MB) to avoid Telegram DC worker timeout (>60s),
                // while the remaining heavier videos are isolated into the smaller, fast-committing tail group.
                grouped.sort_by_key(|item| item.size);
                partition_sizes(grouped.len(), 10, true)
            }
        } else {
            partition_sizes(grouped.len(), target, options.avoid_single_remainder)
        };
        let mut cursor = 0usize;
        for size in sizes {
            let end = cursor + size;
            let chunk = grouped[cursor..end].to_vec();
            cursor = end;
            if chunk.len() == 1 {
                plan.singles.extend(chunk);
            } else {
                plan.groups.push(PlannedAlbumGroup {
                    items: chunk,
                    as_document: bucket_key.payload_class != PayloadClass::NativeVisual,
                    payload_class: bucket_key.payload_class,
                });
            }
        }
    };
    let mut ordered_items = items;
    ordered_items.sort_by_key(|item| item.index);
    for item in ordered_items {
        if item.force_single {
            flush_bucket(&mut plan, &mut current_key, &mut current_bucket);
            let index = item.index;
            plan.singles.push(item);
            plan.explanations.push(format!("item_forced_single:{index}"));
            continue;
        }
        if !groupable(item.key.payload_class, options) {
            flush_bucket(&mut plan, &mut current_key, &mut current_bucket);
            let index = item.index;
            let class = item.key.payload_class;
            plan.singles.push(item);
            plan.explanations
                .push(format!("payload_not_groupable:{class:?}:{index}"));
            continue;
        }
        if current_key.as_ref() != Some(&item.key) {
            flush_bucket(&mut plan, &mut current_key, &mut current_bucket);
            current_key = Some(item.key.clone());
        }
        current_bucket.push(item);
    }
    flush_bucket(&mut plan, &mut current_key, &mut current_bucket);
    if options.packing != AlbumPackingPolicy::Maximum {
        plan.groups
            .sort_by_key(|g| g.items.first().map(|i| i.index).unwrap_or(usize::MAX));
    }
    plan.singles.sort_by_key(|i| i.index);
    plan
}

/// Validate Telegram MTProto invariants for an album group before dispatch.
/// Enforces:
/// 1. Item count must be between 2 and 10 (TELEGRAM_ALBUM_MAX).
/// 2. For NativeVisual albums (!as_document):
///    - Items at index > 0 MUST have an empty caption ("") to prevent Telegram layout breakage (9+1 split).
///    - All items must match PayloadClass::NativeVisual.
/// 3. All items in the group must share the same as_document and payload_class semantics.
pub fn validate_album_group_invariants(group: &PlannedAlbumGroup) -> Result<(), String> {
    if group.items.is_empty() {
        return Err("Album group is empty".to_string());
    }
    if group.items.len() < 2 {
        return Err(format!(
            "Telegram album requires at least 2 items, got {}",
            group.items.len()
        ));
    }
    if group.items.len() > TELEGRAM_ALBUM_MAX {
        return Err(format!(
            "Telegram album exceeds maximum of {} items, got {}",
            TELEGRAM_ALBUM_MAX,
            group.items.len()
        ));
    }

    if !group.as_document && group.payload_class == PayloadClass::NativeVisual {
        for (i, item) in group.items.iter().enumerate() {
            if item.key.payload_class != PayloadClass::NativeVisual {
                return Err(format!(
                    "Item at index {} has incompatible payload class {:?}, expected NativeVisual",
                    i, item.key.payload_class
                ));
            }
            if i > 0 && !item.caption.trim().is_empty() {
                return Err(format!(
                    "Visual album item at index {} has non-empty caption '{}'. Telegram visual albums strictly require empty caption at index > 0 to maintain collage integrity.",
                    i, item.caption
                ));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn items(n: usize, class: PayloadClass) -> Vec<PreparedAlbumItem> {
        (0..n)
            .map(|index| PreparedAlbumItem {
                index,
                path: format!("{index}.dat"),
                caption: String::new(),
                spoiler: false,
                size: 1,
                key: AlbumCompatibilityKey {
                    account_id: "a".into(),
                    peer_id: "p".into(),
                    topic_id: None,
                    reply_to: None,
                    send_as: None,
                    schedule_at: None,
                    silent: false,
                    payload_class: class,
                },
                force_single: false,
            })
            .collect()
    }
    fn options() -> AlbumPlanOptions {
        AlbumPlanOptions {
            enabled: true,
            packing: AlbumPackingPolicy::Maximum,
            custom_size: 10,
            avoid_single_remainder: true,
            group_documents: true,
            group_audio: true,
            group_original_documents: true,
        }
    }
    #[test]
    fn ten_stays_one_album() {
        let p = build_album_plan(items(10, PayloadClass::NativeVisual), &options());
        assert_eq!(
            p.groups.iter().map(|g| g.items.len()).collect::<Vec<_>>(),
            vec![10]
        );
    }

    #[test]
    fn fifteen_items_follow_telegram_maximum_as_ten_plus_five() {
        let p = build_album_plan(items(15, PayloadClass::NativeVisual), &options());
        assert_eq!(
            p.groups
                .iter()
                .map(|group| group.items.len())
                .collect::<Vec<_>>(),
            vec![10, 5]
        );
        assert!(p.singles.is_empty());
    }

    #[test]
    fn sixteen_items_follow_telegram_maximum_as_ten_plus_six() {
        let p = build_album_plan(items(16, PayloadClass::NativeVisual), &options());
        assert_eq!(
            p.groups
                .iter()
                .map(|group| group.items.len())
                .collect::<Vec<_>>(),
            vec![10, 6]
        );
        assert!(p.singles.is_empty());
    }

    #[test]
    fn forced_single_does_not_collapse_other_album_items() {
        let mut input = items(15, PayloadClass::NativeVisual);
        input[9].force_single = true;
        let p = build_album_plan(input, &options());
        assert_eq!(
            p.groups
                .iter()
                .map(|group| group.items.len())
                .collect::<Vec<_>>(),
            vec![9, 5]
        );
        assert_eq!(p.singles.iter().map(|item| item.index).collect::<Vec<_>>(), vec![9]);
    }

    #[test]
    fn unsupported_items_are_hard_boundaries_between_native_albums() {
        let mut input = items(14, PayloadClass::NativeVisual);
        input[3].key.payload_class = PayloadClass::DocumentGroup;
        input[6].key.payload_class = PayloadClass::DocumentGroup;
        let p = build_album_plan(input, &options());
        assert_eq!(
            p.groups.iter().map(|group| group.items.iter().map(|i| i.index).collect::<Vec<_>>()).collect::<Vec<_>>(),
            vec![vec![0, 1, 2], vec![4, 5], vec![7, 8, 9, 10, 11, 12, 13]]
        );
        assert_eq!(p.singles.iter().map(|item| item.index).collect::<Vec<_>>(), vec![3, 6]);
    }

    #[test]
    fn custom_grid_seven_partitions_ten_as_seven_plus_three() {
        let options = AlbumPlanOptions {
            enabled: true,
            packing: AlbumPackingPolicy::Custom,
            custom_size: 7,
            avoid_single_remainder: true,
            group_documents: true,
            group_audio: true,
            group_original_documents: true,
        };
        let plan = build_album_plan(items(10, PayloadClass::NativeVisual), &options);
        assert_eq!(
            plan.groups
                .iter()
                .map(|group| group.items.len())
                .collect::<Vec<_>>(),
            vec![7, 3]
        );
        assert!(plan.singles.is_empty());
    }

    #[test]
    fn every_custom_grid_preserves_items_and_telegram_limits() {
        for grid in 2..=10 {
            for total in 1..=41 {
                let options = AlbumPlanOptions {
                    enabled: true,
                    packing: AlbumPackingPolicy::Custom,
                    custom_size: grid,
                    avoid_single_remainder: true,
                    group_documents: true,
                    group_audio: true,
                    group_original_documents: true,
                };
                let plan = build_album_plan(items(total, PayloadClass::NativeVisual), &options);
                let delivered = plan
                    .groups
                    .iter()
                    .map(|group| group.items.len())
                    .sum::<usize>()
                    + plan.singles.len();
                assert_eq!(delivered, total, "grid={grid} total={total}");
                assert!(plan
                    .groups
                    .iter()
                    .all(|group| (2..=grid).contains(&group.items.len())));
                let unavoidable_single = total == 1 || (grid == 2 && total % 2 == 1);
                assert_eq!(
                    plan.singles.len(),
                    usize::from(unavoidable_single),
                    "grid={grid} total={total}"
                );
            }
        }
    }
    #[test]
    fn eleven_rebalances_to_nine_plus_two() {
        let p = build_album_plan(items(11, PayloadClass::NativeVisual), &options());
        assert_eq!(
            p.groups.iter().map(|g| g.items.len()).collect::<Vec<_>>(),
            vec![9, 2]
        );
        assert!(p.singles.is_empty());
    }
    #[test]
    fn original_never_becomes_visual() {
        let p = build_album_plan(items(3, PayloadClass::OriginalDocumentBatch), &options());
        assert_eq!(p.singles.len(), 3);
        assert!(p.groups.is_empty());
    }

    #[test]
    fn audio_is_sent_separately_even_when_group_toggle_is_on() {
        let p = build_album_plan(items(3, PayloadClass::AudioGroup), &options());
        assert!(p.groups.is_empty());
        assert_eq!(p.singles.len(), 3);
        assert!(p.explanations.iter().any(|reason| reason.contains("AudioGroup")));
    }
    #[test]
    fn contexts_are_never_mixed() {
        let mut input = items(4, PayloadClass::NativeVisual);
        input[3].key.topic_id = Some(9);
        let p = build_album_plan(input, &options());
        assert_eq!(p.groups[0].items.len(), 3);
        assert_eq!(p.singles.len(), 1);
    }

    #[test]
    fn test_album_commit_intent_creation_and_unknown_commit_state() {
        let items_input = items(3, PayloadClass::NativeVisual);
        let plan = build_album_plan(items_input, &options());
        assert!(!plan.groups.is_empty());

        let intent = AlbumCommitIntent::new(
            "commit_logical_12345",
            &plan.groups[0],
            AlbumFailurePolicy::AtomicStrict,
        );

        assert_eq!(intent.logical_commit_id, "commit_logical_12345");
        assert_eq!(intent.state, AlbumCommitState::PendingSend);
        assert_eq!(intent.random_item_ids.len(), 3);

        let mut intent_unknown = intent;
        intent_unknown.mark_unknown_commit("MTProto RPC timeout during sendMultiMedia");
        assert_eq!(intent_unknown.state, AlbumCommitState::UnknownCommit);
        assert!(intent_unknown
            .reconciliation_reason
            .unwrap()
            .contains("RPC timeout"));
    }

    #[test]
    fn test_validate_album_group_invariants_success() {
        let items_input = items(10, PayloadClass::NativeVisual);
        let group = PlannedAlbumGroup {
            items: items_input,
            as_document: false,
            payload_class: PayloadClass::NativeVisual,
        };
        assert!(validate_album_group_invariants(&group).is_ok());
    }

    #[test]
    fn test_validate_album_group_invariants_exceeds_max() {
        let items_input = items(11, PayloadClass::NativeVisual);
        let group = PlannedAlbumGroup {
            items: items_input,
            as_document: false,
            payload_class: PayloadClass::NativeVisual,
        };
        let err = validate_album_group_invariants(&group).unwrap_err();
        assert!(err.contains("exceeds maximum of 10"));
    }

    #[test]
    fn test_validate_album_group_invariants_rejects_subsequent_captions() {
        let mut items_input = items(5, PayloadClass::NativeVisual);
        items_input[0].caption = "Album Summary".into();
        items_input[2].caption = "Spurious Filename Stem".into();
        let group = PlannedAlbumGroup {
            items: items_input,
            as_document: false,
            payload_class: PayloadClass::NativeVisual,
        };
        let err = validate_album_group_invariants(&group).unwrap_err();
        assert!(err.contains("index 2 has non-empty caption"));
        assert!(err.contains("maintain collage integrity"));
    }

    #[test]
    fn test_video_album_fifteen_items_maximum_ten_plus_five() {
        let mut vid_items = items(15, PayloadClass::NativeVisual);
        for item in &mut vid_items {
            item.path = format!("{}.mp4", item.index);
            item.size = (item.index as u64 + 1) * 1024 * 1024;
        }
        let plan = build_album_plan(vid_items, &options());
        assert_eq!(
            plan.groups.iter().map(|g| g.items.len()).collect::<Vec<_>>(),
            vec![10, 5]
        );
        assert!(plan.singles.is_empty());
        // Verify group 0 contains the 10 lightest items
        assert_eq!(plan.groups[0].items.len(), 10);
        assert!(plan.groups[0].items.iter().all(|i| i.size <= 10 * 1024 * 1024));
        // Verify group 1 contains the 5 heavier items
        assert_eq!(plan.groups[1].items.len(), 5);
        assert!(plan.groups[1].items.iter().all(|i| i.size > 10 * 1024 * 1024));
    }

    #[test]
    fn test_video_album_seventeen_items_maximum_ten_plus_seven() {
        let mut vid_items = items(17, PayloadClass::NativeVisual);
        for item in &mut vid_items {
            item.path = format!("{}.mp4", item.index);
            item.size = (item.index as u64 + 1) * 1024 * 1024;
        }
        let plan = build_album_plan(vid_items, &options());
        assert_eq!(
            plan.groups.iter().map(|g| g.items.len()).collect::<Vec<_>>(),
            vec![10, 7]
        );
        assert!(plan.singles.is_empty());
        assert_eq!(plan.groups[0].items.len(), 10);
        assert_eq!(plan.groups[1].items.len(), 7);
    }

    #[test]
    fn test_video_album_thirteen_items_maximum_ten_plus_three() {
        let mut vid_items = items(13, PayloadClass::NativeVisual);
        for item in &mut vid_items {
            item.path = format!("{}.mp4", item.index);
            item.size = (item.index as u64 + 1) * 1024 * 1024;
        }
        let plan = build_album_plan(vid_items, &options());
        assert_eq!(
            plan.groups.iter().map(|g| g.items.len()).collect::<Vec<_>>(),
            vec![10, 3]
        );
        assert!(plan.singles.is_empty());
        assert_eq!(plan.groups[0].items.len(), 10);
        assert_eq!(plan.groups[1].items.len(), 3);
    }

    #[test]
    fn test_all_counts_from_two_to_fifty_form_valid_unbroken_collages() {
        for n in 2..=50 {
            let mut vid_items = items(n, PayloadClass::NativeVisual);
            for item in &mut vid_items {
                item.path = format!("{}.mp4", item.index);
                item.size = (item.index as u64 + 1) * 1024 * 1024;
            }
            let plan = build_album_plan(vid_items, &options());
            // Invariant 1: Zero singles (no file is ever detached or left behind)
            assert!(
                plan.singles.is_empty(),
                "Count {} produced singles! Singles: {:?}",
                n,
                plan.singles.len()
            );
            // Invariant 2: Total items across all groups equals n (zero lost items)
            let total_grouped: usize = plan.groups.iter().map(|g| g.items.len()).sum();
            assert_eq!(
                total_grouped, n,
                "Count {} total items mismatch: expected {}, got {}",
                n, n, total_grouped
            );
            // Invariant 3: Every group is between 2 and 10 items (valid Telegram collage)
            for (idx, group) in plan.groups.iter().enumerate() {
                assert!(
                    group.items.len() >= 2,
                    "Count {} group {} has < 2 items ({})!",
                    n, idx, group.items.len()
                );
                assert!(
                    group.items.len() <= 10,
                    "Count {} group {} exceeds 10 items ({})!",
                    n, idx, group.items.len()
                );
            }
        }
    }

    #[test]
    fn test_video_album_ten_heavy_items_balanced_five_plus_five() {
        let mut vid_items = items(10, PayloadClass::NativeVisual);
        for item in &mut vid_items {
            item.path = format!("{}.mp4", item.index);
            item.size = 10 * 1024 * 1024; // 10MB each
        }
        let plan = build_album_plan(vid_items, &options());
        assert_eq!(
            plan.groups.iter().map(|g| g.items.len()).collect::<Vec<_>>(),
            vec![5, 5]
        );
        assert!(plan.singles.is_empty());
    }

    #[test]
    fn test_video_album_nine_items_stays_nine() {
        let mut vid_items = items(9, PayloadClass::NativeVisual);
        for item in &mut vid_items {
            item.path = format!("{}.mp4", item.index);
            item.size = 3 * 1024 * 1024; // 3MB each
        }
        let plan = build_album_plan(vid_items, &options());
        assert_eq!(
            plan.groups.iter().map(|g| g.items.len()).collect::<Vec<_>>(),
            vec![9]
        );
        assert!(plan.singles.is_empty());
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlbumCommitState {
    PendingSend,
    SentConfirmed,
    UnknownCommit,
    ReconciledPass,
    ReconciledFail,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumCommitIntent {
    pub logical_commit_id: String,
    pub payload_class: PayloadClass,
    pub item_count: usize,
    pub random_item_ids: Vec<i64>,
    pub failure_policy: AlbumFailurePolicy,
    pub state: AlbumCommitState,
    pub reconciliation_reason: Option<String>,
}

impl AlbumCommitIntent {
    pub fn new(
        logical_commit_id: impl Into<String>,
        group: &PlannedAlbumGroup,
        failure_policy: AlbumFailurePolicy,
    ) -> Self {
        let count = group.items.len();
        let random_ids: Vec<i64> = (0..count).map(|i| (i as i64 + 1) * 100_000 + 42).collect();

        AlbumCommitIntent {
            logical_commit_id: logical_commit_id.into(),
            payload_class: group.payload_class,
            item_count: count,
            random_item_ids: random_ids,
            failure_policy,
            state: AlbumCommitState::PendingSend,
            reconciliation_reason: None,
        }
    }

    pub fn mark_unknown_commit(&mut self, reason: impl Into<String>) {
        self.state = AlbumCommitState::UnknownCommit;
        self.reconciliation_reason = Some(reason.into());
    }
}
