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

fn get_sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let worker_dir = crate::resolve_worker_dir(app)?;
    Ok(worker_dir.join("sessions"))
}

pub fn clear_ghost_sessions_disk(app: &AppHandle) -> Result<(), String> {
    let sessions_dir = get_sessions_dir(app)?;
    if !sessions_dir.exists() {
        return Ok(());
    }
    let entries = std::fs::read_dir(sessions_dir)
        .map_err(|e| format!("Failed to read sessions dir: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(filename) = path.file_name().and_then(|f| f.to_str()) {
                let filename_lower = filename.to_lowercase();
                if filename_lower.contains("_preview") || filename_lower.contains("_migration") {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn ensure_ghost_session(
    app: AppHandle,
    _session_name: String,
) -> Result<bool, String> {
    // Best-effort: clear old ghost files on disk first
    let _ = clear_ghost_sessions_disk(&app);
    Ok(true)
}

#[tauri::command]
pub async fn cleanup_ghost_session(
    app: AppHandle,
    _session_name: String,
) -> Result<bool, String> {
    let _ = clear_ghost_sessions_disk(&app);
    Ok(true)
}
