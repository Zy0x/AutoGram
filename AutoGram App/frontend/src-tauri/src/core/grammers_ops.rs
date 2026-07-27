//! Production Grammers MTProto operations (Phase 4).
//!
//! Dual-path: used when `AUTOGRAM_TELEGRAM_BACKEND=grammers` (or force flag).
//! Telethon companion remains default for Drive progressive stream / migration
//! until those subsystems are ported.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use grammers_client::message::InputMessage;
use grammers_client::client::PasswordToken;
use grammers_client::{Client, SignInError};
use grammers_mtsender::SenderPool;
use grammers_session::storages::MemorySession;
use grammers_session::SessionData;
use serde::{Deserialize, Serialize};
use tokio::runtime::Runtime;

use super::path_policy;
use super::telethon_session_import::{
    grammers_session_path, import_telethon_to_grammers_file, probe_telethon_session,
    read_session_data, telethon_session_path, write_session_data, TelethonSessionProbe,
};
use super::tg_error::{map_invocation, TgError, TgErrorCode, TgErrorPublic};
use super::tg_log;
use super::telegram_ops::{
    AuthStatus, DialogEntry, TelegramIdentity, UploadStepResult, UserProfile,
};

const BACKEND: &str = "grammers";

/// Convert grammers PeerId → stable i64 for UI (Bot API dialog id preferred).
pub(crate) fn peer_id_i64(id: grammers_session::types::PeerId) -> i64 {
    id.bot_api_dialog_id()
        .or_else(|| id.bare_id())
        .unwrap_or(0)
}

fn user_profile_from(u: &grammers_client::peer::User) -> UserProfile {
    UserProfile {
        id: peer_id_i64(u.id()),
        first_name: u.first_name().map(|s| s.to_string()),
        username: u.username().map(|s| s.to_string()),
    }
}

async fn peer_to_ref(peer: &grammers_client::peer::Peer) -> Result<grammers_session::types::PeerRef, TgError> {
    peer.to_ref()
        .await
        .map_err(|e| TgError::new(TgErrorCode::PeerNotFound, format!("peer.to_ref: {e}")))?
        .ok_or_else(|| {
            TgError::new(
                TgErrorCode::PeerNotFound,
                "peer has no usable PeerRef in session cache — open dialog once",
            )
        })
}

async fn user_to_ref(user: &grammers_client::peer::User) -> Result<grammers_session::types::PeerRef, TgError> {
    if let Some(r) = user
        .to_ref()
        .await
        .map_err(|e| TgError::new(TgErrorCode::PeerNotFound, format!("user.to_ref: {e}")))?
    {
        return Ok(r);
    }
    if user.is_self() {
        return Ok(grammers_session::types::PeerId::self_user().to_ambient_ref());
    }
    Ok(user.id().to_ambient_ref())
}

/// Resolve worker/sessions directory from daemon path or env.
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

pub(crate) fn runtime() -> Result<&'static Runtime, TgError> {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
    if let Some(runtime) = RUNTIME.get() {
        return Ok(runtime);
    }

    let worker_count = std::cmp::max(4, std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4));
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

fn session_operation_lock(session_name: &str) -> Arc<tokio::sync::RwLock<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<tokio::sync::RwLock<()>>>>> =
        OnceLock::new();
    let locks = LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = locks.lock();
    Arc::clone(
        guard
            .entry(session_name.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::RwLock::new(()))),
    )
}

/// Serialize connect/reconnect so concurrent callers never dual-open two
/// SenderPools for the same session (that races AUTH_KEY and drops the pool).
fn session_connect_lock(session_name: &str) -> Arc<tokio::sync::Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();
    let locks = LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = locks.lock();
    Arc::clone(
        guard
            .entry(session_name.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))),
    )
}

/// True when the live SenderPool is dead / socket closed and a reconnect can help.
fn is_pool_or_transport_error(err: &TgError) -> bool {
    match err.code() {
        TgErrorCode::Cancelled | TgErrorCode::Network | TgErrorCode::Io | TgErrorCode::Timeout => {
            true
        }
        _ => {
            let m = err.to_string().to_ascii_lowercase();
            m.contains("sender pool")
                || m.contains("pool stopped")
                || m.contains("request dropped")
                || m.contains("read 0 bytes")
                || m.contains("connection reset")
                || m.contains("broken pipe")
                || m.contains("connection closed")
                || m.contains("os error 10054")
                || m.contains("os error 104")
        }
    }
}

/// Only these errors must flush the cached client permanently (stale auth key).
fn is_fatal_auth_error(err: &TgError) -> bool {
    matches!(
        err.code(),
        TgErrorCode::NotAuthorized | TgErrorCode::Auth | TgErrorCode::SessionMissing
    ) || {
        let m = err.to_string().to_ascii_lowercase();
        m.contains("auth_key_unregistered")
            || m.contains("session_revoked")
            || m.contains("user_deactivated")
            || m.contains("session_expired")
    }
}

