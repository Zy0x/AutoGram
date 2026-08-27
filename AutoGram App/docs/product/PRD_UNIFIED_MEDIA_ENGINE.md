# Product Requirements Document (PRD): Unified Media Delivery, Transcoding & Transfer Engine

**Dokumen Versi:** 3.8.32  
**Status:** Disetujui & Terimplementasi Penuh  
**Target Platform:** AutoGram Desktop (Tauri + React + Rust + Grammers MTProto) & Cloud (Supabase)  
**Lingkup Sub-Sistem:** Media Studio, Drive Explorer, Transfer Manager, MTProto Dispatcher, FFmpeg Transcoder, Preview Modal, Database Engine

---

## 1. Ringkasan Eksekutif & Tujuan Produk

AutoGram dirancang sebagai platform migrasi, manajemen penyimpanan awan, dan otomatisasi media Telegram tingkat profesional. Sub-sistem **Unified Media Delivery, Transcoding & Transfer Engine** bertindak sebagai mesin komputasi terpusat yang mengatur seluruh siklus hidup berkas: mulai dari pemilihan berkas oleh pengguna, validasi keamanan, deteksi duplikasi 4-lapis, transcoding grafis/video berakselerasi perangkat keras, pembuatan thumbnail tangguh (*resilient fallback*), pengunggahan paralel berbasis MTProto chunking, hingga pemutaran animasi vektor stiker dan *stream seeking* in-memory.

Tujuan utama dari spesifikasi produk ini adalah:
1. **Jaminan Integritas 100% Bit-Exact**: Berkas dokumen asli tidak boleh terkorupsi, terdegradasi, atau salah diklasifikasikan oleh server Telegram.
2. **Eliminasi Kesalahan Format & Glitch Visual**: Memberantas konversi otomatis stiker tanpa nama pada berkas `.webp`, menghilangkan *flicker loading* pada stiker animasi `.tgs`, serta menyediakan pratinjau instan untuk semua format.
3. **Resiliensi Tingkat Tinggi (Zero-Transfer Failure)**: Kegagalan pembuatan thumbnail atau penolakan album oleh Telegram server tidak boleh membatalkan transfer, melainkan secara otonom dipulihkan melalui *intelligent self-healing fallback*.

---

## 2. Hierarki Arsitektur 7-Layer (Unified Lifecycle Pipeline)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ TIER 0: USER INTERACTION & CONFIGURATION UI (React 19 + TypeScript + Zustand + i18n)              │
│ • Transfer Settings Hub, Media Studio, Drive Tools Modal, Format Matrix Checklists               │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │ (Tauri IPC Invocation)
┌────────────────────────────────────────────────▼─────────────────────────────────────────────────┐
│ TIER 1: ORCHESTRATION & ACCESS CONTROL LAYER (Rust: `studio_orch.rs` + `path_policy.rs`)          │
│ • Validasi Path Keamanan, Registrasi Job ID, Resolusi Peer/Topic Target Telegram                  │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │
┌────────────────────────────────────────────────▼─────────────────────────────────────────────────┐
│ TIER 2: 4-LAYER DUPLICATE PREVENTION ENGINE (Rust: `drive_engine/store.rs` + SQLite)             │
│ • Level 1: Message ID | Level 2: Unique File ID | Level 3: SHA-256 Hash | Level 4: Name + Size    │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │
┌────────────────────────────────────────────────▼─────────────────────────────────────────────────┐
│ TIER 3: MEDIA CLASSIFICATION & HARDWARE PROBING (Rust: `media_prep.rs` + `media_classifier.rs`)  │
│ • Magic Byte Verification, FFmpeg Codec Probe, Hardware Acceleration Discovery (NVENC/QSV/AMF)   │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │
┌────────────────────────────────────────────────▼─────────────────────────────────────────────────┐
│ TIER 4: MEDIA PREPARATION, TRANSCODING & RESILIENT THUMBNAILS (Rust: `media_prep.rs`)            │
│ • Image Transcoder (Lossless PNG/JPEG Q100), Video Remux/Re-encode, Lottie Converter, Resilient  │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │
┌────────────────────────────────────────────────▼─────────────────────────────────────────────────┐
│ TIER 5: MTPROTO CHUNKING & NETWORK STREAMING LAYER (Rust: `media_transfer.rs` + Grammers)        │
│ • 512KB Parts, Smart Rate Controller, saveFilePart / saveBigFilePart, Typed MTProto Structs      │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │
┌────────────────────────────────────────────────▼─────────────────────────────────────────────────┐
│ TIER 6: SUBMISSION DISPATCH & SELF-HEALING FALLBACK CIRCUIT (Rust: `studio_orch.rs`)              │
│ • Direct `sendMultiMedia` vs `sendMedia`, Intelligent Unwrapping Fallback on RPC Rejection       │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │
┌────────────────────────────────────────────────▼─────────────────────────────────────────────────┐
│ TIER 7: PERSISTENT DATABASE COMMIT, CLEANUP & REAL-TIME UI SYNC                                  │
│ • SQLite/Supabase Commit (`COMPLETED`), Cache Cleanup, Tauri Event Bus Emission to UI            │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Matriks Mode Delivery & Kebijakan Pengiriman

