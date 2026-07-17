# Thumbnail cold-load and pagination performance

## Symptoms

- Cold image/video thumbnails filled slowly after all caches were removed.
- Video cards without Telegram static posters could remain on `Memuat...` for more than 13 seconds.
- Loading the next metadata page paused every thumbnail, even though the long-lived worker already separates high-priority metadata from the bounded media lane.
- WebView2 can omit `navigator.deviceMemory`, causing desktop tier detection to assume 4 GB.

## Root causes

1. Each item in a thumbnail batch repeated `get_messages`; a batch of N IDs performed N metadata RPCs before static thumbnail downloads.
2. Bootstrap forced every device to one batch of at most six thumbnails and delayed proactive work for 5-9 seconds.
3. Video stream fallback downloaded 4-6 MB per pass and could run five FFmpeg attempts with 90-second timeouts.
4. Mid/high pagination unnecessarily paused the independent thumbnail lane.
5. Two orphan development workers held the Telegram session during one cold run. They were stopped by verified orphan parentage; the active worker was preserved.

## Working fix

- Resolve all batch message metadata in one Telegram request and pass the preloaded messages into thumbnail generation.
- Use device-tier startup batch/queue/concurrency caps: low-end remains single-flight; high-end may run two bounded batches.
- Unlock progressive thumbnail/card prefetch after 0.6s high, 1.0s mid, or 1.8s low instead of 5-9s.
- Keep the thumbnail lane moving during mid/high load-more; low-end still pauses it.
- Reduce video head/tail sampling to a lean first pass and a bounded fallback; full-file fallback is limited to 2 MB.
- Limit partial FFmpeg decoding to two four-second attempts while preserving output edge and JPEG quality.
- Treat missing desktop `deviceMemory` as unknown desktop memory, not automatically 4 GB; reported low memory and low core count remain conservative.

## Cache reset

- Cleared worker `cache/` contents and AutoGram WebView Cache, Code Cache, GPU cache, IndexedDB, Local Storage, Session Storage, and WebStorage.
- Preserved `worker/sessions` and secure credentials.
- Repeated the cache clear before the final cold run after diagnostic UI activity rebuilt thumbnails.

## Verification

- Frontend Vitest: 16 files, 86/86 tests passed.
- Frontend production build passed; existing Vite chunk warnings only. No lint script exists.
- Worker built-in unit runner passed and `drive_fs.py` / `drive_serve.py` compiled.
- Cold Saved Messages rendered PDF/image/file cards and valid thumbnails.
- Cold `#Gudang` video grid: all six first-row posters and most second-row posters visible in the second observation; before the fix all first-row videos were still spinners at the comparable observation.
- Scroll/load-more observations at 1,500 px and 6,000 px rendered visible follow-up cards in about 1.9-2.1 seconds without pausing existing thumbnails.
- Generated 98 valid JPEG thumbnails; 0 invalid, long edge 320-440 px (average 330 px), average payload about 13.9 KB.
- Post-scroll memory: frontend about 39.3 MB; active worker pair about 8.3 MB + 75.6 MB; no force-close.
- One expected `nosample` marker remained for media that cannot produce a safe preview without expensive/full download.

## Status

- Fixed and verified on a cache-empty desktop run.
