---
name: regression-test-planner
description: Use this skill when creating test plans, regression checks, Playwright scenarios, manual QA checklists, or verifying that a fix does not break existing features.
---

# Regression Test Planner Skill

Gunakan skill ini ketika perubahan berisiko merusak fitur lama atau saat pengguna meminta cek berulang.

## Prinsip utama

1. Test harus mengikuti alur pengguna nyata.
2. Jangan hanya test happy path.
3. Sertakan edge case.
4. Test fitur sekitar yang mungkin ikut terdampak.
5. Untuk UI, uji desktop dan mobile.
6. Untuk bug fix, test ulang langkah reproduksi lama.

## Buat test matrix

Minimal:
- Skenario utama
- Skenario input kosong
- Skenario input salah
- Skenario data banyak
- Skenario mobile
- Skenario refresh/reload
- Skenario error/network jika relevan

## Untuk Playwright

Jika Playwright tersedia:
- Buka halaman target.
- Uji klik/tap/scroll.
- Cek text penting muncul.
- Cek tidak ada console error fatal.
- Cek screenshot jika UI penting.

## Output

- Daftar skenario test.
- Prioritas test.
- Hasil test jika sudah dijalankan.
- Bug baru jika ditemukan.