| Mode Delivery | Filosofi Pengiriman | Perlakuan Berkas | Target Output di Telegram | Target Output di AutoGram |
| :--- | :--- | :--- | :--- | :--- |
| **`Auto` (Rekomendasi)** | Keseimbangan optimal antara kemudahan pemutaran dan kualitas. | Foto/Video dikirim sebagai *media native* (langsung dapat diputar/dilihat). Format non-standar dikirim sebagai dokumen utuh ber-thumbnail. | 🎥 Video Player / 📸 Galeri Foto / 📁 File Dokumen | 🎬 Video Player / 🖼️ Galeri / 📄 Card File |
| **`Document Lossless`** | Keaslian data 100% mutlak (*bit-exact*). Larangan kompresi Telegram. | Seluruh berkas (termasuk JPG/MP4) dikirim sebagai dokumen dengan atribut `force_file: true` dan `DocumentAttributeFilename`. | 📁 Kotak File Dokumen Mentah (Ukuran Asli & Ekstensi Utuh) | 📄 File Card Lengkap + Ekstensi Asli |
| **`Media Native`** | Pengalaman streaming dan galeri tanpa aplikasi eksternal. | Format video non-MP4 atau gambar modern di-transcode secara otomatis ke standar Telegram (H.264/AAC atau PNG/JPEG). | 🎥 Video Player Playable / 📸 Foto Galeri Chat | 🎬 Video Player / 🖼️ Image Viewer |

---

## 4. Matriks Pemrosesan & Transcoding Seluruh Format Media

### 4.1. Kategori Gambar & Grafis

| Format Input | Ekstensi | Tindakan Mesin (Mode Lossless) | Tindakan Mesin (Mode Transcode ON) | Atribut MTProto Utama | Hasil di Telegram |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Foto Standar** | `.jpg`, `.jpeg`, `.png` | Pertahankan biner asli | Pertahankan biner asli | `InputMediaUploadedPhoto` atau `Document` | Foto Galeri / Dokumen Gambar |
| **Gambar Modern** | `.webp` | Kirim bit-exact dengan `force_file: true` *(Anti-Stiker Mutlak)* | Konversi ke PNG Lossless atau JPEG Q100 | `InputMediaUploadedDocument { force_file: true, file_name }` | Kotak Dokumen WebP / Foto Galeri |
| **Kamera Apple** | `.heic`, `.heif`, `.avif`, `.jxl` | Preservasi bit-exact + Thumbnail JPEG 320px | Konversi ke PNG Lossless atau JPEG Q100 (4:4:4 Chroma) | `InputMediaUploadedDocument` / `Photo` | Dokumen Asli / Foto Kompatibel |
| **Kamera RAW** | `.raw`, `.cr2`, `.nef`, `.arw`, `.dng` | Preservasi 100% bit-exact + Thumbnail dari embedded preview | Demux sensor RAW $\to$ JPEG Q100 4:4:4 | `InputMediaUploadedDocument { force_file: true }` | File RAW Fotografer / Foto Tajam |
| **Desain Layer** | `.psd`, `.ai`, `.tiff`, `.bmp`, `.tga` | Preservasi bit-exact + Thumbnail dari flat preview | Konversi ke PNG Lossless | `InputMediaUploadedDocument { force_file: true }` | File Desain Pro + Thumbnail |
| **Vektor Grafis**| `.svg` | Preservasi XML vektor asli + Thumbnail raster | Konversi ke PNG High-Res | `InputMediaUploadedDocument { force_file: true }` | File Vektor SVG |

