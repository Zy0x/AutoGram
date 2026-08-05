# System Architecture

Platform ini menggunakan arsitektur *Desktop Offline (Telegram-as-a-Drive)*, dibangun di atas konsep *3-Tier Architecture* yang efisien, aman, dan berkinerja tinggi (UI - Tauri IPC Bridge - Rust Core, Shared Modular Core `autogram-core` & Grammers MTProto Engine).

## 1. Teknologi (Tech Stack)
Keputusan berdasarkan *Architecture Decision Record & Master Specification v2.8.7 (Smart 3x3 Grid Album Chunking Engine & Platform Hardening Edition)*:
- **Desktop Framework**: Tauri v2 (Ringan, aman, performa native tinggi, konsumsi memori minimal).
- **Frontend UI**: React 19 + TypeScript + TailwindCSS (Dengan dukungan 100% Zero Hardcoded Text i18n, rendering SWR local-first, & 0ms mini-thumb paint).
- **Shared Modular Core Engine (`autogram-core`)**: Modul core Rust independen (`src-tauri/src/core/autogram_core`) yang mengelola *persistent job queue* SQLite WAL, *job dependency graph*, *byte-offset checkpoint resume*, *faststart MP4 container repair*, *hardware capability profiling*, *policy engine*, *intent engine*, *account scoring system* (0-100), dan *audit trail event logging*.
- **Core Engine & Telegram Handler**: Rust (Grammers MTProto). Bertanggung jawab 100% secara native atas otentikasi multi-akun, eksplorasi media, pencarian topik, ekstraksi thumbnail statis & video asinkron, *progressive Range HTTP streaming*, *Studio orchestrated upload*, *Smart 3x3 Grid Album Chunking Engine*, *Smart Hardware GPU Allocation Engine*, *Migration Engine*, enkripsi, dan manajemen SQLite.
- **Database Lokal & Cache**: SQLite (Manajemen antrean *jobs*, WAL checkpoint, riwayat migrasi, & pencegahan duplikasi 4-level) + IndexedDB (Local-first persistent SWR cache & mini-thumbs).

## 2. Diagram Alur (Data Flow)
```text
[ React UI (User Input, MediaStudio, Dashboard, Transfer Manager & Drive Explorer) ]
                                │
                        (Tauri IPC Bridge)
                                ▼
[ Rust Core & autogram-core Engine ]
  ├─ Policy Engine & Intent Engine
  ├─ Job Queue (SQLite WAL) & Checkpoint Resume
  ├─ Smart Hardware GPU Allocation Engine (NVENC / AMF / QSV / CPU)
  ├─ Smart 3x3 Grid Album Engine (Max 9 items/album)
  ├─ Range HTTP Server (206 Partial Content)
  └─ Grammers MTProto Native Engine (DC1–DC5)
                                │
                       (MTProto Protocol DC1–DC5)
                                ▼
             [ Telegram Servers (Storage & Delivery) ]
```

## 3. Komponen Utama
1. **Grammers MTProto Engine & Client Pool**: Rust `client_pool.rs` mengelola sesi Telegram MTProto secara native untuk multi-akun dengan koneksi langsung ke DC1–DC5, dilengkapi *Active Socket Invalidation & Fresh MTProto Reconnect Engine* untuk mengeliminasi RPC Timeout -503.
2. **Shared Modular Core Engine (`autogram-core`)**: Menyediakan infrastruktur keandalan tingkat tinggi (*production-grade reliability*), termasuk manajemen dependensi *jobs*, *segment & byte offset checkpoint resume*, evaluasi kebijakan transfer, skor kesehatan akun (0-100), serta *audit trail event logging*.
3. **Migration Queue & Duplicate Engine**: Menyimpan antrean *job* di SQLite (`migration_jobs`), menjalankan evaluasi aturan (*Rule Engine*), serta memverifikasi pencegahan duplikasi 4-level (*Message ID, Telegram Unique ID, SHA256 Hash, Filename+Size*).
4. **Smart 3x3 Grid Album Chunking & Fallback Engine**: Membagi unggahan album menjadi kelompok maksimal 9 item (`chunk_size <= 9`) agar Telegram Web/Desktop/Mobile merender album secara simetris sempurna 3x3. Mengalokasikan header `reply_to` topik secara eksplisit di seluruh item album serta mengeksekusi *single upload fallback retry* dan *history recovery engine* (`try_recover_album_from_history`) jika terjadi gangguan pengiriman.
5. **Smart Hardware GPU Allocation Engine**: Deteksi hardware GPU dinamis di backend Rust (`hardware_capability.rs`) yang dipetakan ke profil encoder (NVIDIA NVENC, AMD AMF, Intel QSV, CPU) dengan penyesuaian otomatis parameter FFmpeg (`-rc vbr`, `-quality speed`, dll.) sesuai preferensi pengguna.
6. **Smart Rate Controller & Progress Streaming**: Memonitor respon API Telegram MTProto. Ketika terdeteksi `FloodWaitError` / `FLOOD_PREMIUM_WAIT`, Rust secara otomatis melakukan penundaan (*backoff/sleep*) dan menurunkan alokasi kecepatan. Menyalurkan `ProgressAsyncReader` pada stream upload byte untuk memancarkan event `StudioProgress` dan `StudioItemDone` secara real-time ke UI antrean transfer.
7. **Stream HTTP Range Server**: Server HTTP internal Rust (`tiny_http`) yang melayani pemutaran media video via Partial Content `HTTP 206` dengan kelipatan batas 512 KB MTProto.

## 4. Keamanan Arsitektur
- Sesi Telegram disimpan dalam berkas terenkripsi/terproteksi (`{account}.grammers.json`).
- Pengelolaan kata sandi utama (*master password*) dan kredensial sensitif diisolasi penuh di lapisan backend Rust tanpa pernah mengekspos rahasia atau *API Hash* ke antarmuka pengguna atau log aplikasi.
- Seluruh identitas media terikat pada `MediaIdentity` kanonis (`accountId`, `peerId`, `topicId`, `messageId`), mengeliminasi total risiko kebocoran data (*media bleed*) antar-obrolan/topik.

