//! MTProto visual-album transport. Every chunk and send remains pinned to one account.
use crate::{
    telegram::auth::{map_rpc, AccountId, AuthEngine, RpcDomain},
    transfer::{
        cloud_album::{
            AlbumCommitJournal, AlbumUploadError, AlbumUploadReceipt, AlbumUploadRequest,
            AlbumUploadTransport,
        },
        cloud_upload::{CloudUploadTransport, UPLOAD_PART_BYTES},
    },
};
use async_trait::async_trait;
use grammers_client::{media::Media, tl};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub struct TelegramAlbumUploadTransport<'a> {
    inner: super::transport::TelegramUploadTransport<'a>,
}

impl<'a> TelegramAlbumUploadTransport<'a> {
    pub async fn connect(
        auth: &'a AuthEngine,
        scope: crate::transfer::cloud_download::AccountScope,
        cancel: CancellationToken,
    ) -> Result<Self, AlbumUploadError> {
        let inner = super::transport::TelegramUploadTransport::connect(auth, scope, cancel)
            .await
            .map_err(AlbumUploadError::from)?;
        Ok(Self { inner })
    }

    async fn verify_exact(
        &self,
        request: &AlbumUploadRequest,
        message_ids: Vec<i32>,
        response_group: Option<i64>,
    ) -> Result<AlbumUploadReceipt, AlbumUploadError> {
        if message_ids.len() != request.items.len()
            || message_ids.iter().any(|id| *id <= 0)
            || message_ids.iter().collect::<std::collections::HashSet<_>>().len() != message_ids.len()
        { return Err(AlbumUploadError::ReviewRequired); }
        let peer = self.inner.peer(&request.destination).await.map_err(AlbumUploadError::from)?;
        let account = AccountId(self.scope().account_id().to_owned());
        let exact_ids = message_ids.clone();
        let cancel = self.inner.cancel.clone();
        let read_cancel = cancel.clone();
        let messages = self.inner.auth.account_request_scoped(&account, &[RpcDomain::Messages], &cancel,
            |client| async move {
                tokio::select! { biased;
                    _ = read_cancel.cancelled() => Err(crate::telegram::auth::AuthError::new("operation_cancelled")),
                    result = client.get_messages_by_id(peer, &exact_ids) => result.map_err(map_rpc),
                }
            }).await.map_err(map_album_auth)?;
        if messages.len() != message_ids.len() || messages.iter().any(Option::is_none) {
            return Err(AlbumUploadError::ReviewRequired);
        }
        let mut grouped_id = response_group;
        for (index, maybe_message) in messages.into_iter().enumerate() {
            let message = maybe_message.ok_or(AlbumUploadError::ReviewRequired)?;
            super::receipt::validate_receipt_scope(&request.destination, peer.id, message.peer_id(),
                message_ids[index], message.id(), message.reply_header().as_ref()).map_err(map_album_auth)?;
            if !matches!(message.media(), Some(Media::Photo(_))) { return Err(AlbumUploadError::ReviewRequired); }
            let Some(actual_group) = message.grouped_id() else { return Err(AlbumUploadError::ReviewRequired); };
            match grouped_id {
                Some(expected) if expected != actual_group => return Err(AlbumUploadError::ReviewRequired),
                None => grouped_id = Some(actual_group),
                _ => {}
            }
        }
        let grouped_id = grouped_id.filter(|id| *id != 0).ok_or(AlbumUploadError::ReviewRequired)?;
        Ok(AlbumUploadReceipt { destination: request.destination.clone(), grouped_id, message_ids })
    }
}

