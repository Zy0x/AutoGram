//! Server-side MTProto topic media search using messages.search with top_msg_id.

use grammers_client::tl;
use grammers_client::Client;

use super::super::error::TopicMediaError;
use super::super::models::{TopicMediaContext, TopicMediaCursor, TopicMediaItem};
use super::document_mapper::message_to_topic_media_item;
use crate::core::grammers_ops::resolve_peer;

pub fn map_filter_type_to_input(filter_type: &str) -> tl::enums::MessagesFilter {
    match filter_type {
        "photo" => tl::enums::MessagesFilter::InputMessagesFilterPhotos,
        "video" => tl::enums::MessagesFilter::InputMessagesFilterVideo,
        "document" => tl::enums::MessagesFilter::InputMessagesFilterDocument,
        "audio" => tl::enums::MessagesFilter::InputMessagesFilterMusic,
        "url" => tl::enums::MessagesFilter::InputMessagesFilterUrl,
        _ => tl::enums::MessagesFilter::InputMessagesFilterEmpty,
    }
}

pub async fn search_topic_media(
    client: &Client,
    ctx: &TopicMediaContext,
    filter_type: &str,
    cursor: Option<TopicMediaCursor>,
    limit: usize,
) -> Result<(Vec<TopicMediaItem>, Option<TopicMediaCursor>, bool), TopicMediaError> {
    let peer = resolve_peer(client, &ctx.peer_id)
        .await
        .map_err(|e| TopicMediaError::PeerUnavailable(e.to_string()))?;

    let input_peer: tl::enums::InputPeer = peer.into();
    let filter = map_filter_type_to_input(filter_type);
    let top_msg_id = match ctx.scope_kind {
        super::super::models::MediaScopeKind::All => None,
        super::super::models::MediaScopeKind::General => ctx.topic_id.map(|t| t as i32).or(Some(1)),
        super::super::models::MediaScopeKind::Topic => ctx.topic_id.map(|t| t as i32),
    };

    let offset_id = cursor.map(|c| c.message_id as i32).unwrap_or(0);
    let offset_date = cursor.map(|c| c.message_date as i32).unwrap_or(0);
    let fetch_limit = limit.clamp(1, 100) as i32;

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
        offset_id,
        add_offset: 0,
        limit: fetch_limit,
        max_id: 0,
        min_id: 0,
        hash: 0,
    };

    crate::core::tg_log::info(
        "grammers",
        "media_list_entry",
        format!(
            "op=media_list_entry provider=grammers_search peer_id={} topic_id={} offset={}",
            ctx.peer_id,
            ctx.topic_id.unwrap_or(0),
            offset_id
        ),
    );

    let result = client
        .invoke(&req)
        .await
        .map_err(|e| TopicMediaError::SearchRejected(e.to_string()))?;

    let messages = match result {
        tl::enums::messages::Messages::Messages(m) => m.messages,
        tl::enums::messages::Messages::Slice(m) => m.messages,
        tl::enums::messages::Messages::ChannelMessages(m) => m.messages,
        tl::enums::messages::Messages::NotModified(_) => Vec::new(),
    };

    let mut items = Vec::new();
    let mut last_cursor: Option<TopicMediaCursor> = None;

    for tl_msg in messages {
        if let Some(item) = message_to_topic_media_item(ctx, &tl_msg) {
            crate::core::tg_log::info(
                "grammers",
                "media_list_row_out",
                format!(
                    "op=media_list_row_out provider=grammers_search peer_id={} telegram_message_id={} telegram_message_variant=Message has_media=true raw_media_variant={} media_class={} file_name={} mime_type={} document_id={} photo_id=none",
                    item.peer_id,
                    item.message_id,
                    item.media_type,
                    item.media_type,
                    item.file_name,
                    item.mime_type.as_deref().unwrap_or("none"),
                    item.document_id.map(|d| d.to_string()).unwrap_or_else(|| "none".into())
                ),
            );
            last_cursor = Some(TopicMediaCursor {
                message_date: item.message_date,
                message_id: item.message_id,
            });
            items.push(item);
        }
    }

    let has_more = items.len() >= limit;
    Ok((items, last_cursor, has_more))
}
