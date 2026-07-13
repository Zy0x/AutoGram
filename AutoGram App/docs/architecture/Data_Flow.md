# Data Flow & Execution Pipeline

Dokumen ini memetakan urutan operasi internal untuk memastikan tidak ada pesan yang diproses di luar pengawasan *Rule Engine*.

## Pipeline Utama (Migration Core Flow)

1. **User Configuration (GUI)**
   - *User* memilih Source (Group A) dan Destination (Channel B).
   - *User* menentukan *Transfer Mode*, *Filters*, dan jadwal.
   - Konfigurasi dikirim ke Rust Core.

2. **Migration Task Dispatcher**
   - Rust Core menyimpan *task* ke SQLite (`migration_jobs`).
   - Jika langsung jalan (*Run Now*), *Worker Manager* membangkitkan Python Telegram Worker.

3. **Message Scanner (Python Worker)**
   - Python memanggil `client.iter_messages()`.
   - Mengambil pesan sesuai *pagination/limit* (agar aman dari blokir API).

4. **Rule Evaluation (Rust/Python)**
   - Pesan mentah dilewatkan ke *Rule Engine*.
   - Evaluasi meliputi:
     - Apakah ini *Media* atau *Text*?
     - Apakah ukuran file melewati batas filter?
     - Apakah tanggal pesan masuk dalam jangkauan?
   - Jika gagal evaluasi ➔ Status: `SKIPPED`.

5. **Duplicate Check (Duplicate Engine)**
   - Sistem membaca SQLite `duplicate_history`.
   - Cek ID Pesan, Telegram `file_unique_id`, dan *Hash*.
   - Jika ditemukan duplikat ➔ Eksekusi aturan duplikasi (Skip/Replace/Ask User).

6. **Transfer Execution**
   - Jika *Fast Forward*: Kirim API instruksi Forward.
   - Jika *Clean Copy*: Unduh (atau ambil referensi *server*) lalu Unggah ulang.
   - *Smart Throttle* aktif: Jika dapat error `FloodWait`, *Worker* tidur (*sleep*) sesuai waktu yang diminta Telegram API + ekstra 2-5 detik acak (Human Behavior Mode).

7. **History Logging & Persistence**
   - Setelah sukses atau gagal permanen, status ditulis ke SQLite `migration_items`.
   - Laporan (*progress bar*) dikembalikan ke UI via IPC Tauri.

8. **Completion & Reporting**
   - Eksekusi selesai. Laporan PDF/CSV digenerate jika diminta.
