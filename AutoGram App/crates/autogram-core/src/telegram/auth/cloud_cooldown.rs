//! Retain real server waits by account and RPC family, never by UI screen.
use super::AuthEngine;
use crate::telegram::auth::{account_key, unix_seconds, AccountId, AuthError, RpcDomain};

impl AuthEngine {
    pub(super) fn check_cloud_cooldown(&self, id: &AccountId, domains: Option<&[RpcDomain]>) -> Result<(), AuthError> {
        let prefix = format!("cloud_wait_{}_", account_key(id)?);
        let keys: Vec<String> = match domains {
            Some(domains) => std::iter::once(format!("{prefix}all"))
                .chain(domains.iter().map(|domain| format!("{prefix}{}", domain.key()))).collect(),
            None => self.store.keys()?.into_iter().filter(|key| key.starts_with(&prefix)).collect::<Vec<_>>(),
        };
        let mut remaining = 0;
        for key in keys {
            if let Some(bytes) = self.store.read(&key)? {
                let until: i64 = serde_json::from_slice(&bytes).map_err(|_| AuthError::new("vault_error"))?;
                remaining = remaining.max(until.saturating_sub(unix_seconds()));
            }
        }
        if remaining > 0 { Err(AuthError::wait(remaining.min(u32::MAX as i64) as u32)) } else { Ok(()) }
    }

    pub(super) fn retain_cloud_error(&self, id: &AccountId, error: AuthError) -> AuthError {
        if error.code != "flood_wait" { return error; }
        let _commit = self.cooldown_commit.lock();
        let result = (|| {
            let key = format!("cloud_wait_{}_{}", account_key(id)?, error.rpc_domain.map_or("all", RpcDomain::key));
            let old = self.store.read(&key)?.map(|bytes| serde_json::from_slice::<i64>(&bytes)
                .map_err(|_| AuthError::new("vault_error"))).transpose()?.unwrap_or_default();
            let until = old.max(unix_seconds().saturating_add(i64::from(error.retry_after_seconds)));
            let bytes = serde_json::to_vec(&until).map_err(|_| AuthError::new("vault_error"))?;
            self.store.write(&key, &bytes)
        })();
        result.err().unwrap_or(error)
    }
}
