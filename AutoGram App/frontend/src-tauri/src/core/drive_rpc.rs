//! Drive mutations & extras on Grammers only (no Telethon / Python).
//!
//! Ports interactive Media Drive RPCs previously owned by `drive_serve.py`.

use std::path::Path;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use grammers_client::tl;
use grammers_client::Client;
use serde::{Deserialize, Serialize};

use super::grammers_ops::{peer_id_i64, resolve_peer, runtime, with_client, MediaFileRow};
use super::telegram_ops::TelegramIdentity;
use super::tg_error::{map_invocation, TgError, TgErrorCode};
use super::tg_log;

const BACKEND: &str = "grammers";
const FOLDER_TITLE_SUFFIX: &str = " [TD]";
const FOLDER_ABOUT_TAG: &str = "[telegram-drive-folder]";

fn compose_folder_about(parent_id: Option<i64>) -> String {
    match parent_id {
        Some(p) => format!("Telegram Drive folder {FOLDER_ABOUT_TAG} parent={p}"),
        None => format!("Telegram Drive folder {FOLDER_ABOUT_TAG}"),
    }
}

fn parse_parent_from_about(about: &str) -> Option<i64> {
    let re = regex_lite_parent(about)?;
    re.parse().ok()
}

/// Tiny parent= extractor without pulling the `regex` crate.
fn regex_lite_parent(about: &str) -> Option<&str> {
    let key = "parent=";
    let idx = about.find(key)?;
    let rest = &about[idx + key.len()..];
    let end = rest
        .find(|c: char| !(c == '-' || c.is_ascii_digit()))
        .unwrap_or(rest.len());
    let s = rest[..end].trim();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn strip_td_suffix(title: &str) -> String {
    let t = title.trim();
    if let Some(stripped) = t.strip_suffix(FOLDER_TITLE_SUFFIX.trim()) {
        stripped.trim().to_string()
    } else if let Some(stripped) = t.strip_suffix("[TD]") {
        stripped.trim().to_string()
    } else {
        t.to_string()
    }
}

fn channel_peer_id_from_bare(bare: i64) -> i64 {
    // Bot API style: -100{bare}
    format!("-100{bare}").parse().unwrap_or(bare)
}

fn chats_from_updates(u: tl::enums::Updates) -> Vec<tl::enums::Chat> {
    match u {
        tl::enums::Updates::Updates(x) => x.chats,
        tl::enums::Updates::Combined(x) => x.chats,
        _ => Vec::new(),
    }
}

fn first_channel_id(chats: &[tl::enums::Chat]) -> Option<(i64, String)> {
    for c in chats {
        match c {
            tl::enums::Chat::Channel(ch) => {
                let bare = ch.id;
                let title = ch.title.clone();
                return Some((channel_peer_id_from_bare(bare), title));
            }
            tl::enums::Chat::Chat(g) => {
                return Some((-(g.id as i64), g.title.clone()));
            }
            _ => {}
        }
    }
    None
}

async fn input_channel_from_peer(
    client: &Client,
    chat_id: &str,
) -> Result<tl::enums::InputChannel, TgError> {
    let peer = resolve_peer(client, chat_id).await?;
    let input_peer: tl::enums::InputPeer = peer.into();
    match input_peer {
        tl::enums::InputPeer::Channel(c) => {
            Ok(tl::enums::InputChannel::Channel(tl::types::InputChannel {
                channel_id: c.channel_id,
                access_hash: c.access_hash,
            }))
        }
        _ => Err(TgError::new(
            TgErrorCode::PeerNotFound,
            format!("chat {chat_id} is not a channel"),
        )),
    }
}

// ---------------------------------------------------------------------------
// Delete messages
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedItem {
    pub id: i64,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteMessagesResult {
    pub status: String,
    pub deleted: usize,
    pub deleted_ids: Vec<i64>,
    pub failed: Vec<FailedItem>,
    pub backend: String,
}

pub fn delete_messages_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    message_ids: &[i64],
) -> Result<DeleteMessagesResult, TgError> {
    let rt = runtime()?;
    let chat = chat_id.to_string();
    let ids: Vec<i32> = message_ids
        .iter()
        .filter(|&&id| id > 0)
        .map(|&id| id as i32)
        .collect();
    if ids.is_empty() {
        return Ok(DeleteMessagesResult {
            status: "success".into(),
            deleted: 0,
            deleted_ids: Vec::new(),
            failed: Vec::new(),
            backend: BACKEND.into(),
        });
    }
    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client
                    .is_authorized()
                    .await
                    .map_err(|e| map_invocation(&e))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
                let mut deleted_ids: Vec<i64> = Vec::new();
                let mut failed: Vec<FailedItem> = Vec::new();

                // Chunk in max 50 message IDs per Telegram RPC call
                const CHUNK_SIZE: usize = 50;
                for chunk in ids.chunks(CHUNK_SIZE) {
                    match client.delete_messages(peer, chunk).await {
                        Ok(n) => {
                            for &mid in chunk {
                                deleted_ids.push(mid as i64);
                            }
                            tg_log::info(
                                BACKEND,
                                "delete_messages_chunk_ok",
                                format!("chat={chat} n={n} chunk_len={}", chunk.len()),
                            );
                        }
                        Err(err) => {
                            let tg_err = map_invocation(&err);
                            let user_msg = tg_err.user_message();
                            let is_perm_err = tg_err.code() == TgErrorCode::NotAuthorized
                                || user_msg.contains("CHAT_ADMIN_REQUIRED")
                                || user_msg.contains("MESSAGE_DELETE_FORBIDDEN")
                                || user_msg.contains("CHAT_WRITE_FORBIDDEN")
                                || user_msg.contains("CHANNEL_PRIVATE")
                                || user_msg.contains("USER_NOT_PARTICIPANT");

                            if is_perm_err {
                                tg_log::warn(
                                    BACKEND,
                                    "delete_messages_chunk_perm_fail",
                                    format!("chat={chat} perm_error={user_msg} - fast fail chunk"),
                                );
                                for &mid in chunk {
                                    failed.push(FailedItem {
                                        id: mid as i64,
                                        error: user_msg.clone(),
                                    });
                                }
                            } else {
                                tg_log::warn(
                                    BACKEND,
                                    "delete_messages_chunk_fail",
                                    format!(
                                        "chat={chat} chunk_len={} err={err} - fallback to per-id",
                                        chunk.len()
                                    ),
                                );
                                for &mid in chunk {
                                    let mut attempts = 0;
                                    loop {
                                        attempts += 1;
                                        match client.delete_messages(peer, &[mid]).await {
                                            Ok(_) => {
                                                deleted_ids.push(mid as i64);
                                                break;
                                            }
                                            Err(single_err) => {
                                                let tg_err = map_invocation(&single_err);
                                                if let Some(secs) = tg_err.flood_wait_secs() {
                                                    if attempts <= 2 {
                                                        tg_log::warn(
                                                            BACKEND,
                                                            "delete_messages_flood_wait",
                                                            format!("mid={mid} waiting {secs}s"),
                                                        );
                                                        tokio::time::sleep(
                                                            std::time::Duration::from_secs(
                                                                (secs + 1) as u64,
                                                            ),
                                                        )
                                                        .await;
                                                        continue;
                                                    }
                                                }
                                                failed.push(FailedItem {
                                                    id: mid as i64,
                                                    error: tg_err.user_message(),
                                                });
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                tg_log::info(
                    BACKEND,
                    "delete_messages_batch_done",
                    format!(
                        "chat={chat} deleted={} failed={}",
                        deleted_ids.len(),
                        failed.len()
                    ),
                );

                Ok(DeleteMessagesResult {
                    status: "success".into(),
                    deleted: deleted_ids.len(),
                    deleted_ids,
                    failed,
                    backend: BACKEND.into(),
                })
            })
        })
        .await
    })
}

// ---------------------------------------------------------------------------
// Folder CRUD
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFolderRow {
    pub id: i64,
    pub name: String,
    pub title_raw: String,
    pub username: Option<String>,
    pub is_public: bool,
    pub parent_id: Option<i64>,
    pub is_drive_folder: bool,
    pub is_orphan: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderOpResult {
    pub status: String,
    pub folder: Option<DriveFolderRow>,
    pub warning: Option<String>,
    pub backend: String,
}

pub fn create_folder_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    name: &str,
    parent_id: Option<i64>,
) -> Result<FolderOpResult, TgError> {
    let rt = runtime()?;
    let clean = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.is_empty() {
        return Err(TgError::new(TgErrorCode::Internal, "Folder name required"));
    }
    let clean = strip_td_suffix(&clean);
    let title = format!("{clean}{FOLDER_TITLE_SUFFIX}");
    let about = compose_folder_about(parent_id);

    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client
                    .is_authorized()
                    .await
                    .map_err(|e| map_invocation(&e))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let attempts = [
                    (true, false), // broadcast
                    (false, true), // megagroup
                    (true, false),
                    (false, true),
                ];
                let mut last_err: Option<TgError> = None;
                for (i, (broadcast, megagroup)) in attempts.iter().enumerate() {
                    if i > 0 {
                        tokio::time::sleep(std::time::Duration::from_millis(350)).await;
                    }
                    let req = tl::functions::channels::CreateChannel {
                        broadcast: *broadcast,
                        megagroup: *megagroup,
                        for_import: false,
                        forum: false,
                        title: title.clone(),
                        about: about.clone(),
                        geo_point: None,
                        address: None,
                        ttl_period: None,
                    };
                    match client.invoke(&req).await {
                        Ok(updates) => {
                            let chats = chats_from_updates(updates);
                            if let Some((peer_id, title_raw)) = first_channel_id(&chats) {
                                // Stick parent about if needed
                                if parent_id.is_some() {
                                    if let Ok(tl::enums::InputChannel::Channel(c)) =
                                        input_channel_from_peer(client, &peer_id.to_string()).await
                                    {
                                        let _ = client
                                            .invoke(&tl::functions::messages::EditChatAbout {
                                                peer: tl::enums::InputPeer::Channel(
                                                    tl::types::InputPeerChannel {
                                                        channel_id: c.channel_id,
                                                        access_hash: c.access_hash,
                                                    },
                                                ),
                                                about: about.clone(),
                                            })
                                            .await;
                                    }
                                }
                                tg_log::info(
                                    BACKEND,
                                    "create_folder",
                                    format!("id={peer_id} title={title_raw}"),
                                );
                                return Ok(FolderOpResult {
                                    status: "success".into(),
                                    folder: Some(DriveFolderRow {
                                        id: peer_id,
                                        name: clean.clone(),
                                        title_raw,
                                        username: None,
                                        is_public: false,
                                        parent_id,
                                        is_drive_folder: true,
                                        is_orphan: false,
                                    }),
                                    warning: None,
                                    backend: BACKEND.into(),
                                });
                            }
                            last_err = Some(TgError::new(
                                TgErrorCode::Internal,
                                "CreateChannel returned no chat",
                            ));
                        }
                        Err(e) => {
                            let msg = e.to_string();
                            last_err = Some(map_invocation(&e));
                            let low = msg.to_ascii_lowercase();
                            if low.contains("channels_too_much")
                                || low.contains("user_restricted")
                                || low.contains("userchannelstoomuch")
                            {
                                break;
                            }
                        }
                    }
                }
                Err(last_err.unwrap_or_else(|| {
                    TgError::new(TgErrorCode::Internal, "Gagal membuat folder [TD]")
                }))
            })
        })
        .await
    })
}

