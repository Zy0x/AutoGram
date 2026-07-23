# Bug Investigation: Session + Stream/Buffer/Preview Conflicts

## Symptoms
- Drive session “sedang digunakan” / race saat preview + browse/transfer.
- Video preview buffer tinggi tetapi pemutaran tidak start.
- Seek progressive tidak memuat data di titik loncatan.

## Root causes found
1. **Regresi seek (v5.1.5)**: body `handleSeekJump` + import `driveStreamSeek` dihapus; scrub hanya menandai pending tanpa RPC worker.
2. **Seek deadlock**: kick hanya di `onSeeked`; seek ke hole sering tidak fire `seeked` sampai Range ada.
3. **Premature pause freeze**: autoplay gagal → event `pause` → POST `/pause` → pipeline Telegram berhenti; buffer head tampak tinggi tapi moov/pipeline macet.
4. **Play nudge gate**: `readyState < 3` skip retry ketika sudah HAVE_FUTURE_DATA tetapi tetap paused.
5. **Ghost thrash**: `needPreview=true` selalu `spawnGhostSession` meski tidak ada transfer lease → kill main + clone race.
6. **stream_ready too optimistic**: prefix tinggi tanpa moov MP4 tetap `stream_ready=true`.

## Fixes (v2.1.64)
- Restore `driveStreamSeek` seek path + debounce + onSeeking kick.
- Guard pause→worker until real play; pipeline continues until min playable head.
- Play nudge on stream_ready / browserReady without readyState upper gate.
- Ghost only when transfer lease holds main session.
- `stream_ready` requires moov for MP4 family.
- Auto-recover missing/cancelled stream once.

## Verification
- `python -m unittest engine.test_stream_*` → 20 OK
- `npm test` (frontend) → 112 OK
- Manual: open video preview, scrub mid-file, confirm “Memuat titik seek…” then play; open preview during idle (main session, no ghost thrash).

## Status
- Code verified via unit tests; desktop E2E depends on live Tauri + Telegram session.
