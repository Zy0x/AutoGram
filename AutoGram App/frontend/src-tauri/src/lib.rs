// AutoGram desktop core — isolated worker process management + P0 secrets
// Hybrid: pure-local logic in `core` (Rust-first); Telegram stays Python.
#![allow(dead_code, unused_variables, unused_imports, non_snake_case)]

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
fn studio_set_transfer_paused(paused: bool, transfer_id: Option<String>) -> bool {
    core::job_queue::set_transfer_paused(transfer_id.as_deref(), paused);
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

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TgSendRemoteUrlCloudRequest {
    session: String,
    api_id: i64,
    api_hash: String,
    chat_id: String,
    url: String,
    #[serde(default)]
    caption: String,
    #[serde(default)]
    as_document: bool,
    #[serde(default)]
    silent: bool,
    #[serde(default)]
    spoiler: bool,
    topic_id: Option<i64>,
    schedule_date: Option<i64>,
    #[serde(default)]
    index: usize,
    transfer_id: Option<String>,
}

/// Explicit cloud-fetch command for a direct URL <=20 MiB. Telegram fetches
/// the media through Grammers' external-media constructor; this command never
/// creates a local temporary file and rejects unknown/oversize objects.
#[tauri::command]
fn tg_send_remote_url_cloud(
    app: AppHandle,
    request: TgSendRemoteUrlCloudRequest,
) -> Result<core::telegram_ops::UploadStepResult, String> {
    let sessions = core::grammers_ops::resolve_sessions_dir(None);
    let identity = core::telegram_ops::TelegramIdentity {
        session: request.session,
        api_id: request.api_id,
        api_hash: request.api_hash,
    };
    core::grammers_ops::upload_remote_url_blocking_topic_with_app(
        &sessions,
        &identity,
        &request.chat_id,
        &request.url,
        &request.caption,
        request.as_document,
        request.silent,
        request.spoiler,
        request.index,
        request.topic_id,
        request.schedule_date,
        Some(app),
        request.transfer_id,
        "cloud_fetch",
        None,
    )
    .map_err(|error| error.user_message())
}

#[tauri::command]
fn remote_transfer_preflight(
    request: core::remote_transfer::models::RemotePreflightRequest,
) -> Result<core::remote_transfer::models::RemotePreflightReport, String> {
    core::remote_transfer::RemoteTransferEngine::preflight(&request)
}

#[tauri::command]
fn remote_transfer_create(
    job: core::remote_transfer::models::RemoteTransferJob,
) -> Result<String, String> {
    let job_id = job.job_id.clone();
    core::remote_transfer::RemoteTransferStore::insert_job(&job)?;
    Ok(job_id)
}

#[tauri::command]
fn remote_transfer_pause(job_id: String) -> Result<(), String> {
    core::remote_transfer::RemoteTransferEngine::pause_job(&job_id)
}

#[tauri::command]
fn remote_transfer_resume(
    app: AppHandle,
    job_id: String,
    session: String,
    api_id: i64,
    api_hash: String,
) -> Result<core::telegram_ops::UploadStepResult, String> {
    let identity = core::telegram_ops::TelegramIdentity {
        session,
        api_id,
        api_hash,
    };
    core::remote_transfer::RemoteTransferEngine::execute_job_sync(&job_id, &identity, Some(&app))
}

#[tauri::command]
fn remote_transfer_cancel(job_id: String) -> Result<(), String> {
    core::remote_transfer::RemoteTransferEngine::cancel_job(&job_id)
}

#[tauri::command]
fn remote_transfer_cleanup(job_id: String) -> Result<(), String> {
    core::remote_transfer::RemoteTransferEngine::cleanup_job(&job_id)
}

#[tauri::command]
fn remote_transfer_list_recovery() -> Result<Vec<core::remote_transfer::models::RemoteRecoveryItem>, String> {
    core::remote_transfer::RemoteTransferStore::list_recoverable_jobs()
}

#[tauri::command]
fn remote_transfer_get_job(
    job_id: String,
) -> Result<Option<core::remote_transfer::models::RemoteTransferJob>, String> {
    core::remote_transfer::RemoteTransferStore::get_job(&job_id)
}

#[tauri::command]
fn remote_transfer_save_resolver_state(
    state: core::remote_transfer::models::RemoteResolverState,
) -> Result<(), String> {
    core::remote_transfer::RemoteTransferStore::upsert_resolver_state(&state)
}

#[tauri::command]
fn remote_transfer_get_resolver_state(
    job_id: String,
) -> Result<Option<core::remote_transfer::models::RemoteResolverState>, String> {
    core::remote_transfer::RemoteTransferStore::get_resolver_state(&job_id)
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
        return Err(format!("worker arguments rejected: {e}"));
    }

    let daemon = match resolve_daemon_script(&app) {
        Ok(d) => d,
        Err(e) => return Err(format!("legacy worker unavailable: {e}")),
    };

    let mut cmd = build_python_command(&daemon, &args);
    match cmd.output() {
        Ok(output) => Ok(WorkerOnceResult {
            code: output.status.code().unwrap_or(1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        }),
        Err(e) => Err(format!("legacy worker execution failed: {e}")),
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
fn jobs_decision_inbox(job_id: Option<i64>) -> Result<Vec<core::jobs_db::DecisionInboxRow>, String> {
    core::jobs_db::list_decision_inbox(job_id)
}

#[tauri::command]
fn jobs_resolve_decision(decision_id: i64, decision: String) -> Result<(), String> {
    core::jobs_db::resolve_decision(decision_id, &decision)
}

#[tauri::command]
fn jobs_validate_schedule(schedule: core::forwarder_scheduler::ScheduleSpec) -> Result<(), String> {
    core::forwarder_scheduler::validate_schedule(&schedule)
}

#[tauri::command]
fn jobs_start_execution(job_id: i64) -> Result<i64, String> {
    core::jobs_db::start_execution(job_id)
}

#[tauri::command]
async fn jobs_run_migration(
    app: AppHandle,
    job_id: i64,
    max_messages: Option<usize>,
) -> Result<core::migration_run::MigrationRunResult, String> {
    ensure_sessions_dir_env(&app);
    let api_id = secrets::get_credential(app.clone(), "API_ID".to_string())
        .await?
        .ok_or_else(|| "API_ID belum tersimpan di secure credential vault".to_string())?
        .parse::<i64>()
        .map_err(|_| "API_ID di secure credential vault tidak valid".to_string())?;
    let api_hash = secrets::get_credential(app.clone(), "API_HASH".to_string())
        .await?
        .ok_or_else(|| "API_HASH belum tersimpan di secure credential vault".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        core::migration_run::run_job_forward_mvp(
            job_id,
            api_id,
            &api_hash,
            max_messages.unwrap_or(0),
        )
    })
    .await
    .map_err(|e| format!("migration task failed: {e}"))?
}

#[tauri::command]
async fn jobs_dry_run(
    app: AppHandle,
    job_id: i64,
) -> Result<core::migration_run::MigrationRunResult, String> {
    ensure_sessions_dir_env(&app);
    let api_id = secrets::get_credential(app.clone(), "API_ID".to_string())
        .await?
        .ok_or_else(|| "API_ID belum tersimpan di secure credential vault".to_string())?
        .parse::<i64>()
        .map_err(|_| "API_ID di secure credential vault tidak valid".to_string())?;
    let api_hash = secrets::get_credential(app.clone(), "API_HASH".to_string())
        .await?
        .ok_or_else(|| "API_HASH belum tersimpan di secure credential vault".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        core::migration_run::dry_run_job(job_id, api_id, &api_hash)
    })
    .await
    .map_err(|e| format!("dry-run task failed: {e}"))?
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
fn stream_server_port(app: tauri::AppHandle) -> u16 {
    let mut port = core::stream_server::stream_port();
    if port == 0 {
        if let Ok(worker) = resolve_worker_dir(&app) {
            let reg = worker.join("cache").join("stream_registry");
            port = core::stream_server::ensure_started(reg);
        }
    }
    port
}

#[tauri::command]
fn get_remote_stream_proxy_url(app: tauri::AppHandle, url: String, referer: Option<String>) -> Result<String, String> {
    let u_clean = url.trim();
    if u_clean.is_empty() {
        return Err("empty URL".into());
    }
    // The local range proxy must not turn a UI-controlled URL into an SSRF
    // primitive. Redirects are resolved/validated by the remote resolver first.
    core::remote_link_resolver::ensure_public_remote_url(u_clean)?;
    let mut port = core::stream_server::stream_port();
    if port == 0 {
        if let Ok(worker) = resolve_worker_dir(&app) {
            let reg = worker.join("cache").join("stream_registry");
            port = core::stream_server::ensure_started(reg);
        }
    }
    if port == 0 {
        return Ok(u_clean.to_string());
    }
    let enc_url = urlencoding::encode(u_clean);
    let mut proxy_url = format!("http://127.0.0.1:{port}/proxy_remote?url={enc_url}");
    if let Some(ref_val) = referer.filter(|value| !value.trim().is_empty()) {
        proxy_url.push_str("&referer=");
        proxy_url.push_str(&urlencoding::encode(&ref_val));
    }
    Ok(proxy_url)
}

#[tauri::command]
fn stream_status_local(stream_id: String) -> core::stream_server::StreamStatusDto {
    core::stream_server::status_of(&stream_id)
}

#[tauri::command]
fn preview_diagnostics_snapshot(
    stream_id: String,
    after_sequence: Option<u64>,
) -> core::preview_diagnostics::PreviewDiagnosticsSnapshot {
    core::preview_diagnostics::snapshot(&stream_id, after_sequence)
}

#[tauri::command]
fn preview_diagnostics_clear(stream_id: String) {
    core::preview_diagnostics::clear(&stream_id);
}

#[tauri::command]
fn preview_traffic_observe(
    runway_seconds: Option<f64>,
    playback_active: bool,
) -> core::traffic_governor::TrafficSnapshot {
    core::traffic_governor::observe_preview(runway_seconds, playback_active);
    core::traffic_governor::snapshot()
}

#[tauri::command]
fn traffic_governor_configure(upload_concurrency: u32, download_concurrency: u32) {
    core::traffic_governor::configure_ceiling(upload_concurrency, download_concurrency);
}

#[tauri::command]
fn traffic_governor_set_data_saver(enabled: bool) {
    core::traffic_governor::set_data_saver(enabled);
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
        core::zip_local::extract_zip_entry(
            &archive_path,
            &entry_name,
            &dest_path,
            password.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("zip extract task failed: {e}"))?
}

#[tauri::command]
async fn zip_create_from_files(
    output_path: String,
    entries: Vec<core::zip_local::ZipCreateEntry>,
) -> Result<core::zip_local::ZipCreateResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core::zip_local::create_zip_from_files(&output_path, &entries)
    })
    .await
    .map_err(|e| format!("zip create task failed: {e}"))?
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
async fn tg_zip_thumbnail_sparse(
    opts: core::grammers_sparse_zip::SparseZipOpts,
    entry_name: String,
    password: Option<String>,
) -> Result<core::zip_local::ZipEntryPreview, String> {
    core::grammers_sparse_zip::preview_zip_thumbnail_sparse(opts, entry_name, password)
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
fn normalize_job_config_v2(raw: serde_json::Value) -> Result<String, String> {
    core::forwarder_contract::normalize_job_config_json(&raw.to_string())
}

#[tauri::command]
fn forwarder_feature_flags() -> core::forwarder_contract::ForwarderFeatureFlags {
    core::forwarder_contract::ForwarderFeatureFlags::resolve()
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

#[tauri::command]
fn studio_dismiss_transfer(transfer_id: String) -> Result<bool, String> {
    core::job_queue::dismiss_transfer(&transfer_id)
}

#[tauri::command]
fn studio_clear_transfers(session: Option<String>) -> Result<usize, String> {
    core::job_queue::clear_transfers(session.as_deref())
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

#[tauri::command]
async fn save_upload_thumbnail(
    source_path: String,
    jpeg_base64: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core::universal_thumbnail::save_upload_thumbnail_base64(&source_path, &jpeg_base64)
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("thumbnail join error: {e}"))?
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
async fn tg_probe_session(
    app: AppHandle,
    session: String,
) -> core::grammers_ops::SessionProbeResult {
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
async fn tg_chat_action(
    app: AppHandle,
    request: core::telegram_ops::ChatActionRequest,
) -> Result<core::telegram_ops::OpResult<core::grammers_ops::ChatActionResult>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || core::telegram_ops::tg_chat_action(request))
        .await
        .map_err(|e| format!("native chat action task failed: {e}"))
}

#[tauri::command]
async fn tg_inspect_chat_target(
    app: AppHandle,
    request: core::telegram_ops::ChatTargetInspectionRequest,
) -> Result<core::telegram_ops::OpResult<core::grammers_ops::ChatTargetInspection>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || {
        core::telegram_ops::tg_inspect_chat_target(request)
    })
    .await
    .map_err(|e| format!("native chat inspection task failed: {e}"))
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
async fn tg_save_exact_media_statistics(
    app: AppHandle,
    request: core::telegram_ops::SaveExactMediaStatisticsRequest,
) -> Result<core::telegram_ops::OpResult<bool>, String> {
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || {
        core::telegram_ops::tg_save_exact_media_statistics(request)
    })
    .await
    .map_err(|e| format!("native save exact media statistics task failed: {e}"))
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
async fn tg_start_media_index_job(
    app: AppHandle,
    manager: tauri::State<'_, core::media_index_worker::MediaIndexJobManager>,
    request: core::media_index_types::StartMediaIndexJobRequest,
    on_event: tauri::ipc::Channel<core::media_index_types::MediaIndexEvent>,
) -> Result<core::media_index_types::StartMediaIndexJobResponse, core::tg_error::TgErrorPublic> {
    ensure_sessions_dir_env(&app);
    manager
        .start_job(
            request,
            core::media_index_worker::FnEventSink(move |evt| on_event.send(evt).is_ok()),
        )
        .await
}

#[tauri::command]
async fn tg_attach_media_index_job_channel(
    manager: tauri::State<'_, core::media_index_worker::MediaIndexJobManager>,
    job_id: u64,
    on_event: tauri::ipc::Channel<core::media_index_types::MediaIndexEvent>,
) -> Result<core::media_index_types::AttachMediaIndexJobResponse, core::tg_error::TgErrorPublic> {
    manager
        .attach_channel(
            job_id,
            core::media_index_worker::FnEventSink(move |evt| on_event.send(evt).is_ok()),
        )
        .await
}

#[tauri::command]
async fn tg_detach_media_index_job_channel(
    manager: tauri::State<'_, core::media_index_worker::MediaIndexJobManager>,
    job_id: u64,
    subscriber_id: u64,
    generation: u64,
) -> Result<core::media_index_types::DetachMediaIndexJobResponse, String> {
    Ok(manager
        .detach_channel(job_id, subscriber_id, generation)
        .await)
}

#[tauri::command]
async fn tg_ack_media_index_page(
    manager: tauri::State<'_, core::media_index_worker::MediaIndexJobManager>,
    ack: core::media_index_types::MediaIndexPageAck,
) -> Result<core::media_index_types::MediaIndexAckResult, String> {
    Ok(manager.process_ack(ack).await)
}

#[tauri::command]
async fn tg_pause_media_index_job(
    manager: tauri::State<'_, core::media_index_worker::MediaIndexJobManager>,
    job_id: u64,
) -> Result<core::media_index_types::MediaIndexControlResponse, String> {
    Ok(manager.pause_job(job_id).await)
}

#[tauri::command]
async fn tg_resume_media_index_job(
    manager: tauri::State<'_, core::media_index_worker::MediaIndexJobManager>,
    job_id: u64,
) -> Result<core::media_index_types::MediaIndexControlResponse, String> {
    Ok(manager.resume_job(job_id).await)
}

#[tauri::command]
async fn tg_cancel_media_index_job(
    manager: tauri::State<'_, core::media_index_worker::MediaIndexJobManager>,
    job_id: u64,
) -> Result<core::media_index_types::MediaIndexControlResponse, String> {
    Ok(manager.cancel_job(job_id).await)
}

#[tauri::command]
async fn tg_get_media_index_job_status(
    manager: tauri::State<'_, core::media_index_worker::MediaIndexJobManager>,
    job_id: u64,
) -> Result<Option<core::media_index_types::MediaIndexJobStatus>, String> {
    Ok(manager.get_job_status(job_id).await)
}

// ── P2.5 CHANNEL SYNC TAURI COMMANDS ──

#[tauri::command]
async fn tg_start_channel_sync(
    app: AppHandle,
    manager: tauri::State<'_, core::channel_sync_manager::ChannelSyncManager>,
    request: core::channel_sync_types::StartChannelSyncRequest,
    on_event: tauri::ipc::Channel<core::channel_sync_types::ChannelSyncEvent>,
) -> Result<core::channel_sync_types::StartChannelSyncResponse, core::tg_error::TgErrorPublic> {
    ensure_sessions_dir_env(&app);
    manager
        .start_sync(
            request,
            core::channel_sync_worker::FnChannelSyncEventSink(move |evt| {
                on_event.send(evt).is_ok()
            }),
        )
        .await
}

#[tauri::command]
async fn tg_attach_channel_sync(
    manager: tauri::State<'_, core::channel_sync_manager::ChannelSyncManager>,
    sync_id: u64,
    on_event: tauri::ipc::Channel<core::channel_sync_types::ChannelSyncEvent>,
) -> Result<core::channel_sync_types::AttachChannelSyncResponse, core::tg_error::TgErrorPublic> {
    manager
        .attach_channel(
            sync_id,
            core::channel_sync_worker::FnChannelSyncEventSink(move |evt| {
                on_event.send(evt).is_ok()
            }),
        )
        .await
}

#[tauri::command]
async fn tg_detach_channel_sync(
    manager: tauri::State<'_, core::channel_sync_manager::ChannelSyncManager>,
    sync_id: u64,
    subscriber_id: u64,
    generation: u64,
) -> Result<core::channel_sync_types::DetachChannelSyncResponse, String> {
    Ok(manager
        .detach_channel(sync_id, subscriber_id, generation)
        .await)
}

#[tauri::command]
async fn tg_ack_channel_sync_batch(
    manager: tauri::State<'_, core::channel_sync_manager::ChannelSyncManager>,
    ack: core::channel_sync_types::ChannelSyncAck,
) -> Result<core::channel_sync_types::ChannelSyncAckResult, String> {
    Ok(manager.process_ack(ack).await)
}

#[tauri::command]
async fn tg_pause_channel_sync(
    manager: tauri::State<'_, core::channel_sync_manager::ChannelSyncManager>,
    sync_id: u64,
) -> Result<core::channel_sync_types::ChannelSyncControlResponse, String> {
    Ok(manager.pause_sync(sync_id).await)
}

#[tauri::command]
async fn tg_resume_channel_sync(
    manager: tauri::State<'_, core::channel_sync_manager::ChannelSyncManager>,
    sync_id: u64,
) -> Result<core::channel_sync_types::ChannelSyncControlResponse, String> {
    Ok(manager.resume_sync(sync_id).await)
}

#[tauri::command]
async fn tg_stop_channel_sync(
    manager: tauri::State<'_, core::channel_sync_manager::ChannelSyncManager>,
    sync_id: u64,
) -> Result<core::channel_sync_types::ChannelSyncControlResponse, String> {
    Ok(manager.stop_sync(sync_id).await)
}

#[tauri::command]
async fn tg_set_channel_sync_active_view(
    manager: tauri::State<'_, core::channel_sync_manager::ChannelSyncManager>,
    sync_id: u64,
    is_active: bool,
) -> Result<(), String> {
    manager.set_active_view(sync_id, is_active).await;
    Ok(())
}

#[tauri::command]
async fn tg_complete_channel_sync_reconcile(
    manager: tauri::State<'_, core::channel_sync_manager::ChannelSyncManager>,
    sync_id: u64,
    latest_pts: i32,
) -> Result<bool, String> {
    Ok(manager.complete_reconcile(sync_id, latest_pts).await)
}

#[tauri::command]
async fn tg_run_garbage_collection() -> Result<core::memory_gc::MemoryGcReport, String> {
    Ok(core::memory_gc::run_garbage_collection_pass())
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
async fn tg_search_password_candidates(
    app: AppHandle,
    request: core::telegram_ops::SearchPasswordCandidatesRequest,
) -> Result<core::telegram_ops::OpResult<core::telegram_ops::SearchPasswordCandidatesResult>, String>
{
    ensure_sessions_dir_env(&app);
    tauri::async_runtime::spawn_blocking(move || {
        core::telegram_ops::tg_search_password_candidates(request)
    })
    .await
    .map_err(|e| format!("native password candidate search task failed: {e}"))
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

// Production Drive filesystem engine. Metadata is local-first while Telegram
// remains the encrypted transport and durable media storage backend.

#[tauri::command]
async fn drive_engine_status() -> Result<core::drive_engine::DriveEngineStatus, String> {
    tauri::async_runtime::spawn_blocking(core::drive_engine::status)
        .await
        .map_err(|error| format!("drive_engine_status task failed: {error}"))?
}

#[tauri::command]
async fn drive_engine_create_drive(
    request: core::drive_engine::CreateDriveRequest,
) -> Result<core::drive_engine::DriveRecord, String> {
    tauri::async_runtime::spawn_blocking(move || core::drive_engine::create_drive(request))
        .await
        .map_err(|error| format!("drive_engine_create_drive task failed: {error}"))?
}

#[tauri::command]
async fn drive_engine_list_drives(
    request: core::drive_engine::ListDrivesRequest,
) -> Result<core::drive_engine::DrivePage, String> {
    tauri::async_runtime::spawn_blocking(move || core::drive_engine::list_drives(request))
        .await
        .map_err(|error| format!("drive_engine_list_drives task failed: {error}"))?
}

#[tauri::command]
async fn drive_engine_create_folder(
    request: core::drive_engine::FolderMutationRequest,
) -> Result<core::drive_engine::FolderRecord, String> {
    tauri::async_runtime::spawn_blocking(move || core::drive_engine::create_folder(request))
        .await
        .map_err(|error| format!("drive_engine_create_folder task failed: {error}"))?
}

#[tauri::command]
async fn drive_engine_list_children(
    request: core::drive_engine::ListChildrenRequest,
) -> Result<core::drive_engine::FolderPage, String> {
    tauri::async_runtime::spawn_blocking(move || core::drive_engine::list_children(request))
        .await
        .map_err(|error| format!("drive_engine_list_children task failed: {error}"))?
}

#[tauri::command]
async fn drive_engine_commit_file(
    request: core::drive_engine::CommitFileRequest,
) -> Result<core::drive_engine::FileRecord, String> {
    tauri::async_runtime::spawn_blocking(move || core::drive_engine::commit_file(request))
        .await
        .map_err(|error| format!("drive_engine_commit_file task failed: {error}"))?
}

#[tauri::command]
async fn drive_engine_list_files(
    request: core::drive_engine::ListFilesRequest,
) -> Result<core::drive_engine::FilePage, String> {
    tauri::async_runtime::spawn_blocking(move || core::drive_engine::list_files(request))
        .await
        .map_err(|error| format!("drive_engine_list_files task failed: {error}"))?
}

#[tauri::command]
async fn drive_engine_soft_delete_files(
    request: core::drive_engine::DeleteFilesRequest,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || core::drive_engine::soft_delete_files(request))
        .await
        .map_err(|error| format!("drive_engine_soft_delete_files task failed: {error}"))?
}

#[tauri::command]
async fn drive_engine_move_files(
    request: core::drive_engine::MoveFilesRequest,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || core::drive_engine::move_files(request))
        .await
        .map_err(|error| format!("drive_engine_move_files task failed: {error}"))?
}

#[tauri::command]
async fn drive_engine_rename_folder(
    request: core::drive_engine::FolderMutationRequest,
) -> Result<core::drive_engine::FolderRecord, String> {
    tauri::async_runtime::spawn_blocking(move || core::drive_engine::rename_folder(request))
        .await
        .map_err(|error| format!("drive_engine_rename_folder task failed: {error}"))?
}

#[tauri::command]
async fn drive_engine_move_folder(
    request: core::drive_engine::FolderMutationRequest,
) -> Result<core::drive_engine::FolderRecord, String> {
    tauri::async_runtime::spawn_blocking(move || core::drive_engine::move_folder(request))
        .await
        .map_err(|error| format!("drive_engine_move_folder task failed: {error}"))?
}

#[tauri::command]
async fn drive_engine_soft_delete_folder(
    request: core::drive_engine::FolderMutationRequest,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || core::drive_engine::soft_delete_folder(request))
        .await
        .map_err(|error| format!("drive_engine_soft_delete_folder task failed: {error}"))?
}

