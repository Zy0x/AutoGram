use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CloudDialog {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub photo_key: Option<String>,
    pub avatar_bytes: Option<Vec<u8>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CloudDialogPage {
    pub account_id: String,
    pub items: Vec<CloudDialog>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CloudMediaPage {
    pub account_id: String,
    pub peer_id: String,
    pub items: Vec<super::metadata::MediaMetadata>,
    pub next_offset: Option<i32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CloudStream {
    pub id: String,
    pub account_id: String,
    pub peer_id: String,
    pub message_id: i32,
    pub size: u64,
    pub mime_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CloudThumbnailItem {
    pub message_id: i32,
    pub thumbnail_bytes: Vec<u8>,
}
