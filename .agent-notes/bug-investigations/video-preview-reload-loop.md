# Bug: Video preview keeps reloading during buffer (multi-video)

## Symptoms
- Opening preview and streaming several videos causes media to reload in a loop while buffering.
- UI shows continuous “memuat ulang” / buffer restart.

## Root causes
1. **`onError` → full `loadPreview`** on progressive streams when WebView2 hits buffer holes / 503 Range.
2. **`<video key={...src...}>` remount** whenever `stream_url` or `srcOverride` changed.
3. **Soft revalidate** created a **new stream_id** while previous fill still live → URL change → remount → restart.
4. **Cache TTL 90s** for progressive URLs replayed dead ports after multi-video handoff.
5. **status missing once** triggered recover soft reload.
6. **Grammers sequential progressive for video** without moov/seek parity worsened loops (now skipped for video).

## Fixes (v2.1.79)
- Progressive `onError`: wait/nudge, hard recover only after many errors + cooldown.
- Stable video/audio keys (`file.id` + quality only).
- Sticky live `stream_id` / URL during soft revalidate.
- Skip soft re-RPC while progressive live.
- Missing status needs 3 consecutive hits + not playing.
- Progressive cache TTL ~20–25s.
- Video progressive always Telethon warm path; Grammers only for small images.
- Rust `stream_ready` less optimistic; 503 holes less fatal for head Range.

## Follow-up (v2.1.80) — Screenshot 34.mp4 stuck 0:00 / “menunggu data stream · 7%”
- Cause: `driveStreamStatus` used Rust-only status (no `moov_ready`); `onError` left element in MEDIA_ERR; play nudge too slow; workers reduced on slow links.
- Fixes: Telethon status preferred; same-URL rebind on error; 900ms play nudge; more workers on slow links; denser ~100MB tiers; earlier moov-tail kick.

## Status
- Unit tests streaming_policy + stream_status_ready OK; desktop E2E with live Telegram recommended.