fn grammers_file_has_auth_key(path: &Path) -> bool {
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

fn open_memory_session(path: &Path) -> Result<Arc<MemorySession>, TgError> {
    let data = read_session_data(path)?;
    Ok(Arc::new(MemorySession::from(data)))
}

pub(crate) fn persist_memory_session(session: &MemorySession, path: &Path) -> Result<(), TgError> {
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

pub(crate) struct LiveClient {
    pub client: Client,
    pub session: Arc<MemorySession>,
    pub session_path: PathBuf,
    /// Keep runner task alive
    pub _runner: tokio::task::JoinHandle<()>,
}

struct CachedLiveClient {
    api_id: i64,
    live: Arc<LiveClient>,
    user_profile: Option<UserProfile>,
}

fn get_cached_user_profile(session_name: &str) -> Option<UserProfile> {
    let clients = live_clients().lock();
    clients.get(session_name).and_then(|c| c.user_profile.clone())
}

/// True if this session already proved authorized (skip extra is_authorized RPCs).
pub(crate) fn session_known_authorized(session_name: &str) -> bool {
    get_cached_user_profile(session_name).is_some()
}

async fn ensure_authorized(client: &Client, session_name: &str) -> Result<(), TgError> {
    if session_known_authorized(session_name) {
        return Ok(());
    }
    if client.is_authorized().await.map_err(|e| map_invocation(&e))? {
        // Soft-mark: profile may still be empty; insert placeholder so next calls skip
        // full is_authorized until get_me fills real profile.
        if get_cached_user_profile(session_name).is_none() {
            set_cached_user_profile(
                session_name,
                UserProfile {
                    id: 0,
                    first_name: None,
                    username: None,
                },
            );
        }
        return Ok(());
    }
    Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"))
}

fn set_cached_user_profile(session_name: &str, profile: UserProfile) {
    let mut clients = live_clients().lock();
    if let Some(c) = clients.get_mut(session_name) {
        c.user_profile = Some(profile);
    }
}

fn live_clients() -> &'static Mutex<HashMap<String, CachedLiveClient>> {
    static CLIENTS: OnceLock<Mutex<HashMap<String, CachedLiveClient>>> = OnceLock::new();
    CLIENTS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn disconnect_cached_session(session_name: &str) {
    if let Some(entry) = live_clients().lock().remove(session_name) {
        entry.live.client.disconnect();
    }
}

pub fn purge_inactive_sessions(active_session: &str) {
    let active = active_session.trim();
    let mut map = live_clients().lock();
    let to_remove: Vec<String> = map
        .keys()
        .filter(|s| *s != active && !s.is_empty())
        .cloned()
        .collect();
    for s in to_remove {
        if let Some(entry) = map.remove(&s) {
            entry.live.client.disconnect();
            tg_log::info(
                BACKEND,
                "purge_inactive_session",
                format!("disconnected inactive session: {s}"),
            );
        }
    }
}

pub(crate) async fn connect_client(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    import_if_missing: bool,
) -> Result<LiveClient, TgError> {
    if identity.api_id <= 0 {
        return Err(TgError::new(
            TgErrorCode::NotConfigured,
            "api_id invalid",
        ));
    }
    if identity.api_hash.trim().is_empty() {
        return Err(TgError::new(
            TgErrorCode::NotConfigured,
            "api_hash missing",
        ));
    }

    let g_path = ensure_grammers_session(sessions_dir, &identity.session, import_if_missing).await?;
    tg_log::info(
        BACKEND,
        "connect_start",
        format!(
            "{} api_id={}",
            tg_log::session_label(&identity.session),
            identity.api_id
        ),
    );

    let session = open_memory_session(&g_path)?;

    let SenderPool { runner, handle, .. } =
        SenderPool::new(Arc::clone(&session), identity.api_id as i32);
    let client = Client::new(handle);
    let runner_handle = tokio::spawn(async move {
        runner.run().await;
    });

    // SenderPool connects lazily on the first MTProto invocation; a fixed sleep
    // only made every account switch slower without improving correctness.
    tokio::task::yield_now().await;

    Ok(LiveClient {
        client,
        session,
        session_path: g_path,
        _runner: runner_handle,
    })
}

pub(crate) async fn with_client<F, T>(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    import_if_missing: bool,
    f: F,
) -> Result<T, TgError>
where
    F: for<'a> FnOnce(
        &'a Client,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<T, TgError>> + Send + 'a>,
    >,
{
    // Concurrent readers share the MTProto SenderPool; exclusive writers (login/delete) block.
    let operation_lock = session_operation_lock(&identity.session);
    let _operation_guard = operation_lock.read().await;

    let live = obtain_live_client(sessions_dir, identity, import_if_missing, false).await?;
    let result = f(&live.client).await;

    // Best-effort persist (peer cache / auth updates).
    if let Err(e) = persist_memory_session(&live.session, &live.session_path) {
        tg_log::warn(BACKEND, "session_persist", e.to_string());
    }

    match &result {
        Ok(_) => {}
        Err(e) if is_fatal_auth_error(e) => {
            // Stale/revoked auth — drop cache so next call re-imports or fails cleanly.
            disconnect_cached_session(&identity.session);
            tg_log::warn(
                BACKEND,
                "client_fatal_auth",
                format!("{} {}", tg_log::session_label(&identity.session), e),
            );
        }
        Err(e) if is_pool_or_transport_error(e) => {
            // Dead SenderPool / TCP closed — drop so the *next* call reconnects.
            // Do NOT disconnect on FloodWait / PeerNotFound (that killed concurrent
            // Studio thumbs while list_dialogs raced and failed).
            disconnect_cached_session(&identity.session);
            tg_log::warn(
                BACKEND,
                "client_pool_reset",
                format!("{} {}", tg_log::session_label(&identity.session), e),
            );
        }
        Err(e) => {
            // Record FLOOD_WAIT so preview/warm stop hammering Telegram.
            super::session_rate::note_error(&identity.session, e);
        }
    }
    result
}

/// Re-run an async MTProto op when the SenderPool dies mid-request.
///
/// Each `op` invocation must call `with_client` fresh so a rebuilt pool is used.
/// Captures that are not `Copy` must be `.clone()`d inside the `FnMut` body.
pub(crate) async fn with_pool_retry<T, Fut, F>(
    session_name: &str,
    mut op: F,
) -> Result<T, TgError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, TgError>>,
{
    const MAX_ATTEMPTS: u32 = 3;
    let mut last_err: Option<TgError> = None;
    for attempt in 1..=MAX_ATTEMPTS {
        match op().await {
            Ok(v) => return Ok(v),
            Err(e) if is_pool_or_transport_error(&e) && attempt < MAX_ATTEMPTS => {
                if let Some(flood) = e.flood_wait_secs() {
                    tg_log::warn(
                        BACKEND,
                        "flood_wait_sleep",
                        format!(
                            "{} attempt={}/{} flood_wait={flood}s before reconnect",
                            tg_log::session_label(session_name),
                            attempt,
                            MAX_ATTEMPTS,
                        ),
                    );
                    tokio::time::sleep(Duration::from_secs(flood as u64)).await;
                }
                disconnect_cached_session(session_name);
                tg_log::warn(
                    BACKEND,
                    "client_reconnect",
                    format!(
                        "{} attempt={}/{} err={}",
                        tg_log::session_label(session_name),
                        attempt,
                        MAX_ATTEMPTS,
                        e
                    ),
                );
                last_err = Some(e);
                tokio::time::sleep(Duration::from_millis(80 * u64::from(attempt))).await;
            }
            Err(e) => return Err(e),
        }
    }
    Err(last_err.unwrap_or_else(|| {
        TgError::new(TgErrorCode::Network, "Grammers client reconnect exhausted")
    }))
}

/// Fetch a cached live client or connect (serialized). When `force_fresh` is
/// true the cache is dropped first so a dead SenderPool is never reused.
pub(crate) async fn obtain_live_client(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    import_if_missing: bool,
    force_fresh: bool,
) -> Result<Arc<LiveClient>, TgError> {
    if force_fresh {
        disconnect_cached_session(&identity.session);
    } else {
        let cached = {
            let clients = live_clients().lock();
            clients
                .get(&identity.session)
                .filter(|entry| entry.api_id == identity.api_id)
                .map(|entry| Arc::clone(&entry.live))
        };
        if let Some(live) = cached {
            return Ok(live);
        }
    }

    let connect_lock = session_connect_lock(&identity.session);
    let _connect_guard = connect_lock.lock().await;

    // Double-check after waiting for the connect mutex (another task may have
    // already rebuilt the pool while we queued).
    if !force_fresh {
        let cached = {
            let clients = live_clients().lock();
            clients
                .get(&identity.session)
                .filter(|entry| entry.api_id == identity.api_id)
                .map(|entry| Arc::clone(&entry.live))
        };
        if let Some(live) = cached {
            return Ok(live);
        }
    } else {
        // Still force-fresh after lock: another reconnect may have inserted a
        // brand-new pool — prefer that over dual-open.
        let cached = {
            let clients = live_clients().lock();
            clients
                .get(&identity.session)
                .filter(|entry| entry.api_id == identity.api_id)
                .map(|entry| Arc::clone(&entry.live))
        };
        if let Some(live) = cached {
            // Only reuse if it was inserted after our disconnect (race-safe enough
            // for reconnect storms). Fresh Arc from peer is fine.
            return Ok(live);
        }
    }

    disconnect_cached_session(&identity.session);
    let live = Arc::new(connect_client(sessions_dir, identity, import_if_missing).await?);
    live_clients().lock().insert(
        identity.session.clone(),
        CachedLiveClient {
            api_id: identity.api_id,
            live: Arc::clone(&live),
            user_profile: None,
        },
    );
    Ok(live)
}

/// Create a pool of N parallel Client connections for high-speed multi-socket media downloading.
/// Each Client opens an independent TCP socket connection to Telegram DC sharing the in-memory session.
pub(crate) async fn obtain_download_clients(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    count: usize,
) -> Result<Vec<Client>, TgError> {
    let primary = obtain_live_client(sessions_dir, identity, true, false).await?;
    let mut clients = vec![primary.client.clone()];
    if count <= 1 {
        return Ok(clients);
    }
    for _ in 1..count {
        let SenderPool { runner, handle, .. } =
            SenderPool::new(Arc::clone(&primary.session), identity.api_id as i32);
        let client = Client::new(handle);
        tokio::spawn(async move {
            runner.run().await;
        });
        clients.push(client);
    }
    Ok(clients)
}

/// Blocking wrappers for Tauri `spawn_blocking` / sync call sites.
pub fn probe_sessions_blocking(
    sessions_dir: &Path,
    session_name: &str,
) -> SessionProbeResult {
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
            status: if native { "checking" } else { "migration_required" }.into(),
            source: match (native, legacy) {
                (true, true) => "grammers+migration_source",
                (true, false) => "grammers",
                (false, true) => "telethon_migration_source",
                _ => "unknown",
            }
            .into(),
        })
        .collect::<Vec<_>>();
    result.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
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
                        let authorized =
                            client.is_authorized().await.map_err(|e| map_invocation(&e))?;
                        let mut profile = None;
                        if authorized {
                            if let Some(cached) = get_cached_user_profile(&session_name) {
                                profile = Some(cached);
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

/// Drop live MTProto client for a session (account switch without dual-open).
pub fn disconnect_session_blocking(session_name: &str) {
    disconnect_cached_session(session_name);
    clear_cached_user_profile(session_name);
    // Drop activity tokens so exclusive workers are not blocked by a dead UI.
    let n = super::session_guard::release_all_for_session(session_name);
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

fn clear_cached_user_profile(session_name: &str) {
    let mut clients = live_clients().lock();
    if let Some(c) = clients.get_mut(session_name) {
        c.user_profile = None;
    }
}

pub fn list_dialogs_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    limit: usize,
) -> Result<Vec<DialogEntry>, TgError> {
    let rt = runtime()?;
    let limit = limit.clamp(1, 500);
    rt.block_on(async {
        // Auto-reconnect on "sender pool stopped" / "I/O: read 0 bytes"
        let session_name = identity.session.clone();
        with_pool_retry(&identity.session, || {
            let session_name = session_name.clone();
            with_client(sessions_dir, identity, true, |client| {
                Box::pin(async move {
                    ensure_authorized(client, &session_name).await?;
                    let mut out = Vec::new();
                    let mut dialogs = client.iter_dialogs();
                    while let Some(dialog) = dialogs.next().await.map_err(|e| map_invocation(&e))? {
                        let peer = dialog.peer();
                        let id = peer_id_i64(peer.id());
                        let title = peer
                            .name()
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| id.to_string());
                        let (is_user, is_channel, is_group, is_forum) = match &peer {
                            grammers_client::peer::Peer::User(_) => (true, false, false, false),
                            grammers_client::peer::Peer::Channel(ch) => {
                                // Broadcast channel
                                (false, true, false, ch.raw.forum)
                            }
                            grammers_client::peer::Peer::Group(g) => {
                                use grammers_client::tl::enums::Chat as C;
                                let forum = match &g.raw {
                                    C::Channel(c) => c.forum,
                                    _ => false,
                                };
                                // Megagroup → treat as group (is_channel false for UI folders)
                                (false, false, true, forum)
                            }
                        };
                        out.push(DialogEntry {
                            id,
                            title,
                            is_user,
                            is_channel,
                            is_group,
                            is_forum,
                        });
                        if out.len() >= limit {
                            break;
                        }
                    }
                    tg_log::info(
                        BACKEND,
                        "list_dialogs",
                        format!("count={} limit={}", out.len(), limit),
                    );
                    Ok(out)
                })
            })
        })
        .await
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogFilterRow {
    pub id: i32,
    pub title: String,
    pub kind: String,
}

pub fn list_dialog_filters_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
) -> Result<Vec<DialogFilterRow>, TgError> {
    let rt = runtime()?;
    rt.block_on(async {
        with_pool_retry(&identity.session, || {
            with_client(sessions_dir, identity, true, |client| {
                Box::pin(async move {
                    let raw: grammers_client::tl::types::messages::DialogFilters = client
                        .invoke(&grammers_client::tl::functions::messages::GetDialogFilters {})
                        .await
                        .map_err(|e| map_invocation(&e))?
                        .into();
                    let mut rows = vec![DialogFilterRow {
                        id: 0,
                        title: "Semua Chat".into(),
                        kind: "all".into(),
                    }];
                    for filter in raw.filters {
                        match filter {
                            grammers_client::tl::enums::DialogFilter::Filter(f) => {
                                let grammers_client::tl::enums::TextWithEntities::Entities(title) =
                                    f.title;
                                rows.push(DialogFilterRow {
                                    id: f.id,
                                    title: title.text,
                                    kind: "folder".into(),
                                });
                            }
                            grammers_client::tl::enums::DialogFilter::Chatlist(f) => {
                                let grammers_client::tl::enums::TextWithEntities::Entities(title) =
                                    f.title;
                                rows.push(DialogFilterRow {
                                    id: f.id,
                                    title: title.text,
                                    kind: "shared".into(),
                                });
                            }
                            grammers_client::tl::enums::DialogFilter::Default => {}
                        }
                    }
                    Ok(rows)
                })
            })
        })
        .await
    })
}

static PEER_RESOLVE_CACHE: std::sync::OnceLock<std::sync::RwLock<std::collections::HashMap<String, grammers_session::types::PeerRef>>> = std::sync::OnceLock::new();

fn peer_cache() -> &'static std::sync::RwLock<std::collections::HashMap<String, grammers_session::types::PeerRef>> {
    PEER_RESOLVE_CACHE.get_or_init(|| std::sync::RwLock::new(std::collections::HashMap::new()))
}

pub(crate) fn clear_peer_cache_for_all(chat_id: &str) {
    let s = chat_id.trim();
    let s_clean = s.trim_start_matches('-');
    let s_bare = if s_clean.starts_with("100") && s_clean.len() > 3 {
        &s_clean[3..]
    } else {
        s_clean
    };
    if let Ok(mut guard) = peer_cache().write() {
        let keys_to_remove: Vec<String> = guard
            .keys()
            .filter(|k| k.ends_with(&format!(":{s}")) || k.ends_with(&format!(":{s_bare}")))
            .cloned()
            .collect();
        for k in keys_to_remove {
            guard.remove(&k);
        }
    }
}

pub(crate) async fn resolve_peer(
    client: &Client,
    chat_id: &str,
) -> Result<grammers_session::types::PeerRef, TgError> {
    let s = chat_id.trim();
    if s.is_empty() {
        return Err(TgError::new(TgErrorCode::PeerNotFound, "chat_id empty"));
    }

    let owner_id = client.get_me().await.map(|u| peer_id_i64(u.id())).unwrap_or(0);
    let ckey = |k: &str| format!("{owner_id}:{k}");

    if s.eq_ignore_ascii_case("me") || s.eq_ignore_ascii_case("self") || s == "0" {
        let me = client.get_me().await.map_err(|e| map_invocation(&e))?;
        let res = user_to_ref(&me).await;
        if let Ok(ref pref) = res {
            if owner_id != 0 {
                if let Ok(mut guard) = peer_cache().write() {
                    guard.insert(ckey(s), *pref);
                }
            }
        }
        return res;
    }
    if s.starts_with('@') || (s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') && s.chars().any(|c| c.is_ascii_alphabetic())) {
        let uname = s.trim_start_matches('@');
        if let Some(peer) = client
            .resolve_username(uname)
            .await
            .map_err(|e| map_invocation(&e))?
        {
            let res = peer_to_ref(&peer).await;
            if let Ok(ref pref) = res {
                if owner_id != 0 {
                    if let Ok(mut guard) = peer_cache().write() {
                        guard.insert(ckey(s), *pref);
                    }
                }
            }
            return res;
        }
        return Err(TgError::new(
            TgErrorCode::PeerNotFound,
            format!("username @{uname} not found"),
        ));
    }

    let want: i64 = s
        .parse()
        .map_err(|_| TgError::new(TgErrorCode::PeerNotFound, format!("invalid chat_id: {s}")))?;

    let s_clean = s.trim_start_matches('-');
    let s_bare = if s_clean.starts_with("100") && s_clean.len() > 3 {
        &s_clean[3..]
    } else {
        s_clean
    };
    let want_bare: i64 = s_bare.parse().unwrap_or(want.abs());

    // Fast path: check in-memory cache scoped by active user identity
    if owner_id != 0 {
        if let Ok(guard) = peer_cache().read() {
            if let Some(peer_ref) = guard.get(&ckey(s)) {
                return Ok(*peer_ref);
            }
            if let Some(peer_ref) = guard.get(&ckey(s_bare)) {
                return Ok(*peer_ref);
            }
            let alt1 = format!("-100{s_bare}");
            if let Some(peer_ref) = guard.get(&ckey(&alt1)) {
                return Ok(*peer_ref);
            }
            let alt2 = format!("-{s_bare}");
            if let Some(peer_ref) = guard.get(&ckey(&alt2)) {
                return Ok(*peer_ref);
            }
        }
    }

    let mut dialogs = client.iter_dialogs();
    while let Some(dialog) = dialogs.next().await.map_err(|e| map_invocation(&e))? {
        let peer = dialog.peer();
        let pid = peer_id_i64(peer.id());
        let bid = peer.id().bare_id();

        if pid == want || pid == -want || (bid.is_some() && (bid.unwrap() == want_bare || bid.unwrap() == want.abs())) {
            let res = peer_to_ref(&peer).await;
            if let Ok(ref pref) = res {
                if owner_id != 0 {
                    if let Ok(mut guard) = peer_cache().write() {
                        guard.insert(ckey(s), *pref);
                        guard.insert(ckey(s_bare), *pref);
                        guard.insert(ckey(&format!("-100{s_bare}")), *pref);
                        guard.insert(ckey(&format!("-{s_bare}")), *pref);
                    }
                }
            }
            return res;
        }
    }
    Err(TgError::new(
        TgErrorCode::PeerNotFound,
        format!(
            "peer {want} not in dialogs — open the chat in Telegram once, then retry"
        ),
    ))
}

/// Drive-compatible media row (subset of frontend DriveFile).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFileRow {
    pub id: i64,
    pub folder_id: Option<i64>,
    pub name: String,
    pub size: u64,
    pub mime_type: Option<String>,
    pub icon_type: String,
    pub created_at: Option<String>,
    pub has_thumb: bool,
    pub as_document: bool,
    pub backend: String,
    /// Inline stripped thumb (data:image/…) — paints grid without a second RPC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumb_data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMediaResult {
    pub status: String,
    pub folder_id: Option<i64>,
    pub files: Vec<MediaFileRow>,
    pub total: usize,
    pub page_size: usize,
    pub has_more: bool,
    pub next_offset_id: Option<i64>,
    pub backend: String,
    pub cached: bool,
}

fn media_to_row(msg: &grammers_client::message::Message, folder_id: Option<i64>) -> Option<MediaFileRow> {
    use grammers_client::media::Media;
    let id = msg.id() as i64;
    let created = Some(msg.date().to_rfc3339());
    let caption = msg.text().trim();
    let maybe_media = msg.media();

    if let Some(media) = maybe_media {
        let size = media.size().unwrap_or(0) as u64;
        let thumb_data_url = super::grammers_media::stripped_thumb_data_url(&media);
        let has_thumb = thumb_data_url.is_some()
            || match &media {
                Media::Photo(_) => true,
                Media::Document(d) => {
                    let mime = d.mime_type().unwrap_or("").to_lowercase();
                    let name = d.name().unwrap_or("").to_lowercase();
                    let is_video = mime.starts_with("video/")
                        || name.ends_with(".mp4")
                        || name.ends_with(".mov")
                        || name.ends_with(".mkv")
                        || name.ends_with(".webm")
                        || name.ends_with(".avi")
                        || name.ends_with(".m4v")
                        || name.ends_with(".3gp");
                    !d.thumbs().is_empty() || is_video
                }
                Media::Sticker(s) => !s.document.thumbs().is_empty(),
                _ => false,
            };
        match media {
            Media::Photo(_p) => {
                let name = if !caption.is_empty() {
                    format!("{caption}.jpg")
                } else {
                    format!("photo_{id}.jpg")
                };
                Some(MediaFileRow {
                    id,
                    folder_id,
                    name,
                    size,
                    mime_type: Some("image/jpeg".into()),
                    icon_type: "image".into(),
                    created_at: created,
                    has_thumb,
                    as_document: false,
                    backend: BACKEND.into(),
                    thumb_data_url,
                })
            }
            Media::Document(doc) => {
                let n = doc
                    .name()
                    .map(|s| s.to_string())
                    .filter(|s| !s.is_empty())
                    .or_else(|| {
                        if !caption.is_empty() {
                            Some(caption.to_string())
                        } else {
                            None
                        }
                    })
                    .unwrap_or_else(|| format!("file_{id}"));
                let mime = doc.mime_type().map(|s| s.to_string());
                let mime_l = mime.as_deref().unwrap_or("").to_ascii_lowercase();
                let name_l = n.to_ascii_lowercase();

                let is_video_file = mime_l.starts_with("video/")
                    || name_l.ends_with(".mp4")
                    || name_l.ends_with(".mov")
                    || name_l.ends_with(".mkv")
                    || name_l.ends_with(".webm")
                    || name_l.ends_with(".avi")
                    || name_l.ends_with(".m4v")
                    || name_l.ends_with(".3gp")
                    || name_l.ends_with(".flv")
                    || name_l.ends_with(".wmv")
                    || name_l.ends_with(".ts")
                    || name_l.ends_with(".m2ts")
                    || name_l.ends_with(".vob")
                    || name_l.ends_with(".ogv");

                let is_image_file = mime_l.starts_with("image/")
                    || name_l.ends_with(".jpg")
                    || name_l.ends_with(".jpeg")
                    || name_l.ends_with(".png")
                    || name_l.ends_with(".webp")
                    || name_l.ends_with(".gif")
                    || name_l.ends_with(".bmp")
                    || name_l.ends_with(".tiff");

                let is_audio_file = mime_l.starts_with("audio/")
                    || name_l.ends_with(".mp3")
                    || name_l.ends_with(".wav")
                    || name_l.ends_with(".flac")
                    || name_l.ends_with(".m4a")
                    || name_l.ends_with(".aac")
                    || name_l.ends_with(".ogg")
                    || name_l.ends_with(".opus");

                let icon = if is_video_file {
                    "video"
                } else if is_audio_file {
                    "audio"
                } else if is_image_file {
                    "image"
                } else {
                    "document"
                };

                let final_mime = if mime.is_none() || mime_l == "application/octet-stream" {
                    if is_video_file {
                        Some("video/mp4".to_string())
                    } else if is_image_file {
                        Some("image/jpeg".to_string())
                    } else if is_audio_file {
                        Some("audio/mpeg".to_string())
                    } else {
                        mime
                    }
                } else {
                    mime
                };

                let is_pdf = mime_l == "application/pdf" || mime_l.contains("pdf") || name_l.ends_with(".pdf");

                Some(MediaFileRow {
                    id,
                    folder_id,
                    name: n,
                    size,
                    mime_type: final_mime,
                    icon_type: icon.into(),
                    created_at: created,
                    has_thumb: has_thumb || is_video_file || is_image_file || is_audio_file || is_pdf || !doc.thumbs().is_empty(),
                    as_document: true,
                    backend: BACKEND.into(),
                    thumb_data_url,
                })
            }
            Media::Sticker(_) => Some(MediaFileRow {
                id,
                folder_id,
                name: format!("sticker_{id}.webp"),
                size,
                mime_type: Some("image/webp".into()),
                icon_type: "image".into(),
                created_at: created,
                has_thumb,
                as_document: true,
                backend: BACKEND.into(),
                thumb_data_url,
            }),
            Media::WebPage(wp) => {
                let webpage_has_thumb = match &wp.raw.webpage {
                    grammers_client::tl::enums::WebPage::Page(page) => {
                        page.photo.is_some() || page.document.is_some()
                    }
                    _ => false,
                };
                let is_link = caption.contains("http://") || caption.contains("https://") || caption.contains("t.me/");
                let clean_title = caption.lines().next().unwrap_or(caption).trim();
                let display_name = if !clean_title.is_empty() {
                    if clean_title.chars().count() > 50 {
                        format!("{}...", clean_title.chars().take(47).collect::<String>())
                    } else {
                        clean_title.to_string()
                    }
                } else {
                    format!("link_{id}")
                };
                let file_name = if display_name.ends_with(".url") { display_name } else { format!("{display_name}.url") };
                Some(MediaFileRow {
                    id,
                    folder_id,
                    name: file_name,
                    size: caption.len() as u64,
                    mime_type: Some(if is_link { "text/html".into() } else { "text/plain".into() }),
                    icon_type: if is_link { "link".into() } else { "document".into() },
                    created_at: created,
                    has_thumb: webpage_has_thumb,
                    as_document: false,
                    backend: BACKEND.into(),
                    thumb_data_url,
                })
            }
            _ => None,
        }
    } else if !caption.is_empty() {
        let is_link = caption.contains("http://") || caption.contains("https://") || caption.contains("t.me/");
        let clean_title = caption.lines().next().unwrap_or(caption).trim();
        let display_name = if clean_title.chars().count() > 50 {
            format!("{}...", clean_title.chars().take(47).collect::<String>())
        } else {
            clean_title.to_string()
        };
        let file_name = if is_link {
            if display_name.ends_with(".url") { display_name } else { format!("{display_name}.url") }
        } else {
            if display_name.ends_with(".txt") { display_name } else { format!("{display_name}.txt") }
        };
        Some(MediaFileRow {
            id,
            folder_id,
            name: file_name,
            size: caption.len() as u64,
            mime_type: Some(if is_link { "text/html".into() } else { "text/plain".into() }),
            icon_type: if is_link { "link".into() } else { "document".into() },
            created_at: created,
            has_thumb: false,
            as_document: false,
            backend: BACKEND.into(),
            thumb_data_url: None,
        })
    } else {
        None
    }
}

/// Forward messages source → dest (no delete). Returns count forwarded.
pub fn forward_messages_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    source_chat: &str,
    dest_chat: &str,
    message_ids: &[i64],
) -> Result<usize, TgError> {
    let rt = runtime()?;
    let src = source_chat.to_string();
    let dst = dest_chat.to_string();
    let ids: Vec<i32> = message_ids
        .iter()
        .filter(|&&id| id > 0)
        .map(|&id| id as i32)
        .take(100)
        .collect();
    if ids.is_empty() {
        return Ok(0);
    }
    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client.is_authorized().await.map_err(|e| map_invocation(&e))? {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let source = resolve_peer(client, &src).await?;
                let dest = resolve_peer(client, &dst).await?;
                let forwarded = client
                    .forward_messages(dest, &ids, source)
                    .await
                    .map_err(|e| map_invocation(&e))?;
                Ok(forwarded.iter().filter(|m| m.is_some()).count())
            })
        })
        .await
    })
}

