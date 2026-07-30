# Graph Report - AutoGram  (2026-07-30)

## Corpus Check
- 434 files · ~499,903 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2614 nodes · 5413 edges · 295 communities (147 shown, 148 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 194 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `524b9a87`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- frontend/src-tauri/src/lib.rs
- app_db.rs
- grammers_media.rs
- telegram_ops.rs
- paths.mjs
- CHANGELOG.md
- grammers_ops.rs
- job_queue.rs
- list_zip_sparse
- tg_log.rs
- path_policy.rs
- session_rate.rs
- stream_server.rs
- TgError
- secrets.rs
- jobs_db.rs
- allow
- telethon_session_import.rs
- SpeedTest.tsx
- network.rs
- drive_rpc.rs
- compilerOptions
- AutoGram App/src-tauri/tauri.conf.json
- DriveExplorer.tsx
- migration_run.rs
- get_connection
- DrivePreviewModal.tsx
- path_is_allowed
- JobRuntime.tsx
- DriveConfirmDialog.tsx
- dependencies
- devDependencies
- App.tsx
- DriveZipBrowser.tsx
- permissions
- tg_error.rs
- scripts
- AutoGram Project Rules
- test_34404_instant.mjs
- test_34404_v3.mjs
- automations_db.rs
- download_registry.rs
- profiles_db.rs
- test_media_specific.mjs
- DriveSidebar.tsx
- Bug Investigation
- goto_42794.mjs
- Topic invalid + initial sidebar/thumbnail load
- 3. Fitur Utama (Core Features)
- JobEditor.tsx
- wait_helpers.mjs
- Bug Investigation: Media Studio Deep Performance
- ProgressTracker
- TransferJournal
- db.py
- debug_42772_deep.mjs
- ensure-remote.ps1
- goto_42772.mjs
- goto_42772_robust.mjs
- frontend/e2e-cdp-smoke.mjs
- DriveToolsPanel.tsx
- stats_db.rs
- session_clone.rs
- probe_34404.cjs
- probe_34404_v2.cjs
- probe_34404_v3.cjs
- test_all_three_media.mjs
- Bug Investigation: Media Studio Transfer Session
- Hybrid Rust–Python Architecture (AutoGram)
- list_media_blocking_topic
- parse_moov_internal
- streaming_policy.rs
- compilerOptions
- AutoGram App/src-tauri/capabilities/default.json
- Media Studio initial-load investigation
- Bug Investigation: Preview Random Seek
- Thumbnail cold-load and pagination performance
- e2e-gudang-thumbs.mjs
- scripts
- .new
- AutoGram Remote (CDP)
- Bug Investigation: Native Account, Session, Document and Video Preview
- Session Isolation, Upload Limits, and Migration Scale
- Bug Investigation: Session + Stream/Buffer/Preview Conflicts
- Staged session bootstrap
- Bug: Video preview keeps reloading during buffer (multi-video)
- config_normalize.rs
- ProgressSnapshot
- input_injector.mjs
- Media count and storage accuracy investigation
- Buffer bar stuck + “Stream bermasalah”
- Rust + Grammers Backend (Force — no Telethon runtime)
- System Architecture
- Web deploy vs desktop (heavy features)
- Architecture Decision Record (ADR)
- Repository Governance
- Backup & Recovery Procedures
- Final Audit Report (v5.1.1)
- Development Roadmap
- Security Control Matrix
- Test Strategy
- Accounts.tsx
- VSCodeCodeViewer.tsx
- DriveTransferManager.tsx
- ReUploadBatchModal.tsx
- capability.rs
- media_meta.rs
- frontend/package.json
- FormGroups.tsx
- ZipErrorBoundary
- Settings.tsx
- inspect_cards.mjs
- inspect_full_dom.mjs
- probe_msg_73.mjs
- probe_thumb_73_detail.mjs
- v2.3.53 Optimasi Performa Cold Start, Speed Loading List Card & Thumbnail Bulk IDB Read, & Fix Thumbnail Dokumen/File
- v2.3.52 Universal Target-DC Parallel MTProto Download Pipeline & CDN Edge Routing
- v2.1.73 Upload UI → Rust Orchestrator Default + Full-Rust Scaffold
- v2.1.74 Grammers dual-path compile-fix + multi-layer debug logs
- v2.1.81 Stream cancel thrash + Grammers album
- v2.1.78 Phase 6 — Progressive stream + thumbs + topics (Grammers)
- v5.1.1 Improvement Report
- AutoGram frontend (Tauri + React + TypeScript)
- main.tsx
- React + TypeScript + Vite
- probe_direct.mjs
- probe_dom.cjs
- v2.1.72 Phase 3 — Studio Job Queue di Rust (Python Step Upload)
- v2.1.70 Proxy/VPN dari Telegram-Drive + Telethon Hybrid
- v2.1.79 Fix video preview reload loop + stream hardening
- v2.1.67 Start Video Multi-Tier + Pratinjau Dokumen/Kode Cepat
- v2.1.77 Phase 5 — Drive dual-path list + Grammers download
- v2.1.80 Video play stuck + buffer speed (34.mp4 class)
- v2.1.69 Hybrid Phase 2 — Rust Stream Server + Local Utilities
- v2.1.76 Grammers-first studio orch (honest hybrid, not full cutover)
- v2.1.75 Fix overhead looping (preview poll + session ready)
- Data Flow & Execution Pipeline
- ProgressBar.tsx
- vite-env.d.ts
- safety-guard.js
- v2.3.4 Optimasi Kecepatan & Presisi Penghapusan Media (`SpeedTest.tsx`, `mediaStudioDb.ts`, `drive_rpc.rs`)
- v2.3.2 Optimalisasi Kecepatan & Instant Fast-Fail Penghapusan Media (`drive_rpc.rs`, `grammers_ops.rs`)
- v2.3.13 Optimasi Pengindeksan & Pratinjau ZIP Sparse (Zero Full-Download & Kuota Hemat)
- v2.3.38 Support Thumbnail Extraction & Auto-Sync untuk Link Post Telegram (`Media::WebPage`)
- v2.3.41 Dynamic 4MB MOOV Tail Scan & Instant Frame Play-Nudge Fix
- v2.3.8 Self-Healing Cache & Automatic Database Sync untuk Berkas Terhapus Telegram Server
- v2.3.17 Zero-Seek Central Directory Fast Parser (Optimasi ZIP 1GB+ Hanya ~512 KB & 100% Akurat)
- v2.3.26 Toolbar Tools Lengkap untuk Pratinjau Gambar di ZIP Browser
- v2.2.0 Alur Kerja Komprehensif Ekstraksi Arsip ZIP ke Drives & Telegram
- v2.1.96 Fitur Slider Pembatas Ukuran Cache & Fitur Pangkas Otomatis (Cache Limit Slider)
- v2.3.0 Migrasi Full 100% Grammers Rust Native MTProto (Zero-Python Engine)
- v2.3.40 Resolusi Konflik MTProto Rate Governance (ZIP Sparse vs Video Stream)
- v2.3.37 Comprehensive Thumbnail Debug Logging & Diagnostic Enhancements
- v2.3.11 100% Pure Rust MTProto Sparse ZIP Engine (<0.5s Indeks Load)
- v2.2.5 Arsitektur Dual-Mode Pengunduhan ZIP & Migrasi Grammers Rust MTProto
- v2.3.61 Fast 2MB Single-Pass Tail Scan & Rescue Loop Head-Tail MP4 Combination Patch
- v2.3.62 Dual-Track Parallel Concurrency & Ultra-Fast Image Thumbnail Response
- v2.3.20 Perluasan Pencarian Central Directory 4 MB & Eliminasi Total Iterasi Network Seeking di Fallback Path
- v2.3.22 Direct Offset Range Fetching & In-Memory ZIP Catalog Caching
- v2.3.47 Ultra-Instant <50ms Stream URL Return & Parallel Concurrent MOOV Tail Fetch
- v2.3.45 Ultra-Fast 1-Shot MOOV Tail Bootstrap & Adaptive Lightweight Buffer Pacing
- v2.3.18 Eliminasi Total Iterasi Network Seeking saat Pratinjau Media Tunggal (Memangkas Kuota Pratinjau dari 60 MB ke Tepat 9.22 MB)
- v2.3.29 Zero Re-Download ZIP Entry Preview Caching
- v2.1.82 Session & Chat List Load Speed Optimization
- v2.3.50 Smart Auto-Pruning Engine & Active File Lock Protection
- v2.3.16 Perbaikan Kritis Eliminasi Pengunduhan ZIP Berkas Penuh untuk Ukuran ≤ 500 MB
- v2.2.1 Integrasi Visual Transfer Manager saat Ekstraksi Arsip ZIP
- v2.3.10 Perbaikan Kritis ZIP Preview & Extraction Engine
- v2.3.54 Instant 0ms Progressive Blur Thumbnail Paint & Real-Time Streaming
- v2.3.49 Progressive Blur Placeholder — Thumbnail Instan Mode Seimbang/Jelas
- v2.3.34 Perbaikan Kritis Multi-DC FILE_MIGRATE (RPC Error 303) pada Navigasi Pratinjau ZIP & Media
- v2.3.1 Perbaikan Error Banner & Resets Loading State pada Penghapusan Media/Topik
- v2.3.5 Multi-Key Channel Resolution Cache (`grammers_ops.rs`)
- v2.3.14 Elevasi Z-Index Transfer Manager (Floating Progress Pill Over Modals)
- v2.3.30 Mouse Wheel Zoom, Double Click Zoom & Smooth Panning Drag pada ZIP Media Preview
- v2.3.48 Optimasi Kecepatan Load Daftar Media & Thumbnail Grid
- v2.3.15 Instant 0-ms ZIP Index Caching, Telegram Auto-Sync, & Universal VSCode Code Viewer
- v2.2.3 Pelimpahan Ekstraksi ZIP ke Engine Transfer Manager Pusat
- v2.2.2 Penggabungan Destinasi Terpadu & Badge Visual Gabungan
- v2.3.31 Redesain Visual Aksen Tombol Toolbar ZIP Workbench
- v2.2.4 Perbaikan Unduh Arsip ZIP ke Lokal & Integrasi Transfer Manager
- v2.3.23 Force Refresh Cache Invalidation, Base64 RAM Protection, & Batch Extract Cancellation
- v2.3.55 Dynamic 16MB Tail Scan for 2K/4K/AV1 Videos, Reverse moov Finder, & Silent FFmpeg Execution
- v2.3.68 Real-Time Video Thumbnail Frame Extraction, Multi-Timestamp Seek (2s/5s) & Solid Black Fallback Card Purge
- v2.3.57 Universal Document Thumbnail Sample Extraction & Instant HD Blur Resolution Patch
- v2.3.66 AV1 Video Thumbnail Fix — Hardware Acceleration Bypass, Larger Sample Budget & Graceful Degradation
- v2.3.65 Document Video Saver Mode Lightweight Extraction & Extended Magic Bytes Fallback Fix
- v2.3.3 Perbaikan Bug Kritis ReferenceError `requireGrammersIdentity` pada Penghapusan Media (`driveApi.ts`)
- v2.3.21 Perbaikan Kompilasi Rust (`TgErrorCode::Io` pada Penanganan Password ZIP)
- v2.3.39 Stream Auto-Pause Fix & Eliminasi Loop Reload Pemutar Video
- v2.3.36 Perbaikan Kritis Ekstraksi Frame Video MP4 (Faststart <= 2.5MB), Dynamic Recursive FFmpeg Search, & Fallback Layer Telegram
- v2.3.33 Fix Presisi Topic Mapping pada Ekstraksi ZIP Preview Modal
- v2.3.56 Reliable Message-ID Mapping & Truncated Faststart MP4 Header Patching
- v2.3.51 Auto-Resume Buffer & Smooth Video Player Recovery
- v2.3.27 Eliminasi Layar Hitam Blank saat Membuka ZIP Modal
- v2.1.97 Penguatan Fungsi Seluruh Tombol Manajemen Cache & Rust Disk Trimming
- v2.3.46 Dynamic 6MB MOOV Tail Bootstrap & Non-Corrupting Range Server Fallback
- v2.3.44 Eliminasi Port 0 & Service Worker Bypass untuk Server Stream Lokal
- v2.3.50 Perbaikan Regresi — Loading List Media Lambat (maxConcurrent & loadingMore)
- v2.3.28 Perbaikan Flexbox Layout Collapse pada ZIP Preview Container (100% Full-Bleed Workbench)
- v2.3.58 Non-Web Image Transcoding, Embedded PDF Cover Extraction & Document Thumbnail Guard Patch
- v2.3.60 Native WinRT PDF Page 1 Render, AV1/2K Video Rescue & Non-Zero FFmpeg Exit Frame Extraction
- v2.3.59 Native WinRT PDF Page 1 Render, AV1/2K Video Rescue & Non-Zero FFmpeg Exit Frame Extraction
- v2.3.67 PDF FFmpeg Bypass, Non-Media Document Filtering & Disk/Memory Negative Caching (.nothumb)
- v2.1.84 Perbaikan False FloodWait & Optimalisasi Kecepatan Pemuatan Media
- v2.1.85 Perbaikan Disconnect Loop & Handling FloodWait Telegram
- v2.1.99 Dukungan Tautan & WebPage Preview (`Media::WebPage` & Link Cards)
- v2.1.83 Penyelarasan Kualitas & Kerapian Thumbnail (Hemat, Seimbang, Jelas)
- v2.1.93 Perbaikan Race Condition & Stale Media Bleeding pada Perpindahan Antar Topik
- v2.1.95 Otomatisasi Penelusuran Topik Mendalam & Eviksi Cache Kosong Lapuk
- v2.1.100 Eliminasi Pembekuan Grid & Penyelarasan Perpindahan Topik UI
- v2.1.94 Perluasan Batas Pemindaian Pesan Topik (`scan_limit` 10.000 Pesan)
- v2.1.92 Perbaikan Rekonstruksi Faststart MP4 & Re-indexing Atom Chunk Offset
- v2.1.91 Autodeteksi Lokasi Biner FFmpeg Windows & Ekstraksi Frame Video Otomatis
- v2.1.90 Perbaikan Duplikasi Offset Chunk & Korupsi Header Sampel Media
- v2.1.89 Autodeteksi Magic-Bytes Media & Eliminasi Error 'No Valid Thumb'
- v2.1.88 Perbaikan Auto-Retry & State Lockout Thumbnail Kartu Grid
- v2.1.87 Perbaikan Decoding Thumbnail Foto/Gambar Document (>256KB)
- v2.1.86 Perbaikan Pemuatan Thumbnail Video MP4 Non-Faststart & Large Media
- v2.3.35 Eliminasi Clipping Paint Card & Optimalisasi Spacing Atas Grid Media Drive
- v2.1.98 Alignment Presisi 1:1 Knob Slider & Teks Label Ukuran Cache
- v2.3.24 Peningkatan Threshold Media Image 15 MB & Dedicated Card Component untuk Large Media
- v2.3.6 Preservasi Pesan Kesalahan IPC Telegram API (`telegramBackend.ts`, `driveApi.ts`)
- v2.3.19 Eliminasi Total Background Pre-fetching Berkas Tetangga pada Modal Pratinjau ZIP & Dokumen
- v2.3.32 Serialized Request Lock, Stale Cancellation & Stream Auto-Stop (Proteksi Total FloodWait)
- v2.3.25 Redesain Modern Glassmorphic Encrypted ZIP Card UI
- v2.3.7 Perbaikan Kritis Pendaftaran Izin Tauri IPC Command (`autogram-commands.toml`)
- v2.3.9 Pure Rust + Grammers Engine ZIP Preview & Single-Entry Extraction
- v2.3.42 Fast MOOV Tail Bootstrap & Instant Video Start Fix
- v2.3.12 100% Pure Rust Virtual MTProto Sparse Reader (`TelegramSparseReader`)
- migrations/README.md
- database/README.md
- AUDIT_NOTES.md
- System_Component_Map.md
- Telegram_Core_Architecture.md
- Developer_Guide.md
- MERGE_AUDIT_REPORT_v5_1_1.md
- MERGE_HISTORY.md
- MERGE_HISTORY_v5_1_1.md
- Telegram_Session_Security.md
- i18next
- pdfjs-dist
- react-i18next
- migration_run.rs
- @tauri-apps/plugin-fs
- @tauri-apps/plugin-shell
- AutoGram App/src-tauri/build.rs
- ImageViewer.tsx
- AutoGram App/src-tauri/src/main.rs
- create_execution
- README.md
- probe_thumb_files.mjs
- probe_thumbs_diag.mjs
- MicroProgressBar
- ModernProgressBar
- stats_db.rs
- v2.3.71 Export clearThumbCache, Post-Wipe Global Auto-Refetch Event & Collision-Free FFmpeg Temp File Paths
- log_duplicates_batch
- v2.3.78 Multi-Decoder CPU Software Fallback (`libdav1d` / `av1`) & Head Rescue Loop
- MediaHeaderToolbar.tsx
- pdfjs-dist
- MediaStudioToolbar.tsx
- capability.rs
- v2.3.75 Full Uncorrupted Faststart MP4 Reconstruction & Fault-Tolerant FFmpeg Extraction
- @tauri-apps/plugin-dialog
- react-phone-number-input
- @tauri-apps/plugin-opener
- @types/qrcode
- DeadCenterProgress
- MicroProgressBar
- ModernProgressBar
- ZipErrorBoundary
- MediaAudioPlayer.tsx
- MediaVideoPlayer.tsx
- useMediaStudioKeybindings.ts
- SidebarRecentsSection.tsx
- DuplicatesTab.tsx
- SpaceUsageTab.tsx
- JobFilterSettings.tsx
- JobSourceTargetConfig.tsx
- AccountLoginModal.tsx
- SessionManagerTable.tsx

## God Nodes (most connected - your core abstractions)
1. `TgError` - 84 edges
2. `OpResult` - 60 edges
3. `TelegramIdentity` - 45 edges
4. `map_invocation()` - 39 edges
5. `with_client()` - 34 edges
6. `runtime()` - 34 edges
7. `ensure_sessions_dir_env()` - 32 edges
8. `resolve_peer()` - 29 edges
9. `ok_result()` - 29 edges
10. `start_preview_stream_inner()` - 28 edges

## Surprising Connections (you probably didn't know these)
- `DriveSidebar()` --indirect_call--> `step()`  [INFERRED]
  AutoGram App/frontend/src/components/drive/DriveSidebar/index.tsx → remote/e2e-cdp-smoke.mjs
- `resolve_migrator_db()` --calls--> `resolve_sessions_dir()`  [INFERRED]
  AutoGram App/frontend/src-tauri/src/core/automations_db.rs → AutoGram App/frontend/src-tauri/src/core/grammers_ops/session_auth.rs
- `input_channel_from_peer()` --calls--> `resolve_peer()`  [INFERRED]
  AutoGram App/frontend/src-tauri/src/core/drive_rpc.rs → AutoGram App/frontend/src-tauri/src/core/grammers_ops/peer_resolver.rs
- `delete_messages_blocking()` --calls--> `with_client()`  [INFERRED]
  AutoGram App/frontend/src-tauri/src/core/drive_rpc.rs → AutoGram App/frontend/src-tauri/src/core/grammers_ops/client_pool.rs
- `delete_messages_blocking()` --calls--> `resolve_peer()`  [INFERRED]
  AutoGram App/frontend/src-tauri/src/core/drive_rpc.rs → AutoGram App/frontend/src-tauri/src/core/grammers_ops/peer_resolver.rs

## Import Cycles
- None detected.

## Communities (295 total, 148 thin omitted)

### Community 0 - "frontend/src-tauri/src/lib.rs"
Cohesion: 0.05
Nodes (126): acquire_session_lease_inner(), acquire_worker_session_lease(), automations_delete(), automations_list(), automations_save(), backend_capabilities(), build_python_command(), build_python_command_with_stdin() (+118 more)

### Community 1 - "app_db.rs"
Cohesion: 0.08
Nodes (28): ScanCacheEntry, CheckResult, DuplicateChecker, ensure_tables(), now_unix(), open_db(), Connection, HashMap (+20 more)

### Community 2 - "grammers_media.rs"
Cohesion: 0.10
Nodes (54): extract_ffmpeg_frame_sync(), ffmpeg_supports_av1(), find_ffmpeg_binary(), generate_video_fallback_card(), get_static_fallback_jpeg(), is_fallback_black_card_bytes(), Option, Path (+46 more)

### Community 3 - "telegram_ops.rs"
Cohesion: 0.09
Nodes (71): active_ops(), active_telegram_backend(), AuthStatus, AvatarsBatchRequest, backend_status(), backend_status_lists_grammers_ops(), BackendStatus, CreateFolderRequest (+63 more)

### Community 4 - "paths.mjs"
Cohesion: 0.08
Nodes (49): checkHealth(), fetchOk(), waitForHealthy(), lines, log, logFile, write(), closeRenameAudit() (+41 more)

### Community 5 - "CHANGELOG.md"
Cohesion: 0.03
Nodes (69): v2.1.0 Foundation & Merged Repository, v2.1.10 Perbaikan Akurasi Pengurutan Terlama & Sinkronisasi State Filter, v2.1.11 Perbaikan Galat Indeks Pengindeksan Media & Kestabilan Indikator Koneksi, v2.1.12 Optimasi Dinamis Buffering & Kecepatan Streaming Berkas Besar (>1GB), v2.1.13 Perbaikan Error 'MTProtoSender' Object Is Not Callable untuk Pratinjau Berkas Lintas DC (>2GB), v2.1.14 Pembersihan Placeholder Tampilan Awal Memuat Pratinjau Media (Video & Gambar), v2.1.15 Pembersihan Sesi Bayangan (_preview) dari Daftar Pilihan Antarmuka, v2.1.16 Paralelisasi Bootstrapping & Optimasi Batas Muat Awal Media (+61 more)

### Community 6 - "grammers_ops.rs"
Cohesion: 0.10
Nodes (51): RwLock, session_operation_lock(), user_profile_from(), auth_status_blocking(), cancel_qr_login(), delete_grammers_session_files(), ensure_grammers_session(), fresh_login_does_not_persist_session_before_auth_key() (+43 more)

### Community 7 - "job_queue.rs"
Cohesion: 0.08
Nodes (56): create_and_update_item(), create_transfer(), CreateFileEntry, CreateTransferRequest, get_transfer(), init_queue_path(), ItemState, list_transfers() (+48 more)

### Community 8 - "list_zip_sparse"
Cohesion: 0.12
Nodes (25): AtomicU32, AtomicU64, FileHashResult, hashes_small_file(), quick_fingerprint(), Result, String, sha256_file() (+17 more)

### Community 9 - "tg_log.rs"
Cohesion: 0.07
Nodes (41): AsRef, cleanup_paths(), CleanupResult, clear_download_registry(), get_registry_path(), list_active_download_paths(), load_unlocked(), register_download_path() (+33 more)

### Community 10 - "path_policy.rs"
Cohesion: 0.10
Nodes (40): ext_of(), extract_office_zip(), extract_rtf_plain(), guess_mime(), is_text_ext(), LocalDocPreview, looks_binary(), pretty_json() (+32 more)

### Community 11 - "session_rate.rs"
Cohesion: 0.13
Nodes (31): acquire_media_slot(), begin_preview_flight(), end_preview_flight(), ensure_not_flooded(), flood_remaining_secs(), non_flood_errors_do_not_trigger_flood_wait(), note_error(), note_flood_wait() (+23 more)

### Community 12 - "stream_server.rs"
Cohesion: 0.13
Nodes (41): contiguous_end_from(), contiguous_from_zero(), cors_headers(), ensure_started(), filled_bytes(), get_entry(), handle(), handle_register() (+33 more)

### Community 13 - "TgError"
Cohesion: 0.18
Nodes (19): clear_peer_cache_for_all(), DialogFilterRow, list_dialog_filters_blocking(), list_dialogs_blocking(), peer_cache(), peer_to_ref(), resolve_peer(), Client (+11 more)

### Community 14 - "secrets.rs"
Cohesion: 0.24
Nodes (35): decode_key_b64(), decrypt_map(), decrypt_map_or_recover(), delete_credential(), delete_worker_temp_file(), encrypt_map(), ensure_secure_dirs(), get_credential() (+27 more)

### Community 15 - "jobs_db.rs"
Cohesion: 0.19
Nodes (32): calculate_cache_size(), cancel_execution(), clear_disk_cache(), create_job(), CreateJobRequest, delete_job(), edit_job(), EditJobRequest (+24 more)

### Community 16 - "allow"
Cohesion: 0.06
Nodes (33): app, security, windows, enable, scope, build, beforeBuildCommand, beforeDevCommand (+25 more)

### Community 17 - "telethon_session_import.rs"
Cohesion: 0.22
Nodes (21): export_grammers_to_telethon_file(), GrammersSessionFile, import_from_synthetic_telethon_db(), import_telethon_to_grammers_file(), parse_ipv4(), probe_missing(), probe_telethon_session(), read_session_data() (+13 more)

### Community 18 - "SpeedTest.tsx"
Cohesion: 0.11
Nodes (18): DriveContextMenu(), DriveContextMenuTarget, DriveLocationKind, Props, DriveDestChoice, DriveDestinationPicker(), DriveDestPickerState, kindIcon() (+10 more)

### Community 19 - "network.rs"
Cohesion: 0.16
Nodes (27): apply_all(), apply_proxy(), apply_vpn(), clamp_vpn(), clamp_vpn_bounds(), connect_timeout_secs(), init_config_path(), is_network_available() (+19 more)

### Community 20 - "drive_rpc.rs"
Cohesion: 0.14
Nodes (47): avatars_batch_blocking(), AvatarsBatchResult, channel_peer_id_from_bare(), chats_from_updates(), compose_folder_about(), create_folder_blocking(), create_topic_blocking(), delete_folder_blocking() (+39 more)

### Community 21 - "compilerOptions"
Cohesion: 0.09
Nodes (22): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+14 more)

