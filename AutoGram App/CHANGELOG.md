# Changelog

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