### 4.2. Kategori Format Animasi & Stiker

| Format Input | Tipe Animasi | Mode Anti-Sticker OFF (Standar) | Mode Anti-Sticker ON | Mekanisme Pratinjau di AutoGram |
| :--- | :--- | :--- | :--- | :--- |
| **`.tgs`** | Vektor Lottie Gzip | Dikirim sebagai stiker vektor Telegram (`DocumentAttributeSticker`) | Di-render ke Video MP4 Loop 60 FPS | **Lottie Web Engine**: Dekompresi Gzip RAM + render SVG 60 FPS instant crossfade |
| **`.webm` (Stiker)** | VP9 Video Alpha | Dikirim sebagai stiker video transparan | Di-transcode ke Video MP4 H.264 standar | Pemutar Video Transparan Looping otomatis |
| **Animated `.webp`**| Multi-Frame WebP | Dikirim sebagai dokumen WebP utuh / media animasi | Di-transcode ke GIF / MP4 loop | Pemutaran native multi-frame via stream blob |
| **`.gif`, `.apng`** | Raster Animation | Dikirim sebagai stream animasi native / dokumen | Di-transcode ke MP4 video loop | Pemutaran native browser WebView2 |

### 4.3. Kategori Video & Broadcast

| Format Input | Tipe Kontainer | Mode Delivery Auto | Mode Full Re-encode GPU | Atribut MTProto |
| :--- | :--- | :--- | :--- | :--- |
| **`.mp4`, `.m4v`** | MP4 Standar (H.264/AAC) | **Fast Remux / Direct Copy** (0% CPU, instan) | Re-encode jika resolusi melebihi batas | `DocumentAttributeVideo { supports_streaming: true, w, h, duration }` |
| **`.mov`** | Apple QuickTime / ProRes | Fast remux jika codec H.264, transcode jika ProRes/HEVC | Re-encode via GPU (NVENC/QSV/AMF) CRF 18-28 | `DocumentAttributeVideo { supports_streaming: true, w, h, duration }` |
| **`.mkv`, `.avi`** | Matroska / AVI Container | Fast remux container ke MP4 jika stream kompatibel | Re-encode video $\to$ H.264, audio $\to$ AAC 192kbps | `DocumentAttributeVideo { supports_streaming: true, w, h, duration }` |
| **`.ts`, `.flv`, `.wmv`** | Broadcast / Legacy Stream | Transcode ke MP4 H.264 standar | Re-encode via GPU/CPU preset fast | `DocumentAttributeVideo { supports_streaming: true, w, h, duration }` |
| **Video Bulat (1:1)**| Telescope Round Video | Validasi rasio 1:1, durasi $\le 60$ detik | Encode MP4 1:1 384×384 px | `DocumentAttributeVideo { round_message: true, w: 384, h: 384 }` |

### 4.4. Kategori Audio, Suara, & Musik

| Format Input | Tipe Audio | Ekstraksi Metadata di `media_prep.rs` | Atribut MTProto | Hasil di Telegram |
| :--- | :--- | :--- | :--- | :--- |
| **`.mp3`, `.m4a`, `.aac`** | Musik Standar | Ekstraksi ID3 Tag: Title, Performer, Album, & Embedded Cover Art | `DocumentAttributeAudio { title, performer, voice: false }` + thumb | Pemutar Musik Telegram (Cover Art, SeekBar) |
| **`.flac`, `.wav`, `.alac`** | Audio Lossless Hi-Fi | Ekstraksi FLAC tags + Cover Art | `DocumentAttributeAudio { voice: false }` | Musik Lossless Resolusi Tinggi |
| **`.ogg` (Opus)** | Voice Note Telegram | Hitung durasi + Generate array byte gelombang suara (*waveform*) | `DocumentAttributeAudio { voice: true, waveform: bytes }` | Pesan Suara Gelombang Interaktif |

### 4.5. Kategori Dokumen, Kode, & Arsip

