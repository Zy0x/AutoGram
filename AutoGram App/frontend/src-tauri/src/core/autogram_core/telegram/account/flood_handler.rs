//! Token Bucket & FLOOD_WAIT Cooldown Handler

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FloodWaitState {
    pub is_flooded: bool,
    pub cooldown_seconds: u64,
    pub cooldown_until_ms: u128,
}

impl FloodWaitState {
    pub fn new() -> Self {
        Self {
            is_flooded: false,
            cooldown_seconds: 0,
            cooldown_until_ms: 0,
        }
    }

    pub fn record_flood(&mut self, seconds: u64) {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        self.is_flooded = true;
        self.cooldown_seconds = seconds;
        self.cooldown_until_ms = now_ms + (seconds as u128 * 1000);
    }

    pub fn check_active(&mut self) -> bool {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);

        if self.is_flooded && now_ms >= self.cooldown_until_ms {
            self.is_flooded = false;
            self.cooldown_seconds = 0;
            self.cooldown_until_ms = 0;
        }

        self.is_flooded
    }
}
