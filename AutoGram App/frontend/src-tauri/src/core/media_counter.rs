//! media_counter.rs — Telegram MTProto Count Resolver Engine (Rust)
//!
//! Queries exact total counters and category breakdowns directly from Telegram MTProto
//! without downloading media content or causing FloodWait.

use grammers_client::tl;
use std::path::Path;

use crate::core::grammers_ops::*;
use crate::core::media_statistics::{
    get_cached_statistics, save_statistics, MediaStatisticsResult,
};
use crate::core::telegram_ops::TelegramIdentity;
use crate::core::tg_error::{map_invocation, TgError};

#[derive(Default)]
struct SearchCounterBreakdown {
    photo_count: usize,
    video_count: usize,
    file_count: usize,
    gif_count: usize,
    link_count: usize,
    audio_count: usize,
}

impl SearchCounterBreakdown {
    fn ingest(&mut self, counter: tl::enums::messages::SearchCounter) {
        let tl::enums::messages::SearchCounter::Counter(counter) = counter;
        let count = counter.count.max(0) as usize;
        match counter.filter {
            tl::enums::MessagesFilter::InputMessagesFilterPhotos => self.photo_count = count,
            tl::enums::MessagesFilter::InputMessagesFilterVideo => self.video_count = count,
            tl::enums::MessagesFilter::InputMessagesFilterDocument => self.file_count = count,
            tl::enums::MessagesFilter::InputMessagesFilterGif => self.gif_count = count,
            tl::enums::MessagesFilter::InputMessagesFilterUrl => self.link_count = count,
            tl::enums::MessagesFilter::InputMessagesFilterMusic => self.audio_count = count,
            _ => {}
        }
    }

    fn estimated_total(&self, loaded_count: usize) -> usize {
        // Telegram counters intentionally overlap (for example a video can also
        // be a document). This sum is an instant estimate only; the unique media
        // walk remains the final authority.
        self.photo_count
            .saturating_add(self.video_count)
            .saturating_add(self.file_count)
            .saturating_add(self.gif_count)
            .saturating_add(self.audio_count)
            .max(loaded_count)
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

    // Check cache first (valid for 120s or permanently if marked is_exact)
    if let Some(mut cached) = get_cached_statistics(&account_id, &peer_id, topic_id) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let cached_media_total = cached
            .photo_count
            .saturating_add(cached.video_count)
            .saturating_add(cached.file_count)
            .saturating_add(cached.gif_count)
            .saturating_add(cached.audio_count);

        if cached.is_exact == Some(true) && cached_media_total > 0 {
            if loaded_count > cached.loaded_count {
                cached.loaded_count = loaded_count;
                let _ = save_statistics(&cached);
            }
            return Ok(cached);
        }

        let cache_uses_media_semantics =
            cached.total_count <= cached_media_total.max(cached.loaded_count);
        if now.saturating_sub(cached.last_sync) < 120
            && cache_uses_media_semantics
            && cached_media_total > 0
        {
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

                    // Telegram shared-media vector RPC for standard channels/topics
                    let filters = vec![
                        tl::enums::MessagesFilter::InputMessagesFilterPhotos,
                        tl::enums::MessagesFilter::InputMessagesFilterVideo,
                        tl::enums::MessagesFilter::InputMessagesFilterDocument,
                        tl::enums::MessagesFilter::InputMessagesFilterGif,
                        tl::enums::MessagesFilter::InputMessagesFilterUrl,
                        tl::enums::MessagesFilter::InputMessagesFilterMusic,
                    ];
                    let counters = client
                        .invoke(&tl::functions::messages::GetSearchCounters {
                            peer: (&peer).into(),
                            saved_peer_id: None,
                            top_msg_id,
                            filters,
                        })
                        .await
                        .map_err(|err| map_invocation(&err))?;
                    let mut breakdown = SearchCounterBreakdown::default();
                    for counter in counters {
                        breakdown.ingest(counter);
                    }
                    let mut total_count = breakdown.estimated_total(loaded_count);

                    // If GetSearchCounters returned 0 for media and documents (common on forum supergroups with all-media scope),
                    // fallback to fast targeted messages::Search for PhotoVideo and Document to obtain the exact server counts!
                    if breakdown.photo_count == 0
                        && breakdown.video_count == 0
                        && breakdown.file_count == 0
                    {
                        // 1. Query Photo/Video count
                        let pv_req = tl::functions::messages::Search {
                            peer: (&peer).into(),
                            q: String::new(),
                            from_id: None,
                            saved_peer_id: None,
                            saved_reaction: None,
                            top_msg_id,
                            filter: tl::enums::MessagesFilter::InputMessagesFilterPhotoVideo,
                            min_date: 0,
                            max_date: 0,
                            offset_id: 0,
                            add_offset: 0,
                            limit: 1,
                            max_id: 0,
                            min_id: 0,
                            hash: 0,
                        };
                        if let Ok(res) = client.invoke(&pv_req).await {
                            let count = match res {
                                tl::enums::messages::Messages::Slice(s) => s.count.max(0) as usize,
                                tl::enums::messages::Messages::ChannelMessages(c) => {
                                    c.count.max(0) as usize
                                }
                                tl::enums::messages::Messages::Messages(m) => m.messages.len(),
                                _ => 0,
                            };
                            breakdown.photo_count = count;
                        }

                        // 2. Query Document/File count
                        let doc_req = tl::functions::messages::Search {
                            peer: (&peer).into(),
                            q: String::new(),
                            from_id: None,
                            saved_peer_id: None,
                            saved_reaction: None,
                            top_msg_id,
                            filter: tl::enums::MessagesFilter::InputMessagesFilterDocument,
                            min_date: 0,
                            max_date: 0,
                            offset_id: 0,
                            add_offset: 0,
                            limit: 1,
                            max_id: 0,
                            min_id: 0,
                            hash: 0,
                        };
                        if let Ok(res) = client.invoke(&doc_req).await {
                            let count = match res {
                                tl::enums::messages::Messages::Slice(s) => s.count.max(0) as usize,
                                tl::enums::messages::Messages::ChannelMessages(c) => {
                                    c.count.max(0) as usize
                                }
                                tl::enums::messages::Messages::Messages(m) => m.messages.len(),
                                _ => 0,
                            };
                            breakdown.file_count = count;
                        }

                        total_count = breakdown
                            .photo_count
                            .saturating_add(breakdown.file_count)
                            .max(loaded_count);
                    }

                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);

                    let is_exact = breakdown.photo_count > 0 || breakdown.file_count > 0;

                    let stats = MediaStatisticsResult {
                        account_id: session_name,
                        peer_id: chat,
                        topic_id,
                        total_count,
                        photo_count: breakdown.photo_count,
                        video_count: breakdown.video_count,
                        file_count: breakdown.file_count,
                        gif_count: breakdown.gif_count,
                        link_count: breakdown.link_count,
                        audio_count: breakdown.audio_count,
                        sticker_count: 0,
                        loaded_count,
                        total_bytes: 0,
                        last_sync: now,
                        is_exact: Some(is_exact),
                    };

                    let _ = save_statistics(&stats);
                    Ok(stats)
                })
            })
        })
        .await
    })
}
