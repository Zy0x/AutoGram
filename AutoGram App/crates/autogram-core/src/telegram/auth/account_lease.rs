//! Background calls pinned to their original account, independent of UI selection.
use super::{AuthEngine, Connection};
use crate::telegram::auth::{AccountId, AuthError, AuthorizedAccount};
use std::{sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;

impl AuthEngine {
    pub async fn validate_selected_account(&self, id: &AccountId) -> Result<(), AuthError> {
        self.cloud_request(id, |_| async { Ok(()) }).await
    }
    /// Restore a durable job's account from the vault, without changing UI selection.
    /// A persisted identity is never used as proof of authorization.
    pub async fn authorize_job_account(&self, id: AccountId) -> Result<AuthorizedAccount, AuthError> {
        let _operation = self.account_operation.lock().await;
        self.check_cooldown()?;
        let record = self.load_account(&id)?;
        let existing = self.accounts.lock().get(&id.0).cloned();
        let connection = existing.unwrap_or_else(|| Arc::new(Connection::new(record.credentials.api_id, record.session)));
        let result = tokio::time::timeout(Duration::from_secs(30), connection.verified_identity()).await;
        let mut identity = match result {
            Ok(Ok(identity)) if identity.id == id && !connection.revoked.is_cancelled() => identity,
            Ok(Ok(_)) => { self.invalidate_connection(&id, &connection); return Err(AuthError::new("account_mismatch")); }
            Ok(Err(error)) => {
                if error.code == "not_authorized" { self.invalidate_connection(&id, &connection); }
                return Err(self.retain_error(error));
            }
            Err(_) => return Err(AuthError::new("network_timeout")),
        };
        let mut accounts = self.accounts.lock();
        if connection.revoked.is_cancelled() { return Err(AuthError::new("not_authorized")); }
        accounts.insert(id.0.clone(), connection);
        identity.active = self.selected.lock().as_ref() == Some(&id);
        Ok(identity)
    }

    pub(crate) async fn account_request<T, F, Fut>(&self, id: &AccountId,
        cancel: &CancellationToken, operation: F) -> Result<T, AuthError>
    where F: FnOnce(grammers_client::Client) -> Fut,
        Fut: std::future::Future<Output = Result<T, AuthError>> {
        self.check_cooldown()?;
        let connection = self.accounts.lock().get(&id.0).cloned()
            .ok_or_else(|| AuthError::new("not_authorized"))?;
        let result = tokio::select! {
            biased;
            _ = cancel.cancelled() => Err(AuthError::new("operation_cancelled")),
            _ = connection.revoked.cancelled() => Err(AuthError::new("not_authorized")),
            result = tokio::time::timeout(Duration::from_secs(30), operation(connection.client.clone())) =>
                result.unwrap_or_else(|_| Err(AuthError::new("network_timeout"))),
        };
        if cancel.is_cancelled() { return Err(AuthError::new("operation_cancelled")); }
        let current = self.accounts.lock().get(&id.0).is_some_and(|active| Arc::ptr_eq(active, &connection));
        if !current || connection.revoked.is_cancelled() { return Err(AuthError::new("not_authorized")); }
        match result {
            Err(error) => {
                if error.code == "not_authorized" { self.invalidate_connection(id, &connection); }
                Err(self.retain_error(error))
            }
            ok => ok,
        }
    }

    pub(super) fn invalidate_connection(&self, id: &AccountId, failed: &Arc<Connection>) {
        let mut accounts = self.accounts.lock();
        if !accounts.get(&id.0).is_some_and(|active| Arc::ptr_eq(active, failed)) { return; }
        if let Some(connection) = accounts.remove(&id.0) { connection.revoked.cancel(); }
        let mut selected = self.selected.lock();
        if selected.as_ref() == Some(id) {
            self.scope_revision.send_modify(|revision| *revision = revision.wrapping_add(1));
            *selected = None;
        }
    }
}

#[cfg(test)]
#[path = "account_lease_tests.rs"]
mod tests;
