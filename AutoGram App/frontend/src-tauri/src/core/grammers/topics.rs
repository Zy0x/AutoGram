//! Telegram Forum topics listing & chat metadata RPC queries.

use grammers_client::tl;
use serde::{Deserialize, Serialize};
use std::path::Path;

use super::session::BACKEND;
use crate::core::grammers_ops::{resolve_peer, runtime, with_client, with_pool_retry};
use crate::core::telegram_ops::TelegramIdentity;
use crate::core::tg_error::{map_invocation, TgError, TgErrorCode};
use crate::core::tg_log;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicRow {
    pub id: i64,
    pub title: String,
    pub top_message: Option<i64>,
    pub closed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTopicsResult {
    pub status: String,
    pub topics: Vec<TopicRow>,
    pub is_forum: bool,
    pub cached: bool,
    pub backend: String,
}

pub fn list_topics_blocking(
    sessions_dir: &Path,
    identity: &TelegramIdentity,
    chat_id: i64,
) -> Result<ListTopicsResult, TgError> {
    let rt = runtime()?;
    let chat = chat_id.to_string();
    rt.block_on(async {
        with_pool_retry(&identity.session, || {
            let chat = chat.clone();
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
                    let req = tl::functions::messages::GetForumTopics {
                        peer: input,
                        q: None,
                        offset_date: 0,
                        offset_id: 0,
                        offset_topic: 0,
                        limit: 100,
                    };
                    match client.invoke(&req).await {
                        Ok(tl::enums::messages::ForumTopics::Topics(pack)) => {
                            let mut topics = Vec::new();
                            for t in pack.topics {
                                match t {
                                    tl::enums::ForumTopic::Topic(ft) => {
                                        topics.push(TopicRow {
                                            id: ft.id as i64,
                                            title: if ft.title.is_empty() {
                                                format!("Topic {}", ft.id)
                                            } else {
                                                ft.title
                                            },
                                            top_message: if ft.top_message > 0 {
                                                Some(ft.top_message as i64)
                                            } else {
                                                None
                                            },
                                            closed: ft.closed,
                                        });
                                    }
                                    tl::enums::ForumTopic::Deleted(d) => {
                                        topics.push(TopicRow {
                                            id: d.id as i64,
                                            title: format!("Deleted {}", d.id),
                                            top_message: None,
                                            closed: true,
                                        });
                                    }
                                }
                            }
                            topics.sort_by(|a, b| {
                                let ao = if a.id == 1 { 0 } else { 1 };
                                let bo = if b.id == 1 { 0 } else { 1 };
                                ao.cmp(&bo).then_with(|| {
                                    a.title
                                        .to_ascii_lowercase()
                                        .cmp(&b.title.to_ascii_lowercase())
                                })
                            });
                            tg_log::info(
                                BACKEND,
                                "list_topics",
                                format!("chat={chat_id} n={}", topics.len()),
                            );
                            Ok(ListTopicsResult {
                                status: "success".into(),
                                topics,
                                is_forum: true,
                                cached: false,
                                backend: BACKEND.into(),
                            })
                        }
                        Err(e) => {
                            let msg = e.to_string().to_ascii_lowercase();
                            if msg.contains("forum")
                                || msg.contains("topic")
                                || msg.contains("chat_id")
                                || msg.contains("channel")
                                || msg.contains("peer")
                            {
                                tg_log::info(
                                    BACKEND,
                                    "list_topics_not_forum",
                                    format!("chat={chat_id}"),
                                );
                                return Ok(ListTopicsResult {
                                    status: "success".into(),
                                    topics: vec![],
                                    is_forum: false,
                                    cached: false,
                                    backend: BACKEND.into(),
                                });
                            }
                            Err(map_invocation(&e))
                        }
                    }
                })
            })
        })
        .await
    })
}
