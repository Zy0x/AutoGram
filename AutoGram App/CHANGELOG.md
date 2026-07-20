# Changelog

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