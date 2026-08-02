# AutoGram — Master Architecture, WorkTree & Operational Workflow Specification

> **Dokumen Spesifikasi Teknis Master, Peta WorkTree Utuh, Diagram Sequence Mermaid, Manual Operational Workflow Real-World & Standar Tata Kelola Agent AutoGram App**  
> *Versi Rujukan Terintegrasi: **v2.7.2** (Absolute Definitive Production Master — Ground-Truth 100% Accurate, 2026-08-02)*  
> *Platform: Desktop Offline (Tauri v2 + React 19 + TypeScript + Rust Grammers Engine + SQLite + IndexedDB)*

---

## 1. Pendahuluan & Filosofi Arsitektur Utama (Core Technical Philosophy)

AutoGram adalah platform manajemen, migrasi, dan eksplorasi media Telegram berbasis **desktop offline** yang menggunakan paradigma **Telegram-as-a-Drive**. Sistem ini dirancang untuk menangani pustaka media berskala besar (10.000–1.000.000+ berkas per kanal/grup) dengan kecepatan eksekusi tinggi, penggunaan memori minimal, antarmuka responsif (*mobile-first & touch-first*), serta keandalan tingkat tinggi tanpa hambatan *FloodWait*.

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                       LAPISAN FRONTEND (React 19 + TypeScript)                  ║
║                                                                                  ║
║  Pages: MediaStudio · Dashboard · Jobs · Accounts · Profiles · Settings         ║
║         Statistics · Automation · Sync                                           ║
║                                                                                  ║
║  Components: DriveExplorer · DriveFileCard · DrivePreviewModal                  ║
║              DriveToolsPanel · DriveZipBrowser · DriveTransfers                 ║
║              MediaHeaderToolbar · MediaVideoPlayer · MediaAudioPlayer            ║
║              DocumentViewer · ImageViewer · DriveSkeleton                       ║
║                                                                                  ║
║  Lib: thumbBatcher · thumbPersistentCache · previewCache                        ║
║       driveFilesApi · driveFoldersApi · driveTransfersApi                       ║
║       driveStreamApi · driveStreamZipApi · driveSession · telegramBackend       ║
║       mediaScanStateMachine · driveLiveSync · driveDrag · driveSelection        ║
║       driveLocationCache · driveRecents · driveScrollMemory                     ║
╠══════════════════════════════════════════════════════════════════════════════════╣
║                  TAURI IPC BRIDGE (lib.rs — invoke_handler)                     ║
║   85+ Tauri Commands: tg_list_media · tg_thumbs_batch · tg_preview_stream      ║
║   tg_seek_stream · tg_stop_stream · tg_upload_file · tg_download_file          ║
║   tg_zip_list_sparse · tg_zip_preview_entry_sparse · jobs_run_migration         ║
║   studio_enqueue · studio_run_orchestrated · network_apply_proxy                ║
╠══════════════════════════════════════════════════════════════════════════════════╣
║                      RUST CORE ENGINE (src-tauri/src)                           ║
║                                                                                  ║
║  core/grammers/                   core/grammers_ops/                            ║
║  ├─ stream.rs (90KB)              ├─ session_auth.rs (43KB)                     ║
║  ├─ thumbs.rs (92KB)              ├─ media_list.rs (31KB)                       ║
║  ├─ ffmpeg.rs (43KB)              ├─ client_pool.rs (16KB)                      ║
║  ├─ special_media_thumb.rs (10KB) ├─ media_transfer.rs (16KB)                  ║
║  ├─ thumbnail_range_bridge.rs     └─ peer_resolver.rs (13KB)                   ║
║  └─ topics.rs                                                                    ║
║                                                                                  ║
║  core/ (41 files)                 features/topic_media/                         ║
║  ├─ stream_server.rs (40KB)       ├─ commands.rs                                ║
║  ├─ telegram_ops.rs (34KB)        ├─ service.rs                                 ║
║  ├─ drive_rpc.rs (37KB)           ├─ scheduler/ (5 files)                      ║
║  ├─ app_db.rs (31KB)              └─ thumbnail/ (9 files)                       ║
║  ├─ jobs_db.rs (23KB)                                                            ║
║  ├─ migration_run.rs (21KB)       secrets.rs · open_file.rs                    ║
║  ├─ studio_orch.rs (21KB)         session_clone.rs · session_rate.rs           ║
║  └─ ... (33 more modules)                                                        ║
╠══════════════════════════════════════════════════════════════════════════════════╣
║              STREAM HTTP SERVER (tiny_http · port ephemeral)                     ║
║              127.0.0.1:{port}/stream/{sid}  →  HTTP 206 Partial Content         ║
╠══════════════════════════════════════════════════════════════════════════════════╣
║                   TELEGRAM MTPROTO API (Grammers — DC1–DC5)                     ║
╚══════════════════════════════════════════════════════════════════════════════════╝
```

### 5 Pilar Utama Arsitektur v2.7.2:

1. **Grammers-Only Rust MTProto Backend**: Seluruh interaksi Telegram API (Otentikasi, List Media, Topic Search, Instant Stripped Mini-Thumb Extraction, Thumbnail Batch, Upload/Download Stream, Sparse Zip Stream) dieksekusi 100% secara native di Rust menggunakan **Grammers**. Tidak ada runtime Python/Telethon yang aktif.
2. **Local-First SWR & Instant 0ms Mini-Thumb Paint**: Render antarmuka visual terjadi secara instan (<10ms) menggunakan data hangat dari IndexedDB (`mediaStudioDb.ts`) atau mini-thumb Telegram MTProto `PhotoSize::Stripped` (`tl_stripped_thumb_data_url`), disusul oleh pembaruan HD background batch tanpa jeda.
3. **Unpaused High-Throughput Request Correlation Pipeline**: Pemproses antrean thumbnail `thumbBatcher.ts` mengeksekusi 4 penerbangan RPC paralel dengan kapasitas batch hingga 48 item per request menggunakan `requestId` unik (`thumb:peerId:msgId:gGen`). Data dicocokkan secara non-posisional via `ThumbnailBatchItemResult` tanpa risiko pergeseran indeks.
4. **Dual-Track Resource-Guarded Scheduler & Seekable HTTP Range Bridge**: Pemuatan thumbnail dipisah menjadi dua jalur independen: `fast_sem` (12 permit paralel) untuk foto/gambar statis dan `video_sem` (4 permit paralel) untuk video dokumen FFmpeg. Progressive streaming melayani request HTTP `206 Partial Content` dengan **512 KB Boundary Alignment**, **Bounded 16 MB Cap**, serta **3-Layer Seek Fix** (15s per-chunk timeout, 500ms interruptible batch loop, 2s seek re-registration).
5. **Fail-Closed Generation Protection (`peerGen.current`)**: Setiap perubahan lokasi/topik menaikkan atomic generation counter (`peerGen.current`), yang secara otomatis menggugurkan (*abort*) callback dan request yang terlambat, menjamin 0% kebocoran data (*media bleed*). Kegagalan thumbnail dokumen non-media secara otomatis menyimpan penanda negatif `.nothumb` di disk cache dan `"NOT_FOUND"` di memori.

---

## 2. Struktur File & Direktori Lengkap (Ground-Truth WorkTree)

### A. Root Repository (`F:\AutoGram\`)

```
F:\AutoGram└─ AutoGram App/                   ← ROOT UTAMA APLIKASI
   ├─ .env                         ← API_ID, API_HASH (runtime only, tidak dikompilasi)
   ├─ .env.example
   ├─ .gitignore
   ├─ CHANGELOG.md                 ← Catatan rilis versi (232KB)
   ├─ VERSION.md                   ← Riwayat versi lengkap (50KB)
   ├─ README.md
   ├─ database/                    ← Skema SQL migrations
   ├─ docs/                        ← Dokumentasi teknis & arsitektur
   │  ├─ architecture/             ← Dokumen ini (AUTOGRAM_MASTER_ARCHITECTURE_WORKFLOW.md)
   │  ├─ development/
   │  ├─ governance/
   │  ├─ operation/
   │  ├─ product/
   │  ├─ release/
   │  ├─ security/
   │  └─ testing/
   ├─ frontend/                    ← Aplikasi Tauri + React
   └─ worker/                      ← Data runtime & cache (TIDAK di-git)
      ├─ autogram.db               ← SQLite utama (WAL mode)
      ├─ .shared_rate_state.json   ← Rate state antar sesi
      ├─ sessions/                 ← File .session Telegram (encrypted)
      ├─ cache/
      │  ├─ preview/               ← .partial files streaming aktif
      │  │  └─ stream_registry/    ← {sid}.json registry stream
      │  └─ thumbs/                ← Cache thumbnail disk
      ├─ checkpoints/              ← Resume state migrasi ({jobId}.json)
      ├─ logs/                     ← Log runtime
      ├─ profiles/                 ← Profil pengaturan job
      └─ temp/                     ← Temp files (auto-clean)
