AutoGram Version: v2.1.87

Current State:
Perbaikan pemuatan thumbnail gambar yang gagal decode pada berkas foto >256KB (misal 29-6.jpg 344KB) akibat pembatasan chunk terpotong. Kini berkas gambar diunduh utuh hingga 8MB untuk menjamin validitas header JPEG/PNG.

Previous:
v2.1.86 Perbaikan pemuatan thumbnail video MP4 non-faststart (Snaptik/TikTok & berkas video besar >5MB) melalui rekonstruksi struktur faststart MP4 (moov-before-mdat) untuk ekstraksi frame FFmpeg serta fallback mini-thumbnail (Tier 6).
v2.1.85 Eliminasi disconnect/reconnect storm saat FloodWait Telegram (menghapus FloodWait dari transport error), penyesuaian concurrency thumbnail (2 parallel downloads), dan fail-fast active flood window pada preview stream.
v2.1.84 Eliminasi self-imposed false FloodWait lockouts & optimalisasi kecepatan media.
v2.1.83 Perbaikan kualitas & ketajaman thumbnail grid (pencegahan cache poisoning blur placeholder & penyeleksian resolusi layer/FFmpeg frame HD untuk Seimbang dan Jelas).
v2.1.82 Optimized session & chat list boot load speed (RwLock concurrent MTProto requests + authorization profile cache).
v2.1.81 Stream buffer thrash fixed (no stopAll/delete partial killing fill). Grammers album upload dual-path. Video progressive Telethon+Rust Range.
v2.1.80 Video play stuck + buffer speed
v2.1.79 Fix video preview reload loop
v2.1.8: Phase 6 thumbs/topics/progressive scaffold
