//! Submodule for category-filtered and dual-perspective (Telegram & Drive) media queries.

use std::path::Path;
use std::time::Instant;

use crate::core::telegram_ops::TelegramIdentity;
use crate::core::tg_error::TgError;

use super::super::client_pool::{ensure_authorized, with_client, with_pool_retry};
use super::super::peer_resolver::resolve_peer;
use super::super::session_auth::runtime;
use super::{
    tl_link_to_row, tl_message_to_row, LaneRpcObservation, ListMediaResult, MediaFileRow,
    SearchLane, BACKEND,
};

/// Pure predicate checking whether a classified `MediaFileRow` belongs to a requested
/// Telegram-perspective or Drive-perspective filter key.
pub fn row_matches_filtered_query(row: &MediaFileRow, filter_key: &str) -> bool {
    let key = filter_key.trim().to_ascii_lowercase();
    let tg_cat = row
        .telegram_category
        .as_deref()
        .unwrap_or("")
        .to_ascii_lowercase();
    let tg_sub = row
        .telegram_subtype
        .as_deref()
        .unwrap_or("")
        .to_ascii_lowercase();
    let dr_cat = row
        .drive_category
        .as_deref()
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = row.mime_type.as_deref().unwrap_or("").to_ascii_lowercase();
    let icon = row.icon_type.to_ascii_lowercase();

    match key.as_str() {
        "stickers" | "sticker" => tg_cat == "sticker",
        "gifs" | "gif" => tg_cat != "sticker" && (tg_cat == "gif" || icon == "gif" || mime == "image/gif"),
        "links" | "link" | "url" | "urls" | "web" => {
            tg_cat == "link" || dr_cat == "web" || icon == "link" || mime == "text/x-url"
        }
        "files" | "file" => {
            tg_cat != "sticker"
                && tg_cat != "gif"
                && tg_cat != "link"
                && tg_cat != "restricted"
                && icon != "gif"
                && icon != "link"
                && (row.as_document || tg_cat == "file" || dr_cat == "document" || dr_cat == "archive")
        }
        "documents" | "document" => {
            tg_cat != "sticker"
                && tg_cat != "gif"
                && tg_cat != "link"
                && dr_cat == "document"
        }
        "archives" | "archive" => {
            tg_cat != "sticker"
                && tg_cat != "gif"
                && tg_cat != "link"
                && dr_cat == "archive"
        }
        "images" | "image" => {
            tg_cat != "sticker"
                && (dr_cat == "image"
                    || dr_cat == "animation"
                    || mime.starts_with("image/")
                    || icon == "image"
                    || icon == "photo")
        }
        "photos" | "photo" => tg_cat != "sticker" && !row.as_document && (icon == "image" || icon == "photo"),
        "videos" | "video" => {
            tg_cat != "sticker"
                && tg_cat != "gif"
                && icon != "gif"
                && (dr_cat == "video" || mime.starts_with("video/") || icon == "video")
        }
        "audio" | "music" => {
            tg_cat != "sticker"
                && (tg_cat == "audio"
                    || dr_cat == "audio"
                    || mime.starts_with("audio/")
                    || icon == "audio"
                    || icon == "voice")
        }
        "voice" => tg_sub == "voice" || icon == "voice" || mime == "audio/ogg",
        "media" | "photo_video" | "photovideo" => {
            tg_cat != "sticker"
                && tg_cat != "file"
                && tg_cat != "link"
                && (!row.as_document || tg_cat == "gif" || icon == "gif")
                && (tg_cat == "media"
                    || tg_cat == "gif"
                    || icon == "gif"
                    || icon == "image"
                    || icon == "photo"
                    || icon == "video")
        }
        _ => tg_cat != "sticker",
    }
}

