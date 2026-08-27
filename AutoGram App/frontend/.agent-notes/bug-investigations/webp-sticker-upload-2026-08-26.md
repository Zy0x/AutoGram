# WebP upload and sticker classification investigation — 2026-08-26

## Scope

- Source matrix: `E:\Data\Upload\Upload Fix\New folder (2)`
- Native desktop target: `frontend.exe` attached through WebView2 CDP port 9230
- Session: Lavender (`session_1785668521`)
- Destination: `-1003214112048`, topic `43421` (`Tes`)

## Root causes

1. The three files named `.webp` contain JPEG/JFIF bytes. Magic-byte detection was correct, but `force_native_media` overrode the user's raw non-standard-image policy and changed their Telegram identity to native JPG media.
2. Telegram treats documents uploaded with `image/webp` specially. Even without the sticker attribute, those messages can be omitted from the document search lane used by AutoGram.
3. AutoGram previously inferred stickers from filename/MIME heuristics. A real Telegram sticker must instead be identified by the authoritative `DocumentAttribute::Sticker` TL attribute.

## Fixes

- Preserve any untransformed non-standard image source (`webp`, `heic`, `avif`, `tiff`, `bmp`, `svg`, `psd`, `raw`) as a document before presentation overrides are applied.
- Upload raw `.webp`/`.tgs` documents with neutral `application/octet-stream` MIME while preserving the original filename and exact bytes.
- Classify Sticker only from Telegram's sticker document attribute.
- Add exact Sticker categories, counts, filters, Android bridge support, and ID/EN locale parity.
- Use the unfiltered Telegram message lane for Sticker filtering, then retain only authoritative Sticker rows because Telegram document search excludes real stickers.

## Native remote evidence

- `agent-webp-current-1787744583677`: full 12-file matrix completed 12/12; exposed the source-extension override bug.
- `agent-webp-guard-1787749324581`: first guarded upload completed 3/3 but Telegram document search omitted the `image/webp` messages.
- `agent-webp-guard-1787752424475`: neutral-MIME guarded upload completed 3/3, message IDs 43720–43722.
- Exact `tg_list_media` returned all three filenames as `category=file`, `subtype=doc_photo`, `asDocument=true`, MIME `application/octet-stream`.
- Native UI topic totals after refresh: All 29, Media 23, Files 6, Stickers 0.
- The three WebP names and three HEIC names all appear under Files.
- Double-click preview of `dyantocialong-13-08-2023-0005.webp` opened the image viewer, rendered one image, and reported 1192×1488 px.
- App cache was cleared immediately before the final remote run and reported 0 B.

## Guardrails

- Do not classify ordinary WebP documents as Telegram stickers.
- Do not let album/native-media preferences silently defeat an explicit no-transcode/raw-document policy.
- Do not use filename or caption text as an authoritative media/sticker identity.
- Keep all build caches and Android tooling on drive F; local disk C was full during this investigation.

## Quality gates

- Frontend: 37 files / 322 tests passed.
- Locale audit: 5,499 ID keys and 5,499 EN keys; zero missing keys, fallbacks, or hardcoded strings.
- Frontend production build passed.
- Desktop Rust: 164 tests passed.
- Shared core Rust: 49 tests passed.
- Android bridge Rust: 1 test passed after redirecting linker `TEMP`/`TMP` to drive F.
- Android `testDebugUnitTest`, `lintDebug`, and `assembleDebug` passed.
- Debug APK: `F:\AutoGram\AutoGram App\android\app\build\outputs\apk\debug\app-debug.apk` (389.24 MB).
