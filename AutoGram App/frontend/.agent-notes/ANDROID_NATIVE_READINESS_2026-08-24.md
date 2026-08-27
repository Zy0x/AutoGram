# Android Native Readiness — 2026-08-24

## Implemented boundary

- Remote URL shared-text parsing is now platform-neutral in
  `src/lib/telegram/linkResolvers/shareInput.ts`; desktop clipboard and a future
  Android `ACTION_SEND`/`ACTION_VIEW` bridge use the same tested contract.
- Resolver output is a serializable `ResolvedMediaInfo` DTO with a deterministic
  resolution trace. Android UI does not need to know provider internals.
- Telegram remains behind the Rust/Grammers command boundary. Session secrets,
  FloodWait state, media indexing, transfer state, and sparse ZIP reads must not
  move into a WebView or Kotlin presentation layer.
- Forwarder jobs remain durable backend records; Activity recreation must only
  reattach to job state and must never restart a transfer implicitly.

## Native integration gates

1. Add an Android share receiver that forwards only the transient text/URI to
   `parseRemoteShareInput` through the shared application facade.
2. Replace desktop-only file pickers, cache paths, and window APIs with platform
   adapters; keep resolver, transfer, duplicate, and indexing DTOs unchanged.
3. Store Telegram session material in Android Keystore-backed encrypted storage.
4. Run transfer/index work as foreground WorkManager jobs with OS-visible pause,
   resume, network, battery, and storage constraints.
5. Use Media3/ExoPlayer for the Android player while preserving the existing
   HTTP Range and stream-generation cancellation contracts.
6. Validate lifecycle races: rotate, background, process death, share-intent
   replay, account switch, and reconnect during index/preview/transfer.

## Build status — 2026-08-27

- Native Compose client, Rust UniFFI bridge, scoped SQLite persistence, Drive
  filters (including Stickers), transfer controls, settings, and share/deep-link
  intake compile successfully.
- Android bridge Rust test: 1/1 passed.
- Gradle `testDebugUnitTest`, `lintDebug`, and `assembleDebug` passed using only
  the toolchain and caches under `F:\AutoGram`.
- ABI-specific debug APKs are emitted alongside a universal APK:
  - `app-arm64-v8a-debug.apk` — 79.55 MB
  - `app-armeabi-v7a-debug.apk` — 74.23 MB
  - `app-x86_64-debug.apk` — 78.96 MB
  - `app-x86-debug.apk` — 74.93 MB
  - `app-universal-debug.apk` — 261.95 MB
- `adb devices -l` found no connected Android device, so physical-device
  install, Keystore validation, lifecycle torture testing, and real MTProto
  transport QA remain release gates rather than being claimed as complete.

## Release blockers

- No Android build is releasable until Grammers transport packaging and session
  encryption are proven on physical devices. The generated artifacts are debug
  QA APKs, not production-signed releases.
- Remote providers requiring browser interaction need an explicit Custom Tabs
  handoff; AutoGram must not bypass CAPTCHA, DRM, login, or membership gates.
- Desktop `frontend.exe` QA remains authoritative for this implementation; the
  Android target requires a separate native acceptance matrix.
