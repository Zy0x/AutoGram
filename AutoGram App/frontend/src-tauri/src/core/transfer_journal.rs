//! transfer_journal.rs — Append-Only Safety Transfer Journal (Rust)
//!
//! Port of Python `transfer_journal.py`:
//! Creates append-only JSONL safety records per transfer run in `worker/logs/transfers/`.
//! Redacts sensitive path & credential values automatically.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use super::jobs_db::resolve_migrator_db;
use super::tg_log;

const BACKEND: &str = "transfer_journal";
const MAX_RUN_BYTES: u64 = 16 * 1024 * 1024;
const MAX_RUNS: usize = 20;

static JOURNAL_LOCK: Mutex<()> = Mutex::new(());

pub struct TransferJournal {
    pub transfer_id: String,
    pub path: PathBuf,
}

impl TransferJournal {
    pub fn new(transfer_id: &str) -> Self {
        let clean: String = transfer_id
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .take(96)
            .collect();

        let tid = if clean.is_empty() {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            format!("transfer-{now}")
        } else {
            clean
        };

        let db_path = resolve_migrator_db();
        let logs_dir = if let Some(worker) = db_path.parent().and_then(|p| p.parent()) {
            worker.join("logs").join("transfers")
        } else {
            PathBuf::from("logs/transfers")
        };

        let _ = create_dir_all(&logs_dir);
        let path = logs_dir.join(format!("{tid}.jsonl"));

        Self::_prune(&logs_dir);

        Self {
            transfer_id: tid,
            path,
        }
    }

    fn _prune(dir: &Path) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let mut files: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();
        for e in entries.flatten() {
            let p = e.path();
            if p.is_file() && p.extension().map_or(false, |ext| ext == "jsonl") {
                if let Ok(m) = e.metadata() {
                    let t = m.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                    files.push((p, t));
                }
            }
        }
        files.sort_by_key(|f| f.1);
        files.reverse();

        if files.len() > MAX_RUNS {
            for (stale, _) in files.iter().skip(MAX_RUNS) {
                let _ = std::fs::remove_file(stale);
            }
        }
    }

    fn sanitize_value(key: &str, val: Value) -> Value {
        let low = key.to_lowercase();
        if low.contains("session") || low.contains("api_hash") || low.contains("auth_key") || low.contains("password") {
            return json!("***");
        }
        if low.contains("caption") || low.contains("thumbnail_data") {
            return json!("[redacted]");
        }
        if low.contains("path") {
            if let Some(s) = val.as_str() {
                if let Some(fname) = Path::new(s).file_name() {
                    return json!(fname.to_string_lossy());
                }
            }
        }
        val
    }

    pub fn append(&self, event: &str, fields: Value) {
        let _guard = JOURNAL_LOCK.lock();

        if self.path.is_file() {
            if let Ok(meta) = std::fs::metadata(&self.path) {
                if meta.len() >= MAX_RUN_BYTES {
                    return;
                }
            }
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);

        let mut record = json!({
            "ts": (now * 1000.0).round() / 1000.0,
            "transfer_id": self.transfer_id,
            "event": event,
        });

        if let Value::Object(map) = fields {
            for (k, v) in map {
                let sanitized = Self::sanitize_value(&k, v);
                record[k] = sanitized;
            }
        }

        if let Ok(line) = serde_json::to_string(&record) {
            if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&self.path) {
                let _ = writeln!(file, "{line}");
                let _ = file.flush();
            }
        }
    }
}
