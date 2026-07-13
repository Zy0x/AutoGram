# Repository Governance

Dokumen ini mendefinisikan aturan ketat untuk manajemen *repository*, struktur, dan standar operasi pada **AutoGram App**. Seluruh *developer* dan agen wajib mematuhinya untuk mencegah kerusakan struktural seperti yang terjadi pada versi sebelum v5.1.1.

## 1. Single Source of Truth
- Direktori `AutoGram App/` adalah satu-satunya *source of truth* untuk kode aplikasi.
- Dilarang membuat folder *backup* atau *layer* paralel di luar struktur yang sudah ditentukan.
- Setiap rilis baru merupakan evolusi dari direktori ini, bukan menduplikasi folder.

## 2. Hygiene & Secrets Management
Untuk menjaga keamanan repositori publik maupun privat:
- **DILARANG KERAS** mengunggah (`commit`/`push`) file berakhiran `.session`, `.env`, atau `.sqlite` ke dalam sistem kontrol versi.
- File-file konfigurasi lokal harus selalu masuk ke `.gitignore`.
- Jika ditemukan *credential* Telegram (`api_id`, `api_hash`, token bot) yang tertulis secara statis (*hardcode*) di dalam *source code*, *pull request* akan langsung ditolak. Kredensial wajib bersumber dari *environment variables* atau enkripsi lokal.

## 3. Merge & Branching Strategy
- Menggunakan standar Git Flow.
- Cabang `main` (atau `master`) hanya boleh berisi kode yang sudah stabil (*production-ready*).
- Pengembangan fitur baru dilakukan di cabang `feature/<nama-fitur>`.
- Perbaikan *bug* dilakukan di `fix/<nama-bug>`.
- Jika ada *merge conflict* pada dokumentasi desain, file lama dipertahankan, perubahan dicatat secara manual.

## 4. Requirement for Code Changes
Setiap perubahan kode (terutama pada modul inti Telegram dan Database) wajib:
1. Menyertakan pembaruan dokumentasi di folder `docs/`.
2. Jika ada perubahan skema database, wajib membuat file migrasi berurut di `database/migrations/`.
3. Memastikan tidak melanggar batasan *Architecture Decision Record* (ADR).
