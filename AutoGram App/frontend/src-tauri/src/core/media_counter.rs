//! media_counter.rs — Telegram MTProto Count Resolver Engine (Rust)
//!
//! Queries exact total counters and category breakdowns directly from Telegram MTProto
//! without downloading media content or causing FloodWait.

use std::path::Path;
use grammers_client::tl;

use crate::core::grammers_ops::*;
use crate::core::media_statistics::{get_cached_statistics, save_statistics, MediaStatisticsResult};
use crate::core::telegram_ops::TelegramIdentity;
use crate::core::tg_error::{map_invocation, TgError, TgErrorCode};

async fn query_count_for_filter(
    client: &grammers_client::Client,
    peer: &grammers_session::types::PeerRef,
    top_msg_id: Option<i32>,
    filter: tl::enums::MessagesFilter,
) -> usize {
    let input_peer: tl::enums::InputPeer = peer.into();
    let req = tl::functions::messages::Search {
        peer: input_peer,
        q: String::new(),
        from_id: None,
        saved_peer_id: None,
        saved_reaction: None,
        top_msg_id,
        filter,
        min_date: 0,
        max_date: 0,
        offset_id: 0,
        add_offset: 0,
        limit: 1,
        max_id: 0,
        min_id: 0,
        hash: 0,
    };

    match client.invoke(&req).await {
        Ok(res) => match res {
            tl::enums::messages::Messages::Slice(m) => m.count as usize,
            tl::enums::messages::Messages::ChannelMessages(m) => m.count as usize,
            tl::enums::messages::Messages::Messages(m) => m.messages.len(),
            _ => 0,
        },
        Err(_) => 0,
    }
}

pub fn get_media_statistics_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    topic_id: Option<i64>,
    loaded_count: usize,
) -> Result<MediaStatisticsResult, TgError> {
    let account_id = identity.session.clone();
    let peer_id = chat_id.to_string();

    // Check cache first (valid for 120s)
    if let Some(mut cached) = get_cached_statistics(&account_id, &peer_id, topic_id) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        if now.saturating_sub(cached.last_sync) < 120 {
            if loaded_count > cached.loaded_count {
                cached.loaded_count = loaded_count;
                let _ = save_statistics(&cached);
            }
            return Ok(cached);
        }
    }

    let rt = runtime()?;
    rt.block_on(async {
        with_pool_retry(&identity.session, || {
            let chat = peer_id.clone();
            let session_name = account_id.clone();
            with_client(sessions_dir, identity, true, |client| {
                Box::pin(async move {
                    ensure_authorized(client, &session_name).await?;
                    let peer = resolve_peer(client, &chat).await?;

                    let top_msg_id = topic_id.filter(|t| *t > 0).map(|t| t as i32);

                    let total_count = query_count_for_filter(
                        client,
                        &peer,
                        top_msg_id,
                        tl::enums::MessagesFilter::InputMessagesFilterEmpty,
                    )
                    .await;

                    let photo_count = query_count_for_filter(
                        client,
                        &peer,
                        top_msg_id,
                        tl::enums::MessagesFilter::InputMessagesFilterPhotos,
                    )
                    .await;

                    let video_count = query_count_for_filter(
                        client,
                        &peer,
                        top_msg_id,
                        tl::enums::MessagesFilter::InputMessagesFilterVideo,
                    )
                    .await;

                    let file_count = query_count_for_filter(
                        client,
                        &peer,
                        top_msg_id,
                        tl::enums::MessagesFilter::InputMessagesFilterDocument,
                    )
                    .await;

                    let gif_count = query_count_for_filter(
                        client,
                        &peer,
                        top_msg_id,
                        tl::enums::MessagesFilter::InputMessagesFilterGif,
                    )
                    .await;

                    let link_count = query_count_for_filter(
                        client,
                        &peer,
                        top_msg_id,
                        tl::enums::MessagesFilter::InputMessagesFilterUrl,
                    )
                    .await;

                    let audio_count = query_count_for_filter(
                        client,
                        &peer,
                        top_msg_id,
                        tl::enums::MessagesFilter::InputMessagesFilterMusic,
                    )
                    .await;

                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);

                    let stats = MediaStatisticsResult {
                        account_id: session_name,
                        peer_id: chat,
                        topic_id,
                        total_count,
                        photo_count,
                        video_count,
                        file_count,
                        gif_count,
                        link_count,
                        audio_count,
                        loaded_count,
                        total_bytes: 0,
                        last_sync: now,
                    };

                    let _ = save_statistics(&stats);
                    Ok(stats)
                })
            })
        })
        .await
    })
}