```

### B. Rust Backend (`AutoGram App/frontend/src-tauri/src/`)

```
src/
├─ main.rs                         ← Entry point binary
├─ lib.rs                          ← 1645 baris: 85+ Tauri commands + run() setup
├─ secrets.rs                      ← OS keyring + AES-256-GCM (21KB)
├─ open_file.rs                    ← Buka file native + reveal explorer (10KB)
├─ session_clone.rs                ← Ghost session management (2KB)
├─ core/
│  ├─ mod.rs
│  ├─ grammers/                    ← MTProto Engine utama
│  │  ├─ mod.rs
│  │  ├─ stream.rs                 ← Progressive stream, fill-loop, seek, ZIP (90KB)
│  │  ├─ thumbs.rs                 ← Thumbnail batch engine Tier 1-5 (92KB)
│  │  ├─ ffmpeg.rs                 ← FFmpeg spawn, unstrip_jpeg, black card detect (43KB)
│  │  ├─ special_media_thumb.rs    ← Background video thumb queue mpsc::channel(24) (10KB)
│  │  ├─ thumbnail_range_bridge.rs ← Local HTTP bridge untuk FFmpeg (13KB)
│  │  ├─ session.rs                ← cache_root, preview_dir, thumb_dir paths
│  │  └─ topics.rs                 ← Listing topik forum Grammers (6KB)
│  ├─ grammers_ops/                ← Grammers client pool & auth
│  │  ├─ mod.rs
│  │  ├─ session_auth.rs           ← QR + phone login, session import (43KB)
│  │  ├─ media_list.rs             ← Media listing, folder scan, pagination (31KB)
│  │  ├─ client_pool.rs            ← Multi-session pool (4 klien/stream) (16KB)
│  │  ├─ media_transfer.rs         ← Upload/download Grammers (16KB)
│  │  └─ peer_resolver.rs          ← Resolve peer_id → InputPeer (13KB)
│  ├─ stream_server.rs             ← tiny_http HTTP Range server (40KB)
│  ├─ telegram_ops.rs              ← Dispatcher semua tg_* commands (34KB)
│  ├─ drive_rpc.rs                 ← RPC types: folder/file/media ops (37KB)
│  ├─ app_db.rs                    ← SQLite repo: media items, cache (31KB)
│  ├─ jobs_db.rs                   ← Job CRUD SQLite (23KB)
│  ├─ migration_run.rs             ← Eksekutor migrasi Telegram (21KB)
│  ├─ studio_orch.rs               ← Upload studio orchestrator (21KB)
│  ├─ grammers_sparse_zip.rs       ← Sparse ZIP remote stream (33KB)
│  ├─ zip_local.rs                 ← ZIP lokal extraction (19KB)
│  ├─ dup_checker.rs               ← 4-level duplicate detection (18KB)
│  ├─ telethon_session_import.rs   ← Import .session Python legacy (14KB)
│  ├─ session_rate.rs              ← Rate limiter & stream slot (14KB)
│  ├─ network.rs                   ← Proxy/VPN config (10KB)
│  ├─ doc_preview.rs               ← Document preview routing (13KB)
│  ├─ session_guard.rs             ← Session exclusive lease (8KB)
│  ├─ smart_scanner.rs             ← Smart folder scan (8KB)
│  ├─ mp4_keyframe.rs              ← MP4 keyframe detection (7KB)
│  ├─ capability.rs                ← Backend capability detection (6KB)
│  ├─ streaming_policy.rs          ← Streaming config per file size (6KB)
│  ├─ tg_error.rs                  ← Error mapping TgErrorCode (9KB)
│  ├─ tg_log.rs                    ← Structured logging (6KB)
│  ├─ transfer_state.rs            ← Transfer state tracking (6KB)
│  ├─ fingerprint.rs               ← SHA256 + quick fingerprint (8KB)
│  ├─ moov_sidecar.rs              ← MP4 moov sidecar injection (4KB)
│  ├─ job_queue.rs                 ← Studio job queue persistent (8KB)
│  ├─ path_policy.rs               ← Path allowlist security (3KB)
│  ├─ smart_throttle.rs            ← Adaptive throttle (5KB)
│  ├─ media_meta.rs                ← Media metadata (4KB)
│  ├─ media_prep.rs                ← Media preparation (9KB)
│  ├─ media_bench.rs               ← Bandwidth benchmark (4KB)
│  ├─ hash_util.rs                 ← Hash utilities (3KB)
│  ├─ automations_db.rs            ← Automation rules DB (5KB)
│  ├─ profiles_db.rs               ← Profile settings DB (4KB)
│  ├─ stats_db.rs                  ← Statistics DB (5KB)
│  ├─ transfer_journal.rs          ← Transfer audit log (4KB)
│  ├─ download_registry.rs         ← Download registry (4KB)
│  ├─ preview_transcoder.rs        ← Preview transcoder (3KB)
│  ├─ config_normalize.rs          ← Config normalization (2KB)
│  ├─ progress_rate.rs             ← Progress rate calc (1KB)
│  └─ events.rs                    ← Tauri event emitter (1KB)
└─ features/
   ├─ mod.rs
   └─ topic_media/                 ← Feature module (eksperimental)
      ├─ commands.rs               ← tg_open_topic_media, tg_thumbs_batch_v2
      ├─ service.rs
      ├─ scheduler/                ← FloodWait gate, queue, worker pool, metrics
      └─ thumbnail/                ← Format registry, extractors, resolver
