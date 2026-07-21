//! Precise Telegram / backend error taxonomy for UI + logs.

use serde::Serialize;
use thiserror::Error;

/// Stable error codes the UI can branch on (English machine codes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TgErrorCode {
    NotConfigured,
    BackendDisabled,
    SessionMissing,
    SessionLocked,
    SessionImportFailed,
    NotAuthorized,
    FloodWait,
    PeerFlood,
    PeerNotFound,
    PathRejected,
    Io,
    Network,
    Rpc,
    Auth,
    Timeout,
    Cancelled,
    Internal,
    TelethonFallbackRequired,
}

#[derive(Debug, Error)]
pub enum TgError {
    #[error("{message}")]
    Structured {
        code: TgErrorCode,
        message: String,
        /// FLOOD_WAIT seconds when applicable
        flood_wait_secs: Option<u32>,
        /// RPC name e.g. FLOOD_WAIT_X / AUTH_KEY_UNREGISTERED
        rpc_name: Option<String>,
        retryable: bool,
    },
}

impl TgError {
    pub fn new(code: TgErrorCode, message: impl Into<String>) -> Self {
        Self::Structured {
            code,
            message: crate::core::tg_log::redact(&message.into()),
            flood_wait_secs: None,
            rpc_name: None,
            retryable: matches!(
                code,
                TgErrorCode::FloodWait
                    | TgErrorCode::Network
                    | TgErrorCode::Timeout
                    | TgErrorCode::Io
            ),
        }
    }

    pub fn with_flood(secs: u32, rpc: impl Into<String>) -> Self {
        Self::Structured {
            code: TgErrorCode::FloodWait,
            message: format!("Telegram rate limit: wait {secs}s before retry"),
            flood_wait_secs: Some(secs),
            rpc_name: Some(rpc.into()),
            retryable: true,
        }
    }

    pub fn with_rpc(name: impl Into<String>, message: impl Into<String>) -> Self {
        let name = name.into();
        let code = if name.contains("FLOOD_WAIT") {
            TgErrorCode::FloodWait
        } else if name.contains("PEER_FLOOD") {
            TgErrorCode::PeerFlood
        } else if name.contains("AUTH") || name.contains("SESSION") {
            TgErrorCode::Auth
        } else if name.contains("USERNAME") || name.contains("PEER") {
            TgErrorCode::PeerNotFound
        } else {
            TgErrorCode::Rpc
        };
        Self::Structured {
            code,
            message: crate::core::tg_log::redact(&message.into()),
            flood_wait_secs: None,
            rpc_name: Some(name),
            retryable: matches!(code, TgErrorCode::FloodWait | TgErrorCode::Network),
        }
    }

    pub fn code(&self) -> TgErrorCode {
        match self {
            Self::Structured { code, .. } => *code,
        }
    }

    pub fn flood_wait_secs(&self) -> Option<u32> {
        match self {
            Self::Structured { flood_wait_secs, .. } => *flood_wait_secs,
        }
    }

    pub fn retryable(&self) -> bool {
        match self {
            Self::Structured { retryable, .. } => *retryable,
        }
    }

    /// JSON-friendly payload for Tauri (no secrets).
    pub fn to_public(&self) -> TgErrorPublic {
        match self {
            Self::Structured {
                code,
                message,
                flood_wait_secs,
                rpc_name,
                retryable,
            } => TgErrorPublic {
                code: *code,
                message: message.clone(),
                flood_wait_secs: *flood_wait_secs,
                rpc_name: rpc_name.clone(),
                retryable: *retryable,
            },
        }
    }

    pub fn user_message(&self) -> String {
        match self {
            Self::Structured {
                code,
                message,
                flood_wait_secs,
                ..
            } => match code {
                TgErrorCode::FloodWait => flood_wait_secs
                    .map(|s| {
                        format!(
                            "Telegram membatasi laju permintaan. Tunggu {s} detik lalu coba lagi."
                        )
                    })
                    .unwrap_or_else(|| message.clone()),
                TgErrorCode::NotAuthorized => {
                    "Session belum login. Login ulang lewat Auth, atau impor session Telethon ke Grammers."
                        .into()
                }
                TgErrorCode::SessionMissing => {
                    "File session tidak ditemukan di folder worker/sessions.".into()
                }
                TgErrorCode::SessionLocked => {
                    "Session sedang dipakai proses lain. Hentikan Drive/transfer dulu.".into()
                }
                TgErrorCode::PeerNotFound => {
                    "Chat/peer tidak ditemukan. Buka chat di Telegram resmi dulu, atau pilih dari daftar dialog."
                        .into()
                }
                TgErrorCode::TelethonFallbackRequired => message.clone(),
                _ => message.clone(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TgErrorPublic {
    pub code: TgErrorCode,
    pub message: String,
    pub flood_wait_secs: Option<u32>,
    pub rpc_name: Option<String>,
    pub retryable: bool,
}

/// Map grammers InvocationError → TgError with precise RPC parsing.
pub fn map_invocation(err: &grammers_client::InvocationError) -> TgError {
    use grammers_client::InvocationError;
    match err {
        InvocationError::Rpc(rpc) => {
            let name = rpc.name.clone();
            if name.contains("AUTH_KEY_UNREGISTERED") || name.contains("SESSION_REVOKED") || name.contains("USER_DEACTIVATED") {
                return TgError::new(
                    TgErrorCode::NotAuthorized,
                    "Sesi Telegram telah kedaluwarsa atau dicabut oleh Telegram (AUTH_KEY_UNREGISTERED). Silakan login ulang akun ini di menu Akun.",
                );
            }
            // FLOOD_WAIT_X often stores seconds in `value: Option<u32>`
            if name.starts_with("FLOOD_WAIT") || name.contains("FLOOD_WAIT") {
                let secs = rpc
                    .value
                    .filter(|v| *v > 0)
                    .or_else(|| {
                        name.rsplit('_')
                            .next()
                            .and_then(|s| s.parse().ok())
                    })
                    .unwrap_or(30);
                return TgError::with_flood(secs, name);
            }
            TgError::with_rpc(name, format!("{rpc}"))
        }
        InvocationError::Io(e) => TgError::new(TgErrorCode::Network, format!("I/O: {e}")),
        InvocationError::Transport(e) => {
            TgError::new(TgErrorCode::Network, format!("Transport: {e}"))
        }
        InvocationError::Dropped => TgError::new(
            TgErrorCode::Cancelled,
            "Request dropped (sender pool stopped)",
        ),
        InvocationError::InvalidDc => {
            TgError::new(TgErrorCode::Network, "Invalid or unknown datacenter")
        }
        InvocationError::Authentication(e) => {
            TgError::new(TgErrorCode::Auth, format!("Auth key handshake failed: {e}"))
        }
        InvocationError::Session(e) => {
            TgError::new(TgErrorCode::SessionMissing, format!("Session store: {e}"))
        }
        InvocationError::Deserialize(e) => TgError::new(
            TgErrorCode::Internal,
            format!("Deserialize (session concurrency?): {e}"),
        ),
    }
}

impl From<std::io::Error> for TgError {
    fn from(e: std::io::Error) -> Self {
        TgError::new(TgErrorCode::Io, e.to_string())
    }
}

impl From<String> for TgError {
    fn from(s: String) -> Self {
        TgError::new(TgErrorCode::Internal, s)
    }
}

impl From<&str> for TgError {
    fn from(s: &str) -> Self {
        TgError::new(TgErrorCode::Internal, s)
    }
}
