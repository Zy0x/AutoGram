//! Exact-message metadata reads only: no send, delete, range or history scan.
use super::{
    receipt::validate_receipt_scope,
    transport::{upload_error, upload_rpc, TelegramUploadTransport},
};
use crate::{
    telegram::auth::{AccountId, RpcDomain},
    transfer::{
        cloud_download::AccountScope,
        cloud_upload::{UploadDestination, UploadError},
        upload_duplicates::{DuplicateDocumentSource, ExistingCloudDocument},
    },
};
use async_trait::async_trait;

#[async_trait]
impl DuplicateDocumentSource for TelegramUploadTransport<'_> {
    fn scope(&self) -> &AccountScope {
        &self.scope
    }
    async fn read_document(
        &self,
        destination: &UploadDestination,
        message_id: i32,
    ) -> Result<Option<ExistingCloudDocument>, UploadError> {
        if message_id <= 0 {
            return Err(UploadError::InvalidRequest);
        }
        let peer = self.peer(destination).await?;
        self.auth
            .account_request_scoped(
                &AccountId(self.scope.account_id().into()),
                &[RpcDomain::Messages],
                &self.cancel,
                |client| async move {
                    let Some(message) = client
                        .get_messages_by_id(peer, &[message_id])
                        .await
                        .map_err(|error| upload_rpc(error).for_rpc(RpcDomain::Messages))?
                        .pop()
                        .flatten()
                    else {
                        return Ok(None);
                    };
                    // A moved/edited message in another thread is stale evidence, never a match.
                    if validate_receipt_scope(
                        destination,
                        peer.id,
                        message.peer_id(),
                        message_id,
                        message.id(),
                        message.reply_header().as_ref(),
                    )
                    .is_err()
                    {
                        return Ok(None);
                    }
                    let Some(grammers_client::media::Media::Document(document)) = message.media()
                    else {
                        return Ok(None);
                    };
                    let (Some(name), Some(size)) = (document.name(), document.size()) else {
                        return Ok(None);
                    };
                    Ok(Some(ExistingCloudDocument {
                        destination: destination.clone(),
                        message_id,
                        document_id: document.id(),
                        size: size as u64,
                        filename: name.into(),
                    }))
                },
            )
            .await
            .map_err(upload_error)
    }
}