```

### C. React Frontend (`AutoGram App/frontend/src/`)

```
src/
├─ App.tsx                         ← Router utama React Router v6
├─ App.css                         ← Global styles (339KB)
├─ index.css                       ← CSS variables & design tokens (36KB)
├─ main.tsx                        ← React entry + i18n init
├─ i18n.ts                         ← react-i18next configuration
├─ locales/
│  ├─ index.ts                     ← Namespace loader
│  ├─ id/                          ← Bahasa Indonesia (9 namespace JSON)
│  │  ├─ accounts.json, automation.json, dashboard.json
│  │  ├─ jobs.json, nav.json, settings.json
│  │  ├─ speedtest.json (44KB), statistics.json, sync.json
│  └─ en/                          ← English (100% key parity)
├─ components/
│  ├─ common/                      ← Shared UI components
│  ├─ layout/                      ← Sidebar, navbar
│  ├─ Jobs/                        ← Job-specific UI
│  └─ drive/
│     ├─ Explorer/
│     │  ├─ DriveExplorer.tsx      ← Virtualizer @tanstack/react-virtual (52KB)
│     │  ├─ DriveFileCard.tsx      ← Kartu media dengan thumbnail (20KB)
│     │  ├─ DriveFileListItem.tsx  ← List view item (4KB)
│     │  ├─ DriveSkeleton.tsx      ← Loading skeleton (7KB)
│     │  ├─ ThumbnailImage.tsx     ← Thumbnail image wrapper (2KB)
│     │  ├─ FileTypeIcon.tsx       ← SVG ikon tipe file (2KB)
│     │  └─ VideoCanvasThumbnailCapturer.tsx ← Canvas fallback decoder
│     ├─ DrivePreviewModal/
│     │  ├─ index.tsx              ← Modal preview utama (167KB)
│     │  ├─ MediaVideoPlayer.tsx   ← HTML5 video + seek handler (10KB)
│     │  ├─ MediaAudioPlayer.tsx   ← Audio player (1KB)
│     │  ├─ ImageViewer.tsx        ← Zoomable image viewer (4KB)
│     │  ├─ DocumentViewer.tsx     ← PDF/doc viewer (3KB)
│     │  ├─ MediaHeaderToolbar.tsx ← Download/info toolbar (5KB)
│     │  └─ previewUtils.ts        ← URL & MIME utilities (5KB)
│     ├─ DriveToolsPanel/
│     │  ├─ index.tsx              ← Tools panel (55KB)
│     │  ├─ DuplicatesTab.tsx      ← Duplicate detection UI (6KB)
│     │  └─ SpaceUsageTab.tsx      ← Space analyzer (5KB)
│     ├─ DriveZipBrowser/          ← Remote ZIP browser UI
│     ├─ Modals/                   ← Dialog modals
│     ├─ Navigation/               ← Drive navigation
│     └─ Transfers/                ← Transfer progress UI
├─ pages/
│  ├─ MediaStudio/
│  │  ├─ index.tsx                 ← Halaman drive utama (294KB — terbesar)
│  │  ├─ MediaStudioGrid.tsx       ← Grid layout (11KB)
│  │  ├─ MediaStudioHeader.tsx     ← Search & header (3KB)
│  │  ├─ MediaStudioSidebar.tsx    ← Topic/folder sidebar (8KB)
│  │  ├─ MediaStudioToolbar.tsx    ← Action toolbar (5KB)
│  │  ├─ MediaStudioFilterTabs.tsx ← Type filter (1KB)
│  │  ├─ MediaStudioModals.tsx     ← Modal orchestrator (10KB)
│  │  ├─ MediaStudioModalsContainer.tsx (14KB)
│  │  ├─ MediaStudioBatchActionBar.tsx ← Multi-select (2KB)
│  │  ├─ MediaStudioOverlays.tsx   ← Overlay UI (2KB)
│  │  ├─ useMediaStudioKeybindings.ts ← Keyboard shortcuts
│  │  └─ mediaStudioUtils.ts
│  ├─ Dashboard/                   ← Overview & statistik
│  ├─ Jobs/index.tsx               ← Job manager (22KB)
│  ├─ Accounts/                    ← Session management UI
│  ├─ Profiles/                    ← Template profil job
│  ├─ Settings/                    ← Network, proxy, VPN
│  ├─ Statistics/                  ← Charts & export CSV
│  ├─ Automation/index.tsx         ← Automation rules (12KB)
│  └─ Sync/                        ← Sync status
└─ lib/
   ├─ db/
   │  ├─ mediaStudioDb.ts          ← IndexedDB ORM (15KB)
   │  ├─ jobsApi.ts                ← Job CRUD API (6KB)
   │  ├─ jobProcess.ts             ← Job execution (8KB)
   │  ├─ jobStatus.ts              ← Job FSM (4KB)
   │  └─ autoCachePruner.ts        ← Auto cache cleanup (3KB)
   ├─ media/
   │  ├─ thumbBatcher.ts           ← Thumbnail pipeline (41KB) ← KRITIS
   │  ├─ thumbPersistentCache.ts   ← Disk + IndexedDB cache (8KB)
   │  ├─ previewCache.ts           ← Preview blob cache (12KB)
   │  ├─ avatarBatcher.ts          ← Avatar batch (6KB)
   │  └─ transferProgress.ts       ← Transfer progress (32KB)
   ├─ tauri/                       ← Tauri wrappers
   ├─ files/                       ← File operation utils
   ├─ utils/                       ← General utilities
   └─ telegram/
      ├─ driveTypes.ts             ← Master TypeScript types (40KB) ← KRITIS
      ├─ mediaScanStateMachine.ts  ← Scan FSM (8KB)
      ├─ core/
      │  ├─ driveSession.ts        ← Session management (35KB)
      │  ├─ telegramBackend.ts     ← Tauri IPC abstraction (24KB)
      │  ├─ studioOrch.ts          ← Studio orchestration (6KB)
      │  ├─ sessionGuard.ts        ← Session guard client-side (2KB)
      │  └─ sessionPicker.ts       ← Multi-session picker (5KB)
      ├─ driveApi/
      │  ├─ driveFilesApi.ts       ← File listing & ops (14KB)
      │  ├─ driveFoldersApi.ts     ← Folder API (15KB)
      │  ├─ driveTransfersApi.ts   ← Transfer ops (15KB)
      │  ├─ driveStreamApi.ts      ← Stream registration (1KB)
      │  ├─ driveStreamZipApi.ts   ← ZIP remote stream (14KB)
      │  └─ driveApiUtils.ts       ← API utilities (13KB)
      ├─ cache/
      │  ├─ driveLocationCache.ts  ← Location cache (5KB)
      │  ├─ driveRecents.ts        ← Recent folders (8KB)
      │  ├─ driveScrollMemory.ts   ← Scroll position (2KB)
      │  ├─ driveSidebarCache.ts   ← Sidebar state (3KB)
      │  └─ driveTopicsCache.ts    ← Topic cache (2KB)
      └─ interaction/
         ├─ driveDrag.ts           ← OS drag-drop integration (21KB)
         ├─ driveSelection.ts      ← Multi-select (9KB)
         ├─ drivePower.ts          ← Power actions (12KB)
         ├─ driveLiveSync.ts       ← Live sync (3KB)
         ├─ chatSearch.ts          ← Chat search (8KB)
         └─ pointerDragPrime.ts    ← 8px drag threshold (6KB)
