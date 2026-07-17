# Staged session bootstrap

## Symptom

- Session load felt slow even though the first file page was already small.
- On fast/high-tier devices the UI immediately started file pagination, multiple
  thumbnail batches, chat soft-prefetch, full folder scan, and media statistics.
- Those overlapping Telethon jobs increased memory/socket pressure and could
  make the desktop process close under a large account.

## Root cause

- The virtualized explorer's pagination sentinel was visible on the initial
  16-item page, so high-tier auto-prefetch fetched a much larger second page.
- `requestIdleCallback` could launch chat prefetch during bootstrap rather than
  after the screen was actually settled.
- Worker media stats were in the high-priority lane; folder scans and thumbnails
  shared a three-slot lane, allowing heavy history work to overlap visible work.

## Fix in progress

- Keep first live lists immediate and unlock proactive thumbnail prefetch plus
  pagination after a tier-based 5-9 second settle window.
- Bound startup thumbnails to one six-item batch and a 28-item queue.
- Cap each subsequent file page at 24-48 items and each chat page at the device
  profile's regular page size.
- Delay extra chat prefetch to 15 seconds, full folder scan to at least 6 seconds,
  and history-wide stats to 20 seconds.
- Route folder scans and media stats through a dedicated serial worker lane;
  cap the visible-media worker lane at two concurrent commands.

## Verification

- Frontend: 12 test files / 75 tests passed.
- Production frontend build (`tsc && vite build`) passed.
- Worker: `py_compile` passed; `test_drive_fs_unit.py` completed `ok` (Pillow-only
  cases skipped because Pillow is unavailable in this environment).
- Running desktop health sample over five seconds: UI stayed responsive around
  38.4-38.5 MB; warm Python worker stayed responsive around 66.0-66.2 MB.
- Passive desktop observation showed the live Drive grid/sidebar populated and
  thumbnails continuing progressively without an error banner.

## Live accuracy and location focus follow-up

- Cache remains first-paint only. Session bootstrap and every location/topic
  switch still request an authoritative live first page.
- The active location now revalidates while open: high 15s/16 rows, mid 30s/12
  rows, low 60s/8 rows, plus a throttled refresh when the window regains focus.
- Live-head reconciliation removes missing/deleted ids in the refreshed newest
  range while retaining older pages that the user already loaded.
- Repeated polling failures use exponential backoff capped per performance tier;
  cached/last-live data remains visible and no secret/error payload is logged.
- Explorer scroll is stored by session + location kind + peer + topic + view
  mode. First open starts at top; revisits restore the last offset.
- Added unit coverage for adaptive sync/reconciliation/backoff and scroll-memory
  isolation. Current frontend result: 14 test files / 81 tests passing; production
  TypeScript/Vite build passing. Python compile/unit checks remain passing.