fn message_topic_id(msg: &grammers_client::message::Message) -> Option<i64> {
    use grammers_client::tl::enums::MessageReplyHeader as H;
    match msg.reply_header()? {
        H::Header(h) => {
            if let Some(top) = h.reply_to_top_id {
                return Some(top as i64);
            }
            // Topic root posts often only set reply_to_msg_id == topic id
            if h.forum_topic {
                if let Some(mid) = h.reply_to_msg_id {
                    return Some(mid as i64);
                }
            }
            h.reply_to_msg_id.map(|m| m as i64)
        }
        _ => None,
    }
}

/// List media messages in a chat (newest first). Optional forum `topic_id` filter.
pub fn list_media_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    limit: usize,
    offset_id: Option<i64>,
) -> Result<ListMediaResult, TgError> {
    list_media_blocking_topic(sessions_dir, identity, chat_id, limit, offset_id, None)
}

pub fn list_media_blocking_topic(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    limit: usize,
    offset_id: Option<i64>,
    topic_id: Option<i64>,
) -> Result<ListMediaResult, TgError> {
    let rt = runtime()?;
    let limit = limit.clamp(1, 150);
    let chat = chat_id.to_string();
    let folder_id: Option<i64> = if chat.eq_ignore_ascii_case("me") || chat == "0" {
        None
    } else {
        chat.parse().ok()
    };
    let topic_filter = topic_id.filter(|t| *t > 0);
    // Over-fetch when filtering by topic so a page still fills even for older topics
    let scan_limit = if topic_filter.is_some() {
        (limit * 100).clamp(1000, 10000)
    } else {
        (limit * 5).clamp(150, 500)
    };
    let session_name = identity.session.clone();

    rt.block_on(async {
        with_pool_retry(&identity.session, || {
            let chat = chat.clone();
            let session_name = session_name.clone();
            with_client(sessions_dir, identity, true, |client| {
                Box::pin(async move {
                    ensure_authorized(client, &session_name).await?;
                    let mut peer_res = resolve_peer(client, &chat).await;
                    if let Err(ref e) = peer_res {
                        let err_str = e.to_string();
                        if err_str.contains("CHANNEL_INVALID")
                            || err_str.contains("CHANNEL_PRIVATE")
                            || err_str.contains("PEER_ID_INVALID")
                        {
                            clear_peer_cache_for_all(&chat);
                            peer_res = resolve_peer(client, &chat).await;
                        }
                    }
                    let peer = peer_res?;
                    let mut iter = client.iter_messages(peer).limit(scan_limit);
                    if let Some(oid) = offset_id {
                        if oid > 0 {
                            iter = iter.offset_id(oid as i32);
                        }
                    }
                    let mut files = Vec::new();
                    let mut last_id: Option<i64> = None;
                    let mut scanned = 0usize;

                    let mut first_item = iter.next().await;
                    if let Err(ref e) = first_item {
                        let err_str = e.to_string();
                        if err_str.contains("CHANNEL_INVALID")
                            || err_str.contains("CHANNEL_PRIVATE")
                            || err_str.contains("PEER_ID_INVALID")
                        {
                            clear_peer_cache_for_all(&chat);
                            let fresh_peer = resolve_peer(client, &chat).await?;
                            let mut fresh_iter = client.iter_messages(fresh_peer).limit(scan_limit);
                            if let Some(oid) = offset_id {
                                if oid > 0 {
                                    fresh_iter = fresh_iter.offset_id(oid as i32);
                                }
                            }
                            iter = fresh_iter;
                            first_item = iter.next().await;
                        }
                    }

                    while let Ok(Some(msg)) = first_item {
                        last_id = Some(msg.id() as i64);
                        scanned += 1;
                        if let Some(want) = topic_filter {
                            let tid = message_topic_id(&msg);
                            let mid = msg.id() as i64;
                            if tid != Some(want) && mid != want {
                                first_item = iter.next().await;
                                continue;
                            }
                        }
                        if let Some(row) = media_to_row(&msg, folder_id) {
                            files.push(row);
                            if files.len() >= limit {
                                break;
                            }
                        }
                        first_item = iter.next().await;
                    }
                    let has_more = files.len() >= limit || scanned >= scan_limit;
                    let next_offset_id = if has_more {
                        files.last().map(|f| f.id).or(last_id)
                    } else {
                        None
                    };
                    tg_log::info(
                        BACKEND,
                        "list_media",
                        format!(
                            "chat={} n={} has_more={} topic={:?}",
                            chat,
                            files.len(),
                            has_more,
                            topic_filter
                        ),
                    );
                    Ok(ListMediaResult {
                        status: "success".into(),
                        folder_id,
                        total: files.len(),
                        page_size: limit,
                        has_more,
                        next_offset_id,
                        files,
                        backend: BACKEND.into(),
                        cached: false,
                    })
                })
            })
        })
        .await
    })
}

