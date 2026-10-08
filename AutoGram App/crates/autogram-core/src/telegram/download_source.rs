//! Real account-pinned Grammers source for durable downloads. No UI selection lease.
use super::{auth::{AccountId, AuthEngine, AuthError, RpcDomain, map_rpc}, cloud::fetch_media_range};
use crate::transfer::cloud_download::{AccountScope, CloudByteRangeSource,
    CloudDownloadIdentity, PeerKind, RangeChunk, RemoteObject, SourceFailure};
use async_trait::async_trait;
use grammers_client::{media::Media, message::Message, tl};
use grammers_session::types::PeerId;
use parking_lot::Mutex;
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

pub struct TelegramDownloadSource<'a> {
    auth: &'a AuthEngine,
    scope: AccountScope,
    cancel: CancellationToken,
    media_cache: Mutex<Vec<(CloudDownloadIdentity, Media)>>,
}

impl<'a> TelegramDownloadSource<'a> {
    /// Always verify the server identity; disk inventory is not authorization.
    pub async fn connect(auth: &'a AuthEngine, scope: AccountScope,
        cancel: CancellationToken) -> Result<Self, SourceFailure> {
        if cancel.is_cancelled() { return Err(SourceFailure::Network); }
        let identity = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(SourceFailure::Network),
            result = auth.authorize_job_account(AccountId(scope.account_id().into())) => result.map_err(source_error)?,
        };
        if !identity.verified || identity.user_id != scope.authorized_user_id()
            || identity.id.0 != scope.account_id() { return Err(SourceFailure::WrongScope); }
        Ok(Self { auth, scope, cancel, media_cache: Mutex::new(Vec::new()) })
    }

    fn store_cached_media(&self, identity: &CloudDownloadIdentity, media: Media) {
        let mut cache = self.media_cache.lock();
        if let Some((_, existing)) = cache.iter_mut().find(|(id, _)| id == identity) {
            *existing = media;
            return;
        }
        if cache.len() >= 8 {
            cache.remove(0);
        }
        cache.push((identity.clone(), media));
    }

    /// Derive the immutable job identity from a real message, never from UI names/URLs.
    pub async fn target(&self, kind: PeerKind, peer_id: i64, topic_id: Option<i32>,
        message_id: i32) -> Result<CloudDownloadIdentity, SourceFailure> {
        let message = self.message(kind, peer_id, topic_id, message_id).await?;
        let media = message.media().ok_or(SourceFailure::NotFound)?;
        let identity = media_identity(self.scope.clone(), kind, peer_id, topic_id, message_id, &media)?;
        self.store_cached_media(&identity, media);
        Ok(identity)
    }

    pub async fn target_dialog(&self, dialog: &str, topic: Option<i32>, message: i32)
        -> Result<CloudDownloadIdentity, SourceFailure> {
        let peer = if dialog == "me" { PeerId::user(self.scope.authorized_user_id()) }
            else { dialog.parse().ok().and_then(PeerId::from_bot_api_dialog_id) }
            .ok_or(SourceFailure::WrongScope)?;
        let kind = match peer.kind() {
            grammers_session::types::PeerKind::User => PeerKind::User,
            grammers_session::types::PeerKind::Chat => PeerKind::Chat,
            grammers_session::types::PeerKind::Channel => PeerKind::Channel,
        };
        self.target(kind, peer.bare_id_unchecked(), topic, message).await
    }

    async fn message(&self, kind: PeerKind, peer_id: i64, topic_id: Option<i32>,
        message_id: i32) -> Result<Message, SourceFailure> {
        if message_id <= 0 || topic_id.is_some_and(|v| v <= 0) { return Err(SourceFailure::NotFound); }
        let peer = peer_id_for(kind, peer_id)?;
        let account = AccountId(self.scope.account_id().into());
        let reference = self.auth.job_peer(&account, peer, &self.cancel).await.map_err(source_error)?;
        self.auth.account_request_scoped(&account, &[RpcDomain::Messages], &self.cancel, |client| async move {
            let mut messages = client
                .get_messages_by_id(reference, &[message_id])
                .await
                .map_err(|e| map_rpc(e).for_rpc(RpcDomain::Messages))?;
            let message = messages.pop().flatten().ok_or_else(|| AuthError::new("cloud_message_missing"))?;
            let thread = match message.reply_header() {
                Some(tl::enums::MessageReplyHeader::Header(header)) => header.reply_to_top_id.or(header.reply_to_msg_id),
                _ => None,
            };
            if topic_id.is_some_and(|topic| !topic_matches(message.id(), thread, topic)) {
                return Err(AuthError::new("account_scope_changed"));
            }
            Ok(message)
        }).await.map_err(source_error)
    }

    async fn verified_media(&self, identity: &CloudDownloadIdentity) -> Result<Media, SourceFailure> {
        if identity.scope() != &self.scope { return Err(SourceFailure::WrongScope); }
        let message = self.message(identity.peer_kind(), identity.peer_id(), identity.topic_id(), identity.message_id()).await?;
        let media = message.media().ok_or(SourceFailure::NotFound)?;
        let current = media_identity(self.scope.clone(), identity.peer_kind(), identity.peer_id(),
            identity.topic_id(), identity.message_id(), &media)?;
        if current != *identity { return Err(SourceFailure::IdentityChanged); }
        self.store_cached_media(identity, media.clone());
        Ok(media)
    }

    async fn cached_or_verified_media(&self, identity: &CloudDownloadIdentity) -> Result<Media, SourceFailure> {
        if identity.scope() != &self.scope { return Err(SourceFailure::WrongScope); }
        let cached = self
            .media_cache
            .lock()
            .iter()
            .find(|(id, _)| id == identity)
            .map(|(_, media)| media.clone());
        if let Some(media) = cached {
            return Ok(media);
        }
        self.verified_media(identity).await
    }
}