fn unpack_tl_messages(
    value: grammers_client::tl::enums::messages::Messages,
) -> (Vec<grammers_client::tl::enums::Message>, Option<usize>) {
    match value {
        grammers_client::tl::enums::messages::Messages::Messages(v) => (v.messages, None),
        grammers_client::tl::enums::messages::Messages::Slice(v) => {
            (v.messages, Some(v.count.max(0) as usize))
        }
        grammers_client::tl::enums::messages::Messages::ChannelMessages(v) => {
            (v.messages, Some(v.count.max(0) as usize))
        }
        grammers_client::tl::enums::messages::Messages::NotModified(_) => (Vec::new(), None),
    }
}

fn lowest_tl_message_id(messages: &[grammers_client::tl::enums::Message]) -> Option<i64> {
    messages
        .iter()
        .filter_map(|message| match message {
            grammers_client::tl::enums::Message::Message(value) => Some(value.id as i64),
            _ => None,
        })
        .min()
}

/// Reconciles candidate rows across multiple composite search lanes using the
/// unexhausted frontier (`unexhausted_frontier`) so that pagination cursors
/// never jump past unseen items in a denser unexhausted lane.
pub fn reconcile_composite_lane_page(
    mut candidates: Vec<MediaFileRow>,
    unexhausted_frontier: Option<i64>,
    max_lowest_id: Option<i64>,
    any_lane_has_more: bool,
    limit: usize,
) -> (Vec<MediaFileRow>, Option<i64>, bool) {
    candidates.sort_by(|a, b| b.id.cmp(&a.id));
    candidates.dedup_by_key(|r| r.id);

    if let Some(frontier_id) = unexhausted_frontier.filter(|_| any_lane_has_more) {
        let mut safe_candidates: Vec<MediaFileRow> = candidates
            .into_iter()
            .filter(|r| r.id >= frontier_id)
            .collect();

        if safe_candidates.len() > limit {
            safe_candidates.truncate(limit);
            let next_offset = safe_candidates.last().map(|r| r.id).or(Some(frontier_id));
            let has_more = next_offset.unwrap_or(0) > 1;
            return (safe_candidates, next_offset, has_more);
        }

        let next_offset = Some(frontier_id);
        let has_more = frontier_id > 1;
        return (safe_candidates, next_offset, has_more);
    }

    let mut has_more = any_lane_has_more;
    if candidates.len() > limit {
        has_more = true;
        candidates.truncate(limit);
    }
    let next_offset = candidates.last().map(|r| r.id).or(max_lowest_id);
    let has_more = has_more && next_offset.unwrap_or(0) > 1;
    (candidates, next_offset, has_more)
}