/// Local multi-file album (2–10 items per Telegram limit). Photos preferred; documents when as_document.
/// `topic_id` = forum top message id for reply_to (optional).
/// `index_base` offsets result indices when chunking larger albums.
pub fn upload_album_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    files: &[(String, String)], // path, caption
    as_document: bool,
    silent: bool,
    topic_id: Option<i64>,
    index_base: usize,
) -> Result<Vec<UploadStepResult>, TgError> {
    if files.len() < 2 {
        return Err(TgError::new(
            TgErrorCode::Internal,
            "album requires at least 2 files",
        ));
    }
    if files.len() > 10 {
        return Err(TgError::new(
            TgErrorCode::Internal,
            "album max 10 files per chunk",
        ));
    }
    for (p, _) in files {
        path_policy::assert_safe_transfer_path(p)
            .map_err(|e| TgError::new(TgErrorCode::PathRejected, e))?;
        if !PathBuf::from(p).is_file() {
            return Err(TgError::new(
                TgErrorCode::Io,
                format!("file not found: {p}"),
            ));
        }
    }
    let rt = runtime()?;
    let chat = chat_id.to_string();
    let items: Vec<(PathBuf, String)> = files
        .iter()
        .map(|(p, c)| (PathBuf::from(p), c.clone()))
        .collect();
    let reply_to = topic_id.filter(|t| *t > 0).map(|t| t as i32);

    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client.is_authorized().await.map_err(|e| map_invocation(&e))? {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
                use grammers_client::media::InputMedia;
                let mut medias = Vec::with_capacity(items.len());
                for (i, (path_buf, cap)) in items.iter().enumerate() {
                    let uploaded = client
                        .upload_file(path_buf)
                        .await
                        .map_err(|e| TgError::new(TgErrorCode::Io, format!("upload_file: {e}")))?;
                    let ext = path_buf
                        .extension()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    let mut im = InputMedia::new().caption(if i == 0 {
                        cap.clone()
                    } else {
                        String::new()
                    });
                    // Forum topic: only first media carries reply_to
                    if i == 0 {
                        im = im.reply_to(reply_to);
                    }
                    im = if as_document {
                        im.document(uploaded)
                    } else if matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp") {
                        im.photo(uploaded)
                    } else {
                        im.document(uploaded)
                    };
                    let _ = silent;
                    medias.push(im);
                    tg_log::info(
                        BACKEND,
                        "album_upload_part",
                        format!(
                            "i={} file={}",
                            index_base + i,
                            path_buf.file_name().and_then(|s| s.to_str()).unwrap_or("?")
                        ),
                    );
                }
                let sent = client
                    .send_album(peer, medias)
                    .await
                    .map_err(|e| map_invocation(&e))?;
                let mut out = Vec::new();
                for (i, msg) in sent.into_iter().enumerate() {
                    let mid = msg.as_ref().map(|m| m.id() as i64);
                    out.push(UploadStepResult {
                        status: if mid.is_some() {
                            "done".into()
                        } else {
                            "failed".into()
                        },
                        message_id: mid,
                        error: if mid.is_none() {
                            Some("album item missing".into())
                        } else {
                            None
                        },
                        index: index_base + i,
                        backend: Some(BACKEND.into()),
                    });
                }
                tg_log::info(
                    BACKEND,
                    "album_ok",
                    format!("n={} chat={chat} base={index_base}", out.len()),
                );
                Ok(out)
            })
        })
        .await
    })
}

