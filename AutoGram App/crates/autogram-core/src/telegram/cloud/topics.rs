//! Forum protocol shared by desktop and Android. Titles and identities are server-owned.
use grammers_client::{tl, Client, InvocationError};
use grammers_session::types::PeerRef;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TopicCursor {
    pub date: i32,
    pub message_id: i32,
    pub topic_id: i32,
}
#[derive(Clone, Debug)]
pub struct CloudTopic {
    pub id: i32,
    pub title: String,
    pub top_message: i32,
    pub closed: bool,
    pub icon_color: i32,
}
#[derive(Clone, Debug)]
pub struct CloudTopicPage {
    pub topics: Vec<CloudTopic>,
    pub next: Option<TopicCursor>,
    pub cursor_error: bool,
}

pub fn topic_request(
    peer: PeerRef,
    cursor: &TopicCursor,
) -> tl::functions::messages::GetForumTopics {
    tl::functions::messages::GetForumTopics {
        peer: peer.into(),
        q: None,
        offset_date: cursor.date,
        offset_id: cursor.message_id,
        offset_topic: cursor.topic_id,
        limit: 100,
    }
}

pub fn normalize_topics(
    pack: tl::types::messages::ForumTopics,
    previous: &TopicCursor,
) -> CloudTopicPage {
    let last = pack.topics.iter().rev().find_map(|topic| match topic {
        tl::enums::ForumTopic::Topic(topic) => Some(topic),
        _ => None,
    });
    let mut cursor_error = !pack.topics.is_empty() && last.is_none();
    let next = last
        .and_then(|topic| {
            let message_date = pack.messages.iter().find_map(|message| match message {
                tl::enums::Message::Message(message) if message.id == topic.top_message => {
                    Some(message.date)
                }
                tl::enums::Message::Service(message) if message.id == topic.top_message => {
                    Some(message.date)
                }
                _ => None,
            });
            let date = if pack.order_by_create_date {
                Some(topic.date)
            } else {
                message_date
            };
            let Some(date) = date else {
                // Creation time is not a safe substitute for last-message ordering.
                cursor_error = true;
                return None;
            };
            Some(TopicCursor {
                date,
                message_id: topic.top_message,
                topic_id: topic.id,
            })
        })
        .filter(|cursor| cursor != previous);
    // A short page is not EOF: Telegram may return fewer rows than the requested limit.
    let topics = pack
        .topics
        .into_iter()
        .filter_map(|topic| match topic {
            tl::enums::ForumTopic::Topic(topic) => Some(CloudTopic {
                id: topic.id,
                title: topic.title,
                top_message: topic.top_message,
                closed: topic.closed,
                icon_color: topic.icon_color,
            }),
            tl::enums::ForumTopic::Deleted(_) => None,
        })
        .collect();
    CloudTopicPage {
        topics,
        next,
        cursor_error,
    }
}

pub async fn fetch_topics(
    client: &Client,
    peer: PeerRef,
    cursor: &TopicCursor,
) -> Result<CloudTopicPage, InvocationError> {
    let tl::enums::messages::ForumTopics::Topics(pack) =
        client.invoke(&topic_request(peer, cursor)).await?;
    Ok(normalize_topics(pack, cursor))
}

pub fn media_request(
    peer: PeerRef,
    topic_id: i32,
    before: i32,
    query: String,
) -> tl::functions::messages::Search {
    tl::functions::messages::Search {
        peer: peer.into(),
        q: query,
        from_id: None,
        saved_peer_id: None,
        saved_reaction: None,
        top_msg_id: Some(topic_id),
        filter: tl::enums::MessagesFilter::InputMessagesFilterEmpty,
        min_date: 0,
        max_date: 0,
        offset_id: before,
        add_offset: 0,
        limit: 100,
        max_id: 0,
        min_id: 0,
        hash: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use grammers_session::types::PeerId;
    fn topic(id: i32) -> tl::enums::ForumTopic {
        tl::types::ForumTopic {
            my: false,
            closed: true,
            pinned: false,
            short: false,
            hidden: false,
            title_missing: false,
            id,
            date: 1234,
            peer: tl::types::PeerChannel { channel_id: 42 }.into(),
            title: "server title".into(),
            icon_color: 0x6fb9f0,
            icon_emoji_id: None,
            top_message: 800,
            read_inbox_max_id: 0,
            read_outbox_max_id: 0,
            unread_count: 0,
            unread_mentions_count: 0,
            unread_reactions_count: 0,
            unread_poll_votes_count: 0,
            from_id: tl::types::PeerUser { user_id: 7 }.into(),
            draft: None,
            notify_settings: tl::types::PeerNotifySettings {
                show_previews: None,
                silent: None,
                mute_until: None,
                ios_sound: None,
                android_sound: None,
                other_sound: None,
                stories_muted: None,
                stories_hide_sender: None,
                stories_ios_sound: None,
                stories_android_sound: None,
                stories_other_sound: None,
            }
            .into(),
        }
        .into()
    }
    fn pack(topics: Vec<tl::enums::ForumTopic>) -> tl::types::messages::ForumTopics {
        tl::types::messages::ForumTopics {
            order_by_create_date: true,
            count: 500,
            topics,
            messages: vec![],
            chats: vec![],
            users: vec![],
            pts: 0,
        }
    }
    #[test]
    fn short_server_page_still_has_cursor_and_preserves_metadata() {
        let page = normalize_topics(pack(vec![topic(71)]), &TopicCursor::default());
        assert_eq!(
            page.next,
            Some(TopicCursor {
                date: 1234,
                message_id: 800,
                topic_id: 71
            })
        );
        assert_eq!(page.topics[0].title, "server title");
        assert_eq!(page.topics[0].icon_color, 0x6fb9f0);
        assert!(page.topics[0].closed);
    }
    #[test]
    fn empty_or_deleted_topics_do_not_invent_general_or_deleted_cards() {
        for topics in [vec![], vec![tl::types::ForumTopicDeleted { id: 71 }.into()]] {
            let page = normalize_topics(pack(topics), &TopicCursor::default());
            assert!(page.topics.is_empty());
            assert!(page.next.is_none());
        }
    }
    #[test]
    fn exhausted_repeated_cursor_does_not_loop() {
        let cursor = TopicCursor {
            date: 1234,
            message_id: 800,
            topic_id: 71,
        };
        assert!(normalize_topics(pack(vec![topic(71)]), &cursor)
            .next
            .is_none());
    }
    #[test]
    fn missing_last_message_date_never_guesses_a_pagination_frontier() {
        let mut response = pack(vec![topic(71)]);
        response.order_by_create_date = false;
        let page = normalize_topics(response, &TopicCursor::default());
        assert!(page.next.is_none());
        assert!(page.cursor_error);
    }
    #[test]
    fn topic_search_preserves_server_scope_and_pagination() {
        let peer = PeerId::channel(42).unwrap().to_ambient_ref();
        let request = media_request(peer, 71, 980, "image".into());
        assert_eq!(request.top_msg_id, Some(71));
        assert_eq!(request.offset_id, 980);
        assert_eq!(request.q, "image");
        assert_eq!(request.limit, 100);
    }
    #[test]
    fn forum_cursor_is_not_a_local_generated_topic_id() {
        let peer = PeerId::channel(42).unwrap().to_ambient_ref();
        let cursor = TopicCursor {
            date: 1000,
            message_id: 800,
            topic_id: 71,
        };
        let request = topic_request(peer, &cursor);
        assert_eq!(
            (request.offset_date, request.offset_id, request.offset_topic),
            (1000, 800, 71)
        );
    }
}
