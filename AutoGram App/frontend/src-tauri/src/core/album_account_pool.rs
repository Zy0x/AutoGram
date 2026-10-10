//! album_account_pool.rs — Multi-Account Album Rotation & Failover Pool
//!
//! Provides round-robin rotation, per-account rate limit pacing, and instant
//! FloodWait failover across multiple authorized Telegram accounts for large
//! Visual Album batches.
//!
//! Invariants:
//! 1. Each 10-media album is sent completely by one account in a single `messages.SendMultiMedia`
//!    request, guaranteeing that Telegram renders a 100% intact visual collage grid.
//! 2. Micro-pacing (8.5s) and cooling breathers (35s) are tracked per-account. When Account A
//!    finishes an album, Account B can immediately send the next album with zero wait.
//! 3. If an account encounters `FLOOD_WAIT(N)` or rate limits, the pool marks that account in
//!    cooldown and immediately fails over to the next healthy account, preventing transfer stall.

use std::path::Path;
use std::time::{Duration, Instant};

use crate::core::job_queue::{self, TransferRecord};
use crate::core::telegram_ops::TelegramIdentity;
use crate::core::tg_log;

const LOG_TAG: &str = "album_account_pool";

/// Tracks the operational state and cooldown timer for a single Telegram account in the pool.
#[derive(Debug, Clone)]
pub struct PoolAccount {
    pub identity: TelegramIdentity,
    pub is_primary: bool,
    pub albums_sent: usize,
    pub had_floodwait: bool,
    pub next_ready_at: Instant,
    pub consecutive_errors: usize,
    pub is_active: bool,
}

impl PoolAccount {
    fn new(identity: TelegramIdentity, is_primary: bool) -> Self {
        Self {
            identity,
            is_primary,
            albums_sent: 0,
            had_floodwait: false,
            next_ready_at: Instant::now(),
            consecutive_errors: 0,
            is_active: true,
        }
    }

    fn is_ready_now(&self) -> bool {
        self.is_active && self.consecutive_errors < 3 && Instant::now() >= self.next_ready_at
    }

    fn is_usable(&self) -> bool {
        self.is_active && self.consecutive_errors < 3
    }
}

/// Parses alternate account session names from transfer record options.
/// Accepts either JSON array of strings or comma-separated string from the UI.
pub fn parse_alternate_sessions(options: &serde_json::Value) -> Vec<String> {
    options
        .get("alternate_account_pool")
        .or_else(|| options.get("alternateAccountPool"))
        .and_then(|value| {
            if let Some(arr) = value.as_array() {
                Some(
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .map(str::trim)
                        .filter(|v| !v.is_empty())
                        .map(str::to_string)
                        .collect(),
                )
            } else if let Some(s) = value.as_str() {
                Some(
                    s.split(',')
                        .map(str::trim)
                        .filter(|v| !v.is_empty())
                        .map(str::to_string)
                        .collect(),
                )
            } else {
                None
            }
        })
        .unwrap_or_default()
}

pub struct AlbumAccountPool {
    accounts: Vec<PoolAccount>,
    last_picked_index: usize,
}

