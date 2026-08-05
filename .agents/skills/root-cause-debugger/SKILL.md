---
name: root-cause-debugger
description: Use this skill when debugging complex errors, stack traces, runtime crashes, state bugs, race conditions, API failures, build errors, or inconsistent behavior.
---

# Root Cause Debugger Skill

Gunakan skill ini untuk mencari akar masalah, bukan sekadar menambal error.

## Prinsip utama

1. Error message adalah bukti utama.
2. Stack trace harus dibaca dari sumber error paling awal.
3. Jangan memperbaiki symptom jika akar masalah belum jelas.
4. Bedakan:
   - compile-time error
   - runtime error
   - data error
   - UI event error
   - async/race error
   - environment/config error
5. Jangan membuat perubahan besar tanpa bukti.
6. Jika penyebab belum jelas, buat eksperimen kecil untuk membuktikan hipotesis.

## Checklist debugging

1. Kumpulkan bukti:
   - stack trace
   - console error
   - network error
   - request/response
   - relevant state
   - environment
2. Cari perubahan terakhir yang mungkin memicu bug.
3. Cari file yang muncul pada error.
4. Telusuri alur data dari input sampai output.
5. Cek null/undefined, type mismatch, stale state, race condition.
6. Cek dependency, version, env variable, path, import/export.
7. Buat patch minimal.
8. Verifikasi dengan skenario yang sama.

## Output

- Root cause
- Evidence
- Fix
- Verification
- Regression risk
