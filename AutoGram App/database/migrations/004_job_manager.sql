-- 004 Job Manager & Pause/Resume
-- Menambahkan kolom state management ke tabel migration_jobs

-- Menyimpan konfigurasi dalam bentuk JSON
ALTER TABLE migration_jobs ADD COLUMN config_json TEXT;

-- Menyimpan ID pesan terakhir yang diproses
ALTER TABLE migration_jobs ADD COLUMN last_processed_id INTEGER DEFAULT 0;

-- Menyimpan statistik untuk progress bar
ALTER TABLE migration_jobs ADD COLUMN total_messages INTEGER DEFAULT 0;
ALTER TABLE migration_jobs ADD COLUMN processed_messages INTEGER DEFAULT 0;

-- Memastikan nama job (sebagai identifier tambahan yang mudah dibaca)
ALTER TABLE migration_jobs ADD COLUMN job_name TEXT;