impl AlbumAccountPool {
    /// Initializes the pool with the primary account and enrolls any valid approved alternate sessions.
    pub fn new(
        sessions_dir: &Path,
        primary: &TelegramIdentity,
        rec: &TransferRecord,
        chat_id: &str,
    ) -> Self {
        let mut accounts = Vec::new();
        accounts.push(PoolAccount::new(primary.clone(), true));

        let candidate_sessions = parse_alternate_sessions(&rec.options);
        let native_sessions = super::grammers_ops::list_native_sessions(sessions_dir);

        for session_name in candidate_sessions {
            let session_name = session_name.trim();
            if session_name.is_empty() || session_name == primary.session {
                continue;
            }

            // Verify session file exists in local native sessions
            let is_native = native_sessions
                .iter()
                .any(|cand| cand.name == session_name && cand.source.contains("grammers"));
            if !is_native {
                tg_log::warn(
                    LOG_TAG,
                    "alternate_skip_not_native",
                    format!("Session {session_name} is not a valid grammers native session"),
                );
                continue;
            }

            // Check if account has active FloodWait
            if let Some(wait) = crate::core::session_rate::flood_remaining_secs(session_name) {
                tg_log::warn(
                    LOG_TAG,
                    "alternate_skip_floodwait",
                    format!("Session {session_name} is currently in FloodWait ({wait}s)"),
                );
                continue;
            }

            let alt_identity = TelegramIdentity {
                session: session_name.to_string(),
                api_id: primary.api_id,
                api_hash: primary.api_hash.clone(),
            };

            // Enroll candidate into the active pool
            tg_log::info(
                LOG_TAG,
                "alternate_account_enrolled",
                format!(
                    "Enrolled alternate session {} for destination {chat_id}",
                    session_name
                ),
            );
            accounts.push(PoolAccount::new(alt_identity, false));
        }

        let enrolled_names: Vec<String> = accounts
            .iter()
            .map(|a| {
                format!(
                    "{}{}",
                    a.identity.session,
                    if a.is_primary { " (primary)" } else { "" }
                )
            })
            .collect();

        tg_log::info(
            LOG_TAG,
            "pool_initialized",
            format!(
                "Album pool ready with {} sender(s): [{}]",
                accounts.len(),
                enrolled_names.join(", ")
            ),
        );

        Self {
            accounts,
            last_picked_index: 0,
        }
    }

    /// Returns the total number of accounts in the pool.
    pub fn len(&self) -> usize {
        self.accounts.len()
    }

    /// Returns true if the pool contains more than one account.
    pub fn is_multi_account(&self) -> bool {
        self.accounts.len() > 1
    }

    /// Returns the primary TelegramIdentity.
    pub fn primary_identity(&self) -> TelegramIdentity {
        self.accounts[0].identity.clone()
    }

    /// Picks the next ready sender account for an album dispatch.
    ///
    /// If multiple accounts are ready now, selects round-robin among them.
    /// If all accounts are in cooldown, sleeps until the earliest account is ready
    /// (with cancel check), then returns that account.
    pub fn pick_sender_for_album(
        &mut self,
        tid: &str,
        app: Option<&tauri::AppHandle>,
    ) -> Result<TelegramIdentity, String> {
        if self.accounts.is_empty() {
            return Err("AlbumAccountPool has no active accounts".into());
        }

        // Single-account fast path
        if self.accounts.len() == 1 {
            let now = Instant::now();
            if self.accounts[0].next_ready_at > now {
                let wait_duration = self.accounts[0].next_ready_at - now;
                let wait_ms = wait_duration.as_millis() as u64;
                if !job_queue::sleep_inter_batch_pacing(tid, wait_ms) {
                    return Err("Transfer cancelled by user".into());
                }
            }
            return Ok(self.accounts[0].identity.clone());
        }

        // Multi-account rotation path
        let total = self.accounts.len();
        let now = Instant::now();

        // 1. Check if any usable account is ready right now
        let mut ready_indices = Vec::new();
        for i in 0..total {
            if self.accounts[i].is_ready_now() {
                ready_indices.push(i);
            }
        }

        if !ready_indices.is_empty() {
            // Pick next ready account in round-robin sequence from last_picked_index
            let selected_index = *ready_indices
                .iter()
                .find(|&&idx| idx > self.last_picked_index)
                .unwrap_or(&ready_indices[0]);

            self.last_picked_index = selected_index;
            let chosen = &self.accounts[selected_index];
            tg_log::info(
                LOG_TAG,
                "sender_picked_instant",
                format!(
                    "Picked sender [{}] (sent: {}, ready now, 0ms wait)",
                    chosen.identity.session, chosen.albums_sent
                ),
            );
            return Ok(chosen.identity.clone());
        }

        // 2. All usable accounts are currently in cooldown.
        // Find the usable account with the earliest next_ready_at.
        let mut usable_indices: Vec<usize> = (0..total)
            .filter(|&i| self.accounts[i].is_usable())
            .collect();

        if usable_indices.is_empty() {
            // If all accounts were marked unusable due to errors, reset primary as fallback
            self.accounts[0].is_active = true;
            self.accounts[0].consecutive_errors = 0;
            usable_indices.push(0);
        }

        usable_indices.sort_by_key(|&i| self.accounts[i].next_ready_at);
        let earliest_index = usable_indices[0];
        let earliest_ready = self.accounts[earliest_index].next_ready_at;

        let wait_duration = earliest_ready.saturating_duration_since(now);
        let wait_ms = wait_duration.as_millis() as u64;

        if wait_ms > 0 {
            tg_log::info(
                LOG_TAG,
                "all_senders_cooling",
                format!(
                    "All {} accounts cooling. Waiting {}ms for earliest sender [{}]...",
                    total, wait_ms, self.accounts[earliest_index].identity.session
                ),
            );
            if !job_queue::sleep_inter_batch_pacing(tid, wait_ms) {
                return Err("Transfer cancelled by user".into());
            }
        }

        self.last_picked_index = earliest_index;
        Ok(self.accounts[earliest_index].identity.clone())
    }

