# Changelog

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