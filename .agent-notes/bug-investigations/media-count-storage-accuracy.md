# Media count and storage accuracy investigation

## Symptom

- Media count and storage size changed while paging and could be shown as final even though only part of the Drive had been read.
- A clean `#Gudang` load initially exposed 16, then 64, then a 73-item lower bound; further metadata traversal revealed a Telegram counter lower bound around 32,400 media.
- Full stats polling shared the same serialized lane as the scan, so cache peeks queued and timed out behind the work they were observing.

## Root cause

1. Worker filter failures were swallowed and the result was still marked accurate.
2. Music and voice filters were absent from the unique media walk.
3. Partial `list_files` totals overwrote accurate totals, and frontend completion trusted the request mode rather than `accurate/incomplete/estimate` flags.
4. Storage/count UI used partial totals without an accuracy gate.
5. Cache-only progress polling and stale-location stats walks accumulated in the worker background lane.
6. Empty Telegram categories were still queried even after an authoritative zero counter.

## Fix

- Carry `stats_accurate` and `stats_pending` end to end; only accept a final result when the worker explicitly marks it accurate and complete.
- Include Music and Voice, de-duplicate by message ID, mark failed filters incomplete, retry transient errors, and skip known-empty filters.
- Show only loaded lower bounds with `+` while scanning; exact count/bytes replace them only after all pagination filters drain or the unique stats walk completes.
- Route cache peeks outside the scan semaphore, allow only one frontend poll at a time, and cancel stale-location stats work when a newer location is requested.
- Auto-complete metadata only for device-tier-bounded locations; very large Drives remain progressive.

## Verification (2026-07-16)

- WebView, local/session storage, IndexedDB thumbnail cache, HTTP/GPU cache, and worker media cache were removed for a true cold test; Telegram session files and encrypted credentials were preserved.
- Cold Media Studio opened progressively: empty/loading state, 16 files, then 64+; the app stayed responsive and the worker remained around 78 MB during the background scan.
- The large Drive no longer presents 73 or ~2.45 GB as final; loaded values retain `+` until authoritative completion.
- Frontend Vitest passed 81/81; production build passed; worker `py_compile` and focused media-stats unit checks passed.
- The full helper script still has one unrelated existing Pillow thumbnail-edge assertion failure when run with Pillow enabled.
