use super::{
    contracts::*,
    metadata, ranges::*,
    thumbnail::{self, ThumbnailQuality, MAX_THUMBNAIL_BATCH},
};
use crate::telegram::auth::{map_rpc, AccountId, AuthEngine, AuthError};
use grammers_client::{client::DialogIter, media::Media, peer::Peer};
use grammers_session::types::{PeerId, PeerRef};
use parking_lot::Mutex;
use rand::RngCore;
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

const PAGE_SIZE: usize = 50;
const HISTORY_SCAN: usize = 100;
const IDLE_TTL: Duration = Duration::from_secs(20 * 60);

struct DialogCursor {
    account: AccountId,
    revision: u64,
    created: Instant,
    iter: DialogIter,
}
struct StreamEntry {
    descriptor: CloudStream,
    revision: u64,
    media: Media,
    cancel: CancellationToken,
    touched: Mutex<Instant>,
}
#[derive(Default)]
struct State {
    revision: u64,
    peers: HashMap<(String, String), PeerRef>,
    cursors: HashMap<String, DialogCursor>,
    streams: HashMap<String, Arc<StreamEntry>>,
}
impl State {
    fn refresh(&mut self, revision: u64) -> Result<(), AuthError> {
        if revision < self.revision {
            return Err(AuthError::new("account_changed"));
        }
        if self.revision != revision {
            for stream in self.streams.values() {
                stream.cancel.cancel();
            }
            self.peers.clear();
            self.cursors.clear();
            self.streams.clear();
            self.revision = revision;
        }
        self.cursors
            .retain(|_, cursor| cursor.created.elapsed() < IDLE_TTL);
        self.streams.retain(|_, stream| {
            let alive = stream.touched.lock().elapsed() < IDLE_TTL;
            if !alive {
                stream.cancel.cancel();
            }
            alive
        });
        Ok(())
    }
}

#[derive(Default)]
pub struct CloudWorkspace {
    state: Mutex<State>,
}

fn token() -> String {
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}
fn self_peer(account: &AccountId) -> Result<PeerRef, AuthError> {
    // InputPeerSelf is valid for history, but Grammers get_messages_by_id filters
    // by the concrete returned peer ID. Its sentinel ID cannot match Saved Messages.
    let id = account
        .0
        .strip_prefix("tg_")
        .and_then(|id| id.parse::<i64>().ok())
        .and_then(PeerId::user)
        .ok_or_else(|| AuthError::new("invalid_account"))?;
    Ok(id.to_ambient_ref())
}
impl CloudWorkspace {
    fn peer(&self, account: &AccountId, peer: &str, revision: u64) -> Result<PeerRef, AuthError> {
        if peer == "me" {
            return self_peer(account);
        }
        let mut state = self.state.lock();
        state.refresh(revision)?;
        state
            .peers
            .get(&(account.0.clone(), peer.into()))
            .copied()
            .ok_or_else(|| AuthError::new("cloud_location_missing"))
    }

    pub async fn list_dialogs(
        &self,
        auth: &AuthEngine,
        account: AccountId,
        cursor: Option<String>,
    ) -> Result<CloudDialogPage, AuthError> {
        let revision = auth.cloud_revision();
        let owner = account.clone();
        auth.cloud_request(&owner, |client| async move {
            let mut iter = {
                let mut state = self.state.lock();
                state.refresh(revision)?;
                match cursor {
                    Some(cursor) => {
                        let slot = state
                            .cursors
                            .remove(&cursor)
                            .ok_or_else(|| AuthError::new("cloud_cursor_expired"))?;
                        if slot.account != account || slot.revision != revision {
                            return Err(AuthError::new("cloud_cursor_expired"));
                        }
                        slot.iter
                    }
                    None => client.iter_dialogs(),
                }
            };
            let mut items = Vec::new();
            let mut peers = Vec::new();
            for _ in 0..PAGE_SIZE {
                let Some(dialog) = iter.next().await.map_err(map_rpc)? else {
                    break;
                };
                let id = dialog.peer_id().bot_api_dialog_id_unchecked().to_string();
                let kind = match dialog.peer() {
                    Peer::User(_) => "user",
                    Peer::Channel(_) => "channel",
                    Peer::Group(_) => "group",
                };
                items.push(CloudDialog {
                    id: id.clone(),
                    title: dialog.peer().name().unwrap_or("").into(),
                    kind: kind.into(),
                });
                peers.push(((account.0.clone(), id), dialog.peer_ref()));
            }
            let next_cursor = (items.len() == PAGE_SIZE).then(token);
            let mut state = self.state.lock();
            if state.revision != revision || auth.cloud_revision() != revision {
                return Err(AuthError::new("account_changed"));
            }
            state.peers.extend(peers);
            if let Some(next) = &next_cursor {
                // Bound retained iterator buffers; active cursors must be refreshed after expiry.
                if state.cursors.len() >= 16 {
                    state.cursors.clear();
                }
                state.cursors.insert(
                    next.clone(),
                    DialogCursor {
                        account: account.clone(),
                        revision,
                        created: Instant::now(),
                        iter,
                    },
                );
            }
            Ok(CloudDialogPage {
                account_id: account.0.clone(),
                items,
                next_cursor,
            })
        })
        .await
    }

