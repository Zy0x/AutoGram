---
name: react-refactor-safe
description: Use this skill when refactoring React, Vite, Next.js, TypeScript, hooks, components, state management, props, and UI logic safely without breaking existing behavior.
---

# React Refactor Safe Skill

Gunakan skill ini ketika mengubah kode React, Vite, Next.js, TypeScript, komponen UI, hooks, state, props, atau struktur halaman.

## Prinsip utama

1. Jangan rewrite total jika perbaikan kecil cukup.
2. Pertahankan behavior lama kecuali pengguna meminta perubahan.
3. Jangan menghapus fitur yang masih dipakai.
4. Hindari membuat komponen terlalu besar.
5. Pisahkan logic, layout, dan helper bila mulai kompleks.
6. Pastikan nama variabel jelas.
7. Pastikan TypeScript tetap aman.
8. Jangan membuat dependency baru tanpa alasan kuat.

## Langkah kerja

1. Pahami dulu alur file dan komponen yang terlibat.
2. Identifikasi bug atau masalah utama.
3. Buat patch minimal tapi rapi.
4. Periksa efek samping pada komponen lain.
5. Jalankan build/lint/test jika tersedia.
6. Perbaiki error sampai bersih.

## Aturan UI

1. Gunakan komponen reusable jika pola berulang.
2. Hindari inline style berlebihan.
3. Pastikan className tidak saling bentrok.
4. Pastikan mobile-first.
5. Pastikan loading, empty state, dan error state tetap ada.

## Output yang diharapkan

Setelah refactor:
- Sebutkan ringkasan perubahan.
- Sebutkan risiko yang dicegah.
- Sebutkan cara testing manual.
