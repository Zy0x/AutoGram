//! Validates the actual document for an exact server-mapped message ID.
use crate::{
    telegram::auth::{AuthError, RpcDomain},
    transfer::cloud_upload::{UploadDestination, UploadReceipt, UploadRequest},
};
use grammers_client::{tl, Client};
use grammers_session::types::{PeerId, PeerRef};

pub(super) async fn read_confirmed_document(
    client: &Client,
    peer: PeerRef,
    request: &UploadRequest,
    message_id: i32,
) -> Result<UploadReceipt, AuthError> {
    let message = client
        .get_messages_by_id(peer, &[message_id])
        .await
        .map_err(|error| super::transport::upload_rpc(error).for_rpc(RpcDomain::Messages))?
        .pop()
        .flatten()
        .ok_or_else(|| AuthError::new("commit_unconfirmed"))?;
    validate_receipt_scope(
        &request.destination,
        peer.id,
        message.peer_id(),
        message_id,
        message.id(),
        message.reply_header().as_ref(),
    )?;
    let Some(grammers_client::media::Media::Document(document)) = message.media() else {
        return Err(AuthError::new("receipt_mismatch"));
    };
    if document.name() != Some(request.filename.as_str())
        || document.size().map(|size| size as u64) != Some(request.source.size)
    {
        return Err(AuthError::new("receipt_mismatch"));
    }
    Ok(UploadReceipt {
        destination: request.destination.clone(),
        random_id: request.random_id,
        message_id,
        document_id: document.id(),
        size: request.source.size,
        filename: request.filename.clone(),
    })
}

pub(super) fn validate_receipt_scope(
    destination: &UploadDestination,
    expected_peer: PeerId,
    actual_peer: PeerId,
    expected_id: i32,
    actual_id: i32,
    header: Option<&tl::enums::MessageReplyHeader>,
) -> Result<(), AuthError> {
    if expected_id <= 0 || actual_id != expected_id || actual_peer != expected_peer {
        return Err(AuthError::new("receipt_mismatch"));
    }
    let thread = match header {
        Some(tl::enums::MessageReplyHeader::Header(header)) => {
            header.reply_to_top_id.or(header.reply_to_msg_id)
        }
        _ => None,
    };
    if destination
        .topic_id
        .is_some_and(|topic| thread != Some(topic))
    {
        return Err(AuthError::new("receipt_mismatch"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transfer::cloud_download::{AccountScope, PeerKind};
    fn destination(topic_id: Option<i32>) -> UploadDestination {
        UploadDestination {
            scope: AccountScope::new("tg_77".into(), 77).unwrap(),
            peer_kind: PeerKind::Channel,
            peer_id: 321,
            topic_id,
        }
    }
    fn header(reply: Option<i32>, top: Option<i32>) -> tl::enums::MessageReplyHeader {
        tl::types::MessageReplyHeader {
            reply_to_scheduled: false,
            reply_to_ephemeral: false,
            forum_topic: true,
            quote: false,
            reply_to_msg_id: reply,
            reply_to_peer_id: None,
            reply_from: None,
            reply_media: None,
            reply_to_top_id: top,
            quote_text: None,
            quote_entities: None,
            quote_offset: None,
            todo_item_id: None,
            poll_option: None,
        }
        .into()
    }
    #[test]
    fn forum_receipt_requires_actual_top_thread_and_exact_message_and_peer() {
        let peer = PeerId::channel(321).unwrap();
        let destination = destination(Some(17));
        let matching = header(Some(56), Some(17));
        assert!(validate_receipt_scope(&destination, peer, peer, 57, 57, Some(&matching)).is_ok());
        // A reply to a same-numbered message in another thread is not a topic match.
        let wrong_thread = header(Some(17), Some(18));
        assert!(
            validate_receipt_scope(&destination, peer, peer, 57, 57, Some(&wrong_thread)).is_err()
        );
        assert!(validate_receipt_scope(&destination, peer, peer, 57, 58, Some(&matching)).is_err());
        assert!(validate_receipt_scope(
            &destination,
            peer,
            PeerId::channel(322).unwrap(),
            57,
            57,
            Some(&matching)
        )
        .is_err());
        assert!(validate_receipt_scope(&destination, peer, peer, 57, 57, None).is_err());
        let topic_root = header(Some(17), None);
        assert!(
            validate_receipt_scope(&destination, peer, peer, 57, 57, Some(&topic_root)).is_ok()
        );
    }
    #[test]
    fn ordinary_destination_allows_replies_but_still_requires_exact_peer_and_message() {
        let peer = PeerId::channel(321).unwrap();
        let destination = destination(None);
        assert!(validate_receipt_scope(&destination, peer, peer, 57, 57, None).is_ok());
        assert!(validate_receipt_scope(
            &destination,
            peer,
            peer,
            57,
            57,
            Some(&header(Some(15), Some(17)))
        )
        .is_ok());
        assert!(validate_receipt_scope(&destination, peer, peer, 0, 0, None).is_err());
    }
}
