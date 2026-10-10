//! album_concurrent_trial.rs — Isolated Trial Module for Concurrent Album Uploads
//!
//! Verifies concurrent chunk uploads of 10 media items into a single visual album.
//! Completely isolated from production transfer pipeline (zero impact on media_transfer.rs).

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use grammers_client::media::Media;
use grammers_client::{tl, Client};
use serde::{Deserialize, Serialize};

use super::client_pool::with_client;
use super::peer_resolver::resolve_peer;
use super::session_auth::resolve_sessions_dir;
use super::uploader::upload_file_resilient;
use crate::core::telegram_ops::TelegramIdentity;
use crate::core::tg_error::{map_invocation, TgError, TgErrorCode};
use crate::core::tg_log;

const BACKEND: &str = "album_concurrent_trial";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrialResult {
    pub success: bool,
    pub total_files: usize,
    pub upload_elapsed_ms: u128,
    pub registration_elapsed_ms: u128,
    pub rpc_elapsed_ms: u128,
    pub total_elapsed_ms: u128,
    pub message_ids: Vec<i64>,
    pub destination: String,
    pub topic_id: Option<i64>,
    pub error: Option<String>,
}

/// Helper to load API credentials safely from local encrypted store for testing.
pub fn load_local_credentials() -> Result<(i64, String), String> {
    let appdata = std::env::var("APPDATA").map_err(|e| e.to_string())?;
    let base = PathBuf::from(appdata).join("com.aliri.frontend");
    let key_str = std::fs::read_to_string(base.join(".master.key")).map_err(|e| e.to_string())?;
    let key_bytes = B64.decode(key_str.trim()).map_err(|e| e.to_string())?;
    let raw = std::fs::read(base.join("secrets.enc")).map_err(|e| e.to_string())?;
    if raw.len() < 28 {
        return Err("secrets.enc too small".into());
    }
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};
    let cipher = Aes256Gcm::new_from_slice(&key_bytes).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&raw[..12]);
    let plain = cipher
        .decrypt(nonce, &raw[12..])
        .map_err(|e| format!("decrypt failed: {e}"))?;
    let map: serde_json::Value =
        serde_json::from_slice(&plain).map_err(|e| e.to_string())?;

    let mut api_id: i64 = map
        .get("API_ID")
        .or_else(|| map.get("api_id"))
        .and_then(|v| {
            if let Some(n) = v.as_i64() {
                Some(n)
            } else if let Some(s) = v.as_str() {
                s.parse::<i64>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);

    let mut api_hash = map
        .get("API_HASH")
        .or_else(|| map.get("api_hash"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if api_id <= 0 || api_hash.is_empty() {
        // Fallback to checking worker/.env
        let env_candidates = [
            PathBuf::from("F:/AutoGram/AutoGram App/worker/.env"),
            PathBuf::from("../../worker/.env"),
            PathBuf::from("../worker/.env"),
        ];
        for env_path in &env_candidates {
            if env_path.is_file() {
                if let Ok(text) = std::fs::read_to_string(env_path) {
                    for line in text.lines() {
                        let line = line.trim();
                        if let Some((k, v)) = line.split_once('=') {
                            let k = k.trim();
                            let v = v.trim().trim_matches('"').trim_matches('\'');
                            if k == "API_ID" && api_id <= 0 {
                                api_id = v.parse::<i64>().unwrap_or(0);
                            } else if k == "API_HASH" && api_hash.is_empty() {
                                api_hash = v.to_string();
                            }
                        }
                    }
                }
            }
            if api_id > 0 && !api_hash.is_empty() {
                break;
            }
        }
    }

    if api_id <= 0 || api_hash.is_empty() {
        return Err("invalid api_id or api_hash in credentials store or worker/.env".into());
    }
    Ok((api_id, api_hash))
}

/// Executes an isolated trial upload of up to 10 files using concurrent uploads.
pub async fn run_trial_concurrent_album_async(
    identity: &TelegramIdentity,
    chat_id: &str,
    topic_id: Option<i64>,
    files: &[String],
) -> Result<TrialResult, TgError> {
    if !(2..=10).contains(&files.len()) {
        return Err(TgError::new(
            TgErrorCode::Internal,
            "Album trial requires between 2 and 10 files",
        ));
    }

    let sessions = resolve_sessions_dir(None);
    let total_start = Instant::now();

    with_client(&sessions, identity, true, |client| {
        let chat = chat_id.to_string();
        let file_list = files.to_vec();
        Box::pin(async move {
            let peer = resolve_peer(client, &chat).await?;

            tg_log::info(
                BACKEND,
                "trial_start",
                format!(
                    "Starting concurrent trial for {} files to peer {} (topic {:?})",
                    file_list.len(),
                    chat,
                    topic_id
                ),
            );

            // 1. Concurrent byte upload for all files
            let upload_start = Instant::now();
            let mut join_set = tokio::task::JoinSet::new();

            for (pos, path_str) in file_list.iter().enumerate() {
                let client = client.clone();
                let path = PathBuf::from(path_str);
                let filename = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("image.jpg")
                    .to_string();

                join_set.spawn(async move {
                    let part_start = Instant::now();
                    let uploaded = upload_file_resilient(
                        &client,
                        &path,
                        filename.clone(),
                        "trial_concurrent",
                        pos,
                        None,
                        None,
                    )
                    .await?;
                    let elapsed = part_start.elapsed().as_millis();
                    Ok::<(usize, grammers_client::media::Uploaded, u128, String), TgError>((
                        pos,
                        uploaded,
                        elapsed,
                        filename,
                    ))
                });
            }

            let mut uploaded_map = std::collections::BTreeMap::new();
            while let Some(join_res) = join_set.join_next().await {
                match join_res {
                    Ok(Ok((pos, uploaded, elapsed, fname))) => {
                        tg_log::info(
                            BACKEND,
                            "file_uploaded_concurrent",
                            format!("pos={pos} file='{fname}' uploaded in {elapsed}ms"),
                        );
                        uploaded_map.insert(pos, uploaded);
                    }
                    Ok(Err(err)) => return Err(err),
                    Err(e) => {
                        return Err(TgError::new(
                            TgErrorCode::Internal,
                            format!("Upload worker task join error: {e}"),
                        ));
                    }
                }
            }

            let upload_elapsed_ms = upload_start.elapsed().as_millis();

            // 2. Pre-register media on Telegram server concurrently
            let reg_start = Instant::now();
            let mut reg_set = tokio::task::JoinSet::new();

            for (pos, uploaded) in uploaded_map {
                let client = client.clone();
                let peer_raw: tl::enums::InputPeer = peer.into();
                let raw_media =
                    tl::enums::InputMedia::UploadedPhoto(tl::types::InputMediaUploadedPhoto {
                        file: uploaded.raw,
                        stickers: None,
                        ttl_seconds: None,
                        live_photo: false,
                        video: None,
                        spoiler: false,
                    });

                reg_set.spawn(async move {
                    let res = client
                        .invoke(&tl::functions::messages::UploadMedia {
                            business_connection_id: None,
                            peer: peer_raw,
                            media: raw_media,
                        })
                        .await
                        .map_err(|e| map_invocation(&e))?;

                    let converted = Media::from_raw(res)
                        .and_then(|m| m.to_raw_input_media())
                        .ok_or_else(|| {
                            TgError::new(
                                TgErrorCode::Internal,
                                "Failed to convert uploaded media to server InputMedia",
                            )
                        })?;

                    Ok::<(usize, tl::enums::InputMedia), TgError>((pos, converted))
                });
            }

            let mut server_media_map = std::collections::BTreeMap::new();
            while let Some(join_res) = reg_set.join_next().await {
                match join_res {
                    Ok(Ok((pos, server_media))) => {
                        server_media_map.insert(pos, server_media);
                    }
                    Ok(Err(err)) => return Err(err),
                    Err(e) => {
                        return Err(TgError::new(
                            TgErrorCode::Internal,
                            format!("Registration worker task join error: {e}"),
                        ));
                    }
                }
            }

            let registration_elapsed_ms = reg_start.elapsed().as_millis();

            // 3. Assemble SendMultiMedia request adhering strictly to collage invariants
            let mut multi_media = Vec::with_capacity(file_list.len());
            for pos in 0..file_list.len() {
                let server_media = server_media_map
                    .remove(&pos)
                    .ok_or_else(|| TgError::new(TgErrorCode::Internal, "Missing server media item"))?;

                let random_id = rand::random::<i64>();
                let caption = if pos == 0 {
                    format!(
                        "🧪 [AutoGram Trial] Concurrent Album Upload ({} Media Grid)\n⚡ Upload Paralel: {:.2}s | Registrasi: {:.2}s\n✅ Invarian: 1 Kolase Rapi",
                        file_list.len(),
                        upload_elapsed_ms as f64 / 1000.0,
                        registration_elapsed_ms as f64 / 1000.0,
                    )
                } else {
                    String::new()
                };

                multi_media.push(tl::enums::InputSingleMedia::Media(
                    tl::types::InputSingleMedia {
                        media: server_media,
                        random_id,
                        message: caption,
                        entities: None,
                    },
                ));
            }

            let send_reply_to = topic_id.filter(|&t| t > 0).map(|t| {
                tl::types::InputReplyToMessage {
                    reply_to_msg_id: t as i32,
                    top_msg_id: Some(t as i32),
                    reply_to_peer_id: None,
                    quote_text: None,
                    quote_entities: None,
                    quote_offset: None,
                    monoforum_peer_id: None,
                    todo_item_id: None,
                    poll_option: None,
                }
                .into()
            });

            let album_req = tl::functions::messages::SendMultiMedia {
                silent: false,
                background: false,
                clear_draft: false,
                peer: peer.into(),
                reply_to: send_reply_to,
                schedule_date: None,
                multi_media,
                send_as: None,
                noforwards: false,
                update_stickersets_order: false,
                invert_media: false,
                quick_reply_shortcut: None,
                effect: None,
                allow_paid_floodskip: false,
                allow_paid_stars: None,
            };

            let rpc_start = Instant::now();
            let mut album_send_attempts = 1;
            let mut updates_res = client.invoke(&album_req).await;

            while album_send_attempts < 4 && updates_res.is_err() {
                let is_retryable = if let Err(ref e) = updates_res {
                    let mapped = map_invocation(e);
                    matches!(
                        mapped.code(),
                        TgErrorCode::Timeout | TgErrorCode::Network | TgErrorCode::Io
                    ) || mapped.rpc_name().as_deref() == Some("WORKER_BUSY_TOO_LONG_RETRY")
                } else {
                    false
                };

                if !is_retryable {
                    break;
                }

                let backoff_secs = match album_send_attempts {
                    1 => 3,
                    2 => 6,
                    _ => 10,
                };

                tg_log::warn(
                    BACKEND,
                    "trial_album_send_timeout_retry",
                    format!(
                        "SendMultiMedia hit timeout/network on attempt {album_send_attempts}. Checking history & retrying with same random_ids in {backoff_secs}s..."
                    ),
                );
                tokio::time::sleep(Duration::from_secs(backoff_secs)).await;

                // Check history in case Telegram committed the album in background
                let mut iter = client.iter_messages(peer).limit(30);
                let mut grouped_map: std::collections::HashMap<i64, Vec<i64>> = std::collections::HashMap::new();
                while let Ok(Some(msg)) = iter.next().await {
                    if let Some(gid) = msg.grouped_id() {
                        let msg_tid = crate::core::grammers_ops::media_list::message_topic_id(&msg);
                        let target_topic = topic_id.filter(|t| *t > 0);
                        let topic_matches = match target_topic {
                            Some(tid) => msg_tid == Some(tid),
                            None => true,
                        };
                        if topic_matches {
                            grouped_map.entry(gid).or_default().push(msg.id() as i64);
                        }
                    }
                }
                for (_gid, ids) in grouped_map {
                    if ids.len() == file_list.len() {
                        tg_log::info(
                            BACKEND,
                            "trial_album_recovered_from_history",
                            format!("Album found in Telegram history with IDs: {:?}", ids),
                        );
                        let rpc_elapsed_ms = rpc_start.elapsed().as_millis();
                        let total_elapsed_ms = total_start.elapsed().as_millis();
                        return Ok(TrialResult {
                            success: true,
                            total_files: file_list.len(),
                            upload_elapsed_ms,
                            registration_elapsed_ms,
                            rpc_elapsed_ms,
                            total_elapsed_ms,
                            message_ids: ids,
                            destination: chat,
                            topic_id,
                            error: None,
                        });
                    }
                }

                album_send_attempts += 1;
                updates_res = client.invoke(&album_req).await;
            }

            let updates = updates_res.map_err(|e| map_invocation(&e))?;
            let rpc_elapsed_ms = rpc_start.elapsed().as_millis();
            let total_elapsed_ms = total_start.elapsed().as_millis();

            // Extract message IDs from updates
            let mut message_ids = Vec::new();
            match updates {
                tl::enums::Updates::Updates(u) => {
                    for update in u.updates {
                        match update {
                            tl::enums::Update::NewMessage(nm) => {
                                if let tl::enums::Message::Message(m) = nm.message {
                                    message_ids.push(m.id as i64);
                                }
                            }
                            tl::enums::Update::NewChannelMessage(ncm) => {
                                if let tl::enums::Message::Message(m) = ncm.message {
                                    message_ids.push(m.id as i64);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                tl::enums::Updates::Combined(c) => {
                    for update in c.updates {
                        match update {
                            tl::enums::Update::NewMessage(nm) => {
                                if let tl::enums::Message::Message(m) = nm.message {
                                    message_ids.push(m.id as i64);
                                }
                            }
                            tl::enums::Update::NewChannelMessage(ncm) => {
                                if let tl::enums::Message::Message(m) = ncm.message {
                                    message_ids.push(m.id as i64);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }

            tg_log::info(
                BACKEND,
                "trial_completed",
                format!(
                    "Trial album finished! {} items, total: {}ms (upload: {}ms, reg: {}ms, rpc: {}ms). Message IDs: {:?}",
                    file_list.len(),
                    total_elapsed_ms,
                    upload_elapsed_ms,
                    registration_elapsed_ms,
                    rpc_elapsed_ms,
                    message_ids
                ),
            );

            Ok(TrialResult {
                success: true,
                total_files: file_list.len(),
                upload_elapsed_ms,
                registration_elapsed_ms,
                rpc_elapsed_ms,
                total_elapsed_ms,
                message_ids,
                destination: chat,
                topic_id,
                error: None,
            })
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn run_trial_to_test_topic() {
        let (api_id, api_hash) = load_local_credentials().expect("credentials must load");
        let identity = TelegramIdentity {
            session: "session_1785668521".to_string(),
            api_id,
            api_hash,
        };
        let chat_id = "-1003214112048";
        let topic_id = Some(43421); // #Gudang / Tes
        let files = vec![
            r"D:\Upload\Part\1945138307987321325-1.jpg".to_string(),
            r"D:\Upload\Part\1945138307987321325-2.jpg".to_string(),
            r"D:\Upload\Part\1945177038702178812-1.jpg".to_string(),
            r"D:\Upload\Part\1945177038702178812-2.jpg".to_string(),
            r"D:\Upload\Part\1945177038702178812-3.jpg".to_string(),
            r"D:\Upload\Part\1945177038702178812-4.jpg".to_string(),
            r"D:\Upload\Part\1945178889988219140-1.jpg".to_string(),
            r"D:\Upload\Part\1945178889988219140-2.jpg".to_string(),
            r"D:\Upload\Part\1945182202334990423-1.jpg".to_string(),
            r"D:\Upload\Part\1945182202334990423-2.jpg".to_string(),
        ];

        let res = run_trial_concurrent_album_async(&identity, chat_id, topic_id, &files).await;
        match res {
            Ok(result) => {
                println!("\n==========================================");
                println!("🎉 TRIAL CONCURRENT ALBUM SUCCESSFUL!");
                println!("Total Files: {}", result.total_files);
                println!(
                    "Upload byte duration (10 files paralel): {} ms ({:.2} s)",
                    result.upload_elapsed_ms,
                    result.upload_elapsed_ms as f64 / 1000.0
                );
                println!(
                    "Server registration duration: {} ms ({:.2} s)",
                    result.registration_elapsed_ms,
                    result.registration_elapsed_ms as f64 / 1000.0
                );
                println!(
                    "SendMultiMedia RPC duration: {} ms ({:.2} s)",
                    result.rpc_elapsed_ms,
                    result.rpc_elapsed_ms as f64 / 1000.0
                );
                println!(
                    "TOTAL elapsed time: {} ms ({:.2} s)",
                    result.total_elapsed_ms,
                    result.total_elapsed_ms as f64 / 1000.0
                );
                println!("Message IDs committed: {:?}", result.message_ids);
                println!("==========================================\n");
                assert!(result.success);
                assert!(!result.message_ids.is_empty());
            }
            Err(e) => {
                panic!("Trial upload failed: {:?}", e);
            }
        }
    }
}
