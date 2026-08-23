use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::models::{
    DriveBetaStatus, DrivePage, DriveRecord, FolderPage, FolderRecord, IntegrityReport,
    SnapshotRecord,
};

const SYSTEM_SCHEMA: &str = include_str!(
    "../../../../../database/migrations/016_drive_beta_system.sql"
);
const SYSTEM_HARDENING_SCHEMA: &str = include_str!(
    "../../../../../database/migrations/018_drive_beta_phase1_hardening.sql"
);
const METADATA_SCHEMA: &str = include_str!(
    "../../../../../database/migrations/017_drive_beta_metadata.sql"
);
const SCHEMA_VERSION: i64 = 2;
const DEFAULT_PAGE_SIZE: usize = 100;
const MAX_PAGE_SIZE: usize = 200;

#[derive(Debug, Clone)]
pub struct DriveBetaStore {
    root: PathBuf,
}

impl DriveBetaStore {
    pub fn open_default() -> Result<Self, String> {
        let db_root = super::super::jobs_db::resolve_migrator_db()
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("database"))
            .join("drive_beta");
        Self::open_at(db_root)
    }

    pub fn open_at(root: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&root)
            .map_err(|error| format!("DRIVE_BETA_DB_DIR_CREATE_FAILED: {error}"))?;
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
            .map_err(|error| format!("DRIVE_BETA_SYSTEM_DB_OPEN_FAILED: {error}"))?;
        conn.busy_timeout(std::time::Duration::from_secs(30))
            .map_err(|error| format!("DRIVE_BETA_BUSY_TIMEOUT_FAILED: {error}"))?;
        conn.execute_batch(
            "PRAGMA foreign_keys=ON;
             PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA temp_store=MEMORY;",
        )
        .map_err(|error| format!("DRIVE_BETA_SYSTEM_PRAGMA_FAILED: {error}"))?;
        let meta_path = self.metadata_path().to_string_lossy().to_string();
        conn.execute("ATTACH DATABASE ?1 AS drive_meta", params![meta_path])
            .map_err(|error| format!("DRIVE_BETA_METADATA_ATTACH_FAILED: {error}"))?;
        conn.execute_batch(
            "PRAGMA drive_meta.journal_mode=WAL;
             PRAGMA drive_meta.synchronous=NORMAL;",
        )
        .map_err(|error| format!("DRIVE_BETA_METADATA_PRAGMA_FAILED: {error}"))?;
        conn.execute_batch(SYSTEM_SCHEMA)
            .map_err(|error| format!("DRIVE_BETA_SYSTEM_SCHEMA_FAILED: {error}"))?;
        conn.execute_batch(SYSTEM_HARDENING_SCHEMA)
            .map_err(|error| format!("DRIVE_BETA_SYSTEM_HARDENING_FAILED: {error}"))?;
        conn.execute_batch(&qualify_metadata_schema(METADATA_SCHEMA))
            .map_err(|error| format!("DRIVE_BETA_METADATA_SCHEMA_FAILED: {error}"))?;
        Ok(conn)
    }

    pub fn status(&self) -> Result<DriveBetaStatus, String> {
        let conn = self.connection()?;
        let drive_count = conn
            .query_row(
                "SELECT COUNT(*) FROM drive_beta_registry WHERE deleted_at IS NULL",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("DRIVE_BETA_STATUS_DRIVES_FAILED: {error}"))?;
        let pending_event_count = conn
            .query_row(
                "SELECT COUNT(*) FROM drive_meta.drive_beta_events WHERE status IN ('pending','syncing','failed')",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("DRIVE_BETA_STATUS_EVENTS_FAILED: {error}"))?;
        let integrity = self.integrity_report_with(&conn)?;
        Ok(DriveBetaStatus {
            enabled: super::enabled(),
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
            .map_err(|error| format!("DRIVE_BETA_CREATE_TX_FAILED: {error}"))?;
        tx.execute(
            "INSERT INTO drive_beta_accounts(account_id, display_name, created_at, last_seen_at)
             VALUES(?1, NULL, ?2, ?2)
             ON CONFLICT(account_id) DO UPDATE SET last_seen_at=excluded.last_seen_at",
            params![account_id, now],
        )
        .map_err(|error| format!("DRIVE_BETA_ACCOUNT_UPSERT_FAILED: {error}"))?;
        tx.execute(
            "INSERT INTO drive_beta_devices(device_id, account_id, display_name, created_at, last_seen_at)
             VALUES(?1, ?2, NULL, ?3, ?3)
             ON CONFLICT(device_id) DO UPDATE SET last_seen_at=excluded.last_seen_at",
            params![device_id, account_id, now],
        )
        .map_err(|error| format!("DRIVE_BETA_DEVICE_UPSERT_FAILED: {error}"))?;
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
        .map_err(|error| map_constraint("DRIVE_BETA_DRIVE_CREATE_FAILED", error))?;
        tx.execute(
            "INSERT INTO drive_meta.drive_beta_folders(
                folder_id, drive_id, parent_id, name, version, object_hash,
                created_at, updated_at, deleted_at
             ) VALUES(?1, ?2, NULL, ?3, 1, ?4, ?5, ?5, NULL)",
            params![root_folder_id, drive_id, name, object_hash, now],
        )
        .map_err(|error| format!("DRIVE_BETA_ROOT_CREATE_FAILED: {error}"))?;
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
            .map_err(|error| format!("DRIVE_BETA_MAPPING_CREATE_FAILED: {error}"))?;
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
            .map_err(|error| format!("DRIVE_BETA_CREATE_COMMIT_FAILED: {error}"))?;
        Ok(DriveRecord {
            drive_id,
            account_id,
            name,
            root_folder_id,
            storage_peer_id: storage_peer_id.map(str::trim).filter(|value| !value.is_empty()).map(str::to_string),
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
            .map_err(|error| format!("DRIVE_BETA_DRIVE_LIST_PREPARE_FAILED: {error}"))?;
        let drives = statement
            .query_map(params![account_id, limit + 1, offset], row_to_drive)
            .map_err(|error| format!("DRIVE_BETA_DRIVE_LIST_FAILED: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("DRIVE_BETA_DRIVE_LIST_ROW_FAILED: {error}"))?;
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
            .map_err(|error| format!("DRIVE_BETA_CREATE_FOLDER_TX_FAILED: {error}"))?;
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
        .map_err(|error| map_constraint("DRIVE_BETA_FOLDER_CREATE_FAILED", error))?;
        insert_event(
            &tx,
            &drive_id,
            &device_id,
            "CREATE_FOLDER",
            "folder",
            &folder_id,
            1,
            &json!({"parentId": parent_id, "name": name}),
            now,
        )?;
        tx.commit()
            .map_err(|error| format!("DRIVE_BETA_FOLDER_COMMIT_FAILED: {error}"))?;
        Ok(FolderRecord {
            folder_id,
            drive_id,
            parent_id: Some(parent_id),
            name,
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
                "SELECT folder_id, drive_id, parent_id, name, version, object_hash,
                        created_at, updated_at, deleted_at
                 FROM drive_meta.drive_beta_folders
                 WHERE drive_id=?1 AND parent_id=?2 AND deleted_at IS NULL
                 ORDER BY name COLLATE NOCASE, folder_id
                 LIMIT ?3 OFFSET ?4",
            )
            .map_err(|error| format!("DRIVE_BETA_FOLDER_LIST_PREPARE_FAILED: {error}"))?;
        let folders = statement
            .query_map(
                params![drive_id, parent_id, (limit + 1) as i64, offset as i64],
                row_to_folder,
            )
            .map_err(|error| format!("DRIVE_BETA_FOLDER_LIST_FAILED: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("DRIVE_BETA_FOLDER_ROW_FAILED: {error}"))?;
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

    pub fn rename_folder(
        &self,
        account_id: &str,
        drive_id: &str,
        folder_id: &str,
        name: &str,
        device_id: Option<&str>,
    ) -> Result<FolderRecord, String> {
        self.update_folder(
            account_id,
            drive_id,
            folder_id,
            Some(name),
            None,
            device_id,
        )
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
            .map_err(|error| format!("DRIVE_BETA_FOLDER_UPDATE_TX_FAILED: {error}"))?;
        let root_id = require_drive(&tx, &account_id, &drive_id)?;
        if folder_id == root_id && new_parent_id.is_some() {
            return Err("DRIVE_BETA_ROOT_MOVE_FORBIDDEN".into());
        }
        let current = require_folder(&tx, &drive_id, &folder_id)?;
        let name = new_name.map(validate_name).transpose()?.unwrap_or(current.name);
        let parent_id = match new_parent_id {
            Some(value) => Some(validate_identifier(value, "PARENT")?),
            None => current.parent_id,
        };
        if let Some(parent) = parent_id.as_deref() {
            require_folder(&tx, &drive_id, parent)?;
            if parent == folder_id || folder_contains(&tx, &drive_id, &folder_id, parent)? {
                return Err("DRIVE_BETA_FOLDER_CYCLE_FORBIDDEN".into());
            }
        }
        let version = current.version + 1;
        let now = now_ms();
        let object_hash = folder_hash(&drive_id, parent_id.as_deref(), &name, version, None);
        tx.execute(
            "UPDATE drive_meta.drive_beta_folders
             SET parent_id=?1, name=?2, version=?3, object_hash=?4, updated_at=?5
             WHERE drive_id=?6 AND folder_id=?7 AND deleted_at IS NULL",
            params![parent_id, name, version, object_hash, now, drive_id, folder_id],
        )
        .map_err(|error| map_constraint("DRIVE_BETA_FOLDER_UPDATE_FAILED", error))?;
        let action = if new_name.is_some() { "RENAME_FOLDER" } else { "MOVE_FOLDER" };
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
            .map_err(|error| format!("DRIVE_BETA_FOLDER_UPDATE_COMMIT_FAILED: {error}"))?;
        Ok(FolderRecord {
            folder_id,
            drive_id,
            parent_id,
            name,
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
            .map_err(|error| format!("DRIVE_BETA_FOLDER_DELETE_TX_FAILED: {error}"))?;
        let root_id = require_drive(&tx, &account_id, &drive_id)?;
        if folder_id == root_id {
            return Err("DRIVE_BETA_ROOT_DELETE_FORBIDDEN".into());
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
            .map_err(|error| format!("DRIVE_BETA_FOLDER_DELETE_FAILED: {error}"))?;
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
        .map_err(|error| format!("DRIVE_BETA_FILE_DELETE_FAILED: {error}"))?;
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
            .map_err(|error| format!("DRIVE_BETA_FOLDER_DELETE_COMMIT_FAILED: {error}"))?;
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
                'messageId', telegram_message_id, 'version', version,
                'deletedAt', deleted_at)
             FROM drive_meta.drive_beta_telegram_mapping WHERE drive_id=?1 ORDER BY mapping_id",
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
            .map_err(|error| format!("DRIVE_BETA_SNAPSHOT_CURSOR_FAILED: {error}"))?;
        let payload = json!({
            "schemaVersion": SCHEMA_VERSION,
            "driveId": drive_id,
            "eventCursor": event_cursor,
            "folders": folders,
            "mappings": mappings,
        });
        let payload_json = serde_json::to_string(&payload)
            .map_err(|error| format!("DRIVE_BETA_SNAPSHOT_SERIALIZE_FAILED: {error}"))?;
        let payload_hash = sha256_hex(payload_json.as_bytes());
        let snapshot_id = uuid_v4();
        let now = now_ms();
        conn.execute(
            "INSERT INTO drive_meta.drive_beta_snapshots(
                snapshot_id, drive_id, device_id, event_cursor, payload_json,
                payload_hash, created_at, remote_message_id, verified_at
             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?7)",
            params![snapshot_id, drive_id, device_id, event_cursor, payload_json, payload_hash, now],
        )
        .map_err(|error| format!("DRIVE_BETA_SNAPSHOT_INSERT_FAILED: {error}"))?;
        Ok(SnapshotRecord {
            snapshot_id,
            drive_id,
            payload_hash,
            created_at: now,
            folder_count: folders.len(),
            mapping_count: mappings.len(),
        })
    }

    pub fn integrity_report(&self) -> Result<IntegrityReport, String> {
        let conn = self.connection()?;
        self.integrity_report_with(&conn)
    }

    fn integrity_report_with(&self, conn: &Connection) -> Result<IntegrityReport, String> {
        let system_integrity: String = conn
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|error| format!("DRIVE_BETA_SYSTEM_INTEGRITY_FAILED: {error}"))?;
        let metadata_integrity: String = conn
            .query_row("PRAGMA drive_meta.integrity_check", [], |row| row.get(0))
            .map_err(|error| format!("DRIVE_BETA_METADATA_INTEGRITY_FAILED: {error}"))?;
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
            .map_err(|error| format!("DRIVE_BETA_ORPHAN_CHECK_FAILED: {error}"))?;
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
            .map_err(|error| format!("DRIVE_BETA_ROOT_CHECK_FAILED: {error}"))?;
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
            .map_err(|error| format!("DRIVE_BETA_MAPPING_CHECK_FAILED: {error}"))?;
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

fn qualify_metadata_schema(schema: &str) -> String {
    schema
        .replace("CREATE TABLE IF NOT EXISTS drive_beta_", "CREATE TABLE IF NOT EXISTS drive_meta.drive_beta_")
        .replace("CREATE UNIQUE INDEX IF NOT EXISTS idx_drive_beta_", "CREATE UNIQUE INDEX IF NOT EXISTS drive_meta.idx_drive_beta_")
        .replace("CREATE INDEX IF NOT EXISTS idx_drive_beta_", "CREATE INDEX IF NOT EXISTS drive_meta.idx_drive_beta_")
        .replace("INSERT INTO drive_beta_schema", "INSERT INTO drive_meta.drive_beta_schema")
        .replace("REFERENCES drive_beta_folders", "REFERENCES drive_beta_folders")
}

fn validate_identifier(value: &str, kind: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 160 || value.chars().any(char::is_control) {
        return Err(format!("DRIVE_BETA_{kind}_ID_INVALID"));
    }
    Ok(value.to_string())
}

fn validate_name(value: &str) -> Result<String, String> {
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.is_empty()
        || value.len() > 255
        || value == "."
        || value == ".."
        || value.chars().any(|character| character.is_control() || character == '/' || character == '\\')
    {
        return Err("DRIVE_BETA_NAME_INVALID".into());
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

fn require_drive(
    conn: &Connection,
    account_id: &str,
    drive_id: &str,
) -> Result<String, String> {
    conn.query_row(
        "SELECT root_folder_id FROM drive_beta_registry
         WHERE account_id=?1 AND drive_id=?2 AND deleted_at IS NULL",
        params![account_id, drive_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|error| format!("DRIVE_BETA_DRIVE_LOOKUP_FAILED: {error}"))?
    .ok_or_else(|| "DRIVE_BETA_DRIVE_NOT_FOUND".into())
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
    .map_err(|error| format!("DRIVE_BETA_FOLDER_LOOKUP_FAILED: {error}"))?
    .ok_or_else(|| "DRIVE_BETA_FOLDER_NOT_FOUND".into())
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
    .map_err(|error| format!("DRIVE_BETA_CYCLE_CHECK_FAILED: {error}"))
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
        .map_err(|error| format!("DRIVE_BETA_EVENT_SERIALIZE_FAILED: {error}"))?;
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
    .map_err(|error| format!("DRIVE_BETA_EVENT_INSERT_FAILED: {error}"))?;
    Ok(())
}

fn query_json_rows(conn: &Connection, sql: &str, drive_id: &str) -> Result<Vec<Value>, String> {
    let mut statement = conn
        .prepare(sql)
        .map_err(|error| format!("DRIVE_BETA_SNAPSHOT_QUERY_PREPARE_FAILED: {error}"))?;
    let rows: Result<Vec<Value>, String> = statement
        .query_map(params![drive_id], |row| row.get::<_, String>(0))
        .map_err(|error| format!("DRIVE_BETA_SNAPSHOT_QUERY_FAILED: {error}"))?
        .map(|row| {
            let raw = row.map_err(|error| format!("DRIVE_BETA_SNAPSHOT_ROW_FAILED: {error}"))?;
            serde_json::from_str(&raw)
                .map_err(|error| format!("DRIVE_BETA_SNAPSHOT_JSON_FAILED: {error}"))
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
        version: row.get(4)?,
        object_hash: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        deleted_at: row.get(8)?,
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
    if matches!(error, rusqlite::Error::SqliteFailure(_, Some(ref message)) if message.contains("UNIQUE constraint failed")) {
        format!("{prefix}: DRIVE_BETA_NAME_CONFLICT")
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
            deleted_at.map(|value| value.to_string()).unwrap_or_default()
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

    fn test_store(label: &str) -> (DriveBetaStore, PathBuf) {
        let root = std::env::temp_dir().join(format!("autogram-drive-beta-{label}-{}", uuid_v4()));
        (DriveBetaStore::open_at(root.clone()).expect("open test store"), root)
    }

    #[test]
    fn recursive_hierarchy_is_local_and_cycle_safe() {
        let (store, root) = test_store("hierarchy");
        let drive = store
            .create_drive("session-a", "Project", Some("-1001"), None, Some("device-a"))
            .expect("create drive");
        let client = store
            .create_folder("session-a", &drive.drive_id, None, "Client A", Some("device-a"))
            .expect("create client");
        let docs = store
            .create_folder(
                "session-a",
                &drive.drive_id,
                Some(&client.folder_id),
                "Dokumentasi",
                Some("device-a"),
            )
            .expect("create docs");
        let photos = store
            .create_folder(
                "session-a",
                &drive.drive_id,
                Some(&docs.folder_id),
                "Foto",
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
        assert_eq!(error, "DRIVE_BETA_FOLDER_CYCLE_FORBIDDEN");
        let children = store
            .list_children("session-a", &drive.drive_id, Some(&docs.folder_id), Some(10), None)
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
            .create_folder("session-b", &drive.drive_id, None, "Keep Metadata", None)
            .expect("create folder");
        let child = store
            .create_folder(
                "session-b",
                &drive.drive_id,
                Some(&folder.folder_id),
                "Child",
                None,
            )
            .expect("create child");
        let snapshot = store
            .create_snapshot("session-b", &drive.drive_id, None)
            .expect("snapshot");
        assert_eq!(snapshot.folder_count, 3);
        assert_eq!(store.soft_delete_folder("session-b", &drive.drive_id, &folder.folder_id, None).expect("delete"), 2);
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
        assert_eq!(error, "DRIVE_BETA_DRIVE_NOT_FOUND");
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
}
