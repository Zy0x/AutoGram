//! media_mutation.rs — Canonical Media Mutation Contract & Normalizers (P2.5)
//!
//! Provides a unified wire contract for media upserts and deletes emitted across
//! passive Telegram updates, getChannelDifference results, and authoritative reconciliation.

use serde::{Deserialize, Serialize};
use super::grammers_ops::media_list::MediaFileRow;

/// Canonical media mutation applied atomically alongside channel PTS in IndexedDB.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum MediaMutation {
    Upsert {
        peer_id: String,
        message_id: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        topic_id: Option<i64>,
        row: MediaFileRow,
    },
    Delete {
        peer_id: String,
        message_ids: Vec<i64>,
    },
}

impl MediaMutation {
    pub fn upsert(peer_id: impl Into<String>, message_id: i64, topic_id: Option<i64>, row: MediaFileRow) -> Self {
        Self::Upsert {
            peer_id: peer_id.into(),
            message_id,
            topic_id,
            row,
        }
    }

    pub fn delete(peer_id: impl Into<String>, message_ids: Vec<i64>) -> Self {
        Self::Delete {
            peer_id: peer_id.into(),
            message_ids,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_media_mutation_serialization_parity() {
        let row = MediaFileRow {
            id: 12345,
            folder_id: None,
            name: "sample.jpg".into(),
            size: 1024,
            mime_type: Some("image/jpeg".into()),
            icon_type: "photo".into(),
            created_at: Some("2023-11-14T00:00:00Z".into()),
            has_thumb: true,
            as_document: false,
            backend: "grammers".into(),
            thumb_data_url: None,
            topic_id: Some(17),
            identity_source: None,
            peer_id: Some("-100123456".into()),
            account_id: Some("sess_1".into()),
            peer_kind: None,
            peer_username: None,
            grouped_id: None,
            is_saved_messages: None,
            telegram_category: None,
            telegram_subtype: None,
            drive_category: None,
            drive_format: None,
        };

        let upsert = MediaMutation::upsert("-100123456", 12345, Some(17), row);
        let json = serde_json::to_string(&upsert).unwrap();
        assert!(json.contains("\"action\":\"upsert\""));
        assert!(json.contains("\"message_id\":12345"));

        let delete = MediaMutation::delete("-100123456", vec![101, 102, 103]);
        let del_json = serde_json::to_string(&delete).unwrap();
        assert!(del_json.contains("\"action\":\"delete\""));
        assert!(del_json.contains("[101,102,103]"));
    }
}