| Format Input | Ekstensi | Ekstraksi & Penanganan di Mesin | Integrasi di AutoGram UI |
| :--- | :--- | :--- | :--- |
| **Dokumen PDF** | `.pdf` | Ekstrak halaman 1 sebagai thumbnail JPEG cover pratinjau | **Integrated PDF Reader Modal** interaktif |
| **Office & Teks** | `.docx`, `.xlsx`, `.pptx`, `.txt`, `.md` | Preservasi bit-exact + penyematan ikon format | List Card + Opsi Buka di Aplikasi Sistem |
| **Source Code** | `.ts`, `.rs`, `.py`, `.json`, `.sql`, `.html` | Preservasi plain text utuh | **VS Code Syntax Highlighter Viewer** |
| **Arsip ZIP** | `.zip` | Analisis struktur Central Directory untuk indeks lokal | **Sparse ZIP Range Reader** (ekstraksi tanpa full download) |
| **Arsip Non-ZIP**| `.rar`, `.7z`, `.tar`, `.gz` | Chunking 512KB multithreading `saveBigFilePart` | File Explorer Card |
| **Installer/Biner**| `.apk`, `.exe`, `.msi`, `.iso`, `.dmg` | Validasi SHA-256, bypass media encoding | Auto-detection icon APK installer di Telegram Android |

---

## 5. Mesin Pencegah Duplikasi 4-Lapis (Duplicate Engine)

Sebelum pengunggahan memakan kuota bandwidth, sistem memvalidasi integritas data melalui 4 lapisan berurutan:

```
[ Berkas Masuk ] ──> [ L1: Telegram Message ID ] ──(Cocok)──> [ EKSEKUSI DUPLICATE ACTION ]
                               │ (Tidak Ada)
                     [ L2: Telegram Unique File ID ] ──(Cocok)──┘
                               │ (Tidak Ada)
                     [ L3: SHA-256 Content Hash ] ──(Cocok)────┘
                               │ (Tidak Ada)
                     [ L4: Filename + Exact Byte Size ] ──(Cocok)┘
                               │ (Unik 100%)
                     [ LANJUTKAN TRANSFER KE TELEGRAM ]
```

### Opsi Tindakan Duplikasi (*Duplicate Action Rules*):
1. **`Skip`**: Melewati berkas secara otomatis tanpa transfer ulang.
2. **`Clean Copy`**: Membuat salinan bersih baru di target tujuan dengan pencatatan relasi database baru.
3. **`Overwrite / Replace`**: Menimpa record lama di database dengan ID pesan baru.
4. **`Force Upload`**: Mengabaikan seluruh peringatan dan memaksa unggah baru ke Telegram.

---

## 6. Arsitektur Thumbnail Tangguh (Resilient Non-Blocking Fallback)

Untuk menjamin prinsip **Nol Kegagalan Transfer (*Zero-Block Guarantee*)**:
1. **Pemisahan Jalur Ekstraksi**: Ekstraksi thumbnail berjalan di memori tanpa memblokir pembacaan stream biner berkas utama.
2. **Graceful Fallback**: Jika pembuatan thumbnail JPEG gagal (karena format RAW eksotis, demuxer crash, atau berkas terenkripsi), sistem **TIDAK AKAN MEMBATALKAN TRANSFER**. Berkas asli tetap diunggah 100% sukses dengan fallback ke ikon ekstensi bawaan Telegram.
3. **Anti-Demuxer Probe Stutter**: Pengecekan gambar statis tunggal (seperti `.webp` dan `.png`) menonaktifkan flag seeking `-ss 0.0` FFmpeg yang tidak perlu, mencegah galat demuxer pada berkas gambar 1 frame.

---

## 7. Pengunggahan MTProto, Chunking, & Rate Controller

### 7.1. Pembagian Blok Data (Chunking 512 KB)
* **Berkas $\le 10$ MB**: Diunggah menggunakan `upload.saveFilePart` (Single part buffer in RAM).
* **Berkas $> 10$ MB**: Diunggah menggunakan `upload.saveBigFilePart` (Parallel high-speed chunk streamer).
* **Part Indexing**: Setiap part diberi index `part_id: 0, 1, 2... N` dengan ukuran blok 524.288 bytes (512 KB).

### 7.2. Smart Rate Controller & Anti-Flood Protection
* **Slot Konkurensi**: Mendukung 1 hingga 10 *parallel lanes* per akun.
* **Token Bucket Algorithm**: Membatasi laju request RPC per detik sesuai kapasitas server Telegram.
* **FloodWait Auto-Backoff**: Jika Telegram mengembalikan error `RpcError(420, FLOOD_WAIT_X)`:
  - Jika $X \le 35$ detik: Mesin melakukan *adaptive jittered sleep* dan otomatis melanjutkan transfer saat cooldown selesai.
  - Jika $X > 35$ detik: Menandai antrean dengan status `WAITING_COOLDOWN` dan berpindah memproses berkas di akun lain yang sedang idle.

