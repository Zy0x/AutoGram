//! Explicit, user-initiated Telegram chat actions.
//!
//! The UI never talks to Telegram directly. Every write travels through the
//! per-session FloodWait guard so join/send actions cannot race the indexer.

use std::path::Path;

use grammers_client::tl;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::core::session_rate::RpcClass;
use crate::core::telegram_ops::TelegramIdentity;
use crate::core::telegram_rpc_guard::invoke_guarded;
use crate::core::tg_error::{TgError, TgErrorCode};

use super::{resolve_peer, runtime, with_client, with_pool_retry};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatActionResult {
    pub status: String,
    pub action: String,
    pub target: String,
    pub message_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTargetInspection {
    pub target: String,
    pub kind: String,
    pub joined: bool,
    pub can_join: bool,
    pub peer_id: Option<i64>,
    pub display_name: Option<String>,
}

pub(crate) fn public_target(raw: &str) -> Option<String> {
    let clean = raw.trim();
    if clean.starts_with('@') {
        return Some(clean.to_string());
    }
    if let Ok(url) = Url::parse(clean) {
        if url.scheme() == "tg"
            && url
                .host_str()
                .is_some_and(|host| host.eq_ignore_ascii_case("resolve"))
        {
            return url
                .query_pairs()
                .find(|(key, _)| key.eq_ignore_ascii_case("domain"))
                .map(|(_, value)| format!("@{}", value.trim_start_matches('@')));
        }
    }
    let no_scheme = clean
        .strip_prefix("https://")
        .or_else(|| clean.strip_prefix("http://"))
        .unwrap_or(clean);
    let path = no_scheme
        .strip_prefix("t.me/")
        .or_else(|| no_scheme.strip_prefix("telegram.me/"))?;
    let segments: Vec<&str> = path
        .split(['/', '?', '#'])
        .filter(|s| !s.is_empty())
        .collect();
    if segments.is_empty() {
        return None;
    }
    let first = segments[0].trim();
    if first.starts_with('+') || first.eq_ignore_ascii_case("joinchat") {
        return None;
    }
    if first.eq_ignore_ascii_case("s") && segments.len() > 1 {
        let second = segments[1].trim();
        if !second.is_empty() && !second.starts_with('+') {
            return Some(format!("@{second}"));
        }
    }
    if matches!(
        first.to_ascii_lowercase().as_str(),
        "c" | "s" | "addlist" | "share" | "login" | "proxy" | "setlanguage"
    ) {
        None
    } else {
        Some(format!("@{first}"))
    }
}

pub(crate) fn private_channel_target(raw: &str) -> Option<String> {
    let url = Url::parse(raw.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.host_str().is_some_and(|host| {
            host.eq_ignore_ascii_case("t.me") || host.eq_ignore_ascii_case("telegram.me")
        })
    {
        return None;
    }
    let mut segments = url.path_segments()?.filter(|segment| !segment.is_empty());
    if !segments.next()?.eq_ignore_ascii_case("c") {
        return None;
    }
    let bare = segments.next()?.trim();
    if bare.is_empty() || !bare.chars().all(|value| value.is_ascii_digit()) {
        return None;
    }
    Some(format!("-100{bare}"))
}

fn is_bot_target(raw: &str) -> bool {
    if start_parameter(raw).is_some() {
        return true;
    }
    public_target(raw).is_some_and(|target| {
        target
            .trim_start_matches('@')
            .to_ascii_lowercase()
            .ends_with("bot")
    })
}

pub fn inspect_chat_target_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    target: &str,
) -> Result<ChatTargetInspection, TgError> {
    let target = target.trim().to_string();
    if target.is_empty() {
        return Err(TgError::new(
            TgErrorCode::PeerNotFound,
            "target is required",
        ));
    }
    let kind = if is_bot_target(&target) {
        "bot"
    } else {
        "chat"
    }
    .to_string();
    if invite_hash(&target).is_some() {
        return Ok(ChatTargetInspection {
            target,
            kind,
            joined: false,
            can_join: true,
            peer_id: None,
            display_name: None,
        });
    }
    let lookup = public_target(&target)
        .or_else(|| private_channel_target(&target))
        .ok_or_else(|| {
            TgError::new(
                TgErrorCode::PeerNotFound,
                "unsupported Telegram destination",
            )
        })?;
    let rt = runtime()?;
    rt.block_on(async {
        with_pool_retry(&identity.session, || {
            let target = target.clone();
            let lookup = lookup.clone();
            let kind = kind.clone();
            with_client(sessions_dir, identity, false, move |client| {
                let target = target.clone();
                let lookup = lookup.clone();
                let kind = kind.clone();
                Box::pin(async move {
                    let resolved = resolve_peer(client, &lookup).await?;
                    let peer_id = super::peer_id_i64(resolved.id);
                    let mut dialogs = client.iter_dialogs();
                    while let Some(dialog) = dialogs
                        .next()
                        .await
                        .map_err(|error| TgError::new(TgErrorCode::Rpc, error.to_string()))?
                    {
                        if dialog.peer().id() == resolved.id {
                            return Ok(ChatTargetInspection {
                                target,
                                kind,
                                joined: true,
                                can_join: false,
                                peer_id: Some(peer_id),
                                display_name: dialog.peer().name().map(str::to_string),
                            });
                        }
                    }
                    let can_join = kind != "bot";
                    let display_name = if lookup.starts_with('@') {
                        if let Ok(Some(p)) = client
                            .resolve_username(lookup.trim_start_matches('@'))
                            .await
                        {
                            p.name().map(str::to_string)
                        } else {
                            None
                        }
                    } else {
                        None
                    };
                    Ok(ChatTargetInspection {
                        target,
                        kind,
                        joined: false,
                        can_join,
                        peer_id: Some(peer_id),
                        display_name: display_name.or(Some(lookup)),
                    })
                })
            })
        })
        .await
    })
}

fn start_parameter(raw: &str) -> Option<String> {
    let url = Url::parse(raw.trim()).ok()?;
    url.query_pairs()
        .find(|(key, _)| key.eq_ignore_ascii_case("start") || key.eq_ignore_ascii_case("startapp"))
        .map(|(_, value)| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn invite_hash(raw: &str) -> Option<String> {
    let clean = raw.trim();
    if let Ok(url) = Url::parse(clean) {
        if url.scheme() == "tg"
            && url
                .host_str()
                .is_some_and(|host| host.eq_ignore_ascii_case("join"))
        {
            return url
                .query_pairs()
                .find(|(key, _)| key.eq_ignore_ascii_case("invite"))
                .map(|(_, value)| value.trim().to_string())
                .filter(|value| !value.is_empty());
        }
    }
    let no_scheme = clean
        .strip_prefix("https://")
        .or_else(|| clean.strip_prefix("http://"))
        .unwrap_or(clean);
    let path = no_scheme
        .strip_prefix("t.me/")
        .or_else(|| no_scheme.strip_prefix("telegram.me/"))?;
    let candidate = path
        .strip_prefix('+')
        .or_else(|| path.strip_prefix("joinchat/"))?
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim();
    if candidate.is_empty() {
        None
    } else {
        Some(candidate.to_string())
    }
}

pub fn chat_action_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    action: &str,
    target: &str,
    message: Option<&str>,
) -> Result<ChatActionResult, TgError> {
    let action = action.trim().to_ascii_lowercase();
    let target = target.trim().to_string();
    if target.is_empty() {
        return Err(TgError::new(
            TgErrorCode::PeerNotFound,
            "target is required",
        ));
    }
    if !matches!(
        action.as_str(),
        "join" | "leave" | "start_bot" | "stop_bot" | "send_message"
    ) {
        return Err(TgError::new(
            TgErrorCode::NotConfigured,
            format!("unsupported chat action '{action}'"),
        ));
    }

    let message = message
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let rt = runtime()?;
    rt.block_on(async {
        with_pool_retry(&identity.session, || {
            let action = action.clone();
            let target = target.clone();
            let message = message.clone();
            with_client(sessions_dir, identity, true, move |client| {
                let action = action.clone();
                let target = target.clone();
                let message = message.clone();
                let session = identity.session.clone();
                Box::pin(async move {
                    match action.as_str() {
                        "join" => {
                            if let Some(hash) = invite_hash(&target) {
                                invoke_guarded(
                                    &session,
                                    RpcClass::WriteOperation,
                                    "messages.importChatInvite",
                                    || {
                                        let request = tl::functions::messages::ImportChatInvite {
                                            hash: hash.clone(),
                                        };
                                        async move { client.invoke(&request).await }
                                    },
                                )
                                .await?;
                            } else {
                                let lookup =
                                    public_target(&target).unwrap_or_else(|| target.clone());
                                let peer = resolve_peer(client, &lookup).await?;
                                invoke_guarded(
                                    &session,
                                    RpcClass::WriteOperation,
                                    "channels.joinChannel",
                                    || client.join_chat(peer),
                                )
                                .await?;
                            }
                            Ok(ChatActionResult {
                                status: "joined".into(),
                                action,
                                target,
                                message_id: None,
                            })
                        }
                        "leave" => {
                            let peer = resolve_peer(client, &target).await?;
                            invoke_guarded(
                                &session,
                                RpcClass::WriteOperation,
                                "dialogs.leave",
                                || client.delete_dialog(peer),
                            )
                            .await?;
                            Ok(ChatActionResult {
                                status: "left".into(),
                                action,
                                target,
                                message_id: None,
                            })
                        }
                        "start_bot" | "stop_bot" | "send_message" => {
                            let lookup = public_target(&target).unwrap_or_else(|| target.clone());
                            let peer = resolve_peer(client, &lookup).await?;
                            let text = match action.as_str() {
                                "start_bot" => message
                                    .as_deref()
                                    .map(|param| {
                                        format!(
                                            "/start {}",
                                            param.trim_start_matches("/start").trim()
                                        )
                                    })
                                    .filter(|value| value.trim() != "/start")
                                    .or_else(|| {
                                        start_parameter(&target)
                                            .map(|param| format!("/start {param}"))
                                    })
                                    .unwrap_or_else(|| "/start".to_string()),
                                "stop_bot" => "/stop".to_string(),
                                _ => message.clone().ok_or_else(|| {
                                    TgError::new(TgErrorCode::NotConfigured, "message is required")
                                })?,
                            };
                            let sent = invoke_guarded(
                                &session,
                                RpcClass::WriteOperation,
                                "messages.sendMessage",
                                || client.send_message(peer, text.clone()),
                            )
                            .await?;
                            Ok(ChatActionResult {
                                status: "sent".into(),
                                action,
                                target,
                                message_id: Some(i64::from(sent.value.id())),
                            })
                        }
                        _ => Err(TgError::new(
                            TgErrorCode::Internal,
                            "unreachable chat action",
                        )),
                    }
                })
            })
        })
        .await
    })
}

#[cfg(test)]
mod tests {
    use super::{invite_hash, private_channel_target, public_target, start_parameter};

    #[test]
    fn parses_public_and_private_telegram_links() {
        assert_eq!(
            public_target("https://t.me/example_bot"),
            Some("@example_bot".into())
        );
        assert_eq!(
            invite_hash("https://t.me/+AbCd_123"),
            Some("AbCd_123".into())
        );
        assert_eq!(
            invite_hash("https://t.me/joinchat/AbCd_123"),
            Some("AbCd_123".into())
        );
        assert_eq!(
            invite_hash("tg://join?invite=AbCd_123"),
            Some("AbCd_123".into())
        );
        assert_eq!(
            public_target("tg://resolve?domain=example_bot&start=hello"),
            Some("@example_bot".into())
        );
        assert_eq!(
            start_parameter("https://t.me/example_bot?start=hello"),
            Some("hello".into())
        );
        assert_eq!(public_target("https://t.me/c/123456/42"), None);
        assert_eq!(
            private_channel_target("https://t.me/c/123456/42"),
            Some("-100123456".into())
        );
    }
}
