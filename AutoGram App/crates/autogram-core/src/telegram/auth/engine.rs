use super::{
    contracts::*,
    transport::{map_rpc, snapshot_session, Attempt, Connection},
};
use grammers_session::SessionData;
use parking_lot::Mutex;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::sync::CancellationToken;

#[path = "account_lease.rs"]
mod account_lease;
#[path = "peer_capability.rs"]
mod peer_capability;

#[derive(Serialize, Deserialize)]
struct SavedAccount {
    version: u32,
    credentials: ApiCredentials,
    identity: AuthorizedAccount,
    #[serde(with = "super::session_codec")]
    session: SessionData,
}

struct Pending {
    id: LoginAttemptId,
    created: Instant,
    cancel: CancellationToken,
    // Cancellation and durable commit are linearized under this lock.
    commit: Mutex<bool>,
    attempt: AsyncMutex<Attempt>,
}
impl Pending {
    fn cancel(&self) {
        *self.commit.lock() = false;
        self.cancel.cancel();
    }
    fn check(&self) -> Result<(), AuthError> {
        if self.cancel.is_cancelled() {
            return Err(AuthError::new("login_cancelled"));
        }
        if self.created.elapsed() >= Duration::from_secs(15 * 60) {
            self.cancel();
            return Err(AuthError::new("login_expired"));
        }
        Ok(())
    }
}

pub enum AuthAction {
    SendCode,
    ResendCode,
    Code(String),
    Password(String),
    PollQr,
}

pub struct AuthEngine {
    store: Arc<dyn AuthSecretStore>,
    pending: Mutex<Option<Arc<Pending>>>,
    accounts: Mutex<HashMap<String, Arc<Connection>>>,
    selected: Mutex<Option<AccountId>>,
    account_operation: AsyncMutex<()>,
    scope_revision: tokio::sync::watch::Sender<u64>,
}
impl AuthEngine {
    pub fn new(store: Arc<dyn AuthSecretStore>) -> Self {
        Self {
            store,
            pending: Mutex::new(None),
            accounts: Mutex::new(HashMap::new()),
            selected: Mutex::new(None),
            account_operation: AsyncMutex::new(()),
            scope_revision: tokio::sync::watch::channel(0).0,
        }
    }

    pub fn configure(&self, credentials: ApiCredentials) -> Result<(), AuthError> {
        credentials.validate()?;
        // Existing accounts retain their own credentials; changing this config is for new logins.
        self.store.write(
            "api",
            &serde_json::to_vec(&credentials).map_err(|_| AuthError::new("vault_error"))?,
        )
    }

    pub fn configured(&self) -> Result<bool, AuthError> {
        match self.store.read("api")? {
            None => Ok(false),
            Some(bytes) => {
                let config: ApiCredentials =
                    serde_json::from_slice(&bytes).map_err(|_| AuthError::new("vault_error"))?;
                config.validate()?;
                Ok(true)
            }
        }
    }

    fn check_cooldown(&self) -> Result<(), AuthError> {
        if let Some(bytes) = self.store.read("auth_cooldown")? {
            let until: i64 =
                serde_json::from_slice(&bytes).map_err(|_| AuthError::new("vault_error"))?;
            let remaining = until.saturating_sub(unix_seconds());
            if remaining > 0 {
                return Err(AuthError::wait(remaining.min(u32::MAX as i64) as u32));
            }
        }
        Ok(())
    }

    fn retain_error(&self, error: AuthError) -> AuthError {
        if error.code == "flood_wait" {
            let until = unix_seconds().saturating_add(error.retry_after_seconds as i64);
            let saved = serde_json::to_vec(&until)
                .map_err(|_| AuthError::new("vault_error"))
                .and_then(|bytes| self.store.write("auth_cooldown", &bytes));
            if let Err(vault_error) = saved {
                return vault_error;
            }
        }
        error
    }

    fn invalidate_account(&self, id: &AccountId) -> bool {
        let mut accounts = self.accounts.lock();
        if let Some(connection) = accounts.remove(&id.0) {
            connection.revoked.cancel();
        }
        let mut selected = self.selected.lock();
        if selected.as_ref() == Some(id) {
            self.scope_revision.send_modify(|revision| *revision = revision.wrapping_add(1));
            *selected = None;
            true
        } else {
            false
        }
    }

    /// The server has revoked this session. Disk failure must not preserve live authorization.
    fn finish_logout(&self, id: &AccountId) -> Result<(), AuthError> {
        self.invalidate_account(id);
        let account_result = self.store.remove(&account_key(id)?);
        // A prior failed cleanup may already have cleared the in-memory selection.
        let active_result = match self.last_selected() {
            Ok(Some(active)) if active == *id => self.store.remove("active"),
            Ok(_) => Ok(()),
            Err(error) => Err(error),
        };
        account_result.and(active_result)
    }

