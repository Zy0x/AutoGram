//! Studio / transfer job queue (Rust).
//! Owns ordered item state; Python studio-serve only executes Telethon steps.

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
        let size = f.size.unwrap_or_else(|| {
            fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
        });
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
}