#[tauri::command]
async fn drive_engine_soft_delete_drive(
    request: core::drive_engine::DriveScopeRequest,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || core::drive_engine::soft_delete_drive(request))
        .await
        .map_err(|error| format!("drive_engine_soft_delete_drive task failed: {error}"))?
}

#[tauri::command]
async fn drive_engine_create_snapshot(
    request: core::drive_engine::DriveScopeRequest,
) -> Result<core::drive_engine::SnapshotRecord, String> {
    tauri::async_runtime::spawn_blocking(move || core::drive_engine::create_snapshot(request))
        .await
        .map_err(|error| format!("drive_engine_create_snapshot task failed: {error}"))?
}

#[tauri::command]
async fn drive_engine_restore_latest_snapshot(
    request: core::drive_engine::DriveScopeRequest,
) -> Result<core::drive_engine::RecoveryRecord, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core::drive_engine::restore_latest_snapshot(request)
    })
    .await
    .map_err(|error| format!("drive_engine_restore_latest_snapshot task failed: {error}"))?
}

#[tauri::command]
async fn drive_engine_integrity_report() -> Result<core::drive_engine::IntegrityReport, String> {
    tauri::async_runtime::spawn_blocking(core::drive_engine::integrity_report)
        .await
        .map_err(|error| format!("drive_engine_integrity_report task failed: {error}"))?
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

#[tauri::command]
fn desktop_read_clipboard() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn OpenClipboard(h_wnd: *mut std::ffi::c_void) -> i32;
            fn CloseClipboard() -> i32;
            fn GetClipboardData(u_format: u32) -> *mut std::ffi::c_void;
            fn GlobalLock(h_mem: *mut std::ffi::c_void) -> *mut u16;
            fn GlobalUnlock(h_mem: *mut std::ffi::c_void) -> i32;
        }

        const CF_UNICODETEXT: u32 = 13;

        unsafe {
            if OpenClipboard(std::ptr::null_mut()) == 0 {
                return Ok(String::new());
            }

            let h_data = GetClipboardData(CF_UNICODETEXT);
            if h_data.is_null() {
                CloseClipboard();
                return Ok(String::new());
            }

            let ptr = GlobalLock(h_data);
            if ptr.is_null() {
                CloseClipboard();
                return Ok(String::new());
            }

            let mut len = 0;
            while *ptr.add(len) != 0 {
                len += 1;
            }

            let slice = std::slice::from_raw_parts(ptr, len);
            let result = String::from_utf16_lossy(slice);

            GlobalUnlock(h_data);
            CloseClipboard();

            Ok(result)
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(String::new())
    }
}