### Community 22 - "AutoGram App/src-tauri/tauri.conf.json"
Cohesion: 0.13
Nodes (38): cancel_flags(), cancel_progressive(), data_url_jpeg_header(), find_cached_preview_file(), first_missing_offset(), guess_mime(), live_preview_map(), media_name() (+30 more)

### Community 23 - "DriveExplorer.tsx"
Cohesion: 0.14
Nodes (13): DriveExplorer(), Props, DriveFileCard, Props, DriveFileListItem(), Props, CenteredGlassmorphicProgress(), CenteredGlassmorphicProgressProps (+5 more)

### Community 25 - "get_connection"
Cohesion: 0.13
Nodes (38): clear_duplicate_history_for_target(), create_transfer_state(), delete_duplicate_by_message_id(), delete_session(), ensure_schema_extended(), get_duplicate_message_id(), get_duplicate_message_ids_batch(), get_session() (+30 more)

### Community 26 - "DrivePreviewModal.tsx"
Cohesion: 0.16
Nodes (29): CachedLiveClient, connect_client(), disconnect_cached_session(), ensure_authorized(), get_cached_user_profile(), is_fatal_auth_error(), is_pool_or_transport_error(), live_clients() (+21 more)

### Community 27 - "path_is_allowed"
Cohesion: 0.42
Nodes (18): allowed_roots(), cache_file_ready(), copy_cache_file(), open_path_safe(), open_with_dialog(), path_is_allowed(), path_looks_like_cache(), resolve_worker_root() (+10 more)

