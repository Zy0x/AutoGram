# Changelog

## v2.2.0 Alur Kerja Komprehensif Ekstraksi Arsip ZIP ke Drives & Telegram

### Fitur & Pemetaan Destinasi Ekstraksi Media Drive (`DriveZipBrowser.tsx`)
- **Pemetaan Penuh Seluruh Destinasi Akun**:
  - Modal destinasi ekstraksi kini memetakan 100% lokasi dari akun pengguna: Gudang Utama Drive (Root), seluruh hierarki Folder Drive [TD], Pesan Tersimpan, Channel Telegram, Grup & Supergrup Telegram, Bot Telegram, dan Topik Forum.
- **Dukungan Topik Forum Telegram (`tgListTopics`)**:
  - Untuk supergrup bertipe Forum, modal menyediakan penjelajahan dan pemilihan topik forum secara langsung dengan visualisasi badge dan nama topik.
- **Alur Pengunggahan Native Grammers & Pembersihan Diska**:
  - Menyelesaikan alur post-ekstraksi secara utuh: berkas diekstrak dari arsip ZIP ke lokasi temporary diska -> diunggah secara native via Grammers (`tgUploadFile`) ke destinasi pilihan -> berkas temporary otomatis dibersihkan dari diska.
- **Umpan Balik Status & Refresh Instan**:
  - Menampilkan progress bertahap (Mengekstrak -> Mengunggah ke Destinasi -> Selesai) serta memicu penyegaran Media Drive agar berkas yang diekstrak langsung tampil di grid.

## v2.1.100 Eliminasi Pembekuan Grid & Penyelarasan Perpindahan Topik UI

### Perbaikan Utama Navigasi Topik (`SpeedTest.tsx`)
- **Penyelarasan Tipe Topic ID (`String(topic.id) === String(t)`)**:
  - Mengatasi masalah silent-abort pada `handleTopicFilter` di mana perbandingan strict type `===` gagal karena perbedaan string vs number antara data `topics` dan parameter `t`.
- **Eviksi Cache Instan Navigasi Topik**:
  - Menghapus entri `filesCacheRef` lokasi sebelumnya secara mutlak saat topik baru diklik. Mengeliminasi bug *media bleeding* di mana foto dari chat utama/topik lain tetap tampil di grid saat berpindah ke topik `"Link"`.
- **Eksekusi Refresh Instan (50ms Micro-debounce)**:
  - Mempercepat pemuatan media topik dari 300ms menjadi 50ms sehingga transisi antar-topik berlangsung responsif dan instan.

## v2.1.99 Dukungan Tautan & WebPage Preview (`Media::WebPage` & Link Cards)

### Perbaikan Utama Konversi Media Telegram
- **Penanganan WebPage Preview & Link Text (`grammers_ops.rs`)**:
  - Mengatasi celah di mana pesan Telegram berjenis `Media::WebPage` dan pesan teks berisikan tautan diabaikan (`_ => None`) oleh fungsi `media_to_row`.
  - Topik Telegram berisikan link (seperti topik "Link" ID 246) kini dikonversi secara presisi menjadi kartu media berformat `.url` (`icon_type: "link"`, `mime_type: "text/html"`).
  - Mengesahkan 100% dari 13 pesan dan tautan web pada topik `246` dapat ditampilkan secara utuh pada antarmuka AutoGram UI.

## v2.1.98 Alignment Presisi 1:1 Knob Slider & Teks Label Ukuran Cache

### Perbaikan Visual & Layout UI Pengaturan
- **Presisi Alignment Label Slider (`Settings.tsx`)**:
  - Mengubah struktur layout teks label dari `display: flex; justify-content: space-between` menjadi *percentage relative positioning* presisi (`left: ${(idx / 7) * 100}%`).
  - Menggunakan CSS transform (`translateX(-50%)` untuk label tengah, `none` untuk awal, dan `translateX(-100%)` untuk akhir) sehingga posisi tombol knob slider selaras 100% tepat berada tegak lurus di atas masing-masing teks label (`Bebas`, `1 GB`, `2 GB`, `5 GB`, `10 GB`, `20 GB`, `50 GB`, `100 GB`).

## v2.1.97 Penguatan Fungsi Seluruh Tombol Manajemen Cache & Rust Disk Trimming

### Perbaikan & Penyelarasan Tombol Pengaturan Penyimpanan
- **Penyelarasan Format Ukuran Biner (Binary MB Steps)**:
  - Mengubah nilai step slider dari MB desimal (5000 MB -> `4.88 GB`) menjadi MB biner presisi (5120 MB -> **`5 GB`**, 10240 MB -> **`10 GB`**, dst.), sehingga teks label dan perhitungan persentase tampil rapi tanpa pecahan desimal aneh.
- **Implementasi Rust Disk Cache Trimming (`jobs_db.rs`)**:
  - Menambahkan fungsi Rust `trim_disk_cache` dan command `cache_trim_disk` yang mengosongkan berkas cache lama di disk berdasarkan waktu modifikasi secara bertahap hingga total ukuran disk mematuhi batas yang dipilih.
  - Memastikan tombol **"Hitung Ukuran"**, **"Pangkas Ke Batas"**, **"Hapus Semua Cache"**, dan **"Kosongkan Database Transfer"** bekerja 100% akurat.

## v2.1.96 Fitur Slider Pembatas Ukuran Cache & Fitur Pangkas Otomatis (Cache Limit Slider)

### Fitur Utama Manajemen Penyimpanan
- **Slider Pembatas Cache (`Settings.tsx`)**:
  - Menambahkan slider kontrol batas maksimum penyimpanan cache dengan pilihan fleksibel: `Tanpa Batas (Bebas)`, `1 GB`, `2 GB`, `5 GB`, `10 GB`, `20 GB`, `50 GB`, dan `100 GB`.
  - Dilengkapi dengan visual progress bar dinamis yang menunjukkan rasio penggunaan cache terhadap batas yang ditentukan (berubah warna menjadi oranye/merah saat melebihi batas).
- **Tombol & Fungsi Pemangkasan Otomatis ("Pangkas Ke Batas")**:
  - Menambahkan fungsi `prunePersistentThumbsToSize` pada `thumbPersistentCache.ts` yang memangkas entri cache lama secara teratur hingga ukuran total mematuhi batas yang dikonfigurasi.
  - Menampilkan peringatan peringatan visual jika ukuran cache terdeteksi melebihi batas yang disetel pengguna.

## v2.1.95 Otomatisasi Penelusuran Topik Mendalam & Eviksi Cache Kosong Lapuk

### Perbaikan Utama Navigasi Perpindahan Topik
- **Otomatisasi Penelusuran Topik Mendalam (`SpeedTest.tsx`)**:
  - Menikkan batas percobaan `auto-pagination` dari 3 menjadi **10 percobaan** saat hasil pemindaian topik awal mengembalikan 0 media sementara Telegram mengindikasikan `has_more`. Ini memungkinkan perpindahan topik secara otomatis melakukan pencarian hingga 10.000 pesan ke belakang tanpa perlu menekan tombol refresh manual.
- **Pembersihan Cache Kosong Lapuk (`handleTopicFilter`)**:
  - Saat pengguna berpindah ke topik baru, cache kosong yang sempat tersimpan dari pemindaian lama (`length === 0`) kini otomatis dihapus (`filesCacheRef.current.delete(cacheKey)`), menjamin aplikasi selalu mengambil data segar berjangkauan 10.000 pesan langsung dari backend.

## v2.1.94 Perluasan Batas Pemindaian Pesan Topik (`scan_limit` 10.000 Pesan)

### Perbaikan Utama Pencarian Media Topik Forum
- **Perluasan Pemindaian Pesan Topik (`grammers_ops.rs`)**:
  - Mengoreksi batasan `scan_limit` pada fungsi `list_media_blocking_topic`. Previously, `scan_limit` hanya dibatasi maksimal 1.000 pesan (`clamp(350, 1000)`).
  - Pada grup forum yang aktif di mana topik tertentu (seperti topik "File" berisi 49 berkas ZIP) berada lebih lama di riwayat riwayat percakapan grup, pembatasan 1.000 pesan menyebabkan Grammers berhenti memindai sebelum mencapai pesan topik tersebut dan mengembalikan `n: 0`.
  - Kini, `scan_limit` dinaikkan hingga **10.000 pesan** (`clamp(1000, 10000)`), menjamin 100% berkas ZIP dan dokumen pada topik yang lebih lama terdeteksi secara presisi.

## v2.1.93 Perbaikan Race Condition & Stale Media Bleeding pada Perpindahan Antar Topik

### Perbaikan Utama Navigasi Forum Topics & Drive UI
- **Eliminasi Media Bleeding Antar Topik (`SpeedTest.tsx`)**:
  - Mengoreksi logika pemuatan cache instant pada `refreshFiles`. Sebelumnya, `setFiles((prev) => (prev.length > instantFiles.length ? prev : ...))` mempertahankan daftar file dari topik lama jika jumlah filenya lebih banyak dari instant cache topik baru.
  - Kini, state `files` dibersihkan secara instan (`setFiles([])`) setiap kali `topicFilter` berganti, menjamin kartu media dari topik sebelumnya tidak pernah bocor ke tampilan topik baru.
- **Pencegahan FloodWait & Debounce Guard (`handleTopicFilter`)**:
  - Menambahkan pembatas debounce (300ms) pada klik pill topik dan memasang `topicGenRef` (generasi tracker topik).
  - Mengabaikan request RPC jaringan lama dan membatalkan timer pencarian stats ketika pengguna mengklik pill topik secara cepat beruntun.
- **Pembatalan Loop Background Media Stats**:
  - Menambahkan pemeriksaan generasi `statsGen !== topicGenRef.current` di dalam `refreshMediaStats` untuk menghentikan pemindaian halaman latar belakang ketika topik aktif berganti.
- **Pencocokan Balasan Sub-Thread Topik (`smart_scanner.py`)**:
  - Mengoreksi evaluasi `_passes_topic_filter` di Smart Scanner. Sebelumnya hanya mengecek `reply_to_msg_id`, sehingga pesan yang merupakan balasan ke komentar di dalam utas topik (`reply_to_top_id`) terlewati secara keliru. Kini `effective_topic_id = top_id or reply_id` digunakan untuk menjamin 100% media di sub-thread topik berhasil terdeteksi.

## v2.1.92 Perbaikan Rekonstruksi Faststart MP4 & Re-indexing Atom Chunk Offset

### Perbaikan Utama Visual Media & Grid
- **Perbaikan Atom Chunk Offset Re-indexing (`stco` & `co64`)**:
  - Mengoreksi fungsi `make_faststart_mp4` dan `patch_moov_offsets` di backend Rust (`grammers_media.rs`).
  - Sebelumnya, saat menyusun ulang berkas MP4 *non-faststart* (seperti video Snaptik/TikTok di mana atom `moov` berada di akhir berkas 40MB+), atom `moov` dipindahkan ke depan tanpa memperbarui tabel offset chunk `stco` (32-bit) dan `co64` (64-bit). Hal ini menyebabkan FFmpeg gagal mengekstrak frame dengan pesan error `Invalid NAL unit size`.
  - Kini, seluruh offset chunk di dalam atom `moov` disesuaikan sebesar `+moov_size`, sehingga FFmpeg dapat membaca sampel frame video dengan presisi dan menghasilkan thumbnail HD berukuran jernih (~78KB) secara instan tanpa perlu mengunduh seluruh file video.
- **Deteksi Otomatis Dokumen Video via `d.raw.video`**:
  - Memastikan berkas video yang diunggah sebagai dokumen tanpa ekstensi `.mp4` standar atau ber-MIME `application/octet-stream` tetap terdeteksi secara presisi sebagai video dan diproses melalui alur ekstraksi frame HD.
- **Pencarian Dinamis Biner FFmpeg Windows (`find_ffmpeg_binary`)**:
  - Mengakomodasi nama biner `ffmpeg-*.exe` (seperti `ffmpeg-win-x86_64-v7.1.exe`) serta jalur pencarian hingga ke direktori virtualenv `worker/venv`.

## v2.1.91 Autodeteksi Lokasi Biner FFmpeg Windows & Ekstraksi Frame Video Otomatis

### Perbaikan Utama Visual Media & Grid
- **Pencarian Biner FFmpeg Windows Tingkat Lanjut (`find_ffmpeg_binary`)**:
  - Mengoreksi penemuan biner `ffmpeg.exe` di backend Rust (`grammers_media.rs`).
  - Sebelumnya, jika `ffmpeg` tidak terdaftar di variabel lingkungan `PATH` Windows, fungsi `find_ffmpeg_binary` mengembalikan nilai kosong (`None`), menyebabkan ekstraksi frame video visual mengalami *miss* dan menghasilkan error `no valid thumb found`.
  - Kini, backend secara cerdas memindai direktori aplikasi Windows populer seperti `C:\Program Files`, `C:\Program Files (x86)`, `C:\Program Files\BlueStacks_nxt`, `C:\Program Files\FormatFactory*`, `%LOCALAPPDATA%`, `C:\ffmpeg`, dan `cache/bin`.
  - Biner `ffmpeg.exe` yang sudah terpasang di komputer pengguna kini ditemukan secara otomatis tanpa memerlukan konfigurasi manual variabel `PATH`.

