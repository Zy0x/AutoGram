use super::contracts::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use grammers_client::{client::PasswordToken, tl, Client, SignInError};
use grammers_mtsender::{InvocationError, SenderPool};
use grammers_session::{storages::MemorySession, Session, SessionData};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

pub(crate) struct Connection {
    pub client: Client,
    pub session: Arc<MemorySession>,
    runner: tokio::task::JoinHandle<()>,
    auth_updates: tokio::task::JoinHandle<()>,
    qr_changed: Arc<AtomicBool>,
    pub revoked: tokio_util::sync::CancellationToken,
}
impl Connection {
    pub fn new(api_id: i32, data: SessionData) -> Self {
        let session = Arc::new(MemorySession::from(data));
        let SenderPool {
            runner,
            handle,
            mut updates,
        } = SenderPool::new(session.clone(), api_id);
        // Auth calls are user-driven; surface FloodWait instead of silently retrying OTPs.
        let client = Client::with_configuration(
            handle,
            grammers_client::client::ClientConfiguration {
                retry_policy: Box::new(grammers_client::client::NoRetries),
                auto_cache_peers: true,
            },
        );
        let runner = tokio::spawn(async move {
            runner.run().await;
        });
        let qr_changed = Arc::new(AtomicBool::new(false));
        let notification = qr_changed.clone();
        // Drain promptly; retain only the auth signal, never an unbounded message queue.
        let auth_updates = tokio::spawn(async move {
            while let Some(update) = updates.recv().await {
                if super::qr_updates::needs_refresh(&update) {
                    notification.store(true, Ordering::Release);
                }
            }
        });
        Self {
            client,
            session,
            runner,
            auth_updates,
            qr_changed,
            revoked: tokio_util::sync::CancellationToken::new(),
        }
    }

    pub async fn verified_identity(&self) -> Result<AuthorizedAccount, AuthError> {
        if !self.client.is_authorized().await.map_err(map_rpc)? {
            return Err(AuthError::new("not_authorized"));
        }
        let user = self.client.get_me().await.map_err(map_rpc)?;
        let user_id = user.id().bare_id_unchecked();
        Ok(AuthorizedAccount {
            id: AccountId(format!("tg_{user_id}")),
            user_id,
            display_name: [user.first_name(), user.last_name()]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" "),
            username: user.username().map(str::to_owned),
            verified: true,
            active: false,
        })
    }
}
impl Drop for Connection {
    fn drop(&mut self) {
        self.client.disconnect();
        self.runner.abort();
        self.auth_updates.abort();
    }
}

/// Shared with the desktop persistence adapter. Never exposes plaintext to the UI.
pub fn snapshot_session(session: &MemorySession) -> Result<SessionData, AuthError> {
    let home = session
        .home_dc_id()
        .map_err(|_| AuthError::new("session_snapshot_failed"))?;
    let home_option = session
        .dc_option(home)
        .map_err(|_| AuthError::new("session_snapshot_failed"))?
        .filter(|option| option.auth_key.is_some())
        .ok_or_else(|| AuthError::new("session_key_missing"))?;
    let mut data = SessionData::default();
    // Preserve negotiated keys for all known production DCs, not just the home DC.
    for id in data.dc_options.keys().copied().collect::<Vec<_>>() {
        if let Some(option) = session
            .dc_option(id)
            .map_err(|_| AuthError::new("session_snapshot_failed"))?
        {
            data.dc_options.insert(id, option);
        }
    }
    data.home_dc = home;
    data.dc_options.insert(home, home_option);
    Ok(data)
}

pub(crate) fn map_rpc(error: InvocationError) -> AuthError {
    match error {
        InvocationError::Rpc(rpc) => match rpc.name.as_str() {
            "FLOOD_WAIT" | "FLOOD_PREMIUM_WAIT" => AuthError::wait(rpc.value.unwrap_or(60)),
            "PHONE_CODE_INVALID" | "PHONE_CODE_EMPTY" => AuthError::new("invalid_code"),
            "PHONE_CODE_EXPIRED" | "PHONE_CODE_HASH_EMPTY" => AuthError::new("code_expired"),
            "PHONE_NUMBER_INVALID" | "PHONE_NUMBER_BANNED" => AuthError::new("invalid_phone"),
            "API_ID_INVALID" | "API_ID_PUBLISHED_FLOOD" => {
                AuthError::new("invalid_api_credentials")
            }
            "SESSION_PASSWORD_NEEDED" => AuthError::new("password_required"),
            "PASSWORD_HASH_INVALID" => AuthError::new("invalid_password"),
            "SESSION_REVOKED" | "AUTH_KEY_UNREGISTERED" | "AUTH_KEY_DUPLICATED" | "SESSION_EXPIRED" => {
                AuthError::new("not_authorized")
            }
            "AUTH_TOKEN_EXPIRED" | "AUTH_TOKEN_INVALID" => AuthError::new("qr_expired"),
            "FILE_REFERENCE_EXPIRED" | "FILE_REFERENCE_EMPTY" => AuthError::new("file_reference_expired"),
            _ => AuthError::new("telegram_request_failed"),
        },
        _ => AuthError::new("network_error"),
    }
}