pub fn rename_folder_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    folder_id: i64,
    name: &str,
) -> Result<FolderOpResult, TgError> {
    let rt = runtime()?;
    let clean = strip_td_suffix(&name.split_whitespace().collect::<Vec<_>>().join(" "));
    if clean.is_empty() {
        return Err(TgError::new(TgErrorCode::Internal, "Folder name required"));
    }
    let title = format!("{clean}{FOLDER_TITLE_SUFFIX}");
    let chat = folder_id.to_string();

    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client
                    .is_authorized()
                    .await
                    .map_err(|e| map_invocation(&e))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let input = input_channel_from_peer(client, &chat).await?;
                client
                    .invoke(&tl::functions::channels::EditTitle {
                        channel: input,
                        title: title.clone(),
                    })
                    .await
                    .map_err(|e| map_invocation(&e))?;
                Ok(FolderOpResult {
                    status: "success".into(),
                    folder: Some(DriveFolderRow {
                        id: folder_id,
                        name: clean,
                        title_raw: title,
                        username: None,
                        is_public: false,
                        parent_id: None,
                        is_drive_folder: true,
                        is_orphan: false,
                    }),
                    warning: None,
                    backend: BACKEND.into(),
                })
            })
        })
        .await
    })
}

pub fn set_folder_parent_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    folder_id: i64,
    parent_id: Option<i64>,
) -> Result<FolderOpResult, TgError> {
    let rt = runtime()?;
    let chat = folder_id.to_string();
    let about = compose_folder_about(parent_id);

    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client
                    .is_authorized()
                    .await
                    .map_err(|e| map_invocation(&e))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let tl::enums::InputChannel::Channel(c) =
                    input_channel_from_peer(client, &chat).await?
                else {
                    return Err(TgError::new(
                        TgErrorCode::PeerNotFound,
                        "not an input channel",
                    ));
                };
                client
                    .invoke(&tl::functions::messages::EditChatAbout {
                        peer: tl::enums::InputPeer::Channel(tl::types::InputPeerChannel {
                            channel_id: c.channel_id,
                            access_hash: c.access_hash,
                        }),
                        about: about.clone(),
                    })
                    .await
                    .map_err(|e| map_invocation(&e))?;
                Ok(FolderOpResult {
                    status: "success".into(),
                    folder: Some(DriveFolderRow {
                        id: folder_id,
                        name: String::new(),
                        title_raw: String::new(),
                        username: None,
                        is_public: false,
                        parent_id,
                        is_drive_folder: true,
                        is_orphan: false,
                    }),
                    warning: None,
                    backend: BACKEND.into(),
                })
            })
        })
        .await
    })
}

