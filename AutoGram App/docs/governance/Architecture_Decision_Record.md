# Architecture Decision Record (ADR)

Dokumen ini mencatat semua keputusan arsitektur tingkat tinggi beserta alasannya. Dilarang merombak fondasi ini tanpa membuat dokumen revisi ADR yang baru.

## ADR-001: Desktop Framework Selection
**Status**: Diterima
**Konteks**: Memilih framework *desktop* yang aman, cepat, dan sanggup memproses banyak *file* secara berkelanjutan.
**Keputusan**: Menggunakan kombinasi **Tauri + React + Rust**.
**Alasan**:
- Dibandingkan Electron (Chromium + Node.js), Tauri jauh lebih ringan (menggunakan Webview bawaan OS) dan hemat RAM.
- *Memory management* Rust memastikan aplikasi tidak akan mengalami *crash* akibat *Out-of-Memory* (OOM) saat memproses antrean jutaan pesan media Telegram.

## ADR-002: Pemisahan Telegram API Engine (Python Worker)
**Status**: Diterima
**Konteks**: Modul MTProto Telegram di berbagai bahasa memiliki tingkat kematangan berbeda.
**Keputusan**: Interaksi dengan Telegram API (login, ambil pesan, *forward/send*) **wajib dipisah** sebagai servis *Worker* independen menggunakan bahasa **Python (library Telethon)**.
**Alasan**:
- Menulis ulang *MTProto client* murni menggunakan Rust sangat rumit dan lambat proses pengembangannya.
- Telethon di Python sangat stabil dan kaya fitur (terutama *Forum Topics*).
- Dengan memisahkannya sebagai *worker*, jika skrip Python mengalami *FloodWait* atau *Crash*, UI React dan Core Rust tidak akan membeku (*freeze*).

## ADR-003: Penyimpanan Status Migrasi (Local Database)
**Status**: Diterima
**Konteks**: Sistem harus mampu melanjutkan (*resume*) tugas migrasi besar yang terputus (mati listrik, internet putus) tanpa duplikasi.
**Keputusan**: Memanfaatkan **SQLite** sebagai penyimpanan lokal (Phase 1).
**Alasan**: 
- Relasional, cepat, dan portabel. 
- Mampu menyimpan status (`DONE`, `FAILED`, `PENDING`) per *Message ID* sehingga aplikasi memiliki "ingatan" yang andal.

## ADR-004: Forward Mode vs Copy Mode
**Status**: Diterima
**Konteks**: Telegram secara *default* akan menempelkan label "Forwarded From".
**Keputusan**: Sistem wajib mendukung kedua mode:
1. **Fast Forward**: `forward_messages()`. Cepat, tapi ada label.
2. **Clean Copy**: Unduh referensi ➔ `send_file()`. Lebih lambat, tapi murni milik *channel* tujuan.
