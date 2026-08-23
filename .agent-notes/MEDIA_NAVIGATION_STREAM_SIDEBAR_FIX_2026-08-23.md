# Media navigation, stream, and large-sidebar fix — 2026-08-23

## Reproduction evidence

- Attached log: obsolete preview retries could disconnect the shared Grammers sender pool, followed by `dropped (cancelled)` and `FILE_REFERENCE_EXPIRED`.
- Live desktop target: `U862678085/B1825028508` in Telegram and Drive perspectives.
- A completed small progressive stream could remain at `readyState=0`; fetching the same local stream into a Blob parsed immediately.
- A cold large-account sidebar previously delayed all avatars because a whole batch had to finish and successful results existed only in RAM.

## Fixes

- Scope sidebar and peer generations independently; a peer click no longer cancels the sidebar bootstrap and a queued peer refresh runs as soon as the Drive is ready.
- Preserve a durable, session-scoped sidebar tail and reconcile the authoritative first page progressively.
- Keep native media classified as media/file when its caption starts with a URL. Link-search remains a separate message projection.
- Scope preview requests by session, peer, message, and consumer request; obsolete requests cannot reconnect or tear down the shared pool.
- Stop the previous stream without deleting its reusable partial file; clear the video element before loading the next identity.
- Add a per-open stream URL generation token and disable WebView HTTP caching for Range responses.
- Fill contiguous look-ahead gaps and add a zero-Telegram-byte Blob fallback for completed videos up to 32 MB when WebView2 fails metadata parsing.
- Fix avatar batch dequeueing, persist successful avatars per session in IndexedDB, and never cache a deferred backend response as a 24-hour empty avatar.
- Render direct child folders as a separate Drive-only folder-card section above media.

## Verification

- Frontend: 34 Vitest files / 302 tests passed; locale audit passed with 5,355 ID and EN keys, zero missing/hardcoded findings.
- Production build passed.
- `cargo check` passed.
- Targeted Rust tests passed for native-media URL captions, obsolete preview consumers, and background-preview reconnect authority.
- Live folder verification: Drive `Tes` renders child folder `Topik 1` above an empty-media state.
- Live rapid session/peer navigation ended on the requested Thea bot with 49 cards, no stale empty state, and no page errors.
- Live video navigation kept one video element active and playable; repeated seeks remained `readyState=4` without media errors.
- Cold sidebar paint after persistent-cache implementation: first Telegram rows and real avatars appeared together at about 291 ms; 85 rows were visible without manual refresh.

## Remaining caution

- Global `cargo fmt --check` reports extensive pre-existing formatting drift across unrelated Rust files. Do not bulk-format the repository in this task.
