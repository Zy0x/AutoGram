use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use grammers_client::tl;

use crate::core::autogram_core::telegram::account::{
    AccountCapability, CapabilitySource, MAX_TELEGRAM_PART_SIZE,
};
use crate::core::telegram_ops::TelegramIdentity;
use crate::core::tg_error::{map_invocation, TgError, TgErrorCode};
use crate::core::tg_log;

use super::resolve_peer;
use super::{runtime, with_client};

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn object_number(config: &tl::enums::Jsonvalue, key: &str) -> Option<u32> {
    let tl::enums::Jsonvalue::JsonObject(object) = config else {
        return None;
    };
    object.value.iter().find_map(|entry| {
        let tl::enums::JsonobjectValue::JsonObjectValue(entry) = entry;
        if entry.key != key {
            return None;
        }
        match &entry.value {
            tl::enums::Jsonvalue::JsonNumber(number)
                if number.value.is_finite()
                    && number.value > 0.0
                    && number.value <= u32::MAX as f64 =>
            {
                Some(number.value as u32)
            }
            _ => None,
        }
    })
}

fn user_is_premium(user: &grammers_client::peer::User) -> bool {
    match &user.raw {
        tl::enums::User::User(user) => user.premium,
        tl::enums::User::Empty(_) => false,
    }
}

pub fn resolve_account_capability_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
) -> AccountCapability {
    if let Ok(Some(mut cached)) = crate::core::autogram_core::transfer::load_account_capability::<
        AccountCapability,
    >(&identity.session)
    {
        cached.source = CapabilitySource::Cached;
        return cached;
    }

    let live = runtime().and_then(|runtime| {
        runtime.block_on(async {
            with_client(sessions_dir, identity, true, |client| {
                let session = identity.session.clone();
                Box::pin(async move {
                    if !client
                        .is_authorized()
                        .await
                        .map_err(|error| map_invocation(&error))?
                    {
                        return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                    }
                    let me = client
                        .get_me()
                        .await
                        .map_err(|error| map_invocation(&error))?;
                    let is_premium = user_is_premium(&me);
                    let response = client
                        .invoke(&tl::functions::help::GetAppConfig { hash: 0 })
                        .await
                        .map_err(|error| map_invocation(&error))?;
                    let tl::enums::help::AppConfig::Config(app_config) = response else {
                        return Err(TgError::new(
                            TgErrorCode::Internal,
                            "app configuration was unexpectedly not modified",
                        ));
                    };
                    let default_parts =
                        object_number(&app_config.config, "upload_max_fileparts_default")
                            .unwrap_or(4_000);
                    let premium_parts =
                        object_number(&app_config.config, "upload_max_fileparts_premium")
                            .unwrap_or(8_000);
                    let default_caption_limit =
                        object_number(&app_config.config, "caption_length_limit_default")
                            .or_else(|| object_number(&app_config.config, "caption_length_limit"))
                            .unwrap_or(
                                crate::core::autogram_core::transfer::FALLBACK_CAPTION_LIMIT,
                            );
                    let premium_caption_limit =
                        object_number(&app_config.config, "caption_length_limit_premium")
                            .unwrap_or(default_caption_limit);
                    AccountCapability::from_runtime(
                        session,
                        CapabilitySource::Live,
                        now_ms(),
                        is_premium,
                        if is_premium {
                            premium_parts
                        } else {
                            default_parts
                        },
                        MAX_TELEGRAM_PART_SIZE,
                        if is_premium {
                            premium_caption_limit
                        } else {
                            default_caption_limit
                        },
                    )
                    .map_err(|error| TgError::new(TgErrorCode::Internal, error))
                })
            })
            .await
        })
    });

    match live {
        Ok(capability) => {
            let _ = crate::core::autogram_core::transfer::persist_account_capability(
                &identity.session,
                &capability,
                capability.expires_at_ms,
            );
            capability
        }
        Err(error) => {
            tg_log::warn(
                "account_capability",
                "runtime_capability_fallback",
                error.user_message(),
            );
            AccountCapability::free(&identity.session)
        }
    }
}

fn banned(rights: &Option<tl::enums::ChatBannedRights>) -> bool {
    rights.as_ref().is_some_and(|rights| {
        let tl::enums::ChatBannedRights::Rights(rights) = rights;
        rights.view_messages || rights.send_messages || rights.send_media
    })
}

fn admin_can_post(rights: &Option<tl::enums::ChatAdminRights>) -> bool {
    rights.as_ref().is_some_and(|rights| {
        let tl::enums::ChatAdminRights::Rights(rights) = rights;
        rights.post_messages || rights.other
    })
}

