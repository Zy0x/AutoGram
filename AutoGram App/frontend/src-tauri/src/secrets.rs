//! Encrypted credential store for API_ID / API_HASH (P0 hardening).
//!
//! Master key priority (stable across rebuilds):
//!   1) `%APPDATA%/<id>/.master.key`  ← primary, survives cargo/tauri rebuild
//!   2) OS keyring (optional mirror only — never invent a NEW key if file/secrets exist)
//!
//! On save we also mirror API_ID/API_HASH into `worker/.env` so rebuilds can re-seed.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SERVICE: &str = "AutoGram";
const ACCOUNT: &str = "secrets-master-v1";
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

#[derive(Default, Serialize, Deserialize)]
struct SecretMap {
    #[serde(flatten)]
    map: HashMap<String, String>,
}

fn secrets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir app_data: {e}"))?;
    Ok(dir)
}

fn secrets_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(secrets_dir(app)?.join("secrets.enc"))
}

fn master_key_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(secrets_dir(app)?.join(".master.key"))
}

fn protect_file_acl(path: &Path) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("icacls")
            .args([
                path.to_string_lossy().as_ref(),
                "/inheritance:r",
                "/grant:r",
                &format!("{}:F", std::env::var("USERNAME").unwrap_or_else(|_| "User".into())),
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    let _ = path;
}

fn decode_key_b64(s: &str) -> Option<[u8; KEY_LEN]> {
    let bytes = B64.decode(s.trim()).ok()?;
    if bytes.len() != KEY_LEN {
        return None;
    }
    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(&bytes);
    Some(key)
}

fn read_file_master_key(app: &AppHandle) -> Option<[u8; KEY_LEN]> {
    let kp = master_key_path(app).ok()?;
    if !kp.is_file() {
        return None;
    }
    let s = fs::read_to_string(&kp).ok()?;
    decode_key_b64(&s)
}

fn write_file_master_key(app: &AppHandle, key: &[u8; KEY_LEN]) -> Result<(), String> {
    let kp = master_key_path(app)?;
    fs::write(&kp, B64.encode(key)).map_err(|e| format!("write master key: {e}"))?;
    protect_file_acl(&kp);
    Ok(())
}

fn read_keyring_master_key() -> Option<[u8; KEY_LEN]> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).ok()?;
    let s = entry.get_password().ok()?;
    decode_key_b64(&s)
}

fn write_keyring_master_key(key: &[u8; KEY_LEN]) {
    if let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) {
        let _ = entry.set_password(&B64.encode(key));
    }
}

/// Load or create master key. File is the durable source of truth (survives rebuilds).
/// Never invent a new key when secrets.enc already exists without trying known keys first.
fn load_or_create_master_key(app: &AppHandle) -> Result<[u8; KEY_LEN], String> {
    let secrets_exists = secrets_path(app).map(|p| p.is_file()).unwrap_or(false);

    // 1) File key (primary — stable across rebuilds)
    if let Some(key) = read_file_master_key(app) {
        // Keep keyring in sync (best-effort)
        write_keyring_master_key(&key);
        return Ok(key);
    }

    // 2) Keyring only if we can recover file from it
    if let Some(key) = read_keyring_master_key() {
        // Persist to file so next rebuild works without keyring
        let _ = write_file_master_key(app, &key);
        return Ok(key);
    }

    // 3) No known key. If secrets.enc exists, do NOT silently mint a new key
    //    (that would make decrypt impossible). Caller may recover via .env seed.
    if secrets_exists {
        // Still mint a NEW key only after moving corrupt/unreadable secrets aside
        // happens in decrypt_map_recover.
    }

    // 4) Fresh install: create file key (+ mirror keyring)
    let mut key = [0u8; KEY_LEN];
    rand::thread_rng().fill_bytes(&mut key);
    write_file_master_key(app, &key)?;
    write_keyring_master_key(&key);
    Ok(key)
}

fn try_decrypt_with_key(raw: &[u8], key: &[u8; KEY_LEN]) -> Option<SecretMap> {
    if raw.len() < NONCE_LEN + 16 {
        return None;
    }
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let nonce = Nonce::from_slice(&raw[..NONCE_LEN]);
    let plain = cipher.decrypt(nonce, &raw[NONCE_LEN..]).ok()?;
    serde_json::from_slice(&plain).ok()
}

