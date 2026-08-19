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

use super::media_list::*;
use super::media_transfer::*;
use super::peer_resolver::*;
use super::session_auth::*;

pub const BACKEND: &str = "grammers";

/// Convert grammers PeerId → stable i64 for UI (Bot API dialog id preferred).
pub fn peer_id_i64(id: grammers_session::types::PeerId) -> i64 {
    id.bot_api_dialog_id().or_else(|| id.bare_id()).unwrap_or(0)
}

pub fn session_operation_lock(session_name: &str) -> Arc<tokio::sync::RwLock<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<tokio::sync::RwLock<()>>>>> = OnceLock::new();
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
pub fn session_connect_lock(session_name: &str) -> Arc<tokio::sync::Mutex<()>> {
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
pub fn is_pool_or_transport_error(err: &TgError) -> bool {
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
pub fn is_fatal_auth_error(err: &TgError) -> bool {
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

pub struct CachedLiveClient {
    api_id: i64,
    live: Arc<LiveClient>,
    pub user_profile: Option<UserProfile>,
    last_used: Instant,
}

pub fn get_cached_user_profile(session_name: &str) -> Option<UserProfile> {
    let clients = live_clients().lock();
    clients
        .get(session_name)
        .and_then(|c| c.user_profile.clone())
}

/// True if this session already proved authorized (skip extra is_authorized RPCs).
pub(crate) fn session_known_authorized(session_name: &str) -> bool {
    get_cached_user_profile(session_name).is_some()
}

pub async fn ensure_authorized(client: &Client, session_name: &str) -> Result<(), TgError> {
    if session_known_authorized(session_name) {
        return Ok(());
    }
    if client
        .is_authorized()
        .await
        .map_err(|e| map_invocation(&e))?
    {
        // Soft-mark: profile may still be empty; insert placeholder so next calls skip
        // full is_authorized until get_me fills real profile.
        if get_cached_user_profile(session_name).is_none() {
            set_cached_user_profile(
                session_name,
                UserProfile {
                    id: 0,
                    first_name: None,
                    username: None,
                    photo_base64: None,
                    is_premium: false,
                },
            );
        }
        return Ok(());
    }
    Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"))
}

pub fn set_cached_user_profile(session_name: &str, profile: UserProfile) {
    let mut clients = live_clients().lock();
    if let Some(c) = clients.get_mut(session_name) {
        c.user_profile = Some(profile);
        c.last_used = Instant::now();
    }
}

pub fn live_clients() -> &'static Mutex<HashMap<String, CachedLiveClient>> {
    static CLIENTS: OnceLock<Mutex<HashMap<String, CachedLiveClient>>> = OnceLock::new();
    CLIENTS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn disconnect_cached_session(session_name: &str) {
    if let Some(entry) = live_clients().lock().remove(session_name) {
        entry.live.client.disconnect();
    }
}

pub fn purge_inactive_sessions(active_session: &str) {
    const MAX_WARM_SESSIONS: usize = 3;
    let active = active_session.trim();
    let mut map = live_clients().lock();
    if map.len() < MAX_WARM_SESSIONS {
        return;
    }

    // Keep the selected account and the most recently used pools warm. A
    // session with a live Studio/Job/preview/transfer lease must never be
    // disconnected by an unrelated account switch.
    let mut candidates = map
        .iter()
        .filter(|(session, _)| {
            session.as_str() != active
                && !session.is_empty()
                && session_guard::snapshot(session).activities.is_empty()
        })
        .map(|(session, entry)| (session.clone(), entry.last_used))
        .collect::<Vec<_>>();
    candidates.sort_by_key(|(_, last_used)| *last_used);
    let remove_count = map
        .len()
        .saturating_add(1)
        .saturating_sub(MAX_WARM_SESSIONS);
    let to_remove = candidates
        .into_iter()
        .take(remove_count)
        .map(|(session, _)| session)
        .collect::<Vec<_>>();
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
        return Err(TgError::new(TgErrorCode::NotConfigured, "api_id invalid"));
    }
    if identity.api_hash.trim().is_empty() {
        return Err(TgError::new(TgErrorCode::NotConfigured, "api_hash missing"));
    }

    let g_path =
        ensure_grammers_session(sessions_dir, &identity.session, import_if_missing).await?;
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

    let SenderPool { runner, handle, updates } =
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
        updates_rx: Arc::new(tokio::sync::Mutex::new(Some(updates))),
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
            crate::core::session_rate::note_error(&identity.session, e);
        }
    }
    result
}

/// Re-run an async MTProto op when the SenderPool dies mid-request.
///
/// Each `op` invocation must call `with_client` fresh so a rebuilt pool is used.
/// Captures that are not `Copy` must be `.clone()`d inside the `FnMut` body.
pub(crate) async fn with_pool_retry<T, Fut, F>(session_name: &str, mut op: F) -> Result<T, TgError>
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
                            "{} attempt={}/{} flood_wait={flood}s before fast retry",
                            tg_log::session_label(session_name),
                            attempt,
                            MAX_ATTEMPTS,
                        ),
                    );
                    tokio::time::sleep(Duration::from_millis((flood as u64) * 1000 + 50)).await;
                } else {
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
                    tokio::time::sleep(Duration::from_millis(80 * u64::from(attempt))).await;
                }
                last_err = Some(e);
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
            let mut clients = live_clients().lock();
            clients
                .get_mut(&identity.session)
                .filter(|entry| entry.api_id == identity.api_id)
                .map(|entry| {
                    entry.last_used = Instant::now();
                    Arc::clone(&entry.live)
                })
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
            let mut clients = live_clients().lock();
            clients
                .get_mut(&identity.session)
                .filter(|entry| entry.api_id == identity.api_id)
                .map(|entry| {
                    entry.last_used = Instant::now();
                    Arc::clone(&entry.live)
                })
        };
        if let Some(live) = cached {
            return Ok(live);
        }
    } else {
        // Still force-fresh after lock: another reconnect may have inserted a
        // brand-new pool — prefer that over dual-open.
        let cached = {
            let mut clients = live_clients().lock();
            clients
                .get_mut(&identity.session)
                .filter(|entry| entry.api_id == identity.api_id)
                .map(|entry| {
                    entry.last_used = Instant::now();
                    Arc::clone(&entry.live)
                })
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
            last_used: Instant::now(),
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