```

---

## 3. Stack Teknologi & Dependencies

### Rust Dependencies (`Cargo.toml`)

| Dependency | Versi | Peran |
|:-----------|:------|:------|
| `tauri` | 2 | Desktop shell, WebView, IPC bridge |
| `grammers-client` | 0.10 | MTProto client (auth, download, upload) |
| `grammers-session` | 0.10 | Session serde (no sqlite — hindari LNK2005) |
| `grammers-mtsender` | 0.10 | MTProto sender primitives |
| `tokio` | 1 | Async runtime (rt-multi-thread, time, sync, fs) |
| `rusqlite` | 0.32 | SQLite bundled + WAL backup |
| `tiny_http` | 0.12 | HTTP Range server streaming |
| `parking_lot` | 0.12 | RwLock/Mutex performa tinggi |
| `aes-gcm` | 0.10 | AES-256-GCM enkripsi session |
| `keyring` | 3 | OS keychain credential storage |
| `sha2` | 0.10 | SHA-256 (fingerprint, dup check) |
| `zip` | 2 | ZIP extraction (deflate+bzip2+zstd) |
| `flate2` | 1.0 | GZIP/DEFLATE |
| `serde` + `serde_json` | 1 | JSON serialization |
| `chrono` | 0.4 | Timestamp (clock+std) |
| `ureq` | 2 | HTTP client (proxy test, network) |
| `base64` | 0.22 | Base64 encode/decode |
| `tauri-plugin-fs`/`dialog`/`shell`/`opener` | 2 | Tauri plugins |

### Frontend Dependencies (`package.json` — utama)

| Package | Peran |
|:--------|:------|
| `react` 19 | UI framework |
| `@tauri-apps/api` v2 | Tauri IPC invoke |
| `react-router-dom` | Client-side routing |
| `react-i18next` | Internasionalisasi |
| `@tanstack/react-virtual` | Virtualizer 100k+ item |
| `@tanstack/react-query` | Server state & SWR |
| `TypeScript` | Static typing |
| `Vite` | Build tool |

---

## 4. Registrasi Command Tauri (85+ Commands — `lib.rs`)

### Grup: Authentication & Session
`tg_auth_status` · `tg_login` · `start_rust_qr_login` · `cancel_rust_qr_login` · `delete_session_rust`  
`tg_probe_session` · `tg_list_sessions` · `tg_disconnect_session` · `tg_purge_inactive_sessions`  
`tg_import_telethon_session` · `session_guard_acquire` · `session_guard_release` · `session_guard_snapshot`  
`acquire_worker_session_lease` · `get_worker_session_lease` · `release_worker_session_lease`  

### Grup: Media Listing & Folder
`tg_list_dialogs` · `tg_list_dialog_filters` · `tg_list_media` · `tg_list_topics`  
`tg_start_folder_stream` · `tg_cancel_folder_stream` · `tg_scan_folders`  
`tg_create_folder` · `tg_rename_folder` · `tg_set_folder_parent` · `tg_delete_folder`  
`tg_create_topic` · `tg_rename_topic` · `tg_delete_topic`  
`tg_move_messages` · `tg_delete_messages` · `tg_debug_get_message`  

### Grup: Thumbnail & Avatar
`tg_thumbs_batch` · `tg_thumbs_batch_v2` · `tg_avatars_batch`  
`tg_open_topic_media` · `tg_load_more_topic_media`  

### Grup: Streaming & Preview
`tg_preview_stream` · `tg_stop_stream` · `tg_seek_stream`  
`stream_server_port` · `stream_status_local` · `stream_register_local` · `stream_unregister`  
`streaming_config_for_size` · `preview_local_document`  
`backend_capabilities` · `path_policy_check` · `inspect_mp4_layout_cmd`  

### Grup: ZIP Remote Stream
`zip_list_local` · `zip_preview_entry` · `zip_extract_entry`  
`tg_zip_list_sparse` · `tg_zip_preview_entry_sparse` · `tg_zip_extract_entry_sparse`  

### Grup: Transfer & Upload
`tg_upload_file` · `tg_download_file`  
`studio_enqueue` · `studio_list_transfers` · `studio_get_transfer` · `studio_run_orchestrated`  

### Grup: Jobs & Migration
`jobs_list` · `jobs_create` · `jobs_edit` · `jobs_delete`  
`jobs_start_execution` · `jobs_run_migration` · `jobs_fresh_start` · `jobs_cancel_migration`  
`jobs_export_json` · `jobs_import_json`  

### Grup: Cache & Files
`cache_calculate_size` · `cache_clear_disk` · `cache_trim_disk` · `cleanup_partial_downloads`  
`file_sha256` · `file_quick_fingerprint` · `compute_progress_rate`  
`open_file::open_path_safe` · `open_file::open_with_dialog` · `open_file::reveal_path_safe`  
`open_file::cache_file_ready` · `open_file::copy_cache_file`  

### Grup: Profiles, Automation, Stats
`profiles_list` · `profiles_save` · `profiles_delete`  
`automations_list` · `automations_save` · `automations_delete`  
`stats_get` · `stats_export_csv`  

### Grup: Network & Security
`network_get_config` · `network_apply_proxy` · `network_apply_vpn` · `network_apply_all`  
`network_test_proxy` · `network_is_available` · `network_detect_vpn` · `normalize_job_config`  
`secrets::get_credential` · `secrets::set_credential` · `secrets::delete_credential`  
`secrets::migrate_credentials_from_webstorage` · `secrets::ensure_secure_dirs`  
`secrets::write_worker_temp_file` · `secrets::delete_worker_temp_file`  
`secrets::seed_api_credentials_from_env`  
`session_clone::ensure_ghost_session` · `session_clone::cleanup_ghost_session`  

---

## 5. Sistem Streaming Video — Pipeline Lengkap v2.7.2

### 5.1 Flow Registrasi & Boot

```
MediaVideoPlayer.tsx
  → invoke('tg_preview_stream', { msgId, chatId, accessHash, ... })
  → lib.rs → telegram_ops.rs → stream.rs::start_progressive_stream()
     ├─ Buat StreamEntry { stream_id, path: "preview/{sid}.partial", total_size, mime }
     ├─ register_cancel(sid) → AtomicBool di cancel_flags HashMap
     ├─ obtain_download_clients() → 4 Grammers clients dari client_pool
     ├─ spawn Tokio fill-loop task (background)
     └─ Return { stream_url: "http://127.0.0.1:{port}/stream/{sid}", stream_id }

  → MediaVideoPlayer set <video src="http://..."> → browser mulai request