pub fn list_filtered_media_blocking_topic(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    filter_type: &str,
    limit: usize,
    offset_id: Option<i64>,
    topic_id: Option<i64>,
) -> Result<ListMediaResult, TgError> {
    let rt = runtime()?;
    let limit = limit.clamp(1, 100);
    let chat = chat_id.to_string();
    let folder_id = if chat.eq_ignore_ascii_case("me") || chat == "0" {
        None
    } else {
        chat.parse().ok()
    };
    let session_name = identity.session.clone();
    let filter_str = filter_type.trim().to_ascii_lowercase();

    rt.block_on(async {
        with_pool_retry(&identity.session, || {
            let chat = chat.clone();
            let session_name = session_name.clone();
            let filter_str = filter_str.clone();
            with_client(sessions_dir, identity, true, move |client| {
                Box::pin(async move {
                    ensure_authorized(client, &session_name).await?;
                    let peer = resolve_peer(client, &chat).await?;
                    let input_peer: grammers_client::tl::enums::InputPeer = (&peer).into();
                    let top_msg_id = topic_id.filter(|v| *v > 0).map(|v| v as i32);
                    let init_offset = offset_id.unwrap_or(0) as i32;
                    let guard = crate::core::telegram_rpc_guard::RpcGuardControl::default();
                    let started = Instant::now();

                    // 0. Direct Single-Message / Window Lookup ("message_lookup")
                    // Resolves any message ID (Photo, Video, Document, GIF, Sticker, Audio, Voice, Link)
                    // within a forum topic or chat history in 1 lightweight RPC.
                    if filter_str == "message_lookup" {
                        let raw_request_limit = (limit.max(10) as i32).min(40);
                        let mut files: Vec<MediaFileRow> = Vec::new();
                        let mut total_latency_ms = 0u64;
                        let mut total_attempts = 0u32;
                        let mut lowest_id: Option<i64> = None;

                        if let Some(tid) = top_msg_id {
                            let req = grammers_client::tl::functions::messages::GetReplies {
                                peer: input_peer.clone(),
                                msg_id: tid,
                                offset_id: init_offset,
                                offset_date: 0,
                                add_offset: 0,
                                limit: raw_request_limit,
                                max_id: 0,
                                min_id: 0,
                                hash: 0,
                            };
                            if let Ok(response) =
                                crate::core::telegram_rpc_guard::invoke_guarded_with_control(
                                    &session_name,
                                    crate::core::session_rate::RpcClass::IndexSearch,
                                    "messages.getReplies.message_lookup",
                                    &guard,
                                    || client.invoke(&req),
                                )
                                .await
                            {
                                total_latency_ms += response.latency_ms;
                                total_attempts += response.attempts;
                                let (messages, _) = unpack_tl_messages(response.value);
                                lowest_id = lowest_tl_message_id(&messages);
                                for m in &messages {
                                    if let Some(row) = tl_message_to_row(m, folder_id)
                                        .or_else(|| tl_link_to_row(m, folder_id))
                                    {
                                        files.push(row);
                                    }
                                }
                            }
                        }

                        if files.is_empty() {
                            let req = grammers_client::tl::functions::messages::GetHistory {
                                peer: input_peer,
                                offset_id: init_offset,
                                offset_date: 0,
                                add_offset: 0,
                                limit: raw_request_limit,
                                max_id: 0,
                                min_id: 0,
                                hash: 0,
                            };
                            if let Ok(response) =
                                crate::core::telegram_rpc_guard::invoke_guarded_with_control(
                                    &session_name,
                                    crate::core::session_rate::RpcClass::IndexSearch,
                                    "messages.getHistory.message_lookup",
                                    &guard,
                                    || client.invoke(&req),
                                )
                                .await
                            {
                                total_latency_ms += response.latency_ms;
                                total_attempts += response.attempts;
                                let (messages, _) = unpack_tl_messages(response.value);
                                lowest_id = lowest_tl_message_id(&messages).or(lowest_id);
                                for m in &messages {
                                    if let Some(row) = tl_message_to_row(m, folder_id)
                                        .or_else(|| tl_link_to_row(m, folder_id))
                                    {
                                        files.push(row);
                                    }
                                }
                            }
                        }

                        files.sort_by(|a, b| b.id.cmp(&a.id));
                        files.dedup_by_key(|r| r.id);
                        let observation = LaneRpcObservation {
                            lane: SearchLane::Both,
                            latency_ms: total_latency_ms,
                            wall_latency_ms: started.elapsed().as_millis() as u64,
                            attempts: total_attempts.max(1),
                            rows_received: files.len(),
                            candidate_count: None,
                        };
                        return Ok(ListMediaResult {
                            status: "ok".into(),
                            folder_id,
                            total: files.len(),
                            page_size: limit,
                            has_more: false,
                            next_offset_id: lowest_id,
                            search_cursor: None,
                            lane_counts: None,
                            emitted_watermark: None,
                            lane_durability: None,
                            total_count: None,
                            backend: BACKEND.into(),
                            cached: false,
                            files,
                            rpc_observations: vec![observation],
                            pv_observation: None,
                            doc_observation: None,
                        });
                    }

                    // 1. Sticker Bounded Multi-Batch Window Scan
                    if filter_str == "stickers" || filter_str == "sticker" {
                        let raw_request_limit = (limit.max(100) as i32).min(100);
                        let mut scan_offset = init_offset;
                        let mut files: Vec<MediaFileRow> = Vec::new();
                        let mut batches_scanned = 0usize;
                        let mut last_lowest_id: Option<i64> = None;
                        let mut raw_stream_has_more = false;
                        let mut total_latency_ms = 0u64;
                        let mut total_attempts = 0u32;

                        // Scan up to 4 batches (400 messages) when no stickers have been found yet,
                        // or up to 2 batches once stickers are found while below `limit`.
                        while batches_scanned < 4
                            && (files.is_empty() || (files.len() < limit && batches_scanned < 2))
                        {
                            batches_scanned += 1;
                            let response = if let Some(tid) = top_msg_id {
                                let req = grammers_client::tl::functions::messages::GetReplies {
                                    peer: input_peer.clone(),
                                    msg_id: tid,
                                    offset_id: scan_offset,
                                    offset_date: 0,
                                    add_offset: 0,
                                    limit: raw_request_limit,
                                    max_id: 0,
                                    min_id: 0,
                                    hash: 0,
                                };
                                crate::core::telegram_rpc_guard::invoke_guarded_with_control(
                                    &session_name,
                                    crate::core::session_rate::RpcClass::IndexSearch,
                                    "messages.getReplies.stickers",
                                    &guard,
                                    || client.invoke(&req),
                                )
                                .await?
                            } else {
                                let req = grammers_client::tl::functions::messages::GetHistory {
                                    peer: input_peer.clone(),
                                    offset_id: scan_offset,
                                    offset_date: 0,
                                    add_offset: 0,
                                    limit: raw_request_limit,
                                    max_id: 0,
                                    min_id: 0,
                                    hash: 0,
                                };
                                crate::core::telegram_rpc_guard::invoke_guarded_with_control(
                                    &session_name,
                                    crate::core::session_rate::RpcClass::IndexSearch,
                                    "messages.getHistory.stickers",
                                    &guard,
                                    || client.invoke(&req),
                                )
                                .await?
                            };
                            total_latency_ms += response.latency_ms;
                            total_attempts += response.attempts;

                            let (messages, _) = unpack_tl_messages(response.value);
                            let raw_len = messages.len();
                            let lowest_id = lowest_tl_message_id(&messages);
                            if let Some(lid) = lowest_id {
                                last_lowest_id = Some(lid);
                            }
                            for m in &messages {
                                if let Some(row) = tl_message_to_row(m, folder_id) {
                                    if row_matches_filtered_query(&row, &filter_str) {
                                        files.push(row);
                                    }
                                }
                            }
                            raw_stream_has_more =
                                raw_len >= raw_request_limit as usize && lowest_id.unwrap_or(0) > 1;
                            if !raw_stream_has_more {
                                break;
                            }
                            let next_scan = lowest_id.unwrap_or(0) as i32;
                            if next_scan <= 1 || next_scan == scan_offset {
                                raw_stream_has_more = false;
                                break;
                            }
                            scan_offset = next_scan;
                        }

                        files.sort_by(|a, b| b.id.cmp(&a.id));
                        files.dedup_by_key(|r| r.id);
                        let observation = LaneRpcObservation {
                            lane: SearchLane::Both,
                            latency_ms: total_latency_ms,
                            wall_latency_ms: started.elapsed().as_millis() as u64,
                            attempts: total_attempts.max(1),
                            rows_received: files.len(),
                            candidate_count: None,
                        };
                        return Ok(ListMediaResult {
                            status: "ok".into(),
                            folder_id,
                            total: files.len(),
                            page_size: limit,
                            has_more: raw_stream_has_more,
                            next_offset_id: last_lowest_id,
                            search_cursor: None,
                            lane_counts: None,
                            emitted_watermark: None,
                            lane_durability: None,
                            total_count: None,
                            backend: BACKEND.into(),
                            cached: false,
                            files,
                            rpc_observations: vec![observation],
                            pv_observation: None,
                            doc_observation: None,
                        });
                    }

                    // 2. Drive Document Subcategories ("documents" / "archives")
                    // Because InputMessagesFilterDocument returns all document types (including
                    // uncompressed photos/videos sent as files), scan up to 3 bounded pages
                    // so archives/documents are not hidden behind image-documents.
                    if matches!(
                        filter_str.as_str(),
                        "documents" | "document" | "archives" | "archive"
                    ) {
                        let page_fetch_limit = (limit.max(100) as i32).min(100);
                        let mut scan_offset = init_offset;
                        let mut collected: Vec<MediaFileRow> = Vec::new();
                        let mut pages_scanned = 0usize;
                        let mut last_lowest_id: Option<i64> = None;
                        let mut raw_stream_has_more = false;
                        let mut total_latency_ms = 0u64;
                        let mut total_attempts = 0u32;

                        while collected.len() < limit && pages_scanned < 3 {
                            pages_scanned += 1;
                            let request = grammers_client::tl::functions::messages::Search {
                                peer: input_peer.clone(),
                                q: String::new(),
                                from_id: None,
                                saved_peer_id: None,
                                saved_reaction: None,
                                top_msg_id,
                                filter: grammers_client::tl::enums::MessagesFilter::InputMessagesFilterDocument,
                                min_date: 0,
                                max_date: 0,
                                offset_id: scan_offset,
                                add_offset: 0,
                                limit: page_fetch_limit,
                                max_id: 0,
                                min_id: 0,
                                hash: 0,
                            };
                            let response =
                                crate::core::telegram_rpc_guard::invoke_guarded_with_control(
                                    &session_name,
                                    crate::core::session_rate::RpcClass::IndexSearch,
                                    "messages.search.document_subcategory",
                                    &guard,
                                    || client.invoke(&request),
                                )
                                .await?;
                            total_latency_ms += response.latency_ms;
                            total_attempts += response.attempts;

                            let (messages, _) = unpack_tl_messages(response.value);
                            let raw_len = messages.len();
                            let lowest_id = lowest_tl_message_id(&messages);
                            if let Some(lid) = lowest_id {
                                last_lowest_id = Some(lid);
                            }
                            for m in &messages {
                                if let Some(row) = tl_message_to_row(m, folder_id) {
                                    if row_matches_filtered_query(&row, &filter_str) {
                                        collected.push(row);
                                    }
                                }
                            }
                            raw_stream_has_more =
                                raw_len >= page_fetch_limit as usize && lowest_id.unwrap_or(0) > 1;
                            if !raw_stream_has_more {
                                break;
                            }
                            let next_scan = lowest_id.unwrap_or(0) as i32;
                            if next_scan <= 1 || next_scan == scan_offset {
                                raw_stream_has_more = false;
                                break;
                            }
                            scan_offset = next_scan;
                        }

                        collected.sort_by(|a, b| b.id.cmp(&a.id));
                        collected.dedup_by_key(|r| r.id);
                        let total_count = if !raw_stream_has_more && init_offset == 0 {
                            Some(collected.len())
                        } else {
                            None
                        };
                        let observation = LaneRpcObservation {
                            lane: SearchLane::Document,
                            latency_ms: total_latency_ms,
                            wall_latency_ms: started.elapsed().as_millis() as u64,
                            attempts: total_attempts.max(1),
                            rows_received: collected.len(),
                            candidate_count: total_count,
                        };
                        return Ok(ListMediaResult {
                            status: "ok".into(),
                            folder_id,
                            total: collected.len(),
                            page_size: limit,
                            has_more: raw_stream_has_more,
                            next_offset_id: last_lowest_id,
                            search_cursor: None,
                            lane_counts: None,
                            emitted_watermark: None,
                            lane_durability: None,
                            total_count,
                            backend: BACKEND.into(),
                            cached: false,
                            files: collected,
                            rpc_observations: vec![observation],
                            pv_observation: None,
                            doc_observation: None,
                        });
                    }

                    // 3. Multi-Lane Composite Filters:
                    // - "images" / "image" (Drive perspective): Photos + image-Documents + GIFs
                    // - "videos" / "video" (Drive perspective): Video + video-Documents
                    // - "audio" / "music": Music + Voice + audio-Documents
                    // - "media" / "photo_video" / "photovideo": PhotoVideo + GIFs
                    if matches!(
                        filter_str.as_str(),
                        "images"
                            | "image"
                            | "videos"
                            | "video"
                            | "audio"
                            | "music"
                            | "media"
                            | "photo_video"
                            | "photovideo"
                    ) {
                        struct CompositeLaneState {
                            tl_filter: grammers_client::tl::enums::MessagesFilter,
                            op_name: &'static str,
                            count_contributes: bool,
                            offset_id: i32,
                            lowest_id: Option<i64>,
                            exhausted: bool,
                        }

                        let filter_specs: Vec<(
                            grammers_client::tl::enums::MessagesFilter,
                            &'static str,
                            bool,
                        )> = match filter_str.as_str() {
                            "images" | "image" => vec![
                                (
                                    grammers_client::tl::enums::MessagesFilter::InputMessagesFilterPhotos,
                                    "messages.search.photos",
                                    true,
                                ),
                                (
                                    grammers_client::tl::enums::MessagesFilter::InputMessagesFilterDocument,
                                    "messages.search.document_images",
                                    false,
                                ),
                                (
                                    grammers_client::tl::enums::MessagesFilter::InputMessagesFilterGif,
                                    "messages.search.gif_images",
                                    true,
                                ),
                            ],
                            "videos" | "video" => vec![
                                (
                                    grammers_client::tl::enums::MessagesFilter::InputMessagesFilterVideo,
                                    "messages.search.video",
                                    true,
                                ),
                                (
                                    grammers_client::tl::enums::MessagesFilter::InputMessagesFilterDocument,
                                    "messages.search.document_videos",
                                    false,
                                ),
                            ],
                            "audio" | "music" => vec![
                                (
                                    grammers_client::tl::enums::MessagesFilter::InputMessagesFilterMusic,
                                    "messages.search.music",
                                    true,
                                ),
                                (
                                    grammers_client::tl::enums::MessagesFilter::InputMessagesFilterVoice,
                                    "messages.search.voice",
                                    true,
                                ),
                                (
                                    grammers_client::tl::enums::MessagesFilter::InputMessagesFilterDocument,
                                    "messages.search.document_audio",
                                    false,
                                ),
                            ],
                            _ => vec![
                                (
                                    grammers_client::tl::enums::MessagesFilter::InputMessagesFilterPhotoVideo,
                                    "messages.search.photo_video",
                                    true,
                                ),
                                (
                                    grammers_client::tl::enums::MessagesFilter::InputMessagesFilterGif,
                                    "messages.search.gif_media",
                                    true,
                                ),
                            ],
                        };

                        let mut lane_states: Vec<CompositeLaneState> = filter_specs
                            .into_iter()
                            .map(|(tl_filter, op_name, count_contributes)| CompositeLaneState {
                                tl_filter,
                                op_name,
                                count_contributes,
                                offset_id: init_offset,
                                lowest_id: None,
                                exhausted: false,
                            })
                            .collect();

                        let mut combined_files: Vec<MediaFileRow> = Vec::new();
                        let mut sum_total_count: Option<usize> = None;
                        let mut total_latency_ms = 0u64;
                        let mut total_attempts = 0u32;

                        for round in 0..3usize {
                            let current_frontier = if round == 0 {
                                None
                            } else {
                                lane_states
                                    .iter()
                                    .filter(|l| !l.exhausted)
                                    .filter_map(|l| l.lowest_id)
                                    .max()
                            };

                            if round > 0 {
                                let Some(frontier_id) = current_frontier else {
                                    break;
                                };
                                let has_safe_candidate =
                                    combined_files.iter().any(|r| r.id >= frontier_id);
                                if has_safe_candidate {
                                    break;
                                }
                            }

                            for lane in &mut lane_states {
                                if lane.exhausted {
                                    continue;
                                }
                                if round > 0 && lane.lowest_id != current_frontier {
                                    continue;
                                }

                                let req = grammers_client::tl::functions::messages::Search {
                                    peer: input_peer.clone(),
                                    q: String::new(),
                                    from_id: None,
                                    saved_peer_id: None,
                                    saved_reaction: None,
                                    top_msg_id,
                                    filter: lane.tl_filter.clone(),
                                    min_date: 0,
                                    max_date: 0,
                                    offset_id: lane.offset_id,
                                    add_offset: 0,
                                    limit: limit as i32,
                                    max_id: 0,
                                    min_id: 0,
                                    hash: 0,
                                };
                                if let Ok(res) =
                                    crate::core::telegram_rpc_guard::invoke_guarded_with_control(
                                        &session_name,
                                        crate::core::session_rate::RpcClass::IndexSearch,
                                        lane.op_name,
                                        &guard,
                                        || client.invoke(&req),
                                    )
                                    .await
                                {
                                    total_latency_ms += res.latency_ms;
                                    total_attempts += res.attempts;
                                    let (messages, lane_total) = unpack_tl_messages(res.value);
                                    let raw_len = messages.len();
                                    let lowest_id = lowest_tl_message_id(&messages);
                                    if round == 0 && lane.count_contributes {
                                        if let Some(c) = lane_total {
                                            sum_total_count =
                                                Some(sum_total_count.unwrap_or(0) + c);
                                        }
                                    }
                                    let lane_has_more = raw_len >= limit
                                        && lowest_id.unwrap_or(0) > 1
                                        && lowest_id.map(|v| v as i32) != Some(lane.offset_id);
                                    lane.lowest_id = lowest_id.or(lane.lowest_id);
                                    lane.exhausted = !lane_has_more;
                                    if let Some(lid) = lowest_id {
                                        lane.offset_id = lid as i32;
                                    }
                                    for m in &messages {
                                        if let Some(row) = tl_message_to_row(m, folder_id) {
                                            if row_matches_filtered_query(&row, &filter_str) {
                                                combined_files.push(row);
                                            }
                                        }
                                    }
                                } else {
                                    lane.exhausted = true;
                                }
                            }
                        }

                        let any_has_more = lane_states.iter().any(|l| !l.exhausted);
                        let unexhausted_frontier = lane_states
                            .iter()
                            .filter(|l| !l.exhausted)
                            .filter_map(|l| l.lowest_id)
                            .max();
                        let max_lowest_id =
                            lane_states.iter().filter_map(|l| l.lowest_id).max();

                        let (files, next_offset, has_more) = reconcile_composite_lane_page(
                            combined_files,
                            unexhausted_frontier,
                            max_lowest_id,
                            any_has_more,
                            limit,
                        );
                        let total_count = sum_total_count.map(|c| c.max(files.len()));
                        let observation = LaneRpcObservation {
                            lane: SearchLane::Both,
                            latency_ms: total_latency_ms,
                            wall_latency_ms: started.elapsed().as_millis() as u64,
                            attempts: total_attempts.max(1),
                            rows_received: files.len(),
                            candidate_count: total_count,
                        };
                        return Ok(ListMediaResult {
                            status: "ok".into(),
                            folder_id,
                            total: files.len(),
                            page_size: limit,
                            has_more,
                            next_offset_id: next_offset,
                            search_cursor: None,
                            lane_counts: None,
                            emitted_watermark: None,
                            lane_durability: None,
                            total_count,
                            backend: BACKEND.into(),
                            cached: false,
                            files,
                            rpc_observations: vec![observation],
                            pv_observation: None,
                            doc_observation: None,
                        });
                    }

                    // 4. Single-Filter Direct Query ("files", "links", "web", "gifs", "photos", "voice")
                    let (filter, op_name, is_link) = match filter_str.as_str() {
                        "links" | "link" | "url" | "urls" | "web" => (
                            grammers_client::tl::enums::MessagesFilter::InputMessagesFilterUrl,
                            "messages.search.url",
                            true,
                        ),
                        "files" | "file" => (
                            grammers_client::tl::enums::MessagesFilter::InputMessagesFilterDocument,
                            "messages.search.document",
                            false,
                        ),
                        "photos" | "photo" => (
                            grammers_client::tl::enums::MessagesFilter::InputMessagesFilterPhotos,
                            "messages.search.photos",
                            false,
                        ),
                        "gifs" | "gif" => (
                            grammers_client::tl::enums::MessagesFilter::InputMessagesFilterGif,
                            "messages.search.gif",
                            false,
                        ),
                        "voice" => (
                            grammers_client::tl::enums::MessagesFilter::InputMessagesFilterVoice,
                            "messages.search.voice",
                            false,
                        ),
                        _ => (
                            grammers_client::tl::enums::MessagesFilter::InputMessagesFilterEmpty,
                            "messages.search.empty",
                            false,
                        ),
                    };

                    let request = grammers_client::tl::functions::messages::Search {
                        peer: input_peer,
                        q: String::new(),
                        from_id: None,
                        saved_peer_id: None,
                        saved_reaction: None,
                        top_msg_id,
                        filter,
                        min_date: 0,
                        max_date: 0,
                        offset_id: init_offset,
                        add_offset: 0,
                        limit: limit as i32,
                        max_id: 0,
                        min_id: 0,
                        hash: 0,
                    };
                    let response = crate::core::telegram_rpc_guard::invoke_guarded_with_control(
                        &session_name,
                        crate::core::session_rate::RpcClass::IndexSearch,
                        op_name,
                        &guard,
                        || client.invoke(&request),
                    )
                    .await?;

                    let (messages, total_count) = unpack_tl_messages(response.value);
                    let raw_len = messages.len();
                    let lowest_id = lowest_tl_message_id(&messages);
                    let files: Vec<MediaFileRow> = if is_link {
                        messages
                            .iter()
                            .filter_map(|message| tl_link_to_row(message, folder_id))
                            .collect()
                    } else {
                        messages
                            .iter()
                            .filter_map(|message| tl_message_to_row(message, folder_id))
                            .filter(|row| row_matches_filtered_query(row, &filter_str))
                            .collect()
                    };
                    let has_more = raw_len >= limit && lowest_id.unwrap_or(0) > 1;
                    let observation = LaneRpcObservation {
                        lane: SearchLane::Both,
                        latency_ms: response.latency_ms,
                        wall_latency_ms: started.elapsed().as_millis() as u64,
                        attempts: response.attempts,
                        rows_received: files.len(),
                        candidate_count: total_count,
                    };
                    Ok(ListMediaResult {
                        status: "ok".into(),
                        folder_id,
                        total: files.len(),
                        page_size: limit,
                        has_more,
                        next_offset_id: lowest_id,
                        search_cursor: None,
                        lane_counts: None,
                        emitted_watermark: None,
                        lane_durability: None,
                        total_count,
                        backend: BACKEND.into(),
                        cached: false,
                        files,
                        rpc_observations: vec![observation],
                        pv_observation: None,
                        doc_observation: None,
                    })
                })
            })
        })
        .await
    })
}

/// Dedicated links search (backward-compatible delegate).
pub fn list_links_blocking_topic(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    limit: usize,
    offset_id: Option<i64>,
    topic_id: Option<i64>,
) -> Result<ListMediaResult, TgError> {
    list_filtered_media_blocking_topic(
        sessions_dir,
        identity,
        chat_id,
        "links",
        limit,
        offset_id,
        topic_id,
    )
}
