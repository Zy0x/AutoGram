//! Real account-pinned original-document writes. No selected preview lease or session data in SQLite.
use crate::{
    telegram::auth::{map_rpc, AccountId, AuthEngine, AuthError, RpcDomain},
    transfer::{
        cloud_download::{AccountScope, PeerKind},
        cloud_upload::*,
    },
};
use async_trait::async_trait;
use grammers_client::{tl, InvocationError};
use grammers_session::types::{PeerId, PeerRef};
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

pub struct TelegramUploadTransport<'a> {
    pub(super) auth: &'a AuthEngine,
    pub(super) scope: AccountScope,
    pub(super) cancel: CancellationToken,
}
impl<'a> TelegramUploadTransport<'a> {
    pub async fn connect(
        auth: &'a AuthEngine,
        scope: AccountScope,
        cancel: CancellationToken,
    ) -> Result<Self, UploadError> {
        let identity = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(UploadError::Cancelled),
            result = auth.authorize_job_account(AccountId(scope.account_id().into())) => result.map_err(upload_error)?,
        };
        if !identity.verified
            || identity.id.0 != scope.account_id()
            || identity.user_id != scope.authorized_user_id()
        {
            return Err(UploadError::WrongScope);
        }
        Ok(Self {
            auth,
            scope,
            cancel,
        })
    }
    pub(super) async fn peer(
        &self,
        destination: &UploadDestination,
    ) -> Result<PeerRef, UploadError> {
        destination.validate()?;
        if destination.scope != self.scope {
            return Err(UploadError::WrongScope);
        }
        let peer = match destination.peer_kind {
            PeerKind::User => PeerId::user(destination.peer_id),
            PeerKind::Chat => PeerId::chat(destination.peer_id),
            PeerKind::Channel => PeerId::channel(destination.peer_id),
        }
        .ok_or(UploadError::InvalidRequest)?;
        self.auth
            .job_peer(
                &AccountId(self.scope.account_id().into()),
                peer,
                &self.cancel,
            )
            .await
            .map_err(upload_error)
    }
}
#[async_trait]
impl CloudUploadTransport for TelegramUploadTransport<'_> {
    fn scope(&self) -> &AccountScope {
        &self.scope
    }
    async fn limits(&self) -> Result<UploadLimits, UploadError> {
        super::limits::limits(self.auth, &self.scope, &self.cancel)
            .await
            .map_err(upload_error)
    }
    async fn validate_destination(
        &self,
        destination: &UploadDestination,
    ) -> Result<(), UploadError> {
        let peer = self.peer(destination).await?;
        if let Some(topic) = destination.topic_id {
            self.auth.account_request_scoped(&AccountId(self.scope.account_id().into()), &[RpcDomain::Topics], &self.cancel,
                |client| async move {
                    let pack = client.invoke(&tl::functions::messages::GetForumTopicsById { peer: peer.into(), topics: vec![topic] })
                        .await.map_err(|e| map_rpc(e).for_rpc(RpcDomain::Topics))?;
                    let tl::enums::messages::ForumTopics::Topics(pack) = pack;
                    if !pack.topics.iter().any(|value| matches!(value, tl::enums::ForumTopic::Topic(t) if t.id==topic && !t.closed)) {
                        return Err(AuthError::new("cloud_write_rejected"));
                    }
                    Ok(())
                }).await.map_err(upload_error)?;
        }
        Ok(())
    }
    async fn save_part(
        &self,
        request: &UploadRequest,
        file_id: i64,
        part: usize,
        bytes: Vec<u8>,
    ) -> Result<(), UploadError> {
        request.validate()?;
        if request.destination.scope != self.scope {
            return Err(UploadError::WrongScope);
        }
        if file_id == 0
            || part >= request.source.parts()
            || bytes.is_empty()
            || bytes.len() > UPLOAD_PART_BYTES
        {
            return Err(UploadError::InvalidRequest);
        }
        let expected_length = (request.source.size - part as u64 * UPLOAD_PART_BYTES as u64)
            .min(UPLOAD_PART_BYTES as u64) as usize;
        if bytes.len() != expected_length
            || hex::encode(Sha256::digest(&bytes)) != request.source.part_sha256[part]
        {
            return Err(UploadError::SourceChanged);
        }
        self.auth
            .account_request_scoped(
                &AccountId(self.scope.account_id().into()),
                &[RpcDomain::UploadParts],
                &self.cancel,
                |client| async move {
                    let accepted = if request.source.size > 10 * 1024 * 1024 {
                        client
                            .invoke(&tl::functions::upload::SaveBigFilePart {
                                file_id,
                                file_part: part as i32,
                                file_total_parts: request.source.parts() as i32,
                                bytes,
                            })
                            .await
                    } else {
                        client
                            .invoke(&tl::functions::upload::SaveFilePart {
                                file_id,
                                file_part: part as i32,
                                bytes,
                            })
                            .await
                    }
                    .map_err(|e| upload_rpc(e).for_rpc(RpcDomain::UploadParts))?;
                    if !accepted {
                        return Err(AuthError::new("upload_part_rejected"));
                    }
                    Ok(())
                },
            )
            .await
            .map_err(upload_error)
    }
    async fn commit_document(
        &self,
        request: &UploadRequest,
        file_id: i64,
        journal: &dyn UploadCommitJournal,
    ) -> Result<UploadReceipt, UploadError> {
        request.validate()?;
        if file_id == 0 {
            return Err(UploadError::InvalidRequest);
        }
        let peer = self.peer(&request.destination).await?;
        let file: tl::enums::InputFile = if request.source.size > 10 * 1024 * 1024 {
            tl::types::InputFileBig {
                id: file_id,
                parts: request.source.parts() as i32,
                name: request.filename.clone(),
            }
            .into()
        } else {
            tl::types::InputFile {
                id: file_id,
                parts: request.source.parts() as i32,
                name: request.filename.clone(),
                md5_checksum: request.source.md5.clone(),
            }
            .into()
        };
        let media = tl::types::InputMediaUploadedDocument {
            nosound_video: false,
            force_file: true,
            spoiler: request.profile.spoiler,
            file,
            thumb: None,
            mime_type: original_document_mime(&request.filename, &request.mime_type).into(),
            attributes: vec![tl::types::DocumentAttributeFilename {
                file_name: request.filename.clone(),
            }
            .into()],
            stickers: None,
            video_cover: None,
            video_timestamp: None,
            ttl_seconds: None,
        };
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
        let receipt_cancel = self.cancel.clone();
        self.auth
            .account_request_scoped(
                &AccountId(self.scope.account_id().into()),
                &[RpcDomain::SendMessages],
                &self.cancel,
                |client| async move {
                    let updates = client
                        .invoke(&tl::functions::messages::SendMedia {
                            silent: request.profile.silent,
                            background: false,
                            clear_draft: false,
                            noforwards: false,
                            update_stickersets_order: false,
                            invert_media: false,
                            allow_paid_floodskip: false,
                            peer: peer.into(),
                            reply_to,
                            media: media.into(),
                            message: request.caption.clone(),
                            random_id: request.random_id,
                            reply_markup: None,
                            entities: None,
                            schedule_date: None,
                            schedule_repeat_period: None,
                            send_as: None,
                            quick_reply_shortcut: None,
                            effect: None,
                            allow_paid_stars: None,
                            suggested_post: None,
                        })
                        .await
                        .map_err(|e| upload_rpc(e).for_rpc(RpcDomain::SendMessages))?;
                    let message_id = confirmed_message_id(updates.clone(), request.random_id)
                        .ok_or_else(|| {
                            AuthError::new(&format!(
                                "commit_unconfirmed_{}",
                                update_response_summary(&updates)
                            ))
                        })?;
                    // Persist the exact mapping before a receipt fetch can fail or
                    // the process can stop. A journal failure never becomes success.
                    journal.record_message_id(message_id).map_err(|failure| {
                        let reason = match failure {
                            UploadError::InvalidState => "invalid_state",
                            UploadError::Database => "database",
                            UploadError::ReceiptMismatch => "receipt_mismatch",
                            _ => "other",
                        };
                        AuthError::new(&format!("commit_mapping_{reason}"))
                    })?;
                    super::receipt::read_confirmed_document(
                        &client,
                        peer,
                        request,
                        message_id,
                        &receipt_cancel,
                    )
                    .await
                },
            )
            .await
            .map_err(upload_error)
    }
    async fn reconcile_document(
        &self,
        request: &UploadRequest,
        message_id: i32,
    ) -> Result<UploadReceipt, UploadError> {
        request.validate()?;
        if message_id <= 0 {
            return Err(UploadError::InvalidRequest);
        }
        let peer = self.peer(&request.destination).await?;
        let receipt_cancel = self.cancel.clone();
        self.auth
            .account_request_scoped(
                &AccountId(self.scope.account_id().into()),
                &[RpcDomain::Messages],
                &self.cancel,
                |client| async move {
                    super::receipt::read_confirmed_document(
                        &client,
                        peer,
                        request,
                        message_id,
                        &receipt_cancel,
                    )
                    .await
                },
            )
            .await
            .map_err(upload_error)
    }
}
fn confirmed_message_id(updates: tl::enums::Updates, random_id: i64) -> Option<i32> {
    let (updates, short_sent_id) = match updates {
        tl::enums::Updates::Updates(value) => (value.updates, None),
        tl::enums::Updates::Combined(value) => (value.updates, None),
        // Telegram uses this response for a single outgoing contact message. The
        // request itself is the correlation; receipt validation still re-reads
        // this exact ID and verifies peer, topic, filename and size before success.
        tl::enums::Updates::UpdateShortSentMessage(value) => (Vec::new(), Some(value.id)),
        _ => return None,
    };
    let mut mapped_id = None;
    let mut response_message_ids = Vec::new();
    for update in updates {
        match update {
            tl::enums::Update::MessageId(value) if value.random_id == random_id => {
                if value.id <= 0 || mapped_id.is_some_and(|old| old != value.id) {
                    return None;
                }
                mapped_id = Some(value.id);
            }
            // New-message updates are not a correlation signal: a send response
            // can also carry unrelated updates. Persist only exact random_id
            // mappings (or the dedicated one-message short-send response).
            tl::enums::Update::NewMessage(value) => {
                let _ = value;
            }
            tl::enums::Update::NewChannelMessage(value) => {
                let _ = value;
            }
            _ => {}
        }
    }
    if let Some(id) = short_sent_id {
        if id <= 0 {
            return None;
        }
        response_message_ids.push(id);
    }
    resolve_mapping_and_response(mapped_id, &response_message_ids)
}

