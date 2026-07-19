use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::AppHandle;

/// Melakukan clone session SQLite secara atomic menggunakan Online Backup API.
/// Menggunakan pause file-flag agar transfer worker berhenti menulis ke DB.
pub fn clone_telegram_session_atomic(
    app: &AppHandle,
    session_name: &str,
    _max_wait_ms: u64,
) -> Result<PathBuf, String> {
    let worker = crate::resolve_worker_dir(app)?;
    let sessions_dir = worker.join("sessions");
    let temp_dir = worker.join("temp");
    
    let src = sessions_dir.join(format!("{}.session", session_name));
    let dest = sessions_dir.join(format!("{}_preview.session", session_name));
    
    if !src.exists() {
        return Err(format!("Source session not found: {}", src.display()));
    }

    // Ensure temp_dir exists
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {e}"))?;

    // STEP 1: Tulis pause flag (soft-pause transfer worker)
    let pause_flag = temp_dir.join("drive_pause.txt");
    fs::write(&pause_flag, "ghost_session_clone")
        .map_err(|e| format!("Failed to write pause flag: {e}"))?;

    // STEP 2: Tunggu settle (worker polling ~500ms-1s)
    let settle = Duration::from_millis(800);
    std::thread::sleep(settle);

    // STEP 3: Atomic SQLite Backup
    let result = (|| -> Result<(), String> {
        // Buka source: READ_ONLY + NO_MUTEX agar tidak conflict dengan writer
        let src_flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
            | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX;
        
        let src_conn = rusqlite::Connection::open_with_flags(&src, src_flags)
            .map_err(|e| format!("Cannot open source session (locked?): {e}"))?;

        // Bersihkan preview lama (termasuk WAL/SHM)
        let _ = fs::remove_file(&dest);
        let _ = fs::remove_file(sessions_dir.join(format!("{}_preview.session-wal", session_name)));
        let _ = fs::remove_file(sessions_dir.join(format!("{}_preview.session-shm", session_name)));

        let mut dest_conn = rusqlite::Connection::open(&dest)
            .map_err(|e| format!("Cannot create dest session: {e}"))?;

        // Online backup: 10 pages per step, 50ms antar step
        let backup = rusqlite::backup::Backup::new(&src_conn, &mut dest_conn)
            .map_err(|e| format!("Backup init failed: {e}"))?;
        
        backup.run_to_completion(10, Duration::from_millis(50), None)
            .map_err(|e| format!("Backup failed: {e}"))?;

        Ok(())
    })();

    // STEP 4: Selalu hapus pause flag (resume transfer)
    let _ = fs::remove_file(&pause_flag);

    match result {
        Ok(_) => Ok(dest),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn ensure_ghost_session(
    app: AppHandle,
    session_name: String,
) -> Result<bool, String> {
    let worker = crate::resolve_worker_dir(&app)?;
    let preview_path = worker.join("sessions").join(format!("{}_preview.session", session_name));
    
    // Jika sudah ada dan valid, skip clone
    if preview_path.exists() {
        if let Ok(conn) = rusqlite::Connection::open_with_flags(
            &preview_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ) {
            let valid: bool = conn.query_row(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'",
                [],
                |_| Ok(true),
            ).unwrap_or(false);
            
            if valid {
                return Ok(true);
            }
        }
        let _ = fs::remove_file(&preview_path);
    }

    clone_telegram_session_atomic(&app, &session_name, 5000)?;
    Ok(true)
}

#[tauri::command]
pub async fn cleanup_ghost_session(
    app: AppHandle,
    session_name: String,
) -> Result<bool, String> {
    let worker = crate::resolve_worker_dir(&app)?;
    let sessions_dir = worker.join("sessions");
    
    let files = [
        format!("{}_preview.session", session_name),
        format!("{}_preview.session-wal", session_name),
        format!("{}_preview.session-shm", session_name),
    ];
    
    for f in files {
        let _ = fs::remove_file(sessions_dir.join(f));
    }
    
    Ok(true)
}
