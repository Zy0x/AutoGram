//! session_update_router.rs — Per-Session Passive Telegram Update Router (P2.5)
//!
//! Subscribes once per Telegram session to the passive Grammers update stream,
//! extracts channel-specific ordered updates (New, Edit, Delete, ChannelTooLong),
//! and routes them to registered `ChannelSyncWorker` mailboxes over bounded channels.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use grammers_client::tl;
use tokio::sync::{mpsc, RwLock};
use tokio_util::sync::CancellationToken;

use super::grammers_ops::client_pool::{disconnect_cached_session, obtain_live_client};
use super::grammers_ops::media_list::tl_message_to_row;
use super::media_mutation::MediaMutation;
use super::telegram_ops::TelegramIdentity;
use super::tg_log;

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

#[derive(Clone)]
pub struct ChannelMailbox {
    pub sender: mpsc::Sender<PendingChannelUpdate>,
    pub overflowed: Arc<AtomicBool>,
}

/// Single update router instance per Telegram session.
pub struct SessionUpdateRouter {
    pub session_key: String,
    pub identity: TelegramIdentity,
    pub sessions_dir: PathBuf,
    pub channel_mailboxes: Arc<RwLock<HashMap<i64, ChannelMailbox>>>,
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
    /// Returns the receiver channel and an AtomicBool overflow flag.
    pub async fn register_channel(
        &self,
        channel_id: i64,
    ) -> (mpsc::Receiver<PendingChannelUpdate>, Arc<AtomicBool>) {
        let (tx, rx) = mpsc::channel(64);
        let overflowed = Arc::new(AtomicBool::new(false));
        let mailbox = ChannelMailbox {
            sender: tx,
            overflowed: overflowed.clone(),
        };
        let mut mailboxes = self.channel_mailboxes.write().await;
        mailboxes.insert(channel_id, mailbox);
        (rx, overflowed)
    }

    /// Unregisters a channel mailbox when the sync worker terminates.
    pub async fn unregister_channel(&self, channel_id: i64) {
        let mut mailboxes = self.channel_mailboxes.write().await;
        mailboxes.remove(&channel_id);
    }

    /// Dispatches an extracted channel update to the matching channel worker mailbox.
    /// If the mailbox buffer (64 slots) is full, sets overflow flag instead of dropping silently.
    pub async fn route_channel_update(&self, update: PendingChannelUpdate) {
        let mailboxes = self.channel_mailboxes.read().await;
        let channel_id = update.channel_id;
        if let Some(mb) = mailboxes.get(&channel_id) {
            match mb.sender.try_send(update) {
                Ok(_) => {}
                Err(mpsc::error::TrySendError::Full(_)) => {
                    mb.overflowed.store(true, Ordering::Release);
                    tg_log::warn(
                        BACKEND,
                        "channel_mailbox_overflow",
                        format!("Channel {} mailbox full. Overflow flag set for difference recovery.", channel_id),
                    );
                }
                Err(mpsc::error::TrySendError::Closed(_)) => {}
            }
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
                let ids: Vec<i64> = u.messages.iter().map(|id| *id as i64).collect();

                self.route_channel_update(PendingChannelUpdate {
                    channel_id,
                    pts: u.pts,
                    pts_count: u.pts_count,
                    update_type: ChannelUpdateType::DeleteMessages(ids),
                }).await;
            }

            tl::enums::Update::DeleteMessages(u) => {
                let ids: Vec<i64> = u.messages.iter().map(|id| *id as i64).collect();
                if !ids.is_empty() {
                    let mailboxes = self.channel_mailboxes.read().await;
                    for (&cid, mb) in mailboxes.iter() {
                        let _ = mb.sender.try_send(PendingChannelUpdate {
                            channel_id: cid,
                            pts: u.pts,
                            pts_count: u.pts_count,
                            update_type: ChannelUpdateType::DeleteMessages(ids.clone()),
                        });
                    }
                }
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

    /// Spawns the single passive update listener background loop for this session.
    pub fn spawn_listener(self: &Arc<Self>) {
        let router = Arc::clone(self);
        tokio::spawn(async move {
            let cancel = router.cancel.clone();
            tg_log::info(
                BACKEND,
                "session_router_start",
                format!("Started passive update router for session {}", router.session_key),
            );

            while !cancel.is_cancelled() {
                match obtain_live_client(&router.sessions_dir, &router.identity, true, false).await {
                    Ok(live_client) => {
                        let opt_rx = {
                            let mut guard = live_client.updates_rx.lock().await;
                            guard.take()
                        };

                        if let Some(updates_rx) = opt_rx {
                            let client = live_client.client.clone();
                            let config = grammers_client::client::UpdatesConfiguration::default();
                            match client.stream_updates(updates_rx, config).await {
                                Ok(mut stream) => {
                                    loop {
                                        tokio::select! {
                                            _ = cancel.cancelled() => return,
                                            next_res = stream.next_raw() => {
                                                match next_res {
                                                    Ok((raw_update, _state, _peers)) => {
                                                        router.process_raw_update(&raw_update).await;
                                                    }
                                                    Err(e) => {
                                                        tg_log::warn(
                                                            BACKEND,
                                                            "stream_update_err",
                                                            format!("Session {} stream error: {e}", router.session_key),
                                                        );
                                                        disconnect_cached_session(&router.session_key);
                                                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                Err(e) => {
                                    tg_log::warn(
                                        BACKEND,
                                        "stream_updates_init_failed",
                                        format!("Session {} stream_updates failed: {e}", router.session_key),
                                    );
                                    disconnect_cached_session(&router.session_key);
                                }
                            }
                        } else {
                            // Receiver was already consumed by a previous loop; disconnect so next attempt gets a fresh LiveClient
                            disconnect_cached_session(&router.session_key);
                            tokio::select! {
                                _ = cancel.cancelled() => return,
                                _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {}
                            }
                        }
                    }
                    Err(e) => {
                        tg_log::warn(
                            BACKEND,
                            "session_router_connect_err",
                            format!("Session {} connect failed: {e}", router.session_key),
                        );
                        tokio::select! {
                            _ = cancel.cancelled() => return,
                            _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => {}
                        }
                    }
                }
            }
        });
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
        router.spawn_listener();
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

        let (mut rx_channel_101, _overflow_101) = router.register_channel(101).await;
        let (mut rx_channel_102, _overflow_102) = router.register_channel(102).await;

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

    #[tokio::test]
    async fn test_session_router_overflow_flag_on_full_mailbox() {
        let router = SessionUpdateRouter::new(
            PathBuf::from("dummy"),
            TelegramIdentity {
                session: "test_overflow_sess".into(),
                api_id: 12345,
                api_hash: "hash".into(),
            },
        );

        let (_rx, overflowed) = router.register_channel(202).await;
        assert!(!overflowed.load(Ordering::Acquire));

        // Fill up the 64 slots
        for i in 0..64 {
            router.route_channel_update(PendingChannelUpdate {
                channel_id: 202,
                pts: i,
                pts_count: 1,
                update_type: ChannelUpdateType::DeleteMessages(vec![i as i64]),
            }).await;
        }

        assert!(!overflowed.load(Ordering::Acquire));

        // 65th update causes overflow
        router.route_channel_update(PendingChannelUpdate {
            channel_id: 202,
            pts: 65,
            pts_count: 1,
            update_type: ChannelUpdateType::DeleteMessages(vec![65]),
        }).await;

        assert!(overflowed.load(Ordering::Acquire));
    }
}
