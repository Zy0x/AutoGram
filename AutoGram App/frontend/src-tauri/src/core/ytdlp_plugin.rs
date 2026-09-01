//! Updateable yt-dlp & FFmpeg provider for Remote URL inspection.
//!
//! The standalone executable lives in app-data, not in the repository. The
//! provider checks the official yt-dlp latest-release API on a bounded cadence,
//! verifies SHA-256, installs atomically, and keeps the last known-good binary
//! when GitHub is temporarily unavailable. Supports system binary fallback,
//! custom paths, cookies, PO tokens, extractor args, and FFmpeg detection.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Digest;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const REPOSITORY: &str = "yt-dlp/yt-dlp";
const CHECK_INTERVAL_SECS: u64 = 6 * 60 * 60;
const RESOLVE_TIMEOUT_SECS: u64 = 60;

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
    pub source: String, // "app_data" | "system" | "custom" | "none"
    pub last_checked_at: Option<u64>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegPluginStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub executable: Option<String>,
    pub ffprobe_executable: Option<String>,
    pub source: String, // "app_data" | "workspace_plugin" | "system" | "custom" | "none"
    pub supports_http: bool,
    pub av1_decoder: Option<String>,
    pub supports_nvenc: bool,
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

/// Process-lifetime cache for system binary paths.
/// Avoids repeated PATH scans on every `ytdlp_resolve` call.
static BINARY_CACHE: OnceLock<Mutex<HashMap<String, Option<PathBuf>>>> = OnceLock::new();

fn binary_cache() -> &'static Mutex<HashMap<String, Option<PathBuf>>> {
    BINARY_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn find_system_binary_uncached(name: &str) -> Option<PathBuf> {
    let binary_name = if cfg!(target_os = "windows") && !name.ends_with(".exe") {
        format!("{}.exe", name)
    } else {
        name.to_string()
    };

    if let Some(path_var) = std::env::var_os("PATH") {
        for path in std::env::split_paths(&path_var) {
            let candidate = path.join(&binary_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let common_dirs = [
            r"C:\Program Files\nodejs",
            r"C:\Program Files (x86)\nodejs",
            r"C:\ProgramData\chocolatey\bin",
            r"C:\tools",
        ];
        for dir in common_dirs {
            let candidate = Path::new(dir).join(&binary_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }

        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let local_candidates = [
                Path::new(&local_app_data).join(r"Programs\node").join(&binary_name),
                Path::new(&local_app_data).join(r"Programs\deno").join(&binary_name),
                Path::new(&local_app_data).join(r"Programs\bun").join(&binary_name),
                Path::new(&local_app_data).join(r"Microsoft\WinGet\Links").join(&binary_name),
            ];
            for cand in local_candidates {
                if cand.is_file() {
                    return Some(cand);
                }
            }
        }

        if let Ok(app_data) = std::env::var("APPDATA") {
            let nvm_cand = Path::new(&app_data).join(r"nvm").join(&binary_name);
            if nvm_cand.is_file() {
                return Some(nvm_cand);
            }
            let npm_cand = Path::new(&app_data).join(r"npm").join(&binary_name);
            if npm_cand.is_file() {
                return Some(npm_cand);
            }
        }
    }

    None
}

/// Cached version of `find_system_binary_uncached`.
/// Results are remembered for the process lifetime — safe because binaries
/// on PATH do not move while the app is running.
pub fn find_system_binary(name: &str) -> Option<PathBuf> {
    let cache = binary_cache();
    // Fast read path: check without write lock first
    {
        if let Ok(map) = cache.lock() {
            if let Some(cached) = map.get(name) {
                return cached.clone();
            }
        }
    }
    // Slow path: scan filesystem and write result
    let result = find_system_binary_uncached(name);
    if let Ok(mut map) = cache.lock() {
        map.entry(name.to_string()).or_insert_with(|| result.clone());
    }
    result
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

fn run_version_check(bin: &Path) -> Option<String> {
    let output = Command::new(bin).arg("--version").output().ok()?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() {
            return Some(stdout);
        }
    }
    None
}

fn status_from(
    dir: &Path,
    state: &PluginState,
    latest: Option<String>,
    error: Option<String>,
    custom_path: Option<&str>,
) -> YtDlpPluginStatus {
    // 1. Check custom path if supplied
    if let Some(custom) = custom_path {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            let p = Path::new(trimmed);
            if p.is_file() {
                let v = run_version_check(p);
                return YtDlpPluginStatus {
                    installed: true,
                    version: v.or_else(|| state.version.clone()),
                    latest_version: latest,
                    update_available: false,
                    executable: Some(p.display().to_string()),
                    source: "custom".to_string(),
                    last_checked_at: state.last_checked_at,
                    error,
                };
            }
        }
    }

    // 2. Check app data plugin binary
    let app_bin = binary_path(dir);
    if app_bin.is_file() {
        let update_available = match (&state.version, &latest) {
            (Some(installed), Some(lat)) => installed != lat,
            (None, Some(_)) => true,
            _ => false,
        };
        return YtDlpPluginStatus {
            installed: true,
            version: state.version.clone().or_else(|| run_version_check(&app_bin)),
            latest_version: latest,
            update_available,
            executable: Some(app_bin.display().to_string()),
            source: "app_data".to_string(),
            last_checked_at: state.last_checked_at,
            error,
        };
    }

    // 3. Check system PATH binary
    if let Some(sys_bin) = find_system_binary("yt-dlp") {
        let v = run_version_check(&sys_bin);
        return YtDlpPluginStatus {
            installed: true,
            version: v,
            latest_version: latest,
            update_available: false,
            executable: Some(sys_bin.display().to_string()),
            source: "system".to_string(),
            last_checked_at: state.last_checked_at,
            error,
        };
    }

    // 4. Not installed
    YtDlpPluginStatus {
        installed: false,
        version: None,
        latest_version: latest.clone(),
        update_available: latest.is_some(),
        executable: None,
        source: "none".to_string(),
        last_checked_at: state.last_checked_at,
        error,
    }
}

#[tauri::command]
pub fn ytdlp_plugin_status(
    app: AppHandle,
    refresh: Option<bool>,
    custom_path: Option<String>,
) -> Result<YtDlpPluginStatus, String> {
    let dir = plugin_dir(&app)?;
    let state = read_state(&dir);
    if !refresh.unwrap_or(false) {
        return Ok(status_from(&dir, &state, None, None, custom_path.as_deref()));
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
            custom_path.as_deref(),
        )),
        Err(error) => Ok(status_from(
            &dir,
            &state,
            None,
            Some(error),
            custom_path.as_deref(),
        )),
    }
}

