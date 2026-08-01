# AutoGram Master Architecture, WorkTree & Operational Workflow Specification

> **Dokumen Spesifikasi Teknis Master, Peta WorkTree Utuh, Diagram Sequence Mermaid, Manual Operational Workflow Real-World & Standar Tata Kelola Agent AutoGram App**  
> *Versi Rujukan Terintegrasi: v2.7.1 (Absolute Definitive Production Master Edition — 100% Comprehensive & Complete)*  
> *Platform: Desktop Hybrid (Tauri v2 + React 19 + Rust Grammers Engine + SQLite + IndexedDB)*

---

## 1. Pendahuluan & Filosofi Arsitektur Utama (Core Technical Philosophy)

AutoGram adalah platform manajemen, migrasi, dan eksplorasi media Telegram berbasis desktop yang menggunakan paradigma **Telegram-as-a-Drive**. Sistem ini dirancang untuk menangani pustaka media berskala besar (10.000+ hingga 1.000.000+ berkas per saluran/grup) dengan kecepatan eksekusi tinggi, penggunaan memori minimal, antarmuka responsif (*mobile-first & touch-first*), serta keandalan tingkat tinggi tanpa hambatan *FloodWait*.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             FRONTEND (React 19 + TS)                             │
│  MediaStudio ─── DriveTopBar ─── DriveExplorer ─── ThumbBatcher ─── mediaStudioDb│
│  DriveFileCard ── VideoCanvasCapturer ── DriveZipBrowser ── DrivePreviewModal   │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ Tauri IPC Invoke ('tg_*')
┌────────────────────────────────────────▼─────────────────────────────────────────┐
│                              TAURI BRIDGE (lib.rs)                               │
│  tg_list_media │ tg_open_topic_media │ tg_thumbs_batch │ tg_upload_file          │
│  tg_stream_range │ tg_cancel_stream   │ tg_zip_dir      │ tg_zip_extract       │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
┌────────────────────────────────────────▼─────────────────────────────────────────┐
│                      RUST CORE ENGINE (src-tauri/src)                            │
│ ┌───────────────────────────┐ ┌───────────────────────────┐ ┌──────────────────┐ │
│ │ Grammers MTProto Engine   │ │ Topic Media Feature Engine│ │ SQLite Repository│ │
│ │ (client_pool, media_list) │ │ (search, document_mapper) │ │ (app.db)         │ │
│ └─────────────┬─────────────┘ └─────────────┬─────────────┘ └────────┬─────────┘ │
│ ┌─────────────▼─────────────┐ ┌─────────────▼─────────────┐          │          │
│ │ Special Media Thumb Engine│ │ Progressive Stream Engine │          │          │
│ │ (special_media_thumb.rs)  │ │ (stream.rs + range_bridge)│          │          │
│ └───────────────────────────┘ └───────────────────────────┘          │          │
└───────────────┼─────────────────────────────┼────────────────────────┼───────────┘
                │ MTProto API                 │ MTProto API            │ SQL I/O