## v2.1.90 Perbaikan Duplikasi Offset Chunk & Korupsi Header Sampel Media

### Perbaikan Utama Visual Media & Grid
- **Perbaikan Iterator Sampel Media Utuh (*Single Contiguous Iterator*)**:
  - Mengoreksi logika unduh sampel media di `grammers_media.rs`.
  - Sebelumnya, pemeriksaan sampel 64KB pertama menyebabkan pembagian offset `skip_chunks(64KB / 256KB)` bernilai `0`, yang mengakibatkan chunk 0 (0-256KB) diunduh dua kali dan digabungkan secara ganda.
  - Duplikasi chunk 0 ini merusak struktur header berkas MP4/JPEG (header `ftyp` / `JPEG EOI` terduplikasi di tengah buffer), sehingga FFmpeg gagal memproses frame video dan mengembalikan error `no valid thumb found`.
  - Kini, backend menggunakan iterator kontigu tunggal 256KB sejak awal, menghilangkan duplikasi header dan menjamin ekstraksi frame video MP4 berjalan 100% lancar.

## v2.1.89 Autodeteksi Magic-Bytes Media & Eliminasi Error 'No Valid Thumb'

### Perbaikan Utama Visual Media & Grid
- **Autodeteksi Header Berkas (*Magic-Bytes Detection*)**:
  - Mengoreksi penanganan media dokumen di backend (`grammers_media.rs`).
  - Sebelumnya, berkas foto atau video yang diunggah ke Telegram dengan MIME jenis `application/octet-stream` atau tanpa ekstensi file resmi (seperti `photo_42607`) diabaikan oleh filter ekstensi, memicu log error `no valid thumb found`.
  - Kini, jika ekstensi atau MIME type tidak eksplisit, backend secara otomatis membaca 64KB chunk pertama untuk memeriksa penanda biner (*magic bytes*): JPEG (`0xFF 0xD8 0xFF`), PNG (`\x89PNG`), WebP (`RIFF...WEBP`), GIF (`GIF8`), MP4/MOV (`ftyp`/`moov`), MKV/WebM (`0x1A 0x45 0xDF 0xA3`), dan AVI.
  - Jika cocok dengan penanda gambar/video, media langsung diklasifikasikan dengan benar dan thumbnail HD-nya berhasil dibuat tanpa error.

## v2.1.88 Perbaikan Auto-Retry & State Lockout Thumbnail Kartu Grid

### Perbaikan Utama Visual Media & Grid
- **Auto-Retry Pemuatan Thumbnail Kartu Grid**:
  - Mengoreksi penanganan *soft-fail* (`getCachedThumb`) dan siklus hidup pemintaan thumbnail pada kartu media (`DriveFileCard.tsx`).
  - Sebelumnya, jika permintaan awal thumbnail mengembalikan status sementara `null` (misalnya karena antrean RPC padat saat awal memuat folder), kartu media mengunci status pada tampilan kosong dan tidak pernah meminta ulang (*retry*) setelah masa pending berakhir.
  - Saat pengguna membuka dan menutup modal pratinjau (*preview*), modal secara paksa mengisi memori cache dan memicu event refresh, yang menyebabkan gambar thumbnail baru muncul secara tiba-tiba.
  - Kini, kartu grid akan mendeteksi status *soft-fail* sementara dan secara otomatis menjadwalkan permintaan ulang (*auto-retry*) dalam 1.5 detik jika kartu masih tampak di layar, sehingga thumbnail langsung terisi otomatis tanpa perlu membuka pratinjau.

## v2.1.87 Perbaikan Decoding Thumbnail Foto/Gambar Document (>256KB)

### Perbaikan Utama Visual Media & Grid
- **Pencegahan Berkas Gambar Terpotong (*Truncated JPEG/PNG*)**:
  - Mengoreksi logika unduh *fallback* media gambar pada berkas foto dokumen tanpa thumbnail statis Telegram.
  - Sebelumnya, batas unduh dipotong paksa pada `256KB` (mode Seimbang), menyebabkan berkas foto berukuran >256KB (seperti `29-6.jpg` 344.9KB) terpotong sebelum penanda *End-Of-Image* (`0xFF 0xD9`).
  - Pemotongan tersebut memicu error decoding gambar di browser (`onError`) yang menyebabkan kartu media berubah menjadi kartu kosong hitam.
  - Kini, backend mengunduh data gambar utuh hingga ukuran berkas sebenarnya (sampai 8MB), menjamin struktur JPEG/PNG 100% valid dan dapat dirender dengan sempurna di grid.

## v2.1.86 Perbaikan Pemuatan Thumbnail Video MP4 Non-Faststart & Large Media

### Perbaikan Utama Visual Media & Grid
- **Ekstraksi Frame Video MP4 Non-Faststart (Snaptik/TikTok & Video >5MB)**:
  - Mengoreksi penanganan berkas MP4 dengan struktur metadata `moov` berada di akhir berkas (seperti video hasil unduhan Snaptik/TikTok atau video berukuran besar >5MB).
  - Melakukan rekonstruksi otomatis buffer video faststart (menempatkan atom `moov` di depan `mdat` dengan penyesuaian header ukuran atom) sebelum diproses oleh FFmpeg. Hal ini memungkinkan ekstraksi gambar mini (thumbnail HD) berhasil secara presisi tanpa perlu mengunduh seluruh berkas video yang berukuran puluhan hingga ratusan Megabyte.
- **Dukungan Fallback Thumbnail Mini (Tier 6)**:
  - Memastikan jika ekstraksi frame video HD tidak dapat dilakukan, sistem akan beralih menggunakan gambar mini (*mini-thumbnail*) resmi Telegram sebagai tampilan cadangan pada kartu grid, sehingga tidak ada kartu media yang tampil dengan ikon kosong/filmstrip.

## v2.1.85 Perbaikan Disconnect Loop & Handling FloodWait Telegram

### Perbaikan Utama Handling FloodWait & Rate Limit
- **Eliminasi Disconnect & Reconnect Storm (`grammers_ops.rs`)**:
  - Menghapus `TgErrorCode::FloodWait` dari pencocokan `is_pool_or_transport_error()`. Saat Telegram DC mengembalikan `FLOOD_WAIT`, koneksi MTProto tetap dijaga dan tidak diputus paksa (*disconnect*). Ini menghentikan siklus reconnect berulang (hingga 70+ kali) yang memicu lonjakan handshake dan memperparah pembatasan Telegram.
- **Penyelarasan Concurrency Thumbs Batch (`grammers_media.rs`)**:
  - Mengurangi batas tugas unduh thumbnail simultan (`thumb_sem`) dari 6 menjadi 2 koneksi paralel over MTProto. Hal ini mencegah lonjakan permintaan `GetFile` yang memicu FloodWait saat memuat daftar media dalam folder secara bersamaan.
  - Memeriksa status `flood_remaining_secs` di `thumbs_batch` sebelum mencoba unduhan baru agar media tanpa cache tidak memicu RPC saat FloodWait sedang aktif.
- **Fail-Fast Active Flood Window (`grammers_media.rs` & `telegram_ops.rs`)**:
  - `start_preview_stream_blocking` langsung mengembalikan error `FLOOD_WAIT` saat masa tunggu aktif (`secs > 0`), menghindarkan pemblokiran thread Tauri atau penumpukan panggilan pratinjau yang gagal.
  - Mengubah tingkat log pada error `preview_stream` yang diharapkan saat FloodWait menjadi peringatan (*warning*), mencegah penumpukan puluhan pesan error identik di log sistem.

## v2.1.84 Perbaikan False FloodWait & Optimalisasi Kecepatan Pemuatan Media

### Perbaikan Utama FloodWait & Kecepatan Media
- **Eliminasi Self-Imposed FloodWait Lockout (`session_rate.rs`)**:
  - Memperbaiki `parse_flood_secs()` dan `note_error()` agar hanya mencatat FloodWait jika pesan atau kode error berasal dari Telegram RPC `FLOOD_WAIT` asli.
  - Menghapus pencocokan kata generik `"tunggu"` dan penguncian 30 detik palsu pada error non-FloodWait (seperti `Timeout`, `Network`, `Cancelled`, `Io`, `Internal`).
- **Optimalisasi Concurrency & Speed Pemuatan Media (`grammers_media.rs`)**:
  - Menambahkan pembatasan tugas unduh paralel (*bounded concurrency semaphore* maks 6 koneksi simultan) pada `batch_fetch_thumbs` untuk mencegah ketersendatan koneksi MTProto saat memuat grid media massal.
  - Memperbesar ukuran *chunk download* `iter_download` dari 64KB/128KB menjadi 256KB/512KB pada penarikan thumbnail, sampel video, dan streaming media untuk meningkatkan kecepatan transfer hingga 2x-4x lipat.

## v2.1.83 Penyelarasan Kualitas & Kerapian Thumbnail (Hemat, Seimbang, Jelas)

### Perbaikan Utama Kualitas Thumbnail
- **Penyelarasan Urutan Resolusi Layers**: Mengoreksi logika pemilihan layer thumbnail pada media (foto & video). Sebelumnya, pengurutan ukuran layer berdasarkan byte `size` menyebabkan layer resolusi tinggi yang memiliki `size == 0` terdorong ke urutan awal dan menyajikan thumbnail mini/blur (90px / 32px) pada mode Seimbang dan Jelas.
- **Penyelarasan Mode Hemat, Seimbang & Jelas**:
  - **Mode Hemat**: Menggunakan mini-thumb/stripped (32x32) atau layer terkecil untuk menghemat penggunaan kuota internet.
  - **Mode Seimbang**: Memilih layer thumbnail resolusi menengah-tinggi (320px–800px) yang jernih dan tajam pada kartu grid tanpa mengunduh berkas utuh.
  - **Mode Jelas**: Memilih layer thumbnail resolusi tertinggi yang tersedia di Telegram (hingga 1280px/2560px), serta mengekstrak frame video HD (1080p) pada JPEG quality tinggi untuk tampilan visual maksimal.
- **Pencegahan Blur Placeholder pada Non-Saver**: Memastikan komponen kartu grid tidak mengunci tampilan pada gambar mini buram saat mode Seimbang atau Jelas aktif, melainkan memuat dan menampilkan thumbnail resolusi tinggi yang sesuai.

## v2.1.82 Session & Chat List Load Speed Optimization

### Optimization Summary
- **Concurrent MTProto Requests (`grammers_ops.rs`)**: Converted `session_operation_lock` from an exclusive Mutex to a concurrent `tokio::sync::RwLock<()>`. Read operations (`list_dialogs`, `list_media`, `list_topics`, `auth_status`) now execute in parallel over Grammers `SenderPool` instead of running serially.
- **Authorization Profile Cache**: Cached user profile authorization in `CachedLiveClient`, skipping redundant MTProto `get_me` network RPC calls on warm sessions.
- **Parallel Credential & Session Boot**: Optimized session picker boot flow to resolve local session inventory in parallel with credential bootstrap.

## v2.1.81 Stream cancel thrash + Grammers album

### Root cause (buffer % macet + “Stream bermasalah”)
Dari `worker/cache/stream_registry` + `worker/temp`:
- Semua stream aktif berakhir `cancelled:true` dengan range kecil (0.25–1.5MB).
- `stopAll incomplete` + `delete_partial=true` mematikan GetFile dan menghapus partial.
- Hard-recover `onError` → force `loadPreview` memperburuk thrash.

### Fixes
- Jangan `stopAll` saat unmount; stop hanya stream id aktif.
- Default **jangan hapus partial** (resume unduhan).
- `register_stream` **reuse** path yang masih live.
- Resume disk/manifest untuk file large progressive.
- Hapus hard-reload “Stream bermasalah” dari onError thrash.

### Migrasi Grammers
- **Album lokal 2–10 file** via `send_album` (orch dual-path).

## v2.1.80 Video play stuck + buffer speed (34.mp4 class)

### Screenshot issue (buffer ada, video di 0:00)
- **stream_status**: prefer Telethon `moov_ready` (Rust registry saja tidak punya moov → play nudge macet).
- **onError progressive**: rebind URL yang sama untuk clear `MEDIA_ERR` sticky, lalu `play()` — bukan stuck di “menunggu data stream”.
- **Play nudge** agresif (≤900ms) saat prefix/moov/duration siap; auto-resume jika pipeline `paused`.
- Buffer bar: tidak lagi di-cap palsu 35%.

### Kecepatan load / buffer
- Tier streaming (~100MB): workers 24–26, chunk 512KB, initial_head lebih padat.
- Slow link: **tambah** worker (bukan potong) — latency-bound GetFile.
- Document MP4: kick moov-tail lebih awal (~96KB head) + bootstrap async.
- first_play wait sedikit lebih sabar agar head padat sebelum handoff.

## v2.1.79 Fix video preview reload loop + stream hardening

### Critical fix
- **Preview video tidak lagi memuat ulang terus-menerus saat buffering** (multi-video).
- Akar: `onError` → `loadPreview` penuh pada progressive hole/503; remount `<video>` tiap ganti URL; soft revalidate bikin `stream_id` baru; cache stream mati 90s.
- Perbaikan: sticky stream URL/id, key video stabil, onError soft (cooldown), missing status ≥3×, cache progressive TTL pendek, video progressive wajib Telethon (moov/seek).
- Rust stream: `stream_ready` lebih ketat; Range head lebih toleran.