---

## 8. Agregasi Album & Mesin Pemulihan Mandiri (Self-Healing Circuit)

```
[ Batch 2-10 Berkas ] ──> [ messages.sendMultiMedia ]
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
            [ SUKSES ]              [ GAGAL: e.g. MEDIA_EMPTY / RPC 400 ]
                 │                               │
                 │                               ▼
                 │             ┌────────────────────────────────────┐
                 │             │ INTELLIGENT SELF-HEALING FALLBACK  │
                 │             │ Otomatis beralih mengirim tiap     │
                 │             │ berkas secara satuan (sendMedia)   │
                 │             │ dengan caption & thumbnail utuh    │
                 │             └─────────────────┬──────────────────┘
                 │                               │
                 └───────────────────────────────┴──> [ Selesai 100% ]
```

---

## 9. Subsistem Lanjutan Tambahan

1. **Client-Side Progressive Stream Server (`stream_server.rs`)**:
   - Menjalankan server HTTP Range lokal internal di Rust.
   - Memungkinkan *instant video seeking* pada video 2GB–4GB di modal pratinjau AutoGram dengan hanya meminta byte range MTProto yang dibutuhkan.
2. **Sparse ZIP Range Reader**:
   - Membaca Central Directory ZIP langsung dari blok akhir MTProto.
   - Membuka, mempratinjau, dan mengekstrak foto di dalam ZIP 1GB+ dengan konsumsi kuota hanya seukuran file yang dibuka (~1 MB).
3. **Remote Link Ingestion (`remote_link_resolver.rs`)**:
   - Mengunduh dan mentransfer media langsung dari URL eksternal (YouTube, TikTok Slideshow, Reels, Direct URL) dengan proteksi SSRF (blokir IP lokal).
4. **Multi-Account Session Leasing (`session_lease.rs`)**:
   - Mengelola banyak akun Telegram secara paralel dengan isolasi sesi, kuota rate-limit, dan antrean independen per akun.
5. **Memory Circuit Breaker (`memoryCircuitBreaker.ts`)**:
   - Memantau RAM WebView2 dan secara otomatis membebaskan cache bitmap saat menjelajahi puluhan ribu media di galeri Drive.

---

## 10. Database Schema & Sinkronisasi

### Fase 1: SQLite Lokal Desktop (`database/schema.sql`)
* **`migration_history`**: Mencatat setiap aktivitas transfer, ID pesan asal, ID pesan tujuan, status, dan timestamp.
* **`album_commits`**: Mengelola status transaksi album batch (`PENDING`, `COMPLETED`, `REVIEW_REQUIRED`).
* **`drive_files`**: Menyimpan pemetaan ID folder, metadata MIME, SHA-256 hash, dan cache struktur virtual drive.

### Fase 2: Cloud Sync (Supabase Eksklusif)
* Skema terenkripsi penuh (AES-256) dengan Row Level Security (RLS) berbasis `auth.uid()`.
* Seluruh operasi sensitif dijalankan melalui Supabase Edge Functions tanpa mengekspos credential Telegram di frontend.

---

## 11. Kriteria Keberhasilan & SLA Kinerja

| Metrik Kinerja | Target SLA | Hasil Validasi Aktual |
| :--- | :--- | :--- |
| **Toleransi Kegagalan Transfer** | 0.00% (Zero-Fail Guarantee) | Tercapai via *Intelligent Self-Healing Fallback* |
| **Kecepatan Remux Video H.264** | $< 2.0$ detik untuk file 1 GB | Rata-rata 0.6 detik (0% degradasi visual) |
| **Kecepatan Buka Stiker `.TGS`** | $< 100$ ms tanpa kedipan loading | Instant Poster Crossfade (200ms smooth transition) |
| **Efisiensi Memori Sparse ZIP** | $\le 2$ MB kuota untuk file 1 GB+ | 100% bit-range MTProto streaming |
| **Cakupan Pengujian Unit** | 100% Pass pada Rust & Vitest | **165 Rust Tests Pass**, **330 Vitest Tests Pass** |
| **Audit Kebocoran String (i18n)**| 0 Hardcoded Strings | **5.506 Keys Parity** (Bahasa Indonesia & English) |
