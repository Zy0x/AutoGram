---
name: agent-task-memory-log
description: Use this skill when a task is long, repeated, multi-step, interrupted, or needs persistent notes about attempts, decisions, unresolved bugs, and next actions.
---

# Agent Task Memory Log Skill

Gunakan skill ini untuk task panjang, bug yang belum selesai, atau fitur kompleks agar agent tidak mengulang analisis dari nol.

## Prinsip utama

1. Simpan catatan kerja di dalam project, bukan hanya di chat.
2. Catatan harus ringkas dan berguna.
3. Catat percobaan yang gagal agar tidak diulang.
4. Catat keputusan penting.
5. Catat next step yang jelas.
6. Jangan menyimpan secret/token/password.

## Lokasi catatan

Gunakan folder:

`.agent-notes/`

Contoh:
- `.agent-notes/FEATURE_PLAN.md`
- `.agent-notes/BUG_FIX_LOG.md`
- `.agent-notes/QA_CHECKLIST.md`
- `.agent-notes/DECISIONS.md`

Untuk bug spesifik:
`.agent-notes/bug-investigations/<nama-bug>.md`

## Format catatan bug

# Bug Investigation

## Symptoms
## Reproduction steps
## Expected behavior
## Actual behavior
## Suspected files
## Hypotheses tried
## Failed fixes
## Working fix
## Verification
## Next steps
## Status

## Kapan update catatan

- Setelah menemukan root cause.
- Setelah patch gagal.
- Setelah patch berhasil.
- Setelah test berjalan.
- Sebelum berhenti jika task belum selesai.