```

### 5.2 Fill-Loop Internals (`stream.rs`)

```
fill-loop (Tokio async task):
  OUTER LOOP:
    1. Cek cancel_flag.load(Ordering::SeqCst) → exit jika true
    2. take_seek_request(sid) → update cursor ke posisi 512KB-aligned
    3. find_missing_offset_from(ranges, cursor, total) → next_missing
    4. Buat 4 pending_offsets (chunk berturutan dari cursor)
    5. let (tx, mut rx) = mpsc::channel(4)
    6. Spawn 4 Tokio workers:
       each worker:
         iter = client.iter_download(&media).chunk_size(512KB).skip_chunks(n)
         ── SEEK FIX #1: timeout(15s, iter.next()) ──
         → Elapsed → Ok(None) [retry next iter]
         → Ok(inner) → send ke tx_clone
    7. drop(tx) — workers hold tx_clone
    8. 'batch: loop:    ← SEEK FIX #2: interruptible
         if seek_requests.contains_key(&sid) { break 'batch }
         match timeout(500ms, rx.recv()):
           Ok(Some((off, Ok(Some(bytes))))) → write disk, push ranges
           Ok(Some((off, Err(e))))          → handle FloodWait / log
           Ok(None)                         → break 'batch [semua selesai]
           Err(timeout)                     → loop [re-check seek]
    9. upsert_entry() → merge_ranges(), preserve tail-fetch ranges
    10. moov tail-fetch check (MP4 > 20MB, !moov_ready_cached):
        → spawn independent task: fetch last ~1MB → write → upsert
    11. Pause check: sleep(100ms) jika entry.paused
```

### 5.3 HTTP Range Server (`stream_server.rs`)

```
handle_stream(request, sid):
  1. get_entry(sid) → StreamEntry [dari LIVE HashMap atau disk JSON]
  2. Parse Range header → req_start, req_end
  3. Jika !entry.done && bytes belum ada di req_start:
     → request_progressive_range(sid, req_start)  ← SEEK FIX #3 awal
     → Unset paused jika perlu
     → WAIT LOOP 45s (poll 25ms):
         ← SEEK FIX #3: re-send seek setiap 2000ms
         ← refresh entry via get_entry()
         ← cek contiguous_end_from > req_start → break
  4. bounded_response_end(start, req_end, total) → cap 16MB per response
  5. Buat DemandRangeReader { file, stream_id, position=start, end_exclusive }
  6. Respond HTTP 206 Partial Content → stream ke browser via Read
```

### 5.4 DemandRangeReader

```rust
impl Read for DemandRangeReader {
  fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
    let mut seek_signaled = false;
    loop {
      let entry = get_entry(&self.stream_id);
      let avail = contiguous_end_from(&entry.ranges, self.position);
      if avail > self.position {
        // Ada bytes: baca dari file .partial
        self.file.seek(SeekFrom::Start(self.position));
        let n = self.file.read(&mut output[..count]);
        self.position += n;
        return Ok(n);
      }
      if !self.wait_for_growth || entry.done || waited > 30_000 { return Ok(0); }
      // Signal fill-loop SEKALI (jangan overwrite seek user)
      if !seek_signaled {
        request_progressive_range(&self.stream_id, self.position);
        seek_signaled = true;
      }
      thread::sleep(30ms);
      waited += 30;
    }
  }
}
```

### 5.5 Konstanta Kritis Streaming

| Konstanta | Nilai | Lokasi | Fungsi |
|:----------|:------|:-------|:-------|
| `CHUNK_SIZE` | 512 × 1024 = 524,288 B | `stream.rs` | Unit download MTProto |
| Response cap | 16 MB/response | `stream_server.rs::bounded_response_end()` | Force suffix request moov |
| Seek alignment | offset % 512KB → round down | `stream.rs::request_progressive_range()` | Cegah CDN offset shift |
| Chunk timeout | 15s | `stream.rs` [SEEK FIX #1] | Cegah MTProto silent hang |
| 'batch check | 500ms | `stream.rs` [SEEK FIX #2] | Deteksi seek mid-batch |
| Seek re-send | 2000ms | `stream_server.rs` [SEEK FIX #3] | Jaminan fill-loop terima seek |
| DemandReader wait | 30s max | `stream_server.rs` | Timeout baca pasif |
| handle_stream wait | 45s max | `stream_server.rs` | Timeout tunggu bytes seek |
| Fill clients | 4 parallel | `client_pool.rs` | 4× 512KB throughput |
| `PROGRESSIVE_MAX` | 4 GB | `stream.rs` | Batas ukuran file |

---

## 6. Pipeline Thumbnail — 5 Tier

### Tier 1: Stripped Mini-Thumb (0ms — Inline Data)
- Source: `PhotoSize::Stripped` dalam metadata pesan Telegram
- Size: ~60–200 bytes per item
- Proses: `unstrip_jpeg()` di `ffmpeg.rs` → inject JPEG headers → `data:image/jpeg;base64,...`
- Latensi: 0ms (tidak ada network, data ada di pesan)

### Tier 2: Cached WebP HD (< 5ms — IndexedDB)
- Source: `thumbPersistentCache.ts` → IndexedDB store `thumbnails`
- Proses: Direct lookup → render jika HIT
- Latensi: <5ms

### Tier 3: Foto/Gambar Statis (fast_sem — 12 permit, 200-800ms)
- Source: Telegram PhotoSize via MTProto GetFile
- Semaphore: `fast_sem` (12 permit paralel)
- Batch: 48 items/RPC call
- Proses: `thumbs.rs` → decode → WebP encode → base64
- Cache: Tulis IndexedDB + disk setelah dapat

### Tier 4: Video Dokumen (video_sem — 4 permit, 2-8 detik)
- Source: Video dokumen tanpa thumbnail Telegram
- Semaphore: `video_sem` (4 permit paralel)
- Proses:
  1. `thumbs.rs` → `special_media_thumb.rs` via `mpsc::channel(24)`
  2. `special_media_thumb.rs` → `thumbnail_range_bridge.rs` (local HTTP)
  3. FFmpeg: `-i http://127.0.0.1:{port}/stream/{sid}` → extract frame
  4. Capture stdout → WebP encode → cache
