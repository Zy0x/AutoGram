# System Component Map

Memvisualisasikan interaksi antarmuka UI, Rust Core Engine (Grammers MTProto), SQLite Database, dan Server Telegram.

```mermaid
graph TD
    A[React UI - React 19 / TS / i18n] -->|Tauri IPC Commands| B(Rust Core Engine)
    B -->|Tauri Events / SWR| A
    B -->|SQL Queries| C[(SQLite Database)]
    B -->|Local Storage / Cache| D[IndexedDB & Disk Cache]
    B -->|Native MTProto Protocol| E[Telegram MTProto Servers DC1-DC5]
    B -->|Range HTTP Server 206| F[Media Players / Video Stream]
```

- **React UI**: Mengelola interaksi pengguna, *MediaStudio*, *Drive Explorer*, antrean transfer, rendering SWR instan (0ms mini-thumb), dan preferensi lokasi/i18n.
- **Rust Core Engine**: Berfungsi sebagai *Backend Core*, mengelola otentikasi native (*Grammers Client Pool*), *Migration Engine*, *Rule Engine*, *Smart Rate Controller*, pemutaran media HTTP Range 206, dan manajemen SQLite.
- **SQLite Database**: Menyimpan antrean *job* migrasi, riwayat pencegahan duplikasi 4-level, status resume, serta konfigurasi akun.
- **IndexedDB & Disk Cache**: Menyimpan thumbnail hangat, data cache media SWR local-first, serta berkas `.nothumb` untuk performa render instan.
- **Telegram MTProto Servers**: Pusat penyimpanan media dan pengiriman data Telegram melalui koneksi MTProto native 100% Rust Grammers.
