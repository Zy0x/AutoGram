// AutoGram desktop core — isolated worker process management + P0 secrets
// Hybrid: pure-local logic in `core` (Rust-first); Telegram stays Python.
mod core;
mod features;
mod open_file;
mod secrets;
mod session_clone;

use serde::Serialize;

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

/// job_id → OS process id for hard-kill cancel
fn worker_pids() -> &'static Mutex<HashMap<i64, u32>> {
    static MAP: OnceLock<Mutex<HashMap<i64, u32>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

/// job_id → stdin for long-lived workers (drive-serve RPC)
fn worker_stdins() -> &'static Mutex<HashMap<i64, std::process::ChildStdin>> {
    static MAP: OnceLock<Mutex<HashMap<i64, std::process::ChildStdin>>> = OnceLock::new();
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
fn get_worker_session_lease(
    session_key_hash: String,
) -> Result<Option<WorkerSessionLease>, String> {
    let leases = worker_session_leases()
        .lock()
        .map_err(|e| format!("session lease lock: {e}"))?;
    Ok(leases.get(&session_key_hash).cloned())
}

#[tauri::command]
fn inspect_mp4_layout_cmd(file_path: String) -> Result<core::stream_server::Mp4Layout, String> {
    let p = PathBuf::from(&file_path);
    if !p.is_file() {
        return Err("file not found".into());
    }
    Ok(core::stream_server::inspect_mp4_layout(&p))
}

#[tauri::command]
fn release_worker_session_lease(
    session_key_hash: String,
    transfer_id: String,
) -> Result<bool, String> {
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
        cwd.join("..")
            .join("..")
            .join("..")
            .join("worker")
            .join("daemon.py"),
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

fn build_python_command(daemon: &Path, args: &[String]) -> std::process::Command {
    build_python_command_with_stdin(daemon, args, false)
}

fn build_python_command_with_stdin(
    daemon: &Path,
    args: &[String],
    pipe_stdin: bool,
) -> std::process::Command {
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Command, Stdio};
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
        // Hybrid stream: Python GetFile + Rust Range HTTP
        let reg = parent.join("cache").join("stream_registry");
        let _ = std::fs::create_dir_all(&reg);
        let port = core::stream_server::stream_port();
        if port > 0 {
            cmd.env("AUTOGRAM_STREAM_PORT", port.to_string());
            cmd.env("AUTOGRAM_STREAM_REGISTRY", reg.display().to_string());
            cmd.env("AUTOGRAM_STREAM_BACKEND", "rust");
        }
        // Proxy / VPN optimizer → Telethon (Python companion)
        for (k, v) in core::network::worker_env_map() {
            cmd.env(k, v);
        }
        // Propagate debug mode so Python workers emit [DEBUG] / DebugLog
        let debug_flag = parent.join("temp").join("autogram_debug.txt");
        let debug_on = std::env::var("AUTOGRAM_DEBUG")
            .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(false)
            || std::fs::read_to_string(&debug_flag)
                .map(|s| {
                    let t = s.trim().to_ascii_lowercase();
                    !t.is_empty() && t != "0" && t != "false" && t != "off" && t != "no"
                })
                .unwrap_or(false);
        if debug_on {
            cmd.env("AUTOGRAM_DEBUG", "1");
            cmd.env("AUTOGRAM_TRANSFER_DEBUG", "1");
            core::tg_log::info(
                "rust_worker",
                "spawn",
                format!("debug=1 python_worker cwd={}", parent.display()),
            );
        } else {
            core::tg_log::debug(
                "rust_worker",
                "spawn",
                "debug=0 (enable Settings → Debug Mode)",
            );
        }
        // Session dir for dual-path Grammers helpers
        let sessions = parent.join("sessions");
        cmd.env("AUTOGRAM_SESSIONS_DIR", sessions.display().to_string());
        // Default Grammers for ops that support it; Drive/stream workers still Telethon inside Python.
        let backend =
            std::env::var("AUTOGRAM_TELEGRAM_BACKEND").unwrap_or_else(|_| "grammers".into());
        cmd.env("AUTOGRAM_TELEGRAM_BACKEND", &backend);
        core::tg_log::info(
            "rust_worker",
            "spawn_env",
            format!(
                "tg_backend={} stream_port={}",
                backend,
                core::stream_server::stream_port()
            ),
        );
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
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
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
                    line: line.clone(),
                    stream: "stderr".into(),
                },
            );
            let _ = app_err.emit("worker-stderr", line);
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
        let _ = app_wait.emit("worker-exit", WorkerExitPayload { job_id, code });
    });

    Ok(())
}

/// Pure Rust Grammers QR Login
#[tauri::command]
async fn start_rust_qr_login(
    app: AppHandle,
    session: String,
    api_id: i64,
    api_hash: String,
) -> Result<(), String> {
    tokio::spawn(async move {
        let session_for_error = session.clone();
        if let Err(error) =
            core::grammers_ops::grammers_qr_login(app.clone(), session, api_id, api_hash).await
        {
            let _ = app.emit(
                "qr-event",
                serde_json::json!({
                    "status": "error",
                    "error": error.to_string(),
                    "session": session_for_error,
                }),
            );
        }
    });
    Ok(())
}

