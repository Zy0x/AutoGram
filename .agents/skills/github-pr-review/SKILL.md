---
name: github-pr-review
description: Use this skill when reviewing GitHub pull requests, summarizing diffs, checking risky changes, preparing PR descriptions, or triaging issues.
---

# GitHub PR Review Skill

Gunakan skill ini ketika pengguna meminta review PR, ringkasan perubahan GitHub, analisis issue, atau pembuatan deskripsi PR.

## Fokus review

1. Pahami tujuan perubahan.
2. Baca diff secara menyeluruh.
3. Identifikasi risiko:
   - bug fungsi
   - regression UI
   - perubahan database
   - perubahan auth
   - perubahan dependency
   - potensi konflik merge
4. Jangan hanya komentar style kecil.
5. Prioritaskan hal yang berdampak pada pengguna.

## Checklist

1. Apakah perubahan sesuai kebutuhan?
2. Apakah ada behavior lama yang rusak?
3. Apakah error/loading/empty state tetap aman?
4. Apakah mobile responsive tetap baik?
5. Apakah akses data dan auth aman?
6. Apakah build/test perlu dijalankan?

## Output yang diharapkan

Saat review:
- Berikan ringkasan PR.
- Sebutkan risiko utama.
- Berikan rekomendasi perbaikan yang actionable.
- Jika aman, nyatakan aman untuk lanjut dengan catatan.