#[tauri::command]
pub fn ytdlp_update_plugin(
    app: AppHandle,
    force: Option<bool>,
) -> Result<YtDlpPluginStatus, String> {
    let dir = plugin_dir(&app)?;
    let (_, state) = ensure_latest(&app, force.unwrap_or(true), CHECK_INTERVAL_SECS)?;
    Ok(status_from(&dir, &state, state.version.clone(), None, None))
}

pub fn ffmpeg_plugin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {e}"))?
        .join("plugins")
        .join("ffmpeg-extractor");
    fs::create_dir_all(dir.join("bin")).map_err(|e| format!("create ffmpeg plugin dir: {e}"))?;
    fs::create_dir_all(dir.join("runtime")).map_err(|e| format!("create ffmpeg runtime dir: {e}"))?;
    Ok(dir)
}

fn probe_ffmpeg_details(path: &Path) -> Option<(String, bool, Option<String>, bool)> {
    if !path.is_file() {
        return None;
    }
    let v_out = Command::new(path).arg("-hide_banner").arg("-version").output().ok()?;
    if !v_out.status.success() {
        return None;
    }
    let v_text = String::from_utf8_lossy(&v_out.stdout);
    let version = v_text.lines().next().unwrap_or("").trim().to_string();
    if version.is_empty() {
        return None;
    }

    let p_out = Command::new(path).arg("-hide_banner").arg("-protocols").output().ok();
    let supports_http = p_out.map(|o| {
        let p_text = String::from_utf8_lossy(&o.stdout);
        p_text.lines().any(|l| {
            let t = l.trim();
            t == "http" || t.starts_with("http ") || t.ends_with(" http") || t == "https"
        })
    }).unwrap_or(false);

    let d_out = Command::new(path).arg("-hide_banner").arg("-decoders").output().ok();
    let av1_decoder = d_out.and_then(|o| {
        let d_text = String::from_utf8_lossy(&o.stdout);
        if d_text.contains("libdav1d") {
            Some("libdav1d".to_string())
        } else if d_text.contains("libaom-av1") {
            Some("libaom-av1".to_string())
        } else if d_text.contains("av1") {
            Some("av1".to_string())
        } else {
            None
        }
    });

    let e_out = Command::new(path).arg("-hide_banner").arg("-encoders").output().ok();
    let supports_nvenc = e_out.map(|o| {
        let e_text = String::from_utf8_lossy(&o.stdout);
        e_text.contains("nvenc") || e_text.contains("h264_nvenc") || e_text.contains("hevc_nvenc") || e_text.contains("amf") || e_text.contains("qsv")
    }).unwrap_or(false);

    Some((version, supports_http, av1_decoder, supports_nvenc))
}

