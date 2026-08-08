# Bug Investigation: Saved Message /81 Preview, Locale Parity, and General Settings

## Symptoms
- The launcher default session is Lavender, while Media Studio is opened with Mantan Gadis.
- Saved Messages video locator `/81` renders a thumbnail but remains loading in the preview modal.
- Some user-facing copy is not consistently localized between Indonesian and English.
- The launcher gear opens Drive settings instead of a general application settings surface.

## Reproduction steps
- Reproduced in the live Tauri window through its remote-debugging endpoint.
- Switched the Drive workspace to `Mantan Gadis` while the default launcher session remained `Lavender`.
- Opened Saved Messages and the preview button for message `/81` (`video/mp4`, about 156 MB).
- Observed repeated `loadstart`/`waiting` events, no metadata, and the existing stream-reload error.

## Expected behavior
- `/81` plays through the same stable preview contract as other videos without changing healthy preview behavior.
- Every user-facing string is resolved through i18n with ID/EN key parity.
- The launcher gear opens general application settings; Drive and Forwarder retain their scoped settings.

## Actual behavior
- `/81` remains in a loading state despite having a valid card thumbnail.
- Locale and settings routing require a repository-wide audit.
- Stream status persisted `done=true` although only head and tail byte ranges existed. A sanitized direct Tauri call returned `source=disk_cache`, proving the invalid sparse entry was reused.

## Suspected files
- `AutoGram App/frontend/src-tauri/src/core/grammers/stream.rs`
- `AutoGram App/frontend/src-tauri/src/core/stream_server.rs`
- `AutoGram App/frontend/src-tauri/src/core/session_rate.rs`
- `AutoGram App/frontend/src/App.tsx`
- `AutoGram App/frontend/src/pages/SessionLauncher/index.tsx`
- `AutoGram App/frontend/src/pages/Settings/index.tsx`

## Hypotheses tried
- Confirmed: cache reuse trusted `done` plus preallocated logical file length instead of verified byte-range coverage.
- Confirmed: cancellation could leave the fill loop as `Ok(())`, after which finalization unconditionally persisted `done=true`.
- Confirmed: `gme-81` did not include the Telegram session, so identical Saved Messages ids from different accounts shared one stream/cache identity.
- Confirmed related invariant: orphan `.partial` recovery inferred full coverage from logical length, which is unsafe for sparse files.

## Failed fixes
- None.

## Working fix
- Add an opaque session scope to backend cache/stream identities.
- Require complete byte-range coverage before reusing a completed stream.
- Persist cancellation/incomplete coverage as not done.
- Fail closed when an orphan sparse file has no registry evidence.

## Verification
- Rust full suite: 104/104 passed, including new sparse/cancelled cache rejection, complete-range reuse, session isolation, stream capacity, and HTTP range tests.
- Frontend suite: 33/33 passed; production TypeScript/Vite build passed.
- Locale gate: 2,636 keys in ID and EN, exact parity, 1,881 statically used keys present, no literal fallback calls, and no hardcoded UI strings in the audited JSX/attribute/status/error surfaces.
- Direct Mantan Gadis desktop QA: `/81` loaded at 1080x576, readyState 4, advanced playback time, and used session-scoped stream `g8828a58a3ce1_me-81`; `/185`, `/186`, and `/187` also advanced without error; image `/59` and APK `/70` passed.
- Direct Lavender desktop QA: PNG `/307`, PDF `/220` (local iframe mounted), text `/318`, and APK `/232` passed.
- Direct launcher QA: gear opened General Settings with API ID/API Hash controls, did not open Drive, and Back to Launcher returned correctly.

## Next steps
- Keep `remote/test_saved_message_preview_matrix.mjs` and the locale audit in the standard regression run.
- Review and commit/merge the verified patch when explicitly requested.

## Status
- Verified locally and through the live Tauri desktop runtime; not committed or merged.