### Community 28 - "JobRuntime.tsx"
Cohesion: 0.14
Nodes (13): FreshStartModal(), FreshStartModalProps, JobDetailsModal(), JobDetailsModalProps, JobEditor(), JobRuntime(), JobRuntimeProps, JobsList() (+5 more)

### Community 29 - "DriveConfirmDialog.tsx"
Cohesion: 0.09
Nodes (18): DriveConfirmDialog(), DriveConfirmKind, DriveFolderDeleteChoice, DriveMoveChoice, Props, SidebarSessionHeaderProps, DriveToolsPanel(), DriveToolsTab (+10 more)

### Community 30 - "dependencies"
Cohesion: 0.12
Nodes (17): dependencies, i18next, lucide-react, pdfjs-dist, react-dom, @tanstack/react-virtual, @tauri-apps/api, @tauri-apps/plugin-fs (+9 more)

### Community 31 - "devDependencies"
Cohesion: 0.12
Nodes (17): devDependencies, playwright, @tauri-apps/cli, @types/react, @types/react-dom, typescript, vite, @vitejs/plugin-react (+9 more)

### Community 32 - "App.tsx"
Cohesion: 0.13
Nodes (14): App(), DESKTOP_ONLY_TABS, initialTab(), MediaStudio, NAV_ITEMS, Sidebar(), SidebarProps, Automation() (+6 more)

