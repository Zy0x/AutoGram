use rusqlite::{params, Connection};
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

const SCHEMA: &str =
    include_str!("../../../../database/migrations/015_transfer_control_plane_v4.sql");

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn open() -> Result<Connection, String> {
    let path = crate::storage::resolve_migrator_db();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create database dir: {e}"))?;
    }
    let conn = Connection::open(path).map_err(|e| format!("open transfer store: {e}"))?;
    conn.execute_batch(
        "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=15000; PRAGMA journal_mode=WAL;",
    )
    .map_err(|e| format!("transfer store pragma: {e}"))?;
    conn.execute_batch(SCHEMA)
        .map_err(|e| format!("transfer store schema: {e}"))?;
    Ok(conn)
}

pub fn freeze_transfer_run<T: Serialize>(transfer_id: &str, profile: &T) -> Result<(), String> {
    let profile_json = serde_json::to_string(profile).map_err(|e| e.to_string())?;
    let now = now_ms();
    open()?
        .execute(
            "INSERT INTO transfer_runs (transfer_id, profile_snapshot_json, state, created_at, updated_at)
             VALUES (?1, ?2, 'RUNNING', ?3, ?3)
             ON CONFLICT(transfer_id) DO UPDATE SET profile_snapshot_json=excluded.profile_snapshot_json, updated_at=excluded.updated_at",
            params![transfer_id, profile_json, now],
        )
        .map_err(|e| format!("freeze transfer profile: {e}"))?;
    Ok(())
}

pub fn update_transfer_run_state(transfer_id: &str, state: &str) -> Result<(), String> {
    let normalized = match state {
        "COMPLETED" | "FAILED" | "CANCELLED" | "REVIEW_REQUIRED" => state,
        _ => return Err(format!("invalid transfer run state: {state}")),
    };
    let changed = open()?
        .execute(
            "UPDATE transfer_runs SET state=?2, updated_at=?3 WHERE transfer_id=?1",
            params![transfer_id, normalized, now_ms()],
        )
        .map_err(|e| format!("update transfer run state: {e}"))?;
    if changed == 0 {
        return Err(format!("transfer run not found: {transfer_id}"));
    }
    Ok(())
}

pub fn load_media_analysis<T: serde::de::DeserializeOwned>(
    cache_key: &str,
    schema_version: u32,
    source_size: u64,
    source_mtime_ms: i64,
) -> Result<Option<T>, String> {
    let conn = open()?;
    let result = conn.query_row(
        "SELECT analysis_json FROM media_analysis_cache
         WHERE cache_key=?1 AND schema_version=?2 AND source_size=?3
         AND source_mtime_ms=?4 LIMIT 1",
        params![
            cache_key,
            schema_version as i64,
            source_size as i64,
            source_mtime_ms
        ],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(value) => serde_json::from_str(&value)
            .map(Some)
            .map_err(|error| format!("decode media analysis: {error}")),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("load media analysis: {error}")),
    }
}

