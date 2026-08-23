use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::models::{
    DriveEngineStatus, DrivePage, DriveRecord, FilePage, FileRecord, FolderPage, FolderRecord,
    IntegrityReport, RecoveryRecord, SnapshotRecord,
};

const SYSTEM_SCHEMA: &str =
    include_str!("../../../../../database/migrations/016_drive_engine_system.sql");
const SYSTEM_HARDENING_SCHEMA: &str =
    include_str!("../../../../../database/migrations/018_drive_engine_phase1_hardening.sql");
const METADATA_SCHEMA: &str =
    include_str!("../../../../../database/migrations/017_drive_engine_metadata.sql");
const SCHEMA_VERSION: i64 = 2;
const DEFAULT_PAGE_SIZE: usize = 100;
const MAX_PAGE_SIZE: usize = 200;

#[derive(Debug, Clone)]
pub struct DriveStore {
    root: PathBuf,
}

impl DriveStore {
    pub fn open_default() -> Result<Self, String> {
        let data_root = super::super::jobs_db::resolve_migrator_db()
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("database"));
        let db_root = data_root.join("drive");
        let legacy_engine_root = data_root.join("drive_beta");
        if !db_root.exists() && legacy_engine_root.exists() {
            std::fs::rename(&legacy_engine_root, &db_root)
                .map_err(|error| format!("DRIVE_ENGINE_STORAGE_PROMOTION_FAILED: {error}"))?;
        }
        Self::open_at(db_root)
    }

    pub fn open_at(root: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&root)
            .map_err(|error| format!("DRIVE_ENGINE_DB_DIR_CREATE_FAILED: {error}"))?;
        let store = Self { root };
        let _ = store.connection()?;
        Ok(store)
    }

    fn system_path(&self) -> PathBuf {
        self.root.join("system.db")
    }

    fn metadata_path(&self) -> PathBuf {
        self.root.join("drive.db")
    }

    fn connection(&self) -> Result<Connection, String> {
        let conn = Connection::open(self.system_path())
            .map_err(|error| format!("DRIVE_ENGINE_SYSTEM_DB_OPEN_FAILED: {error}"))?;
        conn.busy_timeout(std::time::Duration::from_secs(30))
            .map_err(|error| format!("DRIVE_ENGINE_BUSY_TIMEOUT_FAILED: {error}"))?;
        conn.execute_batch(
            "PRAGMA foreign_keys=ON;
             PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA temp_store=MEMORY;",
        )
        .map_err(|error| format!("DRIVE_ENGINE_SYSTEM_PRAGMA_FAILED: {error}"))?;
        let meta_path = self.metadata_path().to_string_lossy().to_string();
        conn.execute("ATTACH DATABASE ?1 AS drive_meta", params![meta_path])
            .map_err(|error| format!("DRIVE_ENGINE_METADATA_ATTACH_FAILED: {error}"))?;
        conn.execute_batch(
            "PRAGMA drive_meta.journal_mode=WAL;
             PRAGMA drive_meta.synchronous=NORMAL;",
        )
        .map_err(|error| format!("DRIVE_ENGINE_METADATA_PRAGMA_FAILED: {error}"))?;
        conn.execute_batch(SYSTEM_SCHEMA)
            .map_err(|error| format!("DRIVE_ENGINE_SYSTEM_SCHEMA_FAILED: {error}"))?;
        conn.execute_batch(SYSTEM_HARDENING_SCHEMA)
            .map_err(|error| format!("DRIVE_ENGINE_SYSTEM_HARDENING_FAILED: {error}"))?;
        conn.execute_batch(&qualify_metadata_schema(METADATA_SCHEMA))
            .map_err(|error| format!("DRIVE_ENGINE_METADATA_SCHEMA_FAILED: {error}"))?;
        Ok(conn)
    }

    pub fn status(&self) -> Result<DriveEngineStatus, String> {
        let conn = self.connection()?;
        let drive_count = conn
            .query_row(
                "SELECT COUNT(*) FROM drive_beta_registry WHERE deleted_at IS NULL",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("DRIVE_ENGINE_STATUS_DRIVES_FAILED: {error}"))?;
        let pending_event_count = conn
            .query_row(
                "SELECT COUNT(*) FROM drive_meta.drive_beta_events WHERE status IN ('pending','syncing','failed')",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("DRIVE_ENGINE_STATUS_EVENTS_FAILED: {error}"))?;
        let integrity = self.integrity_report_with(&conn)?;
        Ok(DriveEngineStatus {
            enabled: true,
            schema_version: SCHEMA_VERSION,
            drive_count,
            pending_event_count,
            integrity_ok: integrity.ok,
        })
    }

    pub fn create_drive(
        &self,
        account_id: &str,
        name: &str,
        storage_peer_id: Option<&str>,
        storage_topic_id: Option<i64>,
        device_id: Option<&str>,
    ) -> Result<DriveRecord, String> {
        let account_id = validate_identifier(account_id, "ACCOUNT")?;
        let name = validate_name(name)?;
        let device_id = normalize_device_id(device_id);
        let drive_id = uuid_v4();
        let root_folder_id = uuid_v4();
        let now = now_ms();
        let object_hash = folder_hash(&drive_id, None, &name, 1, None);
        let manifest_hash = manifest_hash(&drive_id, &account_id, &root_folder_id, 1);
        let payload = json!({
            "driveId": drive_id,
            "rootFolderId": root_folder_id,
            "name": name,
            "storagePeerId": storage_peer_id,
            "storageTopicId": storage_topic_id,
        });
        let mut conn = self.connection()?;
        let tx = conn
            .transaction()
            .map_err(|error| format!("DRIVE_ENGINE_CREATE_TX_FAILED: {error}"))?;
        tx.execute(
            "INSERT INTO drive_beta_accounts(account_id, display_name, created_at, last_seen_at)
             VALUES(?1, NULL, ?2, ?2)
             ON CONFLICT(account_id) DO UPDATE SET last_seen_at=excluded.last_seen_at",
            params![account_id, now],
        )
        .map_err(|error| format!("DRIVE_ENGINE_ACCOUNT_UPSERT_FAILED: {error}"))?;
        tx.execute(
            "INSERT INTO drive_beta_devices(device_id, account_id, display_name, created_at, last_seen_at)
             VALUES(?1, ?2, NULL, ?3, ?3)
             ON CONFLICT(device_id) DO UPDATE SET last_seen_at=excluded.last_seen_at",
            params![device_id, account_id, now],
        )
        .map_err(|error| format!("DRIVE_ENGINE_DEVICE_UPSERT_FAILED: {error}"))?;
        tx.execute(
            "INSERT INTO drive_beta_registry(
                drive_id, account_id, name, root_folder_id, storage_peer_id,
                storage_topic_id, state, version, manifest_hash, created_at, updated_at
             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, 'active', 1, ?7, ?8, ?8)",
            params![
                drive_id,
                account_id,
                name,
                root_folder_id,
                storage_peer_id,
                storage_topic_id,
                manifest_hash,
                now
            ],
        )
        .map_err(|error| map_constraint("DRIVE_ENGINE_DRIVE_CREATE_FAILED", error))?;
        tx.execute(
            "INSERT INTO drive_meta.drive_beta_folders(
                folder_id, drive_id, parent_id, name, version, object_hash,
                created_at, updated_at, deleted_at
             ) VALUES(?1, ?2, NULL, ?3, 1, ?4, ?5, ?5, NULL)",
            params![root_folder_id, drive_id, name, object_hash, now],
        )
        .map_err(|error| format!("DRIVE_ENGINE_ROOT_CREATE_FAILED: {error}"))?;
        if let Some(peer_id) = storage_peer_id.filter(|value| !value.trim().is_empty()) {
            tx.execute(
                "INSERT INTO drive_meta.drive_beta_telegram_mapping(
                    mapping_id, drive_id, object_type, object_id, telegram_chat_id,
                    telegram_topic_id, telegram_message_id, storage_type, version,
                    created_at, updated_at, deleted_at
                 ) VALUES(?1, ?2, 'drive', ?2, ?3, ?4, NULL,
                    CASE WHEN ?4 IS NULL THEN 'telegram' ELSE 'telegram_topic' END,
                    1, ?5, ?5, NULL)",
                params![uuid_v4(), drive_id, peer_id.trim(), storage_topic_id, now],
            )
            .map_err(|error| format!("DRIVE_ENGINE_MAPPING_CREATE_FAILED: {error}"))?;
        }
        insert_event(
            &tx,
            &drive_id,
            &device_id,
            "CREATE_DRIVE",
            "drive",
            &drive_id,
            1,
            &payload,
            now,
        )?;
        tx.commit()
            .map_err(|error| format!("DRIVE_ENGINE_CREATE_COMMIT_FAILED: {error}"))?;
        Ok(DriveRecord {
            drive_id,
            account_id,
            name,
            root_folder_id,
            storage_peer_id: storage_peer_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            storage_topic_id,
            state: "active".into(),
            version: 1,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn list_drives(
        &self,
        account_id: &str,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> Result<DrivePage, String> {
        let account_id = validate_identifier(account_id, "ACCOUNT")?;
        let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);
        let offset = offset.unwrap_or(0);
        let conn = self.connection()?;
        let mut statement = conn
            .prepare(
                "SELECT drive_id, account_id, name, root_folder_id, storage_peer_id,
                        storage_topic_id, state, version, created_at, updated_at
                 FROM drive_beta_registry
                 WHERE account_id=?1 AND deleted_at IS NULL
                 ORDER BY updated_at DESC, drive_id
                 LIMIT ?2 OFFSET ?3",
            )
            .map_err(|error| format!("DRIVE_ENGINE_DRIVE_LIST_PREPARE_FAILED: {error}"))?;
        let drives = statement
            .query_map(params![account_id, limit + 1, offset], row_to_drive)
            .map_err(|error| format!("DRIVE_ENGINE_DRIVE_LIST_FAILED: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("DRIVE_ENGINE_DRIVE_LIST_ROW_FAILED: {error}"))?;
        let has_more = drives.len() > limit;
        let drives = drives.into_iter().take(limit).collect();
        Ok(DrivePage {
            account_id,
            drives,
            limit,
            offset,
            has_more,
        })
    }

    pub fn create_folder(
        &self,
        account_id: &str,
        drive_id: &str,
        parent_id: Option<&str>,
        name: &str,
        telegram_chat_id: Option<&str>,
        telegram_topic_id: Option<i64>,
        device_id: Option<&str>,
    ) -> Result<FolderRecord, String> {
        let account_id = validate_identifier(account_id, "ACCOUNT")?;
        let drive_id = validate_identifier(drive_id, "DRIVE")?;
        let name = validate_name(name)?;
        let device_id = normalize_device_id(device_id);
        let folder_id = uuid_v4();
        let now = now_ms();
        let mut conn = self.connection()?;
        let tx = conn
            .transaction()
            .map_err(|error| format!("DRIVE_ENGINE_CREATE_FOLDER_TX_FAILED: {error}"))?;
        let root_id = require_drive(&tx, &account_id, &drive_id)?;
        let parent_id = parent_id
            .map(|value| validate_identifier(value, "PARENT"))
            .transpose()?
            .unwrap_or(root_id);
        require_folder(&tx, &drive_id, &parent_id)?;
        let object_hash = folder_hash(&drive_id, Some(&parent_id), &name, 1, None);
        tx.execute(
            "INSERT INTO drive_meta.drive_beta_folders(
                folder_id, drive_id, parent_id, name, version, object_hash,
                created_at, updated_at, deleted_at
             ) VALUES(?1, ?2, ?3, ?4, 1, ?5, ?6, ?6, NULL)",
            params![folder_id, drive_id, parent_id, name, object_hash, now],
        )
        .map_err(|error| map_constraint("DRIVE_ENGINE_FOLDER_CREATE_FAILED", error))?;
        if let Some(chat_id) = telegram_chat_id.filter(|value| !value.trim().is_empty()) {
            tx.execute(
                "INSERT INTO drive_meta.drive_beta_telegram_mapping(
                    mapping_id, drive_id, object_type, object_id, telegram_chat_id,
                    telegram_topic_id, telegram_message_id, storage_type, version,
                    created_at, updated_at, deleted_at
                 ) VALUES(?1, ?2, 'folder', ?3, ?4, ?5, NULL,
                    CASE WHEN ?5 IS NULL THEN 'telegram' ELSE 'telegram_topic' END,
                    1, ?6, ?6, NULL)",
                params![uuid_v4(), drive_id, folder_id, chat_id.trim(), telegram_topic_id, now],
            )
            .map_err(|error| format!("DRIVE_ENGINE_FOLDER_MAPPING_FAILED: {error}"))?;
        }
        insert_event(
            &tx,
            &drive_id,
            &device_id,
            "CREATE_FOLDER",
            "folder",
            &folder_id,
            1,
            &json!({
                "parentId": parent_id,
                "name": name,
                "telegramChatId": telegram_chat_id,
                "telegramTopicId": telegram_topic_id,
            }),
            now,
        )?;
        tx.commit()
            .map_err(|error| format!("DRIVE_ENGINE_FOLDER_COMMIT_FAILED: {error}"))?;
        Ok(FolderRecord {
            folder_id,
            drive_id,
            parent_id: Some(parent_id),
            name,
            telegram_chat_id: telegram_chat_id.map(str::trim).map(str::to_string),
            telegram_topic_id,
            version: 1,
            object_hash,
            created_at: now,
            updated_at: now,
            deleted_at: None,
        })
    }

    pub fn list_children(
        &self,
        account_id: &str,
        drive_id: &str,
        parent_id: Option<&str>,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> Result<FolderPage, String> {
        let account_id = validate_identifier(account_id, "ACCOUNT")?;
        let drive_id = validate_identifier(drive_id, "DRIVE")?;
        let conn = self.connection()?;
        let root_id = require_drive(&conn, &account_id, &drive_id)?;
        let parent_id = parent_id
            .map(|value| validate_identifier(value, "PARENT"))
            .transpose()?
            .unwrap_or(root_id);
        require_folder(&conn, &drive_id, &parent_id)?;
        let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);
        let offset = offset.unwrap_or(0);
        let mut statement = conn
            .prepare(
                "SELECT folder.folder_id, folder.drive_id, folder.parent_id, folder.name,
                        folder.version, folder.object_hash, folder.created_at,
                        folder.updated_at, folder.deleted_at,
                        mapping.telegram_chat_id, mapping.telegram_topic_id
                 FROM drive_meta.drive_beta_folders folder
                 LEFT JOIN drive_meta.drive_beta_telegram_mapping mapping
                   ON mapping.drive_id=folder.drive_id
                  AND mapping.object_type='folder'
                  AND mapping.object_id=folder.folder_id
                  AND mapping.deleted_at IS NULL
                 WHERE folder.drive_id=?1 AND folder.parent_id=?2 AND folder.deleted_at IS NULL
                 ORDER BY name COLLATE NOCASE, folder_id
                 LIMIT ?3 OFFSET ?4",
            )
            .map_err(|error| format!("DRIVE_ENGINE_FOLDER_LIST_PREPARE_FAILED: {error}"))?;
        let folders = statement
            .query_map(
                params![drive_id, parent_id, (limit + 1) as i64, offset as i64],
                row_to_mapped_folder,
            )
            .map_err(|error| format!("DRIVE_ENGINE_FOLDER_LIST_FAILED: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("DRIVE_ENGINE_FOLDER_ROW_FAILED: {error}"))?;
        let has_more = folders.len() > limit;
        let mut folders = folders;
        folders.truncate(limit);
        Ok(FolderPage {
            drive_id,
            parent_id,
            folders,
            limit,
            offset,
            has_more,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn commit_file(
        &self,
        account_id: &str,
        drive_id: &str,
        folder_id: &str,
        filename: &str,
        size: i64,
        mime: Option<&str>,
        content_hash: Option<&str>,
        telegram_unique_id: Option<&str>,
        telegram_chat_id: &str,
        telegram_topic_id: Option<i64>,
        telegram_message_id: i64,
        device_id: Option<&str>,
    ) -> Result<FileRecord, String> {
        let account_id = validate_identifier(account_id, "ACCOUNT")?;
        let drive_id = validate_identifier(drive_id, "DRIVE")?;
        let folder_id = validate_identifier(folder_id, "FOLDER")?;
        let filename = validate_name(filename)?;
        if size < 0 {
            return Err("DRIVE_ENGINE_FILE_SIZE_INVALID".into());
        }
        if telegram_message_id <= 0 {
            return Err("DRIVE_ENGINE_MESSAGE_ID_INVALID".into());
        }
        let telegram_chat_id = validate_identifier(telegram_chat_id, "TELEGRAM_CHAT")?;
        let mime = normalize_optional_text(mime, 255);
        let content_hash = normalize_optional_text(content_hash, 256);
        let telegram_unique_id = normalize_optional_text(telegram_unique_id, 512);
        let device_id = normalize_device_id(device_id);
        let now = now_ms();
        let mut conn = self.connection()?;
        let tx = conn
            .transaction()
            .map_err(|error| format!("DRIVE_ENGINE_FILE_COMMIT_TX_FAILED: {error}"))?;
        let _ = require_drive(&tx, &account_id, &drive_id)?;
        require_folder(&tx, &drive_id, &folder_id)?;

        // Clean-copy deduplication is deliberately layered: Telegram message,
        // Telegram unique identity, strong content hash, then filename+size.
        let duplicate_id = find_duplicate_file(
            &tx,
            &drive_id,
            &filename,
            size,
            content_hash.as_deref(),
            telegram_unique_id.as_deref(),
            &telegram_chat_id,
            telegram_topic_id,
            telegram_message_id,
        )?;
        if let Some(file_id) = duplicate_id {
            return query_file_by_id(&tx, &drive_id, &file_id);
        }

        let file_id = uuid_v4();
        tx.execute(
            "INSERT INTO drive_meta.drive_beta_files(
                file_id, drive_id, folder_id, filename, size, mime, content_hash,
                telegram_unique_id, created_at, updated_at, deleted_at
             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, NULL)",
            params![
                file_id,
                drive_id,
                folder_id,
                filename,
                size,
                mime,
                content_hash,
                telegram_unique_id,
                now
            ],
        )
        .map_err(|error| map_constraint("DRIVE_ENGINE_FILE_CREATE_FAILED", error))?;
        tx.execute(
            "INSERT INTO drive_meta.drive_beta_telegram_mapping(
                mapping_id, drive_id, object_type, object_id, telegram_chat_id,
                telegram_topic_id, telegram_message_id, storage_type, version,
                created_at, updated_at, deleted_at
             ) VALUES(?1, ?2, 'file', ?3, ?4, ?5, ?6, 'telegram_message', 1, ?7, ?7, NULL)",
            params![
                uuid_v4(),
                drive_id,
                file_id,
                telegram_chat_id,
                telegram_topic_id,
                telegram_message_id,
                now
            ],
        )
        .map_err(|error| map_constraint("DRIVE_ENGINE_FILE_MAPPING_FAILED", error))?;
        insert_event(
            &tx,
            &drive_id,
            &device_id,
            "COMMIT_FILE",
            "file",
            &file_id,
            1,
            &json!({
                "folderId": folder_id,
                "filename": filename,
                "size": size,
                "telegramChatId": telegram_chat_id,
                "telegramTopicId": telegram_topic_id,
                "telegramMessageId": telegram_message_id,
            }),
            now,
        )?;
        tx.commit()
            .map_err(|error| format!("DRIVE_ENGINE_FILE_COMMIT_FAILED: {error}"))?;
        Ok(FileRecord {
            file_id,
            drive_id,
            folder_id,
            filename,
            size,
            mime,
            content_hash,
            telegram_unique_id,
            telegram_chat_id,
            telegram_topic_id,
            telegram_message_id,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn list_files(
        &self,
        account_id: &str,
        drive_id: &str,
        folder_id: &str,
        limit: Option<usize>,
        offset: Option<usize>,
        sort_mode: Option<&str>,
        content_filter: Option<&str>,
    ) -> Result<FilePage, String> {
        let account_id = validate_identifier(account_id, "ACCOUNT")?;
        let drive_id = validate_identifier(drive_id, "DRIVE")?;
        let folder_id = validate_identifier(folder_id, "FOLDER")?;
        let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);
        let offset = offset.unwrap_or(0);
        let filter_sql = match content_filter.unwrap_or("all") {
            "media" => "AND (LOWER(COALESCE(mime, '')) LIKE 'image/%' OR LOWER(COALESCE(mime, '')) LIKE 'video/%')",
            "image" | "images" => "AND LOWER(COALESCE(mime, '')) LIKE 'image/%'",
            "video" | "videos" => "AND LOWER(COALESCE(mime, '')) LIKE 'video/%'",
            "audio" => "AND LOWER(COALESCE(mime, '')) LIKE 'audio/%'",
            "gifs" => "AND (LOWER(COALESCE(mime, ''))='image/gif' OR LOWER(filename) LIKE '%.gif')",
            "archives" => "AND (LOWER(filename) LIKE '%.zip' OR LOWER(filename) LIKE '%.rar' OR LOWER(filename) LIKE '%.7z' OR LOWER(filename) LIKE '%.tar' OR LOWER(filename) LIKE '%.gz')",
            "files" | "document" | "documents" => "AND LOWER(COALESCE(mime, 'application/octet-stream')) NOT LIKE 'image/%' AND LOWER(COALESCE(mime, 'application/octet-stream')) NOT LIKE 'video/%' AND LOWER(COALESCE(mime, 'application/octet-stream')) NOT LIKE 'audio/%'",
            "links" | "link" => "AND 1=0",
            _ => "",
        };
        let order_sql = match sort_mode.unwrap_or("newest") {
            "oldest" => "file.created_at ASC, file.file_id ASC",
            "name_asc" => "LOWER(file.filename) ASC, file.file_id ASC",
            "name_desc" => "LOWER(file.filename) DESC, file.file_id DESC",
            "type_asc" => "LOWER(COALESCE(file.mime, '')) ASC, LOWER(file.filename) ASC",
            "type_desc" => "LOWER(COALESCE(file.mime, '')) DESC, LOWER(file.filename) DESC",
            "size_desc" => "file.size DESC, file.file_id ASC",
            "size_asc" => "file.size ASC, file.file_id ASC",
            _ => "file.created_at DESC, file.file_id DESC",
        };
        let conn = self.connection()?;
        let _ = require_drive(&conn, &account_id, &drive_id)?;
        require_folder(&conn, &drive_id, &folder_id)?;
        let (total_count, total_bytes) = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*), COALESCE(SUM(size), 0)
                     FROM drive_meta.drive_beta_files
                     WHERE drive_id=?1 AND folder_id=?2 AND deleted_at IS NULL {filter_sql}"
                ),
                params![drive_id, folder_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|error| format!("DRIVE_ENGINE_FILE_TOTALS_FAILED: {error}"))?;
        let mut statement = conn
            .prepare(&format!(
                "SELECT file.file_id, file.drive_id, file.folder_id, file.filename,
                        file.size, file.mime, file.content_hash, file.telegram_unique_id,
                        mapping.telegram_chat_id, mapping.telegram_topic_id,
                        mapping.telegram_message_id, file.created_at, file.updated_at
                 FROM drive_meta.drive_beta_files file
                 JOIN drive_meta.drive_beta_telegram_mapping mapping
                   ON mapping.drive_id=file.drive_id AND mapping.object_type='file'
                  AND mapping.object_id=file.file_id AND mapping.deleted_at IS NULL
                 WHERE file.drive_id=?1 AND file.folder_id=?2 AND file.deleted_at IS NULL
                   AND mapping.telegram_message_id IS NOT NULL
                   {filter_sql}
                 ORDER BY {order_sql}
                 LIMIT ?3 OFFSET ?4"
            ))
            .map_err(|error| format!("DRIVE_ENGINE_FILE_LIST_PREPARE_FAILED: {error}"))?;
        let files = statement
            .query_map(
                params![drive_id, folder_id, (limit + 1) as i64, offset as i64],
                row_to_file,
            )
            .map_err(|error| format!("DRIVE_ENGINE_FILE_LIST_FAILED: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("DRIVE_ENGINE_FILE_LIST_ROW_FAILED: {error}"))?;
        let has_more = files.len() > limit;
        let mut files = files;
        files.truncate(limit);
        Ok(FilePage {
            drive_id,
            folder_id,
            files,
            limit,
            offset,
            has_more,
            total_count,
            total_bytes,
        })
    }

    pub fn soft_delete_files(
        &self,
        account_id: &str,
        drive_id: &str,
        folder_id: &str,
        telegram_message_ids: &[i64],
        device_id: Option<&str>,
    ) -> Result<usize, String> {
        let account_id = validate_identifier(account_id, "ACCOUNT")?;
        let drive_id = validate_identifier(drive_id, "DRIVE")?;
        let folder_id = validate_identifier(folder_id, "FOLDER")?;
        let device_id = normalize_device_id(device_id);
        let ids = telegram_message_ids
            .iter()
            .copied()
            .filter(|id| *id > 0)
            .collect::<std::collections::BTreeSet<_>>();
        if ids.is_empty() {
            return Ok(0);
        }
        let now = now_ms();
        let mut conn = self.connection()?;
        let tx = conn
            .transaction()
            .map_err(|error| format!("DRIVE_ENGINE_FILE_DELETE_TX_FAILED: {error}"))?;
        let _ = require_drive(&tx, &account_id, &drive_id)?;
        require_folder(&tx, &drive_id, &folder_id)?;
        let mut affected = 0usize;
        for message_id in ids {
            let file_id: Option<String> = tx
                .query_row(
                    "SELECT file.file_id
                     FROM drive_meta.drive_beta_files file
                     JOIN drive_meta.drive_beta_telegram_mapping mapping
                       ON mapping.drive_id=file.drive_id AND mapping.object_type='file'
                      AND mapping.object_id=file.file_id AND mapping.deleted_at IS NULL
                     WHERE file.drive_id=?1 AND file.folder_id=?2 AND file.deleted_at IS NULL
                       AND mapping.telegram_message_id=?3 LIMIT 1",
                    params![drive_id, folder_id, message_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| format!("DRIVE_ENGINE_FILE_DELETE_LOOKUP_FAILED: {error}"))?;
            let Some(file_id) = file_id else { continue };
            affected += tx
                .execute(
                    "UPDATE drive_meta.drive_beta_files SET deleted_at=?1, updated_at=?1
                     WHERE drive_id=?2 AND file_id=?3 AND deleted_at IS NULL",
                    params![now, drive_id, file_id],
                )
                .map_err(|error| format!("DRIVE_ENGINE_FILE_DELETE_FAILED: {error}"))?;
            tx.execute(
                "UPDATE drive_meta.drive_beta_telegram_mapping
                 SET deleted_at=?1, updated_at=?1, version=version+1
                 WHERE drive_id=?2 AND object_type='file' AND object_id=?3
                   AND deleted_at IS NULL",
                params![now, drive_id, file_id],
            )
            .map_err(|error| format!("DRIVE_ENGINE_FILE_MAPPING_DELETE_FAILED: {error}"))?;
            insert_event(
                &tx,
                &drive_id,
                &device_id,
                "DELETE_FILE",
                "file",
                &file_id,
                2,
                &json!({"folderId": folder_id, "telegramMessageId": message_id}),
                now,
            )?;
        }
        tx.commit()
            .map_err(|error| format!("DRIVE_ENGINE_FILE_DELETE_COMMIT_FAILED: {error}"))?;
        Ok(affected)
    }

    pub fn move_files(
        &self,
        account_id: &str,
        drive_id: &str,
        source_folder_id: &str,
        destination_folder_id: &str,
        telegram_message_ids: &[i64],
        device_id: Option<&str>,
    ) -> Result<usize, String> {
        let account_id = validate_identifier(account_id, "ACCOUNT")?;
        let drive_id = validate_identifier(drive_id, "DRIVE")?;
        let source_folder_id = validate_identifier(source_folder_id, "SOURCE_FOLDER")?;
        let destination_folder_id =
            validate_identifier(destination_folder_id, "DESTINATION_FOLDER")?;
        let ids = telegram_message_ids
            .iter()
            .copied()
            .filter(|id| *id > 0)
            .collect::<std::collections::BTreeSet<_>>();
        if ids.is_empty() || source_folder_id == destination_folder_id {
            return Ok(0);
        }
        let device_id = normalize_device_id(device_id);
        let now = now_ms();
        let mut conn = self.connection()?;
        let tx = conn
            .transaction()
            .map_err(|error| format!("DRIVE_ENGINE_FILE_MOVE_TX_FAILED: {error}"))?;
        let _ = require_drive(&tx, &account_id, &drive_id)?;
        require_folder(&tx, &drive_id, &source_folder_id)?;
        require_folder(&tx, &drive_id, &destination_folder_id)?;
        let mut affected = 0usize;
        for message_id in ids {
            let file_id: Option<String> = tx
                .query_row(
                    "SELECT file.file_id
                     FROM drive_meta.drive_beta_files file
                     JOIN drive_meta.drive_beta_telegram_mapping mapping
                       ON mapping.drive_id=file.drive_id AND mapping.object_type='file'
                      AND mapping.object_id=file.file_id AND mapping.deleted_at IS NULL
                     WHERE file.drive_id=?1 AND file.folder_id=?2 AND file.deleted_at IS NULL
                       AND mapping.telegram_message_id=?3 LIMIT 1",
                    params![drive_id, source_folder_id, message_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| format!("DRIVE_ENGINE_FILE_MOVE_LOOKUP_FAILED: {error}"))?;
            let Some(file_id) = file_id else { continue };
            affected += tx
                .execute(
                    "UPDATE drive_meta.drive_beta_files SET folder_id=?1, updated_at=?2
                     WHERE drive_id=?3 AND file_id=?4 AND deleted_at IS NULL",
                    params![destination_folder_id, now, drive_id, file_id],
                )
                .map_err(|error| format!("DRIVE_ENGINE_FILE_MOVE_FAILED: {error}"))?;
            insert_event(
                &tx,
                &drive_id,
                &device_id,
                "MOVE_FILE",
                "file",
                &file_id,
                2,
                &json!({
                    "sourceFolderId": source_folder_id,
                    "destinationFolderId": destination_folder_id,
                    "telegramMessageId": message_id,
                }),
                now,
            )?;
        }
        tx.commit()
            .map_err(|error| format!("DRIVE_ENGINE_FILE_MOVE_COMMIT_FAILED: {error}"))?;
        Ok(affected)
    }

    pub fn rename_folder(
        &self,
        account_id: &str,
        drive_id: &str,
        folder_id: &str,
        name: &str,
        device_id: Option<&str>,
    ) -> Result<FolderRecord, String> {
        self.update_folder(account_id, drive_id, folder_id, Some(name), None, device_id)
    }

    pub fn move_folder(
        &self,
        account_id: &str,
        drive_id: &str,
        folder_id: &str,
        parent_id: &str,
        device_id: Option<&str>,
    ) -> Result<FolderRecord, String> {
        self.update_folder(
            account_id,
            drive_id,
            folder_id,
            None,
            Some(parent_id),
            device_id,
        )
    }

    fn update_folder(
        &self,
        account_id: &str,
        drive_id: &str,
        folder_id: &str,
        new_name: Option<&str>,
        new_parent_id: Option<&str>,
        device_id: Option<&str>,
    ) -> Result<FolderRecord, String> {
        let account_id = validate_identifier(account_id, "ACCOUNT")?;
        let drive_id = validate_identifier(drive_id, "DRIVE")?;
        let folder_id = validate_identifier(folder_id, "FOLDER")?;
        let device_id = normalize_device_id(device_id);
        let mut conn = self.connection()?;
        let tx = conn
            .transaction()
            .map_err(|error| format!("DRIVE_ENGINE_FOLDER_UPDATE_TX_FAILED: {error}"))?;
        let root_id = require_drive(&tx, &account_id, &drive_id)?;
        if folder_id == root_id && new_parent_id.is_some() {
            return Err("DRIVE_ENGINE_ROOT_MOVE_FORBIDDEN".into());
        }
        let current = require_folder(&tx, &drive_id, &folder_id)?;
        let name = new_name
            .map(validate_name)
            .transpose()?
            .unwrap_or(current.name);
        let parent_id = match new_parent_id {
            Some(value) => Some(validate_identifier(value, "PARENT")?),
            None => current.parent_id,
        };
        if let Some(parent) = parent_id.as_deref() {
            require_folder(&tx, &drive_id, parent)?;
            if parent == folder_id || folder_contains(&tx, &drive_id, &folder_id, parent)? {
                return Err("DRIVE_ENGINE_FOLDER_CYCLE_FORBIDDEN".into());
            }
        }
        let version = current.version + 1;
        let now = now_ms();
        let object_hash = folder_hash(&drive_id, parent_id.as_deref(), &name, version, None);
        tx.execute(
            "UPDATE drive_meta.drive_beta_folders
             SET parent_id=?1, name=?2, version=?3, object_hash=?4, updated_at=?5
             WHERE drive_id=?6 AND folder_id=?7 AND deleted_at IS NULL",
            params![
                parent_id,
                name,
                version,
                object_hash,
                now,
                drive_id,
                folder_id
            ],
        )
        .map_err(|error| map_constraint("DRIVE_ENGINE_FOLDER_UPDATE_FAILED", error))?;
        if folder_id == root_id && new_name.is_some() {
            let drive_version: i64 = tx
                .query_row(
                    "SELECT version FROM drive_beta_registry WHERE drive_id=?1 AND account_id=?2",
                    params![drive_id, account_id],
                    |row| row.get(0),
                )
                .map_err(|error| format!("DRIVE_ENGINE_ROOT_VERSION_FAILED: {error}"))?;
            let next_drive_version = drive_version + 1;
            tx.execute(
                "UPDATE drive_beta_registry
                 SET name=?1, version=?2, manifest_hash=?3, updated_at=?4
                 WHERE drive_id=?5 AND account_id=?6 AND deleted_at IS NULL",
                params![
                    name,
                    next_drive_version,
                    manifest_hash(&drive_id, &account_id, &root_id, next_drive_version),
                    now,
                    drive_id,
                    account_id
                ],
            )
            .map_err(|error| map_constraint("DRIVE_ENGINE_ROOT_RENAME_FAILED", error))?;
        }
        let action = if new_name.is_some() {
            "RENAME_FOLDER"
        } else {
            "MOVE_FOLDER"
        };
        insert_event(
            &tx,
            &drive_id,
            &device_id,
            action,
            "folder",
            &folder_id,
            version,
            &json!({"parentId": parent_id, "name": name}),
            now,
        )?;
        tx.commit()
            .map_err(|error| format!("DRIVE_ENGINE_FOLDER_UPDATE_COMMIT_FAILED: {error}"))?;
        Ok(FolderRecord {
            folder_id,
            drive_id,
            parent_id,
            name,
            telegram_chat_id: current.telegram_chat_id,
            telegram_topic_id: current.telegram_topic_id,
            version,
            object_hash,
            created_at: current.created_at,
            updated_at: now,
            deleted_at: None,
        })
    }

    pub fn soft_delete_folder(
        &self,
        account_id: &str,
        drive_id: &str,
        folder_id: &str,
        device_id: Option<&str>,
    ) -> Result<usize, String> {
        let account_id = validate_identifier(account_id, "ACCOUNT")?;
        let drive_id = validate_identifier(drive_id, "DRIVE")?;
        let folder_id = validate_identifier(folder_id, "FOLDER")?;
        let device_id = normalize_device_id(device_id);
        let mut conn = self.connection()?;
        let tx = conn
            .transaction()
            .map_err(|error| format!("DRIVE_ENGINE_FOLDER_DELETE_TX_FAILED: {error}"))?;
        let root_id = require_drive(&tx, &account_id, &drive_id)?;
        if folder_id == root_id {
            return Err("DRIVE_ENGINE_ROOT_DELETE_FORBIDDEN".into());
        }
        let current = require_folder(&tx, &drive_id, &folder_id)?;
        let now = now_ms();
        let affected = tx
            .execute(
                "WITH RECURSIVE subtree(folder_id) AS (
                    SELECT folder_id FROM drive_meta.drive_beta_folders
                    WHERE drive_id=?1 AND folder_id=?2 AND deleted_at IS NULL
                    UNION ALL
                    SELECT child.folder_id FROM drive_meta.drive_beta_folders child
                    JOIN subtree parent ON child.parent_id=parent.folder_id
                    WHERE child.drive_id=?1 AND child.deleted_at IS NULL
                 )
                 UPDATE drive_meta.drive_beta_folders
                 SET deleted_at=?3, updated_at=?3, version=version+1
                 WHERE drive_id=?1 AND folder_id IN (SELECT folder_id FROM subtree)",
                params![drive_id, folder_id, now],
            )
            .map_err(|error| format!("DRIVE_ENGINE_FOLDER_DELETE_FAILED: {error}"))?;
        tx.execute(
            "UPDATE drive_meta.drive_beta_files SET deleted_at=?1, updated_at=?1
             WHERE drive_id=?2 AND folder_id IN (
                WITH RECURSIVE subtree(folder_id) AS (
                    SELECT folder_id FROM drive_meta.drive_beta_folders
                    WHERE drive_id=?2 AND folder_id=?3
                    UNION ALL
                    SELECT child.folder_id FROM drive_meta.drive_beta_folders child
                    JOIN subtree parent ON child.parent_id=parent.folder_id
                    WHERE child.drive_id=?2
                ) SELECT folder_id FROM subtree
             ) AND deleted_at IS NULL",
            params![now, drive_id, folder_id],
        )
        .map_err(|error| format!("DRIVE_ENGINE_FILE_DELETE_FAILED: {error}"))?;
        insert_event(
            &tx,
            &drive_id,
            &device_id,
            "DELETE_FOLDER",
            "folder",
            &folder_id,
            current.version + 1,
            &json!({"recursive": true, "affectedFolders": affected}),
            now,
        )?;
        tx.commit()
            .map_err(|error| format!("DRIVE_ENGINE_FOLDER_DELETE_COMMIT_FAILED: {error}"))?;
        Ok(affected)
    }

    pub fn soft_delete_drive(
        &self,
        account_id: &str,
        drive_id: &str,
        device_id: Option<&str>,
    ) -> Result<usize, String> {
        let account_id = validate_identifier(account_id, "ACCOUNT")?;
        let drive_id = validate_identifier(drive_id, "DRIVE")?;
        let device_id = normalize_device_id(device_id);
        let now = now_ms();
        let mut conn = self.connection()?;
        let tx = conn
            .transaction()
            .map_err(|error| format!("DRIVE_ENGINE_DELETE_TX_FAILED: {error}"))?;
        let root_id = require_drive(&tx, &account_id, &drive_id)?;
        let affected = tx
            .execute(
                "UPDATE drive_meta.drive_beta_folders
                 SET deleted_at=?1, updated_at=?1, version=version+1
                 WHERE drive_id=?2 AND deleted_at IS NULL",
                params![now, drive_id],
            )
            .map_err(|error| format!("DRIVE_ENGINE_DELETE_FOLDERS_FAILED: {error}"))?;
        tx.execute(
            "UPDATE drive_meta.drive_beta_files
             SET deleted_at=?1, updated_at=?1 WHERE drive_id=?2 AND deleted_at IS NULL",
            params![now, drive_id],
        )
        .map_err(|error| format!("DRIVE_ENGINE_DELETE_FILES_FAILED: {error}"))?;
        tx.execute(
            "UPDATE drive_meta.drive_beta_telegram_mapping
             SET deleted_at=?1, updated_at=?1, version=version+1
             WHERE drive_id=?2 AND deleted_at IS NULL",
            params![now, drive_id],
        )
        .map_err(|error| format!("DRIVE_ENGINE_DELETE_MAPPINGS_FAILED: {error}"))?;
        tx.execute(
            "UPDATE drive_beta_registry
             SET state='deleted', deleted_at=?1, updated_at=?1, version=version+1
             WHERE drive_id=?2 AND account_id=?3 AND deleted_at IS NULL",
            params![now, drive_id, account_id],
        )
        .map_err(|error| format!("DRIVE_ENGINE_DELETE_REGISTRY_FAILED: {error}"))?;
        insert_event(
            &tx,
            &drive_id,
            &device_id,
            "DELETE_DRIVE",
            "drive",
            &drive_id,
            1,
            &json!({"rootFolderId": root_id, "recursive": true}),
            now,
        )?;
        tx.commit()
            .map_err(|error| format!("DRIVE_ENGINE_DELETE_COMMIT_FAILED: {error}"))?;
        Ok(affected)
    }

    pub fn create_snapshot(
        &self,
        account_id: &str,
        drive_id: &str,
        device_id: Option<&str>,
    ) -> Result<SnapshotRecord, String> {
        let account_id = validate_identifier(account_id, "ACCOUNT")?;
        let drive_id = validate_identifier(drive_id, "DRIVE")?;
        let device_id = normalize_device_id(device_id);
        let conn = self.connection()?;
        let _ = require_drive(&conn, &account_id, &drive_id)?;
        let folders = query_json_rows(
            &conn,
            "SELECT json_object(
                'folderId', folder_id, 'parentId', parent_id, 'name', name,
                'version', version, 'hash', object_hash, 'createdAt', created_at,
                'updatedAt', updated_at, 'deletedAt', deleted_at)
             FROM drive_meta.drive_beta_folders WHERE drive_id=?1 ORDER BY folder_id",
            &drive_id,
        )?;
        let mappings = query_json_rows(
            &conn,
            "SELECT json_object(
                'mappingId', mapping_id, 'objectType', object_type, 'objectId', object_id,
                'chatId', telegram_chat_id, 'topicId', telegram_topic_id,
                'messageId', telegram_message_id, 'storageType', storage_type,
                'version', version, 'createdAt', created_at, 'updatedAt', updated_at,
                'deletedAt', deleted_at)
             FROM drive_meta.drive_beta_telegram_mapping WHERE drive_id=?1 ORDER BY mapping_id",
            &drive_id,
        )?;
        let files = query_json_rows(
            &conn,
            "SELECT json_object(
                'fileId', file_id, 'folderId', folder_id, 'filename', filename,
                'size', size, 'mime', mime, 'contentHash', content_hash,
                'telegramUniqueId', telegram_unique_id, 'createdAt', created_at,
                'updatedAt', updated_at, 'deletedAt', deleted_at)
             FROM drive_meta.drive_beta_files WHERE drive_id=?1 ORDER BY file_id",
            &drive_id,
        )?;
        let event_cursor: Option<String> = conn
            .query_row(
                "SELECT event_id FROM drive_meta.drive_beta_events
                 WHERE drive_id=?1 ORDER BY occurred_at DESC, event_id DESC LIMIT 1",
                params![drive_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("DRIVE_ENGINE_SNAPSHOT_CURSOR_FAILED: {error}"))?;
        let payload = json!({
            "schemaVersion": SCHEMA_VERSION,
            "driveId": drive_id,
            "eventCursor": event_cursor,
            "folders": folders,
            "files": files,
            "mappings": mappings,
        });
        let payload_json = serde_json::to_string(&payload)
            .map_err(|error| format!("DRIVE_ENGINE_SNAPSHOT_SERIALIZE_FAILED: {error}"))?;
        let payload_hash = sha256_hex(payload_json.as_bytes());
        let snapshot_id = uuid_v4();
        let now = now_ms();
        conn.execute(
            "INSERT INTO drive_meta.drive_beta_snapshots(
                snapshot_id, drive_id, device_id, event_cursor, payload_json,
                payload_hash, created_at, remote_message_id, verified_at
             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?7)",
            params![
                snapshot_id,
                drive_id,
                device_id,
                event_cursor,
                payload_json,
                payload_hash,
                now
            ],
        )
        .map_err(|error| format!("DRIVE_ENGINE_SNAPSHOT_INSERT_FAILED: {error}"))?;
        Ok(SnapshotRecord {
            snapshot_id,
            drive_id,
            payload_hash,
            created_at: now,
            folder_count: folders.len(),
            file_count: files.len(),
            mapping_count: mappings.len(),
        })
    }

    pub fn restore_latest_snapshot(
        &self,
        account_id: &str,
        drive_id: &str,
    ) -> Result<RecoveryRecord, String> {
        let account_id = validate_identifier(account_id, "ACCOUNT")?;
        let drive_id = validate_identifier(drive_id, "DRIVE")?;
        let mut conn = self.connection()?;
        let _ = require_drive(&conn, &account_id, &drive_id)?;
        let snapshot = conn
            .query_row(
                "SELECT snapshot_id, payload_json, payload_hash
                 FROM drive_meta.drive_beta_snapshots
                 WHERE drive_id=?1
                 ORDER BY created_at DESC, snapshot_id DESC LIMIT 1",
                params![drive_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("DRIVE_ENGINE_RECOVERY_SNAPSHOT_LOOKUP_FAILED: {error}"))?
            .ok_or("DRIVE_ENGINE_RECOVERY_SNAPSHOT_NOT_FOUND")?;
        let (snapshot_id, payload_json, expected_hash) = snapshot;
        let payload_hash = sha256_hex(payload_json.as_bytes());
        if payload_hash != expected_hash {
            return Err("DRIVE_ENGINE_RECOVERY_SNAPSHOT_HASH_MISMATCH".into());
        }
        let payload: SnapshotPayload = serde_json::from_str(&payload_json)
            .map_err(|error| format!("DRIVE_ENGINE_RECOVERY_SNAPSHOT_INVALID: {error}"))?;
        if payload.schema_version > SCHEMA_VERSION || payload.drive_id != drive_id {
            return Err("DRIVE_ENGINE_RECOVERY_SNAPSHOT_INCOMPATIBLE".into());
        }
        let root_folder_id = require_drive(&conn, &account_id, &drive_id)?;
        if !payload
            .folders
            .iter()
            .any(|folder| folder.folder_id == root_folder_id && folder.parent_id.is_none())
        {
            return Err("DRIVE_ENGINE_RECOVERY_ROOT_MISSING".into());
        }
        let restored_at = now_ms();
        let tx = conn
            .transaction()
            .map_err(|error| format!("DRIVE_ENGINE_RECOVERY_TX_FAILED: {error}"))?;
        tx.execute(
            "DELETE FROM drive_meta.drive_beta_telegram_mapping WHERE drive_id=?1",
            params![drive_id],
        )
        .map_err(|error| format!("DRIVE_ENGINE_RECOVERY_MAPPING_CLEAR_FAILED: {error}"))?;
        tx.execute(
            "DELETE FROM drive_meta.drive_beta_files WHERE drive_id=?1",
            params![drive_id],
        )
        .map_err(|error| format!("DRIVE_ENGINE_RECOVERY_FILE_CLEAR_FAILED: {error}"))?;
        tx.execute(
            "DELETE FROM drive_meta.drive_beta_folders WHERE drive_id=?1",
            params![drive_id],
        )
        .map_err(|error| format!("DRIVE_ENGINE_RECOVERY_FOLDER_CLEAR_FAILED: {error}"))?;
        for folder in &payload.folders {
            tx.execute(
                "INSERT INTO drive_meta.drive_beta_folders(
                    folder_id, drive_id, parent_id, name, version, object_hash,
                    created_at, updated_at, deleted_at
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    folder.folder_id,
                    drive_id,
                    folder.parent_id,
                    folder.name,
                    folder.version,
                    folder.object_hash,
                    folder.created_at,
                    folder.updated_at,
                    folder.deleted_at
                ],
            )
            .map_err(|error| format!("DRIVE_ENGINE_RECOVERY_FOLDER_INSERT_FAILED: {error}"))?;
        }
        for file in &payload.files {
            tx.execute(
                "INSERT INTO drive_meta.drive_beta_files(
                    file_id, drive_id, folder_id, filename, size, mime, content_hash,
                    telegram_unique_id, created_at, updated_at, deleted_at
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    file.file_id,
                    drive_id,
                    file.folder_id,
                    file.filename,
                    file.size,
                    file.mime,
                    file.content_hash,
                    file.telegram_unique_id,
                    file.created_at,
                    file.updated_at,
                    file.deleted_at
                ],
            )
            .map_err(|error| format!("DRIVE_ENGINE_RECOVERY_FILE_INSERT_FAILED: {error}"))?;
        }
        for mapping in &payload.mappings {
            tx.execute(
                "INSERT INTO drive_meta.drive_beta_telegram_mapping(
                    mapping_id, drive_id, object_type, object_id, telegram_chat_id,
                    telegram_topic_id, telegram_message_id, storage_type, version,
                    created_at, updated_at, deleted_at
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    mapping.mapping_id,
                    drive_id,
                    mapping.object_type,
                    mapping.object_id,
                    mapping.telegram_chat_id,
                    mapping.telegram_topic_id,
                    mapping.telegram_message_id,
                    mapping.storage_type,
                    mapping.version,
                    mapping.created_at,
                    mapping.updated_at,
                    mapping.deleted_at
                ],
            )
            .map_err(|error| format!("DRIVE_ENGINE_RECOVERY_MAPPING_INSERT_FAILED: {error}"))?;
        }
        tx.execute(
            "UPDATE drive_meta.drive_beta_snapshots SET verified_at=?1 WHERE snapshot_id=?2",
            params![restored_at, snapshot_id],
        )
        .map_err(|error| format!("DRIVE_ENGINE_RECOVERY_VERIFY_UPDATE_FAILED: {error}"))?;
        tx.commit()
            .map_err(|error| format!("DRIVE_ENGINE_RECOVERY_COMMIT_FAILED: {error}"))?;
        let integrity = self.integrity_report()?;
        if !integrity.ok {
            return Err("DRIVE_ENGINE_RECOVERY_INTEGRITY_FAILED".into());
        }
        Ok(RecoveryRecord {
            snapshot_id,
            drive_id,
            payload_hash,
            restored_folder_count: payload.folders.len(),
            restored_file_count: payload.files.len(),
            restored_mapping_count: payload.mappings.len(),
            restored_at,
        })
    }

    pub fn integrity_report(&self) -> Result<IntegrityReport, String> {
        let conn = self.connection()?;
        self.integrity_report_with(&conn)
    }

    fn integrity_report_with(&self, conn: &Connection) -> Result<IntegrityReport, String> {
        let system_integrity: String = conn
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|error| format!("DRIVE_ENGINE_SYSTEM_INTEGRITY_FAILED: {error}"))?;
        let metadata_integrity: String = conn
            .query_row("PRAGMA drive_meta.integrity_check", [], |row| row.get(0))
            .map_err(|error| format!("DRIVE_ENGINE_METADATA_INTEGRITY_FAILED: {error}"))?;
        let orphan_folder_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM drive_meta.drive_beta_folders child
                 LEFT JOIN drive_meta.drive_beta_folders parent
                   ON parent.drive_id=child.drive_id AND parent.folder_id=child.parent_id
                 WHERE child.parent_id IS NOT NULL AND child.deleted_at IS NULL
                   AND (parent.folder_id IS NULL OR parent.deleted_at IS NOT NULL)",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("DRIVE_ENGINE_ORPHAN_CHECK_FAILED: {error}"))?;
        let missing_root_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM drive_beta_registry registry
                 LEFT JOIN drive_meta.drive_beta_folders root
                   ON root.drive_id=registry.drive_id AND root.folder_id=registry.root_folder_id
                 WHERE registry.deleted_at IS NULL
                   AND (root.folder_id IS NULL OR root.parent_id IS NOT NULL OR root.deleted_at IS NOT NULL)",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("DRIVE_ENGINE_ROOT_CHECK_FAILED: {error}"))?;
        let dangling_mapping_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM drive_meta.drive_beta_telegram_mapping mapping
                 LEFT JOIN drive_meta.drive_beta_folders folder
                   ON mapping.object_type='folder' AND folder.drive_id=mapping.drive_id
                  AND folder.folder_id=mapping.object_id
                 LEFT JOIN drive_meta.drive_beta_files file
                   ON mapping.object_type='file' AND file.drive_id=mapping.drive_id
                  AND file.file_id=mapping.object_id
                 WHERE mapping.deleted_at IS NULL AND (
                    (mapping.object_type='folder' AND folder.folder_id IS NULL) OR
                    (mapping.object_type='file' AND file.file_id IS NULL)
                 )",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("DRIVE_ENGINE_MAPPING_CHECK_FAILED: {error}"))?;
        Ok(IntegrityReport {
            ok: system_integrity.eq_ignore_ascii_case("ok")
                && metadata_integrity.eq_ignore_ascii_case("ok")
                && orphan_folder_count == 0
                && missing_root_count == 0
                && dangling_mapping_count == 0,
            system_integrity,
            metadata_integrity,
            orphan_folder_count,
            missing_root_count,
            dangling_mapping_count,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotPayload {
    schema_version: i64,
    drive_id: String,
    #[serde(default)]
    folders: Vec<SnapshotFolder>,
    #[serde(default)]
    files: Vec<SnapshotFile>,
    #[serde(default)]
    mappings: Vec<SnapshotMapping>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotFolder {
    folder_id: String,
    parent_id: Option<String>,
    name: String,
    version: i64,
    #[serde(rename = "hash")]
    object_hash: String,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotFile {
    file_id: String,
    folder_id: String,
    filename: String,
    size: i64,
    mime: Option<String>,
    content_hash: Option<String>,
    telegram_unique_id: Option<String>,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotMapping {
    mapping_id: String,
    object_type: String,
    object_id: String,
    #[serde(rename = "chatId")]
    telegram_chat_id: String,
    #[serde(rename = "topicId")]
    telegram_topic_id: Option<i64>,
    #[serde(rename = "messageId")]
    telegram_message_id: Option<i64>,
    storage_type: String,
    version: i64,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
}

fn qualify_metadata_schema(schema: &str) -> String {
    schema
        .replace(
            "CREATE TABLE IF NOT EXISTS drive_beta_",
            "CREATE TABLE IF NOT EXISTS drive_meta.drive_beta_",
        )
        .replace(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_drive_beta_",
            "CREATE UNIQUE INDEX IF NOT EXISTS drive_meta.idx_drive_beta_",
        )
        .replace(
            "CREATE INDEX IF NOT EXISTS idx_drive_beta_",
            "CREATE INDEX IF NOT EXISTS drive_meta.idx_drive_beta_",
        )
        .replace(
            "INSERT INTO drive_beta_schema",
            "INSERT INTO drive_meta.drive_beta_schema",
        )
        .replace(
            "REFERENCES drive_beta_folders",
            "REFERENCES drive_beta_folders",
        )
}

fn validate_identifier(value: &str, kind: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 160 || value.chars().any(char::is_control) {
        return Err(format!("DRIVE_ENGINE_{kind}_ID_INVALID"));
    }
    Ok(value.to_string())
}

fn validate_name(value: &str) -> Result<String, String> {
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.is_empty()
        || value.len() > 255
        || value == "."
        || value == ".."
        || value
            .chars()
            .any(|character| character.is_control() || character == '/' || character == '\\')
    {
        return Err("DRIVE_ENGINE_NAME_INVALID".into());
    }
    Ok(value)
}

fn normalize_device_id(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 160)
        .map(str::to_string)
        .unwrap_or_else(|| "local-device".into())
}

fn normalize_optional_text(value: Option<&str>, max_len: usize) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(max_len).collect::<String>())
}

fn require_drive(conn: &Connection, account_id: &str, drive_id: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT root_folder_id FROM drive_beta_registry
         WHERE account_id=?1 AND drive_id=?2 AND deleted_at IS NULL",
        params![account_id, drive_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|error| format!("DRIVE_ENGINE_DRIVE_LOOKUP_FAILED: {error}"))?
    .ok_or_else(|| "DRIVE_ENGINE_DRIVE_NOT_FOUND".into())
}

fn require_folder(
    conn: &Connection,
    drive_id: &str,
    folder_id: &str,
) -> Result<FolderRecord, String> {
    conn.query_row(
        "SELECT folder_id, drive_id, parent_id, name, version, object_hash,
                created_at, updated_at, deleted_at
         FROM drive_meta.drive_beta_folders
         WHERE drive_id=?1 AND folder_id=?2 AND deleted_at IS NULL",
        params![drive_id, folder_id],
        row_to_folder,
    )
    .optional()
    .map_err(|error| format!("DRIVE_ENGINE_FOLDER_LOOKUP_FAILED: {error}"))?
    .ok_or_else(|| "DRIVE_ENGINE_FOLDER_NOT_FOUND".into())
}

fn folder_contains(
    conn: &Connection,
    drive_id: &str,
    folder_id: &str,
    candidate_id: &str,
) -> Result<bool, String> {
    conn.query_row(
        "WITH RECURSIVE subtree(folder_id) AS (
            SELECT folder_id FROM drive_meta.drive_beta_folders
            WHERE drive_id=?1 AND folder_id=?2 AND deleted_at IS NULL
            UNION ALL
            SELECT child.folder_id FROM drive_meta.drive_beta_folders child
            JOIN subtree parent ON child.parent_id=parent.folder_id
            WHERE child.drive_id=?1 AND child.deleted_at IS NULL
         ) SELECT EXISTS(SELECT 1 FROM subtree WHERE folder_id=?3)",
        params![drive_id, folder_id, candidate_id],
        |row| row.get::<_, i64>(0),
    )
    .map(|value| value != 0)
    .map_err(|error| format!("DRIVE_ENGINE_CYCLE_CHECK_FAILED: {error}"))
}

#[allow(clippy::too_many_arguments)]
fn find_duplicate_file(
    conn: &Connection,
    drive_id: &str,
    filename: &str,
    size: i64,
    content_hash: Option<&str>,
    telegram_unique_id: Option<&str>,
    telegram_chat_id: &str,
    telegram_topic_id: Option<i64>,
    telegram_message_id: i64,
) -> Result<Option<String>, String> {
    let by_message = conn
        .query_row(
            "SELECT file.file_id
             FROM drive_meta.drive_beta_telegram_mapping mapping
             JOIN drive_meta.drive_beta_files file
               ON file.drive_id=mapping.drive_id AND file.file_id=mapping.object_id
              AND file.deleted_at IS NULL
             WHERE mapping.drive_id=?1 AND mapping.object_type='file'
               AND mapping.telegram_chat_id=?2
               AND mapping.telegram_message_id=?3
               AND ((mapping.telegram_topic_id IS NULL AND ?4 IS NULL)
                    OR mapping.telegram_topic_id=?4)
               AND mapping.deleted_at IS NULL
             LIMIT 1",
            params![
                drive_id,
                telegram_chat_id,
                telegram_message_id,
                telegram_topic_id
            ],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("DRIVE_ENGINE_FILE_DEDUP_MESSAGE_FAILED: {error}"))?;
    if by_message.is_some() {
        return Ok(by_message);
    }
    if let Some(unique_id) = telegram_unique_id {
        let by_unique = conn
            .query_row(
                "SELECT file_id FROM drive_meta.drive_beta_files
                 WHERE drive_id=?1 AND telegram_unique_id=?2 AND deleted_at IS NULL LIMIT 1",
                params![drive_id, unique_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("DRIVE_ENGINE_FILE_DEDUP_UNIQUE_FAILED: {error}"))?;
        if by_unique.is_some() {
            return Ok(by_unique);
        }
    }
    if let Some(hash) = content_hash {
        let by_hash = conn
            .query_row(
                "SELECT file_id FROM drive_meta.drive_beta_files
                 WHERE drive_id=?1 AND content_hash=?2 AND deleted_at IS NULL LIMIT 1",
                params![drive_id, hash],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("DRIVE_ENGINE_FILE_DEDUP_HASH_FAILED: {error}"))?;
        if by_hash.is_some() {
            return Ok(by_hash);
        }
    }
    conn.query_row(
        "SELECT file_id FROM drive_meta.drive_beta_files
         WHERE drive_id=?1 AND filename=?2 COLLATE NOCASE AND size=?3
           AND deleted_at IS NULL LIMIT 1",
        params![drive_id, filename, size],
        |row| row.get(0),
    )
    .optional()
    .map_err(|error| format!("DRIVE_ENGINE_FILE_DEDUP_NAME_SIZE_FAILED: {error}"))
}

fn query_file_by_id(
    conn: &Connection,
    drive_id: &str,
    file_id: &str,
) -> Result<FileRecord, String> {
    conn.query_row(
        "SELECT file.file_id, file.drive_id, file.folder_id, file.filename,
                file.size, file.mime, file.content_hash, file.telegram_unique_id,
                mapping.telegram_chat_id, mapping.telegram_topic_id,
                mapping.telegram_message_id, file.created_at, file.updated_at
         FROM drive_meta.drive_beta_files file
         JOIN drive_meta.drive_beta_telegram_mapping mapping
           ON mapping.drive_id=file.drive_id AND mapping.object_type='file'
          AND mapping.object_id=file.file_id AND mapping.deleted_at IS NULL
         WHERE file.drive_id=?1 AND file.file_id=?2 AND file.deleted_at IS NULL
           AND mapping.telegram_message_id IS NOT NULL
         LIMIT 1",
        params![drive_id, file_id],
        row_to_file,
    )
    .map_err(|error| format!("DRIVE_ENGINE_FILE_LOOKUP_FAILED: {error}"))
}

fn insert_event(
    tx: &Transaction<'_>,
    drive_id: &str,
    device_id: &str,
    action: &str,
    object_type: &str,
    object_id: &str,
    object_version: i64,
    payload: &Value,
    occurred_at: i64,
) -> Result<(), String> {
    let payload_json = serde_json::to_string(payload)
        .map_err(|error| format!("DRIVE_ENGINE_EVENT_SERIALIZE_FAILED: {error}"))?;
    tx.execute(
        "INSERT INTO drive_meta.drive_beta_events(
            event_id, drive_id, device_id, action, object_type, object_id,
            object_version, payload_json, occurred_at, status, retry_count
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', 0)",
        params![
            uuid_v4(),
            drive_id,
            device_id,
            action,
            object_type,
            object_id,
            object_version,
            payload_json,
            occurred_at
        ],
    )
    .map_err(|error| format!("DRIVE_ENGINE_EVENT_INSERT_FAILED: {error}"))?;
    Ok(())
}

fn query_json_rows(conn: &Connection, sql: &str, drive_id: &str) -> Result<Vec<Value>, String> {
    let mut statement = conn
        .prepare(sql)
        .map_err(|error| format!("DRIVE_ENGINE_SNAPSHOT_QUERY_PREPARE_FAILED: {error}"))?;
    let rows: Result<Vec<Value>, String> = statement
        .query_map(params![drive_id], |row| row.get::<_, String>(0))
        .map_err(|error| format!("DRIVE_ENGINE_SNAPSHOT_QUERY_FAILED: {error}"))?
        .map(|row| {
            let raw = row.map_err(|error| format!("DRIVE_ENGINE_SNAPSHOT_ROW_FAILED: {error}"))?;
            serde_json::from_str(&raw)
                .map_err(|error| format!("DRIVE_ENGINE_SNAPSHOT_JSON_FAILED: {error}"))
        })
        .collect();
    rows
}

fn row_to_folder(row: &rusqlite::Row<'_>) -> rusqlite::Result<FolderRecord> {
    Ok(FolderRecord {
        folder_id: row.get(0)?,
        drive_id: row.get(1)?,
        parent_id: row.get(2)?,
        name: row.get(3)?,
        telegram_chat_id: None,
        telegram_topic_id: None,
        version: row.get(4)?,
        object_hash: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        deleted_at: row.get(8)?,
    })
}

fn row_to_mapped_folder(row: &rusqlite::Row<'_>) -> rusqlite::Result<FolderRecord> {
    let mut folder = row_to_folder(row)?;
    folder.telegram_chat_id = row.get(9)?;
    folder.telegram_topic_id = row.get(10)?;
    Ok(folder)
}

fn row_to_file(row: &rusqlite::Row<'_>) -> rusqlite::Result<FileRecord> {
    Ok(FileRecord {
        file_id: row.get(0)?,
        drive_id: row.get(1)?,
        folder_id: row.get(2)?,
        filename: row.get(3)?,
        size: row.get(4)?,
        mime: row.get(5)?,
        content_hash: row.get(6)?,
        telegram_unique_id: row.get(7)?,
        telegram_chat_id: row.get(8)?,
        telegram_topic_id: row.get(9)?,
        telegram_message_id: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn row_to_drive(row: &rusqlite::Row<'_>) -> rusqlite::Result<DriveRecord> {
    Ok(DriveRecord {
        drive_id: row.get(0)?,
        account_id: row.get(1)?,
        name: row.get(2)?,
        root_folder_id: row.get(3)?,
        storage_peer_id: row.get(4)?,
        storage_topic_id: row.get(5)?,
        state: row.get(6)?,
        version: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn map_constraint(prefix: &str, error: rusqlite::Error) -> String {
    if matches!(error, rusqlite::Error::SqliteFailure(_, Some(ref message)) if message.contains("UNIQUE constraint failed"))
    {
        format!("{prefix}: DRIVE_ENGINE_NAME_CONFLICT")
    } else {
        format!("{prefix}: {error}")
    }
}

fn folder_hash(
    drive_id: &str,
    parent_id: Option<&str>,
    name: &str,
    version: i64,
    deleted_at: Option<i64>,
) -> String {
    sha256_hex(
        format!(
            "folder\n{drive_id}\n{}\n{name}\n{version}\n{}",
            parent_id.unwrap_or(""),
            deleted_at
                .map(|value| value.to_string())
                .unwrap_or_default()
        )
        .as_bytes(),
    )
}

fn manifest_hash(drive_id: &str, account_id: &str, root_folder_id: &str, version: i64) -> String {
    sha256_hex(format!("drive\n{drive_id}\n{account_id}\n{root_folder_id}\n{version}").as_bytes())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn uuid_v4() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store(label: &str) -> (DriveStore, PathBuf) {
        let root = std::env::temp_dir().join(format!("autogram-drive-beta-{label}-{}", uuid_v4()));
        (
            DriveStore::open_at(root.clone()).expect("open test store"),
            root,
        )
    }

    #[test]
    fn recursive_hierarchy_is_local_and_cycle_safe() {
        let (store, root) = test_store("hierarchy");
        let drive = store
            .create_drive(
                "session-a",
                "Project",
                Some("-1001"),
                None,
                Some("device-a"),
            )
            .expect("create drive");
        let client = store
            .create_folder(
                "session-a",
                &drive.drive_id,
                None,
                "Client A",
                None,
                None,
                Some("device-a"),
            )
            .expect("create client");
        let docs = store
            .create_folder(
                "session-a",
                &drive.drive_id,
                Some(&client.folder_id),
                "Dokumentasi",
                None,
                None,
                Some("device-a"),
            )
            .expect("create docs");
        let photos = store
            .create_folder(
                "session-a",
                &drive.drive_id,
                Some(&docs.folder_id),
                "Foto",
                None,
                None,
                Some("device-a"),
            )
            .expect("create photos");
        let error = store
            .move_folder(
                "session-a",
                &drive.drive_id,
                &client.folder_id,
                &photos.folder_id,
                Some("device-a"),
            )
            .expect_err("cycle must fail");
        assert_eq!(error, "DRIVE_ENGINE_FOLDER_CYCLE_FORBIDDEN");
        let children = store
            .list_children(
                "session-a",
                &drive.drive_id,
                Some(&docs.folder_id),
                Some(10),
                None,
            )
            .expect("list docs");
        assert_eq!(children.folders.len(), 1);
        assert_eq!(children.folders[0].name, "Foto");
        assert!(store.integrity_report().expect("integrity").ok);
        drop(store);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn soft_delete_preserves_journal_and_snapshot() {
        let (store, root) = test_store("recovery");
        let drive = store
            .create_drive("session-b", "Archive", None, None, None)
            .expect("create drive");
        let folder = store
            .create_folder("session-b", &drive.drive_id, None, "Keep Metadata", None, None, None)
            .expect("create folder");
        let child = store
            .create_folder(
                "session-b",
                &drive.drive_id,
                Some(&folder.folder_id),
                "Child",
                None,
                None,
                None,
            )
            .expect("create child");
        let snapshot = store
            .create_snapshot("session-b", &drive.drive_id, None)
            .expect("snapshot");
        assert_eq!(snapshot.folder_count, 3);
        assert_eq!(
            store
                .soft_delete_folder("session-b", &drive.drive_id, &folder.folder_id, None)
                .expect("delete"),
            2
        );
        let conn = store.connection().expect("connection");
        let deleted: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM drive_meta.drive_beta_folders
                 WHERE drive_id=?1 AND folder_id IN (?2, ?3) AND deleted_at IS NOT NULL",
                params![drive.drive_id, folder.folder_id, child.folder_id],
                |row| row.get(0),
            )
            .expect("deleted rows");
        assert_eq!(deleted, 2);
        let events: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM drive_meta.drive_beta_events WHERE drive_id=?1",
                params![drive.drive_id],
                |row| row.get(0),
            )
            .expect("event rows");
        assert_eq!(events, 4);
        drop(conn);
        drop(store);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn accounts_are_strictly_isolated() {
        let (store, root) = test_store("accounts");
        let drive = store
            .create_drive("session-a", "Private", None, None, None)
            .expect("create drive");
        let error = store
            .list_children("session-b", &drive.drive_id, None, None, None)
            .expect_err("cross-account read must fail");
        assert_eq!(error, "DRIVE_ENGINE_DRIVE_NOT_FOUND");
        let owner_page = store
            .list_drives("session-a", Some(10), None)
            .expect("owner drive list");
        assert_eq!(owner_page.drives, vec![drive]);
        let other_page = store
            .list_drives("session-b", Some(10), None)
            .expect("other drive list");
        assert!(other_page.drives.is_empty());
        drop(store);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn concurrent_duplicate_drive_creation_keeps_one_canonical_record() {
        use std::sync::{Arc, Barrier};

        let (store, root) = test_store("drive-race");
        let barrier = Arc::new(Barrier::new(3));
        let handles = (0..2)
            .map(|index| {
                let store = store.clone();
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    store.create_drive(
                        "session-race",
                        "Canonical",
                        None,
                        None,
                        Some(&format!("device-{index}")),
                    )
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        let results = handles
            .into_iter()
            .map(|handle| handle.join().expect("race worker"))
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(results.iter().filter(|result| result.is_err()).count(), 1);
        let page = store
            .list_drives("session-race", Some(10), None)
            .expect("race list");
        assert_eq!(page.drives.len(), 1);
        assert_eq!(page.drives[0].name, "Canonical");
        assert!(store.integrity_report().expect("integrity").ok);
        drop(store);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn snapshot_restore_is_hash_verified_and_transactional() {
        let (store, root) = test_store("snapshot-restore");
        let drive = store
            .create_drive(
                "session-recovery",
                "Recovery",
                Some("-100777"),
                Some(42),
                Some("device-a"),
            )
            .expect("create drive");
        let folder = store
            .create_folder(
                "session-recovery",
                &drive.drive_id,
                None,
                "Before Snapshot",
                None,
                None,
                Some("device-a"),
            )
            .expect("create folder");
        let snapshot = store
            .create_snapshot("session-recovery", &drive.drive_id, Some("device-a"))
            .expect("snapshot");
        assert_eq!(snapshot.folder_count, 2);
        assert_eq!(snapshot.file_count, 0);
        assert_eq!(snapshot.mapping_count, 1);
        store
            .rename_folder(
                "session-recovery",
                &drive.drive_id,
                &folder.folder_id,
                "After Snapshot",
                Some("device-a"),
            )
            .expect("rename after snapshot");
        let restored = store
            .restore_latest_snapshot("session-recovery", &drive.drive_id)
            .expect("restore snapshot");
        assert_eq!(restored.snapshot_id, snapshot.snapshot_id);
        assert_eq!(restored.restored_folder_count, 2);
        let children = store
            .list_children("session-recovery", &drive.drive_id, None, Some(10), None)
            .expect("children after restore");
        assert_eq!(children.folders.len(), 1);
        assert_eq!(children.folders[0].name, "Before Snapshot");
        let conn = store.connection().expect("connection");
        conn.execute(
            "UPDATE drive_meta.drive_beta_snapshots SET payload_hash='tampered'
             WHERE snapshot_id=?1",
            params![snapshot.snapshot_id],
        )
        .expect("tamper hash");
        drop(conn);
        let error = store
            .restore_latest_snapshot("session-recovery", &drive.drive_id)
            .expect_err("tampered snapshot must fail");
        assert_eq!(error, "DRIVE_ENGINE_RECOVERY_SNAPSHOT_HASH_MISMATCH");
        let still_restored = store
            .list_children("session-recovery", &drive.drive_id, None, Some(10), None)
            .expect("state after rejected restore");
        assert_eq!(still_restored.folders[0].name, "Before Snapshot");
        drop(store);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn committed_files_are_folder_scoped_and_four_layer_deduplicated() {
        let (store, root) = test_store("file-mapping");
        let drive = store
            .create_drive("session-files", "Files", Some("-100444"), None, None)
            .expect("create drive");
        let first_folder = store
            .create_folder("session-files", &drive.drive_id, None, "First", None, None, None)
            .expect("first folder");
        let second_folder = store
            .create_folder("session-files", &drive.drive_id, None, "Second", None, None, None)
            .expect("second folder");
        let committed = store
            .commit_file(
                "session-files",
                &drive.drive_id,
                &first_folder.folder_id,
                "photo.jpg",
                4096,
                Some("image/jpeg"),
                Some("sha256:first"),
                Some("telegram:unique:first"),
                "-100444",
                None,
                91,
                None,
            )
            .expect("commit file");
        let duplicate = store
            .commit_file(
                "session-files",
                &drive.drive_id,
                &second_folder.folder_id,
                "renamed.jpg",
                8192,
                Some("image/jpeg"),
                Some("sha256:second"),
                Some("telegram:unique:second"),
                "-100444",
                None,
                91,
                None,
            )
            .expect("message duplicate resolves canonical file");
        assert_eq!(duplicate.file_id, committed.file_id);
        let first_page = store
            .list_files(
                "session-files",
                &drive.drive_id,
                &first_folder.folder_id,
                Some(10),
                None,
                None,
                None,
            )
            .expect("first page");
        let second_page = store
            .list_files(
                "session-files",
                &drive.drive_id,
                &second_folder.folder_id,
                Some(10),
                None,
                None,
                None,
            )
            .expect("second page");
        assert_eq!(first_page.files, vec![committed]);
        assert!(second_page.files.is_empty());
        store
            .commit_file(
                "session-files",
                &drive.drive_id,
                &first_folder.folder_id,
                "clip.mp4",
                16_384,
                Some("video/mp4"),
                Some("sha256:video"),
                Some("telegram:unique:video"),
                "-100444",
                None,
                92,
                None,
            )
            .expect("commit video");
        let images = store
            .list_files(
                "session-files",
                &drive.drive_id,
                &first_folder.folder_id,
                Some(10),
                None,
                Some("newest"),
                Some("images"),
            )
            .expect("image filter");
        assert_eq!(images.total_count, 1);
        assert_eq!(images.total_bytes, 4096);
        assert_eq!(images.files[0].filename, "photo.jpg");
        let largest = store
            .list_files(
                "session-files",
                &drive.drive_id,
                &first_folder.folder_id,
                Some(1),
                None,
                Some("size_desc"),
                Some("all"),
            )
            .expect("global sort");
        assert_eq!(largest.total_count, 2);
        assert_eq!(largest.files[0].filename, "clip.mp4");
        assert!(largest.has_more);
        let error = store
            .list_files(
                "another-session",
                &drive.drive_id,
                &first_folder.folder_id,
                Some(10),
                None,
                None,
                None,
            )
            .expect_err("cross-account file read must fail");
        assert_eq!(error, "DRIVE_ENGINE_DRIVE_NOT_FOUND");
        assert!(store.integrity_report().expect("integrity").ok);
        drop(store);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn production_drive_rename_move_delete_lifecycle_is_recoverable() {
        let (store, root) = test_store("production-lifecycle");
        let drive = store
            .create_drive("session-life", "Original", Some("-100555"), None, None)
            .expect("create drive");
        let source = store
            .create_folder("session-life", &drive.drive_id, None, "Source", None, None, None)
            .expect("source");
        let destination = store
            .create_folder("session-life", &drive.drive_id, None, "Destination", None, None, None)
            .expect("destination");
        store
            .rename_folder(
                "session-life",
                &drive.drive_id,
                &drive.root_folder_id,
                "Renamed",
                None,
            )
            .expect("rename root");
        assert_eq!(
            store
                .list_drives("session-life", Some(10), None)
                .expect("list renamed")
                .drives[0]
                .name,
            "Renamed"
        );
        store
            .commit_file(
                "session-life",
                &drive.drive_id,
                &source.folder_id,
                "clip.mp4",
                1024,
                Some("video/mp4"),
                None,
                None,
                "-100555",
                None,
                12,
                None,
            )
            .expect("commit");
        assert_eq!(
            store
                .move_files(
                    "session-life",
                    &drive.drive_id,
                    &source.folder_id,
                    &destination.folder_id,
                    &[12],
                    None,
                )
                .expect("move"),
            1
        );
        assert!(store
            .list_files(
                "session-life",
                &drive.drive_id,
                &source.folder_id,
                Some(10),
                None,
                None,
                None,
            )
            .expect("source empty")
            .files
            .is_empty());
        assert_eq!(
            store
                .soft_delete_files(
                    "session-life",
                    &drive.drive_id,
                    &destination.folder_id,
                    &[12],
                    None,
                )
                .expect("delete file"),
            1
        );
        let snapshot = store
            .create_snapshot("session-life", &drive.drive_id, None)
            .expect("snapshot before drive delete");
        assert_eq!(snapshot.file_count, 1);
        assert_eq!(
            store
                .soft_delete_drive("session-life", &drive.drive_id, None)
                .expect("soft delete drive"),
            3
        );
        assert!(store
            .list_drives("session-life", Some(10), None)
            .expect("hidden deleted drive")
            .drives
            .is_empty());
        drop(store);
        let _ = std::fs::remove_dir_all(root);
    }
}
