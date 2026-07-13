# Security Control Matrix

Keamanan adalah pilar fundamental untuk menghindari peretasan akun Telegram pengguna maupun penangguhan (*suspend*) oleh sistem otomatis Telegram.

## 1. Perlindungan Kredensial & Sesi (Session Protection)
| Aset Risiko | Lokasi Simpan | Metode Perlindungan |
| :--- | :--- | :--- |
| `api_id` & `api_hash` | File Konfigurasi / Env | Tidak dienkripsi penuh, tetapi dilarang disimpan ke kontrol versi publik. |
| Telegram `.session` | Folder instalasi lokal | **Wajib Enkripsi AES-256**. Berisiko tinggi (*Account Takeover*). |
| Kunci Dekripsi | Otak Pengguna / Keychain | *Master Password* saat aplikasi dibuka, atau *Device Binding*. |

## 2. Operasional Anti-Spam (Smart Throttle)
Telegram memiliki sistem pendeteksi bot *spam* otomatis yang kejam. Aplikasi harus mengadopsi kontrol berikut:
- **Delay Randomization**: Setiap pengiriman (*forward/copy*) wajib diselingi waktu tunggu (`sleep`) 2-5 detik secara acak untuk menyerupai tindakan manusia (*Human Behavior*).
- **FloodWait Interceptor**: 
  - Jika error `FloodWait 120s` diterima, aplikasi **WAJIB** berhenti beroperasi selama durasi tersebut.
  - Setelah *resume*, kecepatan maksimum otomatis dikurangi sebesar 25% (*Backoff mechanism*).
- **Account Health Score**: Sistem internal menilai tingkat keamanan operasi akun. Jika *error rate* tinggi, sistem akan memberikan notifikasi `WARNING: Risk of ban. Pausing task.`

## 3. Validasi Tujuan (Destination Conflict)
- Jika pengguna tanpa sengaja menyetel *Source* dan *Destination* ke entitas yang sama (contoh: Channel A ke Channel A), sistem harus memblokir eksekusi (*Infinite Loop Detection*).
- Pengecualian hanya berlaku jika migrasi antar *Forum Topic* yang berbeda di dalam satu *Supergroup* yang sama.

## 4. Audit Trail
Untuk tujuan enterprise:
- Seluruh tindakan esensial (Login, Buat *Profile*, Start Migrasi, Hapus *History*) wajib di-*log* dengan *timestamp*.
- File *log* dilarang mencatat *plaintext password* atau konten spesifik pesan Telegram yang bersifat pribadi.
