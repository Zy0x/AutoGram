//! Submodule extracted from grammers_ops.rs

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use grammers_client::client::PasswordToken;
use grammers_client::message::InputMessage;
use grammers_client::{Client, SignInError};
use grammers_mtsender::SenderPool;
use grammers_session::storages::MemorySession;
use grammers_session::SessionData;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::runtime::Runtime;

use crate::core::path_policy;
use crate::core::session_guard;
use crate::core::session_rate;
use crate::core::telegram_ops::{
    AuthStatus, DialogEntry, TelegramIdentity, UploadStepResult, UserProfile,
};
use crate::core::telethon_session_import::{
    grammers_session_path, import_telethon_to_grammers_file, probe_telethon_session,
    read_session_data, telethon_session_path, write_session_data, TelethonSessionProbe,
};
use crate::core::tg_error::{map_invocation, TgError, TgErrorCode, TgErrorPublic};
use crate::core::tg_log;

use super::client_pool::*;
use super::media_list::*;
use super::media_transfer::*;
use super::peer_resolver::*;

pub fn resolve_sessions_dir(daemon_hint: Option<&Path>) -> PathBuf {
    if let Ok(p) = std::env::var("AUTOGRAM_SESSIONS_DIR") {
        let pb = PathBuf::from(p);
        if !pb.as_os_str().is_empty() {
            return pb;
        }
    }
    if let Some(daemon) = daemon_hint {
        if let Some(parent) = daemon.parent() {
            return parent.join("sessions");
        }
    }
    // Walk from cwd
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let mut dir = cwd.clone();
    for _ in 0..8 {
        let candidate = dir.join("worker").join("sessions");
        if candidate.is_dir() {
            return candidate;
        }
        let candidate2 = dir.join("sessions");
        if candidate2.is_dir() {
            return candidate2;
        }
        if !dir.pop() {
            break;
        }
    }
    cwd.join("worker").join("sessions")
}

pub fn runtime() -> Result<&'static Runtime, TgError> {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
    if let Some(runtime) = RUNTIME.get() {
        return Ok(runtime);
    }

    let worker_count = std::cmp::max(
        4,
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4),
    );
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .worker_threads(worker_count)
        .thread_name("autogram-grammers")
        .build()
        .map_err(|e| TgError::new(TgErrorCode::Internal, format!("tokio runtime: {e}")))?;
    // A process-wide runtime is required because progressive preview tasks live
    // beyond the command that returned the localhost stream URL to React.
    let _ = RUNTIME.set(runtime);
    RUNTIME.get().ok_or_else(|| {
        TgError::new(
            TgErrorCode::Internal,
            "failed to initialize shared Grammers runtime",
        )
    })
}

pub fn grammers_file_has_auth_key(path: &Path) -> bool {
    read_session_data(path)
        .map(|d| d.dc_options.values().any(|dc| dc.auth_key.is_some()))
        .unwrap_or(false)
}

/// Ensure Grammers JSON session file exists; import from Telethon **only when
/// Grammers has no auth_key**. Never overwrite a live Grammers login with a
/// stale Telethon `.session` (that caused "not authorized" after successful auth).
pub async fn ensure_grammers_session(
    sessions_dir: &Path,
    session_name: &str,
    import_if_missing: bool,
) -> Result<PathBuf, TgError> {
    let g_path = grammers_session_path(sessions_dir, session_name);
    let t_path = telethon_session_path(sessions_dir, session_name);

    if g_path.is_file() && grammers_file_has_auth_key(&g_path) {
        tg_log::debug(
            BACKEND,
            "session_ready",
            format!(
                "grammers_session={}",
                g_path.file_name().and_then(|s| s.to_str()).unwrap_or("?")
            ),
        );
        return Ok(g_path);
    }

    let needs_import = import_if_missing
        && t_path.is_file()
        && (!g_path.is_file() || !grammers_file_has_auth_key(&g_path));

    if needs_import {
        tg_log::info(
            BACKEND,
            "session_import_start",
            format!(
                "telethon={} → grammers={}",
                t_path.file_name().and_then(|s| s.to_str()).unwrap_or("?"),
                g_path.file_name().and_then(|s| s.to_str()).unwrap_or("?")
            ),
        );
        import_telethon_to_grammers_file(&t_path, &g_path).await?;
        return Ok(g_path);
    }

    if g_path.is_file() {
        return Ok(g_path);
    }
    // Keep new sessions in memory until SenderPool negotiates an auth key.
    tg_log::warn(
        BACKEND,
        "session_empty",
        "using in-memory session until auth key is ready",
    );
    Ok(g_path)
}

