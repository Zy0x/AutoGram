use super::quality::PayloadClass;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

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

fn groupable(class: PayloadClass, options: &AlbumPlanOptions) -> bool {
    match class {
        PayloadClass::NativeVisual => true,
        PayloadClass::DocumentGroup | PayloadClass::SplitPartBatch => options.group_documents,
        PayloadClass::AudioGroup => options.group_audio,
        PayloadClass::OriginalDocumentBatch => options.group_original_documents,
    }
}

pub fn build_album_plan(items: Vec<PreparedAlbumItem>, options: &AlbumPlanOptions) -> AlbumPlan {
    let mut plan = AlbumPlan::default();
    if !options.enabled || options.packing == AlbumPackingPolicy::Never {
        plan.singles = items;
        plan.explanations.push("album_disabled".into());
        return plan;
    }
    let mut buckets: BTreeMap<AlbumCompatibilityKey, Vec<PreparedAlbumItem>> = BTreeMap::new();
    for item in items {
        buckets.entry(item.key.clone()).or_default().push(item);
    }
    let target = target_size(options.packing, options.custom_size);
    for (key, mut bucket) in buckets {
        bucket.sort_by_key(|item| item.index);
        if !groupable(key.payload_class, options) {
            plan.singles.extend(bucket);
            plan.explanations
                .push(format!("payload_not_groupable:{:?}", key.payload_class));
            continue;
        }
        let sizes = partition_sizes(bucket.len(), target, options.avoid_single_remainder);
        let mut cursor = 0usize;
        for size in sizes {
            let end = cursor + size;
            let chunk = bucket[cursor..end].to_vec();
            cursor = end;
            if chunk.len() == 1 {
                plan.singles.extend(chunk);
            } else {
                plan.groups.push(PlannedAlbumGroup {
                    items: chunk,
                    as_document: key.payload_class != PayloadClass::NativeVisual,
                    payload_class: key.payload_class,
                });
            }
        }
    }
    plan.groups
        .sort_by_key(|g| g.items.first().map(|i| i.index).unwrap_or(usize::MAX));
    plan.singles.sort_by_key(|i| i.index);
    plan
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
        assert!(p.groups[0].as_document);
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
