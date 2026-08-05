---
name: feature-planning-architect
description: Use this skill when planning and building a new feature from idea to implementation, including requirements, UX flow, data flow, edge cases, files to modify, acceptance criteria, and staged execution.
---

# Feature Planning Architect Skill

Gunakan skill ini ketika pengguna ingin membuat fitur baru atau mengembangkan fitur yang sudah ada.

## Prinsip utama

1. Jangan langsung coding tanpa memahami fitur.
2. Rancang fitur berdasarkan kebutuhan pengguna akhir.
3. Buat rencana implementasi bertahap.
4. Pastikan fitur bisa diuji.
5. Jangan menambah kompleksitas yang tidak perlu.
6. Pertahankan behavior lama kecuali memang diminta berubah.
7. Pertimbangkan mobile, desktop, empty state, loading state, error state, dan permission.
8. Jika fitur menyentuh data, rancang struktur data dan migrasi dengan aman.

## Alur kerja

### 1. Feature brief
Tuliskan ringkasan fitur:
- nama fitur
- tujuan
- pengguna utama
- masalah yang diselesaikan

### 2. User flow
Rancang alur pengguna:
- masuk dari mana
- klik apa
- melihat apa
- menyimpan apa
- hasil akhirnya apa

### 3. Data flow
Identifikasi:
- state lokal
- state global
- API
- database
- cache
- validasi
- sinkronisasi

### 4. UI states
Pastikan semua state dipikirkan:
- default
- loading
- empty
- success
- error
- disabled
- offline jika relevan

### 5. Edge cases
Cari kasus sulit:
- data kosong
- data duplikat
- input tidak valid
- refresh halaman
- koneksi lambat
- mobile kecil
- permission tidak cukup

### 6. Implementation plan
Buat fase:
- phase 1: struktur minimal
- phase 2: logic utama
- phase 3: UI polish
- phase 4: testing dan regression check

### 7. Acceptance criteria
Buat checklist yang jelas dan bisa diuji.

## Aturan implementasi

1. Implementasi harus bertahap.
2. Setelah setiap perubahan besar, cek build/lint/test jika tersedia.
3. Jangan membuat ulang seluruh project.
4. Jangan menambah dependency tanpa alasan kuat.
5. Gunakan Context7 jika perlu dokumentasi library terbaru.
6. Gunakan Playwright/Chrome DevTools jika perlu menguji UI.