#[tauri::command]
fn desktop_write_clipboard(text: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn OpenClipboard(h_wnd: *mut std::ffi::c_void) -> i32;
            fn CloseClipboard() -> i32;
            fn EmptyClipboard() -> i32;
            fn SetClipboardData(
                u_format: u32,
                h_mem: *mut std::ffi::c_void,
            ) -> *mut std::ffi::c_void;
            fn GlobalAlloc(u_flags: u32, dw_bytes: usize) -> *mut std::ffi::c_void;
            fn GlobalLock(h_mem: *mut std::ffi::c_void) -> *mut u16;
            fn GlobalUnlock(h_mem: *mut std::ffi::c_void) -> i32;
            fn GlobalFree(h_mem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
        }

        const CF_UNICODETEXT: u32 = 13;
        const GMEM_MOVEABLE: u32 = 0x0002;

        unsafe {
            if OpenClipboard(std::ptr::null_mut()) == 0 {
                return Err("Failed to open clipboard".to_string());
            }

            EmptyClipboard();

            let utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
            let bytes_len = utf16.len() * std::mem::size_of::<u16>();

            let h_mem = GlobalAlloc(GMEM_MOVEABLE, bytes_len);
            if h_mem.is_null() {
                CloseClipboard();
                return Err("Failed to allocate global memory".to_string());
            }

            let ptr = GlobalLock(h_mem);
            if ptr.is_null() {
                GlobalFree(h_mem);
                CloseClipboard();
                return Err("Failed to lock global memory".to_string());
            }

            std::ptr::copy_nonoverlapping(utf16.as_ptr(), ptr, utf16.len());
            GlobalUnlock(h_mem);

            if SetClipboardData(CF_UNICODETEXT, h_mem).is_null() {
                GlobalFree(h_mem);
                CloseClipboard();
                return Err("Failed to set clipboard data".to_string());
            }

            CloseClipboard();
            Ok(())
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = text;
        Ok(())
    }
}

