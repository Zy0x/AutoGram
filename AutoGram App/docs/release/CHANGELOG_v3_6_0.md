# 📋 AutoGram Changelog - v3.6.0 (Super Advanced Remote Upload & Adaptive Media Canvas)

## 🚀 Ringkasan Perilisan
Pembaruan **v3.6.0** menghadirkan arsitektur **Remote Upload Super Canggih** dengan desain antarmuka *3-Stage Progressive Disclosure UI*, *Adaptive Media Canvas* untuk seluruh variasi format konten TikTok/Douyin/YouTube (Video 120fps/60fps Master, Slideshow Full Album Pack, Profil Kreator & Avatar Master), proteksi timeout ketat (*circuit breaker*), dan kepatuhan paritas bahasa i18n 100%.

---

## 🌟 Fitur & Peningkatan Utama

### 1. 3-Stage Progressive Disclosure UI
- **Stage 1 (Universal Smart Input)**: Input cerdas yang menerima link video, foto, shortlink (`vt.tiktok.com`), profil, dan batch URLs dengan sanitasi otomatis.
- **Stage 2 (Adaptive Media Canvas)**:
  - **Mode Video**: Kartu resolusi fisik nyata (4K / 2K / 1080p 120fps / 720p / Hi-Res Audio) dengan badge estimasi ukuran byte akurat.
  - **Mode Slideshow Foto**: Carousel strip thumbnail foto dan opsi **`Semua Foto (N Foto HD - Full Album)`** yang mengalirkan seluruh foto ke Telegram Album (*Media Group*) secara utuh.
  - **Mode Profil Kreator**: Ekstraksi avatar resolusi master HD (`avatar_larger`) dan informasi akun.
- **Stage 3 (3-Pill Delivery Matrix)**: Opsi mode pengiriman (*Otomatis Adaptif*, *Media Stream Asli 1:1 Passthrough*, *Dokumen Asli*) dengan target chat/topik forum yang presisi.

### 2. Multi-Photo Slideshow Full Album Pipeline
- `RemoteUploadModal.tsx`: Mendukung pengiriman seluruh array URL foto (`allAlbumUrls`) langsung ke Telegram saat opsi Full Album dipilih.
- `tiktokResolver.ts`: Memetakan 100% foto slideshow tanpa batasan pagination.

### 3. Proteksi Batas Waktu Ketat (*Strict Timeout & Circuit Breaker*)
- Menerapkan timeout 5 detik pada seluruh inspeksi tautan dan resolver untuk mencegah *infinite hang* atau *unbounded redirect loops*.

### 4. 100% Zero Hardcoded Strings (i18n Parity)
- Seluruh teks baru terdaftar secara sinkron di `src/locales/id/speedtest.json` dan `src/locales/en/speedtest.json` dengan audit kepatuhan paritas key 100%.
