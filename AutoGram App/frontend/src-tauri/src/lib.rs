// AutoGram desktop core — isolated worker process management + P0 secrets
mod open_file;
mod secrets;
mod session_clone;

use serde::Serialize;

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

/// job_id → OS process id for hard-kill cancel
fn worker_pids() -> &'static Mutex<HashMap<i64, u32>> {
    static MAP: OnceLock<Mutex<HashMap<i64, u32>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

/// job_id → stdin for long-lived workers (drive-serve RPC)
fn worker_stdins() -> &'static Mutex<HashMap<i64, ChildStdin>> {
    static MAP: OnceLock<Mutex<HashMap<i64, ChildStdin>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Hashed Telegram session key -> exclusive transfer owner.
///
/// The raw session name and Telegram credentials never enter this map. The
/// frontend reserves the lease before stopping drive-serve so no one-shot
/// Drive worker can race into the hand-off gap.
fn worker_session_leases() -> &'static Mutex<HashMap<String, WorkerSessionLease>> {
    static MAP: OnceLock<Mutex<HashMap<String, WorkerSessionLease>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerSessionLease {
    session_key_hash: String,
    transfer_id: String,
    job_id: i64,
    acquired_at_ms: u128,
}

fn now_epoch_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn acquire_session_lease_inner(
    session_key_hash: String,
    transfer_id: String,
    job_id: i64,
) -> Result<WorkerSessionLease, String> {
    if session_key_hash.trim().is_empty() || transfer_id.trim().is_empty() {
        return Err("session lease key and transfer id are required".into());
    }
    let mut leases = worker_session_leases()
        .lock()
        .map_err(|e| format!("session lease lock: {e}"))?;
    if let Some(existing) = leases.get(&session_key_hash) {
        if existing.transfer_id == transfer_id && existing.job_id == job_id {
            return Ok(existing.clone());
        }
        return Err(format!(
            "Telegram session is already owned by transfer {}",
            existing.transfer_id
        ));
    }
    let lease = WorkerSessionLease {
        session_key_hash: session_key_hash.clone(),
        transfer_id,
        job_id,
        acquired_at_ms: now_epoch_ms(),
    };
    leases.insert(session_key_hash, lease.clone());
    Ok(lease)
}

fn release_session_lease_inner(session_key_hash: &str, transfer_id: &str) -> bool {
    let Ok(mut leases) = worker_session_leases().lock() else {
        return false;
    };
    let matches = leases
        .get(session_key_hash)
        .map(|lease| lease.transfer_id == transfer_id)
        .unwrap_or(false);
    if matches {
        leases.remove(session_key_hash);
    }
    matches
}

fn release_session_leases_for_job(job_id: i64) {
    if let Ok(mut leases) = worker_session_leases().lock() {
        leases.retain(|_, lease| lease.job_id != job_id);
    }
}

#[tauri::command]
fn acquire_worker_session_lease(
    session_key_hash: String,
    transfer_id: String,
    job_id: i64,
) -> Result<WorkerSessionLease, String> {
    acquire_session_lease_inner(session_key_hash, transfer_id, job_id)
}

#[tauri::command]
fn get_worker_session_lease(session_key_hash: String) -> Result<Option<WorkerSessionLease>, String> {
    let leases = worker_session_leases()
        .lock()
        .map_err(|e| format!("session lease lock: {e}"))?;
    Ok(leases.get(&session_key_hash).cloned())
}