    pub async fn list_media(
        &self,
        auth: &AuthEngine,
        account: AccountId,
        peer_id: String,
        before_message_id: i32,
        query: String,
    ) -> Result<CloudMediaPage, AuthError> {
        if before_message_id < 0 || query.len() > 512 {
            return Err(AuthError::new("invalid_cloud_query"));
        }
        let peer = self.peer(&account, &peer_id, auth.cloud_revision())?;
        let owner = account.clone();
        auth.cloud_request(&owner, |client| async move {
            let mut items = Vec::new();
            let mut scanned = 0;
            let mut last = None;
            if query.trim().is_empty() {
                let mut iter = client
                    .iter_messages(peer)
                    .offset_id(before_message_id)
                    .limit(HISTORY_SCAN);
                while let Some(message) = iter.next().await.map_err(map_rpc)? {
                    scanned += 1;
                    last = Some(message.id());
                    if let Some(item) = metadata::from_message(&message) {
                        items.push(item);
                    }
                }
            } else {
                let mut iter = client
                    .search_messages(peer)
                    .offset_id(before_message_id)
                    .query(query.trim())
                    .limit(HISTORY_SCAN);
                while let Some(message) = iter.next().await.map_err(map_rpc)? {
                    scanned += 1;
                    last = Some(message.id());
                    if let Some(item) = metadata::from_message(&message) {
                        items.push(item);
                    }
                }
            }
            Ok(CloudMediaPage {
                account_id: account.0.clone(),
                peer_id,
                items,
                next_offset: if scanned == HISTORY_SCAN { last } else { None },
            })
        })
        .await
    }

    pub async fn open_stream(
        &self,
        auth: &AuthEngine,
        account: AccountId,
        peer_id: String,
        message_id: i32,
    ) -> Result<CloudStream, AuthError> {
        if message_id <= 0 {
            return Err(AuthError::new("invalid_cloud_message"));
        }
        let revision = auth.cloud_revision();
        let peer = self.peer(&account, &peer_id, revision)?;
        let owner = account.clone();
        auth.cloud_request(&owner, |client| async move {
            let mut messages = client
                .get_messages_by_id(peer, &[message_id])
                .await
                .map_err(map_rpc)?;
            let message = messages
                .pop()
                .flatten()
                .ok_or_else(|| AuthError::new("cloud_message_missing"))?;
            let info = metadata::from_message(&message)
                .ok_or_else(|| AuthError::new("cloud_media_unsupported"))?;
            let media = message
                .media()
                .ok_or_else(|| AuthError::new("cloud_message_missing"))?;
            let descriptor = CloudStream {
                id: token(),
                account_id: account.0.clone(),
                peer_id,
                message_id,
                size: info.size,
                mime_type: info.mime_type,
            };
            let mut state = self.state.lock();
            state.refresh(revision)?;
            if auth.cloud_revision() != revision {
                return Err(AuthError::new("account_changed"));
            }
            if state.streams.len() >= 8 {
                return Err(AuthError::new("cloud_stream_limit"));
            }
            state.streams.insert(
                descriptor.id.clone(),
                Arc::new(StreamEntry {
                    descriptor: descriptor.clone(),
                    revision,
                    media,
                    cancel: CancellationToken::new(),
                    touched: Mutex::new(Instant::now()),
                }),
            );
            Ok(descriptor)
        })
        .await
    }

