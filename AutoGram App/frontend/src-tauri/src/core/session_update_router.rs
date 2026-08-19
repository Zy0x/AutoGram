//! session_update_router.rs — Per-Session Passive Telegram Update Router (P2.5)
//!
//! Subscribes once per Telegram session to the passive Grammers update stream,
//! extracts channel-specific ordered updates (New, Edit, Delete, ChannelTooLong),
//! and routes them to registered `ChannelSyncWorker` mailboxes over bounded channels.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use grammers_client::tl;
use tokio::sync::{mpsc, RwLock};
use tokio_util::sync::CancellationToken;

use super::grammers_ops::media_list::tl_message_to_row;
use super::media_mutation::MediaMutation;
use super::telegram_ops::TelegramIdentity;

const BACKEND: &str = "grammers";

/// Flattened channel update dispatched from the session router to a channel worker.
#[derive(Debug, Clone)]
pub struct PendingChannelUpdate {
    pub channel_id: i64,
    pub pts: i32,
    pub pts_count: i32,
    pub update_type: ChannelUpdateType,
}

#[derive(Debug, Clone)]
pub enum ChannelUpdateType {
    NewMessage(MediaMutation),
    EditMessage(MediaMutation),
    DeleteMessages(Vec<i64>),
    ChannelTooLong { pts: Option<i32> },
}

/// Single update router instance per Telegram session.
pub struct SessionUpdateRouter {
    pub session_key: String,
    pub identity: TelegramIdentity,
    pub sessions_dir: PathBuf,
    pub channel_mailboxes: Arc<RwLock<HashMap<i64, mpsc::Sender<PendingChannelUpdate>>>>,
    pub cancel: CancellationToken,
}

impl SessionUpdateRouter {
    pub fn new(sessions_dir: PathBuf, identity: TelegramIdentity) -> Self {
        let session_key = identity.session.clone();
        Self {
            session_key,
            identity,
            sessions_dir,
            channel_mailboxes: Arc::new(RwLock::new(HashMap::new())),
            cancel: CancellationToken::new(),
        }
    }

    /// Registers a channel mailbox to receive routed updates for a specific channel_id.
    pub async fn register_channel(&self, channel_id: i64) -> mpsc::Receiver<PendingChannelUpdate> {
        let (tx, rx) = mpsc::channel(64);
        let mut mailboxes = self.channel_mailboxes.write().await;
        mailboxes.insert(channel_id, tx);
        rx
    }

    /// Unregisters a channel mailbox when the sync worker terminates.
    pub async fn unregister_channel(&self, channel_id: i64) {
        let mut mailboxes = self.channel_mailboxes.write().await;
        mailboxes.remove(&channel_id);
    }

    /// Dispatches an extracted channel update to the matching channel worker mailbox if registered.
    pub async fn route_channel_update(&self, update: PendingChannelUpdate) {
        let mailboxes = self.channel_mailboxes.read().await;
        if let Some(tx) = mailboxes.get(&update.channel_id) {
            let _ = tx.try_send(update);
        }
    }

