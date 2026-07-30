//! Update mapping helpers for incoming realtime MTProto updates.

use super::super::models::{TopicMediaContext, TopicMediaItem};
use super::document_mapper::message_to_topic_media_item;
use grammers_client::tl;

pub fn map_update_message(
    ctx: &TopicMediaContext,
    msg: &tl::enums::Message,
) -> Option<TopicMediaItem> {
    message_to_topic_media_item(ctx, msg)
}
