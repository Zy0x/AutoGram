//! Versioned Media Forwarder contracts shared by desktop, Android adapters,
//! and the cloud relay.  The wire shape is deliberately snake_case so a job
//! snapshot is stable across Rust/TypeScript/Kotlin clients.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const JOB_CONFIG_SCHEMA_VERSION: u32 = 2;

pub const REASON_CODES: &[&str] = &[
    "FILTERED_MEDIA_TYPE", "FILTERED_DATE", "FILTERED_SIZE",
    "DUPLICATE_MESSAGE_ID", "DUPLICATE_UNIQUE_ID", "DUPLICATE_SHA256",
    "DUPLICATE_NAME_SIZE", "FORWARD_RESTRICTED", "DOWNLOAD_NOT_ALLOWED",
    "DESTINATION_PERMISSION_DENIED", "FLOOD_WAIT", "UNKNOWN_COMMIT",
    "USER_DECISION_REQUIRED",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum JobStateV2 {
    Ready, Validating, Scanning, Filtering, Deduplicating, Downloading,
    Preparing, Uploading, Committing, Completed, Paused, WaitingUser,
    WaitingCooldown, Unknown, PartialSuccess, Failed, Cancelled, Reconciling,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskStateV2 {
    Queued, Downloading, Preparing, Uploading, Committing, Completed,
    Skipped, Failed, Unknown, WaitingUser, Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForwardEventV2 {
    pub schema_version: u32,
    pub sequence: u64,
    pub job_id: String,
    pub execution_id: Option<String>,
    pub task_id: Option<String>,
    pub state: String,
    pub reason_code: Option<String>,
    pub redacted_metadata: Value,
    pub occurred_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MirrorMutationV2 {
    pub schema_version: u32,
    pub source_peer_id: String,
    pub source_message_id: i64,
    pub kind: String,
    pub destination_message_id: Option<i64>,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceRelayCommandV1 {
    pub schema_version: u32,
    pub command_id: String,
    pub device_id: String,
    pub job_id: String,
    pub command: String,
    pub nonce: String,
    pub signature: String,
    pub payload_ciphertext: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ForwarderFeatureFlags {
    pub forwarder_v2: bool,
    pub mirror_v1: bool,
    pub android_forwarder: bool,
    pub cloud_relay: bool,
    pub public_api: bool,
}

impl Default for ForwarderFeatureFlags {
    fn default() -> Self {
        Self { forwarder_v2: true, mirror_v1: false, android_forwarder: true, cloud_relay: false, public_api: false }
    }
}

impl ForwarderFeatureFlags {
    pub fn resolve() -> Self {
        let mut flags = Self::default();
        for (key, slot) in [
            ("forwarder_v2", &mut flags.forwarder_v2),
            ("mirror_v1", &mut flags.mirror_v1),
            ("android_forwarder", &mut flags.android_forwarder),
            ("cloud_relay", &mut flags.cloud_relay),
            ("public_api", &mut flags.public_api),
        ] {
            if let Ok(value) = std::env::var(format!("AUTOGRAM_FEATURE_{}", key.to_ascii_uppercase())) {
                *slot = matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on");
            }
        }
        flags
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ForwardMode {
    Auto,
    FastForward,
    CleanCopy,
    Mirror,
}

impl Default for ForwardMode {
    fn default() -> Self { Self::Auto }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PeerRef {
    pub account_id: String,
    pub peer_id: String,
    #[serde(default)]
    pub topic_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MessageTypes {
    #[serde(default = "default_true")] pub text: bool,
    #[serde(default = "default_true")] pub photo: bool,
    #[serde(default = "default_true")] pub video: bool,
    #[serde(default = "default_true")] pub document: bool,
    #[serde(default = "default_true")] pub audio: bool,
    #[serde(default = "default_true")] pub voice: bool,
    #[serde(default = "default_true")] pub sticker: bool,
    #[serde(default = "default_true")] pub gif: bool,
    #[serde(default = "default_true")] pub poll: bool,
    #[serde(default = "default_true")] pub link: bool,
    #[serde(default = "default_true")] pub service: bool,
}

fn default_true() -> bool { true }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DateRange {
    pub start: Option<String>,
    pub end: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SizeRange {
    #[serde(default)] pub min_bytes: u64,
    #[serde(default)] pub max_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobConfigV2 {
    pub schema_version: u32,
    pub job_id: Option<String>,
    pub revision: u64,
    pub source: PeerRef,
    pub destination: PeerRef,
    #[serde(default)] pub mode: ForwardMode,
    #[serde(default)] pub message_types: MessageTypes,
    #[serde(default)] pub date_range: DateRange,
    #[serde(default)] pub message_id_start: Option<i64>,
    #[serde(default)] pub message_id_end: Option<i64>,
    #[serde(default)] pub size_range: SizeRange,
    #[serde(default)] pub keyword: Option<String>,
    #[serde(default = "default_caption_policy")] pub caption_policy: String,
    #[serde(default = "default_attribution_policy")] pub attribution_policy: String,
    #[serde(default = "default_duplicate_policy")] pub duplicate_policy: String,
    #[serde(default = "default_album_policy")] pub album_policy: String,
    #[serde(default = "default_reply_policy")] pub reply_policy: String,
    #[serde(default = "default_restriction_policy")] pub restriction_policy: String,
    #[serde(default = "default_scan_order")] pub scan_order: String,
    #[serde(default)] pub limit: u64,
    #[serde(default)] pub throttle: Value,
    #[serde(default)] pub schedule: Value,
    #[serde(default)] pub notification: Value,
}

fn default_caption_policy() -> String { "keep_original".into() }
fn default_attribution_policy() -> String { "preserve_when_supported".into() }
fn default_duplicate_policy() -> String { "skip".into() }
fn default_album_policy() -> String { "preserve_max_10".into() }
fn default_reply_policy() -> String { "preserve_when_supported".into() }
fn default_restriction_policy() -> String { "official_fallback_fail_closed".into() }
fn default_scan_order() -> String { "oldest_first".into() }

fn string(obj: &Map<String, Value>, keys: &[&str]) -> String {
    keys.iter().find_map(|k| obj.get(*k).and_then(Value::as_str)).unwrap_or("").trim().to_string()
}

fn string_or(obj: &Map<String, Value>, keys: &[&str], fallback: &str) -> String {
    let value = string(obj, keys);
    if value.is_empty() { fallback.to_string() } else { value }
}

fn bool_value(obj: &Map<String, Value>, keys: &[&str], default: bool) -> bool {
    keys.iter().find_map(|k| obj.get(*k)).map(|v| match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
        Value::String(s) => matches!(s.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"),
        _ => default,
    }).unwrap_or(default)
}

fn i64_value(obj: &Map<String, Value>, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|k| obj.get(*k)).and_then(|v| match v {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    })
}

/// Convert legacy JobEditor payloads into the canonical V2 wire shape.
/// Unknown fields are intentionally ignored so secrets cannot accidentally
/// leak into cloud snapshots.
pub fn normalize_job_config_v2(raw: Value) -> Result<JobConfigV2, String> {
    let obj = raw.as_object().cloned().unwrap_or_default();
    let nested_peer = |key: &str| -> (String, String, Option<i64>) {
        obj.get(key).and_then(Value::as_object).map(|p| (
            p.get("account_id").and_then(Value::as_str).unwrap_or_default().to_string(),
            p.get("peer_id").and_then(Value::as_str).unwrap_or_default().to_string(),
            p.get("topic_id").and_then(Value::as_i64),
        )).unwrap_or_default()
    };
    let (nested_source_account, nested_source_id, nested_source_topic) = nested_peer("source");
    let (nested_destination_account, nested_destination_id, nested_destination_topic) = nested_peer("destination");
    let source_id = if nested_source_id.is_empty() { string(&obj, &["source_peer_id", "source", "source_entity_id"]) } else { nested_source_id };
    let destination_id = if nested_destination_id.is_empty() { string(&obj, &["destination_peer_id", "destination", "target_entity_id", "target"]) } else { nested_destination_id };
    if source_id.is_empty() || destination_id.is_empty() {
        return Err("source and destination are required".into());
    }
    let mode_raw = string(&obj, &["mode", "transfer_mode"]).to_ascii_lowercase();
    let mode = match mode_raw.as_str() {
        "fast forward" | "fast_forward" | "forward" => ForwardMode::FastForward,
        "clean copy" | "clean_copy" | "copy" | "reupload" => ForwardMode::CleanCopy,
        "mirror" | "sync" => ForwardMode::Mirror,
        _ => ForwardMode::Auto,
    };
    let mut message_types = MessageTypes::default();
    message_types.text = bool_value(&obj, &["include_text"], true);
    message_types.photo = bool_value(&obj, &["include_photos", "include_images"], true);
    message_types.video = bool_value(&obj, &["include_videos"], true);
    message_types.document = bool_value(&obj, &["include_documents"], true);
    message_types.audio = bool_value(&obj, &["include_audio"], true);
    message_types.voice = bool_value(&obj, &["include_voice"], true);
    message_types.sticker = bool_value(&obj, &["include_stickers"], true);
    message_types.gif = bool_value(&obj, &["include_gif"], true);
    message_types.poll = bool_value(&obj, &["include_polls"], true);
    message_types.link = bool_value(&obj, &["include_links"], true);
    message_types.service = bool_value(&obj, &["include_service"], true);
    let config = JobConfigV2 {
        schema_version: JOB_CONFIG_SCHEMA_VERSION,
        job_id: None,
        revision: i64_value(&obj, &["revision"]).unwrap_or(0).max(0) as u64,
        source: PeerRef { account_id: if nested_source_account.is_empty() { string(&obj, &["source_account_id", "session"]) } else { nested_source_account }, peer_id: source_id, topic_id: nested_source_topic.or_else(|| i64_value(&obj, &["source_topic_id", "topic_id"])) },
        destination: PeerRef { account_id: if nested_destination_account.is_empty() { string(&obj, &["destination_account_id", "destination_session", "session"]) } else { nested_destination_account }, peer_id: destination_id, topic_id: nested_destination_topic.or_else(|| i64_value(&obj, &["destination_topic_id", "dest_topic_id", "topic_id"])) },
        mode,
        message_types,
        date_range: DateRange { start: obj.get("start_date").and_then(Value::as_str).map(str::to_string), end: obj.get("end_date").and_then(Value::as_str).map(str::to_string) },
        message_id_start: i64_value(&obj, &["message_id_start", "min_message_id"]),
        message_id_end: i64_value(&obj, &["message_id_end", "max_message_id"]),
        size_range: SizeRange { min_bytes: i64_value(&obj, &["size_min_bytes"]).unwrap_or_else(|| i64_value(&obj, &["size_min_mb"]).unwrap_or(0) * 1024 * 1024).max(0) as u64, max_bytes: i64_value(&obj, &["size_max_bytes"]).unwrap_or_else(|| i64_value(&obj, &["size_max_mb"]).unwrap_or(0) * 1024 * 1024).max(0) as u64 },
        keyword: obj.get("keyword").or_else(|| obj.get("keyword_filter")).and_then(Value::as_str).map(str::to_string),
        caption_policy: string_or(&obj, &["caption_policy", "caption_rule"], "keep_original"),
        attribution_policy: string_or(&obj, &["attribution_policy"], "preserve_when_supported"),
        duplicate_policy: string_or(&obj, &["duplicate_policy", "dupAction"], "skip"),
        album_policy: string_or(&obj, &["album_policy", "album_handling"], "preserve_max_10"),
        reply_policy: string_or(&obj, &["reply_policy"], "preserve_when_supported"),
        restriction_policy: string_or(&obj, &["restriction_policy"], "official_fallback_fail_closed"),
        scan_order: string_or(&obj, &["scan_order", "fetch_direction"], "oldest_first"),
        limit: i64_value(&obj, &["limit"]).unwrap_or(0).max(0) as u64,
        throttle: obj.get("throttle").cloned().unwrap_or(Value::Null),
        schedule: obj.get("schedule").cloned().unwrap_or(Value::Null),
        notification: obj.get("notification").cloned().unwrap_or(Value::Null),
    };
    Ok(config)
}

pub fn normalize_job_config_json(raw: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(raw).map_err(|e| format!("invalid job config: {e}"))?;
    let config = normalize_job_config_v2(value)?;
    serde_json::to_string(&config).map_err(|e| format!("serialize job config: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_legacy_payload_to_v2() {
        let out = normalize_job_config_v2(json!({
            "source": "-1001",
            "destination": "-1002",
            "session": "primary",
            "mode": "Clean Copy",
            "include_videos": false,
            "size_min_mb": 2,
            "album_handling": "preserve"
        })).expect("valid config");
        assert_eq!(out.schema_version, 2);
        assert_eq!(out.mode, ForwardMode::CleanCopy);
        assert!(!out.message_types.video);
        assert_eq!(out.size_range.min_bytes, 2 * 1024 * 1024);
        assert_eq!(out.source.account_id, "primary");
    }

    #[test]
    fn rejects_missing_route() {
        assert!(normalize_job_config_v2(json!({"source": "-1001"})).is_err());
    }
}
