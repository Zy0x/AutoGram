AutoGram Version: v2.1.85

Current State:
Eliminasi disconnect/reconnect storm saat FloodWait Telegram (menghapus FloodWait dari transport error), penyesuaian concurrency thumbnail (2 parallel downloads), dan fail-fast active flood window pada preview stream.

Previous:
v2.1.84 Eliminasi self-imposed false FloodWait lockouts & optimalisasi kecepatan media.
v2.1.83 Perbaikan kualitas & ketajaman thumbnail grid (pencegahan cache poisoning blur placeholder & penyeleksian resolusi layer/FFmpeg frame HD untuk Seimbang dan Jelas).
v2.1.82 Optimized session & chat list boot load speed (RwLock concurrent MTProto requests + authorization profile cache).
v2.1.81 Stream buffer thrash fixed (no stopAll/delete partial killing fill). Grammers album upload dual-path. Video progressive Telethon+Rust Range.
v2.1.80 Video play stuck + buffer speed
v2.1.79 Fix video preview reload loop
v2.1.8: Phase 6 thumbs/topics/progressive scaffold
