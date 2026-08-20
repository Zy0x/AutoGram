//! Studio / transfer job queue (Rust).
//! Owns ordered item state for the Rust/Grammers Studio orchestrator.

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

static DB_PATH: OnceLock<PathBuf> = OnceLock::new();
static LIVE: OnceLock<RwLock<HashMap<String, TransferRecord>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ItemState {
    Pending,
    Preparing,
    Uploading,
    Committing,
    UnknownCommit,
    Reconciling,
    Done,
    Failed,
    Skipped,
}

impl Default for ItemState {
    fn default() -> Self {
        ItemState::Pending
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransferState {
    Queued,
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

impl Default for TransferState {
    fn default() -> Self {
        TransferState::Queued
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub index: usize,
    pub path: String,
    pub caption: String,
    pub size: u64,
    pub state: ItemState,
    pub message_id: Option<i64>,
    pub error: Option<String>,
    pub item_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferRecord {
    pub transfer_id: String,
    pub session: String,
    pub api_id: i64,
    pub chat_id: String,
    pub topic_id: Option<i64>,
    pub state: TransferState,
    pub items: Vec<QueueItem>,
    pub options: serde_json::Value,
    pub created_at_ms: u128,
    pub updated_at_ms: u128,
    pub done_count: usize,
    pub failed_count: usize,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn live() -> &'static RwLock<HashMap<String, TransferRecord>> {
    LIVE.get_or_init(|| RwLock::new(HashMap::new()))
}

pub fn init_queue_path(path: PathBuf) {
    let _ = DB_PATH.set(path.clone());
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    // Load persisted map if present
    if let Ok(data) = fs::read_to_string(&path) {
        if let Ok(map) = serde_json::from_str::<HashMap<String, TransferRecord>>(&data) {
            *live().write() = map;
        }
    }
}

fn persist() {
    if let Some(path) = DB_PATH.get() {
        let map = live().read().clone();
        if let Ok(data) = serde_json::to_string_pretty(&map) {
            let _ = fs::write(path, data);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTransferRequest {
    pub session: String,
    pub api_id: i64,
    pub api_hash: String,
    pub chat_id: String,
    pub topic_id: Option<i64>,
    pub files: Vec<CreateFileEntry>,
    pub options: Option<serde_json::Value>,
    pub transfer_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFileEntry {
    pub path: String,
    pub caption: Option<String>,
    pub size: Option<u64>,
}

pub fn create_transfer(req: CreateTransferRequest) -> Result<TransferRecord, String> {
    if req.session.trim().is_empty() {
        return Err("session required".into());
    }
    if req.chat_id.trim().is_empty() {
        return Err("chat_id required".into());
    }
    if req.files.is_empty() {
        return Err("files required".into());
    }
    let tid = req
        .transfer_id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("t-{}", now_ms()));
    let mut items = Vec::new();
    for (i, f) in req.files.iter().enumerate() {
        let path = f.path.trim().to_string();
        if path.is_empty() {
            return Err(format!("empty path at index {i}"));
        }
        // Path policy
        crate::core::path_policy::assert_safe_transfer_path(&path)?;
        let size = f
            .size
            .unwrap_or_else(|| fs::metadata(&path).map(|m| m.len()).unwrap_or(0));
        items.push(QueueItem {
            index: i,
            path: path.clone(),
            caption: f.caption.clone().unwrap_or_default(),
            size,
            state: ItemState::Pending,
            message_id: None,
            error: None,
            item_id: format!("{tid}:{i}"),
        });
    }
    let mut opts = req.options.unwrap_or_else(|| serde_json::json!({}));
    if let Some(obj) = opts.as_object_mut() {
        obj.insert("transfer_id".into(), serde_json::json!(tid));
        obj.insert("transferId".into(), serde_json::json!(tid));
        if let Some(t) = req.topic_id {
            obj.insert("topic_id".into(), serde_json::json!(t));
            obj.insert("topicId".into(), serde_json::json!(t));
        }
    }
    let rec = TransferRecord {
        transfer_id: tid.clone(),
        session: req.session,
        api_id: req.api_id,
        chat_id: req.chat_id,
        topic_id: req.topic_id,
        state: TransferState::Queued,
        items,
        options: opts,
        created_at_ms: now_ms(),
        updated_at_ms: now_ms(),
        done_count: 0,
        failed_count: 0,
    };
    // stash api_hash outside record for orch (not persisted in list API)
    live().write().insert(tid, rec.clone());
    persist();
    Ok(rec)
}

pub fn get_transfer(transfer_id: &str) -> Option<TransferRecord> {
    live().read().get(transfer_id).cloned()
}

pub fn list_transfers() -> Vec<TransferRecord> {
    let mut v: Vec<_> = live().read().values().cloned().collect();
    v.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    v
}

fn can_dismiss_state(state: &TransferState) -> bool {
    !matches!(
        state,
        TransferState::Running | TransferState::Queued | TransferState::Paused
    )
}

/// Remove a transfer only after it is no longer executable. The UI cancels a
/// recovered/stale job first, then dismisses it, so an active upload can never
/// be silently erased from the durable journal.
pub fn dismiss_transfer(transfer_id: &str) -> Result<bool, String> {
    let mut map = live().write();
    let Some(record) = map.get(transfer_id) else {
        return Ok(false);
    };
    if !can_dismiss_state(&record.state) {
        return Err("transfer must be cancelled before it can be dismissed".into());
    }
    let removed = map.remove(transfer_id).is_some();
    drop(map);
    cancelled_set().write().remove(transfer_id);
    paused_set().write().remove(transfer_id);
    persist();
    Ok(removed)
}

pub fn update_item(
    transfer_id: &str,
    index: usize,
    state: ItemState,
    message_id: Option<i64>,
    error: Option<String>,
) -> Result<TransferRecord, String> {
    let mut map = live().write();
    let rec = map
        .get_mut(transfer_id)
        .ok_or_else(|| "transfer not found".to_string())?;
    let item = rec
        .items
        .get_mut(index)
        .ok_or_else(|| "item index out of range".to_string())?;
    item.state = state.clone();
    if message_id.is_some() {
        item.message_id = message_id;
    }
    if error.is_some() {
        item.error = error;
    }
    rec.done_count = rec
        .items
        .iter()
        .filter(|i| i.state == ItemState::Done || i.state == ItemState::Skipped)
        .count();
    rec.failed_count = rec
        .items
        .iter()
        .filter(|i| i.state == ItemState::Failed)
        .count();
    rec.updated_at_ms = now_ms();
    if rec.done_count + rec.failed_count >= rec.items.len() {
        rec.state = if rec.failed_count == 0 {
            TransferState::Completed
        } else if rec.done_count == 0 {
            TransferState::Failed
        } else {
            TransferState::Completed
        };
    } else {
        rec.state = TransferState::Running;
    }
    let out = rec.clone();
    drop(map);
    persist();
    Ok(out)
}

pub fn set_transfer_state(transfer_id: &str, state: TransferState) -> Result<(), String> {
    let mut map = live().write();
    let rec = map
        .get_mut(transfer_id)
        .ok_or_else(|| "transfer not found".to_string())?;
    rec.state = state;
    rec.updated_at_ms = now_ms();
    drop(map);
    persist();
    Ok(())
}

static CANCELLED_TRANSFER_IDS: OnceLock<RwLock<std::collections::HashSet<String>>> =
    OnceLock::new();
static CANCEL_ALL_TRANSFERS: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
static PAUSE_ALL_TRANSFERS: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
static PAUSED_TRANSFER_IDS: OnceLock<RwLock<std::collections::HashSet<String>>> =
    OnceLock::new();

fn cancelled_set() -> &'static RwLock<std::collections::HashSet<String>> {
    CANCELLED_TRANSFER_IDS.get_or_init(|| RwLock::new(std::collections::HashSet::new()))
}

fn paused_set() -> &'static RwLock<std::collections::HashSet<String>> {
    PAUSED_TRANSFER_IDS.get_or_init(|| RwLock::new(std::collections::HashSet::new()))
}

pub fn cancel_transfer(transfer_id: Option<&str>) {
    if let Some(tid) = transfer_id {
        cancelled_set().write().insert(tid.to_string());
        let _ = set_transfer_state(tid, TransferState::Cancelled);
    } else {
        CANCEL_ALL_TRANSFERS.store(true, std::sync::atomic::Ordering::SeqCst);
        let mut map = live().write();
        let mut set = cancelled_set().write();
        for (id, rec) in map.iter_mut() {
            if rec.state == TransferState::Running || rec.state == TransferState::Queued {
                rec.state = TransferState::Cancelled;
                set.insert(id.clone());
            }
        }
    }
}

pub fn clear_cancel_flag_for(transfer_id: &str) {
    CANCEL_ALL_TRANSFERS.store(false, std::sync::atomic::Ordering::SeqCst);
    cancelled_set().write().remove(transfer_id);
    paused_set().write().remove(transfer_id);
}

pub fn clear_all_cancel_flags() {
    CANCEL_ALL_TRANSFERS.store(false, std::sync::atomic::Ordering::SeqCst);
    cancelled_set().write().clear();
}

pub fn is_transfer_cancelled(transfer_id: &str) -> bool {
    if CANCEL_ALL_TRANSFERS.load(std::sync::atomic::Ordering::SeqCst) {
        return true;
    }
    let set = cancelled_set().read();
    if set.contains(transfer_id) {
        return true;
    }
    if let Some(rec) = get_transfer(transfer_id) {
        return rec.state == TransferState::Cancelled;
    }
    false
}

pub fn set_transfer_paused(transfer_id: Option<&str>, paused: bool) {
    if let Some(transfer_id) = transfer_id {
        if paused {
            paused_set().write().insert(transfer_id.to_string());
            let _ = set_transfer_state(transfer_id, TransferState::Paused);
        } else {
            paused_set().write().remove(transfer_id);
            if let Some(record) = get_transfer(transfer_id) {
                if record.state == TransferState::Paused {
                    let _ = set_transfer_state(transfer_id, TransferState::Running);
                }
            }
        }
        return;
    }
    PAUSE_ALL_TRANSFERS.store(paused, std::sync::atomic::Ordering::SeqCst);
}

pub fn is_transfer_paused(transfer_id: &str) -> bool {
    PAUSE_ALL_TRANSFERS.load(std::sync::atomic::Ordering::SeqCst)
        || paused_set().read().contains(transfer_id)
}

pub fn wait_while_transfer_paused(transfer_id: &str) -> Result<(), String> {
    while is_transfer_paused(transfer_id) {
        if is_transfer_cancelled(transfer_id) {
            return Err("transfer cancelled by user".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_and_update_item() {
        let dir = std::env::temp_dir().join("ag_job_queue_test");
        let _ = fs::create_dir_all(&dir);
        let f = dir.join("a.txt");
        fs::write(&f, b"hi").unwrap();
        init_queue_path(dir.join("q.json"));
        let rec = create_transfer(CreateTransferRequest {
            session: "Lavender".into(),
            api_id: 1,
            api_hash: "x".into(),
            chat_id: "-1001".into(),
            topic_id: None,
            files: vec![CreateFileEntry {
                path: f.to_string_lossy().into(),
                caption: Some("c".into()),
                size: Some(2),
            }],
            options: None,
            transfer_id: Some("test-t1".into()),
        })
        .unwrap();
        assert_eq!(rec.items.len(), 1);
        let u = update_item("test-t1", 0, ItemState::Done, Some(99), None).unwrap();
        assert_eq!(u.done_count, 1);
        assert_eq!(u.state, TransferState::Completed);
    }

    #[test]
    fn global_cancel_reaches_unregistered_transfer_ids() {
        clear_all_cancel_flags();
        cancel_transfer(None);
        assert!(is_transfer_cancelled("download:not-in-live-map"));
        clear_cancel_flag_for("download:not-in-live-map");
        assert!(!is_transfer_cancelled("download:not-in-live-map"));
    }

    #[test]
    fn pause_state_is_explicit_and_reversible() {
        set_transfer_paused(Some("test-pause-a"), true);
        assert!(is_transfer_paused("test-pause-a"));
        assert!(!is_transfer_paused("test-pause-b"));
        set_transfer_paused(Some("test-pause-a"), false);
        assert!(!is_transfer_paused("test-pause-a"));
    }

    #[test]
    fn dismiss_accepts_only_terminal_states() {
        assert!(!can_dismiss_state(&TransferState::Running));
        assert!(!can_dismiss_state(&TransferState::Queued));
        assert!(!can_dismiss_state(&TransferState::Paused));
        assert!(can_dismiss_state(&TransferState::Completed));
        assert!(can_dismiss_state(&TransferState::Failed));
        assert!(can_dismiss_state(&TransferState::Cancelled));
    }
}
