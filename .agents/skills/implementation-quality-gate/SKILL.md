---
name: implementation-quality-gate
description: Use this skill before marking a coding task as done, especially after feature implementation, bug fixing, refactor, UI changes, or deploy preparation.
---

# Implementation Quality Gate Skill

Gunakan skill ini sebelum menyatakan task selesai.

## Prinsip utama

1. Jangan bilang selesai hanya karena kode sudah diubah.
2. Verifikasi harus sesuai acceptance criteria.
3. Jalankan build/lint/test jika tersedia.
4. Uji manual fitur utama jika UI berubah.
5. Periksa risiko regression.
6. Ringkasan akhir harus jujur: berhasil, sebagian berhasil, atau belum selesai.

## Checklist akhir

### Functional
- Fitur utama bekerja.
- Bug yang dilaporkan sudah tidak muncul.
- Input valid dan invalid ditangani.
- Empty/loading/error state aman.

### UI/UX
- Mobile dan desktop layak.
- Tombol utama jelas.
- Tidak ada layout pecah.
- Scroll/touch nyaman jika relevan.

### Code quality
- Tidak ada kode mati yang jelas.
- Tidak ada console.log/debug sisa kecuali diminta.
- Nama variabel jelas.
- Tidak ada dependency baru yang tidak perlu.

### Safety
- Tidak ada secret/token tertulis.
- Tidak ada query database destruktif tanpa izin.
- Tidak ada perubahan global yang tidak diperlukan.

### Verification
Jalankan yang tersedia:
- npm run build
- npm run lint
- npm test
- Playwright/manual browser test
- Netlify build jika relevan

## Format status akhir

Gunakan format:

- Status: selesai / sebagian / belum selesai
- Yang diubah:
- Verifikasi:
- Risiko tersisa:
- Cara pengguna menguji:
