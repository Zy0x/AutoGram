# AutoGram Database Architecture & Data Dictionary Manual

This document is the definitive technical specification and operational manual for AutoGram's persistent local database layer powered by **SQLite 3.x (WAL Journaling Mode)**.

---

## 📑 Table of Contents
1. [Architectural Overview & SQLite Optimization Pragmas](#1-architectural-overview--sqlite-optimization-pragmas)
2. [Subsystem Data Dictionary](#2-subsystem-data-dictionary)
   - [2.1 System & Authentication Subsystem](#21-system--authentication-subsystem)
   - [2.2 Virtual Drive & Cloud Filesystem Subsystem](#22-virtual-drive--cloud-filesystem-subsystem)
   - [2.3 Topic Media Cache & Sparse Video Indexing](#23-topic-media-cache--sparse-video-indexing)
   - [2.4 Transfer Control Plane v4 Subsystem](#24-transfer-control-plane-v4-subsystem)
   - [2.5 Remote URL Transfers & Resumable Journal](#25-remote-url-transfers--resumable-journal)
   - [2.6 4-Level Duplicate Prevention Matrix](#26-4-level-duplicate-prevention-matrix)
   - [2.7 Migration, Forwarder & Automation Subsystem](#27-migration-forwarder--automation-subsystem)
3. [Index Strategy & Query Optimization](#3-index-strategy--query-optimization)
4. [Migration Lifecycle & Upgrade Pipeline](#4-migration-lifecycle--upgrade-pipeline)
5. [Backup, Integrity & Recovery Procedures](#5-backup-integrity--recovery-procedures)

---

## 1. Architectural Overview & SQLite Optimization Pragmas

AutoGram utilizes a high-concurrency, zero-lock local database architecture. Every database connection automatically configures four performance pragmas:

```sql
PRAGMA journal_mode = WAL;         -- Write-Ahead Logging allows simultaneous non-blocking reads and writes
PRAGMA synchronous = NORMAL;       -- Balances maximum write throughput with durability
PRAGMA foreign_keys = ON;          -- Strictly enforces relational integrity across cascading deletes
PRAGMA busy_timeout = 5000;        -- Eliminates SQLite lock collisions during heavy background indexing
```

---

## 2. Subsystem Data Dictionary

### 2.1 System & Authentication Subsystem

#### `telegram_accounts`
Stores metadata for active and registered Telegram sessions.
- `id` (INTEGER PK): Unique account identifier.
- `account_name` (TEXT): Display name or phone number.
- `phone_number` (TEXT UNIQUE): E.164 formatted telephone number.
- `session_file_path` (TEXT): Filepath to the AES-256-GCM encrypted `.grammers.json` session key.
- `is_active` (BOOLEAN): Status indicator (1 = Active, 0 = Inactive).
- `last_used_at` (DATETIME): Timestamp of last successful MTProto connection.

#### `drive_beta_accounts` & `drive_beta_devices`
Tracks multi-device sync authorization states and active client keys.

---

### 2.2 Virtual Drive & Cloud Filesystem Subsystem

#### `drive_beta_registry`
Defines virtual cloud root drives mapped to Telegram chats, channels, or forum topics.
- `drive_id` (TEXT PK): UUID of the cloud drive.
- `account_id` (TEXT FK): Owner Telegram account ID.
- `name` (TEXT NOCASE): User-facing drive title (e.g. `Work Files`, `Media Vault`).
- `root_folder_id` (TEXT UNIQUE): Top-level root directory pointer.
- `storage_type` (TEXT): `telegram`, `telegram_topic`, or `local_cache`.

#### `drive_beta_folders`
Hierarchical directory structure supporting unlimited nesting depth.
- `folder_id` (TEXT PK): UUID of the folder.
- `drive_id` (TEXT FK): Target drive ID.
- `parent_id` (TEXT FK): Parent folder ID (`NULL` for root directory).
- `name` (TEXT NOCASE): Folder name.
- `object_hash` (TEXT): Merkle DAG hash for fast differential synchronization.

#### `drive_beta_files`
Catalog of all uploaded files and documents.
- `file_id` (TEXT PK): UUID of the file entry.
- `drive_id` (TEXT FK): Parent drive ID.
- `folder_id` (TEXT FK): Containing folder ID.
- `filename` (TEXT NOCASE): File name with extension.
- `size` (INTEGER): Exact file size in bytes.
- `mime` (TEXT): MIME type classification.
- `content_hash` (TEXT): SHA-256 binary hash.
- `telegram_unique_id` (TEXT): Telegram cloud document `file_reference` / `unique_id`.

#### `drive_beta_telegram_mapping`
Maps virtual folders and files directly to specific Telegram message IDs (`telegram_chat_id`, `telegram_topic_id`, `telegram_message_id`).

#### `drive_beta_events` & `drive_beta_snapshots`
Event-sourcing journal recording every create, rename, move, and delete operation with atomic outbox synchronization.

---

### 2.3 Topic Media Cache & Sparse Video Indexing

#### `topic_media_items`
High-speed composite cache of Telegram channel messages and forum topic media.
- `(account_id, peer_id, topic_id, message_id)` (COMPOSITE PRIMARY KEY): Guarantees strict multi-tenant isolation and prevents media bleeding between topics.
- `grouped_id` (INTEGER): Associates album items (up to 9 items per 3x3 album).
- `document_id`, `access_hash`, `dc_id`, `file_reference`: MTProto direct stream coordinates.
- `width`, `height`, `duration`, `thumb_type`: Media dimensions and playback metadata.

#### `keyframe_index` & `moov_sidecar`
Enables instant progressive seeking for large MP4/MKV video streams by caching GOP keyframe byte offsets and 64-bit MOOV atom headers.

---

### 2.4 Transfer Control Plane v4 Subsystem

#### `transfer_runs` & `transfer_items_v4`
Oversees large batch uploads and background transfer execution:
- `transfer_id` (TEXT PK): Unique batch job identifier.
- `item_index` (INTEGER): Sequential order within the batch.
- `state` (TEXT): `queued`, `preparing`, `uploading`, `committing`, `completed`, `failed`, `cancelled`.
- `phase` (TEXT): Active granular phase (`hashing`, `reencoding`, `upload_bytes`, `send_message`).
- `bytes_uploaded` (INTEGER): Byte-exact progress counter.

---

### 2.5 Remote URL Transfers & Resumable Journal

#### `remote_transfer_jobs`
Manages remote video/media downloads from YouTube, TikTok, Instagram, Twitter/X, and direct HTTP streams:
- `job_id` (TEXT PK): Unique download job UUID.
- `source_url` (TEXT): Target web URL.
- `mode` (TEXT): Transfer strategy (`auto`, `direct_stream`, `spool_upload`).
- `downloaded_bytes` / `uploaded_bytes`: Real-time dual-progress tracking.
- `destination_type` / `destination_id` / `destination_topic_id`: Target Telegram destination.

---

### 2.6 4-Level Duplicate Prevention Matrix

#### `duplicate_history` & `destination_scan_cache`
Protects Telegram cloud storage from duplicate uploads across 4 verification tiers:
1. **Tier 1 (Message ID)**: Matches identical messages already recorded in SQLite.
2. **Tier 2 (Unique File ID)**: Matches Telegram's `file_unique_id`.
3. **Tier 3 (Binary SHA-256)**: Matches cryptographic content hashes.
4. **Tier 4 (Filename + Size)**: Fallback match for identical filename and exact byte length.

#### `transfer_audit_log`
Immutable journal recording every duplicate decision (`transferred`, `skipped_duplicate`, `failed`, `cancelled`) with the matching message pointer for transparent auditability.

---

### 2.7 Migration, Forwarder & Automation Subsystem

#### `jobs`, `executions`, `tasks`
Orchestrates channel-to-channel migration, message forwarding, and automated scheduled transfers with checkpoint recovery.

#### `message_mapping`
Preserves bidirectional mapping between source and destination messages (`source_chat_id` + `source_msg_id` $\leftrightarrow$ `dest_chat_id` + `dest_msg_id`) to support synchronized edits and deletions.

#### Media Forwarder V2 canonical extensions
- `forwarder_job_configs`: canonical `JobConfigV2` snapshot, schema version, and optimistic revision for every forwarder job.
- `job_revisions`: immutable local revision history used by conflict detection and explicit merge/replace operations.
- `mirror_cursors`: Telegram `pts` and event cursor required for resumable realtime mirror reconciliation.
- `decision_inbox`: durable `WAITING_USER` decisions for duplicates, restrictions, and stale revisions.
- `notification_outbox`: idempotent OS/cloud/webhook delivery queue with retry state.
- `retention_markers`: local retention deadlines and encrypted-export references before purge.

The V2 payload is snake_case and versioned (`schema_version = 2`). Legacy job JSON remains readable through an adapter during the deprecation window.

---

## 3. Index Strategy & Query Optimization

All high-frequency lookup paths are backed by specialized indexes:
- **Pagination & Slicing**: `idx_drive_beta_file_page` on `(drive_id, folder_id, filename, file_id) WHERE deleted_at IS NULL` guarantees $O(\log N)$ file directory listings.
- **Topic Media Streaming**: `idx_tmi_peer_topic_date` on `(account_id, peer_id, topic_id, message_date DESC, message_id DESC)` enables instant viewport rendering for 50,000+ items.
- **Fast Deduplication**: `idx_dup_hist_sha256` and `idx_dsc_name_size` provide sub-millisecond duplicate checks before initiating uploads.

---

## 4. Migration Lifecycle & Upgrade Pipeline

The active desktop runtime applies the additive Forwarder bridge migrations `020_` and `021_` and then performs guarded column backfills using `PRAGMA table_info`. Supabase API hardening is tracked separately as migration `022_`. Legacy migrations remain available for fresh database provisioning and historical compatibility; they are not replayed destructively against an existing installation.

1. `020_media_forwarder_v2.sql` adds the V2 config, dedupe, revision, mirror, decision, notification, and retention tables.
2. `021_forwarder_runtime_bridge.sql` adds task/mapping/schedule/event-sequence objects and indexes.
3. Existing legacy columns are added only after an existence check, making application upgrades replay-safe.
4. Before backup or recovery, run `PRAGMA integrity_check;` and retain the original WAL files until the backup is verified.

---

## 5. Backup, Integrity & Recovery Procedures

- **Online WAL Checkpoint**: `PRAGMA wal_checkpoint(TRUNCATE);` flushes pending write buffers to disk before taking backups.
- **Integrity Check**: Run `PRAGMA integrity_check;` to verify B-Tree and index consistency.
- **1-Click SQL Export**: Use **Settings > Data & Storage > Database Backup** to export your full database schema and data as a standalone SQL dump.