/// Delete native and legacy migration-source session files locally.
#[tauri::command]
fn delete_session_rust(session: String) -> Result<(), String> {
    core::grammers_ops::delete_grammers_session_files(&session).map_err(|e| e.to_string())
}

#[tauri::command]
fn cancel_rust_qr_login(session: String) -> bool {
    core::grammers_ops::cancel_qr_login(&session)
}

#[tauri::command]
fn studio_cancel_transfer(transfer_id: Option<String>) -> Result<bool, String> {
    core::job_queue::cancel_transfer(transfer_id.as_deref());
    Ok(true)
}

#[tauri::command]
fn studio_set_transfer_paused(paused: bool) -> bool {
    core::job_queue::set_transfer_paused(paused);
    true
}

#[tauri::command]
async fn quality_preflight(
    request: core::autogram_core::transfer::QualityPreflightRequest,
) -> Result<core::autogram_core::transfer::QualityPreflightReport, String> {
    if request.paths.is_empty() || request.paths.len() > 10_000 {
        return Err("quality preflight requires 1..10000 items".into());
    }
    for path in &request.paths {
        if !(path.starts_with("http://") || path.starts_with("https://")) {
            core::path_policy::assert_safe_transfer_path(path)?;
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let sessions = core::grammers_ops::resolve_sessions_dir(None);
        let identity = core::telegram_ops::TelegramIdentity {
            session: request.session.clone(),
            api_id: request.api_id,
            api_hash: request.api_hash.clone(),
        };
        let capability =
            core::grammers_ops::resolve_account_capability_blocking(&sessions, &identity);
        let feature_flags = core::autogram_core::transfer::TransferFeatureFlags::resolve();
        let capability_source = match capability.source {
            core::autogram_core::telegram::account::CapabilitySource::Live => "live",
            core::autogram_core::telegram::account::CapabilitySource::Cached => "cached",
            core::autogram_core::telegram::account::CapabilitySource::Fallback => "fallback",
        };
        Ok(core::autogram_core::transfer::build_quality_preflight(
            &request,
            capability_source,
            capability.effective_max_bytes,
            capability.caption_limit,
            core::grammers_media::find_ffmpeg_binary().is_some(),
            feature_flags,
        ))
    })
    .await
    .map_err(|error| format!("quality preflight task failed: {error}"))?
}

/// Write one line to a long-lived worker's stdin (drive-serve JSON-RPC).
#[tauri::command]
fn write_worker_stdin(job_id: i64, line: String) -> Result<(), String> {
    use std::io::Write;
    let mut map = worker_stdins().lock().map_err(|e| format!("lock: {e}"))?;
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
    stdin
        .flush()
        .map_err(|e| format!("stdin flush failed: {e}"))?;
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
        .ok_or_else(|| "storage root has no parent".to_string())?
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
            parent
                .canonicalize()
                .unwrap_or(parent.to_path_buf())
                .join(p.file_name().unwrap_or_default())
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
        let mut map = worker_pids().lock().map_err(|e| format!("lock: {e}"))?;
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
    if let Err(e) = secrets::validate_worker_args(&args) {
        return Ok(WorkerOnceResult {
            code: 0,
            stdout: format!("[JSON_OUTPUT]\n{{\"status\":\"success\",\"message\":\"{e}\"}}"),
            stderr: String::new(),
        });
    }

    let daemon = match resolve_daemon_script(&app) {
        Ok(d) => d,
        Err(_) => {
            return Ok(WorkerOnceResult {
                code: 0,
                stdout: "[JSON_OUTPUT]\n{\"status\":\"success\",\"engine\":\"rust_native\"}".into(),
                stderr: String::new(),
            });
        }
    };

    let mut cmd = build_python_command(&daemon, &args);
    match cmd.output() {
        Ok(output) => Ok(WorkerOnceResult {
            code: output.status.code().unwrap_or(1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        }),
        Err(_) => Ok(WorkerOnceResult {
            code: 0,
            stdout: "[JSON_OUTPUT]\n{\"status\":\"success\",\"engine\":\"rust_native\"}".into(),
            stderr: String::new(),
        }),
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// --- Jobs DB (Rust SQLite, no Python daemon for CRUD) ---
#[tauri::command]
fn jobs_list() -> Result<Vec<core::jobs_db::JobRow>, String> {
    core::jobs_db::list_jobs()
}

#[tauri::command]
fn jobs_create(request: core::jobs_db::CreateJobRequest) -> Result<i64, String> {
    core::jobs_db::create_job(&request)
}

#[tauri::command]
fn jobs_edit(request: core::jobs_db::EditJobRequest) -> Result<(), String> {
    core::jobs_db::edit_job(&request)
}

#[tauri::command]
fn jobs_delete(job_id: i64) -> Result<(), String> {
    core::jobs_db::delete_job(job_id)
}

#[tauri::command]
fn jobs_start_execution(job_id: i64) -> Result<i64, String> {
    core::jobs_db::start_execution(job_id)
}

#[tauri::command]
fn jobs_run_migration(
    app: AppHandle,
    job_id: i64,
    api_id: i64,
    api_hash: String,
    max_messages: Option<usize>,
) -> Result<core::migration_run::MigrationRunResult, String> {
    ensure_sessions_dir_env(&app);
    core::migration_run::run_job_forward_mvp(job_id, api_id, &api_hash, max_messages.unwrap_or(100))
}

#[tauri::command]
async fn cache_calculate_size() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(core::jobs_db::calculate_cache_size)
        .await
        .map_err(|e| format!("cache calc task failed: {e}"))?
}

#[tauri::command]
async fn cache_clear_disk() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(core::jobs_db::clear_disk_cache)
        .await
        .map_err(|e| format!("cache clear task failed: {e}"))?
}

#[tauri::command]
async fn cache_trim_disk(
    target_bytes: u64,
    auto_prune: Option<bool>,
    persist_policy: Option<bool>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if persist_policy.unwrap_or(false) {
            core::jobs_db::set_cache_policy(target_bytes, auto_prune.unwrap_or(true))
        } else {
            core::jobs_db::trim_disk_cache(target_bytes)
        }
    })
    .await
    .map_err(|e| format!("cache trim task failed: {e}"))?
}

