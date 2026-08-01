//! Structured Telegram backend logging — never secrets.
//!
//! Rules:
//! - Never log api_hash, auth_key, session file bytes, phone codes, or passwords.
//! - Prefer machine-parseable key=value fragments for support.

use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static SEQ: AtomicU64 = AtomicU64::new(1);

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Redact anything that looks like a secret in free-form error strings.
pub fn redact(s: &str) -> String {
    let mut out = s.to_string();
    // Long hex blobs (api_hash-ish / auth material)
    if out.len() > 24 {
        let re_hex = out.chars().filter(|c| c.is_ascii_hexdigit()).count();
        if re_hex > 40 && re_hash_ratio(&out) > 0.7 {
            return "[redacted_blob]".into();
        }
    }
    // Common secret field patterns
    for key in ["api_hash", "apiHash", "auth_key", "password", "phone_code"] {
        if let Some(i) = out.to_lowercase().find(&key.to_lowercase()) {
            let rest = &out[i..];
            if let Some(eq) = rest.find('=') {
                let start = i + eq + 1;
                let end = out[start..]
                    .find(|c: char| c.is_whitespace() || c == ',' || c == ';' || c == '}')
                    .map(|n| start + n)
                    .unwrap_or(out.len());
                out.replace_range(start..end, "[redacted]");
            }
        }
    }
    // Paths ending in .session — keep basename only
    if out.contains(".session") {
        out = out
            .split_whitespace()
            .map(|tok| {
                if tok.contains(".session") {
                    tok.rsplit(['/', '\\']).next().unwrap_or("[session]")
                } else {
                    tok
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
    }
    out
}

fn re_hash_ratio(s: &str) -> f32 {
    let total = s.chars().filter(|c| !c.is_whitespace()).count().max(1);
    let hex = s.chars().filter(|c| c.is_ascii_hexdigit()).count();
    hex as f32 / total as f32
}

/// Safe session label for logs (name only, no path contents).
pub fn session_label(session: &str) -> String {
    let base = session.rsplit(['/', '\\']).next().unwrap_or(session).trim();
    if base.is_empty() {
        return "session:empty".into();
    }
    // Cap length
    if base.len() > 48 {
        format!("session:{}…", &base[..45])
    } else {
        format!("session:{base}")
    }
}

#[derive(Debug, Clone, Copy)]
pub enum TgLevel {
    Info,
    Warn,
    Error,
    Debug,
}

fn write_stderr_lossy(line: &str) {
    // GUI launchers may close their inherited stderr pipe. Logging must never
    // panic and abort a Grammers task when that happens on Windows.
    let mut stderr = std::io::stderr().lock();
    let _ = writeln!(stderr, "{line}");
}

/// Debug gate for verbose Rust logs (mirrors worker flag / env).
pub fn is_debug_enabled() -> bool {
    if std::env::var("AUTOGRAM_DEBUG")
        .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
    {
        return true;
    }
    if let Ok(dir) = std::env::var("AUTOGRAM_SESSIONS_DIR") {
        // sessions_dir is …/worker/sessions → flag at …/worker/temp
        let p = std::path::Path::new(&dir)
            .parent()
            .map(|w| w.join("temp").join("autogram_debug.txt"));
        if let Some(path) = p {
            if let Ok(s) = std::fs::read_to_string(path) {
                let t = s.trim().to_ascii_lowercase();
                if !t.is_empty() && t != "0" && t != "false" && t != "off" && t != "no" {
                    return true;
                }
            }
        }
    }
    false
}

/// Emit one log line to stderr (desktop console) and `log` crate.
/// Info/Debug only when debug mode is on; Warn/Error always (redacted).
pub fn emit(level: TgLevel, backend: &str, op: &str, detail: &str) {
    let verbose = is_debug_enabled();
    match level {
        TgLevel::Info | TgLevel::Debug if !verbose => return,
        _ => {}
    }
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let ms = now_ms();
    let safe = redact(detail);
    let line = format!("[autogram:tg] t={ms} seq={seq} backend={backend} op={op} {safe}");
    match level {
        TgLevel::Info => {
            log::info!("{line}");
            write_stderr_lossy(&line);
        }
        TgLevel::Warn => {
            log::warn!("{line}");
            write_stderr_lossy(&line);
        }
        TgLevel::Error => {
            log::error!("{line}");
            write_stderr_lossy(&line);
        }
        TgLevel::Debug => {
            log::debug!("{line}");
            if verbose {
                write_stderr_lossy(&line);
            }
        }
    }
}

pub fn info(backend: &str, op: &str, detail: impl AsRef<str>) {
    emit(TgLevel::Info, backend, op, detail.as_ref());
}

pub fn warn(backend: &str, op: &str, detail: impl AsRef<str>) {
    emit(TgLevel::Warn, backend, op, detail.as_ref());
}

pub fn error(backend: &str, op: &str, detail: impl AsRef<str>) {
    emit(TgLevel::Error, backend, op, detail.as_ref());
}

pub fn debug(backend: &str, op: &str, detail: impl AsRef<str>) {
    emit(TgLevel::Debug, backend, op, detail.as_ref());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_api_hash_assignment() {
        let s = redact("fail api_hash=abcdef0123456789deadbeef");
        assert!(s.contains("[redacted]"));
        assert!(!s.contains("deadbeef"));
    }

    #[test]
    fn session_label_basename() {
        assert_eq!(
            session_label(r"C:\app\sessions\Lavender"),
            "session:Lavender"
        );
    }
}
