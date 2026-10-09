use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountId(pub String);
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LoginAttemptId(pub String);

/// Implementations must encrypt before durable writes and replace records atomically.
/// No default plaintext implementation is intentionally provided.
pub trait AuthSecretStore: Send + Sync {
    fn read(&self, key: &str) -> Result<Option<Vec<u8>>, AuthError>;
    fn write(&self, key: &str, value: &[u8]) -> Result<(), AuthError>;
    fn remove(&self, key: &str) -> Result<(), AuthError>;
    fn keys(&self) -> Result<Vec<String>, AuthError>;
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ApiCredentials {
    pub api_id: i32,
    pub api_hash: String,
}
impl ApiCredentials {
    pub fn validate(&self) -> Result<(), AuthError> {
        if self.api_id <= 0
            || self.api_hash.len() != 32
            || !self.api_hash.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(AuthError::new("invalid_api_credentials"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AuthorizedAccount {
    pub id: AccountId,
    pub user_id: i64,
    pub display_name: String,
    pub username: Option<String>,
    pub verified: bool,
    pub active: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum AuthPhase {
    Code,
    Password,
    Qr,
    Authorized,
}

/// Contains a short-lived QR login token; do not log or persist this response.
#[derive(Clone)]
pub struct AuthStep {
    pub attempt_id: LoginAttemptId,
    pub phase: AuthPhase,
    pub qr_url: Option<String>,
    pub expires_at: i64,
    pub resend_at: i64,
    pub can_resend: bool,
    pub password_hint: Option<String>,
    pub account: Option<AuthorizedAccount>,
}
impl AuthStep {
    pub fn new(id: LoginAttemptId, phase: AuthPhase) -> Self {
        Self {
            attempt_id: id,
            phase,
            qr_url: None,
            expires_at: 0,
            resend_at: 0,
            can_resend: false,
            password_hint: None,
            account: None,
        }
    }
}

#[derive(Clone, Debug, thiserror::Error)]
#[error("{code}")]
pub struct AuthError {
    pub code: String,
    pub retry_after_seconds: u32,
    pub(crate) rpc_domain: Option<RpcDomain>,
}
impl AuthError {
    pub fn new(code: &str) -> Self {
        Self {
            code: code.into(),
            retry_after_seconds: 0,
            rpc_domain: None,
        }
    }
    pub fn wait(seconds: u32) -> Self {
        Self {
            code: "flood_wait".into(),
            retry_after_seconds: seconds,
            rpc_domain: None,
        }
    }
    pub(crate) fn for_rpc(mut self, domain: RpcDomain) -> Self {
        self.rpc_domain = Some(domain);
        self
    }
    pub(crate) fn resend_wait(seconds: u32) -> Self {
        let mut error = Self::new("resend_unavailable");
        error.retry_after_seconds = seconds;
        error
    }
}

/// Separate RPC budgets; file-download throttling must not block forum navigation.
#[derive(Clone, Copy, Debug)]
pub(crate) enum RpcDomain { Dialogs, History, Search, Topics, Messages, Files, UploadParts, SendMessages }
impl RpcDomain {
    pub(super) fn key(self) -> &'static str {
        match self {
            Self::Dialogs => "dialogs", Self::History => "history", Self::Search => "search",
            Self::Topics => "topics", Self::Messages => "messages", Self::Files => "files",
            Self::UploadParts => "upload_parts", Self::SendMessages => "send_messages",
        }
    }
}

pub fn unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn validate_phone(phone: &str) -> Result<(), AuthError> {
    if !phone.starts_with('+')
        || !(6..=16).contains(&phone.len())
        || !phone[1..].bytes().all(|b| b.is_ascii_digit())
    {
        return Err(AuthError::new("invalid_phone"));
    }
    Ok(())
}

pub fn account_key(id: &AccountId) -> Result<String, AuthError> {
    let value =
        id.0.strip_prefix("tg_")
            .ok_or_else(|| AuthError::new("invalid_account"))?;
    if value.is_empty() || value.len() > 20 || !value.bytes().all(|b| b.is_ascii_digit()) {
        return Err(AuthError::new("invalid_account"));
    }
    Ok(format!("account_{}", id.0))
}