#[tauri::command]
fn release_worker_session_lease(session_key_hash: String, transfer_id: String) -> Result<bool, String> {
    Ok(release_session_lease_inner(&session_key_hash, &transfer_id))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerLinePayload {
    job_id: i64,
    line: String,
    stream: String, // "stdout" | "stderr"
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerExitPayload {
    job_id: i64,
    code: i32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerOnceResult {
    code: i32,
    stdout: String,
    stderr: String,
}

fn resolve_daemon_script(app: &AppHandle) -> Result<PathBuf, String> {
    // 1) Resource dir (packaged)
    if let Ok(resource) = app.path().resource_dir() {
        let p = resource.join("worker").join("daemon.py");
        if p.exists() {
            return Ok(p);
        }
    }
    // 2) Cwd-relative candidates (dev: frontend/ or src-tauri/)
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let candidates = [
        cwd.join("daemon.py"), // already in worker/
        cwd.join("worker").join("daemon.py"),
        // AutoGram App/frontend/src-tauri -> ../../worker
        cwd.join("..").join("..").join("worker").join("daemon.py"),
        // AutoGram App/frontend -> ../worker
        cwd.join("..").join("worker").join("daemon.py"),
        cwd.join("..").join("..").join("..").join("worker").join("daemon.py"),
    ];
    for p in candidates {
        if let Ok(canon) = p.canonicalize() {
            if canon.exists() {
                return Ok(canon);
            }
        } else if p.exists() {
            return Ok(p);
        }
    }
    // 3) Walk up from cwd looking for worker/daemon.py
    let mut dir = cwd.clone();
    for _ in 0..6 {
        let p = dir.join("worker").join("daemon.py");
        if p.exists() {
            return Ok(p);
        }
        if !dir.pop() {
            break;
        }
    }
    Err(format!(
        "daemon.py not found (cwd={}). Place worker/ next to the app or set path.",
        cwd.display()
    ))
}

fn resolve_python_bin(daemon: &Path) -> PathBuf {
    // Prefer worker/venv for deps (cryptg, telethon) — critical for upload speed
    if let Some(parent) = daemon.parent() {
        #[cfg(windows)]
        let candidates = [
            parent.join("venv").join("Scripts").join("python.exe"),
            parent.join(".venv").join("Scripts").join("python.exe"),
        ];
        #[cfg(not(windows))]
        let candidates = [
            parent.join("venv").join("bin").join("python"),
            parent.join(".venv").join("bin").join("python"),
        ];
        for p in candidates {
            if p.exists() {
                return p;
            }
        }
    }
    PathBuf::from("python")
}

fn build_python_command(daemon: &Path, args: &[String]) -> Command {
    build_python_command_with_stdin(daemon, args, false)
}

fn build_python_command_with_stdin(daemon: &Path, args: &[String], pipe_stdin: bool) -> Command {
    let py = resolve_python_bin(daemon);
    let mut cmd = Command::new(&py);
    cmd.arg("-u");
    cmd.arg(daemon.as_os_str());
    cmd.args(args);
    cmd.stdin(if pipe_stdin {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    // Worker relative imports need cwd = worker directory
    if let Some(parent) = daemon.parent() {
        cmd.current_dir(parent);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
        // Do NOT use CREATE_BREAKAWAY_FROM_JOB — requires job breakaway rights and
        // commonly fails with os error 5 (Access is denied) under Tauri on Windows.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
    cmd
}

/// Hard-kill PID (and children on Windows) without removing maps.
fn kill_pid_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status();
    }
}

/// Long-running job: streams lines via events `worker-line` / `worker-exit`.
/// Does NOT use tauri-plugin-shell (avoids Windows host force-close on child exit).
/// Set `pipe_stdin` true for interactive workers (drive-serve RPC).
/// If the same job_id is already running, kills it first (kill-before-respawn).
#[tauri::command]
async fn start_worker_job(
    app: AppHandle,
    job_id: i64,
    args: Vec<String>,
    pipe_stdin: Option<bool>,
) -> Result<(), String> {
    secrets::validate_worker_args(&args)?;

    // P0: kill-before-respawn — never leave two workers on the same job_id
    // (would orphan the old PID and race on session/temp files).
    {
        if let Ok(mut map) = worker_stdins().lock() {
            map.remove(&job_id);
        }
        let old_pid = if let Ok(mut map) = worker_pids().lock() {
            map.remove(&job_id)
        } else {
            None
        };
        if let Some(pid) = old_pid {
            kill_pid_tree(pid);
            // Brief pause so .session / stdout pipes release
            thread::sleep(std::time::Duration::from_millis(180));
        }
    }

    let daemon = resolve_daemon_script(&app)?;
    let py = resolve_python_bin(&daemon);
    let use_stdin = pipe_stdin.unwrap_or(false);
    let mut cmd = build_python_command_with_stdin(&daemon, &args, use_stdin);
    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "Failed to spawn python worker: {e} (python={}, script={})",
            py.display(),
            daemon.display()
        )
    })?;

    let pid = child.id();
    if let Ok(mut map) = worker_pids().lock() {
        map.insert(job_id, pid);
    }
    if use_stdin {
        if let Some(stdin) = child.stdin.take() {
            if let Ok(mut map) = worker_stdins().lock() {
                map.insert(job_id, stdin);
            }
        }
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture worker stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture worker stderr".to_string())?;

    let app_out = app.clone();
    let jid_out = job_id;
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            let _ = app_out.emit(
                "worker-line",
                WorkerLinePayload {
                    job_id: jid_out,
                    line,
                    stream: "stdout".into(),
                },
            );
        }
    });

    let app_err = app.clone();
    let jid_err = job_id;
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            let _ = app_err.emit(
                "worker-line",
                WorkerLinePayload {
                    job_id: jid_err,
                    line,
                    stream: "stderr".into(),
                },
            );
        }
    });

    let app_wait = app.clone();
    thread::spawn(move || {
        let code = match child.wait() {
            Ok(status) => status.code().unwrap_or(0),
            Err(_) => 1,
        };
        if let Ok(mut map) = worker_pids().lock() {
            map.remove(&job_id);
        }
        if let Ok(mut map) = worker_stdins().lock() {
            map.remove(&job_id);
        }
        release_session_leases_for_job(job_id);
        // Small delay so last stdout lines flush through the other threads
        thread::sleep(std::time::Duration::from_millis(80));
        let _ = app_wait.emit(
            "worker-exit",
            WorkerExitPayload {
                job_id,
                code,
            },
        );
    });

    Ok(())
}