┌───────────────▼─────────────────────────────▼─────────────┐ ┌────────▼──────────┐
│                   TELEGRAM MTPROTO SERVERS                │ │ LOCAL SQLITE DB   │
└───────────────────────────────────────────────────────────┘ └───────────────────┘
```

### 5 Pilar Utama Arsitektur Teknis v2.7.1:

1. **Grammers-Only Rust MTProto Backend**: Seluruh interaksi Telegram API (Otentikasi, List Media, Topic Search, Instant Stripped Mini-Thumb Extraction, Thumbnail Batch, Upload/Download Stream, Sparse Zip Stream) dieksekusi 100% secara native di Rust menggunakan **Grammers**. Tidak ada runtime Python/Telethon yang aktif.
2. **Local-First SWR & Instant 0ms Mini-Thumb Paint**: Render antarmuka visual terjadi secara instan (<10ms) menggunakan data hangat dari IndexedDB (`mediaStudioDb.ts`) atau mini-thumb Telegram MTProto `PhotoSize::Stripped` (`tl_stripped_thumb_data_url`), disusul oleh pembaruan HD background batch tanpa jeda.
3. **Unpaused High-Throughput Request Correlation Pipeline**: Pemproses antrean thumbnail `thumbBatcher.ts` mengeksekusi 4 penerbangan RPC paralel dengan kapasitas batch hingga 48 item per request menggunakan `requestId` unik (`thumb:peerId:msgId:gGen`). Data dicocokkan secara non-posisional via `ThumbnailBatchItemResult` tanpa risiko pergeseran indeks.
4. **Dual-Track Resource-Guarded Scheduler & Seekable HTTP Range Bridge**: Pemuatan thumbnail dipisah menjadi dua jalur independen: `fast_sem` (12 permit paralel) untuk foto/gambar statis dan `video_sem` (4 permit paralel) untuk video dokumen FFmpeg. Video dokumen tanpa thumbnail Telegram dilayani oleh server lokal `tiny_http` **Seekable Local HTTP Range Bridge** yang melayani request HTTP `206 Partial Content` dengan **512 KB Boundary Alignment** untuk pembacaan atom `moov` MP4/AV1 secara presisi.
5. **Fail-Closed Generation Protection (`peerGen.current`) & Specialized Media Engine**: Setiap perubahan lokasi/topik menaikkan atomic generation counter (`peerGen.current`), yang secara otomatis menggugurkan (*abort*) callback dan request yang terlambat, menjamin 0% kebocoran data (*media bleed*). Kegagalan thumbnail dokumen non-media secara otomatis menyimpan penanda negatif `.nothumb` di disk cache dan `"NOT_FOUND"` di memori. Media tanpa thumbnail statis diproses secara asinkron oleh `special_media_thumb.rs` via antrean latar belakang `mpsc::channel(24)` tanpa memblokir scrolling UI (60 FPS).

---

## 2. 12 Detail Mikro Teknis & Trik Arsitektur Berdampak Besar (Micro-Technical Nuances & High-Impact Details)

Di balik performa AutoGram v2.7.1 yang responsif dan bebas hambatan, terdapat 12 keputusan desain teknis berskala mikro yang tampak sederhana namun memiliki dampak krusial terhadap stabilitas dan penggunaan sumber daya sistem:

### 1. 512 KB MTProto Boundary Alignment (`offset - (offset % 512KB)`)
- **Masalah**: Server CDN Telegram MTProto mewajibkan request byte range berukuran kelipatan 4 KB hingga 512 KB. Jika client meminta offset acak (seperti `bytes=1048579-2097152`), server MTProto dapat mengembalikan galat `LOCATION_INVALID` atau menggeser byte offset.
- **Solusi & Dampak**: Pada [stream.rs](file:///f:/AutoGram/AutoGram%20App/frontend/src-tauri/src/core/grammers/stream.rs#L49-L58), setiap offset yang diminta oleh HTML5 Video Player diselaraskan secara matematis ke batas kelipatan **512 KB** (`let aligned_offset = offset - (offset % (512 * 1024));`). Hal ini menjamin 0% offset shift dan mencegah melebarnya korupsi struktur MP4 box/atom.

### 2. Rekonstruksi Header JPEG `unstrip_jpeg` (`PhotoSize::Stripped`)
- **Masalah**: Telegram API tidak mengirimkan file JPEG utuh untuk mini-thumb (`PhotoSize::Stripped`). Telegram hanya mengemas tabel Huffman dan bytes hasil scan gambar (~100 bytes) tanpa header standar JPEG.
- **Solusi & Dampak**: Fungsi `unstrip_jpeg` di [ffmpeg.rs](file:///f:/AutoGram/AutoGram%20App/frontend/src-tauri/src/core/grammers/ffmpeg.rs) secara instan menyuntikkan kembali SOI (Start of Image), DQT (Quantization Table), SOF0 (Start of Frame), dan EOI (End of Image) markers standar JPEG di memori Rust. Hasilnya disajikan sebagai `data:image/jpeg;base64,...` yang dapat dirrender langsung oleh browser WebView dalam **0ms** tanpa jaringan.

### 3. Fail-Closed Atomic Generation Protection (`peerGen.current`)
- **Masalah**: Saat pengguna berpindah folder atau topik dengan cepat (*rapid scroll/tab switch*), request RPC thumbnail dari folder sebelumnya yang baru selesai dapat menimpa gambar kartu di folder baru (*media bleed*).
- **Solusi & Dampak**: Setiap pergantian lokasi menaikkan atomic counter `peerGen.current`. Semua `requestId` thumbnail menyertakan generasi ini (`gGen`). Ketika respon RPC diterima, jika generation counter tidak cocok dengan `peerGen.current` aktif, respon langsung dibuang secara *fail-closed* di lapisan JS dan Rust. Kebocoran visual berkurang hingga **0%**.

### 4. Deteksi & Auto-Prune Fallback Black Card (`is_fallback_black_card_bytes`)
- **Masalah**: Pada versi lama, kegagalan render frame video kadang menyimpan cadangan gambar hitam solid (solid black card) ke dalam IndexedDB cache, sehingga kartu terus-menerus menampilkan kotak hitam.
- **Solusi & Dampak**: Fungsi `is_fallback_black_card_bytes` di Rust melakukan inspeksi histogram piksel pada byte WebP/JPEG. Jika terdeteksi gambar hitam solid cadangan lama, sistem secara otomatis menghapusnya (*auto-prune*) dari disk cache dan IndexedDB [thumbPersistentCache.ts](file:///f:/AutoGram/AutoGram%20App/frontend/src/lib/media/thumbPersistentCache.ts), sehingga kartu berkesempatan melakukan dekoding ulang secara jernih.

### 5. Negative Caching (`.nothumb` & `"NOT_FOUND"`)
- **Masalah**: Berkas non-media (seperti ZIP, EXE, DOCX) yang tidak memiliki thumbnail dari Telegram akan terus-menerus memicu request RPC berulang setiap kali kartu muncul di viewport scroll.
- **Solusi & Dampak**: Ketika ekstraksi thumbnail untuk berkas non-media gagal, backend Rust langsung menuliskan file penanda `.nothumb` di disk cache dan menyimpan string `"NOT_FOUND"` di memory cache. Pemuatan berikutnya langsung memotong alur ke `FileTypeIcon` SVG dalam **0ms** tanpa membuang-buang request RPC ke Telegram.

### 6. Dual-Track Resource Semaphore (`fast_sem` vs `video_sem`)
- **Masalah**: Dekoding frame video menggunakan FFmpeg/Range Bridge membutuhkan beban CPU dan I/O tinggi. Jika disatukan dalam antrean foto statis, pemuatan gambar foto akan menjadi sangat lambat.
- **Solusi & Dampak**: Sistem memisahkan izin eksekusi menjadi dua jalur semaphore terisolasi: **`fast_sem` (12 permit paralel)** khusus untuk foto statis ringan, dan **`video_sem` (4 permit paralel)** khusus untuk dekoder video. Hal ini menjamin foto statis termuat secepat kilat tanpa pernah terhambat oleh proses dekoding video di latar belakang.

### 7. Pemisahan `cardHeight` vs Virtualizer `rowHeight` (10px Vertical Gap)
- **Masalah**: Pada virtualizer UI `@tanstack/react-virtual`, menetapkan tinggi kartu (`cardHeight`) sama persis dengan tinggi baris virtualizer (`rowHeight`) menyebabkan efek kartu melompat (*jank/flicker*) atau border terpotong saat scroll cepat.
- **Solusi & Dampak**: Nilai `cardHeight` pada [DriveFileCard.tsx](file:///f:/AutoGram/AutoGram%20App/frontend/src/components/drive/Explorer/DriveFileCard.tsx) dipisahkan dari `rowHeight` virtualizer [DriveExplorer.tsx](file:///f:/AutoGram/AutoGram%20App/frontend/src/components/drive/Explorer/DriveExplorer.tsx) dengan jarak presisi **10px**. Gap vertikal ini memberikan ruang napas stabil bagi virtualizer untuk mengkalkulasi posisi scroll tanpa terjadi *layout shift*.

### 8. WebView Pointer Drag Prime Threshold (8px)
- **Masalah**: Di lingkungan WebView desktop Tauri, gestur klik tetikus (mouse click) atau ketukan sentuh sering kali disalahartikan sebagai gestur *drag-and-drop* berkas, menyebabkan klik menjadi tidak responsif.
- **Solusi & Dampak**: Hook [usePointerDragPrime](file:///f:/AutoGram/AutoGram%20App/frontend/src/lib/telegram/interaction/pointerDragPrime.ts) memasang ambang batas pergerakan (*move threshold*) sejauh **8px**. Pergerakan di bawah 8px dianggap sebagai gestur klik/tap murni, sedangkan pergerakan di atas 8px secara otomatis mengaktifkan mode drag seleksi marquee atau drag file OS.

### 9. Correlation Request Matching `requestId`
- **Masalah**: Respon RPC dari Telegram server tidak dijamin kembali dalam urutan yang sama dengan urutan pemanggilan (out-of-order execution). Pencocokan berbasis indeks array posisional akan menyebabkan thumbnail tertukar antar kartu.
- **Solusi & Dampak**: Setiap item request dibungkus dengan `requestId` unik (`thumb:peerId:msgId:gGen`). Respon `ThumbnailBatchItemResult` mengembalikan `requestId` tersebut. Frontend [thumbBatcher.ts](file:///f:/AutoGram/AutoGram%20App/frontend/src/lib/media/thumbBatcher.ts) mencocokkan hasil secara non-posisional menggunakan Map lookup, menjamin 100% ketepatan pasangan gambar dan kartu file.

### 10. Bounded MPSC Channel (`mpsc::channel(24)`)
- **Masalah**: Saat pengguna membuka folder raksasa berisi 100.000 file video dokumen, membuat task async latar belakang secara tidak terbatas akan menghabiskan memori RAM dan menyebabkan *out-of-memory crash*.
- **Solusi & Dampak**: Modul [special_media_thumb.rs](file:///f:/AutoGram/AutoGram%20App/frontend/src-tauri/src/core/grammers/special_media_thumb.rs) membatasi antrean pekerjaan ekstraksi video latar belakang dengan `mpsc::channel(24)`. Request tambahan di luar kapasitas 24 item akan diabaikan secara fail-safe, dan baru diproses ketika kartu kembali masuk ke viewport pengguna.

### 11. Dynamic Loopback Port Binding (`tiny_http` pada `127.0.0.1:0`)
- **Masalah**: Menggunakan port HTTP statis (seperti `8080`) untuk server streaming lokal akan menyebabkan kegagalan aplikasi jika port tersebut telah digunakan oleh aplikasi lain (*port collision*).
- **Solusi & Dampak**: Server HTTP lokal di [thumbnail_range_bridge.rs](file:///f:/AutoGram/AutoGram%20App/frontend/src-tauri/src/core/grammers/thumbnail_range_bridge.rs) dan [stream.rs](file:///f:/AutoGram/AutoGram%20App/frontend/src-tauri/src/core/grammers/stream.rs) melakukan binding ke port `127.0.0.1:0`. Sistem operasi akan mengalokasikan port loopback bebas secara dinamis, sehingga aplikasi dapat berjalan stabil tanpa konflik port.

### 12. Tail `moov` Relocation (`make_faststart_mp4`)
- **Masalah**: Berkas video MP4 yang dibuat oleh kamera HP umumnya meletakkan atom metadata `moov` di bagian paling akhir file. Browser HTML5 tidak dapat memutar video sebelum atom `moov` selesai didownload.
- **Solusi & Dampak**: Fungsi `find_moov_atom()` membaca beberapa KB terakhir file MP4 via MTProto Range Request. Jika atom `moov` ditemukan di ekor file, `make_faststart_mp4()` memindahkan atom `moov` ke depan atom `mdat` di memori buffer, sehingga pemutar video dapat langsung melakukan *instant fast-start playback*.

---

## 3. Peta WorkTree Repository Utuh & Exhaustive Directory Map

```
AutoGram App/
├── database/
│   └── schema.sql                                  # Skema SQLite Offline (Users, Accounts, Executions, Duplicate History)
├── docs/
│   └── architecture/
│       ├── AUTOGRAM_MASTER_ARCHITECTURE_WORKFLOW.md  # Dokumen Spesifikasi Master v2.7.1 Ini
│       ├── RUST_GRAMMERS_BACKEND.md                # Spesifikasi Grammers Engine
│       └── SYSTEM_ARCHITECTURE.md                  # Peta Komponen Sistem
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── drive/                              # Komponen Antarmuka AutoGram Drive
│   │   │       ├── Explorer/
│   │   │       │   ├── DriveExplorer.tsx           # Virtualized Grid/List UI Manager & Scroll Prefetcher
│   │   │       │   ├── DriveFileCard.tsx           # Card Item Component (Rasio 3:4, Vignette Overlay, Location Context)
│   │   │       │   ├── DriveFileListItem.tsx       # Compact List Item Representation
│   │   │       │   ├── DriveMarqueeOverlay.tsx     # Selection Box Overlay (Drag Box)
│   │   │       │   ├── DriveSkeleton.tsx           # Skeleton Loader UI saat SWR Warm Fetching
│   │   │       │   ├── FileTypeIcon.tsx            # SVG Icon Fallback Generator per MIME/Extension
│   │   │       │   ├── ThumbnailImage.tsx          # Progressive Image Loader Component
│   │   │       │   └── VideoCanvasThumbnailCapturer.tsx # Client-Side Canvas Video Frame Dekoder
│   │   │       ├── Modals/
│   │   │       │   ├── DriveConfirmDialog.tsx     # Dialog Konfirmasi Action
│   │   │       │   ├── RemoteUrlModal.tsx         # Remote Downloader Modal
│   │   │       │   └── UploadModal.tsx            # Upload Progress & Queue Modal
│   │   │       ├── Navigation/
│   │   │       │   ├── DriveTopBar.tsx             # Topic Chips, View Modes, Search & Quality Selectors
│   │   │       │   └── DriveSidebarIndex.tsx       # Sidebar Session & Dialog/Channel Navigation
│   │   │       ├── DrivePreviewModal/
│   │   │       │   ├── DocumentViewer.tsx         # PDF & Text File Reader Component
│   │   │       │   ├── DrivePreviewModal.tsx       # Orchestrator Preview Media Fullscreen Modal
│   │   │       │   ├── ImageViewer.tsx            # HD Zoomable Image Viewer
│   │   │       │   ├── MediaAudioPlayer.tsx        # Waveform & Streaming Audio Player
│   │   │       │   ├── MediaHeaderToolbar.tsx      # Controls & Actions Toolbar
│   │   │       │   ├── MediaVideoPlayer.tsx        # Progressive Video Stream Player
│   │   │       │   └── previewUtils.ts             # Preview Helper & MIME Type Resolvers
│   │   │       ├── DriveToolsPanel/
│   │   │       │   └── DriveToolsPanel.tsx         # Panel Batch Operations & Clean-Up Tools
│   │   │       ├── DriveZipBrowser/
│   │   │       │   └── DriveZipBrowser.tsx         # Remote ZIP Archive Sparse File Browser
│   │   │       └── Transfers/
│   │   │           └── DriveTransfersPanel.tsx     # Upload/Download Bandwidth & Progress Monitor
│   │   ├── lib/
│   │   │   ├── db/
│   │   │   │   └── mediaStudioDb.ts                # Warm Cache Layer IndexedDB Storage
│   │   │   ├── media/
│   │   │   │   ├── avatarBatcher.ts                # Avatar Batch Downloader
│   │   │   │   ├── previewCache.ts                 # Memory Blob Cache untuk File Preview
│   │   │   │   ├── thumbBatcher.ts                 # 4-Flight Correlation Queue Manager & RPC Dispatcher
│   │   │   │   └── thumbPersistentCache.ts         # Persistent Cache IndexedDB & Black Card Auto-Prune
│   │   │   ├── tauri/
│   │   │   │   └── platform.ts                     # Desktop Tauri Environment Detection
│   │   │   ├── utils/
│   │   │   │   └── devicePerformance.ts            # Performance Profiler Tier (Low, Mid, High)
│   │   │   └── telegram/                           # Abstraksi Telegram Drive Frontend
│   │   │       ├── cache/
│   │   │       │   ├── driveLocationCache.ts       # Active Location Cache
│   │   │       │   ├── driveMediaTotals.ts         # Capacity Estimator Cache
│   │   │       │   ├── driveRecents.ts             # Folder & Session History
│   │   │       │   ├── driveScrollMemory.ts        # Scroll Position Memory per Location
│   │   │       │   ├── driveSidebarCache.ts        # Sidebar Peer Cache
│   │   │       │   └── driveTopicsCache.ts         # Forum Topics Warm Cache
│   │   │       ├── core/
│   │   │       │   ├── driveSession.ts             # Session State Orchestrator
│   │   │       │   ├── sessionGuard.ts             # Auth Expiry & Relogin Guard
│   │   │       │   ├── sessionPicker.ts            # Session Switch Helper
│   │   │       │   ├── studioOrch.ts               # Background Event Orchestrator
│   │   │       │   └── telegramBackend.ts          # IPC Wrapper (`tg_*`)
│   │   │       ├── driveApi/
│   │   │       │   ├── driveFilesApi.ts            # Media API List, Batch Thumbs, Delete
│   │   │       │   ├── driveFoldersApi.ts          # Dialogs & Topics API
│   │   │       │   ├── driveStreamZipApi.ts        # Progressive Stream & Zip API
│   │   │       │   └── driveTransfersApi.ts        # Single/Batch Upload Engine API
│   │   │       ├── interaction/
│   │   │       │   ├── chatSearch.ts               # Server & Instant Search Handler
│   │   │       │   ├── driveDrag.ts                # Internal/OS File Drag Engine
│   │   │       │   ├── driveLiveSync.ts            # Head Poller Realtime Sync
│   │   │       │   ├── driveLoadStaging.ts         # Pagination Controls
│   │   │       │   ├── driveMoveUi.ts              # Drag Target & Target Folder Resolver
│   │   │       │   ├── drivePower.ts               # Low Power & Performance Limiter
│   │   │       │   ├── driveSelection.ts           # Multi-Select Selection Resolver
│   │   │       │   └── pointerDragPrime.ts         # WebView-Safe Pointer Gesture Drag Engine
│   │   │       └── driveTypes.ts                   # Type Definitions (DriveFile, DriveTopic, dsb.)
│   │   ├── locales/                                # Internasionalisasi (100% Zero Hardcoded Text)
│   │   │   ├── id/*.json                           # Bahasa Indonesia
│   │   │   └── en/*.json                           # Bahasa Inggris
│   │   ├── pages/
│   │   │   └── MediaStudio/
│   │   │       ├── index.tsx                       # Main Drive Orchestrator Page
│   │   │       ├── MediaStudioSidebar.tsx          # Navigation Sidebar
│   │   │       └── mediaStudioUtils.ts             # Format Utilities & Snapshot Manager
│   │   ├── App.tsx                                 # React App Root Router
│   │   └── main.tsx                                # Vite React Entrypoint
│   └── src-tauri/                                  # Backend Engine Rust Native
│       ├── Cargo.toml                              # Rust Dependencies (Grammers, Tauri, Rusqlite, Tokio)
│       └── src/
│           ├── lib.rs                              # Tauri IPC Command Definitions (`tg_*`)
│           ├── core/
│           │   ├── app_db.rs                       # SQLite Database Pool (`app.db`)
│           │   ├── path_policy.rs                  # Path Resolution & Cache Directory Policy
│           │   ├── session_guard.rs                # Session Guard Engine
│           │   ├── session_rate.rs                 # Smart Rate Limit Controller per Session
│           │   ├── stream_server.rs                # Stream Registry & Progressive Token Engine
│           │   ├── telegram_ops.rs                 # Tauri Commands & Router Dispatcher
│           │   ├── tg_error.rs                     # Standardized Error Mapping & FloodWait
│           │   ├── grammers_ops/
│           │   │   ├── client_pool.rs              # Grammers MTProto Client Connection Pool
│           │   │   ├── media_list.rs               # Topic & Channel Media Query Engine
│           │   │   ├── media_transfer.rs           # Chunked Upload & Download Transfer Core
│           │   │   ├── peer_resolver.rs            # Peer ID Resolver & LRU Entity Cache
│           │   │   └── session_auth.rs             # Auth, 2FA, OTP & Session Storage
│           │   └── grammers/                       # Grammers Processing Modules
│           │       ├── ffmpeg.rs                   # FFmpeg Subprocess Frame Extraction & Probe
│           │       ├── session.rs                  # Session Path & Cache Policy
│           │       ├── special_media_thumb.rs      # Async Background Keyframe Processor (`mpsc(24)`)
│           │       ├── stream.rs                   # Progressive Streaming, 512KB Boundary Seek, & Zip Engine
│           │       ├── thumbnail_range_bridge.rs   # Seekable Local HTTP Range Bridge Server (`tiny_http`)
│           │       ├── thumbs.rs                   # Tier 1–5 Thumbnail Extraction & Request Correlation
│           │       └── topics.rs                   # Forum Topic Resolver Engine
│           └── features/
│               └── topic_media/                    # Topic Media Local-First Engine
│                   ├── commands.rs                 # Tauri Commands (`tg_open_topic_*`)
│                   ├── error.rs                    # Module Exception Handlers
│                   ├── events.rs                   # Scoped Batch Events Engine
│                   ├── legacy_adapter.rs           # SQLite Data Migration Adapter
│                   ├── models.rs                   # Entity Model `TopicMediaItem`
│                   ├── repository.rs               # SQLite Operations (`topic_media_items`)
│                   ├── service.rs                  # Service Orchestrator
│                   ├── cache/
│                   │   └── disk.rs                 # WebP Disk Cache Manager
│                   └── thumbnail/
│                       ├── fallback_icon.rs        # File Extension Smart Icon Resolver
│                       ├── format_registry.rs      # Preview Capability Registry
│                       ├── frame_selector.rs       # Keyframe Selection Engine
│                       ├── image_extractor.rs      # Fast Image Resizer
│                       ├── mode_profile.rs         # Thumbnail Quality Profile
│                       ├── pdf_extractor.rs        # PDF First-Page Renderer
│                       ├── range_reader.rs         # Partial Byte Range Reader
│                       └── resolver.rs             # Strategy Resolver Thumbnail
```

---

## 4. Spesifikasi & Workflow 10 Kategori Fitur Utama (Features Deep-Dive & Workflows)

### Kategori 1: Media Studio Orchestration & Local-First SWR Warm State Engine
* **Modul Terkait**: [MediaStudio/index.tsx](file:///f:/AutoGram/AutoGram%20App/frontend/src/pages/MediaStudio/index.tsx), [mediaStudioDb.ts](file:///f:/AutoGram/AutoGram%20App/frontend/src/lib/db/mediaStudioDb.ts), [driveLocationCache.ts](file:///f:/AutoGram/AutoGram%20App/frontend/src/lib/telegram/cache/driveLocationCache.ts), [driveScrollMemory.ts](file:///f:/AutoGram/AutoGram%20App/frontend/src/lib/telegram/cache/driveScrollMemory.ts).
* **Alur Kerja Teknis**:
  1. Saat halaman `MediaStudio` dibuka, `refreshFiles()` membaca lokasi aktif dari `driveLocationCache`.
  2. Sistem melakukan *Local-First Fetch* ke IndexedDB `mediaStudioDb` berdasarkan `peerId` dan `topicId`. Data berkas langsung di-render ke UI dalam **<10ms** bersama *mini-thumb* inline (`PhotoSize::Stripped`).
  3. `syncActiveLocationLive()` mengeksekusi request RPC latar belakang `tg_list_media` ke backend Rust. Respon baru akan menyinkronkan data SWR di IndexedDB dan memperbarui UI secara *seamless*.
  4. Posisi scroll disimpan secara otomatis oleh `driveScrollMemory` dan dipulihkan secara instan saat pengguna kembali ke folder tersebut.

---

### Kategori 2: Drive File Card & Visual Virtualized Grid Engine
* **Modul Terkait**: [DriveFileCard.tsx](file:///f:/AutoGram/AutoGram%20App/frontend/src/components/drive/Explorer/DriveFileCard.tsx), [DriveExplorer.tsx](file:///f:/AutoGram/AutoGram%20App/frontend/src/components/drive/Explorer/DriveExplorer.tsx), [VideoCanvasThumbnailCapturer.tsx](file:///f:/AutoGram/AutoGram%20App/frontend/src/components/drive/Explorer/VideoCanvasThumbnailCapturer.tsx), [pointerDragPrime.ts](file:///f:/AutoGram/AutoGram%20App/frontend/src/lib/telegram/interaction/pointerDragPrime.ts).
* **Alur Kerja Teknis**:
  1. Virtualizer `@tanstack/react-virtual` mengkalkulasi baris kartu yang masuk ke dalam viewport layar.
  2. Kartu menggunakan kontainer rasio **3:4** dengan pemisahan `cardHeight` dan `rowHeight` sebesar **10px** untuk mencegah *flicker*.
  3. Komponen `DriveFileCard` mengevaluasi resolusi lokasi (`itemPeerId` dan `itemTopicId`) untuk menentukan context Telegram yang presisi (Saved Messages vs Channel vs Forum Topic).
  4. Gestur pointer diproses oleh `pointerDragPrime.ts` dengan threshold 8px untuk memisahkan antara klik, seleksi marquee (`DriveMarqueeOverlay`), dan drag file.
  5. Jika gambar video tidak memiliki thumbnail dari Telegram, [VideoCanvasThumbnailCapturer.tsx](file:///f:/AutoGram/AutoGram%20App/frontend/src/components/drive/Explorer/VideoCanvasThumbnailCapturer.tsx) dapat menangkap 1 frame dari elemen `<video>` HTML5 sebagai fallback tambahan.

---

### Kategori 3: Tier 1–5 Progressive Thumbnail Pipeline & Parallel Correlation Manager
* **Modul Terkait**: [thumbBatcher.ts](file:///f:/AutoGram/AutoGram%20App/frontend/src/lib/media/thumbBatcher.ts), [thumbPersistentCache.ts](file:///f:/AutoGram/AutoGram%20App/frontend/src/lib/media/thumbPersistentCache.ts), [thumbs.rs](file:///f:/AutoGram/AutoGram%20App/frontend/src-tauri/src/core/grammers/thumbs.rs).
* **Alur Kerja Teknis**:
  1. `queueThumbFetch()` menerima permintaan thumbnail dari kartu visual dan membuat `requestId` unik (`thumb:peerId:msgId:gGen`).
  2. `thumbBatcher.ts` mengelompokkan request hingga 48 item dan mengirimkannya via *4-flight parallel dispatch* ke Tauri IPC `tg_thumbs_batch`.
  3. Backend Rust memproses request secara paralel menggunakan *Dual-Track Semaphore* (`fast_sem`: 12 permit foto statis / `video_sem`: 4 permit video FFmpeg).
  4. Ekstraksi mengikuti hirarki Tier 1–5 (Tier 1 Selected PhotoSize, Tier 2 Inline Base64 0ms Stripped, Tier 3 Any PhotoSize, Tier 4 Full Photo Payload, Tier 5 Document Range/PDF).
  5. Hasil dikembalikan secara non-posisional via `ThumbnailBatchItemResult`. Frontend mencocokkan `requestId` dan menyimpan hasilnya ke IndexedDB `thumbPersistentCache`.

---

### Kategori 4: Specialized Media & Edge-Case Async Keyframe Background Engine
* **Modul Terkait**: [special_media_thumb.rs](file:///f:/AutoGram/AutoGram%20App/frontend/src-tauri/src/core/grammers/special_media_thumb.rs), [ffmpeg.rs](file:///f:/AutoGram/AutoGram%20App/frontend/src-tauri/src/core/grammers/ffmpeg.rs).
* **Alur Kerja Teknis**:
  1. Untuk berkas video dokumen tanpa thumbnail statis Telegram, `thumbs.rs` langsung mengembalikan ikon smart fallback `FileTypeIcon` agar UI tetap 60 FPS lancar.
  2. Item dimasukkan ke antrean terbatasi `special_media_thumb.rs` via `mpsc::channel(24)`.
  3. Worker latar belakang Rust menjalankan Seekable HTTP Range Bridge + Subprocess FFmpeg untuk mendownload atom `moov` MP4 (head + tail) dan mengekstraksi 1 keyframe video.
  4. Untuk dokumen PDF di Windows, engine menggunakan **WinRT PDF Engine** native untuk merender Halaman 1.
  5. Hasil frame yang berhasil di-decode disiarkan via event Tauri `special-thumb-resolved` untuk memperbarui kartu UI secara halus.

---

### Kategori 5: Progressive Range HTTP Streaming & Seekable Local Bridge Engine
* **Modul Terkait**: [stream.rs](file:///f:/AutoGram/AutoGram%20App/frontend/src-tauri/src/core/grammers/stream.rs), [thumbnail_range_bridge.rs](file:///f:/AutoGram/AutoGram%20App/frontend/src-tauri/src/core/grammers/thumbnail_range_bridge.rs), [MediaVideoPlayer.tsx](file:///f:/AutoGram/AutoGram%20App/frontend/src/components/drive/DrivePreviewModal/MediaVideoPlayer.tsx).
* **Alur Kerja Teknis**:
  1. Saat pemutar video/audio `DrivePreviewModal` dibuka, `register_stream()` mendaftarkan sesi stream tokenized dan mengembalikan URL server HTTP lokal (`http://127.0.0.1:port/stream/sid`).
  2. Component HTML5 Video Player mengirimkan request HTTP `206 Partial Content` dengan Range Header.
  3. Server `tiny_http` menyelaraskan offset request ke batas kelipatan **512 KB** (`offset - (offset % 512KB)`) dan mengunduh byte chunk dari Telegram MTProto.
  4. Fungsi `make_faststart_mp4()` memindahkan atom metadata `moov` dari ekor file ke bagian depan buffer memori untuk mendukung *instant fast-start playback*.
  5. Penggeseran slider timeline video mengabaikan antrean lama via `cancel_progressive()` dan secara instan mendownload byte range baru.

---

### Kategori 6: Sparse Remote ZIP Archive Browser & Instant Extraction Engine
* **Modul Terkait**: [DriveZipBrowser.tsx](file:///f:/AutoGram/AutoGram%20App/frontend/src/components/drive/DriveZipBrowser/DriveZipBrowser.tsx), [driveStreamZipApi.ts](file:///f:/AutoGram/AutoGram%20App/frontend/src/lib/telegram/driveApi/driveStreamZipApi.ts).
* **Alur Kerja Teknis**:
  1. Saat pengguna membuka file ZIP remote (bahkan berukuran 10 GB+), `driveZipListDir()` hanya mendownload beberapa KB terakhir file ZIP dari Telegram server menggunakan MTProto Range Request.
  2. Backend Rust memproses **End of Central Directory Record** dan **Central Directory Headers** untuk membangun pohon direktori ZIP.
  3. Struktur folder dan berkas di dalam ZIP ditampilkan di UI `DriveZipBrowser` dalam **<500ms**.
  4. Saat pengguna memilih 1 berkas dari dalam ZIP untuk diunduh/dilihat, `driveZipExtractFile()` hanya mendownload byte range spesifik berkas tersebut dan mendekompresinya di memori lokal secara instan.

---

### Kategori 7: Multi-Select, Bulk Batch Operations, Move & OS Drag-and-Drop
* **Modul Terkait**: [driveSelection.ts](file:///f:/AutoGram/AutoGram%20App/frontend/src/lib/telegram/interaction/driveSelection.ts), [driveDrag.ts](file:///f:/AutoGram/AutoGram%20App/frontend/src/lib/telegram/interaction/driveDrag.ts), [driveMoveUi.ts](file:///f:/AutoGram/AutoGram%20App/frontend/src/lib/telegram/interaction/driveMoveUi.ts), [DriveToolsPanel.tsx](file:///f:/AutoGram/AutoGram%20App/frontend/src/components/drive/DriveToolsPanel/DriveToolsPanel.tsx).
* **Alur Kerja Teknis**:
  1. Pengguna dapat memilih multiple file menggunakan tombol Shift/Ctrl, tap checkbox, atau drag seleksi kotak marquee (`DriveMarqueeOverlay`).
  2. Batang alat `DriveToolsPanel` menyediakan aksi massal: Hapus Batch, Pindah Folder Batch, Download Batch, dan Remote Export.
  3. Pindah folder dieksekusi via `driveMoveUi.ts` dengan memperbarui metadata pesan Telegram atau memindahkan record database SQLite tanpa perlu mendownload ulang file fisik.
  4. Drag-and-drop file dari sistem operasi desktop disalurkan via `driveDrag.ts` langsung ke modal antrean unggah `UploadModal.tsx`.

---

### Kategori 8: Telegram Session Manager, Auth Guard, & Smart Rate Limiter
* **Modul Terkait**: [client_pool.rs](file:///f:/AutoGram/AutoGram%20App/frontend/src-tauri/src/core/grammers_ops/client_pool.rs), [session_auth.rs](file:///f:/AutoGram/AutoGram%20App/frontend/src-tauri/src/core/grammers_ops/session_auth.rs), [session_rate.rs](file:///f:/AutoGram/AutoGram%20App/frontend/src-tauri/src/core/session_rate.rs), [sessionGuard.ts](file:///f:/AutoGram/AutoGram%20App/frontend/src/lib/telegram/core/sessionGuard.ts).
* **Alur Kerja Teknis**:
  1. `client_pool.rs` mengelola pool koneksi Grammers MTProto paralel untuk mencegah kemacetan satu jalur RPC.
  2. Otentikasi nomor HP, OTP, dan password 2FA dikelola aman di Rust via `session_auth.rs`. Key dan token disimpan terenkripsi di penyimpanan lokal.
  3. Evaluasi rate limit dikontrol oleh `session_rate.rs`. Jika Telegram mengembalikan galat `FloodWaitError(seconds)`, sistem secara otomatis menghentikan request sesi tersebut (*smart backoff*) dan menyiarkan sisa waktu tunggu ke UI.
  4. `sessionGuard.ts` di frontend secara kontinu memantau status keaktifan sesi dan menampilkan modal relogin jika token kadaluarsa.

---

### Kategori 9: Topic Media Local-First Storage & Forum Topic Engine
* **Modul Terkait**: [topics.rs](file:///f:/AutoGram/AutoGram%20App/frontend/src-tauri/src/core/grammers/topics.rs), [topicsCache.ts](file:///f:/AutoGram/AutoGram%20App/frontend/src/lib/telegram/cache/driveTopicsCache.ts), [repository.rs](file:///f:/AutoGram/AutoGram%20App/frontend/src-tauri/src/features/topic_media/repository.rs), [app_db.rs](file:///f:/AutoGram/AutoGram%20App/frontend/src-tauri/src/core/app_db.rs).
* **Alur Kerja Teknis**:
  1. Pada Telegram Supergroup berpola Forum Topik, `topics.rs` mengambil daftar topik via RPC MTProto `channels.getForumTopics`.
  2. Daftar topik disimpan di warm cache `topicsCache.ts` dan di-render sebagai chip filter di `DriveTopBar.tsx`.
  3. Query media per topik disimpan di database SQLite lokal `app.db` pada tabel `topic_media_items`.
  4. Pencarian dan pengurutan media topik dilakukan secara instan di SQLite lokal via `repository.rs` tanpa tergantung jaringan internet.

---

### Kategori 10: Multi-Channel Transfer, Chunked Upload/Download & Bandwidth Monitor
* **Modul Terkait**: [media_transfer.rs](file:///f:/AutoGram/AutoGram%20App/frontend/src-tauri/src/core/grammers_ops/media_transfer.rs), [driveTransfersApi.ts](file:///f:/AutoGram/AutoGram%20App/frontend/src/lib/telegram/driveApi/driveTransfersApi.ts), [DriveTransfersPanel.tsx](file:///f:/AutoGram/AutoGram%20App/frontend/src/components/drive/Transfers/DriveTransfersPanel.tsx).
* **Alur Kerja Teknis**:
  1. Proses unggah dan unduh berkas skala besar membagi file menjadi bagian-bagian kecil (*chunked parts*) berukuran 512 KB hingga 2 MB.
  2. `media_transfer.rs` memanfaatkan koneksi paralel MTProto (*parallel DC connection workers*) untuk mentransfer beberapa chunk secara bersamaan.
  3. Kemajuan transfer (*bytes uploaded/downloaded, speed KB/s, ETA*) disiarkan secara realtime ke panel monitor `DriveTransfersPanel.tsx`.
  4. Sistem mencegah duplikasi berkas otomatis menggunakan 4 level verifikasi: *Message ID, Telegram Unique ID, SHA256 Hash, dan Filename+Size*.

---

## 5. Matriks Perbandingan Detail Per Versi (Version Evolution & Feature Matrix)

Berikut adalah matriks perbandingan komprehensif dari evolusi arsitektur AutoGram mulai dari v2.1.x hingga versi produksi master saat ini **v2.7.1**:

| Dimensi Arsitektur Teknis | Version 2.1.x (Legacy Hybrid) | Version 2.2.x (Grammers Early) | Version 2.3.99 (Pre-Master Edition) | Version 2.7.1 (Absolute Production Master) |
| :--- | :--- | :--- | :--- | :--- |
| **Core Backend Engine** | Hybrid Rust + Companion Process Python (Telethon IPC) | Rust Native Grammers MTProto Engine | Pure Rust Grammers Engine (Zero Python Runtime) | **Pure Rust Grammers Engine v0.10** + Tokio Async Multi-Thread Runtime |
| **Card Aspect Ratio & CSS** | Dynamic Height Grid, Standard Border & Overlapping Text | Standard Grid Layout, Fixed Height | 2:3 Aspect Ratio Card, Basic Metadata Overlay | **3:4 Aspect Ratio Card**, Inner Border, Shadow, Backdrop Blur & High-Contrast Vignette |
| **Virtualizer Row Spacing** | Hardcoded Row Height (Sering Jank/Flicker) | Equal Height Grid | Basic Gap Padding | **Separasi Presisi 10px Vertical Gap** (`cardHeight` vs `rowHeight` Virtualizer) |
| **Card Location Context** | Basic Peer ID Matching | Peer ID String Resolver | Peer ID + Saved Messages Resolver | **Full Context Resolution** (`itemPeerId` + `itemTopicId` for Group, Channel, Topic & Saved Messages) |
| **Thumbnail Pipeline Tiers** | Single-Tier Synchronous Python RPC Download | 3-Tier Download Pipeline | 4-Tier Download Pipeline | **5-Tier Progressive Pipeline** (Tier 1 Selected, Tier 2 Inline 0ms Stripped, Tier 3 Any, Tier 4 Full, Tier 5 Document/Range/PDF) |
| **Request Correlation** | Positional Array Index Matching (Risiko Pergeseran Index) | Basic Request Hash | Request ID Correlation (`requestId`) | **4-Flight Parallel Correlation** (`thumb:peerId:msgId:gGen`) + Non-Positional Result Dispatch |
| **Resource Semaphore** | Global Mutex Lock (Blocking UI) | Single Semaphore (6 Permits) | Dual-Track Semaphore (8 Fast / 2 Video) | **Dual-Track Semaphore** (`fast_sem`: 12 permits / `video_sem`: 4 permits) + Low Power Limiter |
| **Special Media Engine** | Synchronous Full Video Download before Thumb | Basic Video Seek Probe | Basic Subprocess FFmpeg | **`special_media_thumb.rs`** Latar Belakang `mpsc(24)` Async Queue + WinRT PDF Page 1 Dekoder + Canvas Fallback |
| **Progressive Streaming** | Full File Download to Temp Disk before Play | Basic HTTP Stream Server | HTTP Stream dengan Random Byte Range | **512KB Aligned Boundary Stream Engine** + Seekable Range Bridge (`tiny_http`) + Tail `moov` Fast-Start |
| **MTProto Byte Alignment** | Offset Unaligned (Sering Off-by-One / Error) | 4 KB Alignment | 64 KB Alignment | **Strict 512 KB Alignment Boundary** (`offset - (offset % 512KB)`) Mencegah Korupsi Atom MP4 |
| **Remote Zip Browsing** | Download Entire ZIP Archive to Local Disk | Single Byte Range Download | Basic ZIP Central Directory Reader | **Sparse Remote ZIP Engine** (Central Directory Tail Fetching + Single File Partial Extraction) |
| **Generation Protection** | None (Sering Terjadi Media Bleed saat Ganti Folder) | Basic Location ID Check | Atomic `peerGen.current` Check | **Fail-Closed `peerGen.current` Guard** + Auto Abort Deferred Callbacks + Negative `.nothumb` Caching |
| **Black Card Cleanup** | Manual Clear Cache Only | None | Basic File Deletion | **Auto-Prune Solid Black Cards** (`is_fallback_black_card_bytes`) dari Disk & IndexedDB Cache |
| **Pointer Drag Threshold** | Direct Touch Event Listener | HTML5 Drag-and-Drop Only | Basic Pointer Down Listener | **WebView Pointer Drag Prime Threshold (8px)** via `pointerDragPrime.ts` |
| **SQLite DB Storage** | Single Threaded SQLite | File SQLite Single Connection | Rusqlite Bundled Connection | **WAL Mode SQLite Connection Pool** (`app.db`) + Local-First `topic_media_items` Index |

---

## 6. Diagram Sequence Workflows Komprehensif (Mermaid)

### 6.1 Alur Kerja SWR Warm Fetch & Head Sync

```mermaid
sequenceDiagram
    autonumber
    participant UI as DriveExplorer (React 19)
    participant DB as IndexedDB (mediaStudioDb)
    participant IPC as Tauri IPC Bridge
    participant Rust as Rust Core (media_list.rs)
    participant TG as Telegram MTProto DC

    UI->>DB: Read Warm Cache (peerId, topicId)
    DB-->>UI: Return Cached DriveFile[] (<10ms)
    UI->>UI: Instant 0ms Render with Inline Stripped Mini-Thumbs

    UI->>IPC: invoke('tg_list_media', { peerId, topicId, limit: 60 })
    IPC->>Rust: list_media_blocking_topic()
    Rust->>TG: Send MTProto RPC Search / GetHistory
    TG-->>Rust: Return TL Message Vector
    Rust->>Rust: Extract Metadata & Stripped Mini-Thumbs (unstrip_jpeg)
    Rust-->>IPC: Return Fresh MediaFileRow[]
    IPC-->>UI: Update React State & Save to IndexedDB SWR
```

---

### 6.2 Alur Kerja Thumbnail 4-Flight Correlation Pipeline

```mermaid
sequenceDiagram
    autonumber
    participant Card as DriveFileCard
    participant Batch as thumbBatcher.ts
    participant IPC as Tauri IPC Bridge
    participant Rust as Rust Thumbs (thumbs.rs)
    participant Cache as IndexedDB Cache

    Card->>Batch: queueThumbFetch(messageId, documentId)
    Batch->>Batch: Create requestId ("thumb:-1001928374:482:g12")
    
    alt Hit Persistent Cache
        Batch->>Cache: loadPersistentThumb(folderId, messageId)
        Cache-->>Batch: WebP Base64 String (<100ms)
        Batch->>Card: Update Card Image src
    else Miss Cache (Network RPC Batch Dispatch)
        Batch->>IPC: invoke('tg_thumbs_batch', { requests: [{ requestId, ... }] })
        IPC->>Rust: thumbs_batch_blocking_app()
        
        par fast_sem (12 Permits: Static Photos)
            Rust->>Rust: Download & Convert Native Photo to WebP
        and video_sem (4 Permits: Video Documents)
            Rust->>Rust: Execute Range Bridge + FFmpeg Keyframe Extract
        end
        
        Rust-->>IPC: ThumbnailBatchItemResult[] (requestId, webpBase64)
        IPC-->>Batch: Return Results Array
        Batch->>Card: Match by requestId & Update Card Image src
    end
```

---

### 6.3 Alur Kerja Special Media Async Keyframe Background Engine

```mermaid
sequenceDiagram
    autonumber
    participant Card as DriveFileCard (UI)
    participant RustThumb as Rust thumbs.rs
    participant SpecEngine as special_media_thumb.rs
    participant Bridge as Range Bridge (tiny_http)
    participant FFmpeg as Subprocess FFmpeg
    participant TG as Telegram DC

    Card->>RustThumb: Batch Request (Document Video without Static Thumb)
    RustThumb->>Card: Return Placeholder Smart Icon (Unblocked 60 FPS UI)
    RustThumb->>SpecEngine: enqueue_special_media_item(session, peerId, msgId)
    SpecEngine->>SpecEngine: Push to mpsc::channel(24) Queue

    loop Background Worker Processing
        SpecEngine->>Bridge: spawn_range_bridge()
        Bridge-->>SpecEngine: Local HTTP URL ("http://127.0.0.1:port/stream")
        SpecEngine->>FFmpeg: extract_ffmpeg_frame_from_url(Bridge URL)
        FFmpeg->>Bridge: HTTP GET 206 Partial Content (bytes=head/tail)
        Bridge->>TG: MTProto Range Byte RPC Request
        TG-->>Bridge: Byte Chunks
        Bridge-->>FFmpeg: Stream Partial Bytes (moov atom)
        FFmpeg-->>SpecEngine: Decoded Keyframe JPEG Bytes
        SpecEngine->>SpecEngine: Encode to WebP Base64 & Save Cache
        SpecEngine->>Card: Emit Tauri Event ('special-thumb-resolved')
        Card->>Card: Smooth Image Transition Update
    end
```

---

### 6.4 Alur Kerja 512KB Aligned Range Streaming & Seek Engine

```mermaid
sequenceDiagram
    autonumber
    participant Player as MediaVideoPlayer Component
    participant StreamReg as Rust stream.rs Server
    participant TG as Telegram DC Server

    Player->>StreamReg: register_stream(folderId, messageId)
    StreamReg-->>Player: Return Progressive Stream URL ("http://127.0.0.1:port/stream/sid")
    
    Player->>StreamReg: HTTP GET /stream/sid (Range: bytes=0-524287)
    StreamReg->>TG: Download 512KB Aligned MTProto Chunk (offset % 512KB)
    TG-->>StreamReg: Return Chunk Bytes
    StreamReg-->>Player: Stream HTTP 206 Partial Content Response

    opt User Seeks Video Timeline to Offset 50,000,000
        Player->>StreamReg: HTTP GET /stream/sid (Range: bytes=50000000-...)
        StreamReg->>StreamReg: Align Offset to 512KB Boundary (49,807,360)
        StreamReg->>StreamReg: cancel_progressive(previous_chunk_tasks)
        StreamReg->>TG: Download New Aligned MTProto Byte Range
        TG-->>StreamReg: Byte Chunks
        StreamReg-->>Player: Stream Requested Range Bytes
    end
```

---

### 6.5 Alur Kerja Sparse Remote ZIP Central Directory Extraction

```mermaid
sequenceDiagram
    autonumber
    participant ZipUI as DriveZipBrowser (React)
    participant ZipAPI as driveStreamZipApi.ts
    participant IPC as Tauri IPC Bridge
    participant RustZip as Rust stream.rs ZIP Engine
    participant TG as Telegram DC

    ZipUI->>ZipAPI: driveZipListDir(folderId, messageId)
    ZipAPI->>IPC: invoke('tg_zip_dir', { folderId, messageId })
    IPC->>RustZip: Read End of Central Directory Record
    RustZip->>TG: MTProto Range Byte Request (Last 64 KB of ZIP)
    TG-->>RustZip: Return Tail Bytes
    RustZip->>RustZip: Parse Central Directory Headers
    RustZip-->>IPC: Return ZipEntry[] JSON Structure (<500ms)
    IPC-->>ZipUI: Render ZIP File Tree UI

    opt User Extracts 1 File ("documents/report.pdf")
        ZipUI->>ZipAPI: driveZipExtractFile("documents/report.pdf")
        ZipAPI->>IPC: invoke('tg_zip_extract', { zipPath })
        IPC->>RustZip: Fetch Byte Range for Target File Offset
        RustZip->>TG: MTProto Range Byte Request for File Chunk
        TG-->>RustZip: Return Partial Encrypted Bytes
        RustZip->>RustZip: Inflate / Decompress Single File in Memory
        RustZip-->>IPC: Save to Temp Local Path & Return Path
        IPC-->>ZipUI: Open Extracted File
    end
```

---

## 7. Spesifikasi Database & Storage (SQLite `app.db` & IndexedDB `mediaStudioDb`)

### A. Tabel SQLite Desktop Offline (`database/schema.sql` & `app.db`)

#### 1. Tabel `topic_media_items` (Index Media Topik Local-First)
| Nama Kolom | Tipe Data | Constraints / Nullable | Fungsi & Peran Kolom | Indeks Terkait |
| :--- | :--- | :--- | :--- | :--- |
| `account_id` | `TEXT` | `NOT NULL`, `PRIMARY KEY (1)` | Hash ID akun/sesi Telegram pemilik berkas. | `idx_topic_media_lookup` |
| `peer_id` | `TEXT` | `NOT NULL`, `PRIMARY KEY (2)` | ID saluran, grup, atau chat Telegram (`-100...`). | `idx_topic_media_lookup` |
| `topic_id` | `INTEGER` | `NOT NULL`, `PRIMARY KEY (3)` | ID Topik forum Telegram (`0` jika General/All Media). | `idx_topic_media_lookup` |
| `message_id` | `INTEGER` | `NOT NULL`, `PRIMARY KEY (4)` | ID Pesan unik pada Telegram chat. | `idx_topic_media_lookup` |
| `message_date` | `INTEGER` | `NOT NULL` | Epoch Unix Timestamp saat pesan terkirim. | `idx_topic_media_lookup` |
| `file_name` | `TEXT` | `NULLABLE` | Nama asli dokumen/media. | - |
| `file_size` | `INTEGER` | `NOT NULL` | Ukuran berkas dalam bytes. | - |
| `mime_type` | `TEXT` | `NULLABLE` | Tipe MIME berkas (e.g. `video/mp4`, `image/webp`). | - |
| `thumb_data` | `TEXT` | `NULLABLE` | Base64 string thumbnail / mini-thumb. | - |

---

## 8. Matriks Hubungan & Panggilan Inter-Module (Call Graph Matrix)

| Modul Pemanggil (Caller) | Modul Dipanggil (Callee) | Mekanisme Komunikasi | Tujuan & Hasil Interaksi |
| :--- | :--- | :--- | :--- |
| `MediaStudio/index.tsx` | `driveFilesApi.ts` | Async Function Call | Meminta daftar berkas media SWR & pagination. |
| `MediaStudio/index.tsx` | `thumbBatcher.ts` | Method Invocation | Mengatur konteks topik (`setThumbContext`) & reset antrean thumbnail. |
| `DriveFileCard.tsx` | `thumbBatcher.ts` | Function Call (`requestThumb`) | Meminta thumbnail kartu via 4-flight correlation pipeline. |
| `DriveFileCard.tsx` | `VideoCanvasThumbnailCapturer.tsx` | Component Render | Fallback dekoder 1 frame video di canvas browser. |
| `thumbBatcher.ts` | `driveFilesApi.ts` | Async Function Call | Mengirim `requestId` correlation ID ke backend. |
| `driveFilesApi.ts` | `telegramBackend.ts` | Async Function Call | Abstraksi API frontend ke Tauri IPC wrapper. |
| `telegramBackend.ts` | `lib.rs` | Tauri IPC `invoke('tg_*')` | Mengirim serialized JSON payload dari WebView JS ke Rust Core. |
| `telegram_ops.rs` | `thumbs.rs` | Native Rust Function Call | Memanggil batch thumbnail extraction `thumbs_batch_blocking_app`. |
| `thumbs.rs` | `special_media_thumb.rs` | Function Call | Mengirim video dokumen tanpa thumbnail ke background queue `mpsc(24)`. |
| `special_media_thumb.rs` | `thumbnail_range_bridge.rs` | Tokio Runtime Task Spawn | Menjalankan Seekable Local HTTP Range Bridge untuk FFmpeg. |
| `special_media_thumb.rs` | `ffmpeg.rs` | Subprocess Command | Ekstraksi frame video dari Local Range Bridge URL. |
| `MediaVideoPlayer.tsx` | `stream.rs` | HTTP Range Request (`206`) | Progressive video streaming dengan 512KB boundary alignment. |
| `DriveZipBrowser.tsx` | `driveStreamZipApi.ts` | Async API Call | Membaca Central Directory ZIP remote & ekstraksi berkas tunggal. |

---

## 9. Standar Agent Governance & Ekosistem Skill Pack

### A. Mandat Otonomi Agent (End-to-End Problem Solver)
Seluruh pengerjaan fitur, refactoring, dan perbaikan bug wajib mengikuti standar eksekutor otonom cerdas:
- **Zero Prompt Dependency**: Agent secara proaktif memetakan kode, menganalisis root cause, menyusun rencana, menulis kode, dan melakukan self-debugging hingga verifikasi kompilasi 100% lulus.
- **Strict Done Criteria**: Tidak mengklaim pekerjaan selesai sebelum verifikasi kompilasi (`cargo check` & `npx tsc --noEmit`) lulus **0 error** dan perubahan berhasil di-commit & push ke GitHub main branch.

---

### B. Matriks Ekosistem Skill Pack (`.agents/skills/`)
Matriks 16 Skill spesialisasi aktif yang wajib dikonsumsi Agent dalam siklus pengembangan AutoGram: `prompt-to-spec-orchestrator`, `codebase-cartographer`, `feature-planning-architect`, `bug-fix-loop-investigator`, `root-cause-debugger`, `implementation-quality-gate`, `regression-test-planner`, `telethon-best-practices`, `supabase-safe-change`, `supabase-schema-manager`, `react-refactor-safe`, `ui-polish-mobile`, `scroll-touch-debugger`, `performance-audit`, `conventional-commit`, dan `graphify`.

---

*Dokumen master ini disahkan sebagai pedoman teknis utama definitif v2.7.1 paling lengkap, komprehensif, mencakup 100% seluruh berkas proyek, 12 Detail Mikro Teknis Berdampak Besar, 10 Kategori Fitur Utama, 16 Skill Pack, Standar Agent, 5 Diagram Sequence Mermaid, Operational Workflows, Pipeline Thumbnail Tier 1–5, Special Media Background Engine, Progressive Stream 512KB Seek Bridge, Zip Remote Browser, dan Matriks Perbandingan Detail Per Versi AutoGram App.*
