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
Architecture and runtime call-chain audit in progress. Protected preview, stream,
thumbnail, and special-thumbnail modules are out of scope for edits.

## Verification plan
- Focused TypeScript and Rust unit tests.
- Locale audit and production build.
- Native `frontend.exe` CDP QA with bounded runners.
- Protected-media source diff check.
