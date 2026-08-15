# 📌 Rencana Masa Depan: Autentikasi Sesi & Injeksi Kuki Media Sosial (TikTok Private & Geo-Restriction)

> **Status Dokumen**: ⏳ **DITUNDA (PENDING)** — Disimpan untuk pengembangan tahap lanjutan setelah seluruh fitur kritis aplikasi selesai diperbaiki dan dioptimalkan 100%.  
> **Target Fitur**: Remote URL Downloader & Stream Engine  
> **Komponen Terkait**: `AutoGram App/frontend/src/lib/telegram/linkResolvers/`, `AutoGram App/frontend/src-tauri/src/core/media_prep.rs`

---

## 🎯 1. Latar Belakang & Tujuan
Saat ini, AutoGram Remote Upload mendukung 100% video publik, foto slideshow HD, avatar profil, audio MP3, dan story dari TikTok, Douyin, YouTube, Instagram, dan platform lainnya.

Namun, terdapat dua batasan dari sisi penyedia layanan:
1. **Video Akun Privat / Khusus Teman (*Friends Only*)**: Server TikTok/Instagram menolak permintaan publik tanpa kuki otentikasi akun yang berteman dengan kreator.
2. **Pembatasan Usia (*Age-Restricted 18+*) & Geo-Restriction**: Beberapa video/suara diblokir secara regional atau memerlukan verifikasi login akun dewasa.

**Tujuan Fitur**: Memungkinkan pengguna AutoGram mengunduh dan mengunggah video privat, teman, dan konten dengan pembatasan geografis/usia langsung ke Telegram secara otomatis dan aman menggunakan sesi akun mereka sendiri.

---

## 🏗️ 2. Arsitektur Teknis

### A. Lapisan Frontend (React + TypeScript)
1. **Pengaturan Kuki Sesi (*Social Media Session Credentials*)**:
   * Menambahkan sub-bagian di menu **Settings $\rightarrow$ Remote Engine** untuk memasukkan kuki sesi TikTok (`sessionid`, `tt_chain_token`, `msToken`).
   * Tombol uji koneksi (*Test TikTok Auth*) untuk memvalidasi status kuki (aktif / kedaluwarsa).
2. **Jendela Login In-App (*WebView2 Seamless Login Bridge*)**:
   * Opsi tombol *"Login ke TikTok via AutoGram"*.
   * Membuka jendela WebView2 terisolasi resmi ke `tiktok.com/login`.
   * Setelah pengguna berhasil login, AutoGram secara otomatis menyadap dan mengekstrak kuki `sessionid` tanpa perlu menyalin kuki secara manual melalui Inspect Element.

### B. Lapisan Backend Desktop (Rust Core Engine)
1. **Penyimpanan Kuki Terenkripsi (*Encrypted Keyring / SQLite Storage*)**:
   * Kuki disimpan secara aman menggunakan enkripsi lokal AES-256 / SQLite `secrets` (tidak disimpan dalam bentuk plaintext).
2. **Injeksi Header Otentikasi pada `media_prep.rs`**:
   * Saat `download_remote_url` atau `resolve_social_media_direct_url` dipanggil untuk URL privat:
     ```rust
     let mut req = agent.get(&api_url);
     if let Some(cookie) = get_stored_tiktok_cookie() {
         req = req.set("Cookie", &format!("sessionid={cookie}; msToken=..."));
     }
     ```
3. **Penyaluran Melalui SOCKS5/HTTP Proxy**:
   * Mengintegrasikan kuki dengan konfigurasi `network_apply_proxy` yang sudah ada di Rust core untuk menembus batasan wilayah (*Geo-Bypass*).

---

## 🚀 3. Tahapan Rencana Eksekusi (Staged Implementation Plan)

### Tahap 1: Input Manual Kuki Sesi (*Phase 1 - Manual Cookie Injection*)
* Menyediakan form input teks `sessionid` di Remote Upload Modal atau Settings.
* Menguji transmisi video privat dengan header kuki langsung ke endpoint API.

### Tahap 2: WebView2 One-Click Login Bridge (*Phase 2 - In-App Seamless Auth*)
* Membuat antarmuka WebView2 terisolasi untuk login visual.
* Pengambilan kuki otomatis (*cookie sniffing*) pasca-login berhasil.

### Tahap 3: Auto-Refresh Sesi & Multi-Platform Support (*Phase 3 - Scale to Instagram/X/YouTube*)
* Menambahkan sistem deteksi kuki kedaluwarsa dan notifikasi perpanjangan sesi.
* Menerapkan arsitektur yang sama untuk akun privat Instagram (*Instagram Private Stories/Posts*) dan video YouTube khusus *Member/Age-Gated*.

---

## 🛡️ 4. Standar Keamanan & Privasi Data
* **Zero Hardcoded Secrets**: Kuki sesi pengguna adalah data pribadi dan tidak boleh di-log ke konsol, terminal, maupun dikirim ke server pihak ketiga.
* **Local-Only Processing**: Semua permintaan otentikasi dialirkan langsung dari komputer lokal pengguna ke server resmi platform terkait.
* **Easy Revocation**: Tombol satu klik *"Hapus Kuki Sesi"* untuk membersihkan seluruh data otentikasi dari database lokal kapan saja.

---

## 📅 Catatan Aktivasi
> Dokumen ini akan dibuka dan diimplementasikan secara penuh setelah seluruh modul antarmuka, sinkronisasi file, dan stabilitas engine inti AutoGram dinyatakan selesai 100%.