#[tauri::command]
pub fn ffmpeg_plugin_status(
    app: AppHandle,
    custom_path: Option<String>,
) -> Result<FfmpegPluginStatus, String> {
    let mut resolved_exe: Option<(PathBuf, String)> = None;

    // 1. Check custom path
    if let Some(ref custom) = custom_path {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            let p = PathBuf::from(trimmed);
            if p.is_file() {
                resolved_exe = Some((p, "custom".to_string()));
            }
        }
    }

    // 2. Check AppData plugin directory
    if resolved_exe.is_none() {
        if let Ok(dir) = ffmpeg_plugin_dir(&app) {
            let ff_appdata = dir.join("bin").join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
            if ff_appdata.is_file() {
                resolved_exe = Some((ff_appdata, "app_data".to_string()));
            }
        }
    }

    // 3. Check Workspace plugins, toolchains, and parent directories
    if resolved_exe.is_none() {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let mut dir = cwd.clone();
        let exe_name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
        for _ in 0..6 {
            let candidates = [
                dir.join("plugins").join("ffmpeg-extractor").join("bin").join(exe_name),
                dir.join("AutoGram App").join("plugins").join("ffmpeg-extractor").join("bin").join(exe_name),
                dir.join("bin").join(exe_name),
                dir.join(".toolchains").join("ffmpeg-release-essentials").join("ffmpeg-9.0.1-essentials_build").join("bin").join(exe_name),
            ];
            for cand in candidates {
                if cand.is_file() {
                    resolved_exe = Some((cand, "workspace_plugin".to_string()));
                    break;
                }
            }
            if resolved_exe.is_some() || !dir.pop() {
                break;
            }
        }
    }

    // 4. Check system binary / PATH
    if resolved_exe.is_none() {
        if let Some(sys_bin) = find_system_binary("ffmpeg") {
            resolved_exe = Some((sys_bin, "system".to_string()));
        }
    }

    if let Some((exe_path, source)) = resolved_exe {
        if let Some((version, supports_http, av1_decoder, supports_nvenc)) = probe_ffmpeg_details(&exe_path) {
            let parent_dir = exe_path.parent();
            let ffprobe_path = parent_dir
                .map(|p| p.join(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" }))
                .filter(|p| p.is_file())
                .or_else(|| find_system_binary("ffprobe"));

            return Ok(FfmpegPluginStatus {
                installed: true,
                version: Some(version),
                latest_version: Some("latest-gpl".to_string()),
                update_available: false,
                executable: Some(exe_path.display().to_string()),
                ffprobe_executable: ffprobe_path.map(|p| p.display().to_string()),
                source,
                supports_http,
                av1_decoder,
                supports_nvenc,
                error: None,
            });
        }
    }

    Ok(FfmpegPluginStatus {
        installed: false,
        version: None,
        latest_version: Some("latest-gpl".to_string()),
        update_available: true,
        executable: None,
        ffprobe_executable: None,
        source: "none".to_string(),
        supports_http: false,
        av1_decoder: None,
        supports_nvenc: false,
        error: None,
    })
}

#[tauri::command]
pub fn ffmpeg_update_plugin(
    app: AppHandle,
    _force: Option<bool>,
) -> Result<FfmpegPluginStatus, String> {
    let dir = ffmpeg_plugin_dir(&app)?;
    let bin_dir = dir.join("bin");
    fs::create_dir_all(&bin_dir).map_err(|e| format!("create ffmpeg bin dir: {e}"))?;

    let download_url = if cfg!(target_os = "windows") {
        "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    } else if cfg!(target_os = "macos") {
        "https://evermeet.cx/ffmpeg/getrelease/zip"
    } else {
        "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"
    };

    let bytes = download_bytes(download_url)
        .map_err(|e| format!("download ffmpeg release from {download_url} failed: {e}"))?;

    if download_url.ends_with(".zip") {
        let cursor = std::io::Cursor::new(&bytes);
        let mut zip = zip::ZipArchive::new(cursor)
            .map_err(|e| format!("open ffmpeg zip archive: {e}"))?;

        let mut extracted_count = 0;
        for i in 0..zip.len() {
            let mut file = zip.by_index(i).map_err(|e| format!("read zip entry {i}: {e}"))?;
            let name = file.name().to_string();
            let lower = name.to_lowercase();
            if lower.ends_with("ffmpeg.exe") || lower.ends_with("ffprobe.exe") || lower.ends_with("/ffmpeg") || lower.ends_with("/ffprobe") {
                let file_name = Path::new(&name).file_name().unwrap_or_default();
                let dest = bin_dir.join(file_name);
                let mut out = fs::File::create(&dest)
                    .map_err(|e| format!("create output file {}: {e}", dest.display()))?;
                std::io::copy(&mut file, &mut out)
                    .map_err(|e| format!("write output file {}: {e}", dest.display()))?;
                extracted_count += 1;
            }
        }
        if extracted_count == 0 {
            return Err("no ffmpeg or ffprobe executable found inside downloaded zip".into());
        }
    }

    let state_file = dir.join("runtime").join("state.json");
    let _ = fs::write(&state_file, serde_json::json!({
        "version": "latest-gpl",
        "updatedAt": now_secs()
    }).to_string());

    ffmpeg_plugin_status(app, None)
}

#[tauri::command]
pub fn ytdlp_resolve(
    app: AppHandle,
    url: String,
    auto_update: Option<bool>,
    check_interval_hours: Option<u64>,
    custom_path: Option<String>,
    cookies_mode: Option<String>,
    cookies_browser: Option<String>,
    cookies_path: Option<String>,
    po_token: Option<String>,
    extractor_args: Option<String>,
    custom_args: Option<String>,
    ffmpeg_path: Option<String>,
) -> Result<String, String> {
    let clean = url.trim();
    if clean.is_empty() || !(clean.starts_with("http://") || clean.starts_with("https://")) {
        return Err("yt-dlp requires an absolute HTTP(S) URL".into());
    }

    // 1. Resolve binary path
    let binary: PathBuf = if let Some(ref custom) = custom_path {
        let trimmed = custom.trim();
        if !trimmed.is_empty() && Path::new(trimmed).is_file() {
            PathBuf::from(trimmed)
        } else {
            resolve_default_binary(&app, auto_update, check_interval_hours)?
        }
    } else {
        resolve_default_binary(&app, auto_update, check_interval_hours)?
    };

    // 2. Build command arguments
    let mut cmd = Command::new(binary);
    cmd.args([
        "--dump-single-json",
        "--skip-download",
        "--no-playlist",
        "--no-warnings",
        "--no-progress",
        "--sub-langs",
        "all",
        "--write-subs",
        "--write-auto-subs",
    ]);

    // JavaScript runtimes for YouTube n-sig challenge deciphering
    if let Some(node_path) = find_system_binary("node") {
        cmd.args(["--js-runtimes", &format!("node:{}", node_path.display())]);
    } else {
        cmd.args(["--js-runtimes", "node"]);
    }
    if let Some(deno_path) = find_system_binary("deno") {
        cmd.args(["--js-runtimes", &format!("deno:{}", deno_path.display())]);
    }
    if let Some(bun_path) = find_system_binary("bun") {
        cmd.args(["--js-runtimes", &format!("bun:{}", bun_path.display())]);
    }
    if let Some(quickjs_path) = find_system_binary("quickjs") {
        cmd.args(["--js-runtimes", &format!("quickjs:{}", quickjs_path.display())]);
    }

    // Cookies support
    if let Some(ref mode) = cookies_mode {
        match mode.trim().to_lowercase().as_str() {
            "file" => {
                if let Some(ref path) = cookies_path {
                    let trimmed = path.trim();
                    if !trimmed.is_empty() && Path::new(trimmed).is_file() {
                        cmd.args(["--cookies", trimmed]);
                    }
                }
            }
            "browser" => {
                if let Some(ref browser) = cookies_browser {
                    let trimmed = browser.trim().to_lowercase();
                    if !trimmed.is_empty() && trimmed != "none" {
                        cmd.args(["--cookies-from-browser", &trimmed]);
                    }
                }
            }
            _ => {}
        }
    }

    // Extractor args & PO Token
    let mut extractor_args_combined = Vec::new();
    if let Some(ref po) = po_token {
        let trimmed = po.trim();
        if !trimmed.is_empty() {
            extractor_args_combined.push(format!("youtube:po_token={trimmed}"));
        }
    }
    if let Some(ref args) = extractor_args {
        let trimmed = args.trim();
        if !trimmed.is_empty() {
            extractor_args_combined.push(trimmed.to_string());
        }
    }
    for arg in extractor_args_combined {
        cmd.args(["--extractor-args", &arg]);
    }

    // FFmpeg location
    if let Some(ref ff) = ffmpeg_path {
        let trimmed = ff.trim();
        if !trimmed.is_empty() && (Path::new(trimmed).is_file() || Path::new(trimmed).is_dir()) {
            cmd.args(["--ffmpeg-location", trimmed]);
        }
    } else if let Some(sys_ffmpeg) = find_system_binary("ffmpeg") {
        cmd.args(["--ffmpeg-location", &sys_ffmpeg.display().to_string()]);
    }

    // Custom user arguments
    if let Some(ref custom) = custom_args {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            for part in trimmed.split_whitespace() {
                cmd.arg(part);
            }
        }
    }

    cmd.arg("--").arg(clean);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("start yt-dlp: {e}"))?;

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
        thread::sleep(Duration::from_millis(10));
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
        let stderr_str = String::from_utf8_lossy(&stderr);
        return Err(format!("yt-dlp exited with {status}: {}", stderr_str.trim()));
    }

    String::from_utf8(stdout).map_err(|e| format!("decode yt-dlp JSON: {e}"))
}