    /// Records that an album was successfully committed by `session`.
    /// Sets this account's cooldown based on standard Telegram attachment limits.
    pub fn record_album_success(&mut self, session: &str, items_count: usize, tid: &str) {
        if let Some(account) = self.accounts.iter_mut().find(|a| a.identity.session == session) {
            account.albums_sent += 1;
            account.consecutive_errors = 0;

            let (pacing_ms, is_breather) = job_queue::calculate_album_pacing_ms(
                account.albums_sent,
                items_count,
                account.had_floodwait,
            );

            account.next_ready_at = Instant::now() + Duration::from_millis(pacing_ms);

            if is_breather {
                let breather_secs = pacing_ms / 1000;
                let _ = job_queue::append_log(
                    tid,
                    "info",
                    "album_breather_pacing",
                    &format!(
                        "Akun {} memasuki jeda pendinginan ({}s) setelah {} album.",
                        session, breather_secs, account.albums_sent
                    ),
                );
            }

            tg_log::info(
                LOG_TAG,
                "album_success",
                format!(
                    "Account [{session}] sent album #{} (cooldown: {}ms)",
                    account.albums_sent, pacing_ms
                ),
            );
        }
    }

    /// Records that `session` encountered a FLOOD_WAIT penalty.
    /// Sets this account's next_ready_at to `now + wait_secs`.
    ///
    /// If an alternate account is available and ready, returns `Some(alternate_identity)`
    /// so the orchestrator can immediately fail over without aborting the transfer!
    pub fn record_album_floodwait(
        &mut self,
        session: &str,
        wait_secs: u32,
        tid: &str,
        app: Option<&tauri::AppHandle>,
    ) -> Option<TelegramIdentity> {
        let mut alternate_identity = None;

        if let Some(account) = self.accounts.iter_mut().find(|a| a.identity.session == session) {
            account.had_floodwait = true;
            account.next_ready_at = Instant::now() + Duration::from_secs(wait_secs as u64);
        }

        // Look for an alternate account that is usable and not in long floodwait
        for (idx, account) in self.accounts.iter().enumerate() {
            if account.identity.session != session && account.is_usable() {
                // If this alternate account is ready or will be ready within 5s, we can failover to it
                if account.next_ready_at <= Instant::now() + Duration::from_secs(5) {
                    self.last_picked_index = idx;
                    alternate_identity = Some(account.identity.clone());
                    break;
                }
            }
        }

        if let Some(ref alt) = alternate_identity {
            let msg = format!(
                "Akun [{session}] terkena FloodWait ({wait_secs}s). Berpindah otomatis ke akun cadangan [{}]...",
                alt.session
            );
            let _ = job_queue::append_log(tid, "warn", "album_floodwait_failover", &msg);
            crate::core::transfer_journal::TransferJournal::new(tid).append(
                "album_floodwait_failover",
                serde_json::json!({
                    "from_session": session,
                    "to_session": alt.session,
                    "flood_wait_secs": wait_secs,
                }),
            );
            tg_log::warn(LOG_TAG, "album_floodwait_failover", msg);
        }

        alternate_identity
    }