/// Write one line to a long-lived worker's stdin (drive-serve JSON-RPC).
#[tauri::command]
fn write_worker_stdin(job_id: i64, line: String) -> Result<(), String> {
    let mut map = worker_stdins()
        .lock()
        .map_err(|e| format!("lock: {e}"))?;
    let stdin = map
        .get_mut(&job_id)
        .ok_or_else(|| format!("No stdin for job {job_id} (is drive-serve running?)"))?;
    let mut payload = line;
    if !payload.ends_with('\n') {
        payload.push('\n');
    }
    stdin
        .write_all(payload.as_bytes())
        .map_err(|e| format!("stdin write failed: {e}"))?;
    stdin.flush().map_err(|e| format!("stdin flush failed: {e}"))?;
    Ok(())
}

/// Delete incomplete download artifacts (final path + `.part`) under allowed roots.
/// Also reads `worker/temp/drive_active_downloads.json` when `paths` is empty/None.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanupPartialResult {
    deleted: Vec<String>,
    failed: Vec<String>,
    count: u32,
}

pub(crate) fn resolve_worker_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let daemon = resolve_daemon_script(app)?;
    let parent = daemon
        .parent()
        .ok_or_else(|| "daemon has no parent".to_string())?
        .to_path_buf();
    Ok(parent.canonicalize().unwrap_or(parent))
}


fn download_allowed_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(worker) = resolve_worker_dir(app) {
        roots.push(worker.join("temp"));
        roots.push(worker.join("cache"));
        roots.push(worker.clone());
    }
    if let Ok(tmp) = std::env::temp_dir().canonicalize() {
        roots.push(tmp);
    }
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let h = PathBuf::from(&home);
        for sub in [
            "Downloads",
            "Documents",
            "Desktop",
            "Pictures",
            "Videos",
            "Music",
            "OneDrive",
        ] {
            roots.push(h.join(sub));
        }
        roots.push(h.join("OneDrive").join("Documents"));
        roots.push(h.join("OneDrive").join("Pictures"));
        roots.push(h.join("OneDrive").join("Desktop"));
        roots.push(h.join("AppData").join("Local").join("Temp"));
    }
    roots
        .into_iter()
        .filter_map(|p| {
            if p.exists() {
                Some(p.canonicalize().unwrap_or(p))
            } else {
                None
            }
        })
        .collect()
}

fn path_under_roots(path: &Path, roots: &[PathBuf]) -> bool {
    let canon = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let c = canon.to_string_lossy().to_lowercase();
    for r in roots {
        let rr = r.to_string_lossy().to_lowercase();
        if c == rr || c.starts_with(&(rr.clone() + std::path::MAIN_SEPARATOR_STR)) {
            return true;
        }
        // Windows prefix variants
        if c.starts_with(&rr) {
            return true;
        }
    }
    false
}

fn read_active_download_registry(app: &AppHandle) -> Vec<String> {
    let Ok(worker) = resolve_worker_dir(app) else {
        return vec![];
    };
    let reg = worker.join("temp").join("drive_active_downloads.json");
    let Ok(text) = std::fs::read_to_string(&reg) else {
        return vec![];
    };
    #[derive(serde::Deserialize)]
    struct Reg {
        paths: Option<Vec<String>>,
    }
    serde_json::from_str::<Reg>(&text)
        .ok()
        .and_then(|r| r.paths)
        .unwrap_or_default()
}

fn clear_active_download_registry(app: &AppHandle) {
    if let Ok(worker) = resolve_worker_dir(app) {
        let reg = worker.join("temp").join("drive_active_downloads.json");
        let _ = std::fs::remove_file(reg);
    }
}

fn try_remove_file(p: &Path, deleted: &mut Vec<String>, failed: &mut Vec<String>) {
    if !p.exists() {
        return;
    }
    match std::fs::remove_file(p) {
        Ok(()) => deleted.push(p.to_string_lossy().to_string()),
        Err(e) => failed.push(format!("{}: {e}", p.display())),
    }
}