#[tauri::command]
async fn fetch_remote_text_content(
    url: String,
    user_agent: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let u_clean = url.trim();
        if u_clean.is_empty() {
            return Err("empty URL".into());
        }
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(10))
            .timeout_read(std::time::Duration::from_secs(15))
            .redirects(8)
            .build();

        let ua = user_agent.unwrap_or_else(|| {
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36".to_string()
        });

        let mut req = agent
            .get(u_clean)
            .set("User-Agent", &ua)
            .set(
                "Accept",
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            )
            .set("Accept-Language", "en-US,en;q=0.9");

        if let Some(h) = headers {
            for (k, v) in h {
                req = req.set(&k, &v);
            }
        }

        let resp = req
            .call()
            .map_err(|e| format!("HTTP request failed: {e}"))?;

        let text = resp
            .into_string()
            .map_err(|e| format!("read body failed: {e}"))?;

        Ok(text)
    })
    .await
    .map_err(|e| format!("fetch text worker task failed: {e}"))?
}

#[tauri::command]
fn fetch_pikpak_share_meta(
    share_id: String,
    pass_code: Option<String>,
    folder_id: Option<String>,
    file_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let client_id = "YUMx5nI8ZU8Ap8pm";
    let client_version = "undefined";
    let package_name = "drive.mypikpak.com";
    let timestamp = "1787297641205";
    let device_id = format!("{:032x}", rand::random::<u128>());

    let salts = [
        "fyZ4+p77W1U4zcWBUwefAIFhFxvADWtT1wzolCxhg9q7etmGUjXr",
        "uSUX02HYJ1IkyLdhINEFcCf7l2",
        "iWt97bqD/qvjIaPXB2Ja5rsBWtQtBZZmaHH2rMR41",
        "3binT1s/5a1pu3fGsN",
        "8YCCU+AIr7pg+yd7CkQEY16lDMwi8Rh4WNp5",
        "DYS3StqnAEKdGddRP8CJrxUSFh",
        "crquW+4",
        "ryKqvW9B9hly+JAymXCIfag5Z",
        "Hr08T/NDTX1oSJfHk90c",
        "i",
    ];

    let mut current_salt = format!(
        "{}{}{}{}{}",
        client_id, client_version, package_name, device_id, timestamp
    );
    for salt in salts {
        let digest = md5::compute(format!("{}{}", current_salt, salt).as_bytes());
        current_salt = format!("{:x}", digest);
    }
    let captcha_sign = format!("1.{}", current_salt);

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(10))
        .timeout_read(std::time::Duration::from_secs(15))
        .build();

    let action_endpoint = if folder_id.is_some() {
        "GET:/drive/v1/share/detail"
    } else if file_id.is_some() {
        "GET:/drive/v1/share/file_info"
    } else {
        "GET:/drive/v1/share"
    };

    let init_body = serde_json::json!({
        "client_id": client_id,
        "device_id": device_id,
        "action": action_endpoint,
        "meta": {
            "captcha_sign": captcha_sign,
            "client_version": client_version,
            "package_name": package_name,
            "user_id": "",
            "timestamp": timestamp
        }
    });

    let init_resp = agent
        .post("https://user.mypikpak.com/v1/shield/captcha/init")
        .set("Content-Type", "application/json")
        .set(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        )
        .set("x-device-id", &device_id)
        .set("x-client-id", client_id)
        .send_json(init_body)
        .map_err(|e| format!("Captcha init failed: {e}"))?;

    let init_val: serde_json::Value = init_resp
        .into_json()
        .map_err(|e| format!("Parse captcha json failed: {e}"))?;
    let captcha_token = init_val
        .get("captcha_token")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    let target_api_url = if let Some(fid) = folder_id {
        let mut u = format!(
            "https://api-drive.mypikpak.com/drive/v1/share/detail?share_id={}&parent_id={}&limit=100",
            urlencoding::encode(&share_id),
            urlencoding::encode(&fid)
        );
        if let Some(ref pc) = pass_code {
            if !pc.is_empty() {
                u.push_str(&format!("&pass_code={}", urlencoding::encode(pc)));
            }
        }
        u
    } else if let Some(flid) = file_id {
        let mut u = format!(
            "https://api-drive.mypikpak.com/drive/v1/share/file_info?share_id={}&file_id={}",
            urlencoding::encode(&share_id),
            urlencoding::encode(&flid)
        );
        if let Some(ref pc) = pass_code {
            if !pc.is_empty() {
                u.push_str(&format!("&pass_code={}", urlencoding::encode(pc)));
            }
        }
        u
    } else {
        let mut u = format!(
            "https://api-drive.mypikpak.com/drive/v1/share?share_id={}",
            urlencoding::encode(&share_id)
        );
        if let Some(ref pc) = pass_code {
            if !pc.is_empty() {
                u.push_str(&format!("&pass_code={}", urlencoding::encode(pc)));
            }
        }
        u
    };

    let share_resp = agent
        .get(&target_api_url)
        .set(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        )
        .set("x-device-id", &device_id)
        .set("x-client-id", client_id)
        .set("x-captcha-token", captcha_token)
        .set("Accept", "application/json")
        .call();

    match share_resp {
        Ok(resp) => {
            let val: serde_json::Value = resp
                .into_json()
                .map_err(|e| format!("Parse share json failed: {e}"))?;
            Ok(val)
        }
        Err(ureq::Error::Status(code, resp)) => {
            let error_val: serde_json::Value = resp.into_json().unwrap_or(serde_json::json!({
                "error": format!("HTTP {code}"),
                "error_code": code
            }));
            Ok(error_val)
        }
        Err(e) => Err(format!("Share API failed: {e}")),
    }
}