### Catatan migrasi
- Grammers tetap: list/thumbs/topics/upload/download image.
- Video progressive: Telethon + Rust Range (hybrid) sampai multi-DC seek di Grammers siap.

## v2.1.78 Phase 6 — Progressive stream + thumbs + topics (Grammers)

### Progressive stream (Rust)
- **`tg_preview_stream` / `grammers_media`:** sequential GetFile fill → preallocated partial file → registry → Rust Range HTTP.
- Small images: full download (no stream). Video/audio: play-while-download sequential.
- **`tg_stop_stream`:** cancel progressive fill.
- `drivePreview` dual-path when Telethon warm idle + quality auto (transcode tetap Telethon/ffmpeg).
- `driveStreamStatus` prefers local Rust registry first.

### Thumbs + topics
- **`tg_thumbs_batch`:** batch message thumbs via Grammers PhotoSize (inline cached first, then mid-size download).
- **`tg_list_topics`:** `messages.getForumTopics` raw TL.
- Wired into `driveThumbnailsBatch` / `driveListTopics` with exclusive-session guard.

### Masih Python (sengaja)
- Multi-DC concurrent seek stream, album/reencode, migration engine.

## v2.1.77 Phase 5 — Drive dual-path list + Grammers download

### Grammers / full-Rust progress
- **Drive list dual-path:** `driveListFiles` / `driveListChats` mencoba Grammers dulu **hanya jika** warm Telethon `drive-serve` tidak memegang session (anti AUTH_KEY_DUPLICATED).
- **`tg_download_file`:** unduh penuh media ≤200MB via Grammers; file lebih besar tetap progressive Telethon stream.
- **Open/doc download dual-path:** `driveDownloadOpenSpawn` mencoba Grammers setelah exclusive session, fallback Telethon download.
- **Settings → Telegram Backend:** toggle runtime Grammers vs Telethon-only.
- Compile-fix Grammers 0.10: `offset_id` (bukan `max_id`), media size sebelum partial move.

### Masih Python (sengaja)
- Progressive GetFile / multi-DC stream, thumbs batch, topics, album/reencode, migration engine.

## v2.1.76 Grammers-first studio orch (honest hybrid, not full cutover)

### Status
- **Belum full Grammers.** Drive warm RPC, progressive GetFile, media-studio album/reencode, migration tetap **Python Telethon**.
- **Sudah Grammers-first:** studio orchestrator upload lokal → `grammers_ops::upload_file` dulu; gagal → `studio-serve` Telethon; UI masih bisa media-studio.
- Default env preferensi: `AUTOGRAM_TELEGRAM_BACKEND=grammers` (force telethon: `=telethon`).
- Import session Telethon → `.grammers.json` otomatis saat orch Grammers.

### Masih Python (sengaja)
- drive-serve, media_stream GetFile, full media_studio, migration engine, auth_manager legacy.

## v2.1.75 Fix overhead looping (preview poll + session ready)

### Performance
- **DrivePreviewModal** stream poll: hapus `seekWarn`/`loadPreview` dari deps effect (mencegah interval di-recreate tiap setState → overhead loop).
- Poll stream: 600ms cold → 1800ms setelah healthy; play-nudge max 1×/2.5s; skip tick overlap (`pollInFlight`).
- **driveSession** ready wait: interval 40ms → 120ms + resolve event-driven saat stdout `ready`.
- Live sync interval sedikit lebih longgar (low/mid/high).

### Remote
- `frontend.exe` path: `npm run build:exe` / auto-build di ensure.
- Suite minimal `run.mjs`; probe scripts dibersihkan.

## v2.1.74 Grammers dual-path compile-fix + multi-layer debug logs

### Stability (pasca migrasi)
- Perbaikan kompilasi Grammers 0.10: `PeerId` → i64, `Peer/User::to_ref`, FloodWait `Option<u32>`, `UploadFileRequest` Deserialize, lifetime async orch.
- Default runtime **tetap Telethon companion** untuk Drive/stream/studio; Grammers ops opsional via env/`tg_*` commands.
- Cleanup bloat: hapus `target/`, archive, Source ref, CDP probes (build ulang `frontend.exe` diperlukan).

### Debug mode (lengkap lintas layer)
- **Frontend:** buffer 800 baris; `debugLogLayer`; ingest `[autogram:tg]`, FloodWait, traceback, studio-serve.
- **Rust:** `tg_log` gate by `AUTOGRAM_DEBUG` / flag file; worker spawn log env (backend, stream port, debug).
- **Python:** `dlog` + `layer=python` + `tg_backend`; daemon start logs stream/proxy/backend.
- Env worker: `AUTOGRAM_DEBUG`, `AUTOGRAM_SESSIONS_DIR`, `AUTOGRAM_TELEGRAM_BACKEND` di-inject saat spawn.

### Catatan testing
- Remote CDP butuh `npm run tauri build -- --debug` setelah target di-clean.
- Aktifkan **Settings → Debug Mode** untuk log detail di UI + `worker/temp/autogram_debug.log`.

## v2.1.73 Upload UI → Rust Orchestrator Default + Full-Rust Scaffold

### Upload path (UI)
- **Default:** Media Studio upload queue memakai `studioRunUploadDefault` (Rust `studio_run_orchestrated` + Python `studio-serve`).
- **Fallback otomatis:** legacy `driveUploadSpawn` / media-studio jika:
  - remote URL (`http`/`https`),
  - multi-file album (`group_as_album`),
  - runtime non-Tauri, atau
  - orch gagal / command tidak tersedia.
- Exclusive session: `withExclusiveTransferSession` (lease + stop warm drive-serve) dipakai orch path agar tidak bentrok `.session`.
- Saved Messages: `chat_id = "me"`.

### Full Rust bertahap (scaffold)
- `core/telegram_ops.rs`: trait `TelegramOps`, `TelethonCompanionOps`, `GrammersStubOps` (belum diaktifkan).
- Capability `telegram_ops_trait`; backend produksi tetap hybrid Telethon.

### Catatan
- Progress live per-byte masih lebih kaya di path media-studio; orch memetakan status terminal item dari `TransferRecord`.
- Grammers **tidak** di-wire ke upload — hanya stub + docs.

## v2.1.72 Phase 3 — Studio Job Queue di Rust (Python Step Upload)

### Orkestrasi
- **Rust** `job_queue` + `studio_orch`: antrean transfer/item, FSM (pending→uploading→done/failed), persist `studio_queue.json`.
- **Python** `studio-serve` (daemon `--action studio-serve`): RPC stdin `begin` / `upload_one` / `finish` / `quit`.
- Upload per-item memanggil pipeline fastlane existing (satu file) — Telethon tetap di Python.
- Tauri: `studio_enqueue`, `studio_list_transfers`, `studio_get_transfer`, `studio_run_orchestrated`.
- Frontend helper: `src/lib/studioOrch.ts` (dual-path; legacy `media-studio` utuh).

### Catatan
- Legacy full-batch `media-studio` **tidak dihapus**.
- Orchestrator mengurutkan item (ordered commit tetap di pipeline item tunggal).

## v2.1.71 PDF Preview: Full Download (Anti Partial Stream)

Fixed:
- PDF ~700KB+ gagal di iframe dengan **We can't open this file** karena unduhan partial/progressive (batas lama 512KB) masuk stream Range yang tidak diterima viewer PDF Chromium/WebView2.
- PDF kini diunduh **lengkap** (hingga `DOC_PREVIEW_MAX` 48MB) sebelum pratinjau; validasi header `%PDF-`.
- Frontend hanya memasang `iframe` src jika file complete (path cache atau stream done); prefer `convertFileSrc(path)`.

## v2.1.70 Proxy/VPN dari Telegram-Drive + Telethon Hybrid

### Proxy & VPN Optimizer (fitur Telegram-Drive → AutoGram)
- Rust `core/network.rs`: simpan `network_settings.json`, SOCKS5/HTTP/MTProto fields, VPN timeout/retry/bandwidth knobs.
- Commands: `network_get_config`, `network_apply_*`, `network_test_proxy`, `network_is_available`, `network_detect_vpn`.
- Env worker: `AUTOGRAM_PROXY_*`, `AUTOGRAM_VPN_*` di-inject saat spawn Python.
- Python `core/network_env.py` + `client.py` / `drive_fs` / `media_studio`: Telethon memakai proxy + retries VPN.
- UI **Settings → Proxy & VPN Optimizer** (desktop).
- Deps: `python-socks`, `PySocks`.

### Catatan
- Setelah ubah proxy: reconnect Drive session agar worker baru memuat env.
- MTProto proxy butuh secret hex valid; SOCKS5 paling stabil.

## v2.1.69 Hybrid Phase 2 — Rust Stream Server + Local Utilities

### Stream (Rust + Python companion)
- **Rust Range HTTP** (`core/stream_server.rs`, tiny_http): serve progressive/complete media from registry.
- Python **GetFile** only: publishes ranges via `POST /register` + `cache/stream_registry/*.json`.
- Env `AUTOGRAM_STREAM_PORT` / `AUTOGRAM_STREAM_REGISTRY` injected when spawning workers.
- When Rust aktif: Python **tidak** start aiohttp; `stream_url` → `127.0.0.1:{rust}`.
- Fallback: tanpa env port, perilaku lama (aiohttp Python) tetap utuh.
- Pause/resume di Rust + flag registry dibaca Python fill loop.

### Local utilities (Rust)
- `zip_local` — list + preview entry ZIP cache
- `hash_util` — SHA256 + quick fingerprint
- `progress_rate` — % / Bps / ETA
- `config_normalize` — job config cleaning
- Tauri commands + `rustBackend.ts` wrappers

## v2.1.68 Hybrid Rust-First Backend Foundation

Architecture:
- Dokumen `HYBRID_RUST_PYTHON.md`: batas kepemilikan Rust vs Python (Telethon tetap companion).
- Modul Rust `core/`: `capability`, `streaming_policy`, `path_policy`, `doc_preview`.
- Tauri commands: `backend_capabilities`, `streaming_config_for_size`, `preview_local_document`, `path_policy_check`.
- Frontend `rustBackend.ts` + pratinjau teks **Rust-first** saat path cache ada (fallback Python/stream).

Safety:
- Tidak memindahkan Telethon; upload/migration/drive-serve tetap Python.
- Dual-path: kegagalan Rust local preview tidak memutus alur unduh Telegram.

## v2.1.67 Start Video Multi-Tier + Pratinjau Dokumen/Kode Cepat

### Video (semua ukuran)
- **17 size tier** streaming: &lt;10 / 20 / 50 / 100 / 150 / 200 / 250 / 300 / 500 / 1000 / 1500 / 2000 / 2500 / 3000 / 3500 / 4000 / 4000+ MB.
- Tiap tier punya `first_play`, `initial_head`, `window`, `throttle`, `workers`, `chunk` terpisah — file besar start dengan head lebih ramping; file kecil head lebih padat.
- Hand-off `stream_url`, HTTP 206 pertama, dan `stream_ready` memakai **first_play** tier (bukan window multi-MB).
- Document-mode video tidak lagi memaksa head 1–4MB; prioritaskan first_play + worker media DC.
- Poll UI 450ms + nudge play agresif (≥96KB / HAVE_METADATA).

### Dokumen & kode
- Ekstensi teks/kode diperluas (JS/TS/Py/Go/Rust/Java/C/C++/Shell/SQL/GraphQL/infra, dll.) di worker + frontend.
- **Office in-app**: docx/odt/rtf/xlsx/ods/pptx/odp → ekstraksi plain text untuk pratinjau langsung.
- Inline `text_content` hingga **2MB**; fast download teks hingga 2MB / office 4MB / PDF 512KB.
- Batas pratinjau dokumen progresif naik ke **48MB**.

## v2.1.66 Perbaikan Pratinjau Dokumen/JSON (Failed to Fetch)

Fixed:
- **detail.json / teks gagal preview**: file lengkap di-register ke stream HTTP dengan `ram_buffer` kosong sehingga respons berisi null-byte; kini file complete dilayani dari disk + `mark_done` benar.
- **Inline text**: worker mengembalikan `text_content` untuk dokumen ≤1MB agar UI tidak bergantung fetch `http://127.0.0.1/stream/...`.
- **Coba lagi stuck**: cache stream URL mati (port lama) dipakai ulang; retry kini `force` + invalidate cache.
- **Fallback fetch teks**: urutan inline → data URL → path Tauri → HTTP stream, dengan pesan error yang jelas.

## v2.1.65 Start Playback Cepat untuk Video Besar (Anti Buffering Awal)