pub fn open_memory_session(path: &Path) -> Result<Arc<MemorySession>, TgError> {
    let data = read_session_data(path)?;
    Ok(Arc::new(MemorySession::from(data)))
}

pub fn persist_memory_session(session: &MemorySession, path: &Path) -> Result<(), TgError> {
    use grammers_session::Session;
    // Export live home DC + auth_key via Session trait (no From reverse required).
    let home = session
        .home_dc_id()
        .map_err(|e| TgError::new(TgErrorCode::SessionImportFailed, format!("home_dc: {e}")))?;
    let dc_opt = session
        .dc_option(home)
        .map_err(|e| TgError::new(TgErrorCode::SessionImportFailed, format!("dc_option: {e}")))?;
    let Some(dc) = dc_opt else {
        return Err(TgError::new(
            TgErrorCode::SessionImportFailed,
            "no home dc_option to persist",
        ));
    };
    let Some(key) = dc.auth_key else {
        // Still not authorized — leave existing file untouched if present
        if path.is_file() {
            return Ok(());
        }
        return Err(TgError::new(
            TgErrorCode::NotAuthorized,
            "session has no auth_key yet",
        ));
    };
    let mut data = SessionData::default();
    data.home_dc = home;
    if let Some(slot) = data.dc_options.get_mut(&home) {
        slot.auth_key = Some(key);
        slot.ipv4 = dc.ipv4;
    } else {
        data.dc_options.insert(home, dc);
    }
    write_session_data(path, &data)
}

/// Commit a login session only after Telegram itself confirms authorization.
/// QR, OTP and 2FA challenges deliberately remain in memory until this gate.
async fn persist_authorized_session(
    client: &Client,
    session: &MemorySession,
    path: &Path,
) -> Result<(), TgError> {
    let mut last_error = None;
    for attempt in 0..4u64 {
        match client.is_authorized().await {
            Ok(true) => return persist_memory_session(session, path),
            Ok(false) => {}
            Err(error) => last_error = Some(map_invocation(&error)),
        }
        tokio::time::sleep(Duration::from_millis(80 + attempt * 80)).await;
    }
    Err(last_error.unwrap_or_else(|| {
        TgError::new(
            TgErrorCode::NotAuthorized,
            "Telegram login completed but authorization was not confirmed",
        )
    }))
}

/// Keep a negotiated MTProto transport key between multi-step login calls when
/// available. A pending challenge must not fail merely because the sender has
/// not exposed its key yet.
fn persist_login_transport_best_effort(session: &MemorySession, path: &Path) {
    if let Err(error) = persist_memory_session(session, path) {
        tg_log::debug(BACKEND, "login_transport_pending", error.to_string());
    }
}

pub(crate) struct LiveClient {
    pub client: Client,
    pub session: Arc<MemorySession>,
    pub session_path: PathBuf,
    /// Keep runner task alive
    pub _runner: tokio::task::JoinHandle<()>,
}

