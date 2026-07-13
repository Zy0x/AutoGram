# Backup & Recovery Procedures

Sistem Telegram Migration Platform memiliki sifat eksekusi jangka panjang (*long-running background jobs*). Oleh karena itu, kemampuan pemulihan dari kegagalan lokal (mati listrik, internet putus, atau *crash*) adalah hal mutlak.

## 1. Resume System (Koneksi Putus / PC Mati)
Sistem menggunakan *Resume State* berbasis SQLite.
- Setiap kali satu pesan Telegram berhasil di-*forward* atau di-*copy*, statusnya dicatat sebagai `DONE` di tabel `migration_items`.
- **Prosedur Restart**: 
  1. Jika PC mati mendadak, setelah menyala kembali dan aplikasi dijalankan, sistem tidak akan membaca dari `Message ID: 1`.
  2. Sistem membaca `migration_items` dan langsung melompat (*seek*) ke ID pesan terakhir yang belum diproses.
  3. Hal ini mencegah pengulangan unduh/unggah yang menghabiskan kuota *bandwidth*.

## 2. Failed Items Recovery
- Jika proses unggah *file* gagal (karena batas API Telegram), pesan akan dicatat sebagai `FAILED`.
- Akan ada modul antrean gagal (*Failed Queue*). 
- Aplikasi bisa mencoba ulang (*auto retry*) maksimal 3 kali untuk kasus jaringan. Jika tetap gagal, pengguna bisa melakukan *Manual Retry* dari *Dashboard*.

## 3. Ekspor Laporan dan Konfigurasi
- **Migration Report**: Hasil akhir (*Total Success, Failed, Skipped*) bisa diunduh dalam bentuk `CSV/Excel`. Ini berfungsi sebagai bukti audit (*audit trail*).
- **Profile Export**: Agar pengguna bisa berpindah komputer, semua pengaturan *Rule Engine* dan *Scheduler* (Profile) harus bisa diekspor ke file `migration_backup.json` (kecuali data sesi terenkripsi).

## 4. Temporary Cache Management (Pembersihan Memori)
Saat aplikasi menggunakan Mode *Clean Copy*, media akan diunduh secara fisik ke `C:\TelegramMigratorCache`.
- **Kapasitas**: Ada batasan maksimal (misal: 10GB). Jika penuh, proses jeda otomatis.
- **Pembersihan**: File dihapus instan segera setelah `DONE`. Jika `FAILED`, file dipertahankan untuk *retry*.
