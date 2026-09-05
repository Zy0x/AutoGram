//! Privacy-safe in-memory diagnostics for the currently open preview.
//!
//! Events are intentionally bounded and discarded when the preview is closed.
//! They are meant for troubleshooting transport/decoder behavior, never for
//! retaining user media locations or session material.

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_EVENTS_PER_PREVIEW: usize = 500;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewDiagnosticEvent {
    pub sequence: u64,
    pub timestamp_ms: u64,
    pub level: String,
    pub category: String,
    pub event: String,
    pub details: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewDiagnosticsSnapshot {
    pub stream_id: String,
    pub next_sequence: u64,
    pub events: Vec<PreviewDiagnosticEvent>,
    pub traffic: crate::core::traffic_governor::TrafficSnapshot,
}

#[derive(Default)]
struct PreviewLog {
    next_sequence: u64,
    events: VecDeque<PreviewDiagnosticEvent>,
}

static LOGS: OnceLock<Mutex<HashMap<String, PreviewLog>>> = OnceLock::new();

fn logs() -> &'static Mutex<HashMap<String, PreviewLog>> {
    LOGS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn record(stream_id: &str, level: &str, category: &str, event: &str, details: Value) {
    if stream_id.trim().is_empty() {
        return;
    }
    let mut guard = logs().lock();
    let log = guard.entry(stream_id.to_string()).or_default();
    log.next_sequence = log.next_sequence.saturating_add(1);
    log.events.push_back(PreviewDiagnosticEvent {
        sequence: log.next_sequence,
        timestamp_ms: now_ms(),
        level: level.to_string(),
        category: category.to_string(),
        event: event.to_string(),
        details: sanitize_value(&details),
    });
    while log.events.len() > MAX_EVENTS_PER_PREVIEW {
        log.events.pop_front();
    }
}

pub fn snapshot(stream_id: &str, after_sequence: Option<u64>) -> PreviewDiagnosticsSnapshot {
    let guard = logs().lock();
    let Some(log) = guard.get(stream_id) else {
        return PreviewDiagnosticsSnapshot {
            stream_id: stream_id.to_string(),
            next_sequence: 0,
            events: Vec::new(),
            traffic: crate::core::traffic_governor::snapshot(),
        };
    };
    let after = after_sequence.unwrap_or(0);
    PreviewDiagnosticsSnapshot {
        stream_id: stream_id.to_string(),
        next_sequence: log.next_sequence,
        events: log
            .events
            .iter()
            .filter(|entry| entry.sequence > after)
            .cloned()
            .collect(),
        traffic: crate::core::traffic_governor::snapshot(),
    }
}

pub fn clear(stream_id: &str) {
    logs().lock().remove(stream_id);
}

fn sanitize_value(value: &Value) -> Value {
    const SENSITIVE: &[&str] = &[
        "authorization", "cookie", "credential", "password", "session", "token", "signature", "sig",
    ];
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .filter(|(key, _)| {
                    let lower = key.to_ascii_lowercase();
                    !SENSITIVE.iter().any(|needle| lower.contains(needle))
                })
                .map(|(key, nested)| (key.clone(), sanitize_value(nested)))
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(sanitize_value).collect()),
        Value::String(text) if text.starts_with("http://") || text.starts_with("https://") => {
            let safe = url::Url::parse(text)
                .map(|mut parsed| {
                    parsed.set_query(None);
                    parsed.set_fragment(None);
                    parsed.to_string()
                })
                .unwrap_or_else(|_| "[invalid-url]".to_string());
            Value::String(safe)
        }
        Value::String(text)
            if text.starts_with('/')
                || text.starts_with("\\\\")
                || (text.len() > 2 && text.as_bytes()[1] == b':' && text.as_bytes()[2] == b'\\') =>
        {
            Value::String("[local-path]".to_string())
        }
        _ => value.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_is_bounded_and_sensitive_values_are_removed() {
        clear("preview-test");
        record(
            "preview-test",
            "info",
            "network",
            "range",
            serde_json::json!({"url": "https://example.test/a?token=secret", "cookie": "nope"}),
        );
        for index in 0..MAX_EVENTS_PER_PREVIEW + 4 {
            record("preview-test", "info", "player", "tick", serde_json::json!({"index": index}));
        }
        let snapshot = snapshot("preview-test", None);
        assert_eq!(snapshot.events.len(), MAX_EVENTS_PER_PREVIEW);
        let first = snapshot.events.first().unwrap();
        assert!(first.sequence > 1);
        clear("preview-test");
    }
}