/// Blocking wrappers for Tauri `spawn_blocking` / sync call sites.
pub fn probe_sessions_blocking(sessions_dir: &Path, session_name: &str) -> SessionProbeResult {
    let t = telethon_session_path(sessions_dir, session_name);
    let g = grammers_session_path(sessions_dir, session_name);
    SessionProbeResult {
        session: session_name.to_string(),
        telethon: probe_telethon_session(&t),
        grammers_exists: g.is_file(),
        grammers_path_name: g
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string(),
        backend: BACKEND.to_string(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionProbeResult {
    pub session: String,
    pub telethon: TelethonSessionProbe,
    pub grammers_exists: bool,
    pub grammers_path_name: String,
    pub backend: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSessionSummary {
    pub name: String,
    pub status: String,
    pub source: String,
}

/// Fast offline inventory. Network authorization is checked separately via
/// `tg_auth_status`, allowing Account to paint immediately without spawning a
/// Python process for every refresh.
pub fn list_native_sessions(sessions_dir: &Path) -> Vec<NativeSessionSummary> {
    let mut names: HashMap<String, (bool, bool)> = HashMap::new();
    let Ok(entries) = std::fs::read_dir(sessions_dir) else {
        return Vec::new();
    };
    for entry in entries.flatten() {
        let Some(file_name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if let Some(name) = file_name.strip_suffix(".grammers.json") {
            if !name.is_empty() && !name.ends_with("_preview") {
                names.entry(name.to_string()).or_default().0 = true;
            }
        } else if let Some(name) = file_name.strip_suffix(".session") {
            if !name.is_empty() && !name.ends_with("_preview") {
                names.entry(name.to_string()).or_default().1 = true;
            }
        }
    }
    let mut result = names
        .into_iter()
        .map(|(name, (native, legacy))| NativeSessionSummary {
            name,
            status: if native {
                "checking"
            } else {
                "migration_required"
            }
            .into(),
            source: match (native, legacy) {
                (true, true) => "grammers+migration_source",
                (true, false) => "grammers",
                (false, true) => "telethon_migration_source",
                _ => "unknown",
            }
            .into(),
        })
        .collect::<Vec<_>>();
    result.sort_by(|a, b| {
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
    });
    result
}

pub fn import_session_blocking(sessions_dir: &Path, session_name: &str) -> Result<(), TgError> {
    let rt = runtime()?;
    rt.block_on(async {
        let t = telethon_session_path(sessions_dir, session_name);
        let g = grammers_session_path(sessions_dir, session_name);
        import_telethon_to_grammers_file(&t, &g).await
    })
}

pub fn auth_status_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
) -> Result<AuthStatus, TgError> {
    let rt = runtime()?;
    let session_name = identity.session.clone();
    // Offline fast-fail with clear message when no key on disk
    let g_path = grammers_session_path(sessions_dir, &identity.session);
    let t_path = telethon_session_path(sessions_dir, &identity.session);
    if !grammers_file_has_auth_key(&g_path) && !t_path.is_file() {
        return Ok(AuthStatus {
            backend: BACKEND.to_string(),
            authorized: false,
            session: session_name,
            user: None,
        });
    }
    rt.block_on(async {
        // One reconnect if cached client is stale after login in another path
        let mut attempt = 0;
        loop {
            attempt += 1;
            let result = with_client(sessions_dir, identity, true, {
                let session_name = session_name.clone();
                move |client| {
                    let session_name = session_name.clone();
                    Box::pin(async move {
                        let authorized = client
                            .is_authorized()
                            .await
                            .map_err(|e| map_invocation(&e))?;
                        let mut profile = None;
                        if authorized {
                            // Skip placeholder profiles (id==0 inserted by client_pool before get_me).
                            // Also re-fetch if photo is missing so first-run after avatar feature update works.
                            let cached = get_cached_user_profile(&session_name);
                            let has_real_profile = cached.as_ref().map_or(false, |p| {
                                p.id != 0 && p.photo_base64.is_some()
                            });
                            if has_real_profile {
                                profile = cached;
                            } else {
                                match client.get_me().await {
                                    Ok(u) => {
                                        let p = user_profile_from(&u);
                                        set_cached_user_profile(&session_name, p.clone());
                                        profile = Some(p);
                                    }
                                    Err(e) => {
                                        tg_log::warn(
                                            BACKEND,
                                            "get_me",
                                            map_invocation(&e).to_string(),
                                        );
                                        // Fall back to placeholder if get_me fails
                                        profile = cached;
                                    }
                                }
                            }
                        }
                        tg_log::info(
                            BACKEND,
                            "auth_status",
                            format!(
                                "{} authorized={} user={}",
                                tg_log::session_label(&session_name),
                                authorized,
                                profile
                                    .as_ref()
                                    .map(|p| p.id.to_string())
                                    .unwrap_or_else(|| "-".into())
                            ),
                        );
                        Ok(AuthStatus {
                            backend: BACKEND.to_string(),
                            authorized,
                            session: session_name,
                            user: profile,
                        })
                    })
                }
            })
            .await;
            match result {
                Ok(status) if status.authorized || attempt >= 2 => return Ok(status),
                Ok(status) => {
                    // Not authorized — drop cache and retry once (post-login race)
                    disconnect_cached_session(&identity.session);
                    tg_log::warn(
                        BACKEND,
                        "auth_status_retry",
                        format!(
                            "{} authorized=false attempt={}",
                            tg_log::session_label(&identity.session),
                            attempt
                        ),
                    );
                    let _ = status;
                }
                Err(e) if attempt < 2 => {
                    disconnect_cached_session(&identity.session);
                    tg_log::warn(BACKEND, "auth_status_retry_err", e.to_string());
                }
                Err(e) => return Err(e),
            }
        }
    })
}

/// Download the actual Telegram profile photo for the current session user.
/// Returns a base64 data-URL string (JPEG), or None if unavailable.
///
/// Strategy (same as Drive thumbnail pipeline):
///  1. PhotoCachedSize   → inline bytes, zero network (fastest)
///  2. PhotoStrippedSize → unstrip JPEG, zero network
///  3. PhotoSize         → download via upload.GetFile (fallback)
pub fn download_profile_photo_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
) -> Result<Option<String>, TgError> {
    let rt = runtime()?;
    rt.block_on(async {
        with_client(sessions_dir, identity, false, move |client| {
            Box::pin(async move {
                use grammers_client::tl;

                // Request the 1 most recent profile photo for the current user
                let result = client
                    .invoke(&tl::functions::photos::GetUserPhotos {
                        user_id: tl::enums::InputUser::UserSelf,
                        offset: 0,
                        max_id: 0,
                        limit: 1,
                    })
                    .await
                    .map_err(|e| map_invocation(&e))?;

                let (photos, _users) = match result {
                    tl::enums::photos::Photos::Photos(p) => (p.photos, p.users),
                    tl::enums::photos::Photos::Slice(s) => (s.photos, s.users),
                };

                let Some(photo_enum) = photos.into_iter().next() else {
                    return Ok(None);
                };

                let tl::enums::Photo::Photo(photo) = photo_enum else {
                    return Ok(None);
                };

                // ── Strategy 1 & 2: Check for inline bytes (Cached / Stripped) via Grammers PhotoSize helper ──
                for size in &photo.sizes {
                    let helper = grammers_client::media::PhotoSize::from(size.clone());
                    if let Some(data) = helper.to_data() {
                        if !data.is_empty() {
                            let jpeg = crate::core::grammers::ffmpeg::unstrip_jpeg(&data).unwrap_or(data);
                            tg_log::info(BACKEND, "profile_photo", "using inline photo bytes");
                            return Ok(crate::core::grammers::thumbs::to_data_url(&jpeg));
                        }
                    }
                }

                // ── Strategy 3: Download smallest non-stripped PhotoSize ──
                let preferred_types = ["s", "m", "a", "b", "c"];
                let chosen_type = preferred_types.iter().find_map(|&t| {
                    photo.sizes.iter().find_map(|s| match s {
                        tl::enums::PhotoSize::Size(sz) if sz.r#type == t && sz.size > 0 => {
                            Some(t.to_string())
                        }
                        _ => None,
                    })
                });

                let size_type = match chosen_type {
                    Some(t) => t,
                    None => {
                        tg_log::warn(BACKEND, "profile_photo", "no downloadable size found");
                        return Ok(None);
                    }
                };

                tg_log::info(
                    BACKEND,
                    "profile_photo",
                    format!("downloading via GetFile size_type={size_type}"),
                );

                let location = tl::enums::InputFileLocation::InputPhotoFileLocation(
                    tl::types::InputPhotoFileLocation {
                        id: photo.id,
                        access_hash: photo.access_hash,
                        file_reference: photo.file_reference.clone(),
                        thumb_size: size_type,
                    },
                );

                let mut bytes = Vec::new();
                let mut offset = 0i64;
                let chunk_size = 128 * 1024i32;

                loop {
                    let res = client
                        .invoke(&tl::functions::upload::GetFile {
                            precise: false,
                            cdn_supported: false,
                            location: location.clone(),
                            offset,
                            limit: chunk_size,
                        })
                        .await
                        .map_err(|e| map_invocation(&e))?;

                    match res {
                        tl::enums::upload::File::File(f) => {
                            let is_done = (f.bytes.len() as i32) < chunk_size;
                            bytes.extend_from_slice(&f.bytes);
                            if is_done || bytes.len() > 2 * 1024 * 1024 {
                                break;
                            }
                            offset += f.bytes.len() as i64;
                        }
                        _ => break,
                    }
                }

                if bytes.is_empty() {
                    return Ok(None);
                }

                Ok(crate::core::grammers::thumbs::to_data_url(&bytes))
            })
        })
        .await
    })
}




/// Drop live MTProto client for a session (account switch without dual-open).
pub fn disconnect_session_blocking(session_name: &str) {
    disconnect_cached_session(session_name);
    clear_cached_user_profile(session_name);
    // Drop activity tokens so exclusive workers are not blocked by a dead UI.
    let n = crate::core::session_guard::release_all_for_session(session_name);
    if n > 0 {
        tg_log::info(
            BACKEND,
            "session_guard_cleared",
            format!(
                "{} released_activities={}",
                tg_log::session_label(session_name),
                n
            ),
        );
    }
}

pub fn clear_cached_user_profile(session_name: &str) {
    let mut clients = live_clients().lock();
    if let Some(c) = clients.get_mut(session_name) {
        c.user_profile = None;
    }
}

// For login we use a simpler request/sign_in flow in one blocking call with phone+code together.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub phone: String,
    pub code: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResult {
    pub status: String,
    pub needs_code: bool,
    pub needs_password: bool,
    pub password_hint: Option<String>,
    pub user: Option<UserProfile>,
    pub message: String,
    pub error: Option<TgErrorPublic>,
}

/// Two-phase login: without code → request_login_code (returns needs_code).
/// With code → sign_in (+ password if needed).
pub fn login_blocking(sessions_dir: &Path, req: &LoginRequest) -> Result<LoginResult, TgError> {
    if req.api_id <= 0 || req.api_hash.trim().is_empty() {
        return Err(TgError::new(
            TgErrorCode::NotConfigured,
            "API ID atau API hash belum dikonfigurasi",
        ));
    }
    let identity = TelegramIdentity {
        session: req.session.clone(),
        api_id: req.api_id,
        api_hash: req.api_hash.clone(),
    };
    let phone = req.phone.trim().to_string();
    let has_password = req
        .password
        .as_deref()
        .map(str::trim)
        .is_some_and(|s| !s.is_empty());
    if phone.is_empty() && !has_password {
        return Err(TgError::new(TgErrorCode::Auth, "phone required"));
    }
    let rt = runtime()?;
    rt.block_on(async {
        let operation_lock = session_operation_lock(&identity.session);
        let _operation_guard = operation_lock.write().await;
        disconnect_cached_session(&identity.session);
        // Do not import telethon on brand-new login — use fresh grammers file
        let g_path = grammers_session_path(sessions_dir, &identity.session);
        if let Some(parent) = g_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let session = open_memory_session(&g_path)?;
        let SenderPool { runner, handle, .. } =
            SenderPool::new(Arc::clone(&session), identity.api_id as i32);
        let client = Client::new(handle);
        let _runner = tokio::spawn(async move {
            runner.run().await;
        });
        tokio::time::sleep(Duration::from_millis(100)).await;

        if client
            .is_authorized()
            .await
            .map_err(|e| map_invocation(&e))?
        {
            let u = client.get_me().await.map_err(|e| map_invocation(&e))?;
            persist_authorized_session(&client, &session, &g_path).await?;
            client.disconnect();
            return Ok(LoginResult {
                status: "already_authorized".into(),
                needs_code: false,
                needs_password: false,
                password_hint: None,
                user: Some(user_profile_from(&u)),
                message: "Session already authorized".into(),
                error: None,
            });
        }

        // Third phase: 2FA password after a previous sign_in/QR response.
        // Keep this independent from phone/code so the UI never has to resend
        // an expired OTP merely to submit the cloud password.
        if let Some(password) = req
            .password
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            if req
                .code
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .is_none()
            {
                let pw_token = take_password_token(&identity.session).ok_or_else(|| {
                    TgError::new(
                        TgErrorCode::Auth,
                        "2FA challenge expired — start login again",
                    )
                })?;
                match client.check_password(pw_token, password.as_bytes()).await {
                    Ok(u) => {
                        let prof = user_profile_from(&u);
                        persist_authorized_session(&client, &session, &g_path).await?;
                        client.disconnect();
                        return Ok(LoginResult {
                            status: "authorized".into(),
                            needs_code: false,
                            needs_password: false,
                            password_hint: None,
                            user: Some(prof),
                            message: "Login 2FA Grammers berhasil".into(),
                            error: None,
                        });
                    }
                    Err(SignInError::InvalidPassword(next_token)) => {
                        store_password_token(&identity.session, next_token);
                        client.disconnect();
                        return Err(TgError::new(TgErrorCode::Auth, "invalid_password"));
                    }
                    Err(e) => {
                        client.disconnect();
                        return Err(TgError::new(TgErrorCode::Auth, format!("2FA failed: {e}")));
                    }
                }
            }
        }

        let code = req.code.as_deref().map(str::trim).filter(|s| !s.is_empty());
        if code.is_none() {
            // Request code only
            match client.request_login_code(&phone, &identity.api_hash).await {
                Ok(_token) => {
                    // Token cannot be persisted easily across process calls without storing it.
                    // Document: second call must happen soon; we store token in static map.
                    store_login_token(&identity.session, _token);
                    persist_login_transport_best_effort(&session, &g_path);
                    client.disconnect();
                    tg_log::info(BACKEND, "login_code_sent", "phone_ok=1");
                    return Ok(LoginResult {
                        status: "code_sent".into(),
                        needs_code: true,
                        needs_password: false,
                        password_hint: None,
                        user: None,
                        message: "Kode login dikirim. Masukkan code dari Telegram.".into(),
                        error: None,
                    });
                }
                Err(e) => {
                    client.disconnect();
                    return Err(map_invocation(&e));
                }
            }
        }

        let token = take_login_token(&identity.session).ok_or_else(|| {
            TgError::new(
                TgErrorCode::Auth,
                "login token missing — request code again",
            )
        })?;
        let code = code.unwrap();
        match client.sign_in(&token, code).await {
            Ok(u) => {
                let prof = user_profile_from(&u);
                persist_authorized_session(&client, &session, &g_path).await?;
                client.disconnect();
                tg_log::info(BACKEND, "login_ok", format!("user_id={}", prof.id));
                Ok(LoginResult {
                    status: "authorized".into(),
                    needs_code: false,
                    needs_password: false,
                    password_hint: None,
                    user: Some(prof),
                    message: "Login Grammers berhasil".into(),
                    error: None,
                })
            }
            Err(SignInError::PasswordRequired(pw_token)) => {
                let hint = pw_token.hint().map(|s| s.to_string());
                if let Some(pw) = req.password.as_deref().filter(|s| !s.is_empty()) {
                    match client.check_password(pw_token, pw.as_bytes()).await {
                        Ok(u) => {
                            let prof = user_profile_from(&u);
                            persist_authorized_session(&client, &session, &g_path).await?;
                            client.disconnect();
                            Ok(LoginResult {
                                status: "authorized".into(),
                                needs_code: false,
                                needs_password: false,
                                password_hint: None,
                                user: Some(prof),
                                message: "Login 2FA berhasil".into(),
                                error: None,
                            })
                        }
                        Err(e) => {
                            client.disconnect();
                            Err(TgError::new(TgErrorCode::Auth, format!("2FA failed: {e}")))
                        }
                    }
                } else {
                    persist_login_transport_best_effort(&session, &g_path);
                    store_password_token(&identity.session, pw_token);
                    client.disconnect();
                    Ok(LoginResult {
                        status: "password_required".into(),
                        needs_code: false,
                        needs_password: true,
                        password_hint: hint,
                        user: None,
                        message: "Akun memakai 2FA. Kirim password cloud.".into(),
                        error: None,
                    })
                }
            }
            Err(SignInError::InvalidCode) => {
                store_login_token(&identity.session, token);
                persist_login_transport_best_effort(&session, &g_path);
                client.disconnect();
                Err(TgError::new(TgErrorCode::Auth, "invalid_otp"))
            }
            Err(e) => {
                client.disconnect();
                let msg = e.to_string();
                if msg.to_ascii_lowercase().contains("sign up")
                    || msg.to_ascii_lowercase().contains("signup")
                {
                    return Err(TgError::new(
                        TgErrorCode::Auth,
                        "Sign-up required — complete registration in official Telegram first",
                    ));
                }
                Err(TgError::new(TgErrorCode::Auth, format!("sign_in: {e}")))
            }
        }
    })
}

// --- Login token stash (single pending per session name) ---

pub fn login_tokens() -> &'static Mutex<HashMap<String, grammers_client::client::LoginToken>> {
    static MAP: OnceLock<Mutex<HashMap<String, grammers_client::client::LoginToken>>> =
        OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn store_login_token(session: &str, token: grammers_client::client::LoginToken) {
    login_tokens().lock().insert(session.to_string(), token);
}

pub fn take_login_token(session: &str) -> Option<grammers_client::client::LoginToken> {
    login_tokens().lock().remove(session)
}

pub fn password_tokens() -> &'static Mutex<HashMap<String, PasswordToken>> {
    static MAP: OnceLock<Mutex<HashMap<String, PasswordToken>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn store_password_token(session: &str, token: PasswordToken) {
    password_tokens().lock().insert(session.to_string(), token);
}

pub fn take_password_token(session: &str) -> Option<PasswordToken> {
    password_tokens().lock().remove(session)
}

pub async fn grammers_qr_login(
    app: tauri::AppHandle,
    session_name: String,
    api_id: i64,
    api_hash: String,
) -> Result<(), TgError> {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64_URL;
    use base64::Engine as _;
    use grammers_session::Session;
    use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
    use tauri::Emitter;

    let sessions_dir = resolve_sessions_dir(None);
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(previous) = qr_cancel_flags()
        .lock()
        .insert(session_name.clone(), cancel.clone())
    {
        previous.store(true, AtomicOrdering::SeqCst);
    }
    let identity = TelegramIdentity {
        session: session_name.clone(),
        api_id,
        api_hash: api_hash.clone(),
    };
    let operation_lock = session_operation_lock(&session_name);
    let _operation_guard = operation_lock.write().await;
    disconnect_cached_session(&session_name);

    let live = connect_client(&sessions_dir, &identity, false).await?;

    if live.client.is_authorized().await.unwrap_or(false) {
        persist_authorized_session(&live.client, &live.session, &live.session_path).await?;
        live.client.disconnect();
        qr_cancel_flags().lock().remove(&session_name);
        let _ = app.emit(
            "qr-event",
            serde_json::json!({
                "status": "already_authorized",
                "session": session_name
            }),
        );
        return Ok(());
    }

    let except_ids = Vec::new();
    let mut login_success = false;

    while !login_success && !cancel.load(AtomicOrdering::SeqCst) {
        let res = live
            .client
            .invoke(&grammers_client::tl::functions::auth::ExportLoginToken {
                api_id: api_id as i32,
                api_hash: api_hash.clone(),
                except_ids: except_ids.clone(),
            })
            .await;

        match res {
            Ok(grammers_client::tl::enums::auth::LoginToken::Token(t)) => {
                let mut token_b64 = B64_URL.encode(&t.token);
                let url = format!("tg://login?token={}", token_b64);
                let _ = app.emit(
                    "qr-event",
                    serde_json::json!({
                        "status": "qr_code",
                        "url": url,
                        "expires": t.expires,
                        "session": session_name
                    }),
                );

                // Continuously poll ExportLoginToken every 1.5s for up to 28 seconds while user scans token
                let start_wait = std::time::Instant::now();
                while start_wait.elapsed().as_secs() < 28 && !cancel.load(AtomicOrdering::SeqCst) {
                    tokio::time::sleep(Duration::from_millis(1500)).await;
                    let check_res = live
                        .client
                        .invoke(&grammers_client::tl::functions::auth::ExportLoginToken {
                            api_id: api_id as i32,
                            api_hash: api_hash.clone(),
                            except_ids: except_ids.clone(),
                        })
                        .await;

                    match check_res {
                        Ok(grammers_client::tl::enums::auth::LoginToken::Success(_)) => {
                            login_success = true;
                            persist_authorized_session(
                                &live.client,
                                &live.session,
                                &live.session_path,
                            )
                            .await?;

                            let _ = app.emit(
                                "qr-event",
                                serde_json::json!({
                                    "status": "success",
                                    "session": session_name
                                }),
                            );
                            break;
                        }
                        Ok(grammers_client::tl::enums::auth::LoginToken::Token(refreshed_t)) => {
                            let new_token_b64 = B64_URL.encode(&refreshed_t.token);
                            if new_token_b64 != token_b64 {
                                let url = format!("tg://login?token={}", new_token_b64);
                                let _ = app.emit(
                                    "qr-event",
                                    serde_json::json!({
                                        "status": "qr_code",
                                        "url": url,
                                        "expires": refreshed_t.expires,
                                        "session": session_name
                                    }),
                                );
                                token_b64 = new_token_b64;
                            }
                        }
                        Ok(grammers_client::tl::enums::auth::LoginToken::MigrateTo(migrate)) => {
                            live.session
                                .set_home_dc_id(migrate.dc_id)
                                .await
                                .map_err(|e| {
                                    TgError::new(TgErrorCode::Auth, format!("QR migrate DC: {e}"))
                                })?;
                            match live
                                .client
                                .invoke(&grammers_client::tl::functions::auth::ImportLoginToken {
                                    token: migrate.token,
                                })
                                .await
                            {
                                Ok(grammers_client::tl::enums::auth::LoginToken::Success(_)) => {
                                    login_success = true;
                                    persist_authorized_session(
                                        &live.client,
                                        &live.session,
                                        &live.session_path,
                                    )
                                    .await?;
                                    let _ = app.emit(
                                        "qr-event",
                                        serde_json::json!({"status":"success","session":session_name}),
                                    );
                                    break;
                                }
                                Ok(_) => {}
                                Err(err) => return Err(map_invocation(&err)),
                            }
                        }
                        Err(e) => {
                            let err_str = e.to_string();
                            if err_str.contains("SESSION_PASSWORD_NEEDED") {
                                let password: grammers_client::tl::types::account::Password = live
                                    .client
                                    .invoke(
                                        &grammers_client::tl::functions::account::GetPassword {},
                                    )
                                    .await
                                    .map_err(|err| map_invocation(&err))?
                                    .into();
                                let token = PasswordToken::new(password);
                                let hint = token.hint().map(str::to_string);
                                store_password_token(&session_name, token);
                                login_success = true;
                                persist_login_transport_best_effort(
                                    &live.session,
                                    &live.session_path,
                                );

                                let _ = app.emit(
                                    "qr-event",
                                    serde_json::json!({
                                        "status": "2fa_required",
                                        "password_hint": hint,
                                        "session": session_name
                                    }),
                                );
                                break;
                            } else if err_str.contains("AUTH_TOKEN_EXPIRED")
                                || err_str.contains("AUTH_TOKEN_INVALID")
                            {
                                break;
                            }
                        }
                    }
                }
            }
            Ok(grammers_client::tl::enums::auth::LoginToken::MigrateTo(migrate)) => {
                live.session
                    .set_home_dc_id(migrate.dc_id)
                    .await
                    .map_err(|e| TgError::new(TgErrorCode::Auth, format!("QR migrate DC: {e}")))?;
                match live
                    .client
                    .invoke(&grammers_client::tl::functions::auth::ImportLoginToken {
                        token: migrate.token,
                    })
                    .await
                {
                    Ok(grammers_client::tl::enums::auth::LoginToken::Success(_)) => {
                        login_success = true;
                        persist_authorized_session(&live.client, &live.session, &live.session_path)
                            .await?;
                        let _ = app.emit(
                            "qr-event",
                            serde_json::json!({"status":"success","session":session_name}),
                        );
                    }
                    Ok(_) => {}
                    Err(err) => return Err(map_invocation(&err)),
                }
            }
            Ok(grammers_client::tl::enums::auth::LoginToken::Success(_)) => {
                persist_authorized_session(&live.client, &live.session, &live.session_path).await?;

                let _ = app.emit(
                    "qr-event",
                    serde_json::json!({
                        "status": "success",
                        "session": session_name
                    }),
                );
                break;
            }
            Err(e) => {
                let err_str = e.to_string();
                if err_str.contains("SESSION_PASSWORD_NEEDED") {
                    let password: grammers_client::tl::types::account::Password = live
                        .client
                        .invoke(&grammers_client::tl::functions::account::GetPassword {})
                        .await
                        .map_err(|err| map_invocation(&err))?
                        .into();
                    let token = PasswordToken::new(password);
                    let hint = token.hint().map(str::to_string);
                    store_password_token(&session_name, token);
                    persist_login_transport_best_effort(&live.session, &live.session_path);

                    let _ = app.emit(
                        "qr-event",
                        serde_json::json!({
                            "status": "2fa_required",
                            "password_hint": hint,
                            "session": session_name
                        }),
                    );
                    break;
                } else if err_str.contains("AUTH_TOKEN_EXPIRED") {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                } else {
                    let _ = app.emit(
                        "qr-event",
                        serde_json::json!({
                            "status": "error",
                            "error": err_str,
                            "session": session_name
                        }),
                    );
                    break;
                }
            }
        }
    }

    // Session material is intentionally retained after expiry/error so the
    // automatic refresh or a 2FA retry never discards auth state in progress.

    live.client.disconnect();
    qr_cancel_flags().lock().remove(&session_name);
    Ok(())
}

pub fn qr_cancel_flags() -> &'static Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>> {
    static MAP: OnceLock<Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>> =
        OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn cancel_qr_login(session_name: &str) -> bool {
    if let Some(flag) = qr_cancel_flags().lock().remove(session_name) {
        flag.store(true, std::sync::atomic::Ordering::SeqCst);
        true
    } else {
        false
    }
}

pub fn delete_grammers_session_files(session_name: &str) -> Result<(), TgError> {
    let session_name = session_name.to_string();
    runtime()?.block_on(async move {
        let operation_lock = session_operation_lock(&session_name);
        let _operation_guard = operation_lock.write().await;
        disconnect_cached_session(&session_name);
        let sessions_dir = resolve_sessions_dir(None);
        let s_name = session_name.trim().trim_end_matches(".session");
        for ext in &[
            ".session",
            ".grammers.json",
            ".session-journal",
            ".session.lock",
        ] {
            let p = sessions_dir.join(format!("{}{}", s_name, ext));
            if p.exists() {
                for _ in 0..4 {
                    if std::fs::remove_file(&p).is_ok() {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
            }
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sessions_dir_nonempty() {
        let d = resolve_sessions_dir(None);
        assert!(!d.as_os_str().is_empty());
    }

    #[test]
    fn grammers_runtime_is_process_wide() {
        let first = runtime().expect("runtime") as *const Runtime;
        let second = runtime().expect("runtime") as *const Runtime;
        assert_eq!(first, second);
    }

    #[test]
    fn fresh_login_does_not_persist_session_before_auth_key() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("autogram-fresh-session-{nonce}"));
        std::fs::create_dir_all(&dir).expect("temp session dir");

        let path = runtime()
            .expect("runtime")
            .block_on(ensure_grammers_session(&dir, "Lavender", false))
            .expect("fresh in-memory session");

        assert_eq!(path, dir.join("Lavender.grammers.json"));
        assert!(
            !path.exists(),
            "session must wait for a negotiated auth key"
        );
        std::fs::remove_dir(&dir).expect("remove temp session dir");
    }

    #[test]
    fn flood_wait_is_not_transport_error() {
        let err = TgError::with_flood(31, "FLOOD_WAIT_31");
        assert!(!is_pool_or_transport_error(&err));
    }
}
