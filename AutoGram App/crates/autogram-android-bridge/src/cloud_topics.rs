//! Forum reads use the same authorized account executor as media streams.
use crate::auth::{engine, NativeAuthError};
use crate::cloud::{workspace, NativeCloudMediaPage};
use autogram_core::telegram::{auth::AccountId, cloud::topics::TopicCursor};

#[derive(Clone, uniffi::Record)]
pub struct NativeTopicCursor {
    pub date: i32,
    pub message_id: i32,
    pub topic_id: i32,
}
#[derive(Clone, uniffi::Record)]
pub struct NativeCloudTopic {
    pub id: i32,
    pub title: String,
    pub top_message: i32,
    pub closed: bool,
    pub icon_color: i32,
}
#[derive(Clone, uniffi::Record)]
pub struct NativeCloudTopicPage {
    pub account_id: String,
    pub peer_id: String,
    pub topics: Vec<NativeCloudTopic>,
    pub next: Option<NativeTopicCursor>,
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn list_cloud_topics(
    account_id: String,
    peer_id: String,
    cursor: Option<NativeTopicCursor>,
) -> Result<NativeCloudTopicPage, NativeAuthError> {
    let cursor = cursor
        .map(|cursor| TopicCursor {
            date: cursor.date,
            message_id: cursor.message_id,
            topic_id: cursor.topic_id,
        })
        .unwrap_or_default();
    let page = workspace()
        .list_topics(
            engine()?,
            AccountId(account_id.clone()),
            peer_id.clone(),
            cursor,
        )
        .await?;
    Ok(NativeCloudTopicPage {
        account_id,
        peer_id,
        topics: page
            .topics
            .into_iter()
            .map(|topic| NativeCloudTopic {
                id: topic.id,
                title: topic.title,
                top_message: topic.top_message,
                closed: topic.closed,
                icon_color: topic.icon_color,
            })
            .collect(),
        next: page.next.map(|cursor| NativeTopicCursor {
            date: cursor.date,
            message_id: cursor.message_id,
            topic_id: cursor.topic_id,
        }),
    })
}

#[uniffi::export(async_runtime = "tokio")]
pub async fn list_cloud_topic_media(
    account_id: String,
    peer_id: String,
    topic_id: i32,
    before_message_id: i32,
    query: String,
) -> Result<NativeCloudMediaPage, NativeAuthError> {
    let page = workspace()
        .list_topic_media(
            engine()?,
            AccountId(account_id),
            peer_id,
            topic_id,
            before_message_id,
            query,
        )
        .await?;
    Ok(NativeCloudMediaPage {
        account_id: page.account_id,
        peer_id: page.peer_id,
        items: page.items.into_iter().map(Into::into).collect(),
        next_offset: page.next_offset,
    })
}