fn resolve_mapping_and_response(mapped_id: Option<i32>, response_ids: &[i32]) -> Option<i32> {
    // UpdateMessageID is the protocol correlation keyed by the exact
    // request random_id. Other new-message updates in the same container may
    // be unrelated service traffic and must not override or invalidate it.
    match mapped_id {
        Some(mapped) if mapped > 0 => Some(mapped),
        Some(_) => None,
        None => unique_positive_id(response_ids)?,
    }
}

fn unique_positive_id(ids: &[i32]) -> Option<Option<i32>> {
    let mut valid = ids.iter().copied().filter(|id| *id > 0).collect::<Vec<_>>();
    valid.sort_unstable();
    valid.dedup();
    match valid.as_slice() {
        [] => Some(None),
        [id] => Some(Some(*id)),
        _ => None,
    }
}

/// A safe, content-free response fingerprint for diagnosing unsupported Updates
/// shapes. This is persisted only as an error code; no message text or peer data
/// is logged or stored.
fn update_response_summary(updates: &tl::enums::Updates) -> String {
    let (kind, items) = match updates {
        tl::enums::Updates::Updates(value) => ("updates", Some(value.updates.as_slice())),
        tl::enums::Updates::Combined(value) => ("combined", Some(value.updates.as_slice())),
        tl::enums::Updates::UpdateShortSentMessage(_) => ("short_sent", None),
        tl::enums::Updates::UpdateShortMessage(_) => ("short_message", None),
        tl::enums::Updates::UpdateShortChatMessage(_) => ("short_chat", None),
        tl::enums::Updates::UpdateShort(_) => ("short_update", None),
        tl::enums::Updates::TooLong => ("too_long", None),
    };
    let Some(items) = items else {
        return kind.to_string();
    };
    let mut mapping = 0usize;
    let mut new_message = 0usize;
    let mut new_channel = 0usize;
    let mut other = 0usize;
    for item in items {
        match item {
            tl::enums::Update::MessageId(_) => mapping += 1,
            tl::enums::Update::NewMessage(_) => new_message += 1,
            tl::enums::Update::NewChannelMessage(_) => new_channel += 1,
            _ => other += 1,
        }
    }
    format!("{kind}_m{mapping}_n{new_message}_c{new_channel}_o{other}")
}
fn original_document_mime<'a>(filename: &str, mime: &'a str) -> &'a str {
    if filename
        .rsplit('.')
        .next()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("webp"))
        || mime.eq_ignore_ascii_case("image/webp")
    {
        "application/octet-stream"
    } else {
        mime
    }
}
pub(super) fn upload_rpc(error: InvocationError) -> AuthError {
    if let InvocationError::Rpc(rpc) = &error {
        if rpc.name == "WORKER_BUSY_TOO_LONG_RETRY" || rpc.code >= 500 {
            return AuthError::new("network_error");
        }
        if rpc.code == 400 && rpc.name == "FILE_PART_MISSING" && rpc.value.is_some() {
            return AuthError::new("upload_parts_expired");
        }
    }
    map_rpc(error)
}
pub(super) fn upload_error(error: AuthError) -> UploadError {
    match error.code.as_str() {
        "flood_wait" => UploadError::FloodWait {
            retry_after_ms: u64::from(error.retry_after_seconds) * 1000,
        },
        "not_authorized" => UploadError::Unauthorized,
        "account_mismatch" | "account_scope_changed" => UploadError::WrongScope,
        "operation_cancelled" => UploadError::Cancelled,
        "network_error" | "network_timeout" => UploadError::Network,
        "upload_part_rejected" => UploadError::PartRejected,
        "upload_parts_expired" => UploadError::PartsExpired,
        "receipt_mismatch" => UploadError::ReceiptMismatch,
        "receipt_message_id_mismatch" => UploadError::ReceiptMessageIdMismatch,
        "receipt_peer_mismatch" => UploadError::ReceiptPeerMismatch,
        "receipt_topic_mismatch" => UploadError::ReceiptTopicMismatch,
        "receipt_content_mismatch" => UploadError::ReceiptContentMismatch,
        "receipt_media_mismatch" => UploadError::ReceiptMediaMismatch,
        "receipt_filename_mismatch" => UploadError::ReceiptFilenameMismatch,
        "receipt_size_mismatch" => UploadError::ReceiptSizeMismatch,
        "commit_unconfirmed" => UploadError::ReviewRequired,
        value if value.starts_with("commit_unconfirmed_") => {
            UploadError::CommitUnconfirmedResponse(value.to_string())
        }
        value if value.starts_with("commit_mapping_") => {
            UploadError::CommitUnconfirmedResponse(value.to_string())
        }
        _ => UploadError::Rejected,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn updates(ids: &[(i64, i32)]) -> tl::enums::Updates {
        tl::types::Updates {
            updates: ids
                .iter()
                .map(|(random_id, id)| {
                    tl::types::UpdateMessageId {
                        random_id: *random_id,
                        id: *id,
                    }
                    .into()
                })
                .collect(),
            users: vec![],
            chats: vec![],
            date: 0,
            seq: 0,
        }
        .into()
    }
    #[test]
    fn receipt_requires_exact_random_id_mapping_and_no_conflicting_ids() {
        assert_eq!(
            confirmed_message_id(updates(&[(8, 17), (9, 18)]), 9),
            Some(18)
        );
        assert_eq!(confirmed_message_id(updates(&[(8, 17)]), 9), None);
        assert_eq!(confirmed_message_id(updates(&[(9, 18), (9, 19)]), 9), None);
        assert_eq!(confirmed_message_id(updates(&[(9, -1)]), 9), None);
    }
    #[test]
    fn exact_mapping_wins_and_short_response_fallback_must_be_unambiguous() {
        assert_eq!(unique_positive_id(&[]), Some(None));
        assert_eq!(unique_positive_id(&[18]), Some(Some(18)));
        assert_eq!(unique_positive_id(&[18, 18]), Some(Some(18)));
        assert_eq!(unique_positive_id(&[18, 19]), None);
        assert_eq!(unique_positive_id(&[-1]), Some(None));
        assert_eq!(resolve_mapping_and_response(Some(18), &[18]), Some(18));
        assert_eq!(resolve_mapping_and_response(None, &[18]), Some(18));
        assert_eq!(resolve_mapping_and_response(Some(18), &[19]), Some(18));
        assert_eq!(resolve_mapping_and_response(Some(18), &[19, 20]), Some(18));
        assert_eq!(resolve_mapping_and_response(None, &[18, 19]), None);
        assert_eq!(resolve_mapping_and_response(None, &[]), None);
    }
    #[test]
    fn response_summary_contains_only_update_shape_counts() {
        assert_eq!(
            update_response_summary(&updates(&[])),
            "updates_m0_n0_c0_o0"
        );
        assert_eq!(
            update_response_summary(&tl::enums::Updates::TooLong),
            "too_long"
        );
    }
    #[test]
    fn original_webp_is_sent_as_document_without_sticker_coercion() {
        assert_eq!(
            original_document_mime("photo.WEBP", "image/webp"),
            "application/octet-stream"
        );
        assert_eq!(
            original_document_mime("photo.png", "image/png"),
            "image/png"
        );
    }

    #[test]
    fn receipt_failures_keep_the_specific_server_invariant_code() {
        for (code, expected) in [
            (
                "receipt_message_id_mismatch",
                UploadError::ReceiptMessageIdMismatch,
            ),
            ("receipt_peer_mismatch", UploadError::ReceiptPeerMismatch),
            ("receipt_topic_mismatch", UploadError::ReceiptTopicMismatch),
            (
                "receipt_content_mismatch",
                UploadError::ReceiptContentMismatch,
            ),
            ("receipt_media_mismatch", UploadError::ReceiptMediaMismatch),
            (
                "receipt_filename_mismatch",
                UploadError::ReceiptFilenameMismatch,
            ),
            ("receipt_size_mismatch", UploadError::ReceiptSizeMismatch),
        ] {
            assert_eq!(upload_error(AuthError::new(code)), expected);
        }
    }

    #[test]
    fn part_recovery_requires_exact_normalized_missing_part_rejection() {
        let mapped = |code, name: &str| {
            upload_error(upload_rpc(InvocationError::Rpc(
                tl::types::RpcError {
                    error_code: code,
                    error_message: name.into(),
                }
                .into(),
            )))
        };
        assert_eq!(
            mapped(400, "FILE_PART_2_MISSING"),
            UploadError::PartsExpired
        );
        for name in [
            "FILE_PARTS_MISSING",
            "FILE_PART_MISSING",
            "FILE_PART_2_MISSING_EXTRA",
            "FILE_PARTS_INVALID",
        ] {
            assert_ne!(mapped(400, name), UploadError::PartsExpired);
        }
        assert_eq!(mapped(500, "FILE_PART_2_MISSING"), UploadError::Network);
    }
}