#[async_trait]
impl AlbumUploadTransport for TelegramAlbumUploadTransport<'_> {
    fn scope(&self) -> &crate::transfer::cloud_download::AccountScope {
        self.inner.scope()
    }

    async fn validate_destination(
        &self,
        request: &AlbumUploadRequest,
    ) -> Result<(), AlbumUploadError> {
        request.validate()?;
        self.inner
            .validate_destination(&request.destination)
            .await
            .map_err(AlbumUploadError::from)
    }

    async fn save_part(
        &self,
        request: &AlbumUploadRequest,
        item_index: usize,
        file_id: i64,
        part_index: usize,
        bytes: Vec<u8>,
    ) -> Result<(), AlbumUploadError> {
        let item = request
            .items
            .get(item_index)
            .ok_or(AlbumUploadError::InvalidRequest)?;
        if request.destination.scope != *self.scope()
            || file_id == 0
            || bytes.is_empty()
            || bytes.len() > UPLOAD_PART_BYTES
            || part_index >= item.source.parts()
        {
            return Err(AlbumUploadError::InvalidRequest);
        }
        let expected = (item.source.size - part_index as u64 * UPLOAD_PART_BYTES as u64)
            .min(UPLOAD_PART_BYTES as u64) as usize;
        if bytes.len() != expected
            || hex::encode(Sha256::digest(&bytes)) != item.source.part_sha256[part_index]
        {
            return Err(AlbumUploadError::SourceChanged);
        }
        let account = AccountId(self.scope().account_id().to_owned());
        let big = item.source.size > 10 * 1024 * 1024;
        self.inner
            .auth
            .account_request_scoped(
                &account,
                &[RpcDomain::UploadParts],
                &self.inner.cancel,
                |client| async move {
                    let result = if big {
                        client
                            .invoke(&tl::functions::upload::SaveBigFilePart {
                                file_id,
                                file_part: part_index as i32,
                                file_total_parts: item.source.parts() as i32,
                                bytes,
                            })
                            .await
                    } else {
                        client
                            .invoke(&tl::functions::upload::SaveFilePart {
                                file_id,
                                file_part: part_index as i32,
                                bytes,
                            })
                            .await
                    }
                    .map_err(map_rpc)?;
                    if !result {
                        return Err(crate::telegram::auth::AuthError::new(
                            "upload_part_rejected",
                        ));
                    }
                    Ok(())
                },
            )
            .await
            .map_err(map_album_auth)
    }

    async fn send_album(
        &self,
        request: &AlbumUploadRequest,
        file_ids: &[i64],
        journal: &dyn AlbumCommitJournal,
    ) -> Result<AlbumUploadReceipt, AlbumUploadError> {
        request.validate()?;
        if request.destination.scope != *self.scope()
            || file_ids.len() != request.items.len()
            || file_ids.iter().any(|id| *id == 0)
        {
            return Err(AlbumUploadError::WrongScope);
        }
        let peer = self
            .inner
            .peer(&request.destination)
            .await
            .map_err(AlbumUploadError::from)?;
        let mut media = Vec::with_capacity(request.items.len());
        for (index, (item, file_id)) in request.items.iter().zip(file_ids).enumerate() {
            let file = input_file(item, *file_id)?;
            let raw = tl::types::InputMediaUploadedPhoto {
                file,
                stickers: None,
                ttl_seconds: None,
                live_photo: false,
                video: None,
                spoiler: request.profile.spoiler,
            };
            let account = AccountId(self.scope().account_id().to_owned());
            let registered = self
                .inner
                .auth
                .account_request_scoped(
                    &account,
                    &[RpcDomain::Files],
                    &self.inner.cancel,
                    |client| async move {
                        client
                            .invoke(&tl::functions::messages::UploadMedia {
                                business_connection_id: None,
                                peer: peer.into(),
                                media: raw.into(),
                            })
                            .await
                            .map_err(map_rpc)
                    },
                )
                .await
                .map_err(map_album_auth)?;
            let input = Media::from_raw(registered)
                .and_then(|value| value.to_raw_input_media())
                .ok_or(AlbumUploadError::ReviewRequired)?;
            media.push(tl::enums::InputSingleMedia::Media(
                tl::types::InputSingleMedia {
                    media: input,
                    random_id: item.random_id,
                    message: request.item_caption(index).unwrap_or_default().to_owned(),
                    entities: None,
                },
            ));
        }
        let reply_to = request.destination.topic_id.map(|topic| {
            tl::types::InputReplyToMessage {
                reply_to_msg_id: topic,
                top_msg_id: Some(topic),
                reply_to_peer_id: None,
                quote_text: None,
                quote_entities: None,
                quote_offset: None,
                monoforum_peer_id: None,
                todo_item_id: None,
                poll_option: None,
            }
            .into()
        });
        let send = tl::functions::messages::SendMultiMedia {
            silent: request.profile.silent,
            background: false,
            clear_draft: false,
            peer: peer.into(),
            reply_to,
            schedule_date: None,
            multi_media: media,
            send_as: None,
            noforwards: false,
            update_stickersets_order: false,
            invert_media: false,
            quick_reply_shortcut: None,
            effect: None,
            allow_paid_floodskip: false,
            allow_paid_stars: None,
        };
        let account = AccountId(self.scope().account_id().to_owned());
        let mut updates = None;
        for attempt in 0..3u64 {
            let result = self
                .inner
                .auth
                .account_request_scoped(
                    &account,
                    &[RpcDomain::SendMessages],
                    &self.inner.cancel,
                    |client| {
                        let send = send.clone();
                        async move { client.invoke(&send).await.map_err(map_rpc) }
                    },
                )
                .await;
            match result {
                Ok(value) => {
                    updates = Some(value);
                    break;
                }
                Err(error) if error.code == "network_error" || error.code == "network_timeout" => {
                    if attempt == 2 {
                        break;
                    }
                    tokio::select! { _ = self.inner.cancel.cancelled() => return Err(AlbumUploadError::Cancelled),
                    _ = tokio::time::sleep(Duration::from_millis(750 * (attempt + 1))) => {} }
                }
                Err(error) => return Err(map_album_auth(error)),
            }
        }
        let updates = updates.ok_or(AlbumUploadError::Network)?;
        let (message_ids, response_group) = map_album_updates(&request.items, updates)?;
        for (index, message_id) in message_ids.iter().copied().enumerate() {
            journal.record_message_id(index, message_id)?;
        }
        self.verify_exact(request, message_ids, response_group).await
    }

    async fn reconcile_album(
        &self,
        request: &AlbumUploadRequest,
        message_ids: &[i32],
    ) -> Result<AlbumUploadReceipt, AlbumUploadError> {
        request.validate()?;
        if request.destination.scope != *self.scope() { return Err(AlbumUploadError::WrongScope); }
        self.verify_exact(request, message_ids.to_vec(), None).await
    }
}

