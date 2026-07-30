//! Legacy facade adapter mapping media_list.rs legacy calls to new Topic Media Engine.

use super::models::{TopicMediaContext, TopicMediaItem};
use super::repository::get_cached_page;

pub fn list_media_legacy_facade(
    account_id: &str,
    peer_id: &str,
    topic_id: Option<i64>,
    limit: usize,
) -> Vec<TopicMediaItem> {
    let (scope_kind, tid) = match topic_id {
        Some(t) if t > 0 => (super::models::MediaScopeKind::Topic, Some(t)),
        _ => (super::models::MediaScopeKind::All, None),
    };
    let ctx = TopicMediaContext {
        account_id: account_id.to_string(),
        peer_id: peer_id.to_string(),
        scope_kind,
        topic_id: tid,
    };

    get_cached_page(&ctx, &[], None, limit).unwrap_or_default()
}