    /// Must run on a Tokio runtime; creating a sender does not send an OTP.
    pub fn create_attempt(&self, phone: Option<String>) -> Result<LoginAttemptId, AuthError> {
        self.check_cooldown()?;
        if let Some(phone) = &phone {
            validate_phone(phone)?;
        }
        let bytes = self
            .store
            .read("api")?
            .ok_or_else(|| AuthError::new("api_not_configured"))?;
        let credentials: ApiCredentials =
            serde_json::from_slice(&bytes).map_err(|_| AuthError::new("vault_error"))?;
        credentials.validate()?;
        let mut random = [0u8; 16];
        rand::rngs::OsRng.fill_bytes(&mut random);
        let id = LoginAttemptId(hex::encode(random));
        let pending = Arc::new(Pending {
            id: id.clone(),
            created: Instant::now(),
            cancel: CancellationToken::new(),
            commit: Mutex::new(true),
            attempt: AsyncMutex::new(Attempt::new(id.clone(), credentials, phone)),
        });
        let mut current = self.pending.lock();
        if let Some(old) = current.replace(pending) {
            old.cancel();
        }
        Ok(id)
    }

    fn pending(&self, id: &LoginAttemptId) -> Result<Arc<Pending>, AuthError> {
        self.pending
            .lock()
            .as_ref()
            .filter(|p| p.id == *id)
            .cloned()
            .ok_or_else(|| AuthError::new("login_expired"))
    }

    pub fn cancel(&self, id: &LoginAttemptId) -> bool {
        let mut slot = self.pending.lock();
        if slot.as_ref().is_some_and(|p| p.id == *id) {
            if let Some(pending) = slot.take() {
                pending.cancel();
            }
            true
        } else {
            false
        }
    }

    pub async fn advance(
        &self,
        id: LoginAttemptId,
        action: AuthAction,
    ) -> Result<AuthStep, AuthError> {
        let pending = self.pending(&id)?;
        pending.check()?;
        self.check_cooldown()?;
        // No parallel requests on one challenge. Cancellation remains available while waiting.
        let operation = async {
            let mut attempt = pending.attempt.lock().await;
            pending.check()?;
            let result = if attempt.step.phase == AuthPhase::Authorized {
                Ok(())
            } else {
                match action {
                    AuthAction::SendCode => attempt.send_code(false).await,
                    AuthAction::ResendCode => attempt.send_code(true).await,
                    AuthAction::Code(code) => attempt.submit_code(&code).await,
                    AuthAction::Password(password) => attempt.submit_password(&password).await,
                    AuthAction::PollQr => attempt.poll_qr().await,
                }
            };
            if let Err(error) = result {
                return Err(self.retain_error(error));
            }
            pending.check()?;
            if attempt.step.phase == AuthPhase::Authorized {
                let mut identity = attempt
                    .connection
                    .verified_identity()
                    .await
                    .map_err(|error| self.retain_error(error))?;
                let session = snapshot_session(&attempt.connection.session)?;
                pending.check()?;
                // Secret-store failure must never turn into a successful login response.
                let commit = pending.commit.lock();
                if !*commit {
                    return Err(AuthError::new("login_cancelled"));
                }
                let key = account_key(&identity.id)?;
                identity.active = false;
                let record = SavedAccount {
                    version: 1,
                    credentials: attempt.credentials.clone(),
                    identity: identity.clone(),
                    session,
                };
                self.store.write(
                    &key,
                    &serde_json::to_vec(&record).map_err(|_| AuthError::new("vault_error"))?,
                )?;
                attempt.step.account = Some(identity);
                attempt.step.qr_url = None;
            }
            Ok(attempt.step.clone())
        };
        tokio::select! {
            biased;
            _ = pending.cancel.cancelled() => Err(AuthError::new("login_cancelled")),
            result = tokio::time::timeout(Duration::from_secs(45), operation) =>
                result.unwrap_or_else(|_| Err(AuthError::new("network_timeout"))),
        }
    }

    fn load_account(&self, id: &AccountId) -> Result<SavedAccount, AuthError> {
        let bytes = self
            .store
            .read(&account_key(id)?)?
            .ok_or_else(|| AuthError::new("account_missing"))?;
        let record: SavedAccount =
            serde_json::from_slice(&bytes).map_err(|_| AuthError::new("vault_error"))?;
        if record.version != 1 || record.identity.id != *id {
            return Err(AuthError::new("vault_error"));
        }
        record.credentials.validate()?;
        Ok(record)
    }

