# Product Requirements Document (PRD)

**Project Name:** Telegram Media Migration & Automation Platform  
**Target:** Desktop GUI (Phase 1), Web Dashboard & Cloud (Phase 2+)

## 1. Visi & Objektif
Aplikasi *Batch Telegram Media Forwarding, Migration, Synchronization, dan Automation Platform*. 
Aplikasi ini bukan bertindak sebagai *cloud storage* (seperti Google Drive), melainkan sebagai *Migration Orchestrator* yang handal untuk mentransfer pesan dan media antar berbagai entitas Telegram tanpa batas, secara otomatis, dan anti-spam.

## 2. Target Pengguna
- Personal & Profesional yang mengelola banyak *group/channel* Telegram.
- Administrator komunitas yang perlu melakukan backup aset/media secara reguler.

## 3. Fitur Utama (Core Features)

### 3.1. Entity Support
Aplikasi harus mendukung *Source* & *Destination* secara universal:
- Private Chat, Group, Supergroup, Forum Group, Forum Topic, Channel, Saved Messages, Bot Chat, dan Channel Comments.

### 3.2. Migration Engine
- **Transfer Mode**:
  1. `Fast Forward`: Menggunakan mekanisme *Forward* bawaan Telegram (Sangat cepat, terdapat opsi *Show/Hide Forwarded From* jika didukung API).
  2. `Clean Copy`: Mengunduh dan mengunggah ulang media (Murni bersih, tanpa label *Forwarded From*, nama *file* dapat dipertahankan).
  3. `Mirror Mode (Beta)`: Sinkronisasi *real-time* dengan mendeteksi pesan baru secara *event-driven*.

### 3.3. Duplicate Engine (4-Level)
Sistem cerdas untuk menghindari *spam* ganda dengan memeriksa lapisan berikut:
1. **Level 1**: Message ID asli Telegram.
2. **Level 2**: Telegram File Unique ID.
3. **Level 3**: SHA256 Hash File.
4. **Level 4**: Nama file + Ukuran file.

**Aksi Duplikasi (Duplicate Action Rule)**:
- `Skip` (Otomatis lewati).
- `Rename` (Ubah nama file otomatis, misal `file(1).pdf`).
- `Replace` (Timpa pesan lama jika mendukung).
- `Keep Both` (Tetap kirim sebagai entitas baru).
- `Ask User` (Meminta konfirmasi manual saat eksekusi).

### 3.4. Rule Engine & Filters
Pesan harus difilter secara ketat sebelum ditransfer:
- **Filter Media**: Hanya *forward* foto, video, dokumen, audio, *voice*, stiker, GIF, *poll*, *link*, atau *text*.
- **Filter Metadata**: Rentang Waktu (Tanggal mulai/akhir), Batas Ukuran File (Minimal/Maksimal GB).
- **Caption Handling**:
  - `Copy Asli`: Salin sesuai aslinya.
  - `Template Custom`: Format spesifik seperti `[Backup {date}] {original_caption} \n Source: {source_name}`.

### 3.5. Task & Workflow Management
- **Template Profile**: Pengguna dapat menyimpan racikan *Source, Destination, Rules, dan Schedule* ke dalam satu profil (misal: "Backup Grup Kampus") untuk dieksekusi satu klik atau diekspor.
- **Scheduler**: One Time, Daily, Weekly, Custom Cron.
- **Progress Tracking & Resume**: Jika internet putus, proses dilanjutkan (Resume) dari ID pesan terakhir, bukan dari awal.
- **Dry Run Mode**: Opsi *Scan Only* untuk menghitung estimasi jumlah pesan, *file size*, dan durasi waktu tanpa melakukan transfer fisik.

### 3.6. Security & Anti-Spam
- **Human Behavior Mode**: *Delay randomization* (2-5 detik acak antar pesan), pembatasan aktif, dan *cooldown* untuk menyerupai tindakan manusia asli.
- **Smart Throttle**: Menurunkan kecepatan otomatis jika mendeteksi ancaman batas `FloodWaitError` dari Telegram.
- **Account Health Monitor**: Memberikan status keamanan sesi (Aman/Risiko Tinggi).
- **Session Protection**: Sesi MTProto Telegram tidak boleh dikirim ke server *developer*. Wajib terenkripsi penuh secara lokal (AES-256).

## 4. Kebutuhan Antarmuka (UI/UX)
- Tampilan Profesional, Modern, Minimalis, *Card-based* (Gaya dasbor).
- Mendukung fitur mode Gelap/Terang (*Dark/Light Mode*).
- **Bahasa**: Mendukung Internasionalisasi (*i18n*) untuk bahasa Inggris (*default*) dan Indonesia.
- **Menu Utama**: *Dashboard, Accounts, Profiles, Migration, Scheduler, History, Settings.*
