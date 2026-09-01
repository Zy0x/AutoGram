//! Pure Forwarder V2 planning primitives.  Network adapters call these
//! functions before touching Telegram so filtering, retry and state semantics
//! stay deterministic across Desktop and Android.

use chrono::{DateTime, Utc};
use super::forwarder_contract::{ForwardMode, JobConfigV2, JobStateV2, MessageTypes, TaskStateV2};
use super::grammers_ops::media_list::MediaFileRow;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ItemDecision { Transfer, Skip(&'static str), AskUser(&'static str) }

fn type_enabled(types: &MessageTypes, row: &MediaFileRow) -> bool {
    let category = row.telegram_category.as_deref().or(row.drive_category.as_deref()).unwrap_or("").to_ascii_lowercase();
    let mime = row.mime_type.as_deref().unwrap_or("").to_ascii_lowercase();
    if category.contains("text") || mime.starts_with("text/") { return types.text; }
    if category.contains("photo") || mime.starts_with("image/") && !category.contains("sticker") { return types.photo; }
    if category.contains("video") || mime.starts_with("video/") { return types.video; }
    if category.contains("audio") || mime.starts_with("audio/") { return types.audio; }
    if category.contains("voice") { return types.voice; }
    if category.contains("sticker") { return types.sticker; }
    if category.contains("gif") || mime == "image/gif" { return types.gif; }
    if category.contains("poll") { return types.poll; }
    if category.contains("service") { return types.service; }
    // Documents are the safe catch-all for unknown official message types.
    types.document
}

