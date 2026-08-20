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
use super::session_auth::*;

pub fn user_profile_from(u: &grammers_client::peer::User) -> UserProfile {
    let first = u.first_name().unwrap_or("").trim();
    let last = u.last_name().unwrap_or("").trim();
    let full_name = match (!first.is_empty(), !last.is_empty()) {
        (true, true) => format!("{} {}", first, last),
        (true, false) => first.to_string(),
        (false, true) => last.to_string(),
        (false, false) => String::new(),
    };

    let is_premium = match &u.raw {
        grammers_client::tl::enums::User::User(raw_user) => raw_user.premium,
        _ => false,
    };

    UserProfile {
        id: peer_id_i64(u.id()),
        first_name: if full_name.is_empty() {
            None
        } else {
            Some(full_name)
        },
        username: u.username().map(|s| s.to_string()),
        photo_base64: None,
        is_premium,
    }
}

async fn peer_to_ref(
    peer: &grammers_client::peer::Peer,
) -> Result<grammers_session::types::PeerRef, TgError> {
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

async fn user_to_ref(
    user: &grammers_client::peer::User,
) -> Result<grammers_session::types::PeerRef, TgError> {
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
                        let (is_user, is_bot, is_channel, is_group, is_forum) = match &peer {
                            grammers_client::peer::Peer::User(user) => {
                                (true, user.is_bot(), false, false, false)
                            }
                            grammers_client::peer::Peer::Channel(ch) => {
                                let is_megagroup = ch.raw.megagroup;
                                let is_forum = ch.raw.forum;
                                (false, false, !is_megagroup, is_megagroup, is_forum)
                            }
                            grammers_client::peer::Peer::Group(g) => {
                                use grammers_client::tl::enums::Chat as C;
                                let forum = match &g.raw {
                                    C::Channel(c) => c.forum,
                                    _ => false,
                                };
                                // Megagroup → treat as group (is_channel false for UI folders)
                                (false, false, false, true, forum)
                            }
                        };
                        out.push(DialogEntry {
                            id,
                            title,
                            is_user,
                            is_bot,
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

static PEER_RESOLVE_CACHE: std::sync::OnceLock<
    std::sync::RwLock<std::collections::HashMap<String, grammers_session::types::PeerRef>>,
> = std::sync::OnceLock::new();

pub fn peer_cache(
) -> &'static std::sync::RwLock<std::collections::HashMap<String, grammers_session::types::PeerRef>>
{
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

    let owner_id = client
        .get_me()
        .await
        .map(|u| peer_id_i64(u.id()))
        .unwrap_or(0);
    let ckey = |k: &str| format!("{owner_id}:{k}");

    let is_saved_or_self = s.eq_ignore_ascii_case("me")
        || s.eq_ignore_ascii_case("self")
        || s.eq_ignore_ascii_case("saved")
        || s.eq_ignore_ascii_case("saved messages")
        || s.eq_ignore_ascii_case("saved_messages")
        || s.eq_ignore_ascii_case("pesan tersimpan")
        || s.eq_ignore_ascii_case("null")
        || s.eq_ignore_ascii_case("undefined")
        || s == "0"
        || s.is_empty();

    if is_saved_or_self {
        let me = client.get_me().await.map_err(|e| map_invocation(&e))?;
        let res = user_to_ref(&me).await;
        if let Ok(ref pref) = res {
            if owner_id != 0 {
                if let Ok(mut guard) = peer_cache().write() {
                    guard.insert(ckey(s), *pref);
                    guard.insert(ckey("me"), *pref);
                    guard.insert(ckey("saved"), *pref);
                    guard.insert(ckey("Saved Messages"), *pref);
                    guard.insert(ckey("saved_messages"), *pref);
                }
            }
        }
        return res;
    }
    if s.starts_with('@')
        || (s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            && s.chars().any(|c| c.is_ascii_alphabetic()))
    {
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

    let want_opt: Option<i64> = s.parse().ok();
    let clean_title = s.trim_start_matches('#').trim().to_lowercase();

    // Fast path: check in-memory cache scoped by active user identity
    if owner_id != 0 {
        if let Ok(guard) = peer_cache().read() {
            if let Some(peer_ref) = guard.get(&ckey(s)) {
                return Ok(*peer_ref);
            }
            if let Some(peer_ref) = guard.get(&ckey(&clean_title)) {
                return Ok(*peer_ref);
            }
            if let Some(want) = want_opt {
                let s_clean = s.trim_start_matches('-');
                let s_bare = if s_clean.starts_with("100") && s_clean.len() > 3 {
                    &s_clean[3..]
                } else {
                    s_clean
                };
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
    }

    let mut dialogs = client.iter_dialogs();
    while let Some(dialog) = dialogs.next().await.map_err(|e| map_invocation(&e))? {
        let peer = dialog.peer();
        let pid = peer_id_i64(peer.id());
        let bid = peer.id().bare_id();

        let id_match = match want_opt {
            Some(want) => {
                let s_clean = s.trim_start_matches('-');
                let s_bare = if s_clean.starts_with("100") && s_clean.len() > 3 {
                    &s_clean[3..]
                } else {
                    s_clean
                };
                let want_bare: i64 = s_bare.parse().unwrap_or(want.abs());
                pid == want
                    || pid == -want
                    || (bid.is_some() && (bid.unwrap() == want_bare || bid.unwrap() == want.abs()))
            }
            None => false,
        };

        let title_match = if !clean_title.is_empty() {
            let peer_name = match &peer {
                grammers_client::peer::Peer::User(u) => {
                    let first = u.first_name().unwrap_or("");
                    let last = u.last_name().unwrap_or("");
                    format!("{first} {last}").trim().to_lowercase()
                }
                grammers_client::peer::Peer::Channel(c) => c.title().to_lowercase(),
                grammers_client::peer::Peer::Group(g) => g.title().unwrap_or("").to_lowercase(),
            };
            peer_name == clean_title || peer_name == s.to_lowercase()
        } else {
            false
        };

        if id_match || title_match {
            let res = peer_to_ref(&peer).await;
            if let Ok(ref pref) = res {
                let peer_type_str = match &peer {
                    grammers_client::peer::Peer::User(_) => "user",
                    grammers_client::peer::Peer::Channel(_) => "channel",
                    grammers_client::peer::Peer::Group(_) => "group",
                };
                let p_id = peer_id_i64(peer.id());
                tg_log::info(
                    "grammers",
                    "thumb_peer_resolved",
                    format!(
                        "op=thumb_peer_resolved input_chat={s} peer_type={peer_type_str} peer_id={p_id} access_hash_available=true"
                    ),
                );
                if owner_id != 0 {
                    if let Ok(mut guard) = peer_cache().write() {
                        guard.insert(ckey(s), *pref);
                        guard.insert(ckey(&clean_title), *pref);
                        if let Some(want) = want_opt {
                            let s_clean = s.trim_start_matches('-');
                            let s_bare = if s_clean.starts_with("100") && s_clean.len() > 3 {
                                &s_clean[3..]
                            } else {
                                s_clean
                            };
                            guard.insert(ckey(s_bare), *pref);
                            guard.insert(ckey(&format!("-100{s_bare}")), *pref);
                            guard.insert(ckey(&format!("-{s_bare}")), *pref);
                        }
                    }
                }
            }
            return res;
        }
    }
    tg_log::warn(
        "grammers",
        "thumb_peer_resolved",
        format!(
            "op=thumb_peer_resolved input_chat={s} peer_type=unknown peer_id=0 access_hash_available=false"
        ),
    );
    Err(TgError::new(
        TgErrorCode::PeerNotFound,
        format!("peer '{s}' not in dialogs — open the chat in Telegram once, then retry"),
    ))
}
