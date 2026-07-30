# AutoGram Master Architecture, Workflow & System Component Specification

> **Dokumen Spesifikasi Utama & Manual Arsitektur Sistem AutoGram**  
> *Versi Rujukan Terintegrasi: v2.3.87*  
> *Platform: Desktop Hybrid (Tauri + React + Rust Grammers Engine + SQLite)*

---

## 1. Ikhtisar Sistem & Arsitektur Utama

AutoGram adalah platform manajemen, migrasi, dan eksplorasi media Telegram berbasis desktop yang menggunakan paradigma **Telegram-as-a-Drive**. Sistem ini dirancang untuk kecepatan tinggi, konsumsi memori efisien, penanganan antarmuka responsif (*mobile-first & touch-first*), serta keandalan tingkat tinggi bebas hambatan *FloodWait*.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             FRONTEND (React 18 + TS)                             │
│  MediaStudio ─── DriveTopBar ─── DriveExplorer ─── ThumbBatcher ─── mediaStudioDb│
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ Tauri IPC (invoke)
┌────────────────────────────────────────▼─────────────────────────────────────────┐
│                              TAURI BRIDGE (lib.rs)                               │
│  tg_list_media │ tg_open_topic_media │ tg_thumbs_batch │ tg_upload_file          │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
┌────────────────────────────────────────▼─────────────────────────────────────────┐
│                      RUST CORE ENGINE (src-tauri/src)                            │
│ ┌───────────────────────────┐ ┌───────────────────────────┐ ┌──────────────────┐ │
│ │ Grammers MTProto Engine   │ │ Topic Media Feature Engine│ │ SQLite Repository│ │
│ │ (client_pool, media_list) │ │ (search, document_mapper) │ │ (topic_media.db) │ │
│ └─────────────┬─────────────┘ └─────────────┬─────────────┘ └────────┬─────────┘ │
└───────────────┼─────────────────────────────┼────────────────────────┼───────────┘
                │ MTProto API                 │ MTProto API            │ SQL I/O
