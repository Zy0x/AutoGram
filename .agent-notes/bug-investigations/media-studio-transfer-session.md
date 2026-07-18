# Bug Investigation: Media Studio Transfer Session

## Symptoms
- Multi-file upload can finish transferring bytes while only a small subset is committed.
- Media Studio may show `Drive session stopped`, session-lock errors, or lose live data during upload.
- The first selected item is not guaranteed to commit first.
- Transfer Manager can show near-complete byte progress while commit results are incomplete.

## Reproduction evidence
- A 50-file run opened repeated `drive-list-files` and `drive-serve` workers while `media_studio` still owned the same Telegram session.
- The upload commit path falls back from an uploaded handle to `fast_send_file(path)`, which uploads the entire file again.
- Final JSON contains `message_id`, while the frontend result parser reads `id`.
- `StudioFinished` currently promotes nonterminal items to `done`.

## Expected behavior
- Exactly one process owns a Telegram session during an exclusive transfer.
- The first file has a fast lane; commits occur in source order as soon as each ordered item is ready.
- Ambiguous commit never triggers an automatic full-file re-upload.
- Every successful item has a Telegram message ID and appears in the current grid immediately.
- Debug mode records each phase with a transfer/item correlation ID.

## Suspected files
- `AutoGram App/frontend/src/lib/driveApi.ts`
- `AutoGram App/frontend/src/lib/driveSession.ts`
- `AutoGram App/frontend/src/pages/SpeedTest.tsx`
- `AutoGram App/frontend/src/lib/transferProgress.ts`
- `AutoGram App/worker/engine/media_studio.py`
- `AutoGram App/frontend/src-tauri/src/lib.rs`

## Decisions
- Preserve all existing worktree changes.
- Never automatically re-upload after an ambiguous commit.
- Remote QA may upload generated dummy files to peer `-1003214112048`, topic `5`, then delete only returned dummy message IDs.
- Do not re-upload the user's original 51-file, 2.724 GB dataset.

## Verification
- Frontend Vitest: 19 files / 112 tests passed.
- Worker unittest: 6 safe-pipeline tests passed (fast lane, ordered commit,
  ambiguous commit without re-upload, resumable parts, atomic album, journal
  redaction).
- Rust: lease unit test passed; TypeScript/Vite production build passed;
  Python compile and `git diff --check` passed.
- Remote QA run 1: 10/10 committed in order as message IDs 42691-42700;
  exact-ID cleanup deleted 10. It exposed one direct `ensureDriveSession` path
  that restarted `drive-serve` during the transfer.
- Added the lease guard at the `ensureDriveSession` boundary and repeated QA
  with new valid media fingerprints.
- Remote QA run 2: 10/10 committed in order as message IDs 42701-42710;
  exact-ID cleanup deleted 10. The transfer journal contained exactly one
  `upload_start`, `media_registered`, and `committed` event per item, no error,
  retry, reconnect, or verification event. No `drive-serve`/`drive-list-files`
  worker started inside the transfer window; one warm worker restarted only
  after `transfer_finished`.
- Remote report: `remote/reports/media-studio-safe-upload-qa.json`.
- Safety journal: `AutoGram App/worker/logs/transfers/<transfer-id>.jsonl`.

## Status
- Verified complete for the Media Studio scope in this plan.