fn input_file(
    item: &crate::transfer::cloud_album::AlbumUploadItem,
    file_id: i64,
) -> Result<tl::enums::InputFile, AlbumUploadError> {
    if item.source.size > 10 * 1024 * 1024 {
        Ok(tl::types::InputFileBig {
            id: file_id,
            parts: item.source.parts() as i32,
            name: item.filename.clone(),
        }
        .into())
    } else {
        Ok(tl::types::InputFile {
            id: file_id,
            parts: item.source.parts() as i32,
            name: item.filename.clone(),
            md5_checksum: item.source.md5.clone(),
        }
        .into())
    }
}

fn map_album_updates(
    items: &[crate::transfer::cloud_album::AlbumUploadItem],
    updates: tl::enums::Updates,
) -> Result<(Vec<i32>, Option<i64>), AlbumUploadError> {
    let list = match updates {
        tl::enums::Updates::Updates(value) => value.updates,
        tl::enums::Updates::Combined(value) => value.updates,
        _ => return Err(AlbumUploadError::ReviewRequired),
    };
    let mut ids = std::collections::HashMap::new();
    let mut grouped = None;
    for update in list {
        match update {
            tl::enums::Update::MessageId(value) if value.id > 0 => {
                if ids
                    .insert(value.random_id, value.id)
                    .is_some_and(|old| old != value.id)
                {
                    return Err(AlbumUploadError::ReviewRequired);
                }
            }
            tl::enums::Update::NewMessage(value) => {
                if let tl::enums::Message::Message(message) = value.message {
                    if let Some(id) = message.grouped_id {
                        if grouped.is_some_and(|old| old != id) {
                            return Err(AlbumUploadError::ReviewRequired);
                        }
                        grouped = Some(id);
                    }
                }
            }
            tl::enums::Update::NewChannelMessage(value) => {
                if let tl::enums::Message::Message(message) = value.message {
                    if let Some(id) = message.grouped_id {
                        if grouped.is_some_and(|old| old != id) {
                            return Err(AlbumUploadError::ReviewRequired);
                        }
                        grouped = Some(id);
                    }
                }
            }
            _ => {}
        }
    }
    let random_ids = items.iter().map(|item| item.random_id).collect::<Vec<_>>();
    let resolved = resolve_album_message_ids(&random_ids, &ids)?;
    Ok((resolved, grouped))
}

fn resolve_album_message_ids(
    random_ids: &[i64],
    mapped: &std::collections::HashMap<i64, i32>,
) -> Result<Vec<i32>, AlbumUploadError> {
    let resolved = random_ids.iter().map(|random_id| {
        mapped.get(random_id).copied().filter(|id| *id > 0)
            .ok_or(AlbumUploadError::ReviewRequired)
    }).collect::<Result<Vec<_>, _>>()?;
    if resolved.iter().collect::<std::collections::HashSet<_>>().len() != resolved.len() {
        return Err(AlbumUploadError::ReviewRequired);
    }
    Ok(resolved)
}

fn map_album_auth(error: crate::telegram::auth::AuthError) -> AlbumUploadError {
    match error.code.as_str() {
        "operation_cancelled" => AlbumUploadError::Cancelled,
        "network_error" | "network_timeout" => AlbumUploadError::Network,
        "upload_part_rejected" => AlbumUploadError::Rejected,
        "not_authorized" | "account_mismatch" => AlbumUploadError::WrongScope,
        _ => AlbumUploadError::Rejected,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn album_message_mapping_requires_each_exact_random_id_and_unique_server_id() {
        let random_ids = [101, 202, 303];
        let mapped = [(303, 803), (101, 801), (202, 802)].into_iter().collect();
        assert_eq!(resolve_album_message_ids(&random_ids, &mapped).unwrap(), vec![801, 802, 803]);
        assert_eq!(resolve_album_message_ids(&random_ids, &[(101, 801), (202, 802)].into_iter().collect()).unwrap_err(),
            AlbumUploadError::ReviewRequired);
        assert_eq!(resolve_album_message_ids(&random_ids, &[(101, 801), (202, 801), (303, 803)].into_iter().collect()).unwrap_err(),
            AlbumUploadError::ReviewRequired);
    }
}
