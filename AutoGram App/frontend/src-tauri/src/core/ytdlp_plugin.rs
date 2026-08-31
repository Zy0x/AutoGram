//! Updateable yt-dlp provider for Remote URL inspection.
//!
//! The standalone executable lives in app-data, not in the repository. The
//! provider checks the official yt-dlp latest-release API on a bounded cadence,
//! verifies SHA-256, installs atomically, and keeps the last known-good binary
//! when GitHub is temporarily unavailable.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Digest;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const REPOSITORY: &str = "yt-dlp/yt-dlp";
const CHECK_INTERVAL_SECS: u64 = 6 * 60 * 60;
const RESOLVE_TIMEOUT_SECS: u64 = 45;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginState {
    version: Option<String>,
    asset: Option<String>,
    sha256: Option<String>,
    updated_at: Option<u64>,
    last_checked_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtDlpPluginStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub executable: Option<String>,
    pub last_checked_at: Option<u64>,
    pub error: Option<String>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn asset_name() -> &'static str {
    if cfg!(target_os = "windows") {
        if cfg!(target_arch = "aarch64") {
            "yt-dlp_arm64.exe"
        } else {
            "yt-dlp.exe"
        }
    } else if cfg!(target_os = "macos") {
        "yt-dlp_macos"
    } else if cfg!(target_arch = "aarch64") {
        "yt-dlp_linux_aarch64"
    } else {
        "yt-dlp_linux"
    }
}

fn plugin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {e}"))?
        .join("plugins")
        .join("ytdlp-extractor");
    fs::create_dir_all(dir.join("bin")).map_err(|e| format!("create yt-dlp plugin dir: {e}"))?;
    Ok(dir)
}

fn state_path(dir: &Path) -> PathBuf {
    dir.join("runtime").join("state.json")
}

fn binary_path(dir: &Path) -> PathBuf {
    dir.join("bin").join(asset_name())
}

fn read_state(dir: &Path) -> PluginState {
    fs::read_to_string(state_path(dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_state(dir: &Path, state: &PluginState) -> Result<(), String> {
    let path = state_path(dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create yt-dlp state dir: {e}"))?;
    }
    let data =
        serde_json::to_vec_pretty(state).map_err(|e| format!("serialize yt-dlp state: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data).map_err(|e| format!("write yt-dlp state: {e}"))?;
    let backup = path.with_extension("json.old");
    if path.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(&path, &backup).map_err(|e| format!("stage yt-dlp state: {e}"))?;
    }
    if let Err(e) = fs::rename(&tmp, &path) {
        let _ = fs::remove_file(&tmp);
        if backup.exists() {
            let _ = fs::rename(&backup, &path);
        }
        return Err(format!("commit yt-dlp state: {e}"));
    }
    let _ = fs::remove_file(&backup);
    Ok(())
}

fn http_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(40))
        .redirects(4)
        .build()
}

fn latest_release() -> Result<Value, String> {
    http_agent()
        .get(&format!(
            "https://api.github.com/repos/{REPOSITORY}/releases/latest"
        ))
        .set("User-Agent", "AutoGram-ytdlp-plugin")
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("yt-dlp release lookup failed: {e}"))?
        .into_json::<Value>()
        .map_err(|e| format!("parse yt-dlp release metadata: {e}"))
}

fn asset_url(release: &Value, name: &str) -> Result<String, String> {
    release
        .get("assets")
        .and_then(Value::as_array)
        .and_then(|assets| {
            assets.iter().find_map(|asset| {
                (asset.get("name").and_then(Value::as_str) == Some(name))
                    .then(|| asset.get("browser_download_url").and_then(Value::as_str))
                    .flatten()
                    .map(str::to_owned)
            })
        })
        .ok_or_else(|| format!("yt-dlp release has no {name} asset"))
}

fn sha256_url(release: &Value) -> Result<String, String> {
    asset_url(release, "SHA2-256SUMS")
}

fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
    let mut reader = http_agent()
        .get(url)
        .set("User-Agent", "AutoGram-ytdlp-plugin")
        .call()
        .map_err(|e| format!("download yt-dlp asset failed: {e}"))?
        .into_reader();
    let mut bytes = Vec::new();
    reader
        .read_to_end(&mut bytes)
        .map_err(|e| format!("read yt-dlp asset failed: {e}"))?;
    Ok(bytes)
}

