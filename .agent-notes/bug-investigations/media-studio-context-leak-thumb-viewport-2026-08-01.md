# Media Studio context leak and viewport thumbnail loop — 2026-08-01

## Symptoms

- After clearing cache, Saved Messages could show media from a previously opened Drive.
- Switching Telegram sessions could briefly retain or restore the previous account's peer.
- Entering Media Studio or deep-scrolling a large Drive caused severe request churn, stutter, and occasional `frontend.exe` non-responsiveness.
- Visible video/image cards could remain without thumbnails while unrelated off-screen requests continued.
- Remote debug runs could panic while writing logs to an inherited closed stderr pipe.

## Root causes

1. IndexedDB media identity used message ID without mandatory account, peer, and topic scope.
2. Drive list in-flight/cache keys did not consistently include session + peer + topic + offset.
3. Async state updates and persisted location restore were able to outlive a peer/session generation.
4. Explicit session switching restored a previously large peer instead of landing deterministically on Saved Messages.
5. Thumbnail request/event/cache correlation used legacy suffix matching and incomplete account/peer/topic identity.
6. Every card could enqueue its own retries; overscan and automatic pagination created thousands of stale requests.
7. Rust thumbnail reads used session-scoped `v100` keys while successful downloads were still written to unscoped `v99` keys, defeating the cache.
8. `eprintln!` panicked when remote `frontend.exe` inherited a closed stderr pipe.

## Fixes

- Migrated media cache schema to account + peer + scope + topic + message identity and removed unsafe legacy rows.
- Made Grammers list requests authoritative and scoped every in-flight/snapshot key.
- Added peer/session generation guards around all asynchronous list/cache updates.
- Explicit session switches now persist and open Saved Messages; cache clear removes persisted peer locations.
- Added strict session/peer/topic render guards and diagnostic data attributes for remote verification.
- Centralized normal thumbnail loading in an exact DOM-viewport scheduler with replace semantics, stale-queue cancellation, coalesced flushes, and bounded pagination.
- Scoped frontend, Rust memory, and Rust disk thumbnail keys by session/peer/topic/message/quality.
- Unified Rust thumbnail read/write keys through `thumb_item_cache_key` and added a regression test.
- Replaced panic-prone stderr logging with a locked best-effort writer.

## Verification evidence

- Frontend production build: pass.
- Vitest: 5 files, 26 tests passed.
- Rust: `cargo fmt -- --check` pass; 50 tests passed.
- Remote health: 100; suite pass; connection observed at 13–25 ms, Very Strong.
- Two independent clear-cache cycles: Saved only `peer=me`; two distinct `#Gudang` Drives only their exact peer; zero mismatches.
- Cross-context remote audit: Saved, two Drives, bot, channel, group, user, forum, and topic all had exact session/peer/topic identity; zero mismatches.
- Session switch Lavender -> Mantan Gadis -> Lavender: both directions landed on Saved Messages; exact target session and `peer=me` only.
- Cold deep-scroll viewport: 12/12 video thumbnails painted by 400 ms after five pagination jumps.
- Warm revisit: 8/8 painted by 200 ms; request starts fell from 121 cold to 16 warm.
- Document preview: `detail.json` editor ready in 636 ms.
- Video preview: video element ready/open in 1,165 ms, playback advancing by 1.5 s, stable element/source, full browser buffer, seek successful, no media error.
- Runtime process audit: `frontend.exe` had WebView2 only as child and zero AutoGram Python processes.
- Idle process sample: responding, 0 CPU-seconds over 5 seconds, 89.9 MB working set.
