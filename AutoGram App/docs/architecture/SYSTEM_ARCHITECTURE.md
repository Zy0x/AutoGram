# System Architecture

Platform ini menggunakan arsitektur *Desktop Offline (Telegram-as-a-Drive)*, dibangun di atas konsep *3-Tier Architecture* yang efisien, aman, dan berkinerja tinggi (UI - Tauri IPC Bridge - Rust Core & Grammers Engine).

## 1. Teknologi (Tech Stack)
Keputusan berdasarkan *Architecture Decision Record & Master Specification v2.7.2*:
- **Desktop Framework**: Tauri v2 (Ringan, aman, performa native tinggi, konsumsi memori minimal).
- **Frontend UI**: React 19 + TypeScript + TailwindCSS (Dengan dukungan i18n, rendering SWR local-first, & 0ms mini-thumb paint).
- **Core Engine & Telegram Handler**: Rust (Grammers MTProto). Bertanggung jawab 100% secara native atas otentikasi, eksplorasi media, pencarian topik, ekstraksi thumbnail, *progressive Range HTTP streaming*, *Studio file upload*, *Migration Engine*, enkripsi, dan manajemen SQLite.
- **Database Lokal & Cache**: SQLite (Manajemen antrean, riwayat migrasi, & duplikasi) + IndexedDB (Local-first persistent SWR cache).

## 2. Diagram Alur (Data Flow)
```text
[ React UI (User Input, MediaStudio, Dashboard & Drive Explorer) ]
                                │
                        (Tauri IPC Bridge)
                                ▼
[ Tauri Rust Core (Grammers Engine, Migration Engine, Rule Engine, SQLite & Stream Server) ]
                                │
                       (MTProto Protocol DC1–DC5)
                                ▼
             [ Telegram Servers (Storage & Delivery) ]
```

## 3. Komponen Utama
1. **Grammers MTProto Engine & Client Pool**: Rust `client_pool.rs` mengelola sesi Telegram MTProto secara native untuk multi-akun dengan koneksi langsung ke DC1–DC5.
2. **Migration Queue & Duplicate Engine**: Menyimpan antrean *job* di SQLite (`migration_jobs`), menjalankan evaluasi aturan (*Rule Engine*), serta memverifikasi pencegahan duplikasi 4-level (*Message ID, Telegram Unique ID, SHA256 Hash, Filename+Size*).
3. **Smart Rate Controller**: Memonitor respon API Telegram MTProto. Ketika terdeteksi error `FloodWaitError`, Rust secara otomatis melakukan penundaan (*backoff/sleep*) dan menurunkan alokasi *speed/bandwidth* pengiriman secara presisi.
4. **Stream HTTP Range Server**: Server HTTP internal Rust (`tiny_http`) yang melayani pemutaran media berformat video via Partial Content `HTTP 206` dengan kelipatan batas 512 KB MTProto.

## 4. Keamanan Arsitektur
- Sesi Telegram disimpan dalam berkas terenkripsi/terproteksi (`{account}.grammers.json`).
- Pengelolaan kata sandi utama (*master password*) dan kredensial sensitif diisolasi penuh di lapisan backend Rust tanpa pernah mengekspos rahasia atau *API Hash* ke antarmuka pengguna atau log aplikasi.