fn decrypt_map(app: &AppHandle) -> Result<SecretMap, String> {
    let path = secrets_path(app)?;
    if !path.is_file() {
        return Ok(SecretMap::default());
    }
    let raw = fs::read(&path).map_err(|e| format!("read secrets: {e}"))?;
    if raw.len() < NONCE_LEN + 16 {
        return Ok(SecretMap::default());
    }

    // Try file key, then keyring key (may differ after older buggy builds)
    let mut tried: Vec<[u8; KEY_LEN]> = Vec::new();
    if let Some(k) = read_file_master_key(app) {
        tried.push(k);
    }
    if let Some(k) = read_keyring_master_key() {
        if !tried.iter().any(|t| t == &k) {
            tried.push(k);
        }
    }
    // Also ensure load_or_create path is considered once
    if let Ok(k) = load_or_create_master_key(app) {
        if !tried.iter().any(|t| t == &k) {
            tried.push(k);
        }
    }

    for k in &tried {
        if let Some(map) = try_decrypt_with_key(&raw, k) {
            // Canonicalize: write this key to file so rebuilds stay stable
            let _ = write_file_master_key(app, k);
            write_keyring_master_key(k);
            return Ok(map);
        }
    }

    Err("decrypt secrets failed (wrong key or corrupt file)".into())
}

/// Decrypt or recover empty map (and quarantine unreadable secrets.enc).
fn decrypt_map_or_recover(app: &AppHandle) -> SecretMap {
    match decrypt_map(app) {
        Ok(m) => m,
        Err(_) => {
            // Quarantine unreadable blob so we can rewrite with new key
            if let Ok(path) = secrets_path(app) {
                if path.is_file() {
                    let bak = path.with_extension("enc.bak");
                    let _ = fs::rename(&path, &bak);
                }
            }
            SecretMap::default()
        }
    }
}

fn encrypt_map(app: &AppHandle, map: &SecretMap) -> Result<(), String> {
    let key_bytes = load_or_create_master_key(app)?;
    // Always re-persist master key file (idempotent)
    let _ = write_file_master_key(app, &key_bytes);
    write_keyring_master_key(&key_bytes);

    let cipher = Aes256Gcm::new_from_slice(&key_bytes).map_err(|e| format!("cipher: {e}"))?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plain = serde_json::to_vec(map).map_err(|e| format!("serialize: {e}"))?;
    let ct = cipher
        .encrypt(nonce, plain.as_ref())
        .map_err(|e| format!("encrypt: {e}"))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    let path = secrets_path(app)?;
    fs::write(&path, out).map_err(|e| format!("write secrets: {e}"))?;
    protect_file_acl(&path);
    Ok(())
}

/// Mirror API credentials into worker/.env so rebuilds / seed always have a local copy.
/// Preserves existing API_ID/HASH in .env when the new value is empty (partial set).
fn mirror_api_to_worker_env(app: &AppHandle, api_id: &str, api_hash: &str) {
    let Ok(worker) = resolve_worker_root(app) else {
        return;
    };
    let env_path = worker.join(".env");
    let mut lines: Vec<String> = Vec::new();
    let mut prev_id = String::new();
    let mut prev_hash = String::new();
    if env_path.is_file() {
        if let Ok(text) = fs::read_to_string(&env_path) {
            for line in text.lines() {
                let t = line.trim();
                if let Some(rest) = t.strip_prefix("API_ID=") {
                    prev_id = rest.trim().trim_matches('"').trim_matches('\'').to_string();
                    continue;
                }
                if let Some(rest) = t.strip_prefix("API_HASH=") {
                    prev_hash = rest.trim().trim_matches('"').trim_matches('\'').to_string();
                    continue;
                }
                lines.push(line.to_string());
            }
        }
    }
    let id = if api_id.is_empty() {
        prev_id
    } else {
        api_id.to_string()
    };
    let hash = if api_hash.is_empty() {
        prev_hash
    } else {
        api_hash.to_string()
    };
    if !id.is_empty() {
        lines.push(format!("API_ID={id}"));
    }
    if !hash.is_empty() {
        lines.push(format!("API_HASH=\"{hash}\""));
    }
    let body = if lines.is_empty() {
        String::new()
    } else {
        lines.join("\n") + "\n"
    };
    let _ = fs::write(&env_path, body);
}

#[tauri::command]
pub async fn get_credential(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let k = key.trim().to_string();
    if k.is_empty() {
        return Err("empty key".into());
    }
    // Recover if previous master key was lost after rebuild
    let map = match decrypt_map(&app) {
        Ok(m) => m,
        Err(_) => {
            let _ = seed_credentials_from_worker_env(&app);
            decrypt_map_or_recover(&app)
        }
    };
    Ok(map.map.get(&k).cloned())
}

