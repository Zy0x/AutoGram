//! Domain models and IPC DTOs for Topic Media Engine.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum MediaScopeKind {
    All,
    General,
    Topic,
}

impl Default for MediaScopeKind {
    fn default() -> Self {
        MediaScopeKind::All
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct TopicMediaContext {
    pub account_id: String,
    pub peer_id: String,
    #[serde(default)]
    pub scope_kind: MediaScopeKind,
    pub topic_id: Option<i64>,
}

impl TopicMediaContext {
    pub fn topic_key(&self) -> String {
        let topic_str = self
            .topic_id
            .map(|t| t.to_string())
            .unwrap_or_else(|| "none".to_string());
        format!(
            "{}:{}:{:?}:{}",
            self.account_id, self.peer_id, self.scope_kind, topic_str
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationScope {
    pub window_label: String,
    pub account_id: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TopicMediaCursor {
    pub message_date: i64,
    pub message_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicMediaItem {
    pub account_id: String,
    pub peer_id: String,
    pub topic_id: Option<i64>,
    pub message_id: i64,
    pub message_date: i64,
    pub edit_date: Option<i64>,
    pub grouped_id: Option<i64>,
    pub sender_id: Option<String>,
    pub caption: Option<String>,
    pub media_type: String,
    pub mime_type: Option<String>,
    pub file_name: String,
    pub file_size: u64,
    pub document_id: Option<i64>,
    pub access_hash: Option<i64>,
    pub dc_id: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_reference: Option<Vec<u8>>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub duration_ms: Option<i32>,
    pub has_server_thumb: bool,
    pub has_video_thumb: bool,
    pub thumb_url: Option<String>,
    pub is_deleted: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThumbnailMode {
    Saver,
    Balance,
    High,
}

impl Default for ThumbnailMode {
    fn default() -> Self {
        ThumbnailMode::Balance
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ThumbnailSource {
    TelegramPhotoThumb,
    TelegramDocumentThumb,
    TelegramVideoThumb,
    EmbeddedPreview,
    PartialImage,
    PartialVideoFrame,
    PdfFirstPage,
    SmartIcon,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ThumbnailStatus {
    Pending,
    Ready,
    Failed,
    Unsupported,
    BudgetExceeded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTopicMediaRequest {
    pub window_label: String,
    pub generation_id: u64,
    pub context: TopicMediaContext,
    pub filter_types: Vec<String>,
    pub page_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTopicMediaResult {
    pub context: TopicMediaContext,
    pub generation_id: u64,
    pub source: String, // "cache" | "empty"
    pub items: Vec<TopicMediaItem>,
    pub cursor: Option<TopicMediaCursor>,
    pub has_more_local: bool,
    pub reconciliation_scheduled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicMediaDeltaEvent {
    pub schema_version: u32,
    pub window_label: String,
    pub account_id: String,
    pub peer_id: String,
    pub topic_id: Option<i64>,
    pub generation_id: u64,
    pub inserted: Vec<TopicMediaItem>,
    pub updated: Vec<TopicMediaItem>,
    pub deleted_message_ids: Vec<i64>,
    pub cursor: Option<TopicMediaCursor>,
    pub has_more: bool,
    pub sync_status: String, // "syncing" | "ready" | "paused" | "error"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbBatchV2ItemRequest {
    pub message_id: i64,
    pub document_id: Option<String>,
    pub dc_id: Option<i32>,
    pub mime_type: Option<String>,
    pub file_name: Option<String>,
    pub visible_rank: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbBatchV2Request {
    pub window_label: String,
    pub generation: u64,
    pub context: TopicMediaContext,
    pub quality: String, // "saver" | "balanced" | "sharp"
    pub items: Vec<ThumbBatchV2ItemRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbCacheHit {
    pub message_id: i64,
    pub local_path: String,
    pub quality: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbBatchV2Accepted {
    pub cache_hits: Vec<ThumbCacheHit>,
    pub queued_message_ids: Vec<i64>,
    pub rejected_message_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbCompletedItemV2 {
    pub message_id: i64,
    pub quality: String,
    pub local_path: String,
    pub width: i32,
    pub height: i32,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailBatchCompletedItem {
    pub message_id: i64,
    pub variant: String,
    pub source: String,
    pub local_url: String,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailBatchFailedItem {
    pub message_id: i64,
    pub code: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailBatchEvent {
    pub schema_version: u32,
    pub account_id: String,
    pub peer_id: String,
    pub topic_id: Option<i64>,
    pub completed: Vec<ThumbnailBatchCompletedItem>,
    pub failed: Vec<ThumbnailBatchFailedItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbReadyBatchEvent {
    pub account_id: String,
    pub peer_id: String,
    pub scope_kind: MediaScopeKind,
    pub topic_id: Option<i64>,
    pub generation: u64,
    pub completed: Vec<ThumbCompletedItemV2>,
    pub failed: Vec<ThumbnailBatchFailedItem>,
}