    /// Records an unhandled error for `session`.
    pub fn record_album_error(&mut self, session: &str) {
        if let Some(account) = self.accounts.iter_mut().find(|a| a.identity.session == session) {
            account.consecutive_errors += 1;
            if account.consecutive_errors >= 3 && !account.is_primary {
                account.is_active = false;
                tg_log::warn(
                    LOG_TAG,
                    "alternate_account_deactivated",
                    format!(
                        "Deactivating alternate account [{session}] after 3 consecutive errors"
                    ),
                );
            }
        }
    }

    /// Returns the sum of albums sent across all accounts in the pool.
    pub fn total_albums_sent(&self) -> usize {
        self.accounts.iter().map(|a| a.albums_sent).sum()
    }

    /// Returns true if any account in the pool has experienced a FloodWait error.
    pub fn any_had_floodwait(&self) -> bool {
        self.accounts.iter().any(|a| a.had_floodwait)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_alternate_sessions_supports_array_and_comma_separated() {
        let json_arr = serde_json::json!({
            "alternateAccountPool": ["tg_62881012533172", "session_1785668521"]
        });
        assert_eq!(
            parse_alternate_sessions(&json_arr),
            vec!["tg_62881012533172", "session_1785668521"]
        );

        let json_str = serde_json::json!({
            "alternate_account_pool": "tg_62881012533172, session_1785668521 , "
        });
        assert_eq!(
            parse_alternate_sessions(&json_str),
            vec!["tg_62881012533172", "session_1785668521"]
        );

        let empty = serde_json::json!({});
        assert!(parse_alternate_sessions(&empty).is_empty());
    }

    #[test]
    fn single_account_pool_pacing_and_accounting() {
        let primary = TelegramIdentity {
            session: "Lavender".into(),
            api_id: 12345,
            api_hash: "hash".into(),
        };
        let mut pool = AlbumAccountPool {
            accounts: vec![PoolAccount::new(primary.clone(), true)],
            last_picked_index: 0,
        };

        assert_eq!(pool.len(), 1);
        assert!(!pool.is_multi_account());

        pool.record_album_success("Lavender", 10, "test_job");
        assert_eq!(pool.total_albums_sent(), 1);
        assert!(pool.accounts[0].next_ready_at > Instant::now());
    }

    #[test]
    fn multi_account_rotation_instant_switch() {
        let primary = TelegramIdentity {
            session: "Lavender".into(),
            api_id: 12345,
            api_hash: "hash".into(),
        };
        let alternate = TelegramIdentity {
            session: "MantanGadis".into(),
            api_id: 12345,
            api_hash: "hash".into(),
        };

        let mut pool = AlbumAccountPool {
            accounts: vec![
                PoolAccount::new(primary.clone(), true),
                PoolAccount::new(alternate.clone(), false),
            ],
            last_picked_index: 0,
        };

        assert_eq!(pool.len(), 2);
        assert!(pool.is_multi_account());

        // Account 0 finishes album 1 -> set to 8.5s cooldown
        pool.record_album_success("Lavender", 10, "test_job");
        assert!(pool.accounts[0].next_ready_at > Instant::now());

        // Account 1 is still ready right now!
        let picked = pool.pick_sender_for_album("test_job", None).unwrap();
        assert_eq!(picked.session, "MantanGadis");

        // Failover on floodwait
        let failover = pool.record_album_floodwait("Lavender", 60, "test_job", None);
        assert_eq!(failover.unwrap().session, "MantanGadis");
    }
}