#[tauri::command]
fn fetch_native_http(
    url: String,
    method: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<String>,
) -> Result<String, String> {
    let u_clean = url.trim();
    if u_clean.is_empty() {
        return Err("empty URL".into());
    }
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(10))
        .timeout_read(std::time::Duration::from_secs(20))
        .redirects(8)
        .build();

    let method_str = method.unwrap_or_else(|| "GET".to_string()).to_uppercase();
    let mut req = match method_str.as_str() {
        "POST" => agent.post(u_clean),
        "PUT" => agent.put(u_clean),
        "HEAD" => agent.head(u_clean),
        _ => agent.get(u_clean),
    };

    if let Some(h) = headers {
        for (k, v) in h {
            req = req.set(&k, &v);
        }
    }

    let resp = if let Some(b) = body {
        req.send_string(&b)
    } else {
        req.call()
    }
    .map_err(|e| format!("HTTP request failed: {e}"))?;

    let text = resp
        .into_string()
        .map_err(|e| format!("read body failed: {e}"))?;
    Ok(text)
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHeadMeta {
    pub status: u16,
    pub content_length: Option<u64>,
    pub content_type: Option<String>,
}

#[tauri::command]
fn fetch_remote_head_meta(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<RemoteHeadMeta, String> {
    let u_clean = url.trim();
    if u_clean.is_empty() {
        return Err("empty URL".into());
    }
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(8))
        .timeout_read(std::time::Duration::from_secs(10))
        .redirects(8)
        .build();

    let mut req = agent.head(u_clean);
    if let Some(ref h) = headers {
        for (k, v) in h {
            req = req.set(k, v);
        }
    }

    match req.call() {
        Ok(resp) => {
            let status = resp.status();
            let content_length = resp
                .header("content-length")
                .and_then(|v| v.parse::<u64>().ok());
            let content_type = resp.header("content-type").map(|v| v.to_string());
            Ok(RemoteHeadMeta {
                status,
                content_length,
                content_type,
            })
        }
        Err(_) => {
            // Fallback to GET with Range: bytes=0-1 (handles Cloudflare R2 / S3 presigned URLs that block HEAD)
            let mut get_req = agent
                .get(u_clean)
                .set("Range", "bytes=0-1")
                .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
            if let Some(ref h) = headers {
                for (k, v) in h {
                    get_req = get_req.set(k, v);
                }
            }
            let resp = get_req.call().map_err(|e| format!("HEAD and GET range request failed: {e}"))?;
            let status = resp.status();
            let content_length = resp
                .header("content-range")
                .and_then(|cr| {
                    cr.split('/').last().and_then(|tot| tot.parse::<u64>().ok())
                })
                .or_else(|| {
                    resp.header("content-length").and_then(|v| v.parse::<u64>().ok())
                });
            let content_type = resp.header("content-type").map(|v| v.to_string());
            Ok(RemoteHeadMeta {
                status,
                content_length,
                content_type,
            })
        }
    }
}

