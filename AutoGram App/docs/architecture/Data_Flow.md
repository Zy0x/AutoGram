# Data Flow & Execution Pipeline

Dokumen ini memetakan urutan operasi internal untuk memastikan tidak ada pesan atau berkas yang diproses di luar pengawasan *Rule Engine*, *Duplicate Engine*, *Smart Hardware GPU Allocation Engine*, dan *Smart 3x3 Grid Album Chunking Engine* berbasis 100% Rust Grammers MTProto.

---

## 1. Pipeline Utama (Migration Core Flow)

1. **User Configuration (GUI)**
   - *User* memilih Source (Grup/Kanal A) dan Destination (Grup/Kanal B).
   - *User* menentukan *Transfer Mode*, *Filters*, dan jadwal di antarmuka React UI.
   - Konfigurasi dikirim ke Rust Core via Tauri IPC (`jobs_run_migration`).

2. **Migration Task Dispatcher & Checkpoint Init**
   - Rust Core & `autogram-core` menyimpan *task* dan *checkpoint manager* ke SQLite WAL (`migration_jobs`).
   - Jika eksekusi langsung (*Run Now*), `migration_run.rs` memenangi antrean tanpa bergantung pada proses external/worker Python.

3. **Message Scanner (Rust Grammers)**
   - Rust Grammers memanggil `grammers_ops::media_list` atau iterator MTProto native.
   - Mengambil pesan sesuai *pagination/limit* dan batch offset secara aman dari pembatasan API Telegram.

4. **Rule Evaluation (Rust Rule Engine & autogram-core Policy Engine)**
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
   - *Smart Throttle* aktif: Jika terdeteksi `FloodWaitError` / `FLOOD_PREMIUM_WAIT`, Rust Core secara otomatis menunda (*sleep*) eksekusi sesuai durasi penalti Telegram API + jeda acak (*Human Behavior Mode*) untuk menjaga keamanan akun.

7. **History Logging & Realtime Progress Persistence**
   - Setelah eksekusi sukses atau gagal permanen, status transaksi ditulis ke SQLite `migration_items`.
   - Pembaruan status dan *progress bar* dikirimkan secara real-time ke React UI via Tauri Event Bridge (`StudioProgress` / `StudioItemDone`).

8. **Completion & Reporting**
   - Pekerjaan migrasi selesai. Ringkasan statistik ditampilkan di UI Dashboard dan laporan eksekusi disajikan.

---

## 2. Pipeline Studio Orchestrated Upload (Studio Upload Flow)

1. **Item Enqueue & Identity Binding**
   - Antarmuka MediaStudio mengirimkan berkas media lokal/remote ke `studio_orch.rs` via IPC (`studio_enqueue` / `studio_run_orchestrated`).
   - Setiap item diikat dengan `MediaIdentity` kanonis (`accountId`, `peerId`, `topicId`, `messageId`).

2. **Preflight Media & GPU Allocation Engine**
   - `hardware_capability.rs` dan `media_prep.rs` menganalisis berkas:
     - Deteksi kontainer media & pengesan atom Faststart MP4 (`moov`).
     - Deteksi profil GPU nyata pengguna (NVIDIA NVENC, AMD AMF, Intel QSV, CPU).
     - Menghasilkan argumen FFmpeg khusus (`-rc vbr`, `-quality speed`, dll.) jika re-encode diaktifkan.
     - Ekstraksi thumbnail JPEG 320px dan atribut video (`Attribute::Video`) untuk mode dokumen murni (`as_document = true`).

3. **Dynamic Re-encoded File Size Sync**
   - Jika berkas mengalami re-encode, `actual_upload_size` pasca re-encode disinkronkan ke `StudioReencodeDone`.
   - Ukuran total item dan perhitungan persentase di Transfer Manager disesuaikan dengan ukuran riil byte yang akan diunggah (mencegah overflow % > 100%).

4. **Smart 3x3 Grid Album Chunking Engine (`chunk_size <= 9`)**
   - Jika pengguna memilih *Group as Album*, `studio_orch.rs` membagi daftar item menjadi batch maksimal **9 item per album** (`chunk_size <= 9`).
   - Penataan ini menggaransi postingan album di Telegram Web/Desktop/Mobile selalu membentuk kisi simetris sempurna 3 × 3 (9 foto) tanpa memisah foto ke-10 menjadi post tersendiri.

5. **Explicit Topic `reply_to` Allocation & Commit Phase State Engine**
   - Untuk grup berpola Forum Topic, header `reply_to` dialokasikan secara eksplisit di seluruh item album (item 1–9).
   - Saat byte upload 100% selesai dan RPC Grammers `send_album` dieksekusi, backend memancarkan fase `StudioItemPhase::Committing` ("Mengirim pesan…") ke UI.

6. **Automatic Single Fallback Retry & History Recovery Engine**
   - Jika RPC `send_album` mengalami error atau timeout Grammers, sistem mengaktifkan `try_recover_album_from_history` untuk mencocokkan `grouped_id` di Telegram history.
   - Item yang tidak terikat di-retry secara otomatis via *single upload fallback retry engine* di `studio_orch.rs`.
   - Item berhasil ditandai `SELESAI`, sedangkan item tercecer/gagal permanen ditandai `GAGAL` secara presisi.