#[async_trait]
impl CloudByteRangeSource for TelegramDownloadSource<'_> {
    fn scope(&self) -> &AccountScope { &self.scope }

    async fn describe(&self, identity: &CloudDownloadIdentity) -> Result<RemoteObject, SourceFailure> {
        self.cached_or_verified_media(identity).await?;
        Ok(RemoteObject { identity: identity.clone(), size: identity.expected_size() })
    }

    async fn read_range(&self, identity: &CloudDownloadIdentity, offset: u64,
        length: usize) -> Result<RangeChunk, SourceFailure> {
        if length == 0 || length > 512 * 1024 || offset.checked_add(length as u64)
            .is_none_or(|end| end > identity.expected_size()) { return Err(SourceFailure::Network); }
        let mut media = self.cached_or_verified_media(identity).await?;
        let account = AccountId(self.scope.account_id().into());
        let mut bytes = Vec::with_capacity(length);
        while bytes.len() < length {
            let part_offset = offset + bytes.len() as u64;
            let part_length = (length - bytes.len()).min(256 * 1024) as u32;
            let mut refreshed = false;
            let part = loop {
                let result = self.auth.account_request_scoped(&account, &[RpcDomain::Files], &self.cancel, |client| {
                    let media = media.clone();
                    async move { fetch_media_range(&client, &media, identity.expected_size(), part_offset, part_length).await }
                }).await;
                match result {
                    Err(error) if error.code == "file_reference_expired" && !refreshed => {
                        // Refresh transport capability only; edits cannot change the job identity.
                        media = self.verified_media(identity).await?;
                        refreshed = true;
                    }
                    other => break other.map_err(source_error)?,
                }
            };
            if part.len() != part_length as usize { return Err(SourceFailure::Network); }
            bytes.extend(part);
        }
        Ok(RangeChunk { object: RemoteObject { identity: identity.clone(), size: identity.expected_size() }, offset, bytes })
    }
}

fn peer_id_for(kind: PeerKind, id: i64) -> Result<PeerId, SourceFailure> {
    match kind { PeerKind::User => PeerId::user(id), PeerKind::Chat => PeerId::chat(id),
        PeerKind::Channel => PeerId::channel(id) }.ok_or(SourceFailure::WrongScope)
}

fn topic_matches(message: i32, thread: Option<i32>, topic: i32) -> bool {
    message == topic || thread == Some(topic)
}

fn fingerprint(kind: &str, media_id: i64, rendition: &str, size: u64) -> String {
    hex::encode(Sha256::digest(format!("v1:{kind}:{media_id}:{rendition}:{size}")))
}

fn media_identity(scope: AccountScope, kind: PeerKind, peer: i64, topic: Option<i32>,
    message: i32, media: &Media) -> Result<CloudDownloadIdentity, SourceFailure> {
    let (family, id, rendition, size) = match media {
        Media::Photo(photo) => {
            let thumb = photo.thumbs().into_iter().max_by_key(|t| t.size()).ok_or(SourceFailure::NotFound)?;
            ("photo", photo.id(), thumb.photo_type(), thumb.size() as u64)
        }
        Media::Document(document) => ("document", document.id(), "original".into(),
            document.size().ok_or(SourceFailure::NotFound)? as u64),
        Media::Sticker(sticker) => ("document", sticker.document.id(), "original".into(),
            sticker.document.size().ok_or(SourceFailure::NotFound)? as u64),
        _ => return Err(SourceFailure::NotFound),
    };
    let stable = fingerprint(family, id, &rendition, size);
    CloudDownloadIdentity::new(scope, kind, peer, topic, message, id, rendition, stable, size)
        .map_err(|_| SourceFailure::IdentityChanged)
}

fn source_error(error: AuthError) -> SourceFailure {
    match error.code.as_str() {
        "not_authorized" => SourceFailure::Unauthorized,
        "account_mismatch" | "account_scope_changed" => SourceFailure::WrongScope,
        "cloud_message_missing" | "cloud_location_missing" => SourceFailure::NotFound,
        "flood_wait" => SourceFailure::FloodWait { retry_after_ms: u64::from(error.retry_after_seconds) * 1000 },
        _ => SourceFailure::Network,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fingerprint_binds_family_rendition_size_not_transport_secret() {
        let first = fingerprint("photo", 27, "x", 8192);
        assert_eq!(first.len(), 64);
        assert_ne!(first, fingerprint("photo", 27, "y", 8192));
        assert_ne!(first, fingerprint("photo", 27, "x", 8193));
        assert_ne!(first, fingerprint("document", 27, "x", 8192));
    }
    #[test]
    fn topic_root_and_children_are_explicit() {
        assert!(topic_matches(20, None, 20));
        assert!(topic_matches(21, Some(20), 20));
        assert!(!topic_matches(21, Some(19), 20));
        assert!(!topic_matches(21, None, 20));
    }
    #[test]
    fn saved_messages_uses_concrete_user_not_sentinel() {
        assert_eq!(peer_id_for(PeerKind::User, 123).unwrap(), PeerId::user(123).unwrap());
        assert!(peer_id_for(PeerKind::User, 0).is_err());
    }
    #[test]
    fn failures_are_structured_and_wait_is_preserved() {
        assert_eq!(source_error(AuthError::wait(19)), SourceFailure::FloodWait { retry_after_ms: 19000 });
        assert_eq!(source_error(AuthError::new("not_authorized")), SourceFailure::Unauthorized);
        assert_eq!(source_error(AuthError::new("account_mismatch")), SourceFailure::WrongScope);
    }
}