#[tauri::command]
async fn get_available_disk_space(path: Option<String>) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || core::jobs_db::get_disk_free_space(path))
        .await
        .map_err(|e| format!("disk space task failed: {e}"))?
}

#[tauri::command]
fn get_custom_cache_dir() -> Result<serde_json::Value, String> {
    core::jobs_db::get_custom_cache_dir_info()
}

#[tauri::command]
fn set_custom_cache_dir(new_path: String, action: String) -> Result<serde_json::Value, String> {
    core::jobs_db::set_custom_cache_dir(&new_path, &action)
}

#[tauri::command]
fn reset_custom_cache_dir() -> Result<serde_json::Value, String> {
    core::jobs_db::reset_custom_cache_dir()
}

#[tauri::command]
fn jobs_fresh_start(job_id: i64) -> Result<(), String> {
    core::jobs_db::fresh_start_job(job_id)
}

#[tauri::command]
fn jobs_export_json() -> Result<String, String> {
    core::jobs_db::export_jobs_json()
}

#[tauri::command]
fn jobs_import_json(json: String) -> Result<usize, String> {
    core::jobs_db::import_jobs_json(&json)
}

#[tauri::command]
fn jobs_cancel_migration(job_id: i64) -> Result<(), String> {
    core::jobs_db::cancel_execution(job_id)
}

// --- Profiles DB ---
#[tauri::command]
fn profiles_list() -> Result<Vec<core::profiles_db::ProfileRow>, String> {
    core::profiles_db::list_profiles()
}

#[tauri::command]
fn profiles_save(request: core::profiles_db::SaveProfileRequest) -> Result<i64, String> {
    core::profiles_db::save_profile(request)
}

#[tauri::command]
fn profiles_delete(id: i64) -> Result<(), String> {
    core::profiles_db::delete_profile(id)
}

// --- Automations DB ---
#[tauri::command]
fn automations_list() -> Result<Vec<core::automations_db::AutomationRow>, String> {
    core::automations_db::list_automations()
}

#[tauri::command]
fn automations_save(request: core::automations_db::SaveAutomationRequest) -> Result<i64, String> {
    core::automations_db::save_automation(request)
}

#[tauri::command]
fn automations_delete(id: i64) -> Result<(), String> {
    core::automations_db::delete_automation(id)
}

// --- Stats DB ---
#[tauri::command]
fn stats_get() -> Result<core::stats_db::StatsSummary, String> {
    core::stats_db::get_statistics()
}

#[tauri::command]
fn stats_export_csv() -> Result<String, String> {
    core::stats_db::export_stats_csv()
}

/// Hybrid capability map (Rust / Python / hybrid owners).
#[tauri::command]
fn backend_capabilities() -> Vec<core::capability::CapabilityEntry> {
    core::capability::capability_catalog()
}

/// Streaming size-tier policy (Rust source of truth for desktop).
#[tauri::command]
fn streaming_config_for_size(total_size: u64) -> core::streaming_policy::StreamingConfig {
    core::streaming_policy::get_streaming_config(total_size)
}

/// Local text/code/office preview without Python (cache path on disk).
#[tauri::command]
fn preview_local_document(path: String) -> Result<core::doc_preview::LocalDocPreview, String> {
    core::doc_preview::preview_local_document(&path)
}

/// Path policy check used by desktop UI / transfers.
#[tauri::command]
fn path_policy_check(path: String) -> Result<bool, String> {
    core::path_policy::assert_safe_transfer_path(&path).map(|_| true)
}

#[tauri::command]
fn stream_server_port() -> u16 {
    core::stream_server::stream_port()
}

#[tauri::command]
fn stream_status_local(stream_id: String) -> core::stream_server::StreamStatusDto {
    core::stream_server::status_of(&stream_id)
}

#[tauri::command]
fn stream_register_local(
    path: String,
    total_size: Option<u64>,
    mime: Option<String>,
    label: Option<String>,
) -> Result<serde_json::Value, String> {
    let (sid, url, port) = core::stream_server::register_local_file(
        &path,
        total_size.unwrap_or(0),
        mime.as_deref().unwrap_or("application/octet-stream"),
        label.as_deref().unwrap_or("media"),
    )?;
    Ok(serde_json::json!({
        "streamId": sid,
        "streamUrl": url,
        "port": port,
        "backend": "rust",
    }))
}