pub fn upload_file_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    path: &str,
    caption: &str,
    as_document: bool,
    silent: bool,
    index: usize,
) -> Result<UploadStepResult, TgError> {
    upload_file_blocking_topic(
        sessions_dir,
        identity,
        chat_id,
        path,
        caption,
        as_document,
        silent,
        index,
        None,
    )
}

pub fn upload_file_blocking_topic(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    path: &str,
    caption: &str,
    as_document: bool,
    silent: bool,
    index: usize,
    topic_id: Option<i64>,
) -> Result<UploadStepResult, TgError> {
    path_policy::assert_safe_transfer_path(path)
        .map_err(|e| TgError::new(TgErrorCode::PathRejected, e))?;
    let path_buf = PathBuf::from(path);
    if !path_buf.is_file() {
        return Err(TgError::new(
            TgErrorCode::Io,
            format!("file not found: {}", path_buf.file_name().and_then(|s| s.to_str()).unwrap_or("?")),
        ));
    }
    let size = std::fs::metadata(&path_buf).map(|m| m.len()).unwrap_or(0);
    let rt = runtime()?;
    let chat = chat_id.to_string();
    let cap = caption.to_string();
    let reply_to = topic_id.filter(|t| *t > 0).map(|t| t as i32);

    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client.is_authorized().await.map_err(|e| map_invocation(&e))? {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
                tg_log::info(
                    BACKEND,
                    "upload_start",
                    format!(
                        "chat={} size={} file={} as_document={} topic={:?}",
                        chat,
                        size,
                        path_buf
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("?"),
                        as_document,
                        reply_to
                    ),
                );
                let uploaded = client
                    .upload_file(&path_buf)
                    .await
                    .map_err(|e| TgError::new(TgErrorCode::Io, format!("upload_file: {e}")))?;

                let mut msg = InputMessage::new()
                    .text(cap)
                    .silent(silent)
                    .reply_to(reply_to);
                // Prefer document for fidelity (matches Studio force-document / ORIGINAL)
                msg = if as_document {
                    msg.document(uploaded)
                } else {
                    let ext = path_buf
                        .extension()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    if matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp") {
                        msg.photo(uploaded)
                    } else {
                        msg.document(uploaded)
                    }
                };

                let sent = match client.send_message(peer, msg).await {
                    Ok(m) => m,
                    Err(e) => {
                        let mapped = map_invocation(&e);
                        // Auto-retry once on short flood wait
                        if let Some(secs) = mapped.flood_wait_secs() {
                            if secs <= 45 {
                                tg_log::warn(
                                    BACKEND,
                                    "flood_wait_sleep",
                                    format!("secs={secs}"),
                                );
                                tokio::time::sleep(Duration::from_secs(secs as u64 + 1)).await;
                                // re-upload not needed — need new upload? Telegram may expire;
                                // for simplicity fail with flood after wait on second path
                                return Err(mapped);
                            }
                        }
                        return Err(mapped);
                    }
                };

                let mid = sent.id() as i64;
                tg_log::info(
                    BACKEND,
                    "upload_ok",
                    format!("message_id={mid} index={index}"),
                );
                Ok(UploadStepResult {
                    status: "done".into(),
                    message_id: Some(mid),
                    error: None,
                    index,
                    backend: Some(BACKEND.into()),
                })
            })
        })
        .await
    })
}