pub fn delete_folder_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    folder_id: i64,
) -> Result<FolderOpResult, TgError> {
    let rt = runtime()?;
    let chat = folder_id.to_string();

    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client
                    .is_authorized()
                    .await
                    .map_err(|e| map_invocation(&e))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                // Prefer DeleteChannel; fall back to leave + delete dialog
                if let Ok(input) = input_channel_from_peer(client, &chat).await {
                    match client
                        .invoke(&tl::functions::channels::DeleteChannel { channel: input })
                        .await
                    {
                        Ok(_) => {
                            return Ok(FolderOpResult {
                                status: "success".into(),
                                folder: None,
                                warning: None,
                                backend: BACKEND.into(),
                            });
                        }
                        Err(e) => {
                            tg_log::warn(BACKEND, "delete_channel", e.to_string());
                        }
                    }
                }
                let peer = resolve_peer(client, &chat).await?;
                client
                    .delete_dialog(peer)
                    .await
                    .map_err(|e| map_invocation(&e))?;
                Ok(FolderOpResult {
                    status: "success".into(),
                    folder: None,
                    warning: None,
                    backend: BACKEND.into(),
                })
            })
        })
        .await
    })
}

// ---------------------------------------------------------------------------
// Scan folders with parent= about
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFoldersResult {
    pub status: String,
    pub folders: Vec<DriveFolderRow>,
    pub backend: String,
}