### Community 33 - "DriveZipBrowser.tsx"
Cohesion: 0.16
Nodes (15): DriveConfirmState, parseDropKey(), DriveCrumbSeg, DriveTopBar(), Props, clearZipBrowserCache(), flushTransferDebugLog(), LocationKind (+7 more)

### Community 34 - "permissions"
Cohesion: 0.12
Nodes (16): description, identifier, permissions, remote, urls, $schema, windows, allow-custom-commands (+8 more)

### Community 35 - "tg_error.rs"
Cohesion: 0.21
Nodes (10): _code_ok(), Into, Option, Self, String, TgError, TgErrorCode, TgErrorPublic (+2 more)

### Community 36 - "scripts"
Cohesion: 0.12
Nodes (16): dependencies, ws, description, name, private, scripts, build:exe, ensure (+8 more)

### Community 37 - "AutoGram Project Rules"
Cohesion: 0.12
Nodes (15): Architecture (Tauri + React + Rust) — Grammers-only MTProto, AutoGram Project Rules, Commits, Database, Default workflows (skills), Deploy / Netlify, Done criteria, Duplicate prevention (+7 more)

### Community 38 - "test_34404_instant.mjs"
Cohesion: 0.30
Nodes (15): errLog(), httpGet(), js(), log(), main(), note(), ok(), openCDP() (+7 more)

