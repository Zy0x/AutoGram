//! events.rs — Global Event Bus & Payload Dispatcher (Rust)
//!
//! Port of Python `events.py`:
//! Emits typed events (`StudioScanProgress`, `BenchProgress`, `JobProgress`, etc.)
//! to the Tauri frontend via Tauri Event Emitter.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventEnvelope<T: Serialize> {
    pub event_name: String,
    pub timestamp_ms: u64,
    pub payload: T,
}

impl<T: Serialize> EventEnvelope<T> {
    pub fn new(event_name: impl Into<String>, payload: T) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        Self {
            event_name: event_name.into(),
            timestamp_ms: now,
            payload,
        }
    }
}