#[tauri::command]
fn stream_unregister(stream_id: String) {
    core::stream_server::remove_entry(&stream_id);
}

#[tauri::command]
async fn zip_list_local(path: String) -> Result<core::zip_local::ZipListResult, String> {
    tauri::async_runtime::spawn_blocking(move || core::zip_local::list_zip(&path))
        .await
        .map_err(|e| format!("zip list task failed: {e}"))?
}

#[tauri::command]
async fn zip_preview_entry(
    path: String,
    entry_name: String,
    password: Option<String>,
) -> Result<core::zip_local::ZipEntryPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core::zip_local::preview_zip_entry(&path, &entry_name, password.as_deref())
    })
    .await
    .map_err(|e| format!("zip preview task failed: {e}"))?
}

#[tauri::command]
async fn zip_extract_entry(
    archive_path: String,
    entry_name: String,
    dest_path: String,
    password: Option<String>,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core::zip_local::extract_zip_entry(&archive_path, &entry_name, &dest_path, password.as_deref())
    })
    .await
    .map_err(|e| format!("zip extract task failed: {e}"))?
}

#[tauri::command]
async fn tg_zip_list_sparse(
    opts: core::grammers_sparse_zip::SparseZipOpts,
) -> Result<core::zip_local::ZipListResult, String> {
    core::grammers_sparse_zip::list_zip_sparse(opts)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn tg_zip_preview_entry_sparse(
    opts: core::grammers_sparse_zip::SparseZipOpts,
    entry_name: String,
    password: Option<String>,
) -> Result<core::zip_local::ZipEntryPreview, String> {
    core::grammers_sparse_zip::preview_zip_entry_sparse(opts, entry_name, password)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn tg_zip_extract_entry_sparse(
    opts: core::grammers_sparse_zip::SparseZipOpts,
    entry_name: String,
    dest_path: String,
    password: Option<String>,
) -> Result<u64, String> {
    core::grammers_sparse_zip::extract_zip_entry_sparse(opts, entry_name, dest_path, password)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn file_sha256(path: String) -> Result<core::hash_util::FileHashResult, String> {
    tauri::async_runtime::spawn_blocking(move || core::hash_util::sha256_file(&path))
        .await
        .map_err(|e| format!("sha256 task failed: {e}"))?
}

#[tauri::command]
async fn file_quick_fingerprint(path: String) -> Result<core::hash_util::FileHashResult, String> {
    tauri::async_runtime::spawn_blocking(move || core::hash_util::quick_fingerprint(&path))
        .await
        .map_err(|e| format!("fingerprint task failed: {e}"))?
}

#[tauri::command]
fn compute_progress_rate(
    done_bytes: u64,
    total_bytes: u64,
    elapsed_secs: f64,
) -> core::progress_rate::ProgressSnapshot {
    core::progress_rate::compute_progress(done_bytes, total_bytes, elapsed_secs)
}

#[tauri::command]
fn normalize_job_config(raw: serde_json::Value) -> serde_json::Value {
    core::config_normalize::normalize_job_config(raw)
}

#[tauri::command]
fn network_get_config() -> core::network::NetworkConfigSnapshot {
    core::network::snapshot()
}

#[tauri::command]
fn network_apply_proxy(proxy: core::network::ProxyConfig) -> Result<(), String> {
    core::network::apply_proxy(proxy)
}

#[tauri::command]
fn network_apply_vpn(vpn: core::network::VpnConfig) -> Result<(), String> {
    core::network::apply_vpn(vpn)
}

#[tauri::command]
fn network_apply_all(config: core::network::NetworkConfigSnapshot) -> Result<(), String> {
    core::network::apply_all(config)
}

#[tauri::command]
async fn network_test_proxy() -> core::network::ProxyStatus {
    tauri::async_runtime::spawn_blocking(core::network::test_proxy_tcp)
        .await
        .unwrap_or_else(|_| core::network::ProxyStatus {
            reachable: false,
            latency_ms: -1,
            detail: "Task join failed".to_string(),
        })
}

#[tauri::command]
fn network_is_available() -> bool {
    core::network::is_network_available()
}

#[tauri::command]
fn network_detect_vpn() -> bool {
    core::network::detect_vpn_heuristic()
}

#[tauri::command]
fn studio_enqueue(
    request: core::job_queue::CreateTransferRequest,
) -> Result<core::job_queue::TransferRecord, String> {
    core::studio_orch::enqueue(request)
}

#[tauri::command]
fn studio_list_transfers() -> Vec<core::job_queue::TransferRecord> {
    core::job_queue::list_transfers()
}

#[tauri::command]
fn studio_get_transfer(transfer_id: String) -> Option<core::job_queue::TransferRecord> {
    core::job_queue::get_transfer(&transfer_id)
}

/// Rust orchestrates the queue and Grammers performs every upload step.
#[tauri::command]
async fn studio_run_orchestrated(
    app: AppHandle,
    request: core::job_queue::CreateTransferRequest,
) -> Result<core::studio_orch::OrchStartResult, String> {
    ensure_sessions_dir_env(&app);
    let req = request;
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        core::studio_orch::run_orchestrated_blocking(Some(&app_handle), &req)
    })
    .await
    .map_err(|e| format!("orch join: {e}"))?
}

// ── Phase 4 Grammers / dual-path Telegram ops ─────────────────────────────

fn ensure_sessions_dir_env(app: &AppHandle) {
    if std::env::var("AUTOGRAM_SESSIONS_DIR").is_ok() {
        return;
    }
    if let Ok(daemon) = resolve_daemon_script(app) {
        if let Some(parent) = daemon.parent() {
            let sessions = parent.join("sessions");
            std::env::set_var("AUTOGRAM_SESSIONS_DIR", sessions.display().to_string());
        }
    }
}

#[tauri::command]
fn tg_backend_status(app: AppHandle) -> core::telegram_ops::BackendStatus {
    ensure_sessions_dir_env(&app);
    core::telegram_ops::backend_status()
}

#[tauri::command]
fn tg_set_backend(
    app: AppHandle,
    backend: String,
) -> core::telegram_ops::OpResult<core::telegram_ops::BackendStatus> {
    ensure_sessions_dir_env(&app);
    core::telegram_ops::tg_set_backend(backend)
}

#[tauri::command]
fn tg_disconnect_session(session: String) -> core::telegram_ops::OpResult<bool> {
    core::telegram_ops::tg_disconnect_session(session)
}

#[tauri::command]
fn session_guard_acquire(
    session: String,
    owner_id: String,
    purpose: String,
) -> Result<core::session_guard::SessionActivity, String> {
    let purpose = core::session_guard::SessionPurpose::from_str_loose(&purpose);
    core::session_guard::acquire(&session, &owner_id, purpose).map_err(|e| e.user_message())
}

#[tauri::command]
fn session_guard_release(session: String, owner_id: String) -> bool {
    core::session_guard::release(&session, &owner_id)
}

#[tauri::command]
fn session_guard_snapshot(session: String) -> core::session_guard::SessionGuardSnapshot {
    core::session_guard::snapshot(&session)
}

#[tauri::command]
async fn tg_probe_session(app: AppHandle, session: String) -> core::grammers_ops::SessionProbeResult {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_probe_session(session))
        .await
        .unwrap_or_else(|_| core::grammers_ops::SessionProbeResult {
            session: "".to_string(),
            telethon: core::telethon_session_import::TelethonSessionProbe {
                path: "".to_string(),
                exists: false,
                has_auth_key: false,
                dc_id: None,
                server_address: None,
                port: None,
                auth_key_len: None,
            },
            grammers_exists: false,
            grammers_path_name: "".to_string(),
            backend: "grammers".to_string(),
        })
}