Fixed & Optimized:
- **Akar "Buffering… 40%" di 0:00**: server HTTP Range sebelumnya mengklaim window multi-MB di `Content-Range` meskipun data solid belum siap, sehingga browser menunggu seluruh window → buffering panjang. Kini respons hanya mengklaim **byte solid yang sudah terisi** (slice pertama ≤512KB) dan menutup response cepat agar player re-Range.
- **Full GET tanpa Range** tidak lagi mengirim `Content-Length` = ukuran file penuh saat unduhan belum selesai (penyebab klasik hang buffering).
- **Prioritas head**: unduhan head playable (256–512KB) diselesaikan dulu; moov/tail baru setelahnya — menghentikan starvation bandwidth di file ≥30–100MB+.
- **Tail seek ditunda** sampai head siap (bukan fire-and-forget 4MB tail bersamaan buka preview).
- **Konfigurasi layer** media besar: `initial_head` lebih ramping, worker head lebih agresif; document-mode head 0.5–1.5MB.
- **UI**: indikator buffer tidak lagi menampilkan % unduhan Telegram seolah-olah player sudah siap; cap display sampai frame browser tersedia.

## v2.1.64 Perbaikan Celah Session Drive, Seek Video, dan Start Playback saat Buffer Tinggi

Fixed:
- **Regresi seek video**: memulihkan body `handleSeekJump` yang hilang (tanpa pemanggilan `driveStreamSeek`) sehingga scrub ke area di luar buffer browser kembali memicu unduhan offset Telegram (mode YouTube) dan men-nudge `<video>` setelah data tiba.
- **Seek deadlock**: kick seek sekarang juga dari `onSeeking` (bukan hanya `onSeeked`) dengan debounce, karena seek ke hole sering tidak memancarkan `seeked` sampai data Range siap.
- **Video tak start padahal buffer tinggi**:
  - Nudge `play()` diperbaiki agar tidak berhenti ketika `readyState >= 3` tetapi elemen masih `paused`.
  - Event `pause` dari autoplay gagal tidak lagi membekukan unduhan Telegram (`/pause`) sebelum playback sungguhan dimulai.
  - Pipeline worker tidak menunda unduhan head playable meskipun flag `paused` true.
  - `stream_ready` kini mensyaratkan `moov` (head/tail) untuk MP4 dokumen, agar UI tidak menganggap stream siap saat metadata belum ada.
- **Konflik session / “drive session sedang digunakan”**:
  - `ensureDriveSession(needPreview=true)` hanya memakai ghost `_preview` saat transfer lease aktif; di luar transfer selalu memakai session main (menghindari thrash clone + race lock).
  - `driveSessionCallFor` menandai RPC preview/stream agar re-bootstrap yang benar saat session putus.
- **Stream putus**: auto-recover satu kali saat `stream_status` melaporkan `missing`/`cancelled`.

Tests:
- Unit worker: 20 tests stream (seek, stop, moov, status ready) lulus.
- Frontend Vitest: 112 tests lulus.

## v2.1.63 Optimalisasi Bandwidth dan Pencegahan Starvation Koneksi Video Playback

Fixed:
- Mengatasi masalah pemutaran video yang macet/freeze meskipun indikator buffer browser sudah tinggi. Masalah ini disebabkan oleh starvation koneksi Telegram akibat prefetching paralel terhadap file-file tetangga (neighbor files) yang memicu puluhan stream aktif secara bersamaan dan memicu pembatasan kecepatan (rate-limiting) Telegram. Prefetching kini otomatis dinonaktifkan jika file aktif yang sedang diputar berupa video, memastikan seluruh bandwidth dan slot koneksi dialokasikan khusus untuk pemutaran video utama.

## v2.1.62 Perbaikan Tabrakan ID Pekerja Tauri (991005) dan Penyelarasan Aligment Seek Keyframe Video

Fixed:
- Memperbaiki galat `No stdin for job 991005` yang menyebabkan kegagalan koneksi (*Lost Connection*) saat menekan tombol "Coba lagi" (Retry) di pratinjau media. Masalah ini disebabkan oleh tabrakan alokasi ID pekerjaan (`activeJobId` generasi) dengan `API_SERVER_JOB_ID` (991005). Nilai `DRIVE_SERVE_JOB_ID_BASE` kini digeser ke `992000` agar alokasi ID pekerjaan terpisah sepenuhnya secara eksklusif.
- Memperbaiki masalah pemutaran video yang lambat dimuat atau macet pada buffering (*infinite buffering loop*) saat melakukan seek. Penyelarasan kini memaksa offset byte yang didapat dari indeks keyframe untuk selalu disejajarkan (*aligned*) ke kelipatan ukuran part Telegram (`self.part_size`), mencegah galat `OFFSET_INVALID` dari server Telegram.

## v2.1.61 Resolusi Galat CORS/Fetch pada Pratinjau Dokumen, Penanganan exception Streaming Server, dan Penyelarasan is_doc

Fixed:
- Memperbaiki kegagalan pembacaan (*Failed to fetch* / CORS error) pada pratinjau dokumen teks dan PDF yang diakses via browser. Masalah ini disebabkan oleh hilangnya argument `media` saat memanggil `write_media_range_to_response` pada skenario Full GET stream server lokal, yang memicu AttributeError internal dan CORS blocking.
- Mengatasi resiko kegagalan pembandingan tipe `None` (*TypeError*) pada pengecekan jangkauan bytes di stream server jika ukuran file tidak diketahui secara pasti.
- Menambahkan penangkap exception global (*try...except*) pada endpoint `serve_stream` dan `serve_events` untuk memastikan server lokal selalu memberikan respon HTTP terstruktur dengan CORS header lengkap, mencegah *Failed to fetch* akibat kegagalan unhandled.
- Mengoreksi penentuan mode berkas video `is_doc` agar tidak salah mengklasifikasikan dokumen dokumen non-video (seperti `.txt` atau `.pdf` berukuran kecil) sebagai video mp4, yang sebelumnya mengganggu pendeteksian tipe media di frontend.

## v2.1.60 Penyelarasan Range Sesi Selesai (mark_done) untuk Resolusi Galat 'Failed to Fetch' Preview Dokumen

Fixed:
- Memperbaiki kegagalan pembacaan (*Failed to fetch*) pada pratinjau dokumen bertipe teks (`.txt`, `.json`, dll) dan PDF (`.pdf`) yang diunduh secara penuh. Masalah ini dipicu oleh tidak terisinya daftar jangkauan yang solid (`self._ranges`) pada pemanggilan `mark_done` untuk aliran data non-progresif. Akibatnya, server lokal mengirimkan tanggapan kosong (0 byte) meskipun header `Content-Length` terisi penuh, yang berujung pada pemutusan koneksi sepihak dan galat penarikan data (*fetch TypeError*) di peramban.

## v2.1.59 Optimasi Sensitivitas Startup & Reduksi Budget Buffer Awal/Tail Video Dokumen Besar (>100MB)

Fixed & Optimized:
- Mengurangi ukuran penyangga awal (*initial head buffer*) untuk berkas video bertipe dokumen dari rentang 8MB–16MB menjadi **1MB–4MB** saja (1% dari ukuran berkas). Hal ini sangat memotong durasi tunggu sekuensial awal sehingga video besar dapat langsung mulai diputar.
- Membatasi anggaran penyangga dinamis ekor berkas (*fallback dynamic moov tail budget*) untuk video dokumen dari 32MB menjadi **8MB** (atau 1/16 dari total ukuran) guna mempercepat proses unduhan metadata `moov` jika deteksi posisi atom presisi tidak berhasil.
- Mengabaikan pemeriksaan nomor generasi seek (*seek generation check*) khusus untuk unduhan latar belakang inisiasi moov tail (`_bootstrap_moov_at_end`). Hal ini mencegah pembatalan tak sengaja pada unduhan metadata krusial saat pemutar peramban menginisiasi pemutaran pada playhead 0.
- Meningkatkan batas penundaan waktu tunggu HTTP read socket stream (*wait_for_bytes*) menjadi **120 detik** (2 menit). Peningkatan batas penundaan ini mencegah server lokal mengembalikan kode `503` terlalu dini pada jaringan yang lambat, sehingga menghindarkan pemutar media peramban dari siklus galat dan pemuatan ulang tanpa henti (*infinite reload loop*).

## v2.1.58 Penyelarasan Mime-Type PDF In-App & Optimalisasi Sensitivitas Buffering Pemuatan Awal Progressive Streaming

Fixed & Optimized:
- Mengatasi masalah pratinjau berkas PDF (`.pdf`) yang tidak tampil di dalam aplikasi dengan memaksa pengaitan *MIME type* ke `application/pdf` secara konsisten pada proses pembuatan maupun pembacaan cache, membebaskannya dari kesalahan pendugaan tipe pada sistem operasi Windows (*Windows Registry default guess failure*).
- Menghilangkan jeda *buffering* (penangguhan awal) selama 25 detik pada pemutaran media baru dengan memindahkan inisialisasi penjadwalan pencarian data (*schedule seek 0*) ke bagian sebelum pemanggilan sinkronisasi penunggu *byte* awal.
- Mengubah tanggapan lokal *streaming server* dari `HTTP 202 Accepted` menjadi `HTTP 503 Service Unavailable` saat data *buffer* belum siap (baik pada pemuatan awal maupun pemutaran tengah/seek). Perubahan ini mencegah *browser player engine* mengalami kegagalan baca (*decoding error*) yang memicu pemuatan ulang media secara berulang-ulang (*infinite buffering loop*).

## v2.1.57 Dukungan Pratinjau Audio Progresif In-App & Penyelarasan Ekstensi File Kode Developer

