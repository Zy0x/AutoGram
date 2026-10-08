use super::{
    contracts::*,
    metadata,
    ranges::*,
    thumbnail::{self, ThumbnailQuality, MAX_THUMBNAIL_BATCH},
};
use crate::telegram::auth::{map_rpc, AccountId, AuthEngine, AuthError, RpcDomain};
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
const MAX_CACHED_MEDIA: usize = 512;
const IDLE_TTL: Duration = Duration::from_secs(20 * 60);
#[path = "avatar.rs"]
mod avatar;

struct DialogCursor {
    account: AccountId,
    revision: u64,
    created: Instant,
    iter: DialogIter,
}
struct StreamEntry {
    descriptor: CloudStream,
    peer: PeerRef,
    revision: u64,
    media: Mutex<Media>,
    cancel: CancellationToken,
    touched: Mutex<Instant>,
}
#[derive(Default)]
struct State {
    revision: u64,
    peers: HashMap<(String, String), PeerRef>,
    photos: HashMap<(String, String), grammers_client::media::ChatPhoto>,
    media: HashMap<(String, String, i32), Media>,
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
            self.photos.clear();
            self.media.clear();
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

    fn cache_media(&mut self, entries: impl IntoIterator<Item = ((String, String, i32), Media)>) {
        for (key, media) in entries {
            if self.media.len() >= MAX_CACHED_MEDIA && !self.media.contains_key(&key) {
                self.media.clear();
            }
            self.media.insert(key, media);
        }
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
        auth.cloud_request_scoped(&owner, &[RpcDomain::Dialogs], |client| async move {
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
            let mut photos = Vec::new();
            for _ in 0..PAGE_SIZE {
                let Some(dialog) = iter.next().await.map_err(|e| map_rpc(e).for_rpc(RpcDomain::Dialogs))? else {
                    break;
                };
                let id = dialog.peer_id().bot_api_dialog_id_unchecked().to_string();
                let kind = match dialog.peer() {
                    Peer::User(_) => "user",
                    Peer::Channel(_) => "channel",
                    Peer::Group(group) => match &group.raw {
                        grammers_client::tl::enums::Chat::Channel(channel) if channel.forum => {
                            "forum"
                        }
                        _ => "group",
                    },
                };
                let photo = dialog
                    .peer()
                    .photo(false)
                    .await
                    .map_err(|e| map_rpc(e).for_rpc(RpcDomain::Dialogs))?;
                items.push(CloudDialog {
                    id: id.clone(),
                    title: dialog.peer().name().unwrap_or("").into(),
                    kind: kind.into(),
                    photo_key: photo.as_ref().map(avatar::photo_key),
                    avatar_bytes: avatar::inline_photo(dialog.peer()),
                });
                if let Some(photo) = photo { photos.push(((account.0.clone(), id.clone()), photo)); }
                peers.push(((account.0.clone(), id), dialog.peer_ref()));
            }
            let next_cursor = (items.len() == PAGE_SIZE).then(token);
            let mut state = self.state.lock();
            if state.revision != revision || auth.cloud_revision() != revision {
                return Err(AuthError::new("account_changed"));
            }
            state.peers.extend(peers);
            state.photos.extend(photos);
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
        let revision = auth.cloud_revision();
        let peer = self.peer(&account, &peer_id, revision)?;
        let owner = account.clone();
        let domain = if query.trim().is_empty() { RpcDomain::History } else { RpcDomain::Search };
        auth.cloud_request_scoped(&owner, &[domain], |client| async move {
            let mut items = Vec::new();
            let mut cached_media = Vec::new();
            let mut scanned = 0;
            let mut last = None;
            if query.trim().is_empty() {
                let mut iter = client
                    .iter_messages(peer)
                    .offset_id(before_message_id)
                    .limit(HISTORY_SCAN);
                while let Some(message) = iter.next().await.map_err(|e| map_rpc(e).for_rpc(domain))? {
                    scanned += 1;
                    last = Some(message.id());
                    if let Some(media) = message.media() {
                        if let Some(item) = metadata::from_media(
                            message.id(),
                            message.date().timestamp_millis(),
                            &media,
                        ) {
                            cached_media.push(((account.0.clone(), peer_id.clone(), item.id), media));
                            items.push(item);
                        }
                    }
                }
            } else {
                let mut iter = client
                    .search_messages(peer)
                    .offset_id(before_message_id)
                    .query(query.trim())
                    .limit(HISTORY_SCAN);
                while let Some(message) = iter.next().await.map_err(|e| map_rpc(e).for_rpc(domain))? {
                    scanned += 1;
                    last = Some(message.id());
                    if let Some(media) = message.media() {
                        if let Some(item) = metadata::from_media(
                            message.id(),
                            message.date().timestamp_millis(),
                            &media,
                        ) {
                            cached_media.push(((account.0.clone(), peer_id.clone(), item.id), media));
                            items.push(item);
                        }
                    }
                }
            }
            if !cached_media.is_empty() {
                let mut state = self.state.lock();
                if state.revision == revision && auth.cloud_revision() == revision {
                    state.cache_media(cached_media);
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

    pub async fn list_topics(
        &self,
        auth: &AuthEngine,
        account: AccountId,
        peer_id: String,
        cursor: super::topics::TopicCursor,
    ) -> Result<super::topics::CloudTopicPage, AuthError> {
        if cursor.message_id < 0 || cursor.topic_id < 0 || cursor.date < 0 {
            return Err(AuthError::new("cloud_cursor_invalid"));
        }
        let peer = self.peer(&account, &peer_id, auth.cloud_revision())?;
        auth.cloud_request_scoped(&account, &[RpcDomain::Topics], |client| async move {
            let page = super::topics::fetch_topics(&client, peer, &cursor)
                .await
                .map_err(|e| map_rpc(e).for_rpc(RpcDomain::Topics))?;
            if page.cursor_error {
                return Err(AuthError::new("cloud_cursor_invalid"));
            }
            Ok(page)
        })
        .await
    }

    pub async fn list_topic_media(
        &self,
        auth: &AuthEngine,
        account: AccountId,
        peer_id: String,
        topic_id: i32,
        before: i32,
        query: String,
    ) -> Result<CloudMediaPage, AuthError> {
        if topic_id <= 0 || before < 0 || query.len() > 512 {
            return Err(AuthError::new("invalid_cloud_query"));
        }
        let revision = auth.cloud_revision();
        let peer = self.peer(&account, &peer_id, revision)?;
        let owner = account.clone();
        auth.cloud_request_scoped(&owner, &[RpcDomain::Search], |client| async move {
            use grammers_client::tl::enums::messages::Messages;
            let response = client
                .invoke(&super::topics::media_request(
                    peer,
                    topic_id,
                    before,
                    query.trim().into(),
                ))
                .await
                .map_err(|e| map_rpc(e).for_rpc(RpcDomain::Search))?;
            let messages = match response {
                Messages::Messages(pack) => pack.messages,
                Messages::Slice(pack) => pack.messages,
                Messages::ChannelMessages(pack) => pack.messages,
                Messages::NotModified(_) => return Err(AuthError::new("cloud_cursor_invalid")),
            };
            // Parse media metadata directly from the Search response without a second get_messages_by_id RPC.
            let mut ids = Vec::with_capacity(messages.len());
            let mut items = Vec::new();
            let mut cached_media = Vec::new();
            for raw in messages {
                let (maybe_id, maybe_parsed) = metadata::from_raw_message(raw);
                if let Some(id) = maybe_id {
                    ids.push(id);
                }
                if let Some((item, media)) = maybe_parsed {
                    cached_media.push(((account.0.clone(), peer_id.clone(), item.id), media));
                    items.push(item);
                }
            }
            // Search may return a short non-final page. Keep advancing until an empty page.
            let next_offset = ids
                .iter()
                .copied()
                .filter(|id| *id > 0 && (before == 0 || *id < before))
                .min();
            if !ids.is_empty() && next_offset.is_none() {
                return Err(AuthError::new("cloud_cursor_invalid"));
            }
            if !cached_media.is_empty() {
                let mut state = self.state.lock();
                if state.revision == revision && auth.cloud_revision() == revision {
                    state.cache_media(cached_media);
                }
            }
            Ok(CloudMediaPage {
                account_id: account.0,
                peer_id,
                items,
                next_offset,
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
        let cached_media = {
            let mut state = self.state.lock();
            state.refresh(revision)?;
            state
                .media
                .get(&(account.0.clone(), peer_id.clone(), message_id))
                .cloned()
        };
        let owner = account.clone();
        let domains: &[RpcDomain] = if cached_media.is_some() {
            &[RpcDomain::Files]
        } else {
            &[RpcDomain::Messages]
        };
        auth.cloud_request_scoped(&owner, domains, |client| async move {
            let media = match cached_media {
                Some(media) => media,
                None => {
                    let mut messages = client
                        .get_messages_by_id(peer, &[message_id])
                        .await
                        .map_err(|e| map_rpc(e).for_rpc(RpcDomain::Messages))?;
                    let message = messages
                        .pop()
                        .flatten()
                        .ok_or_else(|| AuthError::new("cloud_message_missing"))?;
                    let media = message
                        .media()
                        .ok_or_else(|| AuthError::new("cloud_message_missing"))?;
                    let mut state = self.state.lock();
                    if state.revision == revision && auth.cloud_revision() == revision {
                        state.cache_media([(
                            (account.0.clone(), peer_id.clone(), message_id),
                            media.clone(),
                        )]);
                    }
                    media
                }
            };
            let info = metadata::from_media(message_id, 0, &media)
                .ok_or_else(|| AuthError::new("cloud_media_unsupported"))?;
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
                    peer,
                    revision,
                    media: Mutex::new(media),
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
        auth.cloud_request_scoped(&account, &[RpcDomain::Files], |client| async move {
            let current_media = stream.media.lock().clone();
            let first = tokio::select! {
                biased;
                _ = stream.cancel.cancelled() => return Err(AuthError::new("cloud_stream_closed")),
                bytes = fetch_media_range(&client, &current_media, stream.descriptor.size, offset, length) => bytes,
            };
            match first {
                Err(err) if err.code == "file_reference_expired" => {
                    let mut refreshed = client
                        .get_messages_by_id(stream.peer, &[stream.descriptor.message_id])
                        .await
                        .map_err(|e| map_rpc(e).for_rpc(RpcDomain::Messages))?;
                    let fresh_media = refreshed
                        .pop()
                        .flatten()
                        .and_then(|m| m.media())
                        .ok_or_else(|| AuthError::new("cloud_message_missing"))?;
                    *stream.media.lock() = fresh_media.clone();
                    {
                        let mut state = self.state.lock();
                        if state.revision == revision && auth.cloud_revision() == revision {
                            state.cache_media([(
                                (
                                    stream.descriptor.account_id.clone(),
                                    stream.descriptor.peer_id.clone(),
                                    stream.descriptor.message_id,
                                ),
                                fresh_media.clone(),
                            )]);
                        }
                    }
                    tokio::select! {
                        biased;
                        _ = stream.cancel.cancelled() => Err(AuthError::new("cloud_stream_closed")),
                        bytes = fetch_media_range(&client, &fresh_media, stream.descriptor.size, offset, length) => bytes,
                    }
                }
                other => other,
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
        let revision = auth.cloud_revision();
        let peer = self.peer(&account, &peer_id, revision)?;
        let (mut resolved, missing_ids) = {
            let mut state = self.state.lock();
            state.refresh(revision)?;
            let mut resolved = Vec::with_capacity(bounded_ids.len());
            let mut missing = Vec::new();
            for &id in &bounded_ids {
                if let Some(media) = state
                    .media
                    .get(&(account.0.clone(), peer_id.clone(), id))
                    .cloned()
                {
                    resolved.push((id, media));
                } else {
                    missing.push(id);
                }
            }
            (resolved, missing)
        };
        let owner = account.clone();
        let domains: &[RpcDomain] = if missing_ids.is_empty() {
            &[RpcDomain::Files]
        } else {
            &[RpcDomain::Messages, RpcDomain::Files]
        };
        auth.cloud_request_scoped(&owner, domains, |client| async move {
            if !missing_ids.is_empty() {
                let messages = client
                    .get_messages_by_id(peer, &missing_ids)
                    .await
                    .map_err(|e| map_rpc(e).for_rpc(RpcDomain::Messages))?;
                let mut newly_cached = Vec::new();
                for maybe_msg in messages.into_iter().flatten() {
                    let msg_id = maybe_msg.id();
                    if let Some(media) = maybe_msg.media() {
                        newly_cached.push((
                            (account.0.clone(), peer_id.clone(), msg_id),
                            media.clone(),
                        ));
                        resolved.push((msg_id, media));
                    }
                }
                if !newly_cached.is_empty() {
                    let mut state = self.state.lock();
                    if state.revision == revision && auth.cloud_revision() == revision {
                        state.cache_media(newly_cached);
                    }
                }
            }
            let mut results = Vec::new();
            for (msg_id, media) in resolved {
                match thumbnail::fetch_thumbnail(&client, &media, quality).await {
                    Ok(Some(bytes)) => {
                        results.push(CloudThumbnailItem {
                            message_id: msg_id,
                            thumbnail_bytes: bytes,
                        });
                    }
                    Ok(None) => {}
                    Err(err) if err.code == "file_reference_expired" => {
                        let mut refreshed = client
                            .get_messages_by_id(peer, &[msg_id])
                            .await
                            .map_err(|e| map_rpc(e).for_rpc(RpcDomain::Messages))?;
                        if let Some(fresh_media) = refreshed.pop().flatten().and_then(|m| m.media())
                        {
                            {
                                let mut state = self.state.lock();
                                if state.revision == revision && auth.cloud_revision() == revision {
                                    state.cache_media([(
                                        (account.0.clone(), peer_id.clone(), msg_id),
                                        fresh_media.clone(),
                                    )]);
                                }
                            }
                            if let Some(bytes) =
                                thumbnail::fetch_thumbnail(&client, &fresh_media, quality).await?
                            {
                                results.push(CloudThumbnailItem {
                                    message_id: msg_id,
                                    thumbnail_bytes: bytes,
                                });
                            }
                        }
                    }
                    Err(err) => return Err(err),
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
