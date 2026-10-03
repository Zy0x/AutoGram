//! Stable media-list IPC contracts and pure two-lane frontier policy.
use serde::{Deserialize, Serialize};

/// Drive-compatible media row (subset of frontend DriveFile).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFileRow {
    pub id: i64,
    pub folder_id: Option<i64>,
    pub name: String,
    pub size: u64,
    pub mime_type: Option<String>,
    pub icon_type: String,
    pub created_at: Option<String>,
    pub has_thumb: bool,
    pub as_document: bool,
    pub backend: String,
    /// Inline stripped thumb (data:image/…) — paints grid without a second RPC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumb_data_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub topic_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peer_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peer_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peer_username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grouped_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_saved_messages: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub telegram_category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub telegram_subtype: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drive_category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drive_format: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchScope {
    pub account_id: String,
    pub peer_id: String,
    pub topic_id: Option<i64>,
    #[serde(default)]
    pub min_id: i32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneCursor {
    #[serde(alias = "offset_id")]
    pub fetch_offset_id: i32,
    pub exhausted: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneWatermark {
    pub photo_video: i32,
    pub document: i32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SearchLane {
    #[default]
    PhotoVideo,
    Document,
    Both,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedMediaRow {
    pub row: MediaFileRow,
    pub lane: SearchLane,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopedMediaSearchCursor {
    pub scope: SearchScope,
    pub photo_video: LaneCursor,
    pub document: LaneCursor,
    #[serde(default)]
    pub pending_photo_video: Vec<MediaFileRow>,
    #[serde(default)]
    pub pending_document: Vec<MediaFileRow>,
}

pub fn normalize_search_cursor(
    incoming: Option<ScopedMediaSearchCursor>,
    scope: &SearchScope,
    initial_offset: i32,
) -> ScopedMediaSearchCursor {
    match incoming {
        Some(c) if c.scope == *scope => c,
        _ => ScopedMediaSearchCursor {
            scope: scope.clone(),
            photo_video: LaneCursor {
                fetch_offset_id: initial_offset,
                exhausted: false,
            },
            document: LaneCursor {
                fetch_offset_id: initial_offset,
                exhausted: false,
            },
            pending_photo_video: Vec::new(),
            pending_document: Vec::new(),
        },
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrontierStep {
    EmitPv,
    EmitDoc,
    EmitBoth,
    FetchPv,
    FetchDoc,
    FetchBoth,
    Finished,
}

/// Evaluates the provably safe next action based on known pending lane heads and fetch frontiers.
pub fn evaluate_frontier_step(
    pending_pv: &[MediaFileRow],
    pending_doc: &[MediaFileRow],
    pv_offset: i32,
    doc_offset: i32,
    pv_exhausted: bool,
    doc_exhausted: bool,
) -> FrontierStep {
    let head_pv = pending_pv.first();
    let head_doc = pending_doc.first();

    match (head_pv, head_doc) {
        // Case 1: Both heads known
        (Some(pv), Some(doc)) => {
            if pv.id > doc.id {
                FrontierStep::EmitPv
            } else if doc.id > pv.id {
                FrontierStep::EmitDoc
            } else {
                FrontierStep::EmitBoth
            }
        }
        // Case 2: PV head known, DOC buffer empty
        (Some(pv), None) => {
            if doc_exhausted {
                // DOC is completely exhausted -> PV is provably safe to emit
                FrontierStep::EmitPv
            } else if doc_offset == 0 {
                // DOC has never been fetched -> frontier is UNKNOWN -> MUST FETCH DOC
                FrontierStep::FetchDoc
            } else if (pv.id as i32) > doc_offset {
                // STRICT inequality: PV is strictly newer than any potential unseen DOC
                FrontierStep::EmitPv
            } else {
                // pv.id <= doc_offset -> unseen DOC could have higher ID -> MUST FETCH DOC
                FrontierStep::FetchDoc
            }
        }
        // Case 3: DOC head known, PV buffer empty
        (None, Some(doc)) => {
            if pv_exhausted {
                // PV is completely exhausted -> DOC is provably safe to emit
                FrontierStep::EmitDoc
            } else if pv_offset == 0 {
                // PV has never been fetched -> frontier is UNKNOWN -> MUST FETCH PV
                FrontierStep::FetchPv
            } else if (doc.id as i32) > pv_offset {
                // STRICT inequality: DOC is strictly newer than any potential unseen PV
                FrontierStep::EmitDoc
            } else {
                // doc.id <= pv_offset -> unseen PV could have higher ID -> MUST FETCH PV
                FrontierStep::FetchPv
            }
        }
        // Case 4: Both buffers empty
        (None, None) => {
            if pv_exhausted && doc_exhausted {
                FrontierStep::Finished
            } else if !pv_exhausted && !doc_exhausted {
                FrontierStep::FetchBoth
            } else if !pv_exhausted {
                FrontierStep::FetchPv
            } else {
                FrontierStep::FetchDoc
            }
        }
    }
}

/// Drains as many provably ordered items as possible from pending buffers into `emitted`.
/// Stops when `emitted.len() >= limit` OR when a lane must be fetched to prove the next item.
pub fn drain_provably_safe_frontier(
    pending_pv: &mut Vec<MediaFileRow>,
    pending_doc: &mut Vec<MediaFileRow>,
    pv_offset: i32,
    doc_offset: i32,
    pv_exhausted: bool,
    doc_exhausted: bool,
    limit: usize,
    emitted: &mut Vec<MergedMediaRow>,
) -> FrontierStep {
    // Keep pending buffers sorted descending by id
    pending_pv.sort_by(|a, b| b.id.cmp(&a.id));
    pending_doc.sort_by(|a, b| b.id.cmp(&a.id));

    let mut pv_idx = 0usize;
    let mut doc_idx = 0usize;

    let final_step = loop {
        if emitted.len() >= limit {
            break FrontierStep::Finished;
        }

        let head_pv = pending_pv.get(pv_idx);
        let head_doc = pending_doc.get(doc_idx);

        let step = match (head_pv, head_doc) {
            (Some(pv), Some(doc)) => {
                if pv.id > doc.id {
                    FrontierStep::EmitPv
                } else if doc.id > pv.id {
                    FrontierStep::EmitDoc
                } else {
                    FrontierStep::EmitBoth
                }
            }
            (Some(pv), None) => {
                if doc_exhausted {
                    FrontierStep::EmitPv
                } else if doc_offset == 0 {
                    FrontierStep::FetchDoc
                } else if (pv.id as i32) > doc_offset {
                    FrontierStep::EmitPv
                } else {
                    FrontierStep::FetchDoc
                }
            }
            (None, Some(doc)) => {
                if pv_exhausted {
                    FrontierStep::EmitDoc
                } else if pv_offset == 0 {
                    FrontierStep::FetchPv
                } else if (doc.id as i32) > pv_offset {
                    FrontierStep::EmitDoc
                } else {
                    FrontierStep::FetchPv
                }
            }
            (None, None) => {
                if pv_exhausted && doc_exhausted {
                    FrontierStep::Finished
                } else if !pv_exhausted && !doc_exhausted {
                    FrontierStep::FetchBoth
                } else if !pv_exhausted {
                    FrontierStep::FetchPv
                } else {
                    FrontierStep::FetchDoc
                }
            }
        };

        match step {
            FrontierStep::EmitPv => {
                let pv = &pending_pv[pv_idx];
                emitted.push(MergedMediaRow {
                    row: pv.clone(),
                    lane: SearchLane::PhotoVideo,
                });
                pv_idx += 1;
            }
            FrontierStep::EmitDoc => {
                let doc = &pending_doc[doc_idx];
                emitted.push(MergedMediaRow {
                    row: doc.clone(),
                    lane: SearchLane::Document,
                });
                doc_idx += 1;
            }
            FrontierStep::EmitBoth => {
                let pv = &pending_pv[pv_idx];
                emitted.push(MergedMediaRow {
                    row: pv.clone(),
                    lane: SearchLane::Both,
                });
                pv_idx += 1;
                doc_idx += 1;
            }
            fetch_or_finish => break fetch_or_finish,
        }
    };

    if pv_idx > 0 {
        pending_pv.drain(..pv_idx);
    }
    if doc_idx > 0 {
        pending_doc.drain(..doc_idx);
    }

    final_step
}

/// Merges two descending streams of `MediaFileRow` (pending_photo_video and pending_document),
/// extracts up to `limit` unique items descending by `message_id`, inherently pops matching
/// duplicates from both lane heads simultaneously to guarantee zero duplicate across page boundaries,
/// and retains any surplus items in their respective pending buffers without losing any data.
pub fn buffered_k_way_merge(
    pending_pv: &mut Vec<MediaFileRow>,
    pending_doc: &mut Vec<MediaFileRow>,
    limit: usize,
) -> Vec<MergedMediaRow> {
    let mut emitted = Vec::with_capacity(limit);

    // Keep pending buffers sorted descending by id
    pending_pv.sort_by(|a, b| b.id.cmp(&a.id));
    pending_doc.sort_by(|a, b| b.id.cmp(&a.id));

    let mut pv_idx = 0usize;
    let mut doc_idx = 0usize;
    let pv_len = pending_pv.len();
    let doc_len = pending_doc.len();

    while emitted.len() < limit && (pv_idx < pv_len || doc_idx < doc_len) {
        let pv_item = pending_pv.get(pv_idx);
        let doc_item = pending_doc.get(doc_idx);

        match (pv_item, doc_item) {
            (Some(pv), Some(doc)) if pv.id == doc.id => {
                // Inherent dual-lane pop: consume both heads at once so identical ID is NEVER
                // retained in the secondary buffer across page boundaries!
                emitted.push(MergedMediaRow {
                    row: pv.clone(),
                    lane: SearchLane::Both,
                });
                pv_idx += 1;
                doc_idx += 1;
            }
            (Some(pv), Some(doc)) if pv.id > doc.id => {
                emitted.push(MergedMediaRow {
                    row: pv.clone(),
                    lane: SearchLane::PhotoVideo,
                });
                pv_idx += 1;
            }
            (Some(_), Some(doc)) => {
                emitted.push(MergedMediaRow {
                    row: doc.clone(),
                    lane: SearchLane::Document,
                });
                doc_idx += 1;
            }
            (Some(pv), None) => {
                emitted.push(MergedMediaRow {
                    row: pv.clone(),
                    lane: SearchLane::PhotoVideo,
                });
                pv_idx += 1;
            }
            (None, Some(doc)) => {
                emitted.push(MergedMediaRow {
                    row: doc.clone(),
                    lane: SearchLane::Document,
                });
                doc_idx += 1;
            }
            (None, None) => break,
        }
    }

    if pv_idx > 0 {
        pending_pv.drain(..pv_idx);
    }
    if doc_idx > 0 {
        pending_doc.drain(..doc_idx);
    }

    emitted
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneCounts {
    pub photo_video: Option<usize>,
    pub document: Option<usize>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneDurability {
    pub photo_video_drained: bool,
    pub document_drained: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneRpcObservation {
    pub lane: SearchLane,
    pub latency_ms: u64,      // Pure MTProto network invocation latency
    pub wall_latency_ms: u64, // Full end-to-end wall latency including queue/pacing
    pub attempts: u32,
    pub rows_received: usize,
    pub candidate_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMediaResult {
    pub status: String,
    pub folder_id: Option<i64>,
    pub files: Vec<MediaFileRow>,
    pub total: usize,
    pub page_size: usize,
    pub has_more: bool,
    pub next_offset_id: Option<i64>,
    pub search_cursor: Option<ScopedMediaSearchCursor>,
    pub lane_counts: Option<LaneCounts>,
    pub emitted_watermark: Option<LaneWatermark>,
    pub lane_durability: Option<LaneDurability>,
    pub total_count: Option<usize>,
    pub backend: String,
    pub cached: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rpc_observations: Vec<LaneRpcObservation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pv_observation: Option<LaneRpcObservation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_observation: Option<LaneRpcObservation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderChunkPayload {
    pub request_id: String,
    pub folder_id: Option<i64>,
    pub topic_id: Option<i64>,
    pub files: Vec<MediaFileRow>,
    pub next_offset_id: Option<i64>,
    pub has_more: bool,
    pub is_initial_chunk: bool,
    pub total_count: Option<usize>,
}