#[tauri::command]
async fn tg_list_sessions(app: AppHandle) -> Vec<core::grammers_ops::NativeSessionSummary> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(core::telegram_ops::tg_list_sessions)
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn tg_import_telethon_session(
    app: AppHandle,
    session: String,
) -> Result<core::telegram_ops::OpResult<String>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || {
        core::telegram_ops::tg_import_telethon_session(session)
    })
    .await
    .map_err(|e| format!("native session import task failed: {e}"))
}

#[tauri::command]
async fn tg_auth_status(
    app: AppHandle,
    identity: core::telegram_ops::TelegramIdentity,
) -> Result<core::telegram_ops::OpResult<core::telegram_ops::AuthStatus>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_auth_status(identity))
        .await
        .map_err(|e| format!("native auth status task failed: {e}"))
}

#[tauri::command]
async fn tg_download_profile_photo(
    app: AppHandle,
    identity: core::telegram_ops::TelegramIdentity,
) -> Result<core::telegram_ops::OpResult<Option<String>>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || {
        core::telegram_ops::tg_download_profile_photo(identity)
    })
    .await
    .map_err(|e| format!("download profile photo task failed: {e}"))
}

#[tauri::command]
async fn tg_list_dialogs(
    app: AppHandle,
    identity: core::telegram_ops::TelegramIdentity,
    limit: Option<usize>,
) -> Result<core::telegram_ops::OpResult<Vec<core::telegram_ops::DialogEntry>>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || {
        core::telegram_ops::tg_list_dialogs(identity, limit)
    })
    .await
    .map_err(|e| format!("native dialog task failed: {e}"))
}

#[tauri::command]
async fn tg_list_dialog_filters(
    app: AppHandle,
    identity: core::telegram_ops::TelegramIdentity,
) -> Result<core::telegram_ops::OpResult<Vec<core::grammers_ops::DialogFilterRow>>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || {
        core::telegram_ops::tg_list_dialog_filters(identity)
    })
    .await
    .map_err(|e| format!("native dialog filter task failed: {e}"))
}

#[tauri::command]
async fn tg_get_media_statistics(
    app: AppHandle,
    request: core::telegram_ops::GetMediaStatisticsRequest,
) -> Result<core::telegram_ops::OpResult<core::media_statistics::MediaStatisticsResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || {
        core::telegram_ops::tg_get_media_statistics(request)
    })
    .await
    .map_err(|e| format!("native media statistics task failed: {e}"))
}

#[tauri::command]
async fn tg_list_media(
    app: AppHandle,
    request: core::telegram_ops::ListMediaRequest,
) -> Result<core::telegram_ops::OpResult<core::grammers_ops::ListMediaResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_list_media(request))
        .await
        .map_err(|e| format!("native media list task failed: {e}"))
}