### Community 39 - "test_34404_v3.mjs"
Cohesion: 0.30
Nodes (15): errL(), httpGet(), js(), log(), main(), note(), ok(), openCDP() (+7 more)

### Community 40 - "automations_db.rs"
Cohesion: 0.32
Nodes (14): AutomationRow, delete_automation(), ensure_schema(), list_automations(), open_db(), resolve_migrator_db(), Connection, Option (+6 more)

### Community 42 - "profiles_db.rs"
Cohesion: 0.32
Nodes (14): delete_profile(), ensure_schema(), list_profiles(), open_db(), ProfileRow, resolve_migrator_db(), Connection, Option (+6 more)

### Community 43 - "test_media_specific.mjs"
Cohesion: 0.26
Nodes (14): bug(), bugs, cdpSession(), evalJSON(), httpGet(), log(), main(), require (+6 more)

### Community 44 - "DriveSidebar.tsx"
Cohesion: 0.19
Nodes (10): DriveSidebar(), dropKey(), DropRowProps, Props, IMPORTANT: include folder reparent drag — without it WebView2 folder→Drive DnD d, readSecOpen(), TELEGRAM_FOLDER_COLORS, telegramFolderColor() (+2 more)

### Community 45 - "Bug Investigation"
Cohesion: 0.15
Nodes (12): Actual behavior, Bug Investigation, Expected behavior, Failed fixes, Hypotheses tried, Next steps, Reproduction steps, Status (+4 more)

### Community 46 - "goto_42794.mjs"
Cohesion: 0.29
Nodes (11): err(), httpGet(), js(), log(), main(), note(), openCDP(), require (+3 more)

### Community 47 - "Topic invalid + initial sidebar/thumbnail load"
Cohesion: 0.17
Nodes (11): Fix, Reproduction evidence (2026-07-16), Root cause, Root causes, Status, Symptoms, Topic invalid + initial sidebar/thumbnail load, Topic selector latency follow-up (2026-07-16) (+3 more)

### Community 48 - "3. Fitur Utama (Core Features)"
Cohesion: 0.17
Nodes (11): 1. Visi & Objektif, 2. Target Pengguna, 3.1. Entity Support, 3.2. Migration Engine, 3.3. Duplicate Engine (4-Level), 3.4. Rule Engine & Filters, 3.5. Task & Workflow Management, 3.6. Security & Anti-Spam (+3 more)

### Community 49 - "JobEditor.tsx"
Cohesion: 0.21
Nodes (7): InfoTooltip(), Select(), SelectOption, SelectProps, CaptionModal(), CaptionModalProps, parseTelegramMarkdown()

### Community 50 - "wait_helpers.mjs"
Cohesion: 0.33
Nodes (10): clampHealTimeoutMs(), computePollSchedule(), ENSURE_PHASE_BUDGETS_MS, ensureChildWorstCaseMs(), formatPhaseLine(), formatProgressStatus(), parentDeadlineCoversChild(), scheduleTotalMs() (+2 more)

### Community 51 - "Bug Investigation: Media Studio Deep Performance"
Cohesion: 0.18
Nodes (10): Bug Investigation: Media Studio Deep Performance, Expected behavior, Failed fixes, Hypotheses tried, Next steps, Status, Suspected files, Symptoms (+2 more)

### Community 52 - "ProgressTracker"
Cohesion: 0.25
Nodes (7): BenchProgressPayload, BenchResult, ProgressTracker, Instant, Option, Self, String

### Community 53 - "TransferJournal"
Cohesion: 0.29
Nodes (6): Path, PathBuf, Self, String, Value, TransferJournal

### Community 54 - "db.py"
Cohesion: 0.40
Nodes (10): download_file_blocking(), DownloadFileResult, Option, Path, Result, String, Vec, upload_album_blocking() (+2 more)

### Community 55 - "debug_42772_deep.mjs"
Cohesion: 0.35
Nodes (10): err(), httpGet(), js(), main(), note(), openCDP(), require, shot() (+2 more)

### Community 56 - "ensure-remote.ps1"
Cohesion: 0.38
Nodes (10): Get-NodePath(), Set-Progress(), Set-Status(), Start-ViteHidden(), Test-CdpUp(), Test-TcpPort(), Test-ViteUp(), Wait-Until() (+2 more)

### Community 57 - "goto_42772.mjs"
Cohesion: 0.35
Nodes (10): err(), httpGet(), js(), main(), note(), openCDP(), require, shot() (+2 more)