fn peer_can_send_media(peer: &grammers_client::peer::Peer) -> bool {
    match peer {
        grammers_client::peer::Peer::User(_) => true,
        grammers_client::peer::Peer::Channel(channel) => {
            channel.raw.creator || admin_can_post(&channel.raw.admin_rights)
        }
        grammers_client::peer::Peer::Group(group) => match &group.raw {
            tl::enums::Chat::Chat(chat) => {
                !chat.left
                    && !chat.deactivated
                    && (chat.creator
                        || chat.admin_rights.is_some()
                        || !banned(&chat.default_banned_rights))
            }
            tl::enums::Chat::Channel(channel) => {
                !channel.left
                    && (channel.creator
                        || admin_can_post(&channel.admin_rights)
                        || (!channel.broadcast
                            && !banned(&channel.banned_rights)
                            && !banned(&channel.default_banned_rights)))
            }
            tl::enums::Chat::Empty(_)
            | tl::enums::Chat::Forbidden(_)
            | tl::enums::Chat::ChannelForbidden(_) => false,
        },
    }
}

fn probe_destination_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
) -> Result<(), TgError> {
    let runtime = runtime()?;
    runtime.block_on(async {
        with_client(sessions_dir, identity, false, |client| {
            let chat_id = chat_id.to_string();
            Box::pin(async move {
                let resolved = resolve_peer(client, &chat_id).await?;
                let mut dialogs = client.iter_dialogs();
                while let Some(dialog) = dialogs
                    .next()
                    .await
                    .map_err(|error| map_invocation(&error))?
                {
                    if dialog.peer().id() == resolved.id {
                        return if peer_can_send_media(dialog.peer()) {
                            Ok(())
                        } else {
                            Err(TgError::new(
                                TgErrorCode::Rpc,
                                "alternate account cannot send media to destination",
                            ))
                        };
                    }
                }
                Err(TgError::new(
                    TgErrorCode::PeerNotFound,
                    "alternate account is not joined to the destination",
                ))
            })
        })
        .await
    })
}

pub fn resolve_approved_alternate_identity(
    sessions_dir: &Path,
    primary: &TelegramIdentity,
    chat_id: &str,
    required_size: u64,
    approved_sessions: &[String],
) -> Result<TelegramIdentity, String> {
    if matches!(
        chat_id.trim().to_ascii_lowercase().as_str(),
        "me" | "self" | "0"
    ) {
        return Err(
            "ALTERNATE_DESTINATION_NOT_EQUIVALENT: Saved Messages is account-specific".into(),
        );
    }
    let native_sessions = super::list_native_sessions(sessions_dir);
    let mut rejection_reasons = Vec::new();
    for session in approved_sessions {
        let session = session.trim();
        if session.is_empty() || session == primary.session {
            continue;
        }
        if !native_sessions
            .iter()
            .any(|candidate| candidate.name == session && candidate.source.contains("grammers"))
        {
            rejection_reasons.push(format!("{session}:session_unavailable"));
            continue;
        }
        if let Some(wait) = crate::core::session_rate::flood_remaining_secs(session) {
            rejection_reasons.push(format!("{session}:flood_wait_{wait}"));
            continue;
        }
        let identity = TelegramIdentity {
            session: session.to_string(),
            api_id: primary.api_id,
            api_hash: primary.api_hash.clone(),
        };
        let capability = resolve_account_capability_blocking(sessions_dir, &identity);
        if capability.source == CapabilitySource::Fallback {
            rejection_reasons.push(format!("{session}:capability_stale"));
            continue;
        }
        if required_size > capability.effective_max_bytes {
            rejection_reasons.push(format!("{session}:limit_insufficient"));
            continue;
        }
        match probe_destination_blocking(sessions_dir, &identity, chat_id) {
            Ok(()) => return Ok(identity),
            Err(error) => rejection_reasons.push(format!(
                "{session}:{}",
                format!("{:?}", error.code()).to_ascii_lowercase()
            )),
        }
    }
    Err(format!(
        "ALTERNATE_NO_ELIGIBLE_ACCOUNT: {}",
        if rejection_reasons.is_empty() {
            "approved pool is empty".into()
        } else {
            rejection_reasons.join(",")
        }
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_named_app_config_numbers() {
        let config = tl::enums::Jsonvalue::JsonObject(tl::types::JsonObject {
            value: vec![tl::types::JsonObjectValue {
                key: "upload_max_fileparts_default".into(),
                value: tl::types::JsonNumber { value: 4_321.0 }.into(),
            }
            .into()],
        });
        assert_eq!(
            object_number(&config, "upload_max_fileparts_default"),
            Some(4_321)
        );
        assert_eq!(object_number(&config, "missing"), None);
    }

    #[test]
    fn reads_runtime_caption_limit() {
        let config = tl::enums::Jsonvalue::JsonObject(tl::types::JsonObject {
            value: vec![tl::types::JsonObjectValue {
                key: "caption_length_limit_premium".into(),
                value: tl::types::JsonNumber { value: 4_096.0 }.into(),
            }
            .into()],
        });
        assert_eq!(
            object_number(&config, "caption_length_limit_premium"),
            Some(4_096)
        );
    }
}