/// Full-file download (not progressive Range stream). Dual-path for open/cache of small-mid media.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadFileResult {
    pub status: String,
    pub path: String,
    pub message_id: i64,
    pub size: u64,
    pub name: Option<String>,
    pub mime_type: Option<String>,
    pub backend: String,
}

/// Download media of a single message into `dest_path` (parent dirs created).
/// Caps at ~200MB to avoid hanging UI on multi-GB files (those stay on Telethon progressive stream).
pub fn download_file_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    message_id: i64,
    dest_path: &str,
) -> Result<DownloadFileResult, TgError> {
    if message_id <= 0 {
        return Err(TgError::new(TgErrorCode::Internal, "message_id required"));
    }
    path_policy::assert_safe_transfer_path(dest_path)
        .map_err(|e| TgError::new(TgErrorCode::PathRejected, e))?;
    let dest = PathBuf::from(dest_path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            TgError::new(TgErrorCode::Io, format!("create dest dir: {e}"))
        })?;
    }
    let rt = runtime()?;
    let chat = chat_id.to_string();
    let mid = message_id as i32;

    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client.is_authorized().await.map_err(|e| map_invocation(&e))? {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
                let msgs = client
                    .get_messages_by_id(peer, &[mid])
                    .await
                    .map_err(|e| map_invocation(&e))?;
                let msg = msgs
                    .into_iter()
                    .flatten()
                    .next()
                    .ok_or_else(|| {
                        TgError::new(
                            TgErrorCode::PeerNotFound,
                            format!("message {message_id} not found in chat"),
                        )
                    })?;
                let media = msg.media().ok_or_else(|| {
                    TgError::new(
                        TgErrorCode::PeerNotFound,
                        "message has no downloadable media",
                    )
                })?;
                let size = media.size().unwrap_or(0) as u64;
                const MAX_FULL: u64 = 4 * 1024 * 1024 * 1024;
                if size > MAX_FULL {
                    return Err(TgError::new(
                        TgErrorCode::TelethonFallbackRequired,
                        format!(
                            "file too large for full Grammers download ({size} bytes); use progressive stream"
                        ),
                    ));
                }
                let name = match &media {
                    grammers_client::media::Media::Document(d) => {
                        d.name().map(|s| s.to_string())
                    }
                    grammers_client::media::Media::Photo(_) => {
                        Some(format!("photo_{message_id}.jpg"))
                    }
                    grammers_client::media::Media::Sticker(_) => {
                        Some(format!("sticker_{message_id}.webp"))
                    }
                    _ => None,
                };
                let mime = match &media {
                    grammers_client::media::Media::Document(d) => {
                        d.mime_type().map(|s| s.to_string())
                    }
                    grammers_client::media::Media::Photo(_) => Some("image/jpeg".into()),
                    grammers_client::media::Media::Sticker(_) => Some("image/webp".into()),
                    _ => None,
                };

                tg_log::info(
                    BACKEND,
                    "download_start",
                    format!("chat={chat} mid={message_id} size={size}"),
                );
                client
                    .download_media(&media, &dest)
                    .await
                    .map_err(|e| {
                        TgError::new(TgErrorCode::Io, format!("download_media: {e}"))
                    })?;
                let final_size = std::fs::metadata(&dest)
                    .map(|m| m.len())
                    .unwrap_or(size);
                tg_log::info(
                    BACKEND,
                    "download_ok",
                    format!("mid={message_id} bytes={final_size}"),
                );
                Ok(DownloadFileResult {
                    status: "done".into(),
                    path: dest.display().to_string(),
                    message_id,
                    size: final_size,
                    name,
                    mime_type: mime,
                    backend: BACKEND.into(),
                })
            })
        })
        .await
    })
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
pub fn login_blocking(
    sessions_dir: &Path,
    req: &LoginRequest,
) -> Result<LoginResult, TgError> {
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
    let has_password = req.password.as_deref().map(str::trim).is_some_and(|s| !s.is_empty());
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

        if client.is_authorized().await.map_err(|e| map_invocation(&e))? {
            let u = client.get_me().await.map_err(|e| map_invocation(&e))?;
            let _ = persist_memory_session(&session, &g_path);
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
        if let Some(password) = req.password.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            if req.code.as_deref().map(str::trim).filter(|s| !s.is_empty()).is_none() {
                let pw_token = take_password_token(&identity.session).ok_or_else(|| {
                    TgError::new(TgErrorCode::Auth, "2FA challenge expired — start login again")
                })?;
                match client.check_password(pw_token, password.as_bytes()).await {
                    Ok(u) => {
                        let prof = user_profile_from(&u);
                        persist_memory_session(&session, &g_path)?;
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
            match client
                .request_login_code(&phone, &identity.api_hash)
                .await
            {
                Ok(_token) => {
                    // Token cannot be persisted easily across process calls without storing it.
                    // Document: second call must happen soon; we store token in static map.
                    store_login_token(&identity.session, _token);
                    persist_memory_session(&session, &g_path)?;
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
                let _ = persist_memory_session(&session, &g_path);
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
                            let _ = persist_memory_session(&session, &g_path);
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
                    persist_memory_session(&session, &g_path)?;
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
                persist_memory_session(&session, &g_path)?;
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
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::OnceLock;

fn login_tokens() -> &'static Mutex<HashMap<String, grammers_client::client::LoginToken>> {
    static MAP: OnceLock<Mutex<HashMap<String, grammers_client::client::LoginToken>>> =
        OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn store_login_token(session: &str, token: grammers_client::client::LoginToken) {
    login_tokens().lock().insert(session.to_string(), token);
}

fn take_login_token(session: &str) -> Option<grammers_client::client::LoginToken> {
    login_tokens().lock().remove(session)
}

fn password_tokens() -> &'static Mutex<HashMap<String, PasswordToken>> {
    static MAP: OnceLock<Mutex<HashMap<String, PasswordToken>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn store_password_token(session: &str, token: PasswordToken) {
    password_tokens().lock().insert(session.to_string(), token);
}

fn take_password_token(session: &str) -> Option<PasswordToken> {
    password_tokens().lock().remove(session)
}

pub async fn grammers_qr_login(
    app: tauri::AppHandle,
    session_name: String,
    api_id: i64,
    api_hash: String,
) -> Result<(), TgError> {
    use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
    use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64_URL;
    use base64::Engine as _;
    use grammers_session::Session;
    use tauri::Emitter;

    let sessions_dir = resolve_sessions_dir(None);
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(previous) = qr_cancel_flags().lock().insert(session_name.clone(), cancel.clone()) {
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
        let _ = persist_memory_session(&live.session, &live.session_path);
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
                            let _ = persist_memory_session(&live.session, &live.session_path);

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
                                    persist_memory_session(&live.session, &live.session_path)?;
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
                                    .invoke(&grammers_client::tl::functions::account::GetPassword {})
                                    .await
                                    .map_err(|err| map_invocation(&err))?
                                    .into();
                                let token = PasswordToken::new(password);
                                let hint = token.hint().map(str::to_string);
                                store_password_token(&session_name, token);
                                login_success = true;
                                let _ = persist_memory_session(&live.session, &live.session_path);

                                let _ = app.emit(
                                    "qr-event",
                                    serde_json::json!({
                                        "status": "2fa_required",
                                        "password_hint": hint,
                                        "session": session_name
                                    }),
                                );
                                break;
                            } else if err_str.contains("AUTH_TOKEN_EXPIRED") || err_str.contains("AUTH_TOKEN_INVALID") {
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
                        persist_memory_session(&live.session, &live.session_path)?;
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
                let _ = persist_memory_session(&live.session, &live.session_path);

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
                    let _ = persist_memory_session(&live.session, &live.session_path);

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

fn qr_cancel_flags() -> &'static Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>> {
    static MAP: OnceLock<Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>> = OnceLock::new();
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
        for ext in &[".session", ".grammers.json", ".session-journal", ".session.lock"] {
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
        assert!(!path.exists(), "session must wait for a negotiated auth key");
        std::fs::remove_dir(&dir).expect("remove temp session dir");
    }

    #[test]
    fn flood_wait_is_not_transport_error() {
        let err = TgError::with_flood(31, "FLOOD_WAIT_31");
        assert!(!is_pool_or_transport_error(&err));
    }
}
