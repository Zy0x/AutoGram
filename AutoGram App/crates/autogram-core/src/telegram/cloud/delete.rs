//! Account-scoped cloud media deletion with an exact server-side scope preflight.
use super::contracts::{CloudDeleteFailure, CloudDeleteResult};
use crate::telegram::auth::{map_rpc, AccountId, AuthEngine, AuthError, RpcDomain};
use grammers_client::{tl, Client};
use grammers_session::types::{PeerId, PeerRef};
use std::time::Duration;

const DELETE_BATCH_SIZE: usize = 50;
const MAX_DELETE_ITEMS: usize = 1_000;

pub(super) async fn delete_media(
    auth: &AuthEngine,
    account: AccountId,
    peer_id: String,
    peer: PeerRef,
    topic_id: Option<i32>,
    message_ids: Vec<i32>,
) -> Result<CloudDeleteResult, AuthError> {
    if message_ids.is_empty()
        || message_ids.len() > MAX_DELETE_ITEMS
        || message_ids.iter().any(|id| *id <= 0)
        || message_ids
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != message_ids.len()
        || topic_id.is_some_and(|id| id <= 0)
    {
        return Err(AuthError::new("invalid_cloud_delete"));
    }

    let owner = account.clone();
    auth.cloud_request_scoped(&owner, &[RpcDomain::Messages], |client| async move {
        let existing_ids = preflight_targets(&client, peer, &message_ids, topic_id).await?;
        let existing: std::collections::HashSet<i32> = existing_ids.iter().copied().collect();
        let mut deleted_ids: Vec<i32> = message_ids
            .iter()
            .copied()
            .filter(|id| !existing.contains(id))
            .collect();
        let mut failed = Vec::new();

        for chunk in existing_ids.chunks(DELETE_BATCH_SIZE) {
            let mut attempt = 0u32;
            loop {
                let result = client.delete_messages(peer, chunk).await;
                match result {
                    Ok(_) => {
                        deleted_ids.extend_from_slice(chunk);
                        break;
                    }
                    Err(error) => {
                        let mapped = map_rpc(error).for_rpc(RpcDomain::Messages);
                        let retained = auth.retain_cloud_error(&account, mapped);
                        if retained.code == "not_authorized" {
                            return Err(retained);
                        }
                        let wait = delete_retry_delay(&retained, attempt);
                        if let Some(delay) = wait {
                            attempt += 1;
                            tokio::time::sleep(delay).await;
                            continue;
                        }
                        failed.extend(chunk.iter().map(|message_id| CloudDeleteFailure {
                            message_id: *message_id,
                            code: retained.code.clone(),
                            retry_after_seconds: retained.retry_after_seconds,
                        }));
                        break;
                    }
                }
            }
        }

        Ok(CloudDeleteResult {
            account_id: account.0,
            peer_id,
            topic_id,
            deleted_ids,
            failed,
        })
    })
    .await
}

async fn preflight_targets(
    client: &Client,
    peer: PeerRef,
    message_ids: &[i32],
    topic_id: Option<i32>,
) -> Result<Vec<i32>, AuthError> {
    let messages = client
        .get_messages_by_id(peer, message_ids)
        .await
        .map_err(|error| map_rpc(error).for_rpc(RpcDomain::Messages))?;
    let mut existing = Vec::with_capacity(message_ids.len());
    for message_id in message_ids {
        let Some(message) = messages
            .iter()
            .flatten()
            .find(|message| message.id() == *message_id)
        else {
            // A stale selection is already in the desired deleted state.
            continue;
        };
        let actual_topic = message_topic_id(message.reply_header().as_ref());
        validate_delete_target(
            peer.id,
            message.peer_id(),
            *message_id,
            message.id(),
            message.media().is_some(),
            topic_id,
            actual_topic,
        )?;
        existing.push(*message_id);
    }
    Ok(existing)
}

fn message_topic_id(header: Option<&tl::enums::MessageReplyHeader>) -> Option<i32> {
    match header {
        Some(tl::enums::MessageReplyHeader::Header(header)) => header
            .reply_to_top_id
            .or_else(|| {
                if header.forum_topic {
                    header.reply_to_msg_id
                } else {
                    None
                }
            })
            .or(header.reply_to_msg_id),
        _ => None,
    }
}

fn validate_delete_target(
    expected_peer: PeerId,
    actual_peer: PeerId,
    expected_id: i32,
    actual_id: i32,
    has_media: bool,
    expected_topic: Option<i32>,
    actual_topic: Option<i32>,
) -> Result<(), AuthError> {
    if expected_id != actual_id || expected_peer != actual_peer {
        return Err(AuthError::new("cloud_delete_scope_mismatch"));
    }
    if !has_media {
        return Err(AuthError::new("cloud_delete_media_missing"));
    }
    if expected_topic.is_some_and(|topic| actual_topic != Some(topic)) {
        return Err(AuthError::new("cloud_delete_scope_mismatch"));
    }
    Ok(())
}

fn delete_retry_delay(error: &AuthError, attempt: u32) -> Option<Duration> {
    match error.code.as_str() {
        "flood_wait" if attempt < 2 && error.retry_after_seconds <= 10 => Some(
            Duration::from_secs(u64::from(error.retry_after_seconds) + 1),
        ),
        "network_error" | "network_timeout" if attempt < 2 => {
            Some(Duration::from_millis(400 * u64::from(attempt + 1)))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scoped_delete_requires_exact_message_peer_media_and_topic() {
        let peer = PeerId::channel(321).unwrap();
        assert!(validate_delete_target(peer, peer, 56, 56, true, Some(17), Some(17)).is_ok());
        assert_eq!(
            validate_delete_target(peer, peer, 56, 57, true, Some(17), Some(17))
                .unwrap_err()
                .code,
            "cloud_delete_scope_mismatch"
        );
        assert_eq!(
            validate_delete_target(
                peer,
                PeerId::channel(322).unwrap(),
                56,
                56,
                true,
                Some(17),
                Some(17)
            )
            .unwrap_err()
            .code,
            "cloud_delete_scope_mismatch"
        );
        assert_eq!(
            validate_delete_target(peer, peer, 56, 56, false, None, None)
                .unwrap_err()
                .code,
            "cloud_delete_media_missing"
        );
        assert_eq!(
            validate_delete_target(peer, peer, 56, 56, true, Some(17), Some(18))
                .unwrap_err()
                .code,
            "cloud_delete_scope_mismatch"
        );
    }

    #[test]
    fn topic_root_and_reply_headers_follow_desktop_topic_resolution() {
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

    #[test]
    fn retries_are_bounded_and_long_flood_waits_are_returned_to_the_caller() {
        assert_eq!(
            delete_retry_delay(&AuthError::new("network_timeout"), 0),
            Some(Duration::from_millis(400))
        );
        assert_eq!(
            delete_retry_delay(&AuthError::wait(8), 0),
            Some(Duration::from_secs(9))
        );
        assert_eq!(delete_retry_delay(&AuthError::wait(60), 0), None);
        assert_eq!(delete_retry_delay(&AuthError::wait(1), 2), None);
    }
}
