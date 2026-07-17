# Media Studio initial-load investigation

## Symptom

- Media Studio can remain on `Memuat file...` for more than two minutes when opening a persisted Telegram folder.
- The warm worker reports ready before its Telethon connection is established, so `Drive terhubung` was not proof that the first listing had completed.

## Measurements (2026-07-16)

- Existing boot fan-out (files + chats + topics): no cards after 37 seconds and still none after another 120 seconds.
- Isolated one-shot `list-files`, 16 items: about 2.02 seconds.
- Clean warm session plus only `list_files`, 16 items: worker ready in about 0.45 seconds; files returned in about 0.86 seconds total.

## Root cause

1. The latency-critical file request started concurrently with chat and topic discovery on the same Telegram connection.
2. React StrictMode cleanup stopped the warm worker during its development mount replay, racing the replacement boot.
3. Only the root file list was cached; a persisted folder always reopened as a blank grid.
4. The first list request also requested aggregate counters even though background media stats already refine them.

## Fix direction

- Give the first 16-file page exclusive network priority and skip quick aggregate counters.
- Start topics/chats only after the file page settles; scan folders afterwards.
- Delay worker teardown briefly so an immediate StrictMode remount can cancel it.
- Keep a bounded 12-hour stale-while-revalidate cache per session + peer + topic.

## Verification target

- Cold active folder: first cards within 3 seconds in the current desktop environment.
- Cached revisit/reload: cards visible within 1 second.
- Chat, topic, folder discovery, pagination, build, and focused tests still pass.

## Verified result (2026-07-16)

- Cold active folder with cache removed and warm worker stopped: first files in **2.07 seconds**.
- Cached full-page reload: first files in **0.69 seconds**, without `Memuat file...`.
- Pagination continued from the 16-item critical page to 49 rendered cards.
- Drives, chats, and 17 forum topics populated progressively; no list/session error appeared.
- Frontend production build passed; Vitest passed 69/69 tests; worker syntax compile passed.
- Upload temp-file IPC smoke passed (write + cleanup), guarding the prior upload fix.
- Existing worker helper suite: 17 passed, 1 unrelated pre-existing Pillow thumbnail-size assertion failed (`test_video_thumb_allows_larger_edge`).