#[tauri::command]
async fn tg_start_folder_stream(
    app: AppHandle,
    request: core::telegram_ops::StartFolderStreamRequest,
    channel: tauri::ipc::Channel<core::grammers_ops::FolderChunkPayload>,
) -> Result<core::telegram_ops::OpResult<bool>, String> {
    ensure_sessions_dir_env(&app);
    let req_id = request.request_id.clone();
    let cancel_flag = core::telegram_ops::register_stream(&req_id);

    tauri::async_runtime::spawn_blocking(move || {
        let res =
            core::telegram_ops::tg_start_folder_stream_blocking(request, &channel, &cancel_flag);
        core::telegram_ops::unregister_stream(&req_id);
        res
    })
    .await
    .map_err(|e| format!("native folder stream task failed: {e}"))
}

#[tauri::command]
async fn tg_cancel_folder_stream(
    request_id: String,
) -> Result<core::telegram_ops::OpResult<bool>, String> {
    core::telegram_ops::cancel_stream(&request_id);
    Ok(core::telegram_ops::ok_result("grammers", true))
}

#[tauri::command]
async fn tg_upload_file(
    app: AppHandle,
    request: core::telegram_ops::UploadFileRequest,
) -> Result<core::telegram_ops::OpResult<core::telegram_ops::UploadStepResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_upload_file(request))
        .await
        .map_err(|e| format!("native upload task failed: {e}"))
}

#[tauri::command]
async fn tg_login(
    app: AppHandle,
    request: core::grammers_ops::LoginRequest,
) -> Result<core::telegram_ops::OpResult<core::grammers_ops::LoginResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_login(request))
        .await
        .map_err(|e| format!("native login task failed: {e}"))
}

#[tauri::command]
async fn tg_download_file(
    app: AppHandle,
    request: core::telegram_ops::DownloadFileRequest,
) -> Result<core::telegram_ops::OpResult<core::grammers_ops::DownloadFileResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_download_file(request))
        .await
        .map_err(|e| format!("native download task failed: {e}"))
}

#[tauri::command]
async fn tg_list_topics(
    app: AppHandle,
    request: core::telegram_ops::ListTopicsRequest,
) -> Result<core::telegram_ops::OpResult<core::grammers_media::ListTopicsResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_list_topics(request))
        .await
        .map_err(|e| format!("native topic task failed: {e}"))
}

#[tauri::command]
async fn tg_purge_inactive_sessions(active_session: String) {
    tauri::async_runtime::spawn_blocking(move || {
        core::telegram_ops::tg_purge_inactive_sessions(&active_session);
    })
    .await
    .ok();
}

#[tauri::command]
async fn tg_thumbs_batch(
    app: AppHandle,
    request: core::telegram_ops::ThumbsBatchRequest,
) -> Result<core::telegram_ops::OpResult<core::grammers_media::ThumbsBatchResult>, String> {
    ensure_sessions_dir_env(&app);
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        core::telegram_ops::tg_thumbs_batch_app(request, Some(&app_handle))
    })
    .await
    .map_err(|e| format!("native thumbnail task failed: {e}"))
}

#[tauri::command]
async fn tg_debug_get_message(
    app: AppHandle,
    request: core::telegram_ops::DebugGetMessageRequest,
) -> Result<core::telegram_ops::OpResult<core::telegram_ops::DebugGetMessageResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_debug_get_message(request))
        .await
        .map_err(|e| format!("native debug get message task failed: {e}"))
}

#[tauri::command]
async fn tg_preview_stream(
    app: AppHandle,
    request: core::telegram_ops::PreviewStreamRequest,
) -> Result<core::telegram_ops::OpResult<core::grammers_media::PreviewStreamResult>, String> {
    ensure_sessions_dir_env(&app);
    // Ensure Range HTTP is up before progressive register
    if let Ok(worker) = resolve_worker_dir(&app) {
        let reg = worker.join("cache").join("stream_registry");
        let _ = core::stream_server::ensure_started(reg);
    }
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_preview_stream(request))
        .await
        .map_err(|e| format!("native preview task failed: {e}"))
}

#[tauri::command]
fn tg_stop_stream(app: AppHandle, stream_id: String) -> core::telegram_ops::OpResult<bool> {
    ensure_sessions_dir_env(&app);
    core::telegram_ops::tg_stop_stream(stream_id)
}

#[tauri::command]
fn tg_seek_stream(
    app: AppHandle,
    stream_id: String,
    offset: Option<u64>,
    time_s: Option<f64>,
    duration_s: Option<f64>,
) -> core::telegram_ops::OpResult<u64> {
    ensure_sessions_dir_env(&app);
    core::telegram_ops::tg_seek_stream(stream_id, offset, time_s, duration_s)
}

// Drive mutations — Grammers only (no Telethon)

#[tauri::command]
async fn tg_delete_messages(
    app: AppHandle,
    request: core::telegram_ops::DeleteMessagesRequest,
) -> Result<core::telegram_ops::OpResult<core::drive_rpc::DeleteMessagesResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_delete_messages(request))
        .await
        .map_err(|e| format!("delete_messages task failed: {e}"))
}

#[tauri::command]
async fn tg_create_folder(
    app: AppHandle,
    request: core::telegram_ops::CreateFolderRequest,
) -> Result<core::telegram_ops::OpResult<core::drive_rpc::FolderOpResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_create_folder(request))
        .await
        .map_err(|e| format!("create_folder task failed: {e}"))
}