### Community 58 - "goto_42772_robust.mjs"
Cohesion: 0.35
Nodes (10): err(), httpGet(), js(), main(), note(), openCDP(), require, shot() (+2 more)

### Community 59 - "frontend/e2e-cdp-smoke.mjs"
Cohesion: 0.31
Nodes (14): _media_row_marker(), forward_messages_blocking(), list_media_blocking(), list_media_blocking_topic(), ListMediaResult, media_to_row(), MediaFileRow, message_topic_id() (+6 more)

### Community 60 - "DriveToolsPanel.tsx"
Cohesion: 0.33
Nodes (8): list_topics_blocking(), ListTopicsResult, Option, Path, Result, String, Vec, TopicRow

### Community 61 - "stats_db.rs"
Cohesion: 0.11
Nodes (48): CachedCatalog, extract_zip_entry_direct(), extract_zip_entry_sparse(), get_cached_catalog(), invalidate_cached_catalog(), list_zip_sparse(), parse_central_directory_fast(), preview_zip_entry_direct() (+40 more)

### Community 62 - "session_clone.rs"
Cohesion: 0.60
Nodes (9): cleanup_ghost_session(), clear_ghost_sessions_disk(), clone_telegram_session_atomic(), ensure_ghost_session(), get_sessions_dir(), AppHandle, PathBuf, Result (+1 more)

### Community 63 - "probe_34404.cjs"
Cohesion: 0.29
Nodes (9): fs, http, main(), note(), ok(), path, sleep(), warn() (+1 more)

### Community 64 - "probe_34404_v2.cjs"
Cohesion: 0.29
Nodes (9): fs, http, main(), note(), ok(), path, sleep(), warn() (+1 more)

### Community 65 - "probe_34404_v3.cjs"
Cohesion: 0.29
Nodes (9): fs, http, main(), note(), ok(), path, sleep(), warn() (+1 more)

### Community 66 - "test_all_three_media.mjs"
Cohesion: 0.31
Nodes (9): httpGet(), js(), openCDP(), require, run(), shot(), sleep(), TARGET_MEDIAS (+1 more)

### Community 67 - "Bug Investigation: Media Studio Transfer Session"
Cohesion: 0.22
Nodes (8): Bug Investigation: Media Studio Transfer Session, Decisions, Expected behavior, Reproduction evidence, Status, Suspected files, Symptoms, Verification

### Community 68 - "Hybrid Rust–Python Architecture (AutoGram)"
Cohesion: 0.22
Nodes (8): Env, Goal, Hybrid Rust–Python Architecture (AutoGram), Layer map, Not full Grammers yet, Safety, Status (honest — hybrid Phase 6), Verification

### Community 70 - "parse_moov_internal"
Cohesion: 0.39
Nodes (8): KeyframeEntry, parse_moov_internal(), parse_mp4_keyframes(), read_boxes(), HashMap, Option, String, Vec

### Community 71 - "streaming_policy.rs"
Cohesion: 0.36
Nodes (8): buckets_monotonic_first_play(), first_play_bytes(), get_streaming_config(), over_4gb(), String, stream_window_never_exceeds_small_file(), StreamingConfig, streaming_config_for_size()

### Community 72 - "compilerOptions"
Cohesion: 0.22
Nodes (8): compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, include, vite.config.ts

### Community 73 - "AutoGram App/src-tauri/capabilities/default.json"
Cohesion: 0.15
Nodes (8): DrivePreviewModalProps, isHttpStreamUrl(), isPlayableHttpUrl(), isProgressiveStreamPath(), normalizePlayQualities(), PlayQuality, RATES, sanitizeQualityLabel()

### Community 74 - "Media Studio initial-load investigation"
Cohesion: 0.25
Nodes (7): Fix direction, Measurements (2026-07-16), Media Studio initial-load investigation, Root cause, Symptom, Verification target, Verified result (2026-07-16)

### Community 75 - "Bug Investigation: Preview Random Seek"
Cohesion: 0.25
Nodes (7): Bug Investigation: Preview Random Seek, Constraints, Evidence and root-cause hypotheses, Expected behavior, Status, Suspected files, Symptoms

### Community 76 - "Thumbnail cold-load and pagination performance"
Cohesion: 0.25
Nodes (7): Cache reset, Root causes, Status, Symptoms, Thumbnail cold-load and pagination performance, Verification, Working fix

### Community 78 - "scripts"
Cohesion: 0.25
Nodes (8): scripts, build, build:web, dev, preview, tauri, test, test:watch

### Community 79 - ".new"
Cohesion: 0.29
Nodes (6): EventEnvelope, EventEnvelope<T>, Into, Self, String, T

### Community 80 - "AutoGram Remote (CDP)"
Cohesion: 0.25
Nodes (7): AutoGram Remote (CDP), Debug Mode app, Layout (pasca cleanup), Prasyarat, Quick start, Scripts, Status

### Community 81 - "Bug Investigation: Native Account, Session, Document and Video Preview"
Cohesion: 0.29
Nodes (6): Bug Investigation: Native Account, Session, Document and Video Preview, Confirmed root causes, Fixes applied, Remaining live check, Symptoms, Verification

### Community 82 - "Session Isolation, Upload Limits, and Migration Scale"
Cohesion: 0.29
Nodes (6): 2026-07-17 - Baseline, Investigation log, Pending evidence, Safety constraints, Scope, Session Isolation, Upload Limits, and Migration Scale

### Community 83 - "Bug Investigation: Session + Stream/Buffer/Preview Conflicts"
Cohesion: 0.29
Nodes (6): Bug Investigation: Session + Stream/Buffer/Preview Conflicts, Fixes (v2.1.64), Root causes found, Status, Symptoms, Verification

### Community 84 - "Staged session bootstrap"
Cohesion: 0.29
Nodes (6): Fix in progress, Live accuracy and location focus follow-up, Root cause, Staged session bootstrap, Symptom, Verification

### Community 85 - "Bug: Video preview keeps reloading during buffer (multi-video)"
Cohesion: 0.29
Nodes (6): Bug: Video preview keeps reloading during buffer (multi-video), Fixes (v2.1.79), Follow-up (v2.1.80) — Screenshot 34.mp4 stuck 0:00 / “menunggu data stream · 7%”, Root causes, Status, Symptoms

### Community 86 - "config_normalize.rs"
Cohesion: 0.62
Nodes (6): as_bool(), as_f64(), as_i64(), normalize_job_config(), normalizes_defaults(), Value

### Community 87 - "ProgressSnapshot"
Cohesion: 0.38
Nodes (6): compute_progress(), half_done(), ProgressSnapshot, Option, String, compute_progress_rate()

### Community 88 - "input_injector.mjs"
Cohesion: 0.43
Nodes (4): click(), dragFromTo(), pointerDragKeys(), sleep()

### Community 89 - "Media count and storage accuracy investigation"
Cohesion: 0.33
Nodes (5): Fix, Media count and storage accuracy investigation, Root cause, Symptom, Verification (2026-07-16)

