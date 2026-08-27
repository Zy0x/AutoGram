# Remote URL + Media Forwarder Execution Log

## Scope

- Execute the Remote URL and Media Forwarder power plans against the active
  React + Tauri + Rust/Grammers desktop runtime.
- Correct catalog classification for plain text mentions such as
  `@thuandmuda`.
- Extend ZIP password suggestions with bounded, read-only chat search.
- Preserve a platform-neutral boundary for a later Android native client.

## Root causes confirmed

- Plain Telegram messages without media were materialized as catalog rows and
  `drive_format` was populated with arbitrary message text. The UI then reused
  that field as a file-extension badge.
- ZIP password suggestions only inspected the selected message, so a password
  posted elsewhere in the same chat could not be proposed.
- Forwarder navigation changed the highlighted tab but did not route the Jobs
  surface into distinct active/history views.
- Telegram WebPage preview photos were normalized as native photos, causing the
  bot peer `U8420671507/B1825028508` to report media even though Telegram only
  exposes those messages in its Links surface.
- The Remote URL resolver rejected private targets, but the modal swallowed the
  safety error and continued into its renderer `HEAD` fallback.

## Working fixes

- Rust catalog conversion now drops plain-text-only messages and only creates a
  link row when Telegram text contains a real URL. A frontend compatibility
  guard hides stale rows already persisted by older builds.
- ZIP suggestions combine the current message with bounded server-side Telegram
  search for password labels and common spelling variants; no brute force and
  no sensitive text logging.
- Remote URL resolution now exposes a structured provider/stage/security trace,
  and shared text is parsed through a platform-neutral share-input DTO.
- Forwarder Jobs receives the actual selected workspace view and separates
  active work from terminal history.
- WebPage previews keep their thumbnail but retain Link identity; real media
  with URL captions remains Media and also participates in the Links lane.
- Renderer URL probing now stops on SSRF/scheme safety failures instead of
  converting them into a misleading direct-stream result.

## Verification so far

- `cargo fmt --all -- --check`: pass.
- `cargo check --lib` in an isolated target directory: pass, existing warnings
  only.
- Rust regression `plain_mentions_are_not_catalog_urls`: 1/1 pass.
- Targeted Vitest: 116/116 pass.
- Locale audit: ID/EN parity at 5,368 keys per locale, zero missing keys,
  zero fallback calls, and zero hardcoded strings.
- Production TypeScript/Vite build: pass (only the repository's existing
  chunking advisories remain).
- Scoped `git diff --check`: pass.
- Native `frontend.exe` CDP: application cache cleared (transfer database
  preserved), `@thuandmuda` card count is zero, Remote URL modal opens, private
  target guard is visible, and Forwarder New/Active/History navigation changes
  the rendered workspace.
- Native bot regression for `U8420671507/B1825028508`: six catalog rows, all
  six are Links, zero are Media, and WebPage preview thumbnails stay visible.

## Delivery boundary

- The executable Phase-1 Remote URL foundation is integrated: URL safety,
  resolver trace, candidate accounting, native-deep handoff, and portable share
  input. Provider expansion, AI extraction, creator tooling, and enterprise
  phases remain staged roadmap items rather than being misreported as complete.
- Media Forwarder's existing durable transfer engine remains intact. This pass
  fixes workspace routing and active/history separation without changing Drive
  preview, stream, thumbnail, or upload contracts.
- Android-native boundaries and migration gates are documented separately in
  `ANDROID_NATIVE_READINESS_2026-08-24.md`.

## Status

Completed for the bounded implementation scope above; later roadmap phases are
explicitly deferred.
