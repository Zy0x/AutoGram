//! Job config normalization (Rust) — Python daemon can accept pre-cleaned config.

use serde_json::{json, Map, Value};

fn as_bool(v: &Value, default: bool) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
        Value::String(s) => {
            let s = s.to_ascii_lowercase();
            matches!(s.as_str(), "1" | "true" | "yes" | "on")
        }
        _ => default,
    }
}

fn as_i64(v: &Value, default: i64) -> i64 {
    match v {
        Value::Number(n) => n.as_i64().unwrap_or(default),
        Value::String(s) => s.parse().unwrap_or(default),
        _ => default,
    }
}

fn as_f64(v: &Value, default: f64) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(default),
        Value::String(s) => s.parse().unwrap_or(default),
        _ => default,
    }
}

/// Normalize a raw job config object (subset parity with Python config_normalize).
pub fn normalize_job_config(raw: Value) -> Value {
    let obj = match raw {
        Value::Object(m) => m,
        _ => Map::new(),
    };
    let get = |k: &str| obj.get(k).cloned().unwrap_or(Value::Null);

    let limit = as_i64(&get("limit"), 0).max(0);
    let delay = as_f64(&get("delay"), 0.0).max(0.0);
    let mode = get("mode")
        .as_str()
        .unwrap_or("copy")
        .to_ascii_lowercase();
    let mode = if matches!(mode.as_str(), "copy" | "forward" | "sync") {
        mode
    } else {
        "copy".into()
    };

    json!({
        "limit": limit,
        "delay": delay,
        "mode": mode,
        "skip_duplicates": as_bool(&get("skip_duplicates"), true),
        "preserve_albums": as_bool(&get("preserve_albums"), true),
        "include_videos": as_bool(&get("include_videos"), true),
        "include_photos": as_bool(&get("include_photos"), true),
        "include_documents": as_bool(&get("include_documents"), true),
        "include_audio": as_bool(&get("include_audio"), true),
        "dry_run": as_bool(&get("dry_run"), false),
        "topic_id": as_i64(&get("topic_id"), 0),
        "dest_topic_id": as_i64(&get("dest_topic_id"), 0),
        "backend": "rust",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_defaults() {
        let v = normalize_job_config(json!({"limit": "10", "mode": "COPY"}));
        assert_eq!(v["limit"], 10);
        assert_eq!(v["mode"], "copy");
        assert_eq!(v["skip_duplicates"], true);
    }
}
