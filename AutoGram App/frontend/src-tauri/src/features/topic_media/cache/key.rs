//! Cache key formatting for memory, disk, and in-flight deduplication.

pub fn thumbnail_cache_key(
    account_id: &str,
    peer_id: &str,
    topic_id: i64,
    message_id: i64,
    variant: &str,
) -> String {
    format!("{account_id}:{peer_id}:{topic_id}:{message_id}:{variant}")
}

pub fn in_flight_dedup_key(
    account_id: &str,
    dc_id: i32,
    document_id: i64,
    variant: &str,
) -> String {
    format!("{account_id}:{dc_id}:{document_id}:{variant}")
}