fn resolve_default_binary(
    app: &AppHandle,
    auto_update: Option<bool>,
    check_interval_hours: Option<u64>,
) -> Result<PathBuf, String> {
    let interval_secs = check_interval_hours.unwrap_or(6).clamp(1, 168) * 60 * 60;
    let dir = plugin_dir(app)?;
    let target = binary_path(&dir);

    if auto_update == Some(false) {
        // Auto-update disabled: return binary immediately without any network I/O.
        if target.is_file() {
            return Ok(target);
        }
        if let Some(sys) = find_system_binary("yt-dlp") {
            return Ok(sys);
        }
        let (bin, _) = ensure_latest(app, true, interval_secs)?;
        return Ok(bin);
    }

    // Auto-update enabled:
    // If the binary already exists locally, return it immediately and
    // kick off the GitHub update check in a background thread so it
    // never blocks the resolve path.
    if target.is_file() {
        let state = read_state(&dir);
        let fresh = state
            .last_checked_at
            .map(|last| now_secs().saturating_sub(last) < interval_secs)
            .unwrap_or(false);

        if !fresh {
            // Update check due — run it in background, don't block resolve.
            let app_clone = app.clone();
            thread::spawn(move || {
                // Verify plugin dir is accessible before running update check.
                if plugin_dir(&app_clone).is_ok() {
                    let _ = ensure_latest(&app_clone, false, interval_secs);
                }
            });
        }
        return Ok(target);
    }

    // Binary does not exist locally — must download synchronously (first install).
    match ensure_latest(app, false, interval_secs) {
        Ok((bin, _)) => Ok(bin),
        Err(err) => {
            if target.is_file() {
                Ok(target)
            } else if let Some(sys) = find_system_binary("yt-dlp") {
                Ok(sys)
            } else {
                Err(err)
            }
        }
    }
}