- Cache: `.{sid}.webp` di disk `thumbs/`

### Tier 5: Negative Cache (0ms — Early Exit)
- Trigger: Semua tier gagal (ZIP, EXE, DOCX, dll)
- Proses: Tulis `.{sid}.nothumb` + `"NOT_FOUND"` memory map
- Efek: Request berikutnya → `FileTypeIcon` SVG langsung
- Auto-prune: `is_fallback_black_card_bytes()` → hapus black card dari cache

### Correlation Pipeline (`thumbBatcher.ts`)
```
DriveFileCard.requestThumb(msgId, chatId)
  → Build requestId: "thumb:{peerId}:{msgId}:{peerGen.current}"
  → Cek IndexedDB → HIT: render, MISS: enqueue
  → 4 parallel in-flight batches (max 48/batch)
  → invoke('tg_thumbs_batch', [{requestId, ...}])
  → Rust: proses → ThumbnailBatchItemResult[] {requestId, data}
  → Match via requestId (non-positional)
  → Validasi peerGen.current [fail-closed jika mismatch]
  → Update ThumbnailImage.src → IndexedDB.set()
```

---

## 7. Sistem Migrasi & Job Engine

### Flow Migrasi (`jobs_run_migration` → `migration_run.rs`)

```
Frontend (Jobs/index.tsx)
  → invoke('jobs_run_migration', { jobId })
  → migration_run.rs::run_migration()
     ├─ Load job config dari SQLite (jobs_db.rs)
     ├─ session_guard_acquire() → exclusive lease
     ├─ Loop per chunk media source:
     │   ├─ dup_checker: 4-level check
     │   │   Level 1: message_id SQLite lookup
     │   │   Level 2: telegram_unique_id compare
     │   │   Level 3: SHA256 hash (full scan)
     │   │   Level 4: filename + size + date match
     │   ├─ media_transfer: Download dari source DC
     │   ├─ smart_throttle: Adaptive rate limit
     │   ├─ session_rate.wait_if_flooded_capped()
     │   ├─ media_transfer: Upload ke destination
     │   ├─ transfer_journal: Log audit entry
     │   └─ app_db: Update progress
     ├─ checkpoint save (resume support)
     └─ session_guard_release()
```

### Studio Orchestrator (`studio_orch.rs`)
- Queue: `job_queue.rs` (JSON persistent di disk: `studio_queue.json`)
- Commands: `studio_enqueue`, `studio_run_orchestrated`
- Batch upload dengan ordering + retry logic

---

## 8. Database & Storage

### A. SQLite `autogram.db` (WAL Mode)

#### Tabel `topic_media_items`
| Kolom | Tipe | Constraint | Fungsi |
|:------|:-----|:-----------|:-------|
| `account_id` | TEXT | PK(1), NOT NULL | Hash sesi Telegram |
| `peer_id` | TEXT | PK(2), NOT NULL | ID channel/grup |
| `topic_id` | INTEGER | PK(3), NOT NULL | ID topik (0=General) |
| `message_id` | INTEGER | PK(4), NOT NULL | ID pesan unik |
| `message_date` | INTEGER | NOT NULL | Unix epoch |
| `file_name` | TEXT | NULLABLE | Nama file asli |
| `file_size` | INTEGER | NOT NULL | Ukuran bytes |
| `mime_type` | TEXT | NULLABLE | MIME type |
| `thumb_data` | TEXT | NULLABLE | Base64 thumbnail |

Index: `idx_topic_media_lookup` → (`account_id`, `peer_id`, `topic_id`, `message_id`)

Tabel lain: `jobs` · `profiles` · `automations` · `stats` (transfer kumulatif)

### B. Stream Registry

`LIVE`: `Arc<RwLock<HashMap<String, StreamEntry>>>`  ← in-memory  
`DISK`: `worker/cache/stream_registry/{sid}.json`    ← persistence  

`StreamEntry` fields:
| Field | Tipe | Fungsi |
|:------|:-----|:-------|
| `stream_id` | String | ID unik (`g{msg_id}-{ms}-{hash}`) |
| `path` | String | Absolut path `.partial` |
| `total_size` | u64 | Ukuran dari Telegram |
| `mime` | String | MIME type |
| `label` | String | Nama file asli |
| `done` | bool | Download selesai |
| `ranges` | `Vec<(u64,u64)>` | Sparse `[start,end)` tersedia |
| `cancelled` | bool | Stream dibatalkan |
| `error` | `Option<String>` | Error fatal |
| `paused` | bool | Fill-loop idle |
| `updated_at_ms` | u128 | Timestamp ms |
| `moov_ready_cached` | bool | Atom moov terdeteksi |
| `moov_tail_fetching` | bool | Tail-fetch berjalan |

### C. IndexedDB (`mediaStudioDb.ts`)

| Store | Key | Value | Fungsi |
|:------|:----|:------|:-------|
| `mediaFiles` | `peerId:topicId` | `DriveFile[]` | SWR warm cache |
| `scrollPositions` | `peerId:topicId` | number | Posisi scroll |
| `thumbnails` | `folderId:msgId` | WebP Base64 string | Cache thumbnail |
| `previewCache` | `session:chat:msgId` | Blob | Preview blob |

---

## 9. Internasionalisasi (i18n)

- Framework: `react-i18next`
- Init: `src/i18n.ts` → `src/main.tsx`
- Hook: `const { t } = useTranslation('namespace')`
- 9 Namespace: `accounts` · `automation` · `dashboard` · `jobs` · `nav` · `settings` · `speedtest` · `statistics` · `sync`
- 100% key parity antara `id/` dan `en/`
- WAJIB: Setiap UI string baru HARUS ada di locale file
- DILARANG: Hardcode string Bahasa Indonesia/Inggris di `.tsx`/`.ts`

---

## 10. Keamanan & Credential