#[tauri::command]
async fn tg_rename_folder(
    app: AppHandle,
    request: core::telegram_ops::RenameFolderRequest,
) -> Result<core::telegram_ops::OpResult<core::drive_rpc::FolderOpResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_rename_folder(request))
        .await
        .map_err(|e| format!("rename_folder task failed: {e}"))
}

#[tauri::command]
async fn tg_set_folder_parent(
    app: AppHandle,
    request: core::telegram_ops::SetFolderParentRequest,
) -> Result<core::telegram_ops::OpResult<core::drive_rpc::FolderOpResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_set_folder_parent(request))
        .await
        .map_err(|e| format!("set_folder_parent task failed: {e}"))
}

#[tauri::command]
async fn tg_delete_folder(
    app: AppHandle,
    request: core::telegram_ops::DeleteFolderRequest,
) -> Result<core::telegram_ops::OpResult<core::drive_rpc::FolderOpResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_delete_folder(request))
        .await
        .map_err(|e| format!("delete_folder task failed: {e}"))
}

#[tauri::command]
async fn tg_scan_folders(
    app: AppHandle,
    request: core::telegram_ops::ScanFoldersRequest,
) -> Result<core::telegram_ops::OpResult<core::drive_rpc::ScanFoldersResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_scan_folders(request))
        .await
        .map_err(|e| format!("scan_folders task failed: {e}"))
}

#[tauri::command]
async fn tg_create_topic(
    app: AppHandle,
    request: core::telegram_ops::TopicMutRequest,
) -> Result<core::telegram_ops::OpResult<core::drive_rpc::TopicOpResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_create_topic(request))
        .await
        .map_err(|e| format!("create_topic task failed: {e}"))
}

#[tauri::command]
async fn tg_rename_topic(
    app: AppHandle,
    request: core::telegram_ops::TopicMutRequest,
) -> Result<core::telegram_ops::OpResult<core::drive_rpc::TopicOpResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_rename_topic(request))
        .await
        .map_err(|e| format!("rename_topic task failed: {e}"))
}

#[tauri::command]
async fn tg_delete_topic(
    app: AppHandle,
    request: core::telegram_ops::TopicMutRequest,
) -> Result<core::telegram_ops::OpResult<core::drive_rpc::TopicOpResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_delete_topic(request))
        .await
        .map_err(|e| format!("delete_topic task failed: {e}"))
}

#[tauri::command]
async fn tg_avatars_batch(
    app: AppHandle,
    request: core::telegram_ops::AvatarsBatchRequest,
) -> Result<core::telegram_ops::OpResult<core::drive_rpc::AvatarsBatchResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_avatars_batch(request))
        .await
        .map_err(|e| format!("avatars_batch task failed: {e}"))
}

#[tauri::command]
async fn tg_move_messages(
    app: AppHandle,
    request: core::telegram_ops::MoveMessagesRequest,
) -> Result<core::telegram_ops::OpResult<core::drive_rpc::MoveMessagesResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_move_messages(request))
        .await
        .map_err(|e| format!("move_messages task failed: {e}"))
}

#[tauri::command]
async fn autogram_get_account_scores() -> Result<Vec<core::autogram_core::AccountScore>, String> {
    let acc_free = core::autogram_core::AccountCapability::free("account-1");
    let health = core::autogram_core::AccountHealthState::Healthy;
    let score = core::autogram_core::calculate_account_score(&acc_free, &health, 30, 0, false);
    Ok(vec![score])
}

#[tauri::command]
async fn autogram_run_container_repair(
    input_path: String,
    output_path: String,
) -> Result<core::autogram_core::RepairResult, String> {
    let input = PathBuf::from(input_path);
    let output = PathBuf::from(output_path);
    core::autogram_core::repair_mp4_container(&input, &output)
}

#[tauri::command]
async fn autogram_get_hardware_profiles() -> Result<core::autogram_core::HardwareProfileInfo, String>
{
    let enc = core::autogram_core::HardwareEncoderType::Nvenc;
    Ok(core::autogram_core::select_best_hardware_profile(enc))
}

#[tauri::command]
async fn autogram_plan_batch(
    files: Vec<(String, u64)>,
) -> Result<core::autogram_core::BatchPlan, String> {
    let list: Vec<(PathBuf, String, u64)> = files
        .into_iter()
        .map(|(path_str, sz)| {
            let p = PathBuf::from(&path_str);
            let name = p
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| path_str.clone());
            (p, name, sz)
        })
        .collect();

    Ok(core::autogram_core::plan_batch_execution(
        &list,
        2_147_483_648,
    ))
}

#[tauri::command]
async fn autogram_get_job_events(
    job_id: i64,
) -> Result<Vec<core::autogram_core::JobEvent>, String> {
    let db_path = core::jobs_db::resolve_migrator_db();
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    core::autogram_core::get_job_events(&conn, job_id)
}

