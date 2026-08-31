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

## 4. Standar Desain Antarmuka, Responsivitas & Pengalaman Pengguna (UI/UX Engineering Standard)

Seluruh antarmuka AutoGram wajib dibangun dengan presisi tinggi, mengacu pada standar modern, mobile-first, touch-first, dan anti-regresi:

### 4.1. Presisi Tampilan Antar-Platform & Multi-Resolusi
- **Pendekatan Mobile-First & Touch-First**: Setiap elemen interaktif wajib memiliki target sentuh ergonomis minimal **44 × 44 px** (48 × 48 px direkomendasikan pada layar sentuh).
- **Stabilitas Rasio Non-Reguler**: Tata letak wajib stabil, fleksibel, dan adaptif pada resolusi standar maupun non-reguler (1080×2460, 1080×2380, 720p HD hingga 4K Ultra-Wide).
- **Anti-Distorsi & Zero Overlap**: Dilarang keras terjadi teks terpotong, badge bertumpuk, atau komponen meluap (*overflow*) di luar viewport. Mode *Portrait* dan *Landscape* wajib diuji secara terpisah.
- **Eliminasi Ketergantungan Hover**: Seluruh fitur dan aksi tombol harus dapat dioperasikan secara penuh melalui sentuhan (*tap/click*) tanpa bergantung pada interaksi *hover-only*.

### 4.2. Keterbacaan Konten & Sistem Warna Kontras Tinggi (Readability First)
- **Desain Dark Slate Glassmorphism Modern**: Menggunakan kanvas gelap pekat berkelas (`#060911`, `#0B0F19`), permukaan kaca translucent (`SurfaceGlass`, `SurfaceDock`), dan garis batas kaca halus (*hairline border* 1px `rgba(255, 255, 255, 0.08)`).
- **Kontras Teks Terkalibrasi**: Teks primer (`#F8FAFC`), teks sekunder (`#94A3B8`), dan teks redup (`#64748B`) wajib memiliki rasio kontras tinggi yang nyaman di mata dan tidak bertabrakan dengan latar belakang.
- **Hierarki Tipografi Jelas**: Menggunakan skala tipografi terstruktur (Header, Title, Body, Subtitle, Metric Token, Badge Pill) dengan pembatasan lebar teks maksimal untuk mencegah wrap teks yang canggung.

### 4.3. Animasi Ringan, Fungsional & Halus
- **Durasi Mikro-Animasi Terkalibrasi**: Seluruh transisi, modal open/close, hover pendaran, dan rotasi spinner dibatasi dalam rentang **150–350 ms**.
- **Akselerasi Perangkat Keras**: Menggunakan properti CSS hemat daya (`transform`, `opacity`) agar animasi tetap berjalan stabil 60 FPS pada perangkat berspesifikasi rendah.

### 4.4. Virtualisasi Performa Tinggi & 0ms Paint
- **Multi-Tier Virtualization**: Menggunakan `@tanstack/react-virtual` pada daftar transfer dan galeri berkas untuk merender 50.000+ item media secara instan tanpa lag memori (*DOM thrashing*).
- **0ms Mini-Thumb Rendering**: Memanfaatkan `PhotoSize::Stripped` untuk rendering thumbnail instan sebelum citra resolusi penuh selesai diunduh.

### 4.5. Lokalisasi 100% Zero Hardcoded Strings
- **Paritas Kunci 100%**: Setiap teks, label tombol, placeholder, modal, tooltip, dan pesan error wajib diekstrak ke `src/locales/id/*.json` dan `src/locales/en/*.json`.
- **Standar Bahasa Indonesia**: Menggunakan kosa kata baku profesional, seperti preferensi kata **murid** (bukan *siswa*).

---

## 5. Dokumen Spesifikasi Terperinci Terkait
- **[PRD: Unified Media Delivery, Transcoding & Transfer Engine](./PRD_UNIFIED_MEDIA_ENGINE.md)**: Dokumen PRD terperinci mencakup seluruh tabel matriks format, transcoding, stiker Lottie, MTProto chunking, dan 7-Tier Lifecycle Architecture.
- **[Master Upload Workflow (.mmd)](../architecture/MASTER_UPLOAD_WORKFLOW.mmd)**: Diagram alur kerja lengkap dalam format Mermaid.
- **[Dokumentasi Publik Pengguna](../../docs/README.md)**: Indeks panduan pengguna publik.
- **[Manual Induk Agen (AGENTS.md)](../../../AGENTS.md)**: Standar operasional master AI Agent.

