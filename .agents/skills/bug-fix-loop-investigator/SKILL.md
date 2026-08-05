---
name: bug-fix-loop-investigator
description: Use this skill when fixing persistent bugs, unresolved errors, repeated failures, hidden regressions, or bugs that require multiple inspect-patch-test cycles until verified fixed.
---

# Bug Fix Loop Investigator Skill

Gunakan skill ini ketika pengguna meminta perbaikan bug yang belum selesai, bug berulang, error membandel, atau instruksi seperti:
- "cek berulang"
- "jangan berhenti sampai selesai"
- "bug ini masih ada"
- "fix sampai benar"
- "perbaiki total"
- "cari akar masalahnya"

## Prinsip utama

1. Jangan menebak-nebak tanpa reproduksi.
2. Jangan mengklaim selesai sebelum bug diverifikasi.
3. Jangan melakukan rewrite besar sebagai solusi pertama.
4. Terapkan siklus: reproduce → diagnose → patch → test → repeat.
5. Jika patch gagal, catat kenapa gagal lalu buat hipotesis baru.
6. Jika bug tidak bisa direproduksi, buat langkah reproduksi paling dekat.
7. Jika perlu, gunakan Chrome DevTools MCP, Playwright MCP, terminal, logs, dan tests.
8. Buat catatan investigasi agar bug tidak dianalisis dari nol terus.

## Siklus wajib

### Cycle 1: Reproduce
- Jalankan project jika memungkinkan.
- Buka halaman yang bermasalah.
- Catat langkah reproduksi.
- Ambil error console/network/log.
- Identifikasi expected vs actual behavior.

### Cycle 2: Diagnose
- Cari file terkait.
- Telusuri alur data/event.
- Buat hipotesis akar masalah.
- Bedakan penyebab utama dengan gejala.

### Cycle 3: Patch
- Buat perubahan sekecil mungkin.
- Jangan mengubah banyak area sekaligus.
- Jelaskan alasan patch.

### Cycle 4: Verify
- Jalankan test/build/lint jika tersedia.
- Uji manual skenario utama.
- Uji regression sekitar fitur.
- Jika masih gagal, ulangi dengan hipotesis baru.

### Cycle 5: Stop condition
Berhenti hanya jika:
- bug sudah tidak muncul pada skenario reproduksi
- build/lint/test aman atau dijelaskan jika tidak tersedia
- tidak ada regression obvious
- pengguna diberi ringkasan perubahan

Jika belum selesai:
- Jangan bilang selesai.
- Tulis status "belum selesai" dan bukti terakhir.
- Buat daftar next hypothesis.

## Bug investigation log

Jika bug kompleks, buat atau update file:

`.agent-notes/bug-investigations/<nama-bug>.md`

Isi:
- gejala bug
- langkah reproduksi
- file terkait
- hipotesis yang sudah dicoba
- patch yang gagal
- patch yang berhasil
- test yang sudah dijalankan
- status akhir

## Output yang diharapkan

Saat menjawab:
- Jelaskan penyebab utama, bukan hanya gejala.
- Jelaskan perubahan yang dilakukan.
- Jelaskan cara verifikasi.
- Jelaskan apa yang masih berisiko jika ada.