pub fn evaluate_item(config: &JobConfigV2, row: &MediaFileRow) -> ItemDecision {
    if !type_enabled(&config.message_types, row) { return ItemDecision::Skip("FILTERED_MEDIA_TYPE"); }
    if config.size_range.min_bytes > 0 && row.size < config.size_range.min_bytes { return ItemDecision::Skip("FILTERED_SIZE"); }
    if config.size_range.max_bytes > 0 && row.size > config.size_range.max_bytes { return ItemDecision::Skip("FILTERED_SIZE"); }
    if let Some(min) = config.message_id_start { if row.id < min { return ItemDecision::Skip("FILTERED_DATE"); } }
    if let Some(max) = config.message_id_end { if row.id > max { return ItemDecision::Skip("FILTERED_DATE"); } }
    if let Some(keyword) = config.keyword.as_deref().filter(|s| !s.trim().is_empty()) {
        if !row.name.to_ascii_lowercase().contains(&keyword.to_ascii_lowercase()) { return ItemDecision::Skip("FILTERED_MEDIA_TYPE"); }
    }
    if let (Some(start), Some(created)) = (config.date_range.start.as_deref(), row.created_at.as_deref()) {
        if let (Ok(a), Ok(b)) = (DateTime::parse_from_rfc3339(start), DateTime::parse_from_rfc3339(created)) { if b < a { return ItemDecision::Skip("FILTERED_DATE"); } }
    }
    if let (Some(end), Some(created)) = (config.date_range.end.as_deref(), row.created_at.as_deref()) {
        if let (Ok(a), Ok(b)) = (DateTime::parse_from_rfc3339(end), DateTime::parse_from_rfc3339(created)) { if b > a { return ItemDecision::Skip("FILTERED_DATE"); } }
    }
    if config.restriction_policy.contains("ask") && row.telegram_subtype.as_deref().unwrap_or("").contains("restricted") { return ItemDecision::AskUser("USER_DECISION_REQUIRED"); }
    ItemDecision::Transfer
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryClass { FloodWait(u64), Transient, Permanent, UnknownCommit }

pub fn classify_error(message: &str) -> RetryClass {
    let lower = message.to_ascii_lowercase();
    if let Some(wait) = lower.split("flood_wait_").nth(1).and_then(|s| s.split_whitespace().next()).and_then(|s| s.trim_matches(|c: char| !c.is_ascii_digit()).parse::<u64>().ok()) { return RetryClass::FloodWait(wait.min(300)); }
    if lower.contains("timeout") || lower.contains("temporar") || lower.contains("connection reset") || lower.contains("network") { return RetryClass::Transient; }
    if lower.contains("unknown") && lower.contains("commit") { return RetryClass::UnknownCommit; }
    RetryClass::Permanent
}

pub fn retry_delay(class: RetryClass, attempt: u32) -> Option<u64> {
    match class { RetryClass::FloodWait(seconds) => Some(seconds), RetryClass::Transient => Some(2u64.saturating_pow(attempt.min(8))), RetryClass::UnknownCommit => Some(5), RetryClass::Permanent => None }
}

pub fn valid_transition(from: JobStateV2, to: JobStateV2) -> bool {
    use JobStateV2::*;
    matches!((from,to), (Ready,Validating)|(Validating,Scanning)|(Scanning,Filtering)|(Filtering,Deduplicating)|(Deduplicating,Downloading)|(Downloading,Preparing)|(Preparing,Uploading)|(Uploading,Committing)|(Committing,Completed)|(Committing,PartialSuccess)|(Ready,Paused)|(Scanning,Paused)|(Uploading,Paused)|(Committing,Unknown)|(Unknown,Reconciling)|(Reconciling,Uploading)|(Reconciling,Completed)|(Reconciling,Failed)|(_,WaitingUser)|(_,WaitingCooldown)|(_,Cancelled)|(_,Failed))
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct DryRunSummary { pub total_items: u64, pub total_bytes: u64, pub transferable: u64, pub filtered: u64, pub duplicate_candidates: u64, pub permission_risk: u64 }

pub fn dry_run_rows(config: &JobConfigV2, rows: &[MediaFileRow]) -> DryRunSummary {
    let mut out = DryRunSummary { total_items: rows.len() as u64, ..Default::default() };
    for row in rows { out.total_bytes = out.total_bytes.saturating_add(row.size); match evaluate_item(config,row) { ItemDecision::Transfer => out.transferable += 1, ItemDecision::Skip(_) => out.filtered += 1, ItemDecision::AskUser(_) => out.permission_risk += 1 } }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::forwarder_contract::{DateRange, PeerRef, SizeRange};
    fn config() -> JobConfigV2 { JobConfigV2 { schema_version:2, job_id:None, revision:0, source:PeerRef{account_id:"a".into(),peer_id:"s".into(),topic_id:None}, destination:PeerRef{account_id:"a".into(),peer_id:"d".into(),topic_id:None}, mode:ForwardMode::Auto, message_types:MessageTypes::default(), date_range:DateRange::default(), message_id_start:None, message_id_end:None, size_range:SizeRange::default(), keyword:None, caption_policy:"keep".into(), attribution_policy:"preserve".into(), duplicate_policy:"skip".into(), album_policy:"preserve_max_10".into(), reply_policy:"preserve".into(), restriction_policy:"fail".into(), scan_order:"oldest_first".into(), limit:0, throttle:serde_json::Value::Null, schedule:serde_json::Value::Null, notification:serde_json::Value::Null } }
    #[test] fn classifies_retry() { assert_eq!(classify_error("FLOOD_WAIT_42"), RetryClass::FloodWait(42)); assert_eq!(retry_delay(RetryClass::Transient,3),Some(8)); assert_eq!(retry_delay(RetryClass::Permanent,1),None); }
    #[test] fn filters_size_and_type() { let mut row=MediaFileRow{id:1,folder_id:None,name:"x.jpg".into(),size:10,mime_type:Some("image/jpeg".into()),icon_type:"image".into(),created_at:None,has_thumb:false,as_document:false,backend:"grammers".into(),thumb_data_url:None,topic_id:None,identity_source:None,peer_id:None,account_id:None,peer_kind:None,peer_username:None,grouped_id:None,is_saved_messages:None,telegram_category:Some("photo".into()),telegram_subtype:None,drive_category:None,drive_format:None}; let mut c=config(); c.size_range.min_bytes=20; assert_eq!(evaluate_item(&c,&row),ItemDecision::Skip("FILTERED_SIZE")); c.size_range.min_bytes=0; c.message_types.photo=false; assert_eq!(evaluate_item(&c,&row),ItemDecision::Skip("FILTERED_MEDIA_TYPE")); row.size=30; assert_eq!(dry_run_rows(&c,&[row]).filtered,1); }
}