    pub fn list_accounts(&self) -> Result<Vec<AuthorizedAccount>, AuthError> {
        let active = self.selected.lock().clone();
        let mut result = Vec::new();
        for key in self.store.keys()? {
            if let Some(id) = key.strip_prefix("account_") {
                let mut account = self.load_account(&AccountId(id.into()))?.identity;
                account.verified = self.accounts.lock().contains_key(&account.id.0);
                account.active = active.as_ref() == Some(&account.id) && account.verified;
                result.push(account);
            }
        }
        result.sort_by(|a, b| a.id.0.cmp(&b.id.0));
        Ok(result)
    }

    /// Account changes serialize in the engine. A local filename is never authorization.
    pub async fn select_account(&self, id: AccountId) -> Result<AuthorizedAccount, AuthError> {
        let _operation = self.account_operation.lock().await;
        self.scope_revision.send_modify(|revision| *revision = revision.wrapping_add(1));
        self.check_cooldown()?;
        let record = self.load_account(&id)?;
        let existing = self.accounts.lock().get(&id.0).cloned();
        let connection = existing.unwrap_or_else(|| {
            Arc::new(Connection::new(record.credentials.api_id, record.session))
        });
        let result = tokio::time::timeout(Duration::from_secs(30), connection.verified_identity())
            .await
            .unwrap_or_else(|_| Err(AuthError::new("network_timeout")));
        let mut identity = match result {
            Ok(identity) if identity.id == id => identity,
            Ok(_) => {
                self.invalidate_account(&id);
                return Err(AuthError::new("account_mismatch"));
            }
            Err(error) => {
                self.invalidate_account(&id);
                return Err(self.retain_error(error));
            }
        };
        // Persist the chosen account, but revalidate it on every process restart.
        self.store.write(
            "active",
            &serde_json::to_vec(&id).map_err(|_| AuthError::new("vault_error"))?,
        )?;
        let mut accounts = self.accounts.lock();
        if connection.revoked.is_cancelled() { return Err(AuthError::new("not_authorized")); }
        accounts.insert(id.0.clone(), connection);
        *self.selected.lock() = Some(id);
        self.scope_revision.send_modify(|revision| *revision = revision.wrapping_add(1));
        identity.active = true;
        Ok(identity)
    }

    pub fn last_selected(&self) -> Result<Option<AccountId>, AuthError> {
        self.store
            .read("active")?
            .map(|bytes| serde_json::from_slice(&bytes).map_err(|_| AuthError::new("vault_error")))
            .transpose()
    }

    pub(crate) fn cloud_revision(&self) -> u64 {
        *self.scope_revision.borrow()
    }

    /// Read-only interactive cloud work uses only the live selected connection.
    /// Switching/logout interrupts the future even when switching back to the same account.
    /// Background transfers must use their own account-pinned execution contract.
    pub(crate) async fn cloud_request<T, F, Fut>(
        &self,
        id: &AccountId,
        operation: F,
    ) -> Result<T, AuthError>
    where
        F: FnOnce(grammers_client::Client) -> Fut,
        Fut: std::future::Future<Output = Result<T, AuthError>>,
    {
        self.check_cooldown()?;
        let mut revision = self.scope_revision.subscribe();
        let started = *revision.borrow_and_update();
        if self.selected.lock().as_ref() != Some(id) {
            return Err(AuthError::new("account_not_selected"));
        }
        let connection = self.accounts.lock().get(&id.0).cloned()
            .ok_or_else(|| AuthError::new("not_authorized"))?;
        let result = tokio::select! {
            biased;
            _ = revision.changed() => Err(AuthError::new("account_changed")),
            result = tokio::time::timeout(Duration::from_secs(30), operation(connection.client.clone())) =>
                result.unwrap_or_else(|_| Err(AuthError::new("network_timeout"))),
        };
        if self.cloud_revision() != started || self.selected.lock().as_ref() != Some(id) {
            return Err(AuthError::new("account_changed"));
        }
        match result {
            Err(error) => {
                if error.code == "not_authorized" { self.invalidate_connection(id, &connection); }
                Err(self.retain_error(error))
            }
            ok => ok,
        }
    }

    pub async fn logout(&self, id: AccountId) -> Result<(), AuthError> {
        let _operation = self.account_operation.lock().await;
        self.check_cooldown()?;
        let record = self.load_account(&id)?;
        let connection = Connection::new(record.credentials.api_id, record.session);
        // Keep encrypted material on network failure so logout can be retried.
        match tokio::time::timeout(Duration::from_secs(30), connection.client.sign_out()).await {
            Ok(Ok(_)) => {}
            Ok(Err(error)) => {
                let mapped = map_rpc(error);
                if mapped.code != "not_authorized" {
                    return Err(self.retain_error(mapped));
                }
            }
            Err(_) => return Err(AuthError::new("network_timeout")),
        }
        self.finish_logout(&id)
    }
}

#[cfg(test)]
#[path = "engine_tests.rs"]
mod tests;
