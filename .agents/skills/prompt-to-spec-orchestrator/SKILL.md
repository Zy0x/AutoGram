---
name: prompt-to-spec-orchestrator
description: Use this skill when the user gives a vague, messy, incomplete, emotional, short, or poorly structured prompt and expects the agent to understand the real task, clarify it, and turn it into a precise execution plan.
---

# Prompt to Spec Orchestrator Skill

Gunakan skill ini setiap kali prompt pengguna kurang jelas, terlalu umum, terlalu emosional, atau hanya berisi instruksi pendek seperti:
- "perbaiki semuanya"
- "buat lebih bagus"
- "maksimalkan"
- "ini masih error"
- "lanjutkan"
- "rapikan"
- "buat fitur ini powerfull"
- "cek sampai benar"

Tujuan skill ini adalah mengubah prompt mentah menjadi **spesifikasi kerja yang bisa dieksekusi** tanpa membuat agent salah paham.

## Prinsip utama

1. Jangan langsung coding dari prompt kabur.
2. Ubah permintaan pengguna menjadi task brief yang jelas.
3. Jika ada informasi yang bisa disimpulkan dari project, simpulkan dulu.
4. Jika ada blocker penting, tanyakan maksimal 3 pertanyaan klarifikasi.
5. Jika tidak ada blocker, lanjutkan dengan asumsi eksplisit.
6. Jangan menolak hanya karena prompt kurang rapi.
7. Jangan mengubah maksud pengguna.
8. Pertahankan istilah "murid", bukan "siswa" jika project pendidikan.

## Langkah wajib

Saat menerima prompt kurang jelas, buat struktur internal seperti ini:

### 1. Intent
Tentukan tujuan utama pengguna:
- membuat fitur baru
- memperbaiki bug
- merapikan UI
- meningkatkan performa
- refactor
- deploy
- integrasi backend
- audit kode
- membuat dokumen

### 2. Scope
Tentukan bagian project yang kemungkinan terlibat:
- halaman
- komponen
- API
- database
- auth
- UI state
- file config
- build/deploy

### 3. Expected outcome
Ubah menjadi hasil akhir yang jelas:
- apa yang harus berubah
- apa yang tidak boleh berubah
- indikator selesai

### 4. Acceptance criteria
Buat checklist "selesai" yang bisa diuji.

### 5. Assumptions
Tulis asumsi jika ada informasi yang tidak disebutkan pengguna.

### 6. Risk
Identifikasi risiko:
- regression
- data loss
- perubahan UI terlalu besar
- performance drop
- auth/security issue
- deploy failure

### 7. Execution plan
Buat rencana singkat:
- inspect
- implement
- test
- verify
- summarize

## Format respons ke pengguna

Jika perlu klarifikasi:
- Tanyakan maksimal 3 pertanyaan paling penting.
- Jangan membuat daftar pertanyaan panjang.

Jika tidak perlu klarifikasi:
- Nyatakan pemahaman task secara singkat.
- Lanjutkan implementasi sesuai plan.
- Jangan terlalu banyak teori.

## Contoh transformasi

Prompt pengguna:
"buat input nilai lebih bagus dan bug scroll jangan macet"

Spesifikasi kerja:
- Audit halaman Input Nilai.
- Perbaiki visual hierarchy agar lebih rapi.
- Perbaiki touch scroll agar tombol/dropdown tidak aktif saat gesture scroll.
- Pastikan desktop dan mobile tetap berjalan.
- Verifikasi dengan viewport mobile dan desktop.
