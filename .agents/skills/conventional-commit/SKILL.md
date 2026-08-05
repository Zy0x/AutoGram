---
name: conventional-commit
description: Use this skill when writing commit messages, summarizing git diffs, preparing changelogs, or creating clean version-control history.
---

# Conventional Commit Skill

Gunakan skill ini ketika pengguna meminta commit message, ringkasan perubahan, changelog, atau versi release.

## Format

Gunakan format:

`type(scope): description`

## Type yang boleh

- feat: fitur baru
- fix: perbaikan bug
- refactor: perubahan struktur tanpa mengubah behavior
- style: perubahan tampilan/format
- perf: peningkatan performa
- docs: dokumentasi
- test: pengujian
- chore: konfigurasi atau maintenance

## Aturan

1. Gunakan kalimat pendek dan jelas.
2. Jangan terlalu umum seperti "update" atau "fix bug".
3. Scope boleh diisi nama halaman, fitur, atau modul.
4. Jika ada breaking change, jelaskan di body.
5. Jika pengguna meminta bahasa Indonesia, gunakan bahasa Indonesia.

## Contoh

`fix(input-nilai): prevent dropdown opening during touch scroll`

`style(ui): simplify BAB and tugas accordion layout`

`perf(table): reduce unnecessary render on score input page`
