# Data Flow & Execution Pipeline

Dokumen ini memetakan urutan operasi internal untuk memastikan tidak ada pesan yang diproses di luar pengawasan *Rule Engine* dan *Duplicate Engine* berbasis 100% Rust Grammers MTProto.

## Pipeline Utama (Migration Core Flow)

1. **User Configuration (GUI)**
   - *User* memilih Source (Grup/Kanal A) dan Destination (Grup/Kanal B).
   - *User* menentukan *Transfer Mode*, *Filters*, dan jadwal di antarmuka React UI.
   - Konfigurasi dikirim ke Rust Core via Tauri IPC (`jobs_run_migration`).

2. **Migration Task Dispatcher**
   - Rust Core menyimpan *task* ke SQLite (`migration_jobs`).
   - Jika eksekusi langsung (*Run Now*), `migration_run.rs` di Rust Core memenangi antrean tanpa bergantung pada proses external/worker Python.

3. **Message Scanner (Rust Grammers)**
   - Rust Grammers memanggil `grammers_ops::media_list` atau iterator MTProto native.
   - Mengambil pesan sesuai *pagination/limit* dan batch offset secara aman dari pembatasan API Telegram.

4. **Rule Evaluation (Rust Rule Engine)**
   - Pesan mentah dievaluasi langsung oleh *Rust Rule Engine*.
   - Evaluasi meliputi:
     - Apakah tipe berkas sesuai filter (*Media/Document/Photo/Video/Text*)?
     - Apakah ukuran berkas berada dalam rentang batas filter?
     - Apakah stempel waktu pesan masuk dalam jangkauan tanggal yang ditentukan?
   - Jika gagal evaluasi ➔ Status ditulis sebagai `SKIPPED`.

5. **Duplicate Check (Duplicate Engine 4-Level)**
   - Sistem membaca SQLite `duplicate_history`.
   - Melakukan verifikasi duplikasi 4-level (*Message ID, Telegram Unique ID, SHA256 Hash, Filename+Size*).
   - Jika ditemukan duplikat ➔ Eksekusi aturan duplikasi (*Skip / Replace / Ask User*).

6. **Transfer Execution & Smart Rate Controller**
   - Jika *Fast Forward*: Mengirimkan instruksi forward pesan via Grammers `forward_messages`.
   - Jika *Clean Copy*: Mengunduh dan mengunggah ulang berkas media melalui stream Grammers.
   - *Smart Throttle* aktif: Jika terdeteksi `FloodWaitError`, Rust Core secara otomatis menunda (*sleep*) eksekusi sesuai durasi penalti Telegram API + jeda acak (Human Behavior Mode) untuk menjaga keamanan akun.

7. **History Logging & Persistence**
   - Setelah eksekusi sukses atau gagal permanen, status transaksi ditulis ke SQLite `migration_items`.
   - Pembaruan status dan *progress bar* dikirimkan secara real-time ke React UI via Tauri Event Bridge.

8. **Completion & Reporting**
   - Pekerjaan migrasi selesai. Ringkasan statistik ditampilkan di UI Dashboard dan laporan eksekusi (CSV/PDF) disiapkan jika diminta.