#[tauri::command]
async fn fetch_remote_json_metadata(url: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let u_clean = url.trim();
        if u_clean.is_empty() {
            return Err("empty URL".into());
        }
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(10))
            .timeout_read(std::time::Duration::from_secs(15))
            .build();

        let is_tiktok_profile = (u_clean.contains("tiktok.com/@") || u_clean.contains("douyin.com/@"))
            && !u_clean.contains("/video/")
            && !u_clean.contains("/photo/")
            && !u_clean.contains("/story/");

        if is_tiktok_profile {
            let resp = agent
                .get(u_clean)
                .set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1")
                .set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                .set("Accept-Language", "en-US,en;q=0.9")
                .call()
                .map_err(|e| format!("HTTP request failed: {e}"))?;

            let html = resp
                .into_string()
                .map_err(|e| format!("read body failed: {e}"))?;

            let mut avatar_larger = None;
            let mut avatar_medium = None;
            let mut nickname = None;
            let mut signature = None;

            // 1. Direct key extraction (robust against attribute ordering or minification changes)
            if let Some(pos) = html.find("\"avatarLarger\":\"") {
                let start = pos + 16;
                if let Some(end) = html[start..].find('"') {
                    let raw = &html[start..start + end];
                    avatar_larger = Some(
                        raw.replace("\\u0026", "&")
                            .replace("\\u002F", "/")
                            .replace("\\", ""),
                    );
                }
            }

            if let Some(pos) = html.find("\"avatarMedium\":\"") {
                let start = pos + 16;
                if let Some(end) = html[start..].find('"') {
                    let raw = &html[start..start + end];
                    avatar_medium = Some(
                        raw.replace("\\u0026", "&")
                            .replace("\\u002F", "/")
                            .replace("\\", ""),
                    );
                }
            }

            if let Some(pos) = html.find("\"nickname\":\"") {
                let start = pos + 12;
                if let Some(end) = html[start..].find('"') {
                    let raw = &html[start..start + end];
                    nickname = Some(
                        raw.replace("\\u0026", "&")
                            .replace("\\u002F", "/")
                            .replace("\\", ""),
                    );
                }
            }

            if let Some(pos) = html.find("\"signature\":\"") {
                let start = pos + 13;
                if let Some(end) = html[start..].find('"') {
                    let raw = &html[start..start + end];
                    signature = Some(
                        raw.replace("\\u0026", "&")
                            .replace("\\u002F", "/")
                            .replace("\\", ""),
                    );
                }
            }

            return Ok(serde_json::json!({
                "code": 0,
                "msg": "success",
                "data": {
                    "user": {
                        "nickname": nickname,
                        "avatarLarger": avatar_larger,
                        "avatarMedium": avatar_medium,
                        "signature": signature
                    }
                },
                "html": html
            }));
        }

        let api_url = if u_clean.contains("tiktok.com") || u_clean.contains("douyin.com") {
            format!(
                "https://www.tikwm.com/api/?url={}&hd=1",
                urlencoding::encode(u_clean)
            )
        } else {
            u_clean.to_string()
        };

        let resp = agent
            .get(&api_url)
            .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 AutoGram/3.5")
            .call()
            .map_err(|e| format!("HTTP request failed: {e}"))?;

        let val = resp
            .into_json::<serde_json::Value>()
            .map_err(|e| format!("parse JSON failed: {e}"))?;

        Ok(val)
    })
    .await
    .map_err(|e| format!("fetch metadata worker task failed: {e}"))?
}

