//! Job peer capabilities stay inside the encrypted platform vault, never SQLite/UI.
use super::AuthEngine;
use crate::telegram::auth::{AccountId, AuthError, map_rpc};
use grammers_session::{Session, types::{PeerId, PeerRef}};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

#[derive(Serialize, Deserialize)]
struct StoredPeer { version: u32, account: AccountId, peer: PeerRef }

fn key(account: &AccountId, peer: PeerId) -> String {
    format!("jobpeer_{}", hex::encode(Sha256::digest(format!("{}:{}", account.0, peer).as_bytes())))
}

impl AuthEngine {
    pub(crate) async fn job_peer(&self, account: &AccountId, peer: PeerId,
        cancel: &CancellationToken) -> Result<PeerRef, AuthError> {
        let connection = self.accounts.lock().get(&account.0).cloned()
            .ok_or_else(|| AuthError::new("not_authorized"))?;
        self.account_request(account, cancel, |client| async move {
            let own_id = account.0.strip_prefix("tg_").and_then(|id| id.parse::<i64>().ok()).and_then(PeerId::user);
            if own_id == Some(peer) { return Ok(peer.to_ambient_ref()); }
            let record_key = key(account, peer);
            let cached = connection.session.peer_ref(peer).await.map_err(|_| AuthError::new("cloud_location_missing"))?;
            if let Some(reference) = cached {
                self.store.write(&record_key, &serde_json::to_vec(&StoredPeer {
                    version: 1, account: account.clone(), peer: reference,
                }).map_err(|_| AuthError::new("vault_error"))?)?;
                return Ok(reference);
            }
            if let Some(bytes) = self.store.read(&record_key)? {
                let record: StoredPeer = serde_json::from_slice(&bytes).map_err(|_| AuthError::new("vault_error"))?;
                if record.version != 1 || record.account != *account || record.peer.id != peer {
                    return Err(AuthError::new("vault_error"));
                }
                return Ok(record.peer);
            }
            // Resolve once for a newly selected job target; future restarts use the encrypted capability.
            let mut dialogs = client.iter_dialogs();
            for _ in 0..10_000 {
                let Some(dialog) = dialogs.next().await.map_err(map_rpc)? else { break };
                if dialog.peer_id() == peer {
                    let reference = dialog.peer_ref();
                    self.store.write(&record_key, &serde_json::to_vec(&StoredPeer {
                        version: 1, account: account.clone(), peer: reference,
                    }).map_err(|_| AuthError::new("vault_error"))?)?;
                    return Ok(reference);
                }
            }
            Err(AuthError::new("cloud_location_missing"))
        }).await
    }
}
