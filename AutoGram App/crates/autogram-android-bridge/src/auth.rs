//! UniFFI is an adapter only: authentication and session ownership live in the core.
use autogram_core::telegram::auth::*;
use std::sync::{Arc, OnceLock};

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum NativeAuthError {
    #[error("{code}")]
    RequestFailed {
        code: String,
        retry_after_seconds: u32,
    },
}
impl From<AuthError> for NativeAuthError {
    fn from(error: AuthError) -> Self {
        Self::RequestFailed {
            code: error.code,
            retry_after_seconds: error.retry_after_seconds,
        }
    }
}

#[uniffi::export(callback_interface)]
pub trait NativeAuthVault: Send + Sync {
    fn read(&self, key: String) -> Result<Option<Vec<u8>>, NativeAuthError>;
    fn write(&self, key: String, bytes: Vec<u8>) -> Result<(), NativeAuthError>;
    fn remove(&self, key: String) -> Result<(), NativeAuthError>;
    fn keys(&self) -> Result<Vec<String>, NativeAuthError>;
}
struct VaultAdapter(Box<dyn NativeAuthVault>);
impl AuthSecretStore for VaultAdapter {
    fn read(&self, key: &str) -> Result<Option<Vec<u8>>, AuthError> {
        self.0
            .read(key.into())
            .map_err(|_| AuthError::new("vault_error"))
    }
    fn write(&self, key: &str, value: &[u8]) -> Result<(), AuthError> {
        self.0
            .write(key.into(), value.to_vec())
            .map_err(|_| AuthError::new("vault_error"))
    }
    fn remove(&self, key: &str) -> Result<(), AuthError> {
        self.0
            .remove(key.into())
            .map_err(|_| AuthError::new("vault_error"))
    }
    fn keys(&self) -> Result<Vec<String>, AuthError> {
        self.0.keys().map_err(|_| AuthError::new("vault_error"))
    }
}
static ENGINE: OnceLock<AuthEngine> = OnceLock::new();
fn engine() -> Result<&'static AuthEngine, NativeAuthError> {
    ENGINE
        .get()
        .ok_or_else(|| AuthError::new("auth_not_initialized").into())
}

#[derive(Clone, uniffi::Record)]
pub struct NativeAccount {
    pub id: String,
    pub user_id: i64,
    pub display_name: String,
    pub username: Option<String>,
    pub verified: bool,
    pub active: bool,
}
impl From<AuthorizedAccount> for NativeAccount {
    fn from(account: AuthorizedAccount) -> Self {
        Self {
            id: account.id.0,
            user_id: account.user_id,
            display_name: account.display_name,
            username: account.username,
            verified: account.verified,
            active: account.active,
        }
    }
}
#[derive(uniffi::Enum)]
pub enum NativeAuthPhase {
    Code,
    Password,
    Qr,
    Authorized,
}
#[derive(uniffi::Record)]
pub struct NativeAuthStep {
    pub attempt_id: String,
    pub phase: NativeAuthPhase,
    pub qr_url: Option<String>,
    pub expires_at: i64,
    pub resend_at: i64,
    pub can_resend: bool,
    pub password_hint: Option<String>,
    pub account: Option<NativeAccount>,
}
impl From<AuthStep> for NativeAuthStep {
    fn from(step: AuthStep) -> Self {
        Self {
            attempt_id: step.attempt_id.0,
            phase: match step.phase {
                AuthPhase::Code => NativeAuthPhase::Code,
                AuthPhase::Password => NativeAuthPhase::Password,
                AuthPhase::Qr => NativeAuthPhase::Qr,
                AuthPhase::Authorized => NativeAuthPhase::Authorized,
            },
            qr_url: step.qr_url,
            expires_at: step.expires_at,
            resend_at: step.resend_at,
            can_resend: step.can_resend,
            password_hint: step.password_hint,
            account: step.account.map(Into::into),
        }
    }
}

#[uniffi::export]
pub fn initialize_auth(vault: Box<dyn NativeAuthVault>) -> Result<(), NativeAuthError> {
    ENGINE
        .set(AuthEngine::new(Arc::new(VaultAdapter(vault))))
        .map_err(|_| AuthError::new("auth_already_initialized"))?;
    Ok(())
}
#[uniffi::export]
pub fn configure_api(api_id: i32, api_hash: String) -> Result<(), NativeAuthError> {
    Ok(engine()?.configure(ApiCredentials { api_id, api_hash })?)
}
#[uniffi::export]
pub fn auth_configured() -> Result<bool, NativeAuthError> {
    Ok(engine()?.configured()?)
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn create_login_attempt(phone: Option<String>) -> Result<String, NativeAuthError> {
    Ok(engine()?.create_attempt(phone)?.0)
}
async fn advance(id: String, action: AuthAction) -> Result<NativeAuthStep, NativeAuthError> {
    Ok(engine()?.advance(LoginAttemptId(id), action).await?.into())
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn begin_phone_login(attempt_id: String) -> Result<NativeAuthStep, NativeAuthError> {
    advance(attempt_id, AuthAction::SendCode).await
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn resend_login_code(attempt_id: String) -> Result<NativeAuthStep, NativeAuthError> {
    advance(attempt_id, AuthAction::ResendCode).await
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn submit_login_code(
    attempt_id: String,
    code: String,
) -> Result<NativeAuthStep, NativeAuthError> {
    advance(attempt_id, AuthAction::Code(code)).await
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn submit_login_password(
    attempt_id: String,
    password: String,
) -> Result<NativeAuthStep, NativeAuthError> {
    advance(attempt_id, AuthAction::Password(password)).await
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn begin_qr_login(attempt_id: String) -> Result<NativeAuthStep, NativeAuthError> {
    advance(attempt_id, AuthAction::PollQr).await
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn poll_qr_login(attempt_id: String) -> Result<NativeAuthStep, NativeAuthError> {
    advance(attempt_id, AuthAction::PollQr).await
}
#[uniffi::export]
pub fn cancel_login(attempt_id: String) -> Result<bool, NativeAuthError> {
    Ok(engine()?.cancel(&LoginAttemptId(attempt_id)))
}
#[uniffi::export]
pub fn list_authorized_accounts() -> Result<Vec<NativeAccount>, NativeAuthError> {
    Ok(engine()?
        .list_accounts()?
        .into_iter()
        .map(Into::into)
        .collect())
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn select_authorized_account(
    account_id: String,
) -> Result<NativeAccount, NativeAuthError> {
    let result = engine()?.select_account(AccountId(account_id)).await;
    // A rejected/revoked account can also invalidate the current Drive scope.
    crate::emit_bridge_event("authorized_account_changed".into(), "{}".into());
    Ok(result?.into())
}
#[uniffi::export]
pub fn last_selected_account() -> Result<Option<String>, NativeAuthError> {
    Ok(engine()?.last_selected()?.map(|id| id.0))
}
#[uniffi::export(async_runtime = "tokio")]
pub async fn logout_account(account_id: String) -> Result<(), NativeAuthError> {
    let result = engine()?.logout(AccountId(account_id.clone())).await;
    crate::emit_bridge_event(
        "authorized_account_changed".into(),
        serde_json::json!({"account_id":account_id}).to_string(),
    );
    Ok(result?)
}
