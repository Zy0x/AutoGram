//! channel_updates.rs — MTProto RPC for Channel PTS & Difference Recovery (P2.5)

use std::path::Path;
use grammers_client::tl;

use crate::core::media_mutation::MediaMutation;
use crate::core::session_rate::RpcClass;
use crate::core::telegram_ops::TelegramIdentity;
use crate::core::telegram_rpc_guard::{invoke_guarded_with_control, RpcGuardControl};
use crate::core::tg_error::{TgError, TgErrorCode};

use super::client_pool::{with_client, with_pool_retry};
use super::media_list::{tl_message_to_row, MediaFileRow};
use super::peer_resolver::resolve_peer;

const BACKEND: &str = "grammers";

/// Parsed result from a single `updates.getChannelDifference` RPC page.
#[derive(Debug, Clone)]
pub enum ChannelDifferenceResult {
    Empty {
        pts: i32,
        timeout: Option<i32>,
    },
    Difference {
        pts: i32,
        is_final: bool,
        new_messages: Vec<MediaFileRow>,
        other_mutations: Vec<MediaMutation>,
        timeout: Option<i32>,
    },
    TooLong {
        latest_pts: i32,
        timeout: Option<i32>,
    },
}

async fn input_channel_from_peer(
    client: &grammers_client::Client,
    chat_id: &str,
) -> Result<tl::enums::InputChannel, TgError> {
    let peer = resolve_peer(client, chat_id).await?;
    let input_peer: tl::enums::InputPeer = peer.into();
    match input_peer {
        tl::enums::InputPeer::Channel(c) => Ok(tl::enums::InputChannel::Channel(tl::types::InputChannel {
            channel_id: c.channel_id,
            access_hash: c.access_hash,
        })),
        _ => Err(TgError::new(
            TgErrorCode::PeerNotFound,
            format!("chat {chat_id} is not a channel"),
        )),
    }
}

/// Fetches the latest authoritative PTS for a channel via `channels.getFullChannel`.
pub async fn fetch_channel_pts(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    guard_control: &RpcGuardControl,
) -> Result<i32, TgError> {
    let peer_str = chat_id.to_string();
    let session_name = identity.session.clone();
    let active_guard = guard_control.clone();

    with_pool_retry(&session_name, || {
        let p_str = peer_str.clone();
        let s_name = session_name.clone();
        let guard = active_guard.clone();
        async move {
            with_client(sessions_dir, identity, true, move |client| {
                let p_inner = p_str.clone();
                let g_inner = guard.clone();
                let s_inner = s_name.clone();
                Box::pin(async move {
                    let input_channel = input_channel_from_peer(client, &p_inner).await?;
                    let req = tl::functions::channels::GetFullChannel {
                        channel: input_channel,
                    };

                    let res = invoke_guarded_with_control(
                        &s_inner,
                        RpcClass::IndexSearch,
                        "channels.getFullChannel",
                        &g_inner,
                        || client.invoke(&req),
                    )
                    .await?;

                    match res.value {
                        tl::enums::messages::ChatFull::Full(cf) => match cf.full_chat {
                            tl::enums::ChatFull::ChannelFull(ch_full) => Ok(ch_full.pts),
                            _ => Err(TgError::new(
                                TgErrorCode::PeerNotFound,
                                "Target peer did not return channel full details",
                            )),
                        },
                    }
                })
            })
            .await
        }
    })
    .await
}

/// Retrieves a page of channel difference updates via `updates.getChannelDifference`.
pub async fn get_channel_difference_page(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: &str,
    pts: i32,
    limit: i32,
    guard_control: &RpcGuardControl,
) -> Result<ChannelDifferenceResult, TgError> {
    let peer_str = chat_id.to_string();
    let session_name = identity.session.clone();
    let active_guard = guard_control.clone();

    with_pool_retry(&session_name, || {
        let p_str = peer_str.clone();
        let s_name = session_name.clone();
        let guard = active_guard.clone();
        async move {
            with_client(sessions_dir, identity, true, move |client| {
                let p_inner = p_str.clone();
                let g_inner = guard.clone();
                let s_inner = s_name.clone();
                Box::pin(async move {
                    let input_channel = input_channel_from_peer(client, &p_inner).await?;
                    let req = tl::functions::updates::GetChannelDifference {
                        force: false,
                        channel: input_channel,
                        filter: tl::enums::ChannelMessagesFilter::Empty,
                        pts,
                        limit,
                    };

                    let res = invoke_guarded_with_control(
                        &s_inner,
                        RpcClass::IndexSearch,
                        "updates.getChannelDifference",
                        &g_inner,
                        || client.invoke(&req),
                    )
                    .await?;

                    match res.value {
                        tl::enums::updates::ChannelDifference::Empty(d) => {
                            Ok(ChannelDifferenceResult::Empty {
                                pts: d.pts,
                                timeout: d.timeout,
                            })
                        }
                        tl::enums::updates::ChannelDifference::Difference(d) => {
                            let mut new_rows = Vec::new();
                            let parsed_folder = p_inner.parse::<i64>().ok();

                            for raw_msg in d.new_messages {
                                if let Some(row) = tl_message_to_row(&raw_msg, parsed_folder) {
                                    new_rows.push(row);
                                }
                            }

                            let mut other_muts = Vec::new();
                            for upd in d.other_updates {
                                match upd {
                                    tl::enums::Update::EditChannelMessage(u) => {
                                        let (msg_id, top_id) = match &u.message {
                                            tl::enums::Message::Message(m) => {
                                                let tid = match &m.reply_to {
                                                    Some(tl::enums::MessageReplyHeader::Header(h)) => {
                                                        h.reply_to_top_id.or(h.reply_to_msg_id).map(|i| i as i64)
                                                    }
                                                    _ => None,
                                                };
                                                (m.id as i64, tid)
                                            }
                                            _ => (0, None),
                                        };

                                        if msg_id > 0 {
                                            if let Some(row) = tl_message_to_row(&u.message, parsed_folder) {
                                                other_muts.push(MediaMutation::upsert(
                                                    &p_inner, msg_id, top_id, row,
                                                ));
                                            } else {
                                                other_muts.push(MediaMutation::delete(
                                                    &p_inner,
                                                    vec![msg_id],
                                                ));
                                            }
                                        }
                                    }
                                    tl::enums::Update::DeleteChannelMessages(u) => {
                                        let ids: Vec<i64> =
                                            u.messages.into_iter().map(|id| id as i64).collect();
                                        if !ids.is_empty() {
                                            other_muts.push(MediaMutation::delete(&p_inner, ids));
                                        }
                                    }
                                    _ => {}
                                }
                            }

                            Ok(ChannelDifferenceResult::Difference {
                                pts: d.pts,
                                is_final: d.r#final,
                                new_messages: new_rows,
                                other_mutations: other_muts,
                                timeout: d.timeout,
                            })
                        }
                        tl::enums::updates::ChannelDifference::TooLong(d) => {
                            let latest_pts = match d.dialog {
                                tl::enums::Dialog::Dialog(ref diag) => diag.pts.unwrap_or(0),
                                _ => 0,
                            };
                            Ok(ChannelDifferenceResult::TooLong {
                                latest_pts,
                                timeout: d.timeout,
                            })
                        }
                    }
                })
            })
            .await
        }
    })
    .await
}