- `API_ID`/`API_HASH`: OS keychain via `keyring` crate (tidak pernah ke binary)
- Session `.session`: AES-256-GCM encrypted at rest
- Path policy: `path_policy.rs` allowlist → cegah path traversal
- `WorkerSessionLease`: Atomic exclusive ownership per transfer
- Ghost sessions: Auto-cleanup saat app exit (`session_clone.rs`)
- Network: SOCKS5/HTTP proxy via `ureq` + VPN detection

---

## 11. Rate Limit & FloodWait Management

### `session_rate.rs`
```
acquire_preview_slot()    → tunggu slot (max concurrent streams)
wait_if_flooded_capped()  → backoff adaptif flood
track_stream(sid)         → catat stream aktif
cancel_streams(sid)       → batalkan stream
note_error(session, err)  → rate tracking per sesi
```

### Fill-Loop Rate Control
```
Normal:     4 parallel × 512KB = 2MB per batch
FloodWait:  sleep(flood_wait_secs) + note_error() + backoff
Timeout:    worker timeout 15s → Ok(None) → retry next iter
```

### `smart_throttle.rs` (Migrasi)
- Monitor rate aktual vs target
- Auto-reduce speed menjelang FloodWait threshold
- Resume full speed setelah period aman

---

## 12. Penanganan Remote Agent — Protokol Resmi

### Apa itu "Remote" di AutoGram?

AutoGram adalah **Tauri desktop app** (bukan web). Jendela = Chromium WebView yang diembed di native Win32 window. Agent TIDAK bisa interaksi visual ke release build (`.exe` yang sudah berjalan).

### METODE 1: Dev Mode — DIREKOMENDASIKAN ✅

```powershell
# Jalankan dari direktori frontend:
cd "F:\AutoGram\AutoGram Approntend"
npm run tauri dev
# ATAU:
cargo tauri dev
```

Apa yang terjadi:
- Jendela Tauri terbuka di layar pengguna
- CDP (Chrome DevTools Protocol) aktif otomatis
- DevTools panel otomatis terbuka (`#[cfg(debug_assertions)]` → `window.open_devtools()`)
- Pengguna MELIHAT dan BISA INTERAKSI di jendela yang sama dengan agent

Cara agent connect dan berinteraksi:
```
1. Jalankan cargo tauri dev
2. Tunggu jendela muncul di layar pengguna
3. Agent: list_pages (chrome-devtools-mcp) → temukan page "tauri://localhost"
4. Agent: take_screenshot → lihat kondisi UI saat ini
5. Agent: evaluasi/click/fill via CDP tools
6. SELALU lapor ke pengguna: "Saya melihat halaman X, melakukan Y"
7. SELALU embed screenshot di response untuk transparansi
```

### METODE 2: Release Build — TIDAK BISA CDP ❌

`frontend.exe` (release build):
- Tidak ada CDP port
- Agent TIDAK bisa connect `chrome-devtools-mcp`
- Hanya bisa: file system + terminal tools

### METODE 3: Manual DevTools Enable di Release

Tambah sementara di `lib.rs` setup:
```rust
if let Some(window) = app.get_webview_window("main") {
    window.open_devtools(); // tanpa #[cfg(debug_assertions)]
}
```
Lalu rebuild: `cargo tauri build` → CDP aktif di release

### METODE 4: File System + Terminal (Selalu Tersedia)

Agent SELALU bisa tanpa visual:
- Baca/tulis source code
- `cargo check`, `cargo tauri build`
- Baca `worker/logs/`
- `sqlite3 autogram.db`
- Monitor `worker/cache/stream_registry/*.json`

### Tabel Kapan Perlu Remote

| Tugas | Perlu Remote? | Metode |
|:------|:-------------|:-------|
| Fix kode Rust | TIDAK | File edit + cargo check |
| Fix React UI | TIDAK | File edit + tsc |
| Test streaming behavior | YA | Dev mode + CDP |
| Verifikasi visual UI | YA | Dev mode + screenshot |
| Debug Tauri IPC | YA | Dev mode + evaluate_script |
| Query database | TIDAK | sqlite3 CLI |
| Monitor stream logs | TIDAK | worker/logs/ |

### Protokol Lengkap Agent Remote

```
STEP 1: Cek apakah dev mode sudah berjalan
  → tasklist | findstr "cargo" atau "frontend"
  → Jika tidak: jalankan cargo tauri dev

STEP 2: Temukan CDP target
  → chrome-devtools-mcp: list_pages
  → Pilih page URL "tauri://localhost"

STEP 3: Orientasi visual
  → take_screenshot → analisis UI
  → Lapor: "Saya melihat halaman [X]"

STEP 4: Interaksi
  → click, fill, navigate, evaluate_script
  → Setiap aksi: lapor ke pengguna apa yang dilakukan

STEP 5: Verifikasi
  → Screenshot setelah aksi
  → Embed di response untuk transparansi penuh
```

---

## 13. Inter-Module Call Graph Matrix

| Caller | Callee | Mekanisme | Tujuan |
|:-------|:-------|:----------|:-------|
| `MediaStudio/index.tsx` | `driveFilesApi.ts` | Async call | List media SWR + pagination |
| `DriveFileCard.tsx` | `thumbBatcher.ts` | `requestThumb()` | Request thumbnail |
| `DriveFileCard.tsx` | `VideoCanvasThumbnailCapturer` | Component render | Canvas fallback |
| `MediaVideoPlayer.tsx` | `telegramBackend.ts` | `tg_preview_stream` | Mulai stream |
| `thumbBatcher.ts` | `telegramBackend.ts` | `invoke('tg_thumbs_batch')` | Batch RPC |
| `telegramBackend.ts` | `lib.rs` | Tauri IPC invoke | Bridge ke Rust |
| `telegram_ops.rs` | `thumbs.rs` | Rust function call | `thumbs_batch_blocking_app` |
| `thumbs.rs` | `special_media_thumb.rs` | `mpsc::channel(24)` | Video doc queue |
| `special_media_thumb.rs` | `thumbnail_range_bridge.rs` | Tokio spawn | Local HTTP bridge |
| `special_media_thumb.rs` | `ffmpeg.rs` | Subprocess spawn | Frame extraction |
| `stream.rs` | `stream_server.rs` | Direct call | `upsert_entry`, `get_entry` |
| `stream.rs` | `session_rate.rs` | Direct call | Rate limit & slot |
| `stream.rs` | `client_pool.rs` | `obtain_download_clients` | 4 MTProto clients |
| `stream_server.rs` | `stream.rs` | Direct call | `request_progressive_range` |
| `HTML5 Video` | `stream_server.rs` | HTTP Range GET | Progressive streaming |
| `migration_run.rs` | `dup_checker.rs` | Rust call | 4-level dup check |
| `migration_run.rs` | `media_transfer.rs` | Rust call | Download + Upload |
| `migration_run.rs` | `session_rate.rs` | Rust call | FloodWait management |
| `DriveZipBrowser.tsx` | `driveStreamZipApi.ts` | API call | ZIP remote browse |
| `driveStreamZipApi.ts` | `grammers_sparse_zip.rs` | Tauri IPC | Sparse ZIP MTProto |