pub fn scan_folders_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
) -> Result<ScanFoldersResult, TgError> {
    let rt = runtime()?;
    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client
                    .is_authorized()
                    .await
                    .map_err(|e| map_invocation(&e))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                // Fast path: title-only scan (no GetFullChannel per folder).
                // Parent about enrich was the 3–10s sidebar stall on boot.
                let mut folders = Vec::new();
                let mut dialogs = client.iter_dialogs();
                while let Some(dialog) = dialogs.next().await.map_err(|e| map_invocation(&e))? {
                    let peer = dialog.peer();
                    let title = peer.name().unwrap_or("").to_string();
                    if !title.to_ascii_uppercase().contains("[TD]") {
                        continue;
                    }
                    let id = peer_id_i64(peer.id());
                    folders.push(DriveFolderRow {
                        id,
                        name: strip_td_suffix(&title),
                        title_raw: title,
                        username: None,
                        is_public: false,
                        parent_id: None,
                        is_drive_folder: true,
                        is_orphan: false,
                    });
                }
                tg_log::info(BACKEND, "scan_folders", format!("n={}", folders.len()));
                Ok(ScanFoldersResult {
                    status: "success".into(),
                    folders,
                    backend: BACKEND.into(),
                })
            })
        })
        .await
    })
}

// ---------------------------------------------------------------------------
// Topics CRUD
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicOpResult {
    pub status: String,
    pub topic_id: Option<i64>,
    pub title: Option<String>,
    pub backend: String,
}

