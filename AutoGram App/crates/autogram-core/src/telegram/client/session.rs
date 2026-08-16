//! Telegram MTProto Session & Authorization Storage

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMetadata {
    pub session_name: String,
    pub dc_id: i32,
    pub user_id: i64,
    pub is_premium: bool,
    pub last_used_ms: u128,
}