#[tauri::command]
fn cleanup_partial_downloads(
    app: AppHandle,
    paths: Option<Vec<String>>,
) -> Result<CleanupPartialResult, String> {
    let roots = download_allowed_roots(&app);
    let mut candidates: Vec<String> = paths.unwrap_or_default();
    candidates.extend(read_active_download_registry(&app));
    // unique
    candidates.sort();
    candidates.dedup();

    let mut deleted: Vec<String> = Vec::new();
    let mut failed: Vec<String> = Vec::new();

    for raw in candidates {
        let raw = raw.trim().trim_matches('"');
        if raw.is_empty() {
            continue;
        }
        let p = PathBuf::from(raw);
        // Allow check against parent if file not yet fully written / not exist
        let check = if p.exists() {
            p.canonicalize().unwrap_or(p.clone())
        } else if let Some(parent) = p.parent() {
            parent.canonicalize().unwrap_or(parent.to_path_buf()).join(
                p.file_name().unwrap_or_default(),
            )
        } else {
            p.clone()
        };
        let under = path_under_roots(&check, &roots)
            || p.parent()
                .map(|par| path_under_roots(par, &roots))
                .unwrap_or(false);
        if !under {
            failed.push(format!("{}: outside allowed download roots", p.display()));
            continue;
        }
        // Incomplete dest + concurrent .part
        try_remove_file(&p, &mut deleted, &mut failed);
        let part = PathBuf::from(format!("{}.part", p.to_string_lossy()));
        try_remove_file(&part, &mut deleted, &mut failed);
    }

    clear_active_download_registry(&app);
    let count = deleted.len() as u32;
    Ok(CleanupPartialResult {
        deleted,
        failed,
        count,
    })
}

/// Hard-kill a running worker started via start_worker_job (Cancel).
#[tauri::command]
fn kill_worker_job(job_id: i64) -> Result<bool, String> {
    if let Ok(mut map) = worker_stdins().lock() {
        map.remove(&job_id);
    }
    let pid = {
        let mut map = worker_pids()
            .lock()
            .map_err(|e| format!("lock: {e}"))?;
        map.remove(&job_id)
    };
    let Some(pid) = pid else {
        return Ok(false);
    };
    kill_pid_tree(pid);
    Ok(true)
}

/// One-shot daemon call (list-jobs, set-status, create-job, etc.)
#[tauri::command]
async fn run_worker_once(app: AppHandle, args: Vec<String>) -> Result<WorkerOnceResult, String> {
    secrets::validate_worker_args(&args)?;
    let daemon = resolve_daemon_script(&app)?;
    let mut cmd = build_python_command(&daemon, &args);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run worker once: {e}"))?;
    Ok(WorkerOnceResult {
        code: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

/// One-shot auth_manager.py (list-sessions, login, etc.)
#[tauri::command]
async fn run_auth_manager_once(app: AppHandle, args: Vec<String>) -> Result<WorkerOnceResult, String> {
    secrets::validate_worker_args(&args)?;
    let daemon = resolve_daemon_script(&app)?;
    let auth = daemon
        .parent()
        .map(|p| p.join("auth_manager.py"))
        .ok_or_else(|| "auth_manager.py parent missing".to_string())?;
    if !auth.exists() {
        return Err(format!("auth_manager.py not found at {}", auth.display()));
    }
    let mut cmd = build_python_command(&auth, &args);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run auth_manager: {e}"))?;
    Ok(WorkerOnceResult {
        code: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            start_worker_job,
            kill_worker_job,
            acquire_worker_session_lease,
            get_worker_session_lease,
            release_worker_session_lease,
            cleanup_partial_downloads,
            write_worker_stdin,
            run_worker_once,
            run_auth_manager_once,
            secrets::get_credential,
            secrets::set_credential,
            secrets::delete_credential,
            secrets::migrate_credentials_from_webstorage,
            secrets::ensure_secure_dirs,
            secrets::write_worker_temp_file,
            secrets::delete_worker_temp_file,
            secrets::seed_api_credentials_from_env,
            session_clone::ensure_ghost_session,
            session_clone::cleanup_ghost_session,
            open_file::open_path_safe,
            open_file::open_with_dialog,
            open_file::reveal_path_safe,
            open_file::cache_file_ready,
            open_file::copy_cache_file,
        ])
        .setup(|app| {
            // Best-effort: create sessions/cache/temp + tighten ACLs + seed API from .env
            let _ = secrets::ensure_secure_dirs(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod session_lease_tests {
    use super::*;

    #[test]
    fn lease_is_atomic_and_owner_scoped() {
        let key = format!("test-key-{}", now_epoch_ms());
        let first = acquire_session_lease_inner(key.clone(), "transfer-a".into(), 42).unwrap();
        assert_eq!(first.job_id, 42);
        assert!(acquire_session_lease_inner(key.clone(), "transfer-b".into(), 43).is_err());
        assert!(!release_session_lease_inner(&key, "transfer-b"));
        assert!(release_session_lease_inner(&key, "transfer-a"));
        assert!(acquire_session_lease_inner(key.clone(), "transfer-b".into(), 43).is_ok());
        release_session_leases_for_job(43);
        assert!(worker_session_leases().lock().unwrap().get(&key).is_none());
    }
}
