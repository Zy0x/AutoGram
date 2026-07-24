AutoGram Version: v2.3.6

Current State:
v2.3.6 Preservasi Pesan Kesalahan IPC Telegram API pada `telegramBackend.ts` & `driveApi.ts` — mengeliminasi pesan generik "Hapus batch gagal" dan menampilkan detail kesalahan server (seperti CHAT_ADMIN_REQUIRED / MESSAGE_DELETE_FORBIDDEN).

Previous:
v2.3.5 Multi-Key Channel & Peer Resolution Cache di Grammers Engine (-100 prefix, bare ID, dan negative ID) untuk penghapusan pesan instan pada channel/supergroup.
v2.3.4 Optimasi Kecepatan & Presisi Penghapusan Media (Zero-Refetch Optimistic Update, Pembersihan Global Cache Memori, Sinkronisasi IndexedDB Real-time, dan Presisi Target Channel ID per File).
v2.3.3 Perbaikan bug kritis ReferenceError `requireGrammersIdentity` & penambahan pembantu `resolveGrammersIdentity` pada penghapusan/pemindahan media di `driveApi.ts`. Otomatis melengkapi `apiId` & `apiHash` dari secure credentials store jika kredensial UI tidak lengkap.
v2.3.2 Optimalisasi kecepatan penghapusan media & Instant Fast-Fail pada error perizinan (`CHAT_ADMIN_REQUIRED` / `MESSAGE_DELETE_FORBIDDEN`) serta penerapan in-memory `PEER_RESOLVE_CACHE` di Rust Grammers Engine. Mengeliminasi 50x network retry loop & pencarian `iter_dialogs` berulang.
v2.3.1 Perbaikan error banner & reset loading state (`setLoadingFiles` & `setTopicsLoading`) saat penghapusan media/topik terhalang perizinan (seperti `CHAT_ADMIN_REQUIRED` atau `MESSAGE_DELETE_FORBIDDEN`). Preservasi error banner dan penanganan `finally` tanpa syarat mengeliminasi ikon refresh yang berputar tanpa henti.
v2.3.0 Migrasi Full 100% Grammers Rust Native MTProto (Zero-Python Engine). Seluruh modul (Auth, Media Drive, Stream Video, Upload, Download, Migration Engine, Jobs, Profiles, Automations, dan Statistics) kini berjalan 100% murni di Rust.
v2.1.91 Autodeteksi biner ffmpeg.exe di lokasi aplikasi Windows (Program Files, FormatFactory, BlueStacks, LOCALAPPDATA, C:\ffmpeg) secara otomatis. Video tanpa thumbnail statis Telegram kini langsung diekstrak frame HD-nya secara independen tanpa tergantung konfigurasi PATH.
v2.1.90 Perbaikan bug offset chunk terduplikasi pada penarikan sampel media. Mengeliminasi korupsi header biner yang memicu error 'no valid thumb found' pada video dan gambar tanpa thumbnail statis Telegram.
v2.1.89 Penerapan autodeteksi magic-bytes (JPEG, PNG, WebP, GIF, MP4, MKV, AVI) untuk berkas media yang diunggah tanpa ekstensi atau ber-MIME generic (application/octet-stream). Eliminasi total pesan error 'no valid thumb found' pada media visual.
v2.1.88 Perbaikan auto-retry pemuatan thumbnail pada kartu grid yang sempat mengalami soft-fail/pending RPC. Mengeliminasi masalah kartu media terkunci kosong sebelum modal pratinjau dibuka/ditutup.
v2.1.87 Perbaikan pemuatan thumbnail gambar yang gagal decode pada berkas foto >256KB (misal 29-6.jpg 344KB) akibat pembatasan chunk terpotong. Kini berkas gambar diunduh utuh hingga 8MB untuk menjamin validitas header JPEG/PNG.
v2.1.86 Perbaikan pemuatan thumbnail video MP4 non-faststart (Snaptik/TikTok & berkas video besar >5MB) melalui rekonstruksi struktur faststart MP4 (moov-before-mdat) untuk ekstraksi frame FFmpeg serta fallback mini-thumbnail (Tier 6).
v2.1.85 Eliminasi disconnect/reconnect storm saat FloodWait Telegram (menghapus FloodWait dari transport error), penyesuaian concurrency thumbnail (2 parallel downloads), dan fail-fast active flood window pada preview stream.
v2.1.84 Eliminasi self-imposed false FloodWait lockouts & optimalisasi kecepatan media.
v2.1.83 Perbaikan kualitas & ketajaman thumbnail grid (pencegahan cache poisoning blur placeholder & penyeleksian resolusi layer/FFmpeg frame HD untuk Seimbang dan Jelas).
v2.1.82 Optimized session & chat list boot load speed (RwLock concurrent MTProto requests + authorization profile cache).
v2.1.81 Stream buffer thrash fixed (no stopAll/delete partial killing fill). Grammers album upload dual-path. Video progressive Telethon+Rust Range.
v2.1.80 Video play stuck + buffer speed
v2.1.79 Fix video preview reload loop
v2.1.8: Phase 6 thumbs/topics/progressive scaffold