pub fn create_topic_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: i64,
    title: &str,
) -> Result<TopicOpResult, TgError> {
    let rt = runtime()?;
    let chat = chat_id.to_string();
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err(TgError::new(TgErrorCode::Internal, "Topic title required"));
    }
    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client
                    .is_authorized()
                    .await
                    .map_err(|e| map_invocation(&e))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
                let input: tl::enums::InputPeer = peer.into();
                let updates = client
                    .invoke(&tl::functions::messages::CreateForumTopic {
                        title_missing: false,
                        peer: input,
                        title: title.clone(),
                        icon_color: None,
                        icon_emoji_id: None,
                        random_id: rand::random::<i64>(),
                        send_as: None,
                    })
                    .await
                    .map_err(|e| map_invocation(&e))?;
                // Topic id often arrives as service message id — best effort from updates
                let topic_id = extract_topic_id_from_updates(&updates);
                Ok(TopicOpResult {
                    status: "success".into(),
                    topic_id,
                    title: Some(title),
                    backend: BACKEND.into(),
                })
            })
        })
        .await
    })
}

fn extract_topic_id_from_updates(u: &tl::enums::Updates) -> Option<i64> {
    let updates = match u {
        tl::enums::Updates::Updates(x) => &x.updates,
        tl::enums::Updates::Combined(x) => &x.updates,
        _ => return None,
    };
    for up in updates {
        if let tl::enums::Update::NewChannelMessage(m) = up {
            if let tl::enums::Message::Service(svc) = &m.message {
                return Some(svc.id as i64);
            }
            if let tl::enums::Message::Message(msg) = &m.message {
                return Some(msg.id as i64);
            }
        }
        if let tl::enums::Update::NewMessage(m) = up {
            if let tl::enums::Message::Service(svc) = &m.message {
                return Some(svc.id as i64);
            }
        }
    }
    None
}

pub fn rename_topic_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: i64,
    topic_id: i64,
    title: &str,
) -> Result<TopicOpResult, TgError> {
    let rt = runtime()?;
    let chat = chat_id.to_string();
    let title = title.trim().to_string();
    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client
                    .is_authorized()
                    .await
                    .map_err(|e| map_invocation(&e))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
                let input: tl::enums::InputPeer = peer.into();
                client
                    .invoke(&tl::functions::messages::EditForumTopic {
                        peer: input,
                        topic_id: topic_id as i32,
                        title: Some(title.clone()),
                        icon_emoji_id: None,
                        closed: None,
                        hidden: None,
                    })
                    .await
                    .map_err(|e| map_invocation(&e))?;
                Ok(TopicOpResult {
                    status: "success".into(),
                    topic_id: Some(topic_id),
                    title: Some(title),
                    backend: BACKEND.into(),
                })
            })
        })
        .await
    })
}

pub fn delete_topic_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: i64,
    topic_id: i64,
) -> Result<TopicOpResult, TgError> {
    let rt = runtime()?;
    let chat = chat_id.to_string();
    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client
                    .is_authorized()
                    .await
                    .map_err(|e| map_invocation(&e))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let peer = resolve_peer(client, &chat).await?;
                let input: tl::enums::InputPeer = peer.into();
                // Delete topic history (removes the forum topic thread)
                client
                    .invoke(&tl::functions::messages::DeleteTopicHistory {
                        peer: input,
                        top_msg_id: topic_id as i32,
                    })
                    .await
                    .map_err(|e| map_invocation(&e))?;
                Ok(TopicOpResult {
                    status: "success".into(),
                    topic_id: Some(topic_id),
                    title: None,
                    backend: BACKEND.into(),
                })
            })
        })
        .await
    })
}

