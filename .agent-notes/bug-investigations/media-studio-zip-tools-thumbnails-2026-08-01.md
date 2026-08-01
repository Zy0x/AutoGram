# Media Studio, ZIP, Drive Tools, and thumbnail investigation

## Symptoms

- Media Studio became severely laggy and could stop responding.
- Media cards displayed generic placeholders, including the exact locator `/-1004468191168/72`.
- ZIP browsing lacked nested archives, encrypted entry handling, broad preview support, and flexible Telegram extraction destinations.
- Drive Tools & Settings had inconsistent layout and expensive visual effects.

## Root causes found

1. The frontend thumbnail queue discarded the original Telegram peer/topic and reconstructed identity from a folder id. This could request a valid message id from the wrong peer.
2. Thumbnail cache reads did not consistently include peer/topic identity, so unrelated locations could collide or miss.
3. Rust classified Telegram web-page media as unknown and returned early for several document classes before trying Telegram-native thumbnails.
4. Terminal negative thumbnail caching made transient lookup failures persist.
5. Video fallback generated synthetic SVG posters that looked like real thumbnails.
6. ZIP preview treated an archive as a flat list and did not materialize nested entries independently.
7. Drive Tools accumulated heavyweight blur/backdrop styles and inconsistent per-tab presentation.
8. QR/OTP/2FA challenges attempted to persist a `MemorySession` before Telegram exposed an auth key, producing `cannot persist session without auth_key (not logged in)` and leaving the QR screen stuck.
9. Session switching purged every non-active Grammers client, defeating the warm pool and forcing a reconnect on every account change.
10. Preview polling invoked Tauri every 60 ms and automatically rebound the video `src`, repeatedly discarding browser `TimeRanges`.
11. The Rust Range server materialized large responses into one `Vec` and ignored a bounded browser range end, turning 1 MiB requests into 16 MiB responses and increasing RAM/latency.
12. Text/code preview downloaded full files to disk and could show a synthetic error before the cold Grammers result arrived.

## Changes applied

- Preserve exact peer, topic, message id, quality, and generation across thumbnail batching and cache correlation.
- Attempt Telegram-native/content-derived thumbnails for every supported media class; recognize web-page photo/document media.
- Removed terminal negative caching from the live batch path and removed synthetic video posters.
- Added nested ZIP navigation, password-in-memory flow, media/document previews, safe entry paths, and extraction to Drive/chats/bots/channels/groups/topics.
- Reworked every Drive Tools tab into one low-cost workbench design and localized all new copy in ID/EN.
- Added frontend regression tests for locator identity and ZIP navigation, plus Rust ZIP preview/extraction tests.
- Persist auth state only after `is_authorized()` succeeds; intermediate QR/OTP/2FA states retain transport state best-effort without failing the challenge. QR remains backend-driven and refreshes expired tokens automatically.
- Keep up to three inactive Grammers clients warm with LRU eviction while respecting live session guards.
- Stream text/code samples directly through Grammers with a 2 MiB cap and Unicode-safe truncation; cold invoke misses retry internally and never flash a false error.
- Replaced the Range response allocation with a progressive file reader, honored exact requested range ends, reduced preview polling, and removed automatic source reload loops.
- Disabled Python worker commands in the compiled/invokable Tauri surface; Account/Session/Preview/Studio use Rust + Grammers runtime paths.

## Verification evidence

- `npm test`: 23 tests passed.
- `npm run build`: TypeScript and Vite production build passed.
- `cargo test ... zip_local`: 4 tests passed.
- `cargo test --lib`: 49 tests passed.
- `cargo check`, `cargo build`: debug desktop binary built successfully.
- Remote exact thumbnail locator `/-1004468191168/72`: real JPEG generated in about 2.59 s; Saved Messages showed 8 actual thumbnails out of 11 cards, with only APK and two JSON documents using intentional type placeholders.
- Remote text preview `detail.json`: 243 lines rendered in 601 ms from a cold app start, no error.
- Remote session switch: Lavender to Mantan Gadis in 637 ms at 24 ms network latency; restored in 572 ms at 8 ms, both excellent and populated.
- Remote large video `33.mp4` (403.90 MB): one stable stream URL, playing without error; exact 1 MiB HTTP range response; final seek to 65% resumed in 3.697 s without URL replacement.
- Remote small video (1.94 MB): playing by the first 500 ms sample with complete buffer and no error.
- `frontend.exe` stayed responsive around 99 MB working set after large video streaming and seeking; no AutoGram Python worker process existed.
- Cold remote bootstrap now reaches Vite, IPv6 CDP, and heal completion in about 8 seconds; the IPv6 probe no longer false-times out.

## Remaining live limitation

- A fresh QR/OTP/2FA login cannot be end-to-end completed without a user-controlled Telegram confirmation/password. The state machine, persistence guards, automatic QR rotation, and authorized-session verification paths are compiled and covered by static/runtime checks; existing authorized accounts were verified live.
