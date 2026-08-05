---
name: codebase-cartographer
description: Use this skill when entering an unfamiliar project, mapping architecture, finding relevant files, understanding dependencies, and locating where a feature or bug should be changed.
---

# Codebase Cartographer Skill

Gunakan skill ini ketika agent belum memahami struktur project atau perlu mencari lokasi perubahan dengan aman.

## Prinsip utama

1. Jangan langsung mengedit file sebelum tahu struktur project.
2. Petakan folder utama terlebih dahulu.
3. Temukan entry point aplikasi.
4. Temukan halaman/komponen terkait task.
5. Temukan state management, API layer, dan route.
6. Jangan mengandalkan nama file saja; baca alur pemanggilan.
7. Buat peta singkat agar perubahan tidak salah tempat.

## Langkah kerja

1. Inspect struktur root project.
2. Identifikasi framework:
   - React/Vite
   - Next.js
   - Vue
   - Svelte
   - backend
3. Baca package.json.
4. Cari route/page terkait.
5. Cari komponen UI terkait.
6. Cari service/API/database terkait.
7. Cari test jika ada.
8. Buat "change map":
   - file yang akan dibaca
   - file yang mungkin diubah
   - file yang tidak boleh disentuh

## Output

- Ringkasan arsitektur.
- File kunci.
- Alur fitur.
- Rencana lokasi perubahan.