pub(crate) struct Attempt {
    pub connection: Connection,
    pub credentials: ApiCredentials,
    pub phone: Option<String>,
    pub step: AuthStep,
    phone_code_hash: Option<String>,
    next_resend: Option<Instant>,
    next_poll: Instant,
}
impl Attempt {
    pub fn new(id: LoginAttemptId, credentials: ApiCredentials, phone: Option<String>) -> Self {
        let phase = if phone.is_some() {
            AuthPhase::Code
        } else {
            AuthPhase::Qr
        };
        Self {
            connection: Connection::new(credentials.api_id, SessionData::default()),
            credentials,
            phone,
            step: AuthStep::new(id, phase),
            phone_code_hash: None,
            next_resend: None,
            next_poll: Instant::now(),
        }
    }

    pub async fn send_code(&mut self, resend: bool) -> Result<(), AuthError> {
        let phone = self
            .phone
            .as_ref()
            .ok_or_else(|| AuthError::new("wrong_auth_step"))?;
        if self.step.phase != AuthPhase::Code {
            return Err(AuthError::new("wrong_auth_step"));
        }
        let sent = if resend {
            let deadline = self
                .next_resend
                .ok_or_else(|| AuthError::new("resend_unavailable"))?;
            if deadline > Instant::now() {
                return Err(AuthError::resend_wait(
                    deadline.duration_since(Instant::now()).as_secs() as u32 + 1,
                ));
            }
            self.connection
                .client
                .invoke(&tl::functions::auth::ResendCode {
                    phone_number: phone.clone(),
                    phone_code_hash: self
                        .phone_code_hash
                        .clone()
                        .ok_or_else(|| AuthError::new("wrong_auth_step"))?,
                    reason: None,
                })
                .await
                .map_err(map_rpc)?
        } else {
            if self.phone_code_hash.is_some() {
                return Err(AuthError::new("wrong_auth_step"));
            }
            let request = tl::functions::auth::SendCode {
                phone_number: phone.clone(),
                api_id: self.credentials.api_id,
                api_hash: self.credentials.api_hash.clone(),
                settings: tl::types::CodeSettings {
                    allow_flashcall: false,
                    current_number: false,
                    allow_app_hash: false,
                    allow_missed_call: false,
                    allow_firebase: false,
                    logout_tokens: None,
                    token: None,
                    app_sandbox: None,
                    unknown_number: false,
                }
                .into(),
            };
            match self.connection.client.invoke(&request).await {
                Err(InvocationError::Rpc(ref rpc)) if rpc.code == 303 => {
                    let dc = rpc
                        .value
                        .filter(|dc| (1..=5).contains(dc))
                        .ok_or_else(|| AuthError::new("telegram_request_failed"))?;
                    self.connection
                        .session
                        .set_home_dc_id(dc as i32)
                        .await
                        .map_err(|_| AuthError::new("session_snapshot_failed"))?;
                    self.connection
                        .client
                        .invoke(&request)
                        .await
                        .map_err(map_rpc)?
                }
                result => result.map_err(map_rpc)?,
            }
        };
        match sent {
            tl::enums::auth::SentCode::Code(code) => {
                self.phone_code_hash = Some(code.phone_code_hash);
                let wait = code.timeout.unwrap_or(60).max(0) as u64;
                self.next_resend = code
                    .next_type
                    .map(|_| Instant::now() + Duration::from_secs(wait));
                self.step.can_resend = self.next_resend.is_some();
                self.step.resend_at = unix_seconds() + wait as i64;
                self.step.phase = AuthPhase::Code;
                Ok(())
            }
            tl::enums::auth::SentCode::Success(success) => {
                self.handle_authorization(success.authorization)
            }
            tl::enums::auth::SentCode::PaymentRequired(_) => {
                Err(AuthError::new("official_app_required"))
            }
        }
    }

    fn handle_authorization(
        &mut self,
        auth: tl::enums::auth::Authorization,
    ) -> Result<(), AuthError> {
        match auth {
            tl::enums::auth::Authorization::Authorization(_) => {
                self.step.phase = AuthPhase::Authorized;
                Ok(())
            }
            tl::enums::auth::Authorization::SignUpRequired(_) => {
                Err(AuthError::new("official_app_required"))
            }
        }
    }