---

## 14. 16 Detail Mikro Teknis Berdampak Besar

### 1. 512KB MTProto Boundary Alignment
`aligned = offset - (offset % 524288)`  
Cegah `LOCATION_INVALID` dan byte shift dari CDN Telegram.

### 2. `unstrip_jpeg` — Rekonstruksi Header JPEG
inject SOI+DQT+SOF0+EOI ke stripped bytes → data URI 0ms tanpa network.

### 3. Fail-Closed `peerGen.current`
Atomic counter naik setiap ganti folder → request lama dibuang → 0% media bleed.

### 4. `is_fallback_black_card_bytes`
Histogram scan WebP/JPEG → auto-prune black card dari cache → re-decode bersih.

### 5. Negative Caching `.nothumb` + `"NOT_FOUND"`
File non-media → early exit → `FileTypeIcon` SVG tanpa RPC call.

### 6. Dual-Track Semaphore `fast_sem` (12) vs `video_sem` (4)
Foto tidak pernah diblokir oleh video decode. Throughput optimal.

### 7. `cardHeight` vs `rowHeight` Gap 10px
Gap 10px antara card height dan virtualizer row height → cegah jank saat scroll.

### 8. 8px Pointer Drag Prime Threshold
Klik < 8px = tap murni. Gerak > 8px = aktivasi drag. Cegah false drag di WebView.

### 9. `requestId` Correlation Matching
`"thumb:{peerId}:{msgId}:{peerGen}"` → non-positional match → thumbnail tidak tertukar.

### 10. 16MB Response Cap (`bounded_response_end`)
Cap setiap HTTP response 16MB → paksa Chrome kirim suffix request → fetch moov tail.

### 11. Tail-fetch Moov Task
Spawn task independen fetch last ~1MB → moov atom tersedia sebelum full download.

### 12. `upsert_entry` Range Merge Preservation
Merge existing ranges dengan ranges baru → tail-fetch ranges tidak di-overwrite fill-loop.

### 13. `moov_ready_cached` Flag
Scan atom 'moov' sekali, cache hasilnya → tidak re-scan setiap poll upsert.

### 14. 3-Layer Seek Fix (v2.7.2)
FIX #1: 15s timeout per MTProto chunk → cegah silent hang.  
FIX #2: `'batch` loop interruptible 500ms → break early saat seek masuk.  
FIX #3: Re-send seek setiap 2s di `handle_stream` → jaminan fill-loop terima seek.  

### 15. Ghost Session Clone
Session clone sementara untuk parallel operation → auto-cleanup on exit.

### 16. Sparse ZIP Central Directory Read
Fetch last 64KB → parse EOCD → fetch CD range → list tanpa download full file.

---

## 15. Matriks Status Fitur

| Fitur | Status | Module Utama |
|:------|:-------|:------------|
| Auth Phone + OTP | AKTIF | `session_auth.rs` |
| Login QR Code | AKTIF | `session_auth.rs` |
| Import Session Python | AKTIF | `telethon_session_import.rs` |
| Drive Explorer Grid + List | AKTIF | `DriveExplorer.tsx` |
| Thumbnail Batch 5-Tier | AKTIF | `thumbs.rs`, `thumbBatcher.ts` |
| Progressive Stream + Seek Fix | AKTIF (v2.7.2) | `stream.rs`, `stream_server.rs` |
| Sparse ZIP Remote Browse | AKTIF | `grammers_sparse_zip.rs` |
| Job Migration Engine | AKTIF | `migration_run.rs` |
| 4-Level Dup Detection | AKTIF | `dup_checker.rs` |
| Studio Upload Orchestrator | AKTIF | `studio_orch.rs` |
| Network Proxy/VPN | AKTIF | `network.rs` |
| OS Keyring Credentials | AKTIF | `secrets.rs` |
| Session Guard Exclusive Lease | AKTIF | `session_guard.rs` |
| SmartRate FloodWait | AKTIF | `session_rate.rs` |
| Automation Rules | AKTIF | `automations_db.rs` |
| Stats Export CSV | AKTIF | `stats_db.rs` |
| Dark Mode UI | AKTIF | `index.css`, `App.css` |
| i18n Bilingual id/en | AKTIF | `locales/`, `i18n.ts` |
| CDP Remote (Dev Mode only) | DEV ONLY | `lib.rs` `#[cfg(debug_assertions)]` |
| Topic Media Feature Module | EKSPERIMENTAL | `features/topic_media/` |

---

## 16. Standar Agent Governance

### A. Done Criteria
1. `cargo check` → 0 error
2. `npx tsc --noEmit` → 0 error
3. `commit` + `push` ke `origin main`

### B. No-Touch Rule
DILARANG mengubah tanpa instruksi eksplisit:
- `thumbs.rs`, `thumbBatcher.ts`, `special_media_thumb.rs`
- `ffmpeg.rs`, `thumbnail_range_bridge.rs`
- `thumbPersistentCache.ts`, `previewCache.ts`

### C. Skill Pack Aktif (`.agents/skills/`)
`prompt-to-spec-orchestrator` · `codebase-cartographer` · `feature-planning-architect`  
`bug-fix-loop-investigator` · `root-cause-debugger` · `implementation-quality-gate`  
`regression-test-planner` · `telethon-best-practices` · `react-refactor-safe`  
`ui-polish-mobile` · `scroll-touch-debugger` · `performance-audit`  
`conventional-commit` · `supabase-safe-change` · `netlify-deploy-debug` · `graphify`  

### D. Commit Convention
Format: `type(scope): deskripsi`  
Types: `fix` · `feat` · `docs` · `refactor` · `chore` · `perf`  

### E. Versioning
Format: `x.y.z` — increment `.z` setiap perubahan  
Maximum `.z` = 99 sebelum naik `.y`  
Update `CHANGELOG.md` dan `VERSION.md` setiap rilis  

---

*Dokumen master v2.7.2 — Ground-truth 100% akurat per 2026-08-02. Mencakup: 100+ file project, 85+ Tauri commands, streaming pipeline lengkap dengan 3 seek fix, thumbnail 5-tier, sparse ZIP, migration engine, SQLite schema, IndexedDB, worker directory, i18n, keamanan, FloodWait, remote agent protocol Tauri desktop, inter-module call graph, feature matrix, dan 16 detail mikro teknis.*