### Community 90 - "Buffer bar stuck + “Stream bermasalah”"
Cohesion: 0.33
Nodes (5): Buffer bar stuck + “Stream bermasalah”, Evidence (`worker/temp` + `worker/cache`), Fix (v2.1.81), Root cause, Verify

### Community 91 - "Rust + Grammers Backend (Force — no Telethon runtime)"
Cohesion: 0.33
Nodes (5): Frontend rules, Remaining work, Rust + Grammers Backend (Force — no Telethon runtime), Session files, Status

### Community 92 - "System Architecture"
Cohesion: 0.33
Nodes (5): 1. Teknologi (Tech Stack), 2. Diagram Alur (Data Flow), 3. Komponen Utama, 4. Keamanan Arsitektur, System Architecture

### Community 93 - "Web deploy vs desktop (heavy features)"
Cohesion: 0.33
Nodes (5): Runtime split, Supabase / backend, Verify, Web deploy vs desktop (heavy features), Web host build

### Community 94 - "Architecture Decision Record (ADR)"
Cohesion: 0.33
Nodes (5): ADR-001: Desktop Framework Selection, ADR-002: Pemisahan Telegram API Engine (Python Worker), ADR-003: Penyimpanan Status Migrasi (Local Database), ADR-004: Forward Mode vs Copy Mode, Architecture Decision Record (ADR)

### Community 95 - "Repository Governance"
Cohesion: 0.33
Nodes (5): 1. Single Source of Truth, 2. Hygiene & Secrets Management, 3. Merge & Branching Strategy, 4. Requirement for Code Changes, Repository Governance

### Community 96 - "Backup & Recovery Procedures"
Cohesion: 0.33
Nodes (5): 1. Resume System (Koneksi Putus / PC Mati), 2. Failed Items Recovery, 3. Ekspor Laporan dan Konfigurasi, 4. Temporary Cache Management (Pembersihan Memori), Backup & Recovery Procedures

### Community 97 - "Final Audit Report (v5.1.1)"
Cohesion: 0.33
Nodes (5): 1. Verifikasi Struktur, 2. Verifikasi Keamanan, Final Audit Report (v5.1.1), Kesimpulan, Status: LULUS (PASSED)

### Community 98 - "Development Roadmap"
Cohesion: 0.33
Nodes (5): Development Roadmap, Phase 1: Offline Desktop Foundation (Current Focus), Phase 2: Advanced Rules & Automation, Phase 3: Web Dashboard & Cloud Deployment, Phase 4: Commercialization & Multi-Tenant

### Community 99 - "Security Control Matrix"
Cohesion: 0.33
Nodes (5): 1. Perlindungan Kredensial & Sesi (Session Protection), 2. Operasional Anti-Spam (Smart Throttle), 3. Validasi Tujuan (Destination Conflict), 4. Audit Trail, Security Control Matrix

### Community 100 - "Test Strategy"
Cohesion: 0.33
Nodes (5): 1. Unit Testing, 2. Integration Testing, 3. System Testing (Migration E2E), 4. Security & Safety Testing, Test Strategy

### Community 101 - "Accounts.tsx"
Cohesion: 0.40
Nodes (5): qrcode, Accounts(), CustomCountrySelect(), safeGetCallingCode(), qrcode

### Community 102 - "VSCodeCodeViewer.tsx"
Cohesion: 0.16
Nodes (15): DriveZipBrowser(), ZipEntryTable(), ZipEntryTableProps, ZipExtractModal(), ZipExtractModalProps, ZipHeaderToolbar(), ZipHeaderToolbarProps, basenamesAt() (+7 more)

### Community 103 - "DriveTransferManager.tsx"
Cohesion: 0.40
Nodes (3): DriveTransferManager(), encoderLabel(), Props

### Community 104 - "ReUploadBatchModal.tsx"
Cohesion: 0.47
Nodes (5): formatBytes(), formatTimestamp(), GuardrailItem, Props, ReUploadBatchModal()

### Community 106 - "media_meta.rs"
Cohesion: 0.40
Nodes (4): EncodeBudgetPlan, plan_encode_budget(), Option, String

### Community 107 - "frontend/package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 109 - "ZipErrorBoundary"
Cohesion: 0.17
Nodes (3): DriveSidebarProps, DropRowProps, TELEGRAM_FOLDER_COLORS

### Community 110 - "Settings.tsx"
Cohesion: 0.36
Nodes (5): DebugSection, Settings(), PerfSection, CACHE_LIMIT_LABELS, CACHE_LIMIT_STEPS

### Community 111 - "inspect_cards.mjs"
Cohesion: 0.50
Nodes (4): httpGet(), require, run(), WebSocket

### Community 112 - "inspect_full_dom.mjs"
Cohesion: 0.50
Nodes (4): httpGet(), require, run(), WebSocket

### Community 113 - "probe_msg_73.mjs"
Cohesion: 0.50
Nodes (4): httpGetIPv6(), require, run(), WebSocket

### Community 114 - "probe_thumb_73_detail.mjs"
Cohesion: 0.50
Nodes (4): httpGetIPv6(), require, run(), WebSocket

### Community 115 - "v2.3.53 Optimasi Performa Cold Start, Speed Loading List Card & Thumbnail Bulk IDB Read, & Fix Thumbnail Dokumen/File"
Cohesion: 0.50
Nodes (4): Adopsi Strategi Performa Telegram-Drive (`thumbBatcher.ts`, `DriveExplorer.tsx`, `DriveFileCard.tsx`), Pengeliminasian Freeze Cold Start (<300ms Boot) (`SpeedTest.tsx`), Perbaikan Thumbnail Media Dokumen/File (`grammers_ops.rs`, `driveTypes.ts`), v2.3.53 Optimasi Performa Cold Start, Speed Loading List Card & Thumbnail Bulk IDB Read, & Fix Thumbnail Dokumen/File

### Community 116 - "v2.3.52 Universal Target-DC Parallel MTProto Download Pipeline & CDN Edge Routing"
Cohesion: 0.50
Nodes (4): Akselerasi Multi-Socket Paralel & Uncapped Download Speed (`grammers_ops.rs`, `grammers_media.rs`, `DrivePreviewModal.tsx`), Eliminasi Variasi Kecepatan Antar-File via Target DC Download Engine (`grammers_media.rs`), Perbaikan Kebekuan Demuxer pada Batas Buffer (*Micro-Chunk Freeze*) (`stream_server.rs`, `DrivePreviewModal.tsx`), v2.3.52 Universal Target-DC Parallel MTProto Download Pipeline & CDN Edge Routing

### Community 117 - "v2.1.73 Upload UI → Rust Orchestrator Default + Full-Rust Scaffold"
Cohesion: 0.50
Nodes (4): Catatan, Full Rust bertahap (scaffold), Upload path (UI), v2.1.73 Upload UI → Rust Orchestrator Default + Full-Rust Scaffold