    async fn require_password(&mut self) -> Result<(), AuthError> {
        let password: tl::types::account::Password = self
            .connection
            .client
            .invoke(&tl::functions::account::GetPassword {})
            .await
            .map_err(map_rpc)?
            .into();
        self.step.phase = AuthPhase::Password;
        self.step.qr_url = None;
        self.step.password_hint = password.hint;
        Ok(())
    }

    pub async fn submit_code(&mut self, code: &str) -> Result<(), AuthError> {
        if self.step.phase != AuthPhase::Code {
            return Err(AuthError::new("wrong_auth_step"));
        }
        if code.trim().is_empty() || code.len() > 128 {
            return Err(AuthError::new("invalid_code"));
        }
        let result = self
            .connection
            .client
            .invoke(&tl::functions::auth::SignIn {
                phone_number: self
                    .phone
                    .clone()
                    .ok_or_else(|| AuthError::new("wrong_auth_step"))?,
                phone_code_hash: self
                    .phone_code_hash
                    .clone()
                    .ok_or_else(|| AuthError::new("wrong_auth_step"))?,
                phone_code: Some(code.trim().to_owned()),
                email_verification: None,
            })
            .await;
        match result {
            Ok(auth) => self.handle_authorization(auth),
            Err(error) if error.is("SESSION_PASSWORD_NEEDED") => self.require_password().await,
            Err(error) => Err(map_rpc(error)),
        }
    }

    pub async fn submit_password(&mut self, password: &str) -> Result<(), AuthError> {
        if self.step.phase != AuthPhase::Password {
            return Err(AuthError::new("wrong_auth_step"));
        }
        if password.is_empty() || password.len() > 4096 {
            return Err(AuthError::new("invalid_password"));
        }
        let info: tl::types::account::Password = self
            .connection
            .client
            .invoke(&tl::functions::account::GetPassword {})
            .await
            .map_err(map_rpc)?
            .into();
        match self
            .connection
            .client
            .check_password(PasswordToken::new(info), password.as_bytes())
            .await
        {
            Ok(_) => {
                self.step.phase = AuthPhase::Authorized;
                Ok(())
            }
            Err(SignInError::InvalidPassword(_)) => Err(AuthError::new("invalid_password")),
            Err(SignInError::Other(error)) => Err(map_rpc(error)),
            Err(_) => Err(AuthError::new("telegram_request_failed")),
        }
    }

    pub async fn poll_qr(&mut self) -> Result<(), AuthError> {
        if self.phone.is_some() || self.step.phase != AuthPhase::Qr {
            return Err(AuthError::new("wrong_auth_step"));
        }
        if self.next_poll > Instant::now() {
            return Ok(());
        }
        let notified = self.connection.qr_changed.swap(false, Ordering::AcqRel);
        if !super::qr_updates::should_export(
            self.step.qr_url.is_some(),
            self.step.expires_at,
            unix_seconds(),
            notified,
        ) {
            return Ok(());
        }
        self.next_poll = Instant::now() + Duration::from_millis(1500);
        let result = self
            .connection
            .client
            .invoke(&tl::functions::auth::ExportLoginToken {
                api_id: self.credentials.api_id,
                api_hash: self.credentials.api_hash.clone(),
                except_ids: vec![],
            })
            .await;
        let result = match result {
            Ok(tl::enums::auth::LoginToken::MigrateTo(migration)) => {
                if !(1..=5).contains(&migration.dc_id) {
                    return Err(AuthError::new("telegram_request_failed"));
                }
                self.connection
                    .session
                    .set_home_dc_id(migration.dc_id)
                    .await
                    .map_err(|_| AuthError::new("session_snapshot_failed"))?;
                self.connection
                    .client
                    .invoke(&tl::functions::auth::ImportLoginToken {
                        token: migration.token,
                    })
                    .await
            }
            other => other,
        };
        let outcome = match result {
            Ok(tl::enums::auth::LoginToken::Token(token)) => {
                self.step.qr_url = Some(format!(
                    "tg://login?token={}",
                    URL_SAFE_NO_PAD.encode(token.token)
                ));
                self.step.expires_at = token.expires as i64;
                Ok(())
            }
            Ok(tl::enums::auth::LoginToken::Success(_)) => {
                self.step.phase = AuthPhase::Authorized;
                Ok(())
            }
            Ok(_) => Err(AuthError::new("telegram_request_failed")),
            Err(error) if error.is("SESSION_PASSWORD_NEEDED") => self.require_password().await,
            Err(error) => Err(map_rpc(error)),
        };
        if outcome.is_err() {
            // A failed confirmation must remain retryable while the shown QR is still valid.
            self.connection.qr_changed.store(true, Ordering::Release);
        }
        outcome
    }
}