fn expected_sha256(sums: &str, asset: &str) -> Result<String, String> {
    sums.lines()
        .filter_map(|line| {
            let parts: Vec<_> = line.split_whitespace().collect();
            (parts.len() >= 2 && parts.last().map(|p| p.trim_start_matches('*')) == Some(asset))
                .then(|| parts[0].to_ascii_lowercase())
        })
        .next()
        .ok_or_else(|| format!("SHA2-256SUMS has no entry for {asset}"))
}

fn install_latest(dir: &Path, release: &Value, version: &str) -> Result<PluginState, String> {
    let asset = asset_name();
    let bytes = download_bytes(&asset_url(release, asset)?)?;
    let digest = format!("{:x}", sha2::Sha256::digest(&bytes));
    let sums = String::from_utf8(download_bytes(&sha256_url(release)?)?)
        .map_err(|e| format!("decode yt-dlp checksums: {e}"))?;
    let expected = expected_sha256(&sums, asset)?;
    if digest != expected {
        return Err(format!(
            "yt-dlp SHA-256 mismatch: expected {expected}, got {digest}"
        ));
    }

    let target = binary_path(dir);
    let tmp = target.with_extension("download");
    fs::write(&tmp, bytes).map_err(|e| format!("write yt-dlp temporary binary: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("set yt-dlp executable permission: {e}"))?;
    }
    // Windows cannot rename over an existing file. Keep a rollback copy while
    // swapping so a failed update never leaves the plugin without a binary.
    let backup = target.with_extension("old");
    let had_target = target.exists();
    if had_target {
        let _ = fs::remove_file(&backup);
        fs::rename(&target, &backup).map_err(|e| format!("stage old yt-dlp binary: {e}"))?;
    }
    if let Err(e) = fs::rename(&tmp, &target) {
        let _ = fs::remove_file(&tmp);
        if had_target {
            let _ = fs::rename(&backup, &target);
        }
        return Err(format!("commit yt-dlp binary: {e}"));
    }
    if had_target {
        let _ = fs::remove_file(&backup);
    }

    let state = PluginState {
        version: Some(version.to_owned()),
        asset: Some(asset.to_owned()),
        sha256: Some(digest),
        updated_at: Some(now_secs()),
        last_checked_at: Some(now_secs()),
    };
    write_state(dir, &state)?;
    Ok(state)
}

fn ensure_latest(
    app: &AppHandle,
    force: bool,
    check_interval_secs: u64,
) -> Result<(PathBuf, PluginState), String> {
    let dir = plugin_dir(app)?;
    let target = binary_path(&dir);
    let mut state = read_state(&dir);
    let fresh = state
        .last_checked_at
        .map(|last| now_secs().saturating_sub(last) < check_interval_secs)
        .unwrap_or(false);

    if target.is_file() && fresh && !force {
        return Ok((target, state));
    }

    let release = match latest_release() {
        Ok(value) => value,
        Err(_error) if target.is_file() => {
            state.last_checked_at = Some(now_secs());
            let _ = write_state(&dir, &state);
            return Ok((target, state));
        }
        Err(error) => return Err(error),
    };
    let latest = release
        .get("tag_name")
        .and_then(Value::as_str)
        .ok_or_else(|| "yt-dlp release metadata has no tag_name".to_owned())?;

    if target.is_file() && state.version.as_deref() == Some(latest) && !force {
        state.last_checked_at = Some(now_secs());
        let _ = write_state(&dir, &state);
        return Ok((target, state));
    }

    state = install_latest(&dir, &release, latest)?;
    Ok((target, state))
}

fn status_from(
    dir: &Path,
    state: &PluginState,
    latest: Option<String>,
    error: Option<String>,
) -> YtDlpPluginStatus {
    let installed = binary_path(dir).is_file();
    let update_available = match (&state.version, &latest) {
        (Some(installed), Some(latest)) => installed != latest,
        (None, Some(_)) if installed => true,
        _ => false,
    };
    YtDlpPluginStatus {
        installed,
        version: state.version.clone(),
        latest_version: latest,
        update_available,
        executable: installed.then(|| binary_path(dir).display().to_string()),
        last_checked_at: state.last_checked_at,
        error,
    }
}

#[tauri::command]
pub fn ytdlp_plugin_status(
    app: AppHandle,
    refresh: Option<bool>,
) -> Result<YtDlpPluginStatus, String> {
    let dir = plugin_dir(&app)?;
    let state = read_state(&dir);
    if !refresh.unwrap_or(false) {
        return Ok(status_from(&dir, &state, None, None));
    }
    match latest_release() {
        Ok(release) => Ok(status_from(
            &dir,
            &state,
            release
                .get("tag_name")
                .and_then(Value::as_str)
                .map(str::to_owned),
            None,
        )),
        Err(error) => Ok(status_from(&dir, &state, None, Some(error))),
    }
}

#[tauri::command]
pub fn ytdlp_update_plugin(
    app: AppHandle,
    force: Option<bool>,
) -> Result<YtDlpPluginStatus, String> {
    let dir = plugin_dir(&app)?;
    let (_, state) = ensure_latest(&app, force.unwrap_or(true), CHECK_INTERVAL_SECS)?;
    Ok(status_from(&dir, &state, state.version.clone(), None))
}

#[tauri::command]
pub fn ytdlp_resolve(
    app: AppHandle,
    url: String,
    auto_update: Option<bool>,
    check_interval_hours: Option<u64>,
) -> Result<String, String> {
    let clean = url.trim();
    if clean.is_empty() || !(clean.starts_with("http://") || clean.starts_with("https://")) {
        return Err("yt-dlp requires an absolute HTTP(S) URL".into());
    }
    let interval_secs = check_interval_hours.unwrap_or(6).clamp(1, 168) * 60 * 60;
    let (binary, _) = if auto_update == Some(false) {
        let dir = plugin_dir(&app)?;
        let target = binary_path(&dir);
        if target.is_file() {
            (target, read_state(&dir))
        } else {
            // A first run still needs to install the runtime; disabling
            // auto-update only prevents checking for newer releases later.
            ensure_latest(&app, true, interval_secs)?
        }
    } else {
        ensure_latest(&app, false, interval_secs)?
    };
    let mut child = Command::new(binary)
        .args([
            "--dump-single-json",
            "--skip-download",
            "--no-playlist",
            "--no-warnings",
            "--no-progress",
            "--",
            clean,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("start yt-dlp: {e}"))?;

    // Drain both pipes while the child runs. A full JSON dump can exceed the
    // OS pipe buffer and would otherwise deadlock before try_wait sees exit.
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "yt-dlp stdout unavailable".to_owned())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "yt-dlp stderr unavailable".to_owned())?;
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).map(|_| bytes)
    });
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).map(|_| bytes)
    });

    let deadline = Instant::now() + Duration::from_secs(RESOLVE_TIMEOUT_SECS);
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| format!("poll yt-dlp: {e}"))? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err("yt-dlp inspection timed out".into());
        }
        thread::sleep(Duration::from_millis(50));
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| "yt-dlp stdout reader panicked".to_owned())?
        .map_err(|e| format!("read yt-dlp stdout: {e}"))?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| "yt-dlp stderr reader panicked".to_owned())?
        .map_err(|e| format!("read yt-dlp stderr: {e}"))?;
    if !status.success() {
        let stderr = String::from_utf8_lossy(&stderr);
        return Err(format!("yt-dlp exited with {status}: {}", stderr.trim()));
    }
    String::from_utf8(stdout).map_err(|e| format!("decode yt-dlp JSON: {e}"))
}
