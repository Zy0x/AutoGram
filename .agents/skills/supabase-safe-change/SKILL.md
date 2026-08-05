---
name: supabase-safe-change
description: Use this skill when working with Supabase database, tables, SQL, RLS policies, auth, storage, migrations, and schema changes safely.
---

# Supabase Safe Change Skill

Gunakan skill ini ketika pengguna meminta perubahan Supabase, database, SQL, auth, RLS, storage, atau migrasi.

## Aturan keamanan

1. Jangan menjalankan query destruktif tanpa persetujuan eksplisit.
2. Jangan menjalankan:
   - DROP TABLE
   - DROP COLUMN
   - DELETE tanpa WHERE
   - UPDATE tanpa WHERE
   - TRUNCATE
   - ALTER besar
   tanpa menjelaskan risiko dan meminta persetujuan.
3. Jangan menampilkan secret, service role key, token, atau credential.
4. Selalu periksa struktur tabel sebelum mengubah query.
5. Untuk RLS, jelaskan policy yang dibuat.
6. Pastikan perubahan database sesuai kebutuhan frontend.

## Langkah kerja

1. Pahami kebutuhan fitur.
2. Cek tabel, kolom, constraint, dan relasi.
3. Buat SQL yang aman.
4. Jelaskan dampak migration.
5. Jika ada data existing, siapkan strategi migrasi aman.
6. Uji query SELECT terlebih dahulu sebelum UPDATE/DELETE.

## Output yang diharapkan

Saat selesai:
- Tampilkan SQL final.
- Jelaskan risiko.
- Jelaskan rollback jika perlu.
- Jelaskan perubahan frontend yang dibutuhkan.
