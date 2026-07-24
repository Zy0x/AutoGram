//! Path policy (Rust) — defense in depth for upload/download paths.
//! Python worker keeps a mirror for in-process checks; desktop prefers this module.

use std::path::{Component, Path, PathBuf};

fn is_sensitive_basename(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.starts_with(".env")
        || n.ends_with(".session")
        || n.ends_with(".session-journal")
        || n.starts_with("credentials")
        || n.starts_with("secrets")
        || n == "master.key"
}

fn path_str_lower(p: &Path) -> String {
    p.to_string_lossy().to_ascii_lowercase().replace('\\', "/")
}

fn has_blocked_substr(s: &str) -> bool {
    const MARKERS: &[&str] = &[
        "/.ssh/",
        "/secrets/",
        "/windows/system32/",
        "/windows/syswow64/",
        "/program files/",
        "/program files (x86)/",
        "/$recycle.bin/",
        "/system volume information/",
        "/etc/",
        "/usr/bin/",
        "/usr/sbin/",
        "/bin/",
        "/sbin/",
        "/boot/",
        "/proc/",
        "/sys/",
        "/dev/",
    ];
    if MARKERS.iter().any(|m| s.contains(m)) {
        return true;
    }
    if s.contains("/sessions/") && !s.contains("/sessions/preview/") && !s.contains("/sessions/cache/") {
        return true;
    }
    false
}

/// True if path is forbidden as upload source or download target.
pub fn is_blocked_path(path: &Path) -> bool {
    if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
        if is_sensitive_basename(name) {
            return true;
        }
    }
    let s = path_str_lower(path);
    has_blocked_substr(&s)
}

/// Normalize to absolute path when possible.
pub fn normalize_path(path: &str) -> PathBuf {
    let p = PathBuf::from(path);
    if p.is_absolute() {
        return p;
    }
    std::env::current_dir()
        .map(|cwd| cwd.join(p))
        .unwrap_or_else(|_| PathBuf::from(path))
}

/// Reject path traversal components.
pub fn has_traversal(path: &Path) -> bool {
    path.components().any(|c| matches!(c, Component::ParentDir))
}

pub fn assert_safe_transfer_path(path: &str) -> Result<PathBuf, String> {
    let p = normalize_path(path);
    if has_traversal(&p) {
        return Err("path traversal not allowed".into());
    }
    if is_blocked_path(&p) {
        return Err("path is blocked by policy (session/system/secrets)".into());
    }
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_session_files() {
        assert!(is_blocked_path(Path::new("C:/app/sessions/Lavender.session")));
        assert!(is_blocked_path(Path::new("/home/u/.env")));
    }

    #[test]
    fn allows_normal_media() {
        assert!(!is_blocked_path(Path::new("C:/Users/me/Videos/clip.mp4")));
    }
}
