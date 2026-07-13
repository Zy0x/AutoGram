# System Architecture

Platform ini menggunakan arsitektur *Hybrid (Offline Desktop + Online Web)*, dibangun di atas konsep *4-Tier Architecture* (UI - Framework - Core - API Worker).

## 1. Teknologi (Tech Stack)
Keputusan berdasarkan *Architecture Decision Record (ADR-001 & ADR-002)*:
- **Desktop Framework**: Tauri (Ringan, aman, performa tinggi).
- **Frontend UI**: React + TypeScript + TailwindCSS.
- **Core Engine (IPC & Logic)**: Rust. Bertanggung jawab atas manajemen file, enkripsi, antrean (queue), dan *database*.
- **Telegram Worker**: Python (Telethon MTProto). Menangani interaksi dengan Telegram API agar stabil dan minim risiko *banned*.
- **Database Lokal**: SQLite.

## 2. Diagram Alur (Data Flow)
```text
[ React UI (User Input & Dashboard) ]
            │
            ▼
[ Tauri Rust Core (Migration Engine, Rule Engine, Database) ]
            │
            ▼
[ Python Worker (Telethon MTProto API Handler) ]
            │
            ▼
[ Telegram Server (Storage & Delivery) ]
```

## 3. Komponen Utama
1. **Migration Queue**: Menyimpan antrean *job* ke SQLite.
2. **Worker Manager**: Rust bertugas mengelola siklus hidup Python *Worker* (1 akun = 1 proses worker yang aman).
3. **Smart Rate Controller**: Rust memonitor API *response*. Jika Python melaporkan *FloodWait*, Rust langsung menurunkan alokasi *bandwidth/speed* pengiriman otomatis.

## 4. Keamanan Arsitektur
- Sesi Telegram disimpan sebagai file terenkripsi (`session_telegram.enc`).
- Kata sandi utama (*master password*) diperlukan untuk membuka *vault* dekripsi sesi Telegram.
