---
name: supabase-schema-manager
description: Membantu agen membuat draft SQL schema Supabase (dengan RLS, Policy, dan Triggers) untuk sinkronisasi database aplikasi, sesuai aturan Lovable Dev AI.
---

# Supabase Schema Manager

Gunakan instruksi di bawah ini saat melakukan pembuatan atau pengeditan schema SQL database untuk proyek AutoGram:

## 1. Standar Skema
- **Tipe Data**: Selalu gunakan tipe data yang paling optimal (misal `UUID` untuk primary key, `TIMESTAMPTZ` untuk waktu).
- **Penamaan**: Gunakan *snake_case* untuk tabel dan kolom.
- **Relasi**: Definisikan *Foreign Keys* (FK) dengan aturan *ON DELETE CASCADE* atau *SET NULL* secara eksplisit.

## 2. Row Level Security (RLS)
- Segera setelah membuat tabel, wajib aktifkan RLS: `ALTER TABLE nama_tabel ENABLE ROW LEVEL SECURITY;`.
- Buat *policy* minimal untuk fungsi CRUD dasar berdasarkan autentikasi. Contoh:
```sql
CREATE POLICY "Users can insert their own data" 
ON nama_tabel FOR INSERT 
WITH CHECK (auth.uid() = user_id);
```

## 3. Penyimpanan SQL
Setiap skema yang baru diusulkan **harus** dimasukkan ke dalam `AutoGram App/database/schema.sql` atau dibuat sebagai file migrasi `.sql` berurut dalam `AutoGram App/database/migrations/`.
Pastikan setiap *draft* SQL dapat disalin oleh *user* dan langsung di-*copy-paste* dengan aman ke Supabase SQL Editor.
