//! Centralized FloodWait Controller Gate per Account, DC, and Method Group.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct GateKey {
    pub account_id: String,
    pub dc_id: i32,
    pub method_group: String, // "search" | "thumb" | "partial" | "full"
}

#[derive(Debug, Clone)]
pub struct GateState {
    pub blocked_until: Instant,
}

#[derive(Clone)]
pub struct FloodWaitGateController {
    gates: Arc<Mutex<HashMap<GateKey, GateState>>>,
}

impl FloodWaitGateController {
    pub fn new() -> Self {
        Self {
            gates: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn is_blocked(&self, key: &GateKey) -> Option<Duration> {
        let gates = self.gates.lock().await;
        if let Some(state) = gates.get(key) {
            let now = Instant::now();
            if state.blocked_until > now {
                return Some(state.blocked_until - now);
            }
        }
        None
    }

    pub async fn record_flood_wait(&self, key: GateKey, seconds: u64) {
        let mut gates = self.gates.lock().await;
        let until = Instant::now() + Duration::from_secs(seconds);
        gates.insert(key, GateState { blocked_until: until });
    }
}