#[tauri::command]
async fn resolve_remote_link_deep(
    url: String,
    cursor: Option<core::remote_link_resolver::RemoteLinkDiscoveryCursor>,
) -> Result<core::remote_link_resolver::RemoteLinkResolution, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core::remote_link_resolver::resolve_remote_link_deep(url, cursor)
    })
    .await
    .map_err(|e| format!("deep resolve worker task failed: {e}"))?
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssistedInspectorLaunch {
    session_id: String,
}

struct AssistedInspectorSession {
    token: String,
    window_label: String,
    created_at_ms: u128,
    candidates: std::collections::HashSet<String>,
}

fn assisted_inspector_sessions() -> &'static Mutex<HashMap<String, AssistedInspectorSession>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, AssistedInspectorSession>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn assisted_inspector_script(session_id: &str, token: &str) -> String {
    let session = serde_json::to_string(session_id).unwrap_or_else(|_| "\"\"".into());
    let token = serde_json::to_string(token).unwrap_or_else(|_| "\"\"".into());
    format!(r#"(() => {{
  const sessionId = {session};
  const sessionToken = {token};
  const seen = new Set();
  const isLikelyMedia = (url) => /\.(?:mp4|m4v|mov|webm|mkv|mp3|m4a|aac|ogg|opus|wav|flac|m3u8|mpd|vtt|srt|jpg|jpeg|png|webp|gif|avif)(?:$|[?#])/i.test(url.pathname) || /(?:cdn|overfetch|googlevideo|slicedrive|aceimg|viidooy)/i.test(url.hostname);
  const report = (value) => {{
    try {{
      const url = new URL(String(value), location.href);
      if (!/^https?:$/.test(url.protocol) || !isLikelyMedia(url) || seen.has(url.href)) return;
      seen.add(url.href);
      window.__TAURI_INTERNALS__?.invoke?.('report_assisted_media_candidate', {{ sessionId, token: sessionToken, url: url.href }}).catch(() => undefined);
    }} catch (_) {{}}
  }};
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {{
    report(typeof input === 'string' ? input : input?.url);
    return originalFetch.call(this, input, init);
  }};
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, value, ...rest) {{
    report(value);
    return originalOpen.call(this, method, value, ...rest);
  }};
  try {{
    new PerformanceObserver((list) => list.getEntries().forEach((entry) => report(entry.name))).observe({{ type: 'resource', buffered: true }});
  }} catch (_) {{}}
  setInterval(() => {{
    try {{ performance.getEntriesByType('resource').forEach((entry) => report(entry.name)); }} catch (_) {{}}
  }}, 1500);
}})();"#)
}

#[tauri::command]
fn open_remote_assisted_inspector(
    app: AppHandle,
    url: String,
) -> Result<AssistedInspectorLaunch, String> {
    let target = url::Url::parse(url.trim()).map_err(|_| "remote_link_invalid_url".to_string())?;
    core::remote_link_resolver::ensure_public_remote_url(target.as_str())?;
    let session_id = format!("{:032x}", rand::random::<u128>());
    let token = format!("{:032x}", rand::random::<u128>());
    let label = format!("remote-inspector-{}", &session_id[..12]);
    let script = assisted_inspector_script(&session_id, &token);

    // Register before navigating the external page: the injected observer may
    // see a resource during the first navigation. The opaque token is scoped
    // to this incognito window and is removed again if construction fails.
    {
        let mut sessions = assisted_inspector_sessions()
            .lock()
            .map_err(|_| "remote_assisted_session_lock".to_string())?;
        sessions.retain(|_, value| now_epoch_ms().saturating_sub(value.created_at_ms) < 30 * 60 * 1000);
        sessions.insert(session_id.clone(), AssistedInspectorSession {
            token: token.clone(),
            window_label: label.clone(),
            created_at_ms: now_epoch_ms(),
            candidates: std::collections::HashSet::new(),
        });
    }

    let built = tauri::WebviewWindowBuilder::new(&app, label.clone(), tauri::WebviewUrl::External(target))
        .title("AutoGram — Assisted Remote Inspection")
        .inner_size(1080.0, 760.0)
        .min_inner_size(720.0, 540.0)
        .incognito(true)
        .initialization_script(&script)
        .build();
    if let Err(error) = built {
        if let Ok(mut sessions) = assisted_inspector_sessions().lock() {
            sessions.remove(&session_id);
        }
        return Err(format!("remote_assisted_window_failed:{error}"));
    }
    Ok(AssistedInspectorLaunch { session_id })
}

#[tauri::command]
fn report_assisted_media_candidate(
    window: tauri::WebviewWindow,
    session_id: String,
    token: String,
    url: String,
) -> Result<(), String> {
    core::remote_link_resolver::ensure_public_remote_url(&url)?;
    let mut sessions = assisted_inspector_sessions()
        .lock()
        .map_err(|_| "remote_assisted_session_lock".to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "remote_assisted_session_missing".to_string())?;
    if session.token != token || session.window_label != window.label() {
        return Err("remote_assisted_session_forbidden".into());
    }
    if now_epoch_ms().saturating_sub(session.created_at_ms) > 30 * 60 * 1000 {
        return Err("remote_assisted_session_expired".into());
    }
    if session.candidates.len() < 128 {
        session.candidates.insert(url);
    }
    Ok(())
}

