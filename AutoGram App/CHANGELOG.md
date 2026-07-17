# Changelog

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