Added & Optimized:
- Implementasi dukungan **Pratinjau Audio Progresif (Audio Preview)** in-app di dalam `DrivePreviewModal`. Berkas audio (`.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, `.flac`, `.opus`) kini dapat diputar langsung secara progresif (aliran data bertahap layaknya video) tanpa unduhan penuh di awal.
- Desain antarmuka pemutar audio yang sangat estetik dengan piringan hitam (*vinyl disk rotation*) yang berputar lembut saat audio aktif, visualisasi cover art/thumbnail, kontrol kecepatan putar (*playback rate*), slider volume/mute, serta visualisasi progres penyangga buffer.
- Penyelarasan format berkas teks dan kode developer antara frontend dengan backend. Mendukung pratinjau teks/kode inline instan untuk berkas berekstensi `.py`, `.rs`, `.go`, `.sql`, `.js`, `.ts`, `.jsx`, `.tsx`, `.toml`, `.env`, `.ini`, `.cfg`, `.conf`, `.html`, `.css`.
- Penyelarasan ekstensi gambar (`.svg`, `.ico`) dan video (`.ogv`) pada penentuan tipe pratinjau di frontend.

## v2.1.56 Pencegahan Balapan Bootstrap (Serialization Lock) & Penanganan Galat Stdin Rendah Level

Fixed & Optimized:
- Mengimplementasikan **serialized queue lock** (`bootstrapLock`) pada `ensureDriveSession` (`driveSession.ts`) untuk mencegah kondisi balapan (*race condition*) ketika beberapa permintaan pemuatan/inisiatif drive terjadi secara bersamaan. Hal ini mencegah proses baru membunuh instansi proses lain yang baru saja dibuat, yang sebelumnya sering memicu error *broken pipe* / *no stdin*.
- Memperbarui fungsi penjadwalan `scheduleGhostToMainTransition` agar menggunakan `ensureDriveSession` yang ter-serialize alih-alih `spawnMainSession` secara langsung.
- Memperbarui `friendlyDriveError` pada `driveApi.ts` untuk menyembunyikan galat internal tingkat rendah `no stdin for job` dan `is drive-serve running` selama siklus hidup pergantian sesi/restrukturisasi, sehingga tidak lagi menampilkan spanduk merah yang mengganggu pengguna.

## v2.1.55 Peningkatan Kestabilan Koneksi & Keep-Alive Ping Loop (Resiliensi Jaringan Telethon)

Added & Optimized:
- Implementasi **background keep-alive ping loop** pada `drive_serve.py` yang mengirimkan MTProto `PingRequest` secara periodik setiap 45 detik untuk mencegah socket TCP menjadi idle atau ditutup sepihak oleh router/proxy/VPN. Loop ini otomatis mendeteksi kegagalan ping dan memicu penyambungan ulang secara tertib.
- Peningkatan timeout inisiasi koneksi pada `_connect` (`drive_fs.py`) dari 10 detik menjadi **20 detik** untuk toleransi yang lebih tinggi pada jaringan lambat, proxy, atau VPN.
- Optimasi parameter koneksi `TelegramClient` di seluruh sistem (`client.py`, `session_authority.py`, `drive_fs.py`, `daemon.py`):
  - Mengubah batas retry koneksi (`connection_retries`) menjadi **15 kali** dengan penundaan (`retry_delay`) selama **3 detik** di antara setiap percobaan.
  - Menyetel toleransi rate limit (`flood_sleep_threshold`) secara otomatis hingga **24 jam** (`86400` detik) untuk menangani error `FloodWaitError` dengan aman tanpa crash.
  - Meningkatkan retry pengiriman request (`request_retries`) secara internal menjadi **10 kali** guna meminimalisasi error intermiten selama proses pengiriman media/perintah.

## v2.1.54 Sinkronisasi Play/Pause & Optimasi Efisiensi Data Progressive Streaming

Added:
- Implementasi sinkronisasi status pemutaran (Play/Pause) antara UI React (`DrivePreviewModal`) dengan local streaming server di backend Python (`media_stream.py`). Engine akan menunda (*suspend*) pengunduhan sekuensial di latar belakang seketika saat video di-pause untuk menghemat kuota data internet pengguna.
- Registrasi endpoint baru `/stream/{stream_id}/pause` dan `/stream/{stream_id}/resume` di lokal HTTP server dengan penyesuaian CORS middleware untuk mendukung komunikasi POST.

## v2.1.53 Perbaikan Kritikal Sistem Preview & Streaming (Otentikasi Sesi Drive)

Fixed:
- Memperbaiki kegagalan inisialisasi sesi ghost preview/migration pada modul backend drive filesystem agar memuat StringSession dari memori database secara in-memory, mencegah pembuatan file sesi SQLite kosong pada disk yang dapat memicu kegagalan otentikasi Telegram.

## v2.1.52 Implementasi AutoGram V2 Reborn Architecture (In-Memory Session Views & Async Streaming Engine)

Fixed & Added:
- Refaktor penuh sistem Session Management dengan mengintegrasikan `SessionAuthority` (Singleton) dan `GhostSessionView` untuk mendukung in-memory `StringSession` concurrent read-only preview/streaming, mengeliminasi 100% database lock conflict akibat file-copy.
- Depresiasi sistem physical file cloning dan file-based pause flag `drive_pause.txt` di Rust Tauri command dan Python worker.
- Overhaul Media Streaming Engine dengan beralih ke asynchronous server `aiohttp.web.Application` yang mendukung streaming range requests, Server-Sent Events (SSE) buffering notifications, dan non-blocking concurrent request handling.
- Penambahan verifikasi integritas data berbasis per-segment checksum manifest (.manifest.json) untuk pemulihan dan validasi status unduhan parsial yang instan tanpa pemindaian binary manual.
- Implementasi Distributed Rate Limiter berbasis database migrator pusat tanpa lockfiles fisik.

## v2.1.51 Perbaikan Reconnect Self-Healing & Rekreasi Client Instan pada Database Locks

Fixed:
- Mengubah fungsi `_live_client` pada `drive_serve.py` agar selalu menghapus `connect_error` sebelum mencoba pemulihan koneksi `_ensure_connected`. Hal ini memungkinkan aplikasi melakukan koneksi ulang secara mandiri (*self-healing*) saat pengguna menekan tombol "Muat" atau saat perintah baru dikirimkan, alih-alih terkunci selamanya dalam kondisi gagal akibat error inisialisasi awal.
- Memindahkan pembuatan objek `TelegramClient` ke dalam perulangan percobaan kembali (*retry attempt loop*) pada fungsi `_connect` (`drive_fs.py`). Dengan cara ini, setiap kali koneksi gagal karena basis data SQLite terkunci (*database is locked*) atau kesalahan transien lainnya, sistem akan membuang handle koneksi lama dan membuat instansi client baru secara bersih, menyelaraskan perilakunya dengan `media_studio.py` yang terbukti stabil.

## v2.1.50 Pencegahan Koneksi Hang (Stuck) & Resiliensi Reconnect Sesi Drive saat Streaming

Fixed:
- Mengubah default parameter `connection_retries` dari `None` (tanpa batas internal di Telethon) menjadi `5` untuk mencegah client connect loop tanpa henti yang memblokir penulisan database dan deadlock proses latar belakang.
- Menambahkan batas waktu asinkron `asyncio.wait_for(..., timeout=...)` pada pemanggilan `client.connect()` di daemon, server drive-serve, dan engine drive-fs agar proses langsung kembali gagal secara bersih (*fail-fast*) tanpa menahan lock koneksi global selamanya ketika terjadi gangguan jaringan.
- Memperbaiki helper penanganan flood `_call_with_flood` di `fast_transfer.py` agar secara otonom dapat melacak objek client target (`target_client`) dan menyambungkannya kembali secara aman dengan batasan waktu timeout 8 detik jika koneksi terputus.
- Meneruskan parameter `client` utama dari ProgressiveMedia ke `_call_with_flood` di modul streaming `media_stream.py` saat mengunduh chunk/part untuk memicu proses reconnect otomatis ketika koneksi socket terputus di tengah-tengah pemutaran streaming.

## v2.1.49 Penerapan Optimasi Buffer Multi-Layer Khusus Video Dokumen/File & Penyelarasan Batas Part boundaries

Added:
- Menambahkan pendeteksi dokumen video (`is_doc`) di fungsi `fill_stream_from_telegram` untuk memisahkan file dokumen biasa dengan video asli yang dikirim sebagai dokumen/berkas (ukuran > 50MB atau ber-MIME video).
- Menerapkan optimasi prefetch khusus dokumen video dengan menaikkan *initial head* secara agresif ke minimum 8 MB (hingga maksimum 16 MB atau 2% ukuran berkas) untuk menampung metadata `moov` atom berukuran besar secara utuh di awal putar.
- Menyetel batas konkurensi unduhan yang lebih agresif (20 workers) untuk video dokumen guna mempercepat resolusi awal video player.
- Mengubah penyelarasan range seek dan HTTP range requests agar sepenuhnya sejajar ke kelipatan part boundary Telegram (`media.part_size` dinamis: 128KB/256KB/512KB) alih-alih nilai statis 64KB, guna memangkas *double-fetching* data parsial dan mencegah kemungkinan korupsi data.

## v2.1.48 Implementasi Engine Buffer Streaming Media Adaptif 6-Layer, Zero-Copy Ring Buffer & Format Sniffing Presisi

Added:
- Mengimplementasikan 6-Layer Adaptive Buffering Classification berdasarkan ukuran berkas: Tiny (<10MB), Small (10-50MB), Medium (50-350MB), Large (350MB-1GB), Ultra (1-4GB), dan Massive (>4GB) untuk alokasi dynamic worker, prefetch window, dan initial head.
- Menambahkan Format Sniffer di awal prefetch untuk mendeteksi signature MP4, MKV, WebM, AVI, dan RIFF langsung dari 32-128 KB pertama.
- Melakukan overriding MIME-type dan memaksa mode sequential-only otomatis pada container non-MP4 seperti WebM dan MKV.
- Mengimplementasikan zero-copy memory efficiency dengan meminimalisir replikasi bytes buffer RAM via slicing `memoryview` di fungsi cache stream.
- Menambahkan mekanisme fallback DC failover otomatis ke klien utama Telegram jika terjadi pemutusan pada borrowed connection.
- Mengatur prefetch throttling yang dinamis dan bitrate-aware yang disesuaikan dengan rata-rata kecepatan unduh real-time dan durasi pemutaran media.

## v2.1.47 Fitur Pembersihan Proses Latar Belakang Otomatis untuk Fresh Start Remote

Added:
- Menambahkan modul deteksi dan pembersihan paksa proses (cleanup routine) di awal skrip `ensure-remote.ps1` yang dipanggil oleh `1-Start-Remote.vbs`.
- Skrip sekarang secara otomatis memindai dan mematikan semua proses `frontend.exe`, `node.exe` (Vite dev server), dan `python.exe` (daemon & workers) yang berjalan di direktori AutoGram atau dipanggil dengan parameter AutoGram, guna menjamin kondisi "fresh start" (semua port dibebaskan dan tidak ada tabrakan instance) setiap kali remote dijalankan.
- Mencegah penutupan diri sendiri (runner PID) dan terminal PowerShell pengembang lainnya secara aman.

## v2.1.46 Pemberantasan CPU Overhead SQLite Patch & Retransmisi Koneksi Resilient Sesi Drive

Added:
- Menghilangkan `self._conn.commit()` pada monkey-patch cursor Telethon (`client.py`, `drive_fs.py`, `media_studio.py`) untuk menghindari gangguan pada siklus transaksi bawaan Telethon dan mencegah galat database locked/korupsi data.
- Menetapkan `_patched_wal_timeout = True` segera di awal inisialisasi koneksi guna mencegah perulangan eksekusi `PRAGMA journal_mode=WAL;` yang terus-menerus gagal ketika dipanggil di dalam transaksi aktif, secara dramatis memangkas overhead CPU dan antrean locks.
- Memisahkan pragma `journal_mode=WAL` ke dalam blok try-except mandiri agar jika terjadi galat (karena berada di dalam transaksi), ia tidak menghalangi pengaturan connection-scoped lain seperti `busy_timeout` dan `synchronous`.
- Memperluas cakupan retry loop pada helper `_connect` (`drive_fs.py`) untuk menangkap dan mengulang koneksi pada kesalahan transient (seperti network drops, socket timeouts, DNS latency, dan OSError) dengan sleep backoff bertahap (`0.5 + attempt * 0.5`) guna mencegah daemon keluar prematur dengan kode 1 saat inisialisasi awal.

## v2.1.45 Optimasi Kloning Sesi SQLite Atomis & Sensitivitas Buffer Progressive Streaming

Added:
- Mengganti penyalinan berkas mentah `.session` dan companion WAL/SHM dengan API SQLite `backup()` atomis pada Python `ghost_session.py` untuk mencegah galat database locked dan korupsi berkas selama penulisan konkuren.
- Memperbarui parameter `_active_seek_offset` secara dinamis saat server HTTP membaca dan menulis berkas pratinjau progressive stream (`media_stream.py`) ke peramban. Ini mencegah downloader latar belakang terblokir/mengalami throttling permanen selama pemutaran sequential.
- Menghapus batasan ukuran chunk 4MB jika pengunduhan file pratinjau sudah selesai (`media.done` bernilai `True`), memungkinkan pemutar peramban mengunduh sisa segmen berkas dalam satu koneksi utuh tanpa HTTP Range request berulang.
- Mengubah mekanisme tunggu pemblokiran pembacaan progresif menjadi deteksi loop asinkron berbasis kondisi unduhan aktif agar lebih toleran terhadap koneksi lambat dan glitch jaringan.
- Memperbaiki kegagalan hang pengujian unit pratinjau seek acak pada `test_stream_random_seek.py`.

## v2.1.44 Optimasi Kinerja IPC Logger Sesi Drive

Fixed:
- Menghindari penimbunan log dalam memori serta pengiriman berkas log ke disk via Tauri IPC saat Debug Mode dinonaktifkan.
- Membatasi (throttle) penulisan log berkas ke disk menjadi setiap 10 detik saat Debug Mode diaktifkan, guna menghindari kemampetan antrean IPC Tauri yang dapat memperlambat transfer dan pemuatan berkas di Media Studio.

## v2.1.43 Perbaikan Import File System Tauri v2 di Sesi Drive

Fixed:
- Memperbaiki kegagalan resolusi import `@tauri-apps/api/fs` pada berkas `driveSession.ts`. Penggunaan modul file system kini diselaraskan dengan Tauri v2 dengan menggunakan `@tauri-apps/plugin-fs` dan memanfaatkan fungsi `writeTextFile` beserta opsi `baseDir` yang sesuai.

## v2.1.42 Fitur Sliding Buffer Latar Belakang & Jendela Unduhan Adaptif untuk Streaming Video

Added:
- Menghapus pembatasan unduhan langsung (early return) pada berkas video di fungsi `fill_stream_from_telegram` (`media_stream.py`). Streaming media kini terus memicu pengunduhan sequential di latar belakang saat pemutar aktif.
- Menerapkan pembatasan laju (*sliding-window throttling*) 12MB di depan playhead aktif (`_active_seek_offset`) agar pengunduhan latar belakang tidak menghabiskan bandwidth untuk segmen yang belum ditonton dan tidak bersaing dengan *seek* aktif browser.
- Memperbaiki pengecekan kemacetan pengunduhan (*stall detection*) agar mendeteksi kemacetan berdasarkan ujung titik putar aktif (*seek position-aware*) secara presisi, bukan hanya dari byte nol kontigu.

## v2.1.41 Optimasi Sensitivitas Buffering dan Mekanisme Retry Streaming Progressive Media

Added:
- Menurunkan batas minimal tunggu (wait thresholds) respon HTTP Range dari 128KB–512KB menjadi 32KB–64KB pada server HTTP lokal (`media_stream.py`). Ini mempercepat respon status `206 Partial Content` ke pemutar media browser agar video dapat diputar seketika saat data awal yang sangat kecil telah siap.
- Menambahkan perulangan percobaan kembali otomatis (retry loop) hingga 3 kali percobaan dengan penundaan (exponential sleep) pada pengunduhan chunk/part di `_download_parts_concurrent` (`media_stream.py`). Hal ini mencegah terganggunya pemutaran media akibat "lubang data buffer" akibat terputusnya koneksi sementara (transient disconnect/glitch) dengan server Telegram.

## v2.1.40 Optimasi Kecepatan Sambung Sesi Drive saat Hard Refresh

Added:
- Meningkatkan waktu tunggu (grace timeout) pembunuhan proses lama dari `150` md menjadi `350` md di antarmuka frontend (`driveSession.ts`). Ini memberi waktu yang cukup bagi sistem operasi (OS) untuk sepenuhnya mematikan proses lama dan merilis kunci (file lock) basis data sebelum proses baru dijalankan.
- Mengurangi timeout koneksi SQLite internal `_patch_session_wal` di Python (`drive_fs.py`) dari `5.0` menjadi `0.2` detik, serta mengeluarkan inisialisasi `TelegramClient` dari dalam perulangan percobaan kembali (attempt loop) pada fungsi `_connect` guna mencegah kebocoran alokasi memori dan antrean lock yang menghambat waktu muat awal hingga 5 detik.

## v2.1.39 Perbaikan Fitur Salin ID Media Menggunakan Path ID Numerik Lengkap di Media Studio

Added:
- Memperbarui fungsi "Salin ID" pada klik kanan card media di Media Studio (`SpeedTest.tsx`). Fitur ini sekarang benar-benar menyalin representasi path dari rangkaian ID unik numerik yang terstruktur (contoh: `/[peerId]/[folderId]/[messageId]`, seperti `/-10018475850/123/4567`) dan bukan nama label teks direktorinya.

## v2.1.38 Optimasi Pemulihan Sesi Drive saat Terputus (Reconnect Speedup)

Added:
- Membungkus seluruh pemanggilan `client.disconnect()` dalam blok `asyncio.wait_for(..., timeout=0.8)` pada berkas `drive_fs.py` dan `drive_serve.py`. Ini mencegah proses worker drive-serve menggantung (hang) saat mencoba memutus koneksi socket TCP yang sudah mati/setengah terbuka (half-open) dengan Telegram, yang sebelumnya dapat menghambat rilis kunci berkas SQLite (`database is locked`) dan memperlambat pemulihan koneksi sesi drive baru hingga belasan detik.

## v2.1.37 Optimasi Kecepatan Muat Awal (Buffering) Media Non-Cache di Media Studio

Added:
- Mengurangi durasi pemblokiran wait timeout (`wait_s`) pada pemanggilan RPC Tauri (`start_preview_stream_on_client` di `drive_fs.py`) menjadi maksimal `0.2` detik ketika file media belum ter-cache. Ini mempercepat pemuatan awal antarmuka pratinjau (modal UI) menjadi kurang dari 100ms.
- Mengubah alur pencarian `moov` atom (tail seek) pada berkas video dokumen berukuran sedang (<=200MB) menjadi asinkron sepenuhnya (fire-and-forget). Ini mencegah pemblokiran RPC thread hingga 14 detik dan membiarkan pemutar video browser menangani proses buffering secara mandiri dengan spinner bawaannya.

## v2.1.36 Fitur Salin ID Lengkap (Path Direktori Virtual) pada Klik Kanan Card Media Studio

Added:
- Menambahkan opsi "Salin ID" pada klik kanan (context menu) card media di Media Studio (`DriveContextMenu.tsx`).
- Opsi ini akan menyusun dan menyalin path direktori virtual lengkap dari file media tersebut (misalnya `/Grup Obrolan/Folder Utama/NamaFile.ext`) berdasarkan segmentasi remah roti (breadcrumb) aktif ke papan klip (clipboard) pengguna, serta menampilkan notifikasi toast konfirmasi.

## v2.1.35 Penyegaran Referensi File Telegram Sebelum Streaming Media di Latar Belakang

Added:
- Menambahkan pemanggilan `client.get_messages` untuk mengambil pesan Telegram segar sesaat sebelum proses pengunduhan progressive stream (`fill_stream_from_telegram` pada `media_stream.py`) berjalan. Ini menyegarkan token `file_reference` yang sudah kedaluwarsa (misalnya pada media yang merupakan hasil forward dari luar atau pesan lama dari cache IndexedDB lokal). Hal ini mencegah error `FileReferenceExpiredError` dan memastikan buffering streaming berjalan instan tanpa kendala perlambatan.

## v2.1.34 Optimasi Sinkronisasi Real-time & Progressive Streaming Dokumen dan Video Dokumen di Media Studio

Added:
- Menambahkan parameter `bypassCache: true` pada fungsi `driveListFiles` saat pemanggilan berkala (live sync polling) dan tombol muat ulang (manual refresh) di Media Studio (`SpeedTest.tsx`). Ini memaksa sistem mencari langsung ke jaringan Telegram API dan secara otomatis memperbarui IndexedDB lokal, memperbaiki kendala sinkronisasi yang lambat pada media yang diunggah dari aplikasi eksternal (Nekogram, Nagram, Telegram Mobile).
- Mengintegrasikan sistem progressive streaming (buffer) untuk file PDF, file Teks, dan Video yang dikirim sebagai Dokumen (Video Document) berukuran >512KB. File media tersebut kini dapat langsung diputar/dilihat melalui iframe PDF atau pemutar video secara instan tanpa perlu menunggu download penuh selesai.
- Memperbarui runner pengunduh latar belakang (`_runner` di `drive_fs.py`) untuk memindahkan file cache parsial menjadi file cache bersih (misal: memindahkan `.stream.pdf` ke `.pdf` atau menjalankan `ffmpeg` remux `faststart` untuk video dokumen) setelah proses pengunduhan selesai secara sukses sehingga pembukaan media berikutnya bersifat instan.

## v2.1.33 Pemilihan Topik Forum untuk Obrolan Sumber dan Tujuan serta Fitur Kirim ke General

Added:
- Mengaktifkan fitur pemilihan topik forum Telegram (sub-topic) untuk obrolan tujuan (`destValue` / Destination), melengkapi fitur yang sebelumnya hanya tersedia untuk obrolan sumber (`sourceValue` / Source).
- Memastikan modal sub-topic tetap muncul jika obrolan adalah Forum (`isForumGroup` bernilai `true`) sekalipun grup tersebut tidak memiliki topik kustom buatan user.
- Menambahkan pilihan eksplisit untuk memilih topik utama `General (Topik Utama)` menggunakan ID bawaan Telegram `1` (disimpan dalam format `chatId_1`) agar pesan dapat dikirim langsung ke thread General secara presisi.
- Menambahkan lokalisasi key `"general_topic"` pada berkas bahasa `en.json` dan `id.json`.

## v2.1.32 Fitur Pencarian Obrolan Real-time pada Modal Pemilihan Obrolan Migrasi

Added:
- Menambahkan input pencarian real-time (`searchQuery`) di bawah tipe obrolan pada modal pemilihan obrolan sumber/tujuan migrasi (`JobEditor.tsx`). Pengguna sekarang dapat mencari obrolan berdasarkan nama (case-insensitive) maupun ID obrolan secara instan.
- Menyediakan tombol pembersih cepat (`X`) untuk menghapus pencarian secara instan.
- Menambahkan lokalisasi key `"all_chats"` dan `"search_chat_placeholder"` pada berkas bahasa `en.json` dan `id.json`.

## v2.1.31 Penggunaan Sesi Kloning Preview untuk Mencegah SQLite Database Locked di Obrolan Migrasi

Fixed:
- Memperbaiki kegalauan `database is locked` SQLite saat mengeklik tombol pencarian (Browse) obrolan sumber/tujuan di tab Migrasi ketika Media Studio sedang aktif (memiliki session lock).
- Sekarang, perintah penelusuran `list-dialogs` dan `list-topics` di `daemon.py` secara otomatis menggunakan sesi kloning sementara (`_preview` suffix via `GhostSessionManager`) agar berjalan secara paralel tanpa memperebutkan lock file utama `.session`.

## v2.1.30 Filter Folder Telegram pada Modal Pemilihan Obrolan Migrasi

Added:
- Menambahkan barisan filter folder Telegram (seperti "Semua Chat", "Nagram", dll) secara horizontal di atas pilihan tipe obrolan dalam modal pemilihan obrolan sumber/tujuan pada `JobEditor.tsx`.
- Mengintegrasikan pemanggilan `driveListChatFolders` secara otomatis untuk mengambil daftar folder dari Telegram API sesuai sesi aktif.
- Memperbarui daemon backend (`daemon.py`) agar menerima parameter `--folder-id` dalam aksi `list-dialogs` dan menyaring dialog berdasarkan aturan filter folder Telegram menggunakan fungsi `_get_chat_filter_on` dan `_dialog_matches_chat_filter` dari `drive_fs.py`.

## v2.1.29 Pengekstrakan Thumbnail Launcher Icon APK dan Penyelarasan Icon Grid APK

Fixed:
- Menambahkan pengekstrakan otomatis launcher icon untuk berkas `.apk` saat proses unggah di `media_studio.py`. Sistem akan mencari file `ic_launcher` atau `icon` terbaik di dalam zip/apk secara efisien tanpa library eksternal, dan mengunggahnya sebagai `thumb` ke Telegram.
- Memperbarui `FileTypeIcon.tsx` dan `App.css` untuk menambahkan ikon bertipe `Package` dari `lucide-react` dengan warna hijau Android khas (`#a4c639`) sebagai visual default file `.apk` pada grid card, sehingga tampilan jauh lebih representatif dibanding ikon dokumen putih generic.

## v2.1.28 Penyelarasan Deteksi Thumbnail untuk Berkas Non-Media (APK/ZIP/Doc) yang Memiliki Preview

Fixed:
- Memperbaiki logika deteksi visual `_message_is_visual` pada `drive_fs.py`. Sebelumnya, file non-media (seperti `.apk`, `.zip`, atau file dokumen non-standard) yang sebenarnya memiliki thumbnail/preview bawaan di Telegram (misal icon aplikasi APK) diabaikan secara paksa oleh filter ekstensi `ext in _IMAGE_EXTS | _VIDEO_EXTS`. 
- Kini, jika berkas memiliki thumbnail terdaftar di Telegram (`_doc_has_thumbs` bernilai `True`), backend akan mengembalikan `has_thumb: True` untuk berkas tersebut terlepas dari ekstensinya. Hal ini memicu frontend untuk meminta dan menampilkan thumbnail/icon pada card media dengan benar.

## v2.1.27 Optimasi Alur Koneksi Session pada Remote URL (Download Dulu Baru Connect)

Fixed:
- Mengubah alur inisialisasi dan koneksi Telegram client (`run_media_studio` di `media_studio.py`) untuk aksi upload berkas URL. Sekarang, proses parsing item dan unduhan URL (`_download_remote_url`) dijalankan terlebih dahulu secara penuh **sebelum** client melakukan koneksi dan mengunci database session.
- Perubahan ini mencegah pemutusan session (session lease lock) dan loading spinner berkepanjangan di UI drive selama fase unduh (yang bisa berlangsung lama). Selama mengunduh file remote, koneksi Telegram utama tetap bebas dan user tetap dapat menjelajahi Media Drive dengan lancar.
- Menambahkan properti `temp_path_to_delete` pada dataclass `StudioItem` agar berkas sementara hasil unduhan tetap terhapus dengan bersih pasca-unggah melalui alur pipeline standard.

## v2.1.26 Perbaikan Input URL Terhapus dan Validasi Tipe Berkas pada Remote URL

Fixed:
- Memperbaiki bug pada modal Remote URL (`RemoteUploadModal.tsx`) di mana URL yang diinput terhapus otomatis saat halaman parent melakukan re-render berkala. Masalah ini disebabkan oleh dependency array `useEffect` yang memantau closure `onClose` yang selalu dibuat ulang pada setiap render. Kini reset state dipisahkan hanya ketika modal bertransisi menjadi terbuka (`isOpen`).
- Menambahkan pre-flight check otomatis saat pengguna mengeklik "Mulai Unggah". Aplikasi akan memanggil endpoint verifikasi lokal `/api/v1/verify-url` di FastAPI worker untuk memvalidasi apakah URL mengarah ke file unduhan langsung (bukan halaman HTML, php, js, css, dsb) sebelum antrean upload dibuat. Jika validasi gagal, pesan error spesifik ditampilkan pada modal tanpa menutup modal tersebut, sehingga input URL tidak hilang.

## v2.1.25 Perbaikan Penamaan Berkas dan Akurasi Progress Unduhan pada Remote URL/Transfer

Fixed:
- Memperbaiki penamaan berkas hasil unduhan Remote URL di Telegram. Sebelumnya, berkas diunggah menggunakan nama berkas temporary acak (misal `tmpXXXX.tmp`). Sekarang, nama berkas asli diekstraksi dari header `Content-Disposition` (mendukung format standard dan UTF-8 `filename*`) atau fallback ke path URL jika header tidak ada, sehingga berkas diunggah dengan nama aslinya.
- Memperbaiki akurasi progress bar saat mengunduh berkas Remote URL. Sebelumnya, kemajuan kemajuan unduhan bisa tidak akurat atau melebihi 100% saat mengunduh berkas dengan kompresi Gzip/Brotli karena dekompresi otomatis oleh `aiohttp`. Sekarang, target kemajuan (`content_len`) disesuaikan secara dinamis jika dekompresi menghasilkan berkas yang lebih besar dari yang dilaporkan server.

## v2.1.24 Pencegahan SQLite Database Lock pada Telethon Session selama Remote URL/Transfer

Fixed:
- Mengintegrasikan global monkey-patch pada interaksi database internal Telethon di level worker. Modifikasi ini secara otomatis mengonfigurasi parameter transaksi database sesi (`PRAGMA journal_mode=WAL` dan `PRAGMA busy_timeout=15000`) untuk mencegah tabrakan akses.
- Perubahan ini menjamin bahwa transfer berkas via Remote URL tidak akan memicu galat `database is locked` saat terjadi akses konkuren dengan proses latar belakang lainnya.

## v2.1.23 Perbaikan Fitur Download Semua (ZIP) pada Media Studio

Fixed:
- Memperbaiki fitur **Download Semua (ZIP)** di Media Studio yang tidak berfungsi. Sebelumnya, tombol `FolderArchive` membuat elemen `<a>` dan memanggil `.click()` — pendekatan ini tidak memicu unduhan di Tauri WebView karena port `8550` tidak terdaftar dalam konfigurasi navigasi (`remote.urls` capabilities), sehingga klik diabaikan diam-diam.
- Menggantinya dengan alur yang benar untuk lingkungan Tauri: (1) tampilkan dialog **Save As** (plugin-dialog) agar pengguna memilih lokasi terlebih dahulu, (2) unduh blob ZIP via `fetch()` ke API lokal `127.0.0.1:8550`, (3) tulis hasilnya ke disk menggunakan `writeFile` dari `@tauri-apps/plugin-fs`.
- Memperbaiki bug kritis di backend ([`worker/api/main.py`](file:///F:/AutoGram/AutoGram%20App/worker/api/main.py)): penggunaan `tempfile.mktemp(dir='')` menghasilkan path absolut penuh (misal `C:\Users\...\AppData\Local\Temp\tmpXXXX`). Ketika dikombinasikan dengan `os.path.join(temp_dir, ...)`, Python di Windows membuang `temp_dir` karena argumen kedua sudah absolute — menghasilkan nama file yang tidak valid sehingga `zipfile.ZipFile(...)` gagal dengan `FileNotFoundError`. Solusi: ganti dengan `uuid.uuid4().hex` yang menghasilkan string hex murni.
- Memperbaiki penanganan error di blok `except`: sebelumnya hanya membersihkan `temp_job_dir` (bukan `zip_path` jika sudah dibuat), menyebabkan file ZIP tertinggal di disk saat terjadi kegagalan setelah ZIP dibuat. Sekarang keduanya selalu dibersihkan.
- Menambahkan sanitasi nama file (`os.path.basename`) saat mengunduh dokumen ke staging directory untuk mencegah path traversal.
- Menambahkan `isDownloadingZipRef` untuk mencegah permintaan ZIP paralel jika pengguna mengklik tombol beberapa kali berturutan.

## v2.1.22 Pencegahan Konflik Seleksi Marquee (Select Rectangle) pada Scrollbar

Fixed:
- Memperbaiki konflik navigasi marquee selection (select rectangle) dengan interaksi scrollbar. Menambahkan pendeteksian posisi klik pada area scrollbar (`clientWidth` / `clientHeight`) dalam fungsi `onExplorerPointerDown` di [DriveExplorer.tsx](file:///F:/AutoGram/AutoGram%20App/frontend/src/components/media-drive/DriveExplorer.tsx) untuk mencegah pembuatan kotak seleksi (*select rectangle*) ketika pengguna mengklik dan menggeser (*drag*) scrollbar.

## v2.1.21 Penyelarasan Tampilan & Pencegahan Garis Biru Fokus (Focus Outline) Scrollbar

Fixed:
- Memperbaiki konflik tampilan berupa garis biru vertikal (focus outline bawaan browser/WebView) di sisi kanan layar saat scrollbar ditarik ke atas/bawah. Menambahkan deklarasi `outline: none !important` pada container scrollable `.td-explorer`, `.app-content`, dan `.app-content-drive` di [App.css](file:///F:/AutoGram/AutoGram%20App/frontend/src/App.css) untuk menonaktifkan outline fokus bawaan secara total tanpa mengganggu fungsionalitas scroll halaman.

## v2.1.20 Peningkatan Kestabilan Sesi Telegram & Pencegahan Putus Sambung Acak

Changed:
- Mengonfigurasi parameter koneksi Telethon `TelegramClient` secara global dengan `connection_retries=None` dan `auto_reconnect=True` pada daemon migrasi, backend drive, dan media studio untuk menjamin proses latar belakang mencoba terhubung kembali secara mandiri tanpa terputus secara permanen.
- Menambahkan logika deteksi gangguan jaringan dan pemulihan koneksi otomatis di dalam pembungkus MTProto `_call_with_flood` dan klien tangguh `TelegramResilientClient` (pada pemindaian pesan, pengambilan data, dan penanganan file) untuk memaksimalkan toleransi jaringan yang tidak stabil.
- Memperluas identifikasi tipe kesalahan putus sambung (`ConnectionError`, `OSError`, `BrokenPipeError`, dsb.) pada daemon drive serve agar penanganan kegagalan socket dapat ditangani dengan cepat.
- Meningkatkan ketahanan indikator status koneksi (ping) di frontend dengan memperkenalkan toleransi ambang batas (3x kegagalan berturut-turut) sebelum menampilkan status "Terputus" untuk menghindari peringatan palsu akibat latensi antrean transfer yang padat.

## v2.1.19 Penyelarasan Tampilan & Centering Ikon Dialog Konfirmasi Media Drive

Fixed:
- Memperbaiki tata letak dan centering ikon pada kotak `.td-confirm-icon` di dialog konfirmasi Media Drive (seperti Remote Upload URL). Mengubah layout container dari `display: grid` menjadi `display: flex` dengan properti perataan `align-items: center` dan `justify-content: center`, serta mengatur render `svg` sebagai `display: block` tanpa adanya margin/padding tambahan. Perubahan ini menjamin ikon (misal ikon rantai tautan/link) terpusat secara presisi di tengah-tengah kotak rounded tanpa distorsi atau pergeseran posisi.

## v2.1.18 Implementasi Concurrency Terintegrasi (Opsi C) - Ghost Session, Shared Throttler, SQLite WAL Patch, & Fast Upload Clean Copy

Added:
- Menambahkan [shared_state.py](file:///F:/AutoGram/AutoGram%20App/worker/core/shared_state.py) sebagai pengelola state rate-limiting lintas-proses (*cross-process*). Utilitas ini mengamankan sinkronisasi status `FloodWait` antar proses terpisah (misal Media Studio dan Daemon Migrasi) menggunakan mekanisme OS-level file lock (`msvcrt` untuk Windows dan `fcntl` untuk Unix) agar tidak terjadi penalti durasi ganda dari Telegram API.
- Menambahkan [ghost_session.py](file:///F:/AutoGram/AutoGram%20App/worker/core/ghost_session.py) sebagai *Ghost Session Manager* untuk memotong/menyalin file sesi Telegram secara atomis (`<session_name>_migration`) sebelum dieksekusi oleh daemon migrasi. Ini memutus interdependensi lock file fisik `.session` secara total.

Changed:
- Mengintegrasikan WAL Patch SQLite (`PRAGMA journal_mode=WAL` dan `PRAGMA busy_timeout=15000`) ke dalam [client.py](file:///F:/AutoGram/AutoGram%20App/worker/core/client.py) dan [daemon.py](file:///F:/AutoGram/AutoGram%20App/worker/daemon.py) untuk menjamin database sqlite Telethon aman diakses secara konkuren tanpa galat `database is locked`.
- Mengintegrasikan pemeriksaan dan pencatatan Shared Throttler pada [fast_transfer.py](file:///F:/AutoGram/AutoGram%20App/worker/engine/fast_transfer.py), [fast_forward.py](file:///F:/AutoGram/AutoGram%20App/worker/engine/fast_forward.py), dan [forwarder.py](file:///F:/AutoGram/AutoGram%20App/worker/engine/forwarder.py) agar seluruh proses asinkron melambat/menunggu secara serempak saat akun terkena batas limit (FloodWait).
- Mengintegrasikan `fast_send_file` (unggah bagian paralel konkuren) ke dalam alur Clean Copy pada [forwarder.py](file:///F:/AutoGram/AutoGram%20App/worker/engine/forwarder.py) untuk meningkatkan kecepatan transfer file tunggal album hingga **10x lipat** dibandingkan metode unggahan sekuensial bawaan.
- Menyesuaikan pembungkus MTProto `_call_with_flood` agar mendukung panggilan *mock/callable client* demi keutuhan pengujian fungsional pipeline Media Studio.

## v2.1.17 Inisialisasi Cepat Session & Paralelisasi Sidebar List di Frontend

Changed:
- Mengubah urutan inisialisasi pada `loadSessions` di [SpeedTest.tsx](file:///F:/AutoGram/AutoGram%20App/frontend/src/pages/SpeedTest.tsx) agar `bootstrapSecureCredentials` berjalan secara asinkron tanpa terblokir oleh pemanggilan `loadSelectableSessionNames` yang lambat (memakan waktu 1-2 detik karena spawn proses Python). Dengan perubahan ini, kredensial dimuat instan dalam 2ms dan langsung memicu rendering antarmuka dari cache penyimpanan lokal (*localStorage*) tanpa ada jeda/blank page.
- Memparalelkan pengambilan berkas media utama (*files*) dan daftar obrolan di sidebar (*chats*) pada alur `refreshLocations` sehingga keduanya berjalan secara *concurrent* (tidak saling menunggu). Sidebar obrolan kini langsung memuat daftar chat sesaat setelah koneksi session terjalin.
- Menambahkan visualisasi *skeleton loading* yang berdenyut halus (*pulse animation*) di area daftar chat/sidebar saat pertama kali inisialisasi session kosong (cold-start / cache kosong). Hal ini memberikan kenyamanan visual premium sehingga pengguna tahu bahwa aplikasi sedang memproses pemuatan data dengan aman.

## v2.1.16 Paralelisasi Bootstrapping & Optimasi Batas Muat Awal Media

Changed:
- Mengubah alur inisialisasi awal (*bootstrap*) Media Studio agar daftar obrolan (*chats*) di sidebar dan berkas media (*files*) di grid dimuat secara paralel (*concurrently* via `asyncio.gather`) alih-alih berurutan. Ini memotong waktu tunggu inisialisasi awal hingga hampir setengahnya.
- Mengurangi jumlah batas muat awal (*fetch limit*) per jenis filter media dari 2x ukuran halaman menjadi tepat 1x ukuran halaman (misal 28 berkas) untuk halaman pertama saat cache belum terbangun. Hal ini memotong volume muat data dari Telegram API sebesar 50% tanpa mengurangi keakuratan penggabungan jenis berkas, sehingga memproses data awal jauh lebih cepat.

## v2.1.15 Pembersihan Sesi Bayangan (_preview) dari Daftar Pilihan Antarmuka

Fixed:
- Menyembunyikan berkas sesi bayangan/duplikat (cloned session yang berakhiran `_preview` untuk keperluan pemutaran stream/unggahan media) dari daftar pilihan Session di antarmuka Media Studio. Sesi bayangan kini dikelola sepenuhnya di latar belakang (backend-only) tanpa mengekspos duplikasi nama ke pengguna, sehingga antarmuka daftar akun tetap bersih dan rapi.

## v2.1.14 Pembersihan Placeholder Tampilan Awal Memuat Pratinjau Media (Video & Gambar)

Changed:
- Mengubah perilaku tampilan awal saat memuat/re-koneksi pratinjau media (video dan gambar). Alih-alih menampilkan placeholder default biner/office (dengan ikon Film raksasa, teks status mentah, dan tombol aksi "Buka"/"Buka dengan..."/"Download file" yang membingungkan pengguna), modal kini menampilkan poster media/gambar mini (thumbnail) dengan indikator pemuatan spinner yang bersih ("Memuat..."). Perubahan ini memberikan transisi visual yang jauh lebih rapi, modern, dan nyaman digunakan.

## v2.1.13 Perbaikan Error 'MTProtoSender' Object Is Not Callable untuk Pratinjau Berkas Lintas DC (>2GB)

Fixed:
- Memperbaiki galat fatal `'MTProtoSender' object is not callable` pada saat mengunduh/streaming berkas media yang berlokasi di Data Center (DC) berbeda dari home DC akun (lintas DC). Fungsi internal `_call_with_flood` kini secara dinamis mendeteksi jika target pemanggilan berupa objek raw `MTProtoSender` dan menggunakan pemanggilan async `send(request)` alih-alih mencoba mengeksekusi objek secara langsung. Perbaikan ini memulihkan kemampuan streaming untuk video berukuran sangat besar (>2GB) yang tersebar di DC Telegram lainnya.

## v2.1.12 Optimasi Dinamis Buffering & Kecepatan Streaming Berkas Besar (>1GB)

Added:
- Implementasi **Dynamic Adaptive Buffering** untuk streaming media di mana ukuran window unduh, window sequential pipeline, dan jumlah pekerja download diskalakan secara dinamis berdasarkan ukuran total berkas.
- Peningkatan window seek & pipeline hingga **64MB** dan pekerja konkruen hingga **32 workers** untuk berkas raksasa (>1.5GB) guna memaksimalkan lebar pita unduh (*bandwidth*) pada koneksi cepat.
- Penyesuaian kapasitas *cache* RAM secara dinamis (`max(100, window // _PART + 20)`) agar seluruh ujung depan window unduhan aktif muat di memori tanpa memicu *eviction* prematur ke SSD/HDD.
- Peningkatan batas ukuran pembacaan disk (`to_read`) dari 64KB menjadi **256KB** pada berkas >300MB untuk meminimalkan beban I/O loop dan *context switching* di CPU.
- Peningkatan konstanta `_MOOV_TAIL_BUDGET` ke **16MB** untuk deteksi dan bootstrap atom `moov` yang lebih andal pada berkas original berukuran besar di Telegram.

Fixed:
- Perbaikan batas asersi ukuran bootstrap pada berkas 220MB di pengujian unit random seek.

## v2.1.11 Perbaikan Galat Indeks Pengindeksan Media & Kestabilan Indikator Koneksi

Fixed:
- Perbaikan galat index out of range (`list index out of range`) pada saat memulai pengindeksan media saat pengurutan non-waktu (seperti ukuran terbesar/terkecil) diaktifkan. Penyelarasan filter media backend kini mencakup filter tautan secara tepat.
- Perbaikan kestabilan indikator koneksi di sidebar yang sempat memicu status "Terputus" palsu saat saluran data sibuk melayani pemutaran (streaming) media berukuran besar. Request ping backend kini memiliki mekanisme timeout cepat dan tidak lagi memutus status online secara keliru saat channel padat.
- Perbaikan penanganan galat Picture-in-Picture (PiP) pada pemutar video pratinjau. Mengklik PiP saat video sedang memuat metadata tidak lagi memunculkan crash banner fatal yang memblokir pemutar video, melainkan menampilkan toast peringatan non-fatal yang informatif.

## v2.1.10 Perbaikan Akurasi Pengurutan Terlama & Sinkronisasi State Filter

Fixed:
- Perbaikan ketidakakuratan pengurutan terlama ("Terlama dulu") pada pencarian media forum topic di Telegram.
- Mengatasi keterbatasan Telegram API (`messages.search` / `messages.getReplies`) yang tidak mendukung pengurutan waktu secara menaik (*ascending* / tertua di atas) pada sisi server.
- Mengalihkan pencarian tertua ("Terlama dulu") secara otomatis ke jalur pemindaian sequential history (`_list_files_scan_fallback`) yang menggunakan `iter_messages(reverse=True)`. Jalur ini terbukti akurat mengembalikan berkas tertua yang sebenarnya (seperti berkas `OyU-8c_o7FF72qdg.mp4` / pesan ID 34 pada topik Twitter grup).
- Perbaikan bug *stale React closure* pada frontend (`SpeedTest.tsx`). Array dependensi pada *useCallback* `refreshFiles` dan `loadMoreFiles` kini menyertakan `sortMode` dan `files` secara eksplisit, menjamin state pengurutan terbaru selalu terkirim ke backend dan mencegah pemuatan halaman berikutnya bercampur dengan parameter pengurutan lama.

## v2.1.9 Implementasi Ghost Session Protocol v3.0

Added:
- Implementasi sistem **Ghost Session** (`_preview.session`) paralel stateless khusus pratinjau (preview/streaming) media, sehingga pratinjau media dan pengunggahan (upload) transfer dapat berjalan bersamaan tanpa kendala *SQLite database is locked*.
- Penambahan perintah Rust backend baru: `ensure_ghost_session` untuk melakukan kloning database secara *atomic* via Online Backup API (menghindari korupsi data WAL/SHM), dan `cleanup_ghost_session` untuk menghapus file klon setelah selesai.
- Penambahan mekanisme soft-pause transfer singkat melalui pembuatan file flag `drive_pause.txt` di direktori temp untuk menstabilkan database sebelum proses Online Backup berjalan.
- Penambahan kelas `GhostThrottler` di Python uploader untuk menerapkan *adaptive upload throttling* secara dinamis ketika terdeteksi adanya streaming pratinjau aktif, guna membagi bandwidth dan mencegah timbulnya galat `FloodWaitError` dari Telegram.
- Penambahan *reference counting* pratinjau aktif (`activePreviews`) di frontend untuk mendeteksi kapan pratinjau dibuka atau ditutup secara akurat.
- Implementasi transisi otomatis dengan *grace period* selama 30 detik: ketika semua jendela pratinjau ditutup, server pratinjau otomatis dihentikan dan dialihkan kembali ke sesi utama agar perubahan status tetap ter-sinkronisasi.

Changed:
- Penyesuaian `isSessionTransferLeased` untuk langsung melewati (bypass) pembatasan *lease* ketika sesi pratinjau ghost aktif.
- Peningkatan instansiasi `TelegramClient` ghost untuk menonaktifkan update handling dengan menyematkan argumen kata kunci `receive_updates=False` dan menimpa fungsi penanganan update internal (`_dispatch_update`) menjadi no-op.

## v2.1.8 Perbaikan Media Studio Preview (Smart Upload Throttle, Feedback Tombol Muat, & Detail Info Spesifik)

Added:
- Penambahan informasi spesifik pada popup Detail file (Info): resolusi/dimensi gambar dan video (misal `1920 × 1080 px`), tanggal unggah berkas (format lokal Indonesia), metode pengiriman (Dokumen/File asli vs Media native kompresi), serta nama asli Telegram jika berbeda.
- Penambahan deteksi dimensi media secara dinamis pada frontend (`onLoad` gambar dan `onLoadedMetadata` video) untuk menjamin data dimensi selalu mutakhir sewaktu preview selesai dimuat.

Changed:
- Penambahan umpan balik visual (loading feedback) pada tombol "Muat" (Refresh Preview): menonaktifkan tombol saat proses pemuatan berlangsung, mengubah label tombol sementara menjadi "Memuat…", dan menganimasikan putar (`spin`) ikon Lucide `RefreshCw`.
- Optimalisasi responsivitas tinggi (max-height) popup `.drive-preview-info` di CSS menjadi `min(80%, 460px)` untuk mengakomodasi tampilan data metadata baru tanpa terpotong.

Fixed:
- Perbaikan kelancaran pratinjau media sewaktu proses unggah (upload) sedang berlangsung. Backend menerapkan Smart Rate Controller dengan mendeteksi keberadaan stream pratinjau aktif (`has_active_streams`) dan melakukan pembatasan kecepatan unggah (throttling delay `80ms` antar-part part) secara dinamis agar tidak menyumbat bandwidth & DC slot koneksi Telegram.

## v2.1.7 Verifikasi Eksistensi Pesan Duplikat Telegram & Pembersihan Riwayat Stale

Fixed:
- Perbaikan bug skip duplikat palsu (stale duplicate record). Jika sebuah file pernah diunggah lalu dihapus secara manual di aplikasi Telegram, uploader sebelumnya tetap melewati (skip) file tersebut karena record-nya masih tersimpan di database lokal `duplicate_history`. Backend kini memverifikasi eksistensi pesan secara real-time di Telegram menggunakan Telethon sebelum melewati file. Jika pesan terbukti sudah terhapus, data duplikat stale di database otomatis dibersihkan dan berkas diunggah ulang secara sukses.

## v2.1.6 Fitur Pemfilteran Link & Pratinjau WebPage di Media Drive

Added:
- Implementasi filter "Link" eksklusif di baris Filter Tipe Media Drive. Link/tautan hanya akan ditampilkan saat tab filter ini ditekan, menjaga tab "Semua" tetap bersih dari tautan.
- Dukungan ekstraksi dan klasifikasi pesan bertipe link/URL secara otomatis di backend (`drive_fs.py`) melalui deteksi `MessageMediaWebPage` maupun parser teks URL berbasis Telegram entities (`MessageEntityUrl` / `MessageEntityTextUrl`) dan regex fallback.
- Integrasi pratinjau thumbnail untuk link: backend secara cerdas memetakan dan mengunduh gambar pratinjau situs (WebPage photo preview) ke cache thumbnail, sehingga kartu link di grid dapat menampilkan gambar thumbnail situs yang elegan.
- Kustomisasi visual kartu link: kartu link menampilkan domain/hostname tautan di sub-label (misal `github.com` atau `youtube.com`) alih-alih ukuran file `0 B`, dengan tooltip hover yang menunjukkan URL lengkap.
- Penanganan navigasi link: klik ganda atau menekan tombol Preview pada kartu link akan membuka tautan tersebut secara langsung di browser eksternal sistem menggunakan Tauri `@tauri-apps/plugin-opener` (atau fallback `window.open` di web/browser).

Fixed:
- Perbaikan pemuatan thumbnail pada kartu link. Kondisi `isTextDriveFile` sebelumnya keliru mendeteksi link sebagai file teks biasa (karena MIME type `text/html`), yang memblokir penayangan thumbnail pratinjau halaman di antarmuka grid.

## v2.1.5 Optimasi dynamic moov offset parsing untuk streaming video besar (>150MB)

Added:
- Implementasi pencarian offset atom `moov` secara dinamis dengan melakukan parsing box header `ftyp` dan `mdat` pada 128KB pertama video MP4. Ini secara instan mendeteksi letak presisi `moov` di akhir file dan mengunduhnya secara paralel sebelum video diputar.
- Peningkatan batas fallback `_MOOV_TAIL_BUDGET` secara dinamis hingga 32MB (dari sebelumnya 2MB) untuk mendukung video berukuran besar (>150MB) yang memiliki metadata `moov` besar. Hal ini mencegah browser terpaksa mendownload seluruh file secara sekuensial dari awal jika deteksi gagal.

## v2.1.4 Desain Ulang Indikator Status Koneksi Drive

Changed:
- Desain ulang indikator status koneksi (dot hijau/merah/biru) pada sidebar Drive saat menciut (collapsed). Indikator kini diletakkan sebagai dot badge di pojok kanan bawah icon Drive (HardDrive), menghemat ruang baris kosong dan memberikan visual status yang lebih modern.

## v2.1.3 Perbaikan Kontrol Kecepatan Video

Fixed:
- Perbaikan tombol kecepatan putar (playback rate) pada preview video yang tidak berfungsi saat pertama kali video dimuat.
- Perbaikan race condition di mana `playbackRate` effect berjalan ketika `videoRef` masih null (saat stream baru mount). Rate kini diterapkan via `onLoadedMetadata` tanpa bergantung pada `streamUrl`/`path`.
- Perbaikan CSS `@container` yang meng-override posisi dan z-index menu kecepatan. Menu popup yang sudah diposisikan via JavaScript (`.is-fixed-popover`, z-index 12600) kini dikecualikan dari rule container query.
- Nilai kecepatan aktif (mis. `1x`, `2x`) kini selalu tampil di tombol pada semua ukuran layar termasuk mobile, dengan menambahkan class `drive-tool-btn-value` pada tombol rate.
- Label aksesibilitas (`aria-label`) pada tombol kecepatan kini menampilkan nilai kecepatan aktif secara dinamis.

## v2.1.2 Optimasi Buffering & Pre-flight Reconciliation

Added:
- Integrasi *Pre-flight Active Telegram Reconciliation Engine* yang secara otomatis memindai riwayat chat/thread Telegram sebelum pengunggahan dimulai untuk mendeteksi berkas yang sudah berhasil terkirim.
- Sinkronisasi otomatis riwayat Telegram yang terdeteksi ke database `duplicate_history` lokal untuk mencegah pengunggahan ganda (de-duplikasi) dan memungkinkan resume 1-klik yang tangguh.

Fixed:
- Penghapusan loop nudge `currentTime` pada frontend saat memutar progressive stream video. Ini mencegah pembatalan (abort) berulang pada permintaan Range HTTP oleh WebView/browser.
- Delegasi kontrol pencarian range offset presisi sepenuhnya kepada browser dan pemrosesan `moov` index MP4, mengurangi overhead transfer dan waktu tunggu buffer secara signifikan.

## v2.1.1 Optimalisasi Memori Thumbnail & Bug Fix Preview

Fixed:
- Perbaikan bug race condition di mana pratinjau media menjadi blank saat melakukan navigasi next/prev atau refresh media.
- Sinkronisasi state media secara instan pada pass render pertama saat ID file berubah.
- Penggunaan React key yang ringkas dan aman untuk elemen gambar dan video (menghindari penggunaan base64 data URL panjang sebagai key).
- Perbaikan kondisi rendering panel error agar tidak terhambat oleh variabel mediaSrc.
- Perbaikan pada Python stream server di mana berkas lengkap di disk terkirim 0 byte karena tidak ditandai terisi dalam memory stream.
- Optimalisasi konsumsi memori RAM dengan LRU cache untuk thumbnail guna menjaga performa antarmuka tetap responsif di folder berskala besar.
- Peningkatan batas penyimpanan cache thumbnail lokal hingga 5000 entri untuk mempercepat waktu pemuatan media.
- Pembatasan konkuren ekstraksi video thumbnail guna mencegah peningkatan utilisasi CPU yang tinggi.
- Perbaikan ketahanan pengunggahan massal terhadap batasan frekuensi (FloodWait) Telegram dengan mekanisme jeda hitung mundur otomatis dan dinamis.
- Integrasi sistem penyimpanan antrean pengunggahan secara persisten untuk memungkinkan pemulihan (resume) otomatis ketika aplikasi ditutup atau dimulai kembali.
- Pencegahan otomatis pengunggahan berkas ganda menggunakan pencocokan riwayat data.

## v2.1.0 Foundation & Merged Repository

Added:
- Telegram client layer (session manager, entity resolver, topic resolver, message iterator, media inspector, rate limiter, flood wait handler).
- Initial offline desktop foundation using SQLite database.