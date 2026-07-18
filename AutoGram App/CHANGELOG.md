# Changelog

## v5.1.6 Perbaikan Kontrol Kecepatan Video

Fixed:
- Perbaikan tombol kecepatan putar (playback rate) pada preview video yang tidak berfungsi saat pertama kali video dimuat.
- Perbaikan race condition di mana `playbackRate` effect berjalan ketika `videoRef` masih null (saat stream baru mount). Rate kini diterapkan via `onLoadedMetadata` tanpa bergantung pada `streamUrl`/`path`.
- Perbaikan CSS `@container` yang meng-override posisi dan z-index menu kecepatan. Menu popup yang sudah diposisikan via JavaScript (`.is-fixed-popover`, z-index 12600) kini dikecualikan dari rule container query.
- Nilai kecepatan aktif (mis. `1x`, `2x`) kini selalu tampil di tombol pada semua ukuran layar termasuk mobile, dengan menambahkan class `drive-tool-btn-value` pada tombol rate.
- Label aksesibilitas (`aria-label`) pada tombol kecepatan kini menampilkan nilai kecepatan aktif secara dinamis.

## v5.1.5 Optimasi Buffering & Seek Video Ukuran Besar

Fixed:
- Penghapusan loop nudge `currentTime` pada frontend saat memutar progressive stream video. Ini mencegah pembatalan (abort) berulang pada permintaan Range HTTP oleh WebView/browser.
- Delegasi kontrol pencarian range offset presisi sepenuhnya kepada browser dan pemrosesan `moov` index MP4, mengurangi overhead transfer dan waktu tunggu buffer secara signifikan.

## v5.1.4 Pre-flight Active Telegram Reconciliation Engine

Added:
- Integrasi *Pre-flight Active Telegram Reconciliation Engine* yang secara otomatis memindai riwayat chat/thread Telegram sebelum pengunggahan dimulai untuk mendeteksi berkas yang sudah berhasil terkirim.
- Sinkronisasi otomatis riwayat Telegram yang terdeteksi ke database `duplicate_history` lokal untuk mencegah pengunggahan ganda (de-duplikasi) dan memungkinkan resume 1-klik yang tangguh.

## v5.1.3 Optimalisasi Memori Thumbnail & Stabilitas Pengunggahan Massal

Fixed:
- Optimalisasi konsumsi memori RAM dengan LRU cache untuk thumbnail guna menjaga performa antarmuka tetap responsif di folder berskala besar.
- Peningkatan batas penyimpanan cache thumbnail lokal hingga 5000 entri untuk mempercepat waktu pemuatan media.
- Pembatasan konkuren ekstraksi video thumbnail guna mencegah peningkatan utilisasi CPU yang tinggi.
- Perbaikan ketahanan pengunggahan massal terhadap batasan frekuensi (FloodWait) Telegram dengan mekanisme jeda hitung mundur otomatis dan dinamis.
- Integrasi sistem penyimpanan antrean pengunggahan secara persisten untuk memungkinkan pemulihan (resume) otomatis ketika aplikasi ditutup atau dimulai kembali.
- Pencegahan otomatis pengunggahan berkas ganda menggunakan pencocokan riwayat data.

## v5.1.2 Bug Fix Preview Media

Fixed:
- Perbaikan bug race condition di mana pratinjau media menjadi blank saat melakukan navigasi next/prev atau refresh media.
- Sinkronisasi state media secara instan pada pass render pertama saat ID file berubah.
- Penggunaan React key yang ringkas dan aman untuk elemen gambar dan video (menghindari penggunaan base64 data URL panjang sebagai key).
- Perbaikan kondisi rendering panel error agar tidak terhambat oleh variabel mediaSrc.
- Perbaikan pada Python stream server di mana berkas lengkap di disk terkirim 0 byte karena tidak ditandai terisi dalam memory stream.

## v5.1.1 Merged Repository

Added:
- Telegram client layer
- Session manager
- Entity resolver
- Topic resolver
- Message iterator
- Media inspector
- Rate limiter
- Flood wait handler

Preserved:
- v5.1.0 foundation
- documentation
- configuration
- architecture