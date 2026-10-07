//! Desktop IPC adapter for the shared Telegram forum protocol.
use super::session::BACKEND;
use crate::core::grammers_ops::{resolve_peer, runtime, with_client, with_pool_retry};
use crate::core::telegram_ops::TelegramIdentity;
use crate::core::tg_error::{map_invocation, TgError, TgErrorCode};
use autogram_core::telegram::cloud::topics::{fetch_topics, TopicCursor};
use serde::{Deserialize, Serialize};
use std::path::Path;

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
                    if !client.is_authorized().await.map_err(|e| map_invocation(&e))? {
                        return Err(TgError::new(TgErrorCode::NotAuthorized, "not authorized"));
                    }
                    let peer = resolve_peer(client, &chat).await?;
                    match fetch_topics(client, peer, &TopicCursor::default()).await {
                        Ok(page) => {
                            let mut topics: Vec<TopicRow> = page.topics.into_iter().map(|topic| TopicRow {
                                id: i64::from(topic.id), title: topic.title,
                                top_message: (topic.top_message > 0).then_some(i64::from(topic.top_message)),
                                closed: topic.closed,
                            }).collect();
                            topics.sort_by(|a, b| (a.id != 1).cmp(&(b.id != 1))
                                .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase())));
                            Ok(ListTopicsResult { status: "success".into(), topics,
                                is_forum: true, cached: false, backend: BACKEND.into() })
                        }
                        Err(error) => {
                            // Invalid peers, permissions and FloodWait are failures, not empty success.
                            let not_forum = matches!(&error,
                                grammers_client::InvocationError::Rpc(rpc) if rpc.name == "CHANNEL_FORUM_MISSING");
                            if not_forum {
                                Ok(ListTopicsResult { status: "success".into(), topics: vec![],
                                    is_forum: false, cached: false, backend: BACKEND.into() })
                            } else { Err(map_invocation(&error)) }
                        }
                    }
                })
            })
        }).await
    })
}
