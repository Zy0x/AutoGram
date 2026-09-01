# Development Roadmap (Forwarder V2)

> Updated for the Rust + Grammers production architecture. Python/Telethon is a legacy
> compatibility adapter only; it is not a Forwarder execution backend.

## Phase 1: Offline Desktop Foundation (Current Focus)
**Tujuan**: Membangun *Local-first Application* yang aman dan berfungsi penuh.
- [ ] Inisialisasi *Workspace* (Tauri + React + Rust).
- [x] Native Rust/Grammers execution boundary and encrypted local credential vault.
- [x] Skema *Database* Lokal (SQLite) with additive V2 migrations and guarded legacy backfill.
- [ ] Fitur *Login* Telegram + Enkripsi Sesi.
- [x] Transfer Mode Dasar (*Fast Forward* & *Clean Copy*).
- [x] 4-level duplicate ledger foundation and resumable checkpoints.

## Phase 2: Advanced Rules & Automation
**Tujuan**: Menjadikan aplikasi "Pintar".
- [x] Filter Media Lengkap (Waktu, Ukuran, Tipe) in the shared V2 rule engine.
- [ ] *Smart Throttle* & *Anti-Spam Protection*.
- [ ] GUI Dashboard Lengkap & *Analytics*.
- [~] Local RRULE validation and one-catch-up policy; full occurrence service remains rollout work.
- [ ] Ekspor Laporan (*CSV/Excel*).

## Phase 3: Web Dashboard & Cloud Deployment
**Tujuan**: Perluasan ke infrastruktur *Cloud*.
- [~] Supabase metadata schema, RLS, signed relay command API, and claim/ack flow are scaffolded; production deployment/load test remains.
- [ ] Pembuatan *Web Dashboard* (Next.js/React).
- [ ] *Edge Functions* untuk migrasi *cloud*.

## Phase 4: Commercialization & Multi-Tenant
**Tujuan**: Menjadikan platform ini produk SaaS komersial.
- [ ] *License Module* (Free vs Premium).
- [ ] *Role-based Access Control* (Admin, Operator, Viewer).
- [ ] *Public API* untuk otomatisasi *third-party*.