┌───────────────▼─────────────────────────────▼─────────────┐ ┌────────▼──────────┐
│                   TELEGRAM MTPROTO SERVERS                │ │ LOCAL SQLITE DB   │
└───────────────────────────────────────────────────────────┘ └───────────────────┘
```

### Pilar Utama Arsitektur:
1. **Grammers-Only Rust MTProto Backend**: Seluruh interaksi dengan Telegram API (Auth, List Media, Topic Search, Thumbnail Batch, Upload/Download, Zip Stream) ditangani 100% secara native di Rust menggunakan **Grammers**. Tidak ada runtime Python/Telethon yang aktif.
2. **Local-First Stale-While-Revalidate (SWR) Cache**: Menampilkan data visual instan (<10ms) dari IndexedDB lokal (`mediaStudioDb.ts`) atau SQLite (`topic_media.db`), kemudian melakukan sinkronisasi latar belakang secara silent dengan server Telegram.
3. **Server-Side MTProto Topic Search (`top_msg_id`)**: Pemfilteran topik pada supergroup Telegram dilakukan secara langsung di server Telegram via `messages.search` berparameter `top_msg_id`, menghasilkan waktu respons <50ms tanpa pemindaian pesan sekensial.
4. **Proactive Streaming & Dynamic Virtualization**: Antarmuka `DriveExplorer` menggunakan virtualisasi baris responsif dengan pemicu prefetch proaktif (40% sebelum dasar grid), mengeliminasi *loading spinner* dan penundaan scroll.

---

## 2. Struktur Direktori Proyek Utuh

```
AutoGram App/
├── database/
│   └── schema.sql                          # Skema tabel SQLite offline (Fase 1) & Cloud (Fase 2)
├── docs/
│   └── architecture/
│       ├── AUTOGRAM_MASTER_ARCHITECTURE_WORKFLOW.md  # Dokumen Utama Ini
│       ├── RUST_GRAMMERS_BACKEND.md        # Spesifikasi Engine Rust Grammers
│       └── SYSTEM_ARCHITECTURE.md          # Peta Komponen Sistem
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── drive/                      # Komponen UI AutoGram Drive
│   │   │       ├── Explorer/
│   │   │       │   └── DriveExplorer.tsx   # File Manager Grid/List Virtualized UI
│   │   │       ├── Modals/                 # Modal ZipBrowser, Upload, RemoteUrl, Confirm
│   │   │       ├── Navigation/
│   │   │       │   ├── DriveTopBar.tsx     # Filter Chip Topik, Mode Tampilan, Search, Sort
│   │   │       │   └── DriveSidebarIndex.tsx# Navigasi Chat, Folder, & Session Picker
│   │   │       └── Zip/
│   │   │           └── DriveZipBrowser.tsx # Penjelajah Berkas Kompresi Zip Remote
│   │   ├── lib/
│   │   │   ├── db/
│   │   │   │   └── mediaStudioDb.ts        # Warm Cache Layer IndexedDB
│   │   │   ├── media/
│   │   │   │   ├── thumbBatcher.ts         # Pengelola Antrean Batch Thumbnail WebP
│   │   │   │   └── avatarBatcher.ts        # Batching Foto Profil Sidebar
│   │   │   ├── tauri/
│   │   │   │   └── platform.ts             # Deteksi Runtime Desktop Tauri
│   │   │   └── telegram/                   # Abstraksi Telegram Drive Frontend
│   │   │       ├── core/
│   │   │       │   └── telegramBackend.ts  # Bridge Tauri IPC Invoke (`tg_*`)
│   │   │       ├── driveApi/
│   │   │       │   ├── driveFilesApi.ts    # API List, Batch Thumbs, Delete, Move
│   │   │       │   └── driveApiUtils.ts    # Kredensial, Page Limits, Identity Helper
│   │   │       ├── interaction/
│   │   │       │   ├── driveLoadStaging.ts # Batas Staged Pagination & Page Sizes
│   │   │       │   └── driveLiveSync.ts    # Sinkronisasi Realtime Head Server
│   │   │       └── driveTypes.ts           # Type Definition DriveFile, DriveTopic, dsb.
│   │   ├── pages/
│   │   │   └── MediaStudio/
│   │   │       ├── index.tsx               # Orchestrator Halaman Utama AutoGram Drive
│   │   │       ├── MediaStudioSidebar.tsx  # Sidebar Sesi & Topik
│   │   │       └── mediaStudioUtils.ts     # Format Bytes, Sorting, & Snapshot Storage
│   │   ├── locales/                        # Internasionalisasi (100% Zero Hardcoded Text)
│   │   │   ├── id/*.json                   # Bahasa Indonesia
│   │   │   └── en/*.json                   # Bahasa Inggris
│   │   ├── App.tsx                         # Root Router React
│   │   └── main.tsx                        # Entrypoint React Vite
│   └── src-tauri/                          # Backend Engine Rust Native
│       ├── Cargo.toml                      # Dependensi Rust (Grammers, Tauri, Rusqlite, Tokio)
│       └── src/
│           ├── lib.rs                      # Registrasi Tauri Commands (`tg_*`)
│           ├── core/
│           │   ├── telegram_ops.rs         # Handler Tauri Commands & Sync Routing
│           │   ├── tg_error.rs             # Pemetaan Error Standard & FloodWait
│           │   ├── grammers_ops/
│           │   │   ├── client_pool.rs      # Pool Koneksi Grammers MTProto
│           │   │   ├── media_list.rs       # Server Search & List Media Blocking
│           │   │   ├── media_transfer.rs   # Core Upload & Download Engine
│           │   │   ├── peer_resolver.rs    # Resolver Peer ID & LRU Peer Cache
│           │   │   └── session_auth.rs     # Login, 2FA, OTP, & Sesi Key Storage
│           │   └── grammers/               # Handler Thumbnail, Stream, & Sparse Zip
│           └── features/
│               └── topic_media/            # Modul Khusus Topik Media Local-First
│                   ├── models.rs           # Entity Data TopicMediaItem
│                   ├── repository.rs       # SQLite Storage Operations
│                   ├── service.rs          # Orchestrator Layanan Topik Media
│                   ├── commands.rs         # Tauri Commands Topic Media (`tg_open_topic_*`)
│                   ├── mtproto/
│                   │   ├── search.rs       # MTProto Search `top_msg_id`
│                   │   └── document_mapper.rs # Mapper Message TL ke Domain Model
│                   └── scheduler/
│                       └── flood_wait.rs   # FloodWait Gate Controller Global
├── CHANGELOG.md                            # Catatan Perubahan Versi
└── VERSION.md                              # Versi Rilis Aplikasi Aktif
```

---

## 3. Komponen Utama & Fungsi Detail Setiap File

### A. Lapisan Frontend (UI & State Layer)

| Nama File | Lokasi | Fungsi & Cara Kerja Utama |
| :--- | :--- | :--- |
| `MediaStudio/index.tsx` | `frontend/src/pages/MediaStudio/` | **Pusat Navigasi & Modul Utama**: Mengelola state global Drive (`files`, `loadingFiles`, `topicFilter`, `sortMode`, `selectedIds`). Menjadwalkan SWR cache, live sync, serta mengoordinasikan `DriveExplorer` dengan `MediaStudioSidebar`. |
| `DriveExplorer.tsx` | `frontend/src/components/drive/Explorer/` | **Manajer Berkas UI (Grid/List)**: Menyajikan daftar file menggunakan virtualisasi baris responsif. Menangani drag-and-drop file internal/OS, seleksi marquee kotak, context menu klik kanan, serta memicu `onLoadMore` secara proaktif saat pengguna scroll mendekati dasar grid. |
| `DriveTopBar.tsx` | `frontend/src/components/drive/Navigation/` | **Bar Navigasi & Filter Topik**: Menyajikan filter chip topik forum (`All Media`, `General`, `AI`, dll.), tombol pencarian instan, filter jenis media (`Images`, `Videos`, `Documents`), switch mode tampilan (Grid/List), dan switch kualitas thumbnail (`Saver`, `Balanced`, `Sharp`). |
| `MediaStudioSidebar.tsx` | `frontend/src/pages/MediaStudio/` | **Sidebar Akun & Navigasi Location**: Tempat memilih sesi akun Telegram yang terhubung (`Connected Session`), daftar Recent Drives/Folders, dan daftar Topik Forum. |
| `driveFilesApi.ts` | `frontend/src/lib/telegram/driveApi/` | **Frontend Data Service**: Menyediakan API `driveListFiles`, `driveThumbnailsBatch`, `driveAvatarsBatch`, `driveDelete`, `driveMove`. Memfilter cache IndexedDB berdasarkan `topic_id` secara ketat dan melakukan fallback ke `tgListMedia` jika cache kosong. |
| `telegramBackend.ts` | `frontend/src/lib/telegram/core/` | **Tauri IPC Bridge**: Mengabstraksi panggilan `invoke('tg_*')` dari frontend ke backend Rust. Menangani parsing error dan retry otomatis. |
| `mediaStudioDb.ts` | `frontend/src/lib/db/` | **IndexedDB Local Storage**: Menyimpan warm cache media (`media`), thumbnail blob (`thumbnails`), job checkpoint (`checkpoints`), dan antrean aksi offline (`actionQueue`). |
| `thumbBatcher.ts` | `frontend/src/lib/media/` | **Pengelola Antrean Batch Thumbnail**: Mengelompokkan permintaan thumbnail dari kartu yang terlihat di layar ke dalam batch (16–32 item) dan memanggil `tgThumbnailsBatch`. Menghentikan batch lama saat terjadi perubahan generasi/topik. |
| `driveLoadStaging.ts` | `frontend/src/lib/telegram/interaction/` | **Batas Staged Pagination**: Menentukan batas ukuran halaman awal (`stagedInitialPageSize`: 40–100 item) dan ukuran pagination (`stagedLoadMorePageSize`: 60–150 item) berdasarkan tingkat performa perangkat (*low*, *mid*, *high*). |

---

### B. Lapisan Backend Engine Rust Native (src-tauri/src)

| Nama File | Lokasi | Fungsi & Cara Kerja Utama |
| :--- | :--- | :--- |
| `lib.rs` | `src-tauri/src/` | **Entrypoint Tauri App**: Mendaftarkan seluruh command Tauri (`tg_list_media`, `tg_open_topic_media`, `tg_thumbs_batch`, `tg_upload_file`, `tg_delete_messages`, dll.) dan menginisialisasi modul `features::topic_media`. |
| `telegram_ops.rs` | `src-tauri/src/core/` | **Dispatcher Commands**: Menghubungkan Tauri command ke fungsi pengeksekusi Grammers di `grammers_ops`. Memasukkan kredensial API hash & session string. |
| `media_list.rs` | `src-tauri/src/core/grammers_ops/` | **Core MTProto Query Engine**: Fungsi `list_media_blocking_topic` mengeksekusi `messages.search` berparameter `top_msg_id: Some(topic_id)` saat filter topik aktif. Memiliki fungsi `tl_message_to_row` untuk memetakan objek `tl::enums::Message` secara langsung ke `MediaFileRow`. |
| `client_pool.rs` | `src-tauri/src/core/grammers_ops/` | **Grammers Connection Pool**: Mengelola siklus hidup koneksi MTProto Grammers Client, mengurusi otentikasi sesi, dan melakukan auto-import file sesi Telethon jika ditemukan. |
| `peer_resolver.rs` | `src-tauri/src/core/grammers_ops/` | **LRU Peer Cache**: Mengonversi string chat ID / username (`"me"`, `"-10012345678"`, `"username"`) menjadi `PeerRef` atau `InputPeer` dengan sistem cache memori agar tidak mengulang RPC peer resolution. |
| `search.rs` | `src-tauri/src/features/topic_media/mtproto/` | **Server-side MTProto Topic Search**: Membentuk struktur request `tl::functions::messages::Search` dengan `top_msg_id` dan `filter` jenis media (`photo`, `video`, `document`, `music`, `url`). |
| `document_mapper.rs` | `src-tauri/src/features/topic_media/mtproto/` | **Domain Document Mapper**: Mengarahkan atribut dokumen Telegram (Filename, MimeType, Video/Audio/Image flags) menjadi model domain `TopicMediaItem`. |
| `repository.rs` | `src-tauri/src/features/topic_media/` | **SQLite Database Repository**: Menyediakan antarmuka CRUD ke tabel SQLite `topic_media_items`, `topic_media_thumbnails`, `topic_media_sync_state`, dan `topic_media_downloads` dengan composite index `(account_id, peer_id, topic_id, message_id)`. |
| `flood_wait.rs` | `src-tauri/src/features/topic_media/scheduler/` | **Global FloodWait Controller**: Mengunci seluruh request MTProto secara otomatis ketika Telegram API mengembalikan error `FLOOD_WAIT_X`, menunda request hingga rentang waktu `wait_seconds` berakhir tanpa memblokir UI. |

---

## 4. Alur & Hubungan Kerja Antar File (Workflow End-to-End)

### A. Alur Berpindah Topik Forum (Topic Switching Workflow)

```
[User Clicks Topic Chip in DriveTopBar.tsx]
       │
       ▼
1. DriveTopBar.tsx ──(onClick)──► handleTopicFilter(topicId) in MediaStudio/index.tsx
       │
       ├─► Increments peerGen.current (Atomic generation bump - invalidates stale callbacks)
       ├─► setFiles([]) & setLoadingFiles(true) (Clears old cards instantly)
       ├─► setThumbContext(creds, peerId, topicId) (Resets thumbnail batch queue)
       └─► Schedules refreshFiles() with 50ms micro-debounce
       │
       ▼
2. refreshFiles() in MediaStudio/index.tsx
       │
       ├─► Step A: Checks IndexedDB warm cache via getMediaRecords(peerId)
       │           Filters records by Number(r.topic_id) === Number(topicId)
       │           If topic records exist in IndexedDB, renders instantly (0ms TTFP)
       │
       └─► Step B: Executes driveListFiles(creds, peerId, { topicId }) in driveFilesApi.ts
       │
       ▼
3. driveListFiles() in driveFilesApi.ts
       │
       ├─► Checks local cache (Strictly filtered by topicId)
       └─► If local cache empty, calls tgListMedia() in telegramBackend.ts
       │
       ▼
4. telegramBackend.ts ──(invoke('tg_list_media'))──► Tauri IPC Bridge
       │
       ▼
5. telegram_ops.rs ──► list_media_blocking_topic() in media_list.rs (Rust Backend)
       │
       ├─► Resolves Peer using peer_resolver.rs
       ├─► Builds MTProto Request: tl::functions::messages::Search { top_msg_id: Some(topicId) }
       ├─► Invokes Grammers MTProto Client against Telegram Servers
       ├─► Telegram Server returns matching topic messages in <50ms
       └─► Maps raw TL messages using tl_message_to_row() to MediaFileRow array
       │
       ▼
6. Response Flows Back to Frontend
       │
       ├─► MediaStudio/index.tsx updates setFiles(files)
       ├─► DriveExplorer.tsx renders file cards via virtualized Grid/List
       └─► thumbBatcher.ts triggers tgThumbsBatch() to render WebP thumbnails on cards
```

---

### B. Alur Infinite Scroll & Proactive Streaming Pagination

```
[User Scrolls Down in DriveExplorer.tsx]
       │
       ▼
1. DriveExplorer.tsx (useEffect Scroll Detector)
       │
       ├─► Computes remaining items: (total - threshold)
       ├─► Threshold set proactively to 40% before bottom (8–25 rows = 48–150 items)
       └─► Triggers onLoadMore() with 10ms debounce when threshold crossed
       │
       ▼
2. loadMoreFiles() in MediaStudio/index.tsx
       │
       ├─► Checks filesHasMore && !loadMoreLock.current
       ├─► Obtains stagedLoadMorePageSize() (60 items on Low, 100 on Mid, 150 on High)
       └─► Calls driveListFiles(creds, peerId, { topicId, offsetId: lastMessageId })
       │
       ▼
3. driveFilesApi.ts & Rust Engine
       │
       ├─► Executes MTProto Search with offset_id
       └─► Returns new batch of MediaFileRow items
       │
       ▼
4. State Update & Seamless Merge
       │
       ├─► setFiles(prev => [...prev, ...newBatch])
       ├─► loadMoreLock.current = false (Immediate release for continuous scrolling)
       └─► DriveExplorer.tsx seamlessly appends cards without scroll jump or spinner pause
```

---

### C. Alur Pengunggahan Berkas (Upload Workflow)

```
[User Drops File / Clicks Upload Button]
       │
       ▼
1. UploadModal / DriveExplorer Drop Target
       │
       └─► Triggers driveUploadFile() in driveTransfersApi.ts
       │
       ▼
2. telegramBackend.ts ──(invoke('tg_upload_file'))──► Rust Backend
       │
       ▼
3. telegram_ops.rs ──► upload_file_blocking() in media_transfer.rs
       │
       ├─► Checks FloodWaitGateController (Failsafe gate)
       ├─► Reads file chunks (1MB chunks)
       ├─► Sends chunks via Grammers client.upload_stream()
       ├─► Sends media message to target peer & topic (reply_to = topicId)
       └─► Returns UploadStepResult (messageId, path, bytesWritten)
       │
       ▼
4. Frontend Live Sync Update
       │
       ├─► Triggers uploadSoftRefresh() in MediaStudio/index.tsx
       └─► Reconciles new uploaded item into liveFilesRef without flickering or re-rendering entire grid
```

---

## 5. Kategori & Modul Fitur Utama

### 1. AutoGram Drive (Telegram-as-a-Drive Interface)
- **Tampilan Berkas Virtualized**: Mendukung ribuan file per folder dengan konsumsi DOM minimal melalui `react-window` / virtualized rendering di `DriveExplorer.tsx`.
- **Manajemen Seleksi Kotak (Marquee Drag Selection)**: Memungkinkan pengguna memilih puluhan file dengan menarik kursor mouse di atas grid.
- **Context Menu & Shortcut Keyboard**: Klik kanan dan pintasan keyboard (`Ctrl+A`, `Delete`, `Space` preview, `Ctrl+F` search).

### 2. Topic Media Engine (Local-First Architecture)
- **MTProto Server-Side Topic Search**: Pemfilteran topik di server Telegram via `messages.search` `top_msg_id`.
- **Database Local SQLite (`topic_media.db`)**: Menyimpan index berkas per akun, peer, dan topik untuk pencarian offline instan.
- **Fail-Closed Generation Guard (`peerGen.current`)**: Menjamin 0% kebocoran data (*media bleed*) saat berpindah chat atau topik.

### 3. Smart Rate Controller & FloodWait Protection
- **Global FloodWait Gate (`flood_wait.rs`)**: Menangkap exception `FLOOD_WAIT_X` dari Telegram, memblokir request lanjutan pada peer terkait sesuai durasi penundaan, dan mencegah pemblokiran akun/IP.

### 4. Zip Browser & Remote Stream Engine
- **Remote Stream Zip API (`driveStreamZipApi.ts`)**: Membuka dan mengekstrak daftar berkas di dalam file kompresi `.zip` yang tersimpan di Telegram secara remote tanpa perlu mengunduh seluruh isi file zip.

### 5. Internationalization & Locale Management (i18n)
- **100% Zero Hardcoded Strings Rule**: Seluruh teks antarmuka diekstrak ke file locale (`src/locales/id/*.json` & `src/locales/en/*.json`) dan dikonsumsi via hook `useTranslation()`.

---

## 6. Ringkasan Sinkronisasi & Dependensi Antar File

```
┌───────────────────────────┐      ┌───────────────────────────┐
│ MediaStudio/index.tsx     │─────►│ DriveExplorer.tsx         │
│ (State, Sync, Topik, SWR) │      │ (Virtualized Grid/List)   │
└─────────────┬─────────────┘      └─────────────┬─────────────┘
              │                                  │
              ▼                                  ▼
┌───────────────────────────┐      ┌───────────────────────────┐
│ driveFilesApi.ts          │      │ thumbBatcher.ts           │
│ (Local Cache + Fallback)  │      │ (WebP Batch Queue)        │
└─────────────┬─────────────┘      └─────────────┬─────────────┘
              │                                  │
              └─────────────────┬────────────────┘
                                │
                                ▼
                  ┌───────────────────────────┐
                  │ telegramBackend.ts        │
                  │ (Tauri IPC Bridge)        │
                  └─────────────┬─────────────┘
                                │ invoke('tg_*')
                                ▼
                  ┌───────────────────────────┐
                  │ lib.rs & telegram_ops.rs  │
                  │ (Rust Dispatcher)         │
                  └─────────────┬─────────────┘
                                │
                                ▼
                  ┌───────────────────────────┐
                  │ media_list.rs / search.rs │
                  │ (Grammers MTProto Search) │
                  └───────────────────────────┘
```

Dokumen ini menjadi standar acuan teknis utama dalam pengembangan, pemeliharaan, dan skalabilitas arsitektur AutoGram App.