#[tauri::command]
pub async fn set_credential(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let k = key.trim().to_string();
    if k.is_empty() {
        return Err("empty key".into());
    }
    // Never allow path-like keys
    if k.contains('/') || k.contains('\\') || k.contains("..") {
        return Err("invalid key".into());
    }
    let mut map = decrypt_map_or_recover(&app);
    if value.is_empty() {
        map.map.remove(&k);
    } else {
        map.map.insert(k.clone(), value.clone());
    }
    encrypt_map(&app, &map)?;

    // Durable local mirror for rebuild recovery
    if k == "API_ID" || k == "API_HASH" {
        let id = map.map.get("API_ID").cloned().unwrap_or_default();
        let hash = map.map.get("API_HASH").cloned().unwrap_or_default();
        if !id.is_empty() || !hash.is_empty() {
            mirror_api_to_worker_env(&app, &id, &hash);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_credential(app: AppHandle, key: String) -> Result<(), String> {
    set_credential(app, key, String::new()).await
}

/// One-shot migrate from web localStorage values (called by frontend then clears LS).
#[tauri::command]
pub async fn migrate_credentials_from_webstorage(
    app: AppHandle,
    api_id: String,
    api_hash: String,
) -> Result<(), String> {
    let id = api_id.trim().to_string();
    let hash = api_hash.trim().to_string();
    if id.is_empty() && hash.is_empty() {
        return Ok(());
    }
    let mut map = decrypt_map_or_recover(&app);
    // Only fill empty secure slots (don't overwrite newer secrets)
    if !id.is_empty() && !map.map.contains_key("API_ID") {
        map.map.insert("API_ID".into(), id.clone());
    }
    if !hash.is_empty() && !map.map.contains_key("API_HASH") {
        map.map.insert("API_HASH".into(), hash.clone());
    }
    encrypt_map(&app, &map)?;
    let sid = map.map.get("API_ID").cloned().unwrap_or_default();
    let shash = map.map.get("API_HASH").cloned().unwrap_or_default();
    mirror_api_to_worker_env(&app, &sid, &shash);
    Ok(())
}

/// If secure store has no API_ID/API_HASH, seed once from worker/.env (local recovery).
/// Does not overwrite existing secure values.
pub fn seed_credentials_from_worker_env(app: &AppHandle) -> Result<bool, String> {
    let mut map = decrypt_map_or_recover(app);
    let has_id = map
        .map
        .get("API_ID")
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let has_hash = map
        .map
        .get("API_HASH")
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    if has_id && has_hash {
        // Ensure file master key exists even when already seeded
        let _ = load_or_create_master_key(app);
        return Ok(false);
    }

    let worker = resolve_worker_root(app)?;
    let env_path = worker.join(".env");
    if !env_path.is_file() {
        return Ok(false);
    }
    let text = fs::read_to_string(&env_path).map_err(|e| format!("read .env: {e}"))?;
    let mut env_id = String::new();
    let mut env_hash = String::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let key = k.trim();
        let mut val = v.trim().to_string();
        if (val.starts_with('"') && val.ends_with('"'))
            || (val.starts_with('\'') && val.ends_with('\''))
        {
            val = val[1..val.len() - 1].to_string();
        }
        if key == "API_ID" {
            env_id = val;
        } else if key == "API_HASH" {
            env_hash = val;
        }
    }

    let mut changed = false;
    if !has_id && !env_id.is_empty() {
        map.map.insert("API_ID".into(), env_id);
        changed = true;
    }
    if !has_hash && !env_hash.is_empty() {
        map.map.insert("API_HASH".into(), env_hash);
        changed = true;
    }
    if changed {
        encrypt_map(app, &map)?;
    }
    Ok(changed)
}

#[tauri::command]
pub async fn seed_api_credentials_from_env(app: AppHandle) -> Result<bool, String> {
    seed_credentials_from_worker_env(&app)
}

/// Ensure worker sessions/cache/temp exist; tighten ACLs on Windows.
#[tauri::command]
pub fn ensure_secure_dirs(app: AppHandle) -> Result<String, String> {
    let worker = resolve_worker_root(&app)?;
    for sub in ["sessions", "cache", "cache/open", "cache/thumbs", "cache/previews", "temp", "logs"] {
        let p = worker.join(sub);
        fs::create_dir_all(&p).map_err(|e| format!("mkdir {}: {e}", p.display()))?;
        #[cfg(windows)]
        restrict_user_only(&p);
    }
    #[cfg(windows)]
    restrict_user_only(&worker.join("sessions"));
    // Recover API credentials into secure store if empty (after P0 migrate wipe)
    let _ = seed_credentials_from_worker_env(&app);
    Ok(worker.to_string_lossy().to_string())
}

fn resolve_worker_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(resource) = app.path().resource_dir() {
        let p = resource.join("worker");
        if p.join("daemon.py").exists() {
            return Ok(p);
        }
    }
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let candidates = [
        cwd.join("worker"),
        cwd.join("..").join("worker"),
        cwd.join("..").join("..").join("worker"),
        cwd.join("..").join("..").join("..").join("worker"),
    ];
    for p in candidates {
        if p.join("daemon.py").exists() {
            return Ok(p.canonicalize().unwrap_or(p));
        }
    }
    Err("worker/ directory not found".into())
}

#[cfg(windows)]
fn restrict_user_only(path: &Path) {
    let user = std::env::var("USERNAME").unwrap_or_else(|_| "User".into());
    let _ = std::process::Command::new("icacls")
        .args([
            path.to_string_lossy().as_ref(),
            "/inheritance:r",
            "/grant:r",
            &format!("{}:(OI)(CI)F", user),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

/// Write a file under worker/temp only (jail). Returns absolute path.
#[tauri::command]
pub async fn write_worker_temp_file(
    app: AppHandle,
    filename: String,
    contents: String,
) -> Result<String, String> {
    let worker = resolve_worker_root(&app)?;
    let temp = worker.join("temp");
    fs::create_dir_all(&temp).map_err(|e| format!("mkdir temp: {e}"))?;

    // Jail filename: basename only, safe chars
    let base = Path::new(&filename)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("data.json");
    if base.contains("..") || base.is_empty() {
        return Err("invalid filename".into());
    }
    let safe: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if !safe.ends_with(".json") && !safe.ends_with(".txt") {
        return Err("only .json/.txt temp files allowed".into());
    }
    let path = temp.join(&safe);
    // Ensure still under temp
    let canon_temp = temp.canonicalize().unwrap_or(temp.clone());
    if let Ok(canon) = path.canonicalize() {
        if !canon.starts_with(&canon_temp) {
            return Err("path escape blocked".into());
        }
    } else {
        // file doesn't exist yet — check parent
        if let Some(parent) = path.parent() {
            if let Ok(cp) = parent.canonicalize() {
                if !cp.starts_with(&canon_temp) {
                    return Err("path escape blocked".into());
                }
            }
        }
    }
    fs::write(&path, contents.as_bytes()).map_err(|e| format!("write temp: {e}"))?;
    Ok(path
        .canonicalize()
        .unwrap_or(path)
        .to_string_lossy()
        .to_string())
}

/// Delete a file under worker/temp only (jail). Used after transfer jobs finish.
#[tauri::command]
pub async fn delete_worker_temp_file(app: AppHandle, path: String) -> Result<(), String> {
    let worker = resolve_worker_root(&app)?;
    let temp = worker
        .join("temp")
        .canonicalize()
        .map_err(|e| format!("temp dir: {e}"))?;
    let raw = path.trim().trim_matches('"');
    if raw.is_empty() {
        return Err("empty path".into());
    }
    let p = PathBuf::from(raw);
    let canon = p
        .canonicalize()
        .map_err(|e| format!("path not found: {e}"))?;
    if !canon.starts_with(&temp) {
        return Err("delete blocked: outside worker/temp".into());
    }
    let name = canon
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !(name.ends_with(".json") || name.ends_with(".txt") || name.ends_with(".part")) {
        return Err("delete blocked: only temp json/txt/part".into());
    }
    match fs::remove_file(&canon) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("delete temp: {e}")),
    }
}

/// Validate worker CLI args.
/// Spawn uses argv (no shell) so JSON/config values may contain punctuation —
/// we only block python -c, dangerous flags, and non-allowlisted scripts.
pub fn validate_worker_args(args: &[String]) -> Result<(), String> {
    for a in args {
        let t = a.trim();
        // Block python -c / -c=code injection
        if t == "-c" || t == "-c," {
            return Err("python -c is forbidden".into());
        }
        // -c=... but not --cron / --config etc. (those start with --)
        if t.starts_with("-c=") || t.starts_with("-c ") {
            return Err("python -c is forbidden".into());
        }
        // Block shell/command flags that execute free-form code
        if t == "--command" || t.starts_with("--command=") {
            return Err("--command is forbidden".into());
        }
        // Block absolute execute of unexpected scripts (allowlist)
        let lower = t.to_lowercase();
        if lower.ends_with(".py") {
            let name = Path::new(t)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            if name != "daemon.py" && name != "auth_manager.py" {
                return Err(format!("script not allowlisted: {name}"));
            }
        }
    }
    Ok(())
}