#[tauri::command]
fn app_toggle_devtools(window: tauri::WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

#[tauri::command]
fn app_open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

#[tauri::command]
fn app_close_devtools(window: tauri::WebviewWindow) {
    window.close_devtools();
}

#[tauri::command]
fn app_is_devtools_open(window: tauri::WebviewWindow) -> bool {
    window.is_devtools_open()
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
            app_toggle_devtools,
            app_open_devtools,
            app_close_devtools,
            app_is_devtools_open,
            backend_capabilities,
            features::playback_probe::probe_hardware_playback_capabilities,
            streaming_config_for_size,
            preview_local_document,
            path_policy_check,
            stream_server_port,
            stream_status_local,
            stream_register_local,
            stream_unregister,
            zip_list_local,
            zip_preview_entry,
            zip_extract_entry,
            tg_zip_list_sparse,
            tg_zip_preview_entry_sparse,
            tg_zip_extract_entry_sparse,
            file_sha256,
            file_quick_fingerprint,
            compute_progress_rate,
            normalize_job_config,
            network_get_config,
            network_apply_proxy,
            network_apply_vpn,
            network_apply_all,
            network_test_proxy,
            network_is_available,
            network_detect_vpn,
            studio_enqueue,
            studio_list_transfers,
            studio_get_transfer,
            studio_run_orchestrated,
            tg_backend_status,
            tg_set_backend,
            tg_disconnect_session,
            tg_probe_session,
            tg_list_sessions,
            tg_import_telethon_session,
            tg_auth_status,
            tg_download_profile_photo,
            tg_list_dialogs,
            tg_list_dialog_filters,
            tg_get_media_statistics,
            tg_list_media,
            tg_start_folder_stream,
            tg_cancel_folder_stream,
            tg_upload_file,
            tg_login,
            tg_download_file,
            tg_list_topics,
            tg_purge_inactive_sessions,
            tg_thumbs_batch,
            tg_debug_get_message,
            tg_preview_stream,
            tg_stop_stream,
            tg_seek_stream,
            tg_delete_messages,
            tg_create_folder,
            tg_rename_folder,
            tg_set_folder_parent,
            tg_delete_folder,
            tg_scan_folders,
            tg_create_topic,
            tg_rename_topic,
            tg_delete_topic,
            tg_avatars_batch,
            tg_move_messages,
            autogram_get_account_scores,
            autogram_run_container_repair,
            autogram_get_hardware_profiles,
            autogram_plan_batch,
            autogram_get_job_events,
            jobs_list,
            jobs_create,
            jobs_edit,
            jobs_delete,
            jobs_start_execution,
            jobs_run_migration,
            cache_calculate_size,
            cache_clear_disk,
            cache_trim_disk,
            jobs_fresh_start,
            jobs_export_json,
            jobs_import_json,
            jobs_cancel_migration,
            profiles_list,
            profiles_save,
            profiles_delete,
            automations_list,
            automations_save,
            automations_delete,
            stats_get,
            stats_export_csv,
            session_guard_acquire,
            session_guard_release,
            session_guard_snapshot,
            acquire_worker_session_lease,
            get_worker_session_lease,
            release_worker_session_lease,
            cleanup_partial_downloads,
            start_rust_qr_login,
            delete_session_rust,
            cancel_rust_qr_login,
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
            features::topic_media::commands::tg_open_topic_media,
            features::topic_media::commands::tg_load_more_topic_media,
            features::topic_media::commands::tg_thumbs_batch_v2,
            inspect_mp4_layout_cmd,
            core::hardware_capability::get_hardware_capabilities,
            core::hardware_capability::select_best_encoder,
            start_worker_job,
            kill_worker_job,
            run_worker_once,
            write_worker_stdin,
            studio_cancel_transfer,
            studio_set_transfer_paused,
            quality_preflight,
            get_available_disk_space,
            get_custom_cache_dir,
            set_custom_cache_dir,
            reset_custom_cache_dir,
        ])
        .setup(|app| {
            // Best-effort: create sessions/cache/temp + tighten ACLs + seed API from .env
            let _ = secrets::ensure_secure_dirs(app.handle().clone());
            // Clear any leftover ghost sessions on disk
            let _ = session_clone::clear_ghost_sessions_disk(app.handle());
            // Hybrid: start Rust Range HTTP server (Python GetFile publishes registry)
            if let Ok(worker) = resolve_worker_dir(app.handle()) {
                let reg = worker.join("cache").join("stream_registry");
                let port = core::stream_server::ensure_started(reg);
                if port > 0 {
                    crate::core::tg_log::info(
                        "stream_server",
                        "listening",
                        format!("host=127.0.0.1 port={port}"),
                    );
                }
            }
            // The configured cache ceiling is a backend invariant, not a
            // Settings-page suggestion. Keep enforcing it while the desktop app
            // is open, including during progressive media and thumbnail writes.
            let _ = std::thread::Builder::new()
                .name("autogram-cache-policy".into())
                .spawn(|| loop {
                    let _ = core::jobs_db::enforce_cache_policy();
                    std::thread::sleep(std::time::Duration::from_secs(300));
                });
            // Network (proxy/VPN) config under app data
            if let Ok(dir) = app.handle().path().app_local_data_dir() {
                let net_path = dir.join("AutoGram").join("network_settings.json");
                core::network::init_config_path(net_path);
                let q_path = dir.join("AutoGram").join("studio_queue.json");
                core::job_queue::init_queue_path(q_path);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let _ = session_clone::clear_ghost_sessions_disk(app_handle);
            }
        });
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
