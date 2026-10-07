//! Small real peer photos only: descriptors come from dialogs, not arbitrary peer IDs.
use super::*;
use grammers_client::{media::ChatPhoto, tl};

pub(super) fn photo_key(photo: &ChatPhoto) -> String {
    match &photo.raw {
        tl::enums::InputFileLocation::InputPeerPhotoFileLocation(raw) => raw.photo_id.to_string(),
        _ => String::new(),
    }
}

pub(super) fn inline_photo(peer: &Peer) -> Option<Vec<u8>> {
    let bytes = match peer {
        Peer::User(user) => user.photo()?.stripped_thumb.as_ref(),
        Peer::Group(group) => group.photo()?.stripped_thumb.as_ref(),
        Peer::Channel(channel) => channel.photo()?.stripped_thumb.as_ref(),
    }?;
    super::super::jpeg::unstrip_jpeg(bytes)
}

const MAX_AVATAR_BYTES: usize = 256 * 1024;
fn append_bounded(output: &mut Vec<u8>, chunk: &[u8]) -> Result<(), AuthError> {
    if output.len().saturating_add(chunk.len()) > MAX_AVATAR_BYTES {
        return Err(AuthError::new("cloud_image_too_large"));
    }
    output.extend_from_slice(chunk);
    Ok(())
}

impl CloudWorkspace {
    pub async fn fetch_avatar(&self, auth: &AuthEngine, account: AccountId,
        peer_id: String, expected_photo_key: String) -> Result<Vec<u8>, AuthError> {
        let revision = auth.cloud_revision();
        let photo = {
            let mut state = self.state.lock();
            state.refresh(revision)?;
            state.photos.get(&(account.0.clone(), peer_id)).cloned()
                .ok_or_else(|| AuthError::new("cloud_photo_missing"))?
        };
        if expected_photo_key.is_empty() || photo_key(&photo) != expected_photo_key {
            return Err(AuthError::new("cloud_photo_changed"));
        }
        auth.cloud_request_scoped(&account, &[RpcDomain::Files], |client| async move {
            let mut output = Vec::new();
            let mut download = client.iter_download(&photo).chunk_size(32 * 1024);
            while let Some(chunk) = download.next().await.map_err(|e| map_rpc(e).for_rpc(RpcDomain::Files))? {
                append_bounded(&mut output, &chunk)?;
            }
            if output.is_empty() { return Err(AuthError::new("cloud_media_truncated")); }
            Ok(output)
        }).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn avatar_buffer_never_accepts_an_oversized_chunk() {
        let mut buffer = vec![0; MAX_AVATAR_BYTES - 1];
        append_bounded(&mut buffer, &[1]).unwrap();
        assert_eq!(append_bounded(&mut buffer, &[2]).unwrap_err().code, "cloud_image_too_large");
        assert_eq!(buffer.len(), MAX_AVATAR_BYTES);
    }
}