    /// Helper to process a raw TL update and route it if it belongs to a channel.
    pub async fn process_raw_update(&self, raw_update: &tl::enums::Update) {
        match raw_update {
            tl::enums::Update::NewChannelMessage(u) => {
                let (channel_id, msg_id, top_id) = match &u.message {
                    tl::enums::Message::Message(m) => {
                        let cid = match &m.peer_id {
                            tl::enums::Peer::Channel(c) => c.channel_id,
                            _ => 0,
                        };
                        let tid = match &m.reply_to {
                            Some(tl::enums::MessageReplyHeader::Header(h)) => h.reply_to_top_id.or(h.reply_to_msg_id).map(|i| i as i64),
                            _ => None,
                        };
                        (cid, m.id as i64, tid)
                    }
                    _ => (0, 0, None),
                };

                if channel_id != 0 && msg_id > 0 {
                    let peer_str = channel_id.to_string();
                    let mutation = if let Some(row) = tl_message_to_row(&u.message, Some(channel_id)) {
                        MediaMutation::upsert(&peer_str, msg_id, top_id, row)
                    } else {
                        MediaMutation::delete(&peer_str, vec![msg_id])
                    };

                    self.route_channel_update(PendingChannelUpdate {
                        channel_id,
                        pts: u.pts,
                        pts_count: u.pts_count,
                        update_type: ChannelUpdateType::NewMessage(mutation),
                    }).await;
                }
            }

            tl::enums::Update::EditChannelMessage(u) => {
                let (channel_id, msg_id, top_id) = match &u.message {
                    tl::enums::Message::Message(m) => {
                        let cid = match &m.peer_id {
                            tl::enums::Peer::Channel(c) => c.channel_id,
                            _ => 0,
                        };
                        let tid = match &m.reply_to {
                            Some(tl::enums::MessageReplyHeader::Header(h)) => h.reply_to_top_id.or(h.reply_to_msg_id).map(|i| i as i64),
                            _ => None,
                        };
                        (cid, m.id as i64, tid)
                    }
                    _ => (0, 0, None),
                };

                if channel_id != 0 && msg_id > 0 {
                    let peer_str = channel_id.to_string();
                    let mutation = if let Some(row) = tl_message_to_row(&u.message, Some(channel_id)) {
                        MediaMutation::upsert(&peer_str, msg_id, top_id, row)
                    } else {
                        MediaMutation::delete(&peer_str, vec![msg_id])
                    };

                    self.route_channel_update(PendingChannelUpdate {
                        channel_id,
                        pts: u.pts,
                        pts_count: u.pts_count,
                        update_type: ChannelUpdateType::EditMessage(mutation),
                    }).await;
                }
            }

            tl::enums::Update::DeleteChannelMessages(u) => {
                let channel_id = u.channel_id;
                let peer_str = channel_id.to_string();
                let ids: Vec<i64> = u.messages.iter().map(|id| *id as i64).collect();

                self.route_channel_update(PendingChannelUpdate {
                    channel_id,
                    pts: u.pts,
                    pts_count: u.pts_count,
                    update_type: ChannelUpdateType::DeleteMessages(ids),
                }).await;
            }

            tl::enums::Update::ChannelTooLong(u) => {
                let channel_id = u.channel_id;
                self.route_channel_update(PendingChannelUpdate {
                    channel_id,
                    pts: u.pts.unwrap_or(0),
                    pts_count: 0,
                    update_type: ChannelUpdateType::ChannelTooLong { pts: u.pts },
                }).await;
            }

            _ => {}
        }
    }
}

/// Global manager keeping one active `SessionUpdateRouter` per active Telegram session.
#[derive(Default)]
pub struct SessionUpdateRouterManager {
    pub routers: RwLock<HashMap<String, Arc<SessionUpdateRouter>>>,
}

impl SessionUpdateRouterManager {
    pub fn new() -> Self {
        Self {
            routers: RwLock::new(HashMap::new()),
        }
    }

    /// Gets or creates the single authoritative update router for a Telegram session.
    pub async fn get_or_create(
        &self,
        sessions_dir: PathBuf,
        identity: &TelegramIdentity,
    ) -> Arc<SessionUpdateRouter> {
        let key = identity.session.clone();
        let mut map = self.routers.write().await;
        if let Some(router) = map.get(&key) {
            return router.clone();
        }

        let router = Arc::new(SessionUpdateRouter::new(sessions_dir, identity.clone()));
        map.insert(key, router.clone());
        router
    }

    /// Removes router when session is logged out or closed.
    pub async fn remove_session(&self, session_key: &str) {
        let mut map = self.routers.write().await;
        if let Some(r) = map.remove(session_key) {
            r.cancel.cancel();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_session_router_dispatch_to_registered_channel() {
        let router = SessionUpdateRouter::new(
            PathBuf::from("dummy"),
            TelegramIdentity {
                session: "test_router_sess".into(),
                api_id: 12345,
                api_hash: "hash".into(),
            },
        );

        let mut rx_channel_101 = router.register_channel(101).await;
        let mut rx_channel_102 = router.register_channel(102).await;

        // Route update for channel 101
        router.route_channel_update(PendingChannelUpdate {
            channel_id: 101,
            pts: 50,
            pts_count: 1,
            update_type: ChannelUpdateType::DeleteMessages(vec![1, 2]),
        }).await;

        let received = rx_channel_101.try_recv().unwrap();
        assert_eq!(received.channel_id, 101);
        assert_eq!(received.pts, 50);

        // Channel 102 should have received nothing
        assert!(rx_channel_102.try_recv().is_err());

        // Unregister channel 101
        router.unregister_channel(101).await;

        // Further updates for 101 are dropped cleanly without error
        router.route_channel_update(PendingChannelUpdate {
            channel_id: 101,
            pts: 51,
            pts_count: 1,
            update_type: ChannelUpdateType::DeleteMessages(vec![3]),
        }).await;

        assert!(rx_channel_101.try_recv().is_err());
    }
}
