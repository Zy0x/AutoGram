# Transfer Manager, Indexing, and Links Investigation

## Symptoms
- Transfer phases are visually conflated and overall progress follows one active item.
- Upload/transform/commit appears slower than necessary.
- Pause/resume is not consistently offered.
- Deep indexing causes UI lag.
- Link counts exist while the Links view can be empty.
- Upload/download lack an end-to-end dry-run report.
- Re-entering Drive does not clearly surface unresolved prior work.
- Some nested UI copy may bypass locale parity checks.

## Expected behavior
- Phase-aware, aggregate progress with distinct encode/convert/upload/commit states.
- Safe boundary pause/resume that never replays an uncertain Telegram commit.
- Responsive background indexing and usable link previews.
- Read-only dry-run validation and explicit unresolved-job recovery.
- Complete ID/EN locale coverage.

## Current status
Implemented and verified on the active React/Tauri/Rust path:

- Canonical account/peer/topic IndexedDB rows paint before the network head check and survive navigation/restart boundaries.
- Ambiguous empty responses from unavailable/restricted peers no longer erase a durable index; authoritative exact zero remains deletable.
- Duplicate tools reuse the canonical index and no longer run a second Telegram pagination loop.
- Terminal transfer history has an explicit Rust-backed dismiss operation; active/queued/paused jobs cannot be dismissed.
- Link cards open a lightweight single-link preview or compact multi-link list.
- Header refresh clears volatile render/thumbnail failure state and bypasses thumbnail cache without hard-reloading WebView.
- Session metadata changes refresh launcher cards immediately.
- Frontend GC is active and its Rust IPC command is allow-listed.

Protected preview/stream behavior was not rewritten; refresh only requests visible thumbnails through the existing scoped scheduler.

## Verification plan
- Focused TypeScript and Rust unit tests.
- Locale audit and production build.
- Native `frontend.exe` CDP QA with bounded runners.
- Protected-media source diff check.

## Verification result (2026-08-20)

- `npm test`: 226/226; locale EN/ID 5,140/5,140, no missing or hardcoded strings.
- `npm run build`: passed.
- `cargo test --lib`: 134/134 passed.
- Synthetic native benchmark: 250k through 1M passed.
- `frontend.exe` CDP 9230: pause/resume passed; persisted Saved Messages repainted 7 cards after drive switch in about 403 ms; power refresh preserved 24 link cards with no console error; single and multi-link previews opened; launcher metadata refresh preserved all 4 cards.