pub fn persist_media_analysis<T: Serialize>(
    cache_key: &str,
    schema_version: u32,
    source_size: u64,
    source_mtime_ms: i64,
    analysis: &T,
) -> Result<(), String> {
    let analysis_json = serde_json::to_string(analysis).map_err(|error| error.to_string())?;
    let now = now_ms();
    open()?
        .execute(
            "INSERT INTO media_analysis_cache
             (cache_key, schema_version, source_size, source_mtime_ms, analysis_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
             ON CONFLICT(cache_key) DO UPDATE SET schema_version=excluded.schema_version,
             source_size=excluded.source_size, source_mtime_ms=excluded.source_mtime_ms,
             analysis_json=excluded.analysis_json, updated_at=excluded.updated_at",
            params![
                cache_key,
                schema_version as i64,
                source_size as i64,
                source_mtime_ms,
                analysis_json,
                now
            ],
        )
        .map_err(|error| format!("persist media analysis: {error}"))?;
    Ok(())
}

pub fn persist_transfer_decision<T: Serialize>(
    cache_key: &str,
    analysis_key: &str,
    profile_digest: &str,
    capability_digest: &str,
    decision: &T,
) -> Result<(), String> {
    let decision_json = serde_json::to_string(decision).map_err(|error| error.to_string())?;
    let now = now_ms();
    open()?
        .execute(
            "INSERT INTO transfer_decision_cache
             (cache_key, analysis_key, profile_digest, capability_digest, decision_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
             ON CONFLICT(cache_key) DO UPDATE SET decision_json=excluded.decision_json,
             updated_at=excluded.updated_at",
            params![
                cache_key,
                analysis_key,
                profile_digest,
                capability_digest,
                decision_json,
                now
            ],
        )
        .map_err(|error| format!("persist transfer decision: {error}"))?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn record_transfer_item_decision(
    transfer_id: &str,
    item_index: usize,
    source_path: &str,
    prepared_path: &str,
    media_category: &str,
    payload_class: &str,
    transform_action: &str,
    state: &str,
    reason_code: &str,
) -> Result<(), String> {
    open()?
        .execute(
            "INSERT INTO transfer_items_v4
             (transfer_id, item_index, source_path, prepared_path, media_category,
              payload_class, transform_action, state, reason_code, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(transfer_id, item_index) DO UPDATE SET
              prepared_path=excluded.prepared_path, media_category=excluded.media_category,
              payload_class=excluded.payload_class, transform_action=excluded.transform_action,
              state=excluded.state, reason_code=excluded.reason_code,
              updated_at=excluded.updated_at",
            params![
                transfer_id,
                item_index as i64,
                source_path,
                prepared_path,
                media_category,
                payload_class,
                transform_action,
                state,
                reason_code,
                now_ms()
            ],
        )
        .map_err(|error| format!("record transfer item decision: {error}"))?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadLedgerMatch {
    pub telegram_message_id: Option<i64>,
    pub telegram_unique_id: Option<String>,
    pub match_level: String,
    pub filename: String,
    pub file_size: u64,
    pub payload_class: String,
}

pub fn find_upload_ledger_match(
    account_id: &str,
    destination_id: &str,
    topic_id: Option<i64>,
    prepared_sha256: &str,
    filename: &str,
    file_size: u64,
) -> Result<Option<UploadLedgerMatch>, String> {
    let conn = open()?;
    let topic_key = topic_id.unwrap_or(0);
    let exact = conn.query_row(
        "SELECT telegram_message_id, telegram_unique_id, filename, file_size, payload_class
         FROM upload_ledger
         WHERE account_id=?1 AND destination_id=?2 AND topic_id=?3 AND prepared_sha256=?4
         ORDER BY updated_at DESC LIMIT 1",
        params![account_id, destination_id, topic_key, prepared_sha256],
        |row| {
            Ok((
                row.get::<_, Option<i64>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
            ))
        },
    );
    match exact {
        Ok((message_id, unique_id, filename, file_size, payload_class)) => {
            return Ok(Some(UploadLedgerMatch {
                telegram_message_id: message_id,
                telegram_unique_id: unique_id,
                match_level: "exact_sha256".into(),
                filename,
                file_size: file_size.max(0) as u64,
                payload_class,
            }))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => {}
        Err(error) => return Err(format!("query upload ledger hash: {error}")),
    }
    let probable = conn.query_row(
        "SELECT telegram_message_id, telegram_unique_id, filename, file_size, payload_class
         FROM upload_ledger
         WHERE account_id=?1 AND destination_id=?2 AND topic_id=?3
           AND filename=?4 AND file_size=?5
         ORDER BY updated_at DESC LIMIT 1",
        params![
            account_id,
            destination_id,
            topic_key,
            filename,
            file_size as i64
        ],
        |row| {
            Ok((
                row.get::<_, Option<i64>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
            ))
        },
    );
    match probable {
        Ok((message_id, unique_id, filename, file_size, payload_class)) => {
            Ok(Some(UploadLedgerMatch {
                telegram_message_id: message_id,
                telegram_unique_id: unique_id,
                match_level: "probable_filename_size".into(),
                filename,
                file_size: file_size.max(0) as u64,
                payload_class,
            }))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("query upload ledger filename: {error}")),
    }
}

#[allow(clippy::too_many_arguments)]
pub fn record_upload_ledger(
    account_id: &str,
    destination_id: &str,
    topic_id: Option<i64>,
    telegram_message_id: Option<i64>,
    telegram_unique_id: Option<&str>,
    prepared_sha256: &str,
    filename: &str,
    file_size: u64,
    payload_class: &str,
) -> Result<(), String> {
    let now = now_ms();
    let topic_key = topic_id.unwrap_or(0);
    open()?
        .execute(
            "INSERT INTO upload_ledger
             (account_id, destination_id, topic_id, telegram_message_id,
              telegram_unique_id, prepared_sha256, filename, file_size,
              payload_class, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
             ON CONFLICT(account_id, destination_id, topic_id, prepared_sha256)
             DO UPDATE SET telegram_message_id=excluded.telegram_message_id,
               telegram_unique_id=COALESCE(excluded.telegram_unique_id, upload_ledger.telegram_unique_id),
               filename=excluded.filename, file_size=excluded.file_size,
               payload_class=excluded.payload_class, updated_at=excluded.updated_at",
            params![
                account_id,
                destination_id,
                topic_key,
                telegram_message_id,
                telegram_unique_id,
                prepared_sha256,
                filename,
                file_size as i64,
                payload_class,
                now
            ],
        )
        .map_err(|error| format!("record upload ledger: {error}"))?;
    Ok(())
}

/// Remove upload-ledger bindings for Telegram messages that were confirmed
/// deleted.  A ledger row is only a local dedupe hint; retaining it after a
/// successful Telegram delete makes the next preflight report a non-existent
/// message as "already in Telegram" (and its thumbnail can never resolve).
pub fn invalidate_upload_ledger_messages(
    account_id: &str,
    destination_id: &str,
    message_ids: &[i64],
) -> Result<usize, String> {
    let ids: Vec<i64> = message_ids.iter().copied().filter(|id| *id > 0).collect();
    if ids.is_empty() {
        return Ok(0);
    }
    let conn = open()?;
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| format!("begin ledger invalidation: {error}"))?;
    let mut removed = 0usize;
    for id in ids {
        removed += tx
            .execute(
                "DELETE FROM upload_ledger
                 WHERE account_id=?1 AND destination_id=?2 AND telegram_message_id=?3",
                params![account_id, destination_id, id],
            )
            .map_err(|error| format!("invalidate ledger message {id}: {error}"))?;
    }
    tx.commit()
        .map_err(|error| format!("commit ledger invalidation: {error}"))?;
    Ok(removed)
}

pub fn create_album_commit<T: Serialize, P: Serialize>(
    commit_id: &str,
    transfer_id: &str,
    compatibility_key: &T,
    indices: &[usize],
    payload: &P,
) -> Result<Vec<i64>, String> {
    let key_json = serde_json::to_string(compatibility_key).map_err(|e| e.to_string())?;
    let indices_json = serde_json::to_string(indices).map_err(|e| e.to_string())?;
    let payload_json = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    let random_ids: Vec<i64> = (0..indices.len()).map(|_| rand::random()).collect();
    let random_ids_json = serde_json::to_string(&random_ids).map_err(|e| e.to_string())?;
    let payload_digest = super::download::sha256_bytes(payload_json.as_bytes());
    let context_digest = super::download::sha256_bytes(key_json.as_bytes());
    let now = now_ms();
    let mut conn = open()?;
    let transaction = conn
        .transaction()
        .map_err(|e| format!("begin album commit: {e}"))?;
    transaction
        .execute(
            "INSERT OR REPLACE INTO album_commits
             (commit_id, transfer_id, compatibility_key_json, ordered_item_indices_json, state, attempt_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'PREPARED', 0, ?5, ?5)",
            params![commit_id, transfer_id, key_json, indices_json, now],
        )
        .map_err(|e| format!("create album commit: {e}"))?;
    transaction
        .execute(
            "INSERT OR REPLACE INTO album_commit_intents
             (commit_id, random_ids_json, expected_count, payload_digest, context_digest,
              grouped_id, verified_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, ?6)",
            params![
                commit_id,
                random_ids_json,
                indices.len() as i64,
                payload_digest,
                context_digest,
                now
            ],
        )
        .map_err(|e| format!("persist album commit intent: {e}"))?;
    transaction
        .commit()
        .map_err(|e| format!("commit album intent: {e}"))?;
    Ok(random_ids)
}

pub fn verify_album_commit_intent(commit_id: &str, grouped_id: Option<i64>) -> Result<(), String> {
    let changed = open()?
        .execute(
            "UPDATE album_commit_intents SET grouped_id=?2, verified_at=?3, updated_at=?3
             WHERE commit_id=?1",
            params![commit_id, grouped_id, now_ms()],
        )
        .map_err(|e| format!("verify album commit intent: {e}"))?;
    if changed == 0 {
        return Err(format!("album commit intent not found: {commit_id}"));
    }
    Ok(())
}

pub fn update_album_commit(
    commit_id: &str,
    state: &str,
    message_ids: &[i64],
    error: Option<&str>,
) -> Result<(), String> {
    let message_ids_json = serde_json::to_string(message_ids).map_err(|e| e.to_string())?;
    open()?
        .execute(
            "UPDATE album_commits SET state=?2, telegram_message_ids_json=?3, last_error=?4,
             attempt_count=attempt_count+1, updated_at=?5 WHERE commit_id=?1",
            params![commit_id, state, message_ids_json, error, now_ms()],
        )
        .map_err(|e| format!("update album commit: {e}"))?;
    Ok(())
}

/// Return the source-item/message pairs recorded during an album recovery.
/// The ordered item list is persisted separately from Telegram message IDs,
/// so zipping the two arrays gives the exact mapping needed by the
/// orchestrator to retry only missing items after a partial commit.
pub fn load_album_commit_recovered(commit_id: &str) -> Result<Vec<(usize, i64)>, String> {
    let conn = open()?;
    let row = conn.query_row(
        "SELECT ordered_item_indices_json, telegram_message_ids_json
         FROM album_commits WHERE commit_id=?1",
        params![commit_id],
        |row| {
            let indices: String = row.get(0)?;
            let message_ids: Option<String> = row.get(1)?;
            Ok((indices, message_ids))
        },
    );
    let (indices_json, ids_json) = match row {
        Ok(value) => value,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(Vec::new()),
        Err(error) => return Err(format!("load album recovery: {error}")),
    };
    let indices: Vec<usize> = serde_json::from_str(&indices_json)
        .map_err(|error| format!("decode album item indices: {error}"))?;
    let ids: Vec<i64> = ids_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|error| format!("decode album message ids: {error}"))?
        .unwrap_or_default();
    Ok(indices
        .into_iter()
        .zip(ids)
        .filter(|(_, message_id)| *message_id > 0)
        .collect())
}

pub fn persist_account_rate_gate(
    account_id: &str,
    wait_seconds: u32,
    reason: &str,
) -> Result<(), String> {
    let now = now_ms();
    let blocked_until = now.saturating_add(i64::from(wait_seconds) * 1_000);
    open()?
        .execute(
            "INSERT INTO account_rate_gates (account_id, blocked_until, reason, consecutive_flood_waits, updated_at)
             VALUES (?1, ?2, ?3, 1, ?4)
             ON CONFLICT(account_id) DO UPDATE SET blocked_until=MAX(account_rate_gates.blocked_until, excluded.blocked_until),
             reason=excluded.reason, consecutive_flood_waits=account_rate_gates.consecutive_flood_waits+1, updated_at=excluded.updated_at",
            params![account_id, blocked_until, reason, now],
        )
        .map_err(|e| format!("persist account rate gate: {e}"))?;
    Ok(())
}

pub fn load_account_rate_gate(account_id: &str) -> Result<Option<u32>, String> {
    let conn = open()?;
    let result = conn.query_row(
        "SELECT blocked_until FROM account_rate_gates WHERE account_id=?1",
        params![account_id],
        |row| row.get::<_, Option<i64>>(0),
    );
    let blocked_until = match result {
        Ok(value) => value,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(error) => return Err(format!("load account rate gate: {error}")),
    };
    let remaining_ms = blocked_until.unwrap_or(0).saturating_sub(now_ms());
    if remaining_ms <= 0 {
        return Ok(None);
    }
    Ok(Some(((remaining_ms + 999) / 1_000) as u32))
}

pub fn persist_class_rate_gate(
    account_id: &str,
    rpc_class: &str,
    wait_seconds: u32,
    reason: &str,
) -> Result<(), String> {
    let key = format!("{account_id}:{rpc_class}");
    let now = now_ms();
    let blocked_until = now.saturating_add(i64::from(wait_seconds) * 1_000);
    open()?
        .execute(
            "INSERT INTO account_rate_gates (account_id, blocked_until, reason, consecutive_flood_waits, updated_at)
             VALUES (?1, ?2, ?3, 1, ?4)
             ON CONFLICT(account_id) DO UPDATE SET blocked_until=MAX(account_rate_gates.blocked_until, excluded.blocked_until),
             reason=excluded.reason, consecutive_flood_waits=account_rate_gates.consecutive_flood_waits+1, updated_at=excluded.updated_at",
            params![key, blocked_until, reason, now],
        )
        .map_err(|e| format!("persist class rate gate: {e}"))?;
    Ok(())
}

pub fn load_class_rate_gate(account_id: &str, rpc_class: &str) -> Result<Option<u32>, String> {
    let key = format!("{account_id}:{rpc_class}");
    let conn = open()?;
    let result = conn.query_row(
        "SELECT blocked_until FROM account_rate_gates WHERE account_id=?1",
        params![key],
        |row| row.get::<_, Option<i64>>(0),
    );
    let blocked_until = match result {
        Ok(value) => value,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(error) => return Err(format!("load class rate gate: {error}")),
    };
    let remaining_ms = blocked_until.unwrap_or(0).saturating_sub(now_ms());
    if remaining_ms <= 0 {
        return Ok(None);
    }
    Ok(Some(((remaining_ms + 999) / 1_000) as u32))
}

pub fn persist_account_capability<T: Serialize>(
    account_id: &str,
    capability: &T,
    expires_at: i64,
) -> Result<(), String> {
    let capability_json = serde_json::to_string(capability).map_err(|error| error.to_string())?;
    open()?
        .execute(
            "INSERT INTO account_capabilities (account_id, capability_json, expires_at, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(account_id) DO UPDATE SET capability_json=excluded.capability_json,
             expires_at=excluded.expires_at, updated_at=excluded.updated_at",
            params![account_id, capability_json, expires_at, now_ms()],
        )
        .map_err(|error| format!("persist account capability: {error}"))?;
    Ok(())
}

pub fn load_account_capability<T: serde::de::DeserializeOwned>(
    account_id: &str,
) -> Result<Option<T>, String> {
    let conn = open()?;
    let result = conn.query_row(
        "SELECT capability_json FROM account_capabilities
         WHERE account_id=?1 AND expires_at>?2 LIMIT 1",
        params![account_id, now_ms()],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(value) => serde_json::from_str(&value)
            .map(Some)
            .map_err(|error| format!("decode account capability: {error}")),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("load account capability: {error}")),
    }
}

pub fn record_alternate_upload(
    transfer_id: &str,
    item_index: usize,
    uploader_account_id: &str,
    telegram_message_id: Option<i64>,
) -> Result<(), String> {
    open()?
        .execute(
            "INSERT INTO alternate_upload_bindings
             (transfer_id, item_index, uploader_account_id, telegram_message_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(transfer_id, item_index) DO UPDATE SET
             uploader_account_id=excluded.uploader_account_id,
             telegram_message_id=excluded.telegram_message_id",
            params![
                transfer_id,
                item_index as i64,
                uploader_account_id,
                telegram_message_id,
                now_ms()
            ],
        )
        .map_err(|error| format!("record alternate upload: {error}"))?;
    Ok(())
}

pub fn begin_encoder_receipt<T: Serialize>(
    receipt_id: &str,
    transfer_id: &str,
    item_index: usize,
    strategy: &str,
    device_id: Option<&str>,
    input: &T,
) -> Result<(), String> {
    let input_json = serde_json::to_string(input).map_err(|error| error.to_string())?;
    let now = now_ms();
    open()?
        .execute(
            "INSERT INTO encoder_receipts
             (receipt_id, transfer_id, item_index, strategy, device_id, input_json,
              output_json, validation_json, state, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, 'PREPARING', ?7, ?7)
             ON CONFLICT(receipt_id) DO UPDATE SET
              strategy=excluded.strategy, device_id=excluded.device_id,
              input_json=excluded.input_json, output_json=NULL, validation_json=NULL,
              state='PREPARING', updated_at=excluded.updated_at",
            params![
                receipt_id,
                transfer_id,
                item_index as i64,
                strategy,
                device_id,
                input_json,
                now
            ],
        )
        .map_err(|error| format!("begin encoder receipt: {error}"))?;
    Ok(())
}

pub fn finish_encoder_receipt<O: Serialize, V: Serialize>(
    receipt_id: &str,
    state: &str,
    output: Option<&O>,
    validation: &V,
) -> Result<(), String> {
    let normalized = match state {
        "PASSTHROUGH" | "COMPLETED" | "FAILED" => state,
        _ => return Err(format!("invalid encoder receipt state: {state}")),
    };
    let output_json = output
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| error.to_string())?;
    let validation_json = serde_json::to_string(validation).map_err(|error| error.to_string())?;
    let changed = open()?
        .execute(
            "UPDATE encoder_receipts SET output_json=?2, validation_json=?3,
             state=?4, updated_at=?5 WHERE receipt_id=?1",
            params![
                receipt_id,
                output_json,
                validation_json,
                normalized,
                now_ms()
            ],
        )
        .map_err(|error| format!("finish encoder receipt: {error}"))?;
    if changed == 0 {
        return Err(format!("encoder receipt not found: {receipt_id}"));
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct DownloadRangeCheckpoint {
    pub offset: u64,
    pub length: u64,
    pub sha256: String,
}

pub fn download_receipt_matches(
    receipt_id: &str,
    partial_path: &str,
    expected_size: u64,
) -> Result<bool, String> {
    let conn = open()?;
    let result = conn.query_row(
        "SELECT 1 FROM download_receipts
         WHERE receipt_id=?1 AND partial_path=?2 AND expected_size=?3 LIMIT 1",
        params![receipt_id, partial_path, expected_size as i64],
        |_| Ok(()),
    );
    match result {
        Ok(()) => Ok(true),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(error) => Err(format!("match download receipt: {error}")),
    }
}

#[allow(clippy::too_many_arguments)]
pub fn begin_download_receipt(
    receipt_id: &str,
    transfer_id: &str,
    item_index: usize,
    conflict_policy: &str,
    partial_path: &str,
    final_path: &str,
    bytes_written: u64,
    expected_size: u64,
    expected_hash: Option<&str>,
) -> Result<(), String> {
    open()?
        .execute(
            "INSERT INTO download_receipts
             (receipt_id, transfer_id, item_index, conflict_policy, partial_path, final_path,
              bytes_written, expected_size, expected_hash, state, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'DOWNLOADING', ?10)
             ON CONFLICT(receipt_id) DO UPDATE SET
              transfer_id=excluded.transfer_id, item_index=excluded.item_index,
              conflict_policy=excluded.conflict_policy, partial_path=excluded.partial_path,
              final_path=excluded.final_path, bytes_written=excluded.bytes_written,
              expected_size=excluded.expected_size, expected_hash=excluded.expected_hash,
              state='DOWNLOADING', updated_at=excluded.updated_at",
            params![
                receipt_id,
                transfer_id,
                item_index as i64,
                conflict_policy,
                partial_path,
                final_path,
                bytes_written as i64,
                expected_size as i64,
                expected_hash,
                now_ms()
            ],
        )
        .map_err(|error| format!("begin download receipt: {error}"))?;
    Ok(())
}

pub fn persist_download_ranges(
    receipt_id: &str,
    checkpoints: &[DownloadRangeCheckpoint],
    bytes_written: u64,
) -> Result<(), String> {
    if checkpoints.is_empty() {
        return Ok(());
    }
    let mut conn = open()?;
    let transaction = conn
        .transaction()
        .map_err(|error| format!("begin download range transaction: {error}"))?;
    for checkpoint in checkpoints {
        transaction
            .execute(
                "INSERT INTO download_ranges
                 (receipt_id, byte_offset, byte_length, sha256, state, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'VERIFIED', ?5)
                 ON CONFLICT(receipt_id, byte_offset) DO UPDATE SET
                  byte_length=excluded.byte_length, sha256=excluded.sha256,
                  state='VERIFIED', updated_at=excluded.updated_at",
                params![
                    receipt_id,
                    checkpoint.offset as i64,
                    checkpoint.length as i64,
                    checkpoint.sha256,
                    now_ms()
                ],
            )
            .map_err(|error| format!("persist download range: {error}"))?;
    }
    transaction
        .execute(
            "UPDATE download_receipts SET bytes_written=?2, updated_at=?3 WHERE receipt_id=?1",
            params![receipt_id, bytes_written as i64, now_ms()],
        )
        .map_err(|error| format!("update download receipt bytes: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("commit download ranges: {error}"))?;
    Ok(())
}

pub fn reset_download_ranges(receipt_id: &str) -> Result<(), String> {
    open()?
        .execute(
            "DELETE FROM download_ranges WHERE receipt_id=?1",
            params![receipt_id],
        )
        .map_err(|error| format!("reset download ranges: {error}"))?;
    Ok(())
}

pub fn finish_download_receipt(
    receipt_id: &str,
    state: &str,
    bytes_written: u64,
    actual_hash: Option<&str>,
) -> Result<(), String> {
    let normalized = match state {
        "COMPLETED" | "SKIPPED" | "FAILED" | "CANCELLED" => state,
        _ => return Err(format!("invalid download receipt state: {state}")),
    };
    open()?
        .execute(
            "UPDATE download_receipts SET state=?2, bytes_written=?3,
             expected_hash=COALESCE(expected_hash, ?4), updated_at=?5 WHERE receipt_id=?1",
            params![
                receipt_id,
                normalized,
                bytes_written as i64,
                actual_hash,
                now_ms()
            ],
        )
        .map_err(|error| format!("finish download receipt: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='album_commits'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let ranges: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='download_ranges'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(ranges, 1);
        let ledger: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='upload_ledger'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(ledger, 1);
    }
}
