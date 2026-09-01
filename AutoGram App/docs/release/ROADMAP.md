# Development Roadmap (Forwarder V2)

> Updated for the Rust + Grammers production architecture. Python/Telethon is a legacy
> compatibility adapter only; it is not a Forwarder execution backend.

## Phase 1: Offline Desktop Foundation (Current Focus)
**Tujuan**: Membangun *Local-first Application* yang aman dan berfungsi penuh.
- [ ] Inisialisasi *Workspace* (Tauri + React + Rust).
- [x] Native Rust/Grammers execution boundary and encrypted local credential vault.
- [ ] Skema *Database* Lokal (SQLite).
- [ ] Fitur *Login* Telegram + Enkripsi Sesi.
- [x] Transfer Mode Dasar (*Fast Forward* & *Clean Copy*).
- [x] 4-level duplicate ledger foundation and resumable checkpoints.

## Phase 2: Advanced Rules & Automation
**Tujuan**: Menjadikan aplikasi "Pintar".
- [ ] Filter Media Lengkap (Waktu, Ukuran, Tipe).
- [ ] *Smart Throttle* & *Anti-Spam Protection*.
- [ ] GUI Dashboard Lengkap & *Analytics*.
- [ ] *Scheduler* (Cron jobs).
- [ ] Ekspor Laporan (*CSV/Excel*).

## Phase 3: Web Dashboard & Cloud Deployment
**Tujuan**: Perluasan ke infrastruktur *Cloud*.
- [ ] Integrasi Supabase (*Database, Auth, Storage*).
- [ ] Pembuatan *Web Dashboard* (Next.js/React).
- [ ] *Edge Functions* untuk migrasi *cloud*.

## Phase 4: Commercialization & Multi-Tenant
**Tujuan**: Menjadikan platform ini produk SaaS komersial.
- [ ] *License Module* (Free vs Premium).
- [ ] *Role-based Access Control* (Admin, Operator, Viewer).
- [ ] *Public API* untuk otomatisasi *third-party*.
