//! Per-session activity registry — prevents exclusive Telethon/worker paths
//! from dual-opening a session while Grammers Studio / migration / preview share
//! the same MTProto pool, and surfaces clear "session busy" errors.

use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde::Serialize;

use super::tg_error::{TgError, TgErrorCode};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionPurpose {
    /// Media Studio browse / list / thumbs (shared)
    Studio,
    /// Jobs migration forward/copy (shared with studio over Grammers pool)
    Migration,
    /// Progressive media preview stream (shared)
    Preview,
    /// Upload / download transfer (shared)
    Transfer,
    /// Exclusive: Telethon worker spawn, session delete, force disconnect
    Exclusive,
}

impl SessionPurpose {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Studio => "studio",
            Self::Migration => "migration",
            Self::Preview => "preview",
            Self::Transfer => "transfer",
            Self::Exclusive => "exclusive",
        }
    }

    pub fn is_exclusive(self) -> bool {
        matches!(self, Self::Exclusive)
    }

    pub fn from_str_loose(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "migration" | "job" | "jobs" => Self::Migration,
            "preview" | "stream" => Self::Preview,
            "transfer" | "upload" | "download" => Self::Transfer,
            "exclusive" | "worker" | "telethon" | "delete" | "login" => Self::Exclusive,
            _ => Self::Studio,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionActivity {
    pub session: String,
    pub owner_id: String,
    pub purpose: String,
    pub acquired_at_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionGuardSnapshot {
    pub session: String,
    pub activities: Vec<SessionActivity>,
    pub exclusive: bool,
}

struct ActivityEntry {
    owner_id: String,
    purpose: SessionPurpose,
    acquired_at_ms: u128,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn registry() -> &'static Mutex<HashMap<String, Vec<ActivityEntry>>> {
    static MAP: OnceLock<Mutex<HashMap<String, Vec<ActivityEntry>>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Acquire a shared or exclusive activity token for `session`.
///
/// Shared purposes (studio/migration/preview/transfer) may coexist.
/// Exclusive blocks all other owners and is blocked if any activity is live.
pub fn acquire(
    session: &str,
    owner_id: &str,
    purpose: SessionPurpose,
) -> Result<SessionActivity, TgError> {
    let session = session.trim();
    let owner_id = owner_id.trim();
    if session.is_empty() || owner_id.is_empty() {
        return Err(TgError::new(
            TgErrorCode::Internal,
            "session guard requires session and owner_id",
        ));
    }

    let mut map = registry().lock();
    let list = map.entry(session.to_string()).or_default();

    // Idempotent re-acquire by same owner+purpose
    if let Some(existing) = list
        .iter()
        .find(|e| e.owner_id == owner_id && e.purpose == purpose)
    {
        return Ok(SessionActivity {
            session: session.to_string(),
            owner_id: existing.owner_id.clone(),
            purpose: existing.purpose.as_str().to_string(),
            acquired_at_ms: existing.acquired_at_ms,
        });
    }

    let has_exclusive = list.iter().any(|e| e.purpose.is_exclusive());
    if purpose.is_exclusive() {
        if !list.is_empty() {
            let holders: Vec<String> = list
                .iter()
                .map(|e| format!("{}({})", e.owner_id, e.purpose.as_str()))
                .collect();
            return Err(TgError::new(
                TgErrorCode::SessionLocked,
                format!(
                    "Session '{session}' sedang dipakai: {}. Hentikan Media Studio/Jobs/transfer dulu.",
                    holders.join(", ")
                ),
            ));
        }
    } else if has_exclusive {
        let holder = list
            .iter()
            .find(|e| e.purpose.is_exclusive())
            .map(|e| e.owner_id.as_str())
            .unwrap_or("?");
        return Err(TgError::new(
            TgErrorCode::SessionLocked,
            format!(
                "Session '{session}' dikunci exclusive oleh {holder}. Tunggu selesai lalu coba lagi."
            ),
        ));
    }

    let acquired_at_ms = now_ms();
    list.push(ActivityEntry {
        owner_id: owner_id.to_string(),
        purpose,
        acquired_at_ms,
    });

    Ok(SessionActivity {
        session: session.to_string(),
        owner_id: owner_id.to_string(),
        purpose: purpose.as_str().to_string(),
        acquired_at_ms,
    })
}

/// Release one owner token. Returns true if an entry was removed.
pub fn release(session: &str, owner_id: &str) -> bool {
    let session = session.trim();
    let owner_id = owner_id.trim();
    if session.is_empty() || owner_id.is_empty() {
        return false;
    }
    let mut map = registry().lock();
    let Some(list) = map.get_mut(session) else {
        return false;
    };
    let before = list.len();
    list.retain(|e| e.owner_id != owner_id);
    let removed = list.len() < before;
    if list.is_empty() {
        map.remove(session);
    }
    removed
}

/// Release every activity for a session (e.g. account switch / force reset).
pub fn release_all_for_session(session: &str) -> usize {
    let mut map = registry().lock();
    map.remove(session.trim()).map(|v| v.len()).unwrap_or(0)
}

pub fn snapshot(session: &str) -> SessionGuardSnapshot {
    let map = registry().lock();
    let activities: Vec<SessionActivity> = map
        .get(session.trim())
        .map(|list| {
            list.iter()
                .map(|e| SessionActivity {
                    session: session.to_string(),
                    owner_id: e.owner_id.clone(),
                    purpose: e.purpose.as_str().to_string(),
                    acquired_at_ms: e.acquired_at_ms,
                })
                .collect()
        })
        .unwrap_or_default();
    let exclusive = activities.iter().any(|a| a.purpose == "exclusive");
    SessionGuardSnapshot {
        session: session.to_string(),
        activities,
        exclusive,
    }
}

/// RAII guard that releases on drop (best-effort for blocking scopes).
pub struct SessionGuardToken {
    session: String,
    owner_id: String,
    released: bool,
}

impl SessionGuardToken {
    pub fn acquire(
        session: &str,
        owner_id: &str,
        purpose: SessionPurpose,
    ) -> Result<Self, TgError> {
        acquire(session, owner_id, purpose)?;
        Ok(Self {
            session: session.to_string(),
            owner_id: owner_id.to_string(),
            released: false,
        })
    }

    pub fn release_now(&mut self) {
        if !self.released {
            release(&self.session, &self.owner_id);
            self.released = true;
        }
    }
}

impl Drop for SessionGuardToken {
    fn drop(&mut self) {
        self.release_now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_coexist_exclusive_blocks() {
        let key = format!("guard-test-{}", now_ms());
        let a = acquire(&key, "studio-1", SessionPurpose::Studio).unwrap();
        assert_eq!(a.purpose, "studio");
        acquire(&key, "migration-1", SessionPurpose::Migration).unwrap();
        let err = acquire(&key, "worker-1", SessionPurpose::Exclusive).unwrap_err();
        assert_eq!(err.code(), TgErrorCode::SessionLocked);
        release(&key, "studio-1");
        release(&key, "migration-1");
        acquire(&key, "worker-1", SessionPurpose::Exclusive).unwrap();
        let err2 = acquire(&key, "studio-2", SessionPurpose::Studio).unwrap_err();
        assert_eq!(err2.code(), TgErrorCode::SessionLocked);
        release(&key, "worker-1");
        assert!(snapshot(&key).activities.is_empty());
    }
}
