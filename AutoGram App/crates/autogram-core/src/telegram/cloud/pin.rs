//! Exact-scope Telegram pin state changes used by the Drive favorite action.
use crate::telegram::auth::{map_rpc, AccountId, AuthError, RpcDomain};
use grammers_client::tl;
use grammers_session::types::{PeerId, PeerRef};

pub(super) async fn set_media_pinned(
    auth: &crate::telegram::auth::AuthEngine,
    account: AccountId,
    peer: PeerRef,
    topic_id: Option<i32>,
    message_id: i32,
    is_pinned: bool,
) -> Result<(), AuthError> {
    let owner = account;
    auth.cloud_request_scoped(&owner, &[RpcDomain::Messages], |client| async move {
        let messages = client
            .get_messages_by_id(peer, &[message_id])
            .await
            .map_err(|error| map_rpc(error).for_rpc(RpcDomain::Messages))?;
        let message = messages
            .iter()
            .flatten()
            .find(|message| message.id() == message_id)
            .ok_or_else(|| AuthError::new("cloud_message_missing"))?;
        let actual_topic = message_topic_id(message.reply_header().as_ref());
        validate_pin_target(
            peer.id,
            message.peer_id(),
            message.id(),
            message.media().is_some(),
            topic_id,
            actual_topic,
        )?;

        let input_peer: tl::enums::InputPeer = (&peer).into();
        let request = tl::functions::messages::UpdatePinnedMessage {
            silent: true,
            unpin: !is_pinned,
            pm_oneside: false,
            peer: input_peer,
            id: message_id,
        };
        client
            .invoke(&request)
            .await
            .map_err(|error| map_rpc(error).for_rpc(RpcDomain::Messages))?;
        Ok(())
    })
    .await
}

fn message_topic_id(header: Option<&tl::enums::MessageReplyHeader>) -> Option<i32> {
    match header {
        Some(tl::enums::MessageReplyHeader::Header(header)) => header
            .reply_to_top_id
            .or_else(|| {
                header
                    .forum_topic
                    .then_some(header.reply_to_msg_id)
                    .flatten()
            })
            .or(header.reply_to_msg_id),
        _ => None,
    }
}

fn validate_pin_target(
    expected_peer: PeerId,
    actual_peer: PeerId,
    actual_id: i32,
    has_media: bool,
    expected_topic: Option<i32>,
    actual_topic: Option<i32>,
) -> Result<(), AuthError> {
    if expected_peer != actual_peer {
        return Err(AuthError::new("cloud_pin_scope_mismatch"));
    }
    if actual_id <= 0 || !has_media {
        return Err(AuthError::new("cloud_pin_media_missing"));
    }
    if expected_topic.is_some_and(|topic| actual_topic != Some(topic)) {
        return Err(AuthError::new("cloud_pin_scope_mismatch"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_target_requires_exact_peer_media_and_topic() {
        let peer = PeerId::channel(321).unwrap();
        assert!(validate_pin_target(peer, peer, 56, true, Some(17), Some(17)).is_ok());
        assert_eq!(
            validate_pin_target(peer, PeerId::channel(322).unwrap(), 56, true, None, None)
                .unwrap_err()
                .code,
            "cloud_pin_scope_mismatch"
        );
        assert_eq!(
            validate_pin_target(peer, peer, 56, true, Some(17), Some(18))
                .unwrap_err()
                .code,
            "cloud_pin_scope_mismatch"
        );
        assert_eq!(
            validate_pin_target(peer, peer, 56, false, None, None)
                .unwrap_err()
                .code,
            "cloud_pin_media_missing"
        );
    }

    #[test]
    fn topic_root_and_reply_headers_resolve_like_scoped_delete() {
        let root: tl::enums::MessageReplyHeader = tl::types::MessageReplyHeader {
            reply_to_scheduled: false,
            reply_to_ephemeral: false,
            forum_topic: true,
            quote: false,
            reply_to_msg_id: Some(17),
            reply_to_peer_id: None,
            reply_from: None,
            reply_media: None,
            reply_to_top_id: None,
            quote_text: None,
            quote_entities: None,
            quote_offset: None,
            todo_item_id: None,
            poll_option: None,
        }
        .into();
        assert_eq!(message_topic_id(Some(&root)), Some(17));
        assert_eq!(message_topic_id(None), None);
    }
}