#[tauri::command]
fn take_remote_assisted_candidates(session_id: String) -> Result<Vec<String>, String> {
    let mut sessions = assisted_inspector_sessions()
        .lock()
        .map_err(|_| "remote_assisted_session_lock".to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "remote_assisted_session_missing".to_string())?;
    if now_epoch_ms().saturating_sub(session.created_at_ms) > 30 * 60 * 1000 {
        sessions.remove(&session_id);
        return Err("remote_assisted_session_expired".into());
    }
    let mut candidates: Vec<String> = session.candidates.drain().collect();
    candidates.sort();
    Ok(candidates)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(core::media_index_worker::MediaIndexJobManager::new(
            core::grammers_ops::resolve_sessions_dir(None),
        ))
        .manage(core::channel_sync_manager::ChannelSyncManager::new(
            core::grammers_ops::resolve_sessions_dir(None),
        ))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            fetch_pikpak_share_meta,
            fetch_native_http,
            core::ytdlp_plugin::ytdlp_plugin_status,
            core::ytdlp_plugin::ytdlp_update_plugin,
            core::ytdlp_plugin::ffmpeg_plugin_status,
            core::ytdlp_plugin::ffmpeg_update_plugin,
            core::ytdlp_plugin::ytdlp_cancel_resolve,
            core::ytdlp_plugin::ytdlp_resolve,
            fetch_remote_json_metadata,
            fetch_remote_text_content,
            fetch_remote_head_meta,
            resolve_remote_link_deep,
            open_remote_assisted_inspector,
            report_assisted_media_candidate,
            take_remote_assisted_candidates,
            desktop_read_clipboard,
            desktop_write_clipboard,
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
            get_remote_stream_proxy_url,
            stream_status_local,
            preview_diagnostics_snapshot,
            preview_diagnostics_clear,
            preview_traffic_observe,
            traffic_governor_configure,
            traffic_governor_set_data_saver,
            stream_register_local,
            stream_unregister,
            zip_list_local,
            zip_preview_entry,
            zip_extract_entry,
            zip_create_from_files,
            tg_zip_list_sparse,
            tg_zip_preview_entry_sparse,
            tg_zip_thumbnail_sparse,
            tg_zip_extract_entry_sparse,
            file_sha256,
            file_quick_fingerprint,
            compute_progress_rate,
            normalize_job_config,
            normalize_job_config_v2,
            forwarder_feature_flags,
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
            studio_dismiss_transfer,
            studio_clear_transfers,
            studio_run_orchestrated,
            save_upload_thumbnail,
            tg_backend_status,
            tg_set_backend,
            tg_disconnect_session,
            tg_probe_session,
            tg_list_sessions,
            tg_import_telethon_session,
            tg_auth_status,
            tg_download_profile_photo,
            tg_list_dialogs,
            tg_chat_action,
            tg_inspect_chat_target,
            tg_list_dialog_filters,
            tg_get_media_statistics,
            tg_save_exact_media_statistics,
            tg_list_media,
            tg_start_media_index_job,
            tg_attach_media_index_job_channel,
            tg_detach_media_index_job_channel,
            tg_ack_media_index_page,
            tg_pause_media_index_job,
            tg_resume_media_index_job,
            tg_cancel_media_index_job,
            tg_get_media_index_job_status,
            tg_start_channel_sync,
            tg_attach_channel_sync,
            tg_detach_channel_sync,
            tg_ack_channel_sync_batch,
            tg_pause_channel_sync,
            tg_resume_channel_sync,
            tg_stop_channel_sync,
            tg_set_channel_sync_active_view,
            tg_complete_channel_sync_reconcile,
            tg_start_folder_stream,
            tg_cancel_folder_stream,
            tg_upload_file,
            tg_login,
            tg_download_file,
            tg_list_topics,
            tg_purge_inactive_sessions,
            tg_thumbs_batch,
            tg_debug_get_message,
            tg_search_password_candidates,
            tg_preview_stream,
            tg_stop_stream,
            tg_seek_stream,
            tg_delete_messages,
            tg_create_folder,
            drive_engine_status,
            drive_engine_create_drive,
            drive_engine_list_drives,
            drive_engine_create_folder,
            drive_engine_list_children,
            drive_engine_commit_file,
            drive_engine_list_files,
            drive_engine_soft_delete_files,
            drive_engine_move_files,
            drive_engine_rename_folder,
            drive_engine_move_folder,
            drive_engine_soft_delete_folder,
            drive_engine_soft_delete_drive,
            drive_engine_create_snapshot,
            drive_engine_restore_latest_snapshot,
            drive_engine_integrity_report,
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
            jobs_decision_inbox,
            jobs_resolve_decision,
            jobs_validate_schedule,
            jobs_start_execution,
            jobs_run_migration,
            jobs_dry_run,
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
            tg_send_remote_url_cloud,
            remote_transfer_preflight,
            core::remote_download::remote_download_start,
            core::remote_download::remote_download_list,
            core::remote_download::remote_download_control,
            remote_transfer_create,
            remote_transfer_pause,
            remote_transfer_resume,
            remote_transfer_cancel,
            remote_transfer_cleanup,
            remote_transfer_list_recovery,
            remote_transfer_get_job,
            remote_transfer_save_resolver_state,
            remote_transfer_get_resolver_state,
            get_available_disk_space,
            get_custom_cache_dir,
            set_custom_cache_dir,
            reset_custom_cache_dir,
            tg_run_garbage_collection,
        ])
        .setup(|app| {
            // Best-effort: create sessions/cache/temp + tighten ACLs + seed API from .env
            let _ = secrets::ensure_secure_dirs(app.handle().clone());
            // Clear any leftover ghost sessions on disk
            let _ = session_clone::clear_ghost_sessions_disk(app.handle());
            // Active RAM Garbage Collection and WAL maintenance daemon (45s period)
            core::memory_gc::start_background_gc_daemon(45);
            // Hybrid: start Rust Range HTTP server (Python GetFile publishes registry)
            let stream_reg = resolve_worker_dir(app.handle())
                .map(|w| w.join("cache").join("stream_registry"))
                .unwrap_or_else(|_| {
                    app.handle()
                        .path()
                        .app_data_dir()
                        .unwrap_or_else(|_| std::env::temp_dir())
                        .join("cache")
                        .join("stream_registry")
                });
            let port = core::stream_server::ensure_started(stream_reg);
            if port > 0 {
                crate::core::tg_log::info(
                    "stream_server",
                    "listening",
                    format!("host=127.0.0.1 port={port}"),
                );
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