### Community 118 - "v2.1.74 Grammers dual-path compile-fix + multi-layer debug logs"
Cohesion: 0.50
Nodes (4): Catatan testing, Debug mode (lengkap lintas layer), Stability (pasca migrasi), v2.1.74 Grammers dual-path compile-fix + multi-layer debug logs

### Community 119 - "v2.1.81 Stream cancel thrash + Grammers album"
Cohesion: 0.50
Nodes (4): Fixes, Migrasi Grammers, Root cause (buffer % macet + “Stream bermasalah”), v2.1.81 Stream cancel thrash + Grammers album

### Community 120 - "v2.1.78 Phase 6 — Progressive stream + thumbs + topics (Grammers)"
Cohesion: 0.50
Nodes (4): Masih Python (sengaja), Progressive stream (Rust), Thumbs + topics, v2.1.78 Phase 6 — Progressive stream + thumbs + topics (Grammers)

### Community 121 - "v5.1.1 Improvement Report"
Cohesion: 0.50
Nodes (3): Detail Peningkatan (Improvements), Ringkasan Perbaikan, v5.1.1 Improvement Report

### Community 122 - "AutoGram frontend (Tauri + React + TypeScript)"
Cohesion: 0.50
Nodes (3): AutoGram frontend (Tauri + React + TypeScript), Recommended IDE Setup, Runtime: desktop vs web

### Community 125 - "React + TypeScript + Vite"
Cohesion: 0.50
Nodes (3): Expanding the Oxlint configuration, React Compiler, React + TypeScript + Vite

### Community 128 - "v2.1.72 Phase 3 — Studio Job Queue di Rust (Python Step Upload)"
Cohesion: 0.67
Nodes (3): Catatan, Orkestrasi, v2.1.72 Phase 3 — Studio Job Queue di Rust (Python Step Upload)

### Community 129 - "v2.1.70 Proxy/VPN dari Telegram-Drive + Telethon Hybrid"
Cohesion: 0.67
Nodes (3): Catatan, Proxy & VPN Optimizer (fitur Telegram-Drive → AutoGram), v2.1.70 Proxy/VPN dari Telegram-Drive + Telethon Hybrid

### Community 130 - "v2.1.79 Fix video preview reload loop + stream hardening"
Cohesion: 0.67
Nodes (3): Catatan migrasi, Critical fix, v2.1.79 Fix video preview reload loop + stream hardening

### Community 131 - "v2.1.67 Start Video Multi-Tier + Pratinjau Dokumen/Kode Cepat"
Cohesion: 0.67
Nodes (3): Dokumen & kode, v2.1.67 Start Video Multi-Tier + Pratinjau Dokumen/Kode Cepat, Video (semua ukuran)

### Community 132 - "v2.1.77 Phase 5 — Drive dual-path list + Grammers download"
Cohesion: 0.67
Nodes (3): Grammers / full-Rust progress, Masih Python (sengaja), v2.1.77 Phase 5 — Drive dual-path list + Grammers download

### Community 133 - "v2.1.80 Video play stuck + buffer speed (34.mp4 class)"
Cohesion: 0.67
Nodes (3): Kecepatan load / buffer, Screenshot issue (buffer ada, video di 0:00), v2.1.80 Video play stuck + buffer speed (34.mp4 class)

### Community 134 - "v2.1.69 Hybrid Phase 2 — Rust Stream Server + Local Utilities"
Cohesion: 0.67
Nodes (3): Local utilities (Rust), Stream (Rust + Python companion), v2.1.69 Hybrid Phase 2 — Rust Stream Server + Local Utilities

### Community 135 - "v2.1.76 Grammers-first studio orch (honest hybrid, not full cutover)"
Cohesion: 0.67
Nodes (3): Masih Python (sengaja), Status, v2.1.76 Grammers-first studio orch (honest hybrid, not full cutover)

### Community 136 - "v2.1.75 Fix overhead looping (preview poll + session ready)"
Cohesion: 0.67
Nodes (3): Performance, Remote, v2.1.75 Fix overhead looping (preview poll + session ready)

### Community 242 - "i18next"
Cohesion: 0.20
Nodes (7): candidates, card, errors, pages, results, sessionSelect, tDrive

### Community 243 - "pdfjs-dist"
Cohesion: 0.22
Nodes (7): candidates, card, errors, pages, results, sessionSelect, tDrive

### Community 247 - "@tauri-apps/plugin-fs"
Cohesion: 0.25
Nodes (7): drivesBtn, gudang, page, photo, report, samples, t0

### Community 248 - "@tauri-apps/plugin-shell"
Cohesion: 0.21
Nodes (10): react, detectLanguage(), escapeHtml(), highlightLine(), VSCodeCodeViewer(), VSCodeCodeViewerProps, DocumentViewerProps, ZipCodePreviewModal() (+2 more)

### Community 291 - "stats_db.rs"
Cohesion: 0.42
Nodes (9): export_stats_csv(), get_statistics(), open_db(), resolve_migrator_db(), Connection, PathBuf, Result, String (+1 more)

### Community 298 - "capability.rs"
Cohesion: 0.53
Nodes (5): BackendOwner, capability_catalog(), CapabilityEntry, catalog_is_rust_first(), Vec

### Community 306 - "DeadCenterProgress"
Cohesion: 0.16
Nodes (20): buildMediaSrc(), clamp(), DEFAULT_VIDEO_QUALITIES, DrivePreviewModal(), formatQualitySize(), isHttpStreamUrl(), isPlayableHttpUrl(), isProgressiveStreamPath() (+12 more)

## Knowledge Gaps
- **674 isolated node(s):** `fs`, `command`, `name`, `private`, `version` (+669 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **148 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `TelegramIdentity` connect `drive_rpc.rs` to `frontend/src-tauri/src/lib.rs`, `grammers_media.rs`, `telegram_ops.rs`, `grammers_ops.rs`, `TgError`, `db.py`, `AutoGram App/src-tauri/tauri.conf.json`, `DrivePreviewModal.tsx`, `frontend/e2e-cdp-smoke.mjs`, `DriveToolsPanel.tsx`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `TgError` connect `tg_error.rs` to `grammers_media.rs`, `telegram_ops.rs`, `grammers_ops.rs`, `job_queue.rs`, `list_zip_sparse`, `session_rate.rs`, `TgError`, `telethon_session_import.rs`, `drive_rpc.rs`, `db.py`, `AutoGram App/src-tauri/tauri.conf.json`, `DrivePreviewModal.tsx`, `frontend/e2e-cdp-smoke.mjs`, `DriveToolsPanel.tsx`, `stats_db.rs`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `resolve_sessions_dir()` connect `grammers_ops.rs` to `stats_db.rs`, `job_queue.rs`, `automations_db.rs`, `list_zip_sparse`, `profiles_db.rs`, `jobs_db.rs`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `fs`, `command`, `name` to the rest of the system?**
  _674 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `frontend/src-tauri/src/lib.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.05378652355396541 - nodes in this community are weakly interconnected._
- **Should `app_db.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.08311688311688312 - nodes in this community are weakly interconnected._
- **Should `grammers_media.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.0998185117967332 - nodes in this community are weakly interconnected._