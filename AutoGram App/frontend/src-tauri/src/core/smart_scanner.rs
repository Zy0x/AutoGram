//! smart_scanner.rs — Rust implementation of Smart Adaptive Pre-Scanner
//!
//! Port of Python `smart_scanner.py`:
//! Builds an in-memory lookup index (fingerprint_hash → message_id) from local DB cache
//! and Grammers message iteration without downloading full media files.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::app_db::{load_scan_cache, upsert_scan_cache, ScanCacheInsert};
use super::dup_checker::ScanCacheEntry;
use super::fingerprint::MediaFingerprint;
use super::tg_log;

const BACKEND: &str = "smart_scanner";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanStats {
    pub recent_scanned: usize,
    pub sampled_scanned: usize,
    pub db_cached_loaded: usize,
    pub new_from_tg: usize,
    pub duplicate_hits: usize,
    pub skipped_no_media: usize,
    pub circuit_open: bool,
    pub total_scanned: usize,
}

impl ScanStats {
    pub fn update_total(&mut self) {
        self.total_scanned = self.recent_scanned + self.sampled_scanned;
    }
}

pub struct SmartScanner {
    pub entity_id: String,
    pub topic_id: Option<i64>,
    pub topic_scope: String, // "selected_only" | "selected_plus_general" | "all_topics"
    pub scan_mode: String,   // "normal" | "smart" | "forensic"
    pub job_id: String,

    // In-memory lookup indices:
    // primary: fingerprint_hash -> message_id
    pub index: HashMap<String, i64>,
    // secondary: (file_name_lower, file_size) -> message_id
    pub ns_index: HashMap<(String, i64), i64>,
    // uid_index: file_unique_id -> message_id
    pub uid_index: HashMap<String, i64>,

    pub stats: ScanStats,
    pub new_entries: Vec<ScanCacheInsert>,
}

impl SmartScanner {
    pub fn new(
        entity_id: impl Into<String>,
        topic_id: Option<i64>,
        topic_scope: impl Into<String>,
        scan_mode: impl Into<String>,
        job_id: impl Into<String>,
    ) -> Self {
        Self {
            entity_id: entity_id.into(),
            topic_id,
            topic_scope: topic_scope.into(),
            scan_mode: scan_mode.into(),
            job_id: job_id.into(),
            index: HashMap::new(),
            ns_index: HashMap::new(),
            uid_index: HashMap::new(),
            stats: ScanStats::default(),
            new_entries: Vec::new(),
        }
    }

    /// Warmup in-memory index from SQLite `destination_scan_cache` table.
    pub fn warmup_from_db_cache(&mut self) -> Result<usize, String> {
        let entries = load_scan_cache(&self.entity_id, self.topic_id)?;
        let count = entries.len();
        for entry in entries {
            self.ingest_cache_entry(&entry);
            self.stats.db_cached_loaded += 1;
        }
        tg_log::info(
            BACKEND,
            "warmup_from_db_cache",
            format!(
                "Loaded {count} cached entries for entity={}",
                self.entity_id
            ),
        );
        Ok(count)
    }

    pub fn ingest_cache_entry(&mut self, entry: &ScanCacheEntry) {
        if !entry.is_alive || entry.message_id <= 0 {
            return;
        }
        if let Some(ref fhash) = entry.fingerprint_hash {
            self.index.insert(fhash.clone(), entry.message_id);
        }
        if let (Some(ref fname), Some(fsize)) = (&entry.file_name, entry.file_size) {
            self.ns_index
                .insert((fname.to_lowercase(), fsize), entry.message_id);
        }
        if let Some(ref fuid) = entry.file_unique_id {
            self.uid_index.insert(fuid.clone(), entry.message_id);
        }
    }

    /// Ingest a parsed Telegram message fingerprint into in-memory index and queue for DB caching.
    pub fn ingest_fingerprint(&mut self, fp: &MediaFingerprint, message_id: i64) {
        if message_id <= 0 {
            return;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let mut is_new = false;
        if let Some(ref ph) = fp.primary_hash {
            if !self.index.contains_key(ph) {
                self.index.insert(ph.clone(), message_id);
                self.stats.new_from_tg += 1;
                is_new = true;

                self.new_entries.push(ScanCacheInsert {
                    target_entity_id: self.entity_id.clone(),
                    topic_id: self.topic_id,
                    file_unique_id: fp.file_unique_id.clone(),
                    file_name: fp.file_name.clone(),
                    file_size: fp.file_size,
                    media_type: fp.media_type.clone(),
                    fingerprint_tier: fp.tier,
                    fingerprint_hash: Some(ph.clone()),
                    width: fp.width,
                    height: fp.height,
                    duration: fp.duration,
                    mime_type: fp.mime_type.clone(),
                    message_id,
                    scanned_at: now,
                    is_alive: true,
                    verified_at: None,
                    delete_detected_at: None,
                });
            } else {
                self.stats.duplicate_hits += 1;
            }
        }

        for sh in &fp.secondary_hashes {
            if !self.index.contains_key(sh) {
                self.index.insert(sh.clone(), message_id);
            }
        }

        if let (Some(ref fname), Some(fsize)) = (&fp.file_name, fp.file_size) {
            let key = (fname.to_lowercase(), fsize);
            if !self.ns_index.contains_key(&key) {
                self.ns_index.insert(key, message_id);
            }
        }

        if let Some(ref fuid) = &fp.file_unique_id {
            if !self.uid_index.contains_key(fuid) {
                self.uid_index.insert(fuid.clone(), message_id);
            }
        }

        let _ = is_new;
    }

    /// Persist newly scanned entries to SQLite database.
    pub fn save_new_cache_entries(&mut self) -> Result<(), String> {
        if self.new_entries.is_empty() {
            return Ok(());
        }
        upsert_scan_cache(&self.new_entries)?;
        tg_log::info(
            BACKEND,
            "save_new_cache_entries",
            format!("Saved {} entries to DB", self.new_entries.len()),
        );
        self.new_entries.clear();
        Ok(())
    }

    /// Lookup a fingerprint in the scanned index.
    pub fn lookup(&self, fp: &MediaFingerprint, strict: bool) -> Option<i64> {
        // 1. Direct primary hash
        if let Some(ref ph) = fp.primary_hash {
            if let Some(&mid) = self.index.get(ph) {
                return Some(mid);
            }
        }

        // 2. SHA-256 exact match
        if let Some(ref sha) = fp.sha256 {
            let key = format!("sha256:{}", sha);
            if let Some(&mid) = self.index.get(&key) {
                return Some(mid);
            }
        }

        // 3. Secondary hashes
        for sh in &fp.secondary_hashes {
            if let Some(&mid) = self.index.get(sh) {
                return Some(mid);
            }
        }

        if !strict {
            // 4. Name+Size fallback
            if let (Some(ref fname), Some(fsize)) = (&fp.file_name, fp.file_size) {
                let key = (fname.to_lowercase(), fsize);
                if let Some(&mid) = self.ns_index.get(&key) {
                    return Some(mid);
                }
            }

            // 5. file_unique_id fallback
            if let Some(ref fuid) = fp.file_unique_id {
                if let Some(&mid) = self.uid_index.get(fuid) {
                    return Some(mid);
                }
            }
        }

        None
    }
}