// ---------------------------------------------------------------------------
// Avatars batch
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarsBatchResult {
    pub status: String,
    pub avatars: std::collections::HashMap<String, Option<String>>,
    pub backend: String,
}

pub fn avatars_batch_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    peer_ids: &[i64],
) -> Result<AvatarsBatchResult, TgError> {
    let rt = runtime()?;
    let ids: Vec<i64> = peer_ids.iter().copied().take(32).collect();
    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client
                    .is_authorized()
                    .await
                    .map_err(|e| map_invocation(&e))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let mut want: std::collections::HashSet<i64> = ids.iter().copied().collect();
                let mut avatars: std::collections::HashMap<String, Option<String>> =
                    std::collections::HashMap::new();
                for pid in &ids {
                    avatars.insert(pid.to_string(), None);
                }

                // Self avatar (peer_id 0 convention)
                if want.contains(&0) {
                    if let Ok(me) = client.get_me().await {
                        let url =
                            download_peer_photo(client, &grammers_client::peer::Peer::User(me))
                                .await;
                        avatars.insert("0".into(), url);
                        want.remove(&0);
                    }
                }

                if !want.is_empty() {
                    let mut dialogs = client.iter_dialogs();
                    while let Ok(Some(dialog)) = dialogs.next().await {
                        let p = dialog.peer();
                        let pid = peer_id_i64(p.id());
                        if !want.contains(&pid) {
                            continue;
                        }
                        let url = download_peer_photo(client, &p).await;
                        avatars.insert(pid.to_string(), url);
                        want.remove(&pid);
                        if want.is_empty() {
                            break;
                        }
                    }
                }

                Ok(AvatarsBatchResult {
                    status: "success".into(),
                    avatars,
                    backend: BACKEND.into(),
                })
            })
        })
        .await
    })
}

async fn download_peer_photo(
    client: &Client,
    peer: &grammers_client::peer::Peer,
) -> Option<String> {
    let photo = peer.photo(false).await.ok().flatten()?;
    let tmp = std::env::temp_dir().join(format!(
        "ag_avatar_{}_{}.jpg",
        peer_id_i64(peer.id()),
        std::process::id()
    ));
    let _ = std::fs::remove_file(&tmp);
    if client.download_media(&photo, &tmp).await.is_err() {
        let _ = std::fs::remove_file(&tmp);
        return None;
    }
    let bytes = std::fs::read(&tmp).ok();
    let _ = std::fs::remove_file(&tmp);
    let bytes = bytes?;
    if bytes.is_empty() {
        return None;
    }
    Some(format!("data:image/jpeg;base64,{}", B64.encode(&bytes)))
}

// ---------------------------------------------------------------------------
// Move / rename media (best-effort)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveMessagesResult {
    pub status: String,
    pub moved: usize,
    pub backend: String,
}

/// Forward messages to destination, then delete from source when requested.
pub fn move_messages_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    source_chat: &str,
    dest_chat: &str,
    message_ids: &[i64],
    delete_source: bool,
) -> Result<MoveMessagesResult, TgError> {
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
        return Ok(MoveMessagesResult {
            status: "success".into(),
            moved: 0,
            backend: BACKEND.into(),
        });
    }
    rt.block_on(async {
        with_client(sessions_dir, identity, true, |client| {
            Box::pin(async move {
                if !client
                    .is_authorized()
                    .await
                    .map_err(|e| map_invocation(&e))?
                {
                    return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                }
                let source = resolve_peer(client, &src).await?;
                let dest = resolve_peer(client, &dst).await?;
                let forwarded = client
                    .forward_messages(dest, &ids, source)
                    .await
                    .map_err(|e| map_invocation(&e))?;
                let moved = forwarded.iter().filter(|m| m.is_some()).count();
                if delete_source && moved > 0 {
                    let _ = client.delete_messages(source, &ids).await;
                }
                Ok(MoveMessagesResult {
                    status: "success".into(),
                    moved,
                    backend: BACKEND.into(),
                })
            })
        })
        .await
    })
}

// Keep MediaFileRow import used for future list extensions
#[allow(dead_code)]
fn _media_row_marker(_: &MediaFileRow) {}