    pub async fn read_stream(
        &self,
        auth: &AuthEngine,
        account: AccountId,
        handle: String,
        offset: u64,
        length: u32,
    ) -> Result<Vec<u8>, AuthError> {
        let revision = auth.cloud_revision();
        let stream = {
            let mut state = self.state.lock();
            state.refresh(revision)?;
            state
                .streams
                .get(&handle)
                .cloned()
                .ok_or_else(|| AuthError::new("cloud_stream_closed"))?
        };
        if stream.descriptor.account_id != account.0 || stream.revision != revision {
            return Err(AuthError::new("account_changed"));
        }
        plan_range(stream.descriptor.size, offset, length)?;
        *stream.touched.lock() = Instant::now();
        auth.cloud_request(&account, |client| async move {
            tokio::select! {
                biased;
                _ = stream.cancel.cancelled() => Err(AuthError::new("cloud_stream_closed")),
                bytes = fetch_media_range(&client, &stream.media, stream.descriptor.size, offset, length) => bytes,
            }
        }).await
    }

    pub fn close_stream(&self, account: &AccountId, handle: &str) -> Result<(), AuthError> {
        let mut state = self.state.lock();
        if let Some(stream) = state.streams.get(handle) {
            if stream.descriptor.account_id != account.0 {
                return Err(AuthError::new("account_changed"));
            }
            stream.cancel.cancel();
            state.streams.remove(handle);
        }
        Ok(())
    }

    pub async fn fetch_thumbnails(
        &self,
        auth: &AuthEngine,
        account: AccountId,
        peer_id: String,
        message_ids: Vec<i32>,
        quality: &str,
    ) -> Result<Vec<CloudThumbnailItem>, AuthError> {
        let quality: ThumbnailQuality = quality.parse()?;
        if quality == ThumbnailQuality::Saver {
            return Ok(Vec::new());
        }
        let bounded_ids: Vec<i32> = message_ids
            .into_iter()
            .filter(|&id| id > 0)
            .take(MAX_THUMBNAIL_BATCH)
            .collect();
        if bounded_ids.is_empty() {
            return Ok(Vec::new());
        }
        let peer = self.peer(&account, &peer_id, auth.cloud_revision())?;
        let owner = account.clone();
        auth.cloud_request(&owner, |client| async move {
            let messages = client
                .get_messages_by_id(peer, &bounded_ids)
                .await
                .map_err(map_rpc)?;
            let mut results = Vec::new();
            for maybe_msg in messages.into_iter().flatten() {
                let msg_id = maybe_msg.id();
                if let Some(media) = maybe_msg.media() {
                    if let Ok(Some(bytes)) = thumbnail::fetch_thumbnail(&client, &media, quality).await {
                        results.push(CloudThumbnailItem {
                            message_id: msg_id,
                            thumbnail_bytes: bytes,
                        });
                    }
                }
            }
            Ok(results)
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saved_messages_use_verified_concrete_identity_not_input_self_sentinel() {
        let peer = self_peer(&AccountId("tg_12345".into())).unwrap();
        assert_eq!(peer.id, PeerId::user(12345).unwrap());
        assert_ne!(peer.id, PeerId::self_user());
        for value in ["", "tg_0", "tg_-1", "tg_x", "12345"] {
            assert!(self_peer(&AccountId(value.into())).is_err());
        }
    }
    #[test]
    fn stale_revision_cannot_roll_back_cache_or_publish_old_peers() {
        let mut state = State::default();
        state.refresh(4).unwrap();
        assert_eq!(state.refresh(3).unwrap_err().code, "account_changed");
        assert_eq!(state.revision, 4);
    }
    #[test]
    fn only_owner_may_close_stream_and_repeated_close_is_safe() {
        let workspace = CloudWorkspace::default();
        assert!(workspace
            .close_stream(&AccountId("tg_1".into()), "absent")
            .is_ok());
    }
}
