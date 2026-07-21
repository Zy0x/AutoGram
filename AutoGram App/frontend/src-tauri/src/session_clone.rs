use std::path::PathBuf;
use tauri::AppHandle;

/// No-op in V2 reborn architecture since session copying is BANNED.
#[allow(dead_code)]
pub fn clone_telegram_session_atomic(
    _app: &AppHandle,
    _session_name: &str,
    _max_wait_ms: u64,
) -> Result<PathBuf, String> {
    Ok(PathBuf::new())
}

#[tauri::command]
pub async fn ensure_ghost_session(
    _app: AppHandle,
    _session_name: String,
) -> Result<bool, String> {
    // In-memory StringSessions are created on the Python side, so no-op here
    Ok(true)
}

#[tauri::command]
pub async fn cleanup_ghost_session(
    _app: AppHandle,
    _session_name: String,
) -> Result<bool, String> {
    // No-op in V2
    Ok(true)
}
