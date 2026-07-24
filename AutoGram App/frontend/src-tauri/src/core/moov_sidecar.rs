//! moov_sidecar.rs — Fast MP4 MOOV Atom Sidecar Cache (Rust)
//!
//! Port of Python `moov_sidecar.py`:
//! Caches extracted MOOV atoms for video streaming into `worker/cache/moov_sidecars/`
//! and tracks them in the `moov_sidecar` SQLite table for 0.1ms instant seek access.

use rusqlite::params;
use std::fs::{create_dir_all, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use super::app_db::open_db;
use super::jobs_db::resolve_migrator_db;
use super::tg_log;

const BACKEND: &str = "moov_sidecar";

pub struct MoovSidecarManager {
    pub cache_dir: PathBuf,
}

impl MoovSidecarManager {
    pub fn new() -> Self {
        let db_path = resolve_migrator_db();
        let cache_dir = if let Some(worker) = db_path.parent().and_then(|p| p.parent()) {
            worker.join("cache").join("moov_sidecars")
        } else {
            PathBuf::from("cache/moov_sidecars")
        };
        let _ = create_dir_all(&cache_dir);
        Self { cache_dir }
    }

    /// Ensure table `moov_sidecar` exists in SQLite.
    fn ensure_table(conn: &rusqlite::Connection) -> Result<(), String> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS moov_sidecar (
                file_id TEXT PRIMARY KEY,
                sidecar_path TEXT NOT NULL,
                size INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );",
        )
        .map_err(|e| format!("ensure_table moov_sidecar: {e}"))
    }

    /// Save MOOV atom bytes to sidecar file and record in SQLite.
    pub fn save(&self, file_id: &str, moov_data: &[u8]) -> Result<(), String> {
        let sidecar_path = self.cache_dir.join(format!("{file_id}.moov"));
        let mut file = File::create(&sidecar_path).map_err(|e| format!("create sidecar file: {e}"))?;
        file.write_all(moov_data).map_err(|e| format!("write sidecar file: {e}"))?;

        if let Ok(conn) = open_db() {
            let _ = Self::ensure_table(&conn);
            let path_str = sidecar_path.display().to_string();
            let _ = conn.execute(
                "INSERT OR REPLACE INTO moov_sidecar (file_id, sidecar_path, size, created_at) \
                 VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)",
                params![file_id, path_str, moov_data.len() as i64],
            );
        }
        tg_log::info(BACKEND, "save", format!("Saved moov sidecar for {file_id} ({} bytes)", moov_data.len()));
        Ok(())
    }

    /// Load cached MOOV atom bytes in < 0.1ms.
    pub fn load(&self, file_id: &str) -> Option<Vec<u8>> {
        let sidecar_path = self.cache_dir.join(format!("{file_id}.moov"));
        if sidecar_path.is_file() {
            if let Ok(mut f) = File::open(&sidecar_path) {
                let mut buf = Vec::new();
                if f.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
                    return Some(buf);
                }
            }
        }

        // DB fallback
        if let Ok(conn) = open_db() {
            let _ = Self::ensure_table(&conn);
            let path_opt: Option<String> = conn
                .query_row(
                    "SELECT sidecar_path FROM moov_sidecar WHERE file_id = ?1",
                    params![file_id],
                    |r| r.get(0),
                )
                .ok();

            if let Some(p_str) = path_opt {
                let p = Path::new(&p_str);
                if p.is_file() {
                    if let Ok(mut f) = File::open(p) {
                        let mut buf = Vec::new();
                        if f.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
                            return Some(buf);
                        }
                    }
                }
            }
        }
        None
    }
}
