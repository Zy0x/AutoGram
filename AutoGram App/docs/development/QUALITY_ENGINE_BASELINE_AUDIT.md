# Quality Engine v4 Baseline Audit

Date: 2026-08-04
Baseline commit: `9142181fe413d21039de4f010f04b9d7257a8206`
Specs: v4.1.0, v4.3.0, v4.4.0, v4.5.0, v4.6.0, v4.7.0

## Status

Phase 0: PASS WITH ENVIRONMENT LIMITATION.

The Rust and frontend baselines compile and their existing tests pass. FFmpeg and FFprobe are not present in PATH, the repository, the legacy imageio-ffmpeg location, `C:\ffmpeg`, Program Files, or the WinGet package cache. The product resolver therefore has no currently discoverable encoder binary. Encoder candidates must fail closed and the UI must report them as unavailable until a binary is installed or bundled.

## Active architecture and call graph

```text
React MediaStudio/index.tsx
  -> DriveTransferSettings / DriveToolsPanel
  -> CreateTransferRequest options
  -> Tauri studio_run_orchestrated
  -> core/studio_orch.rs
       -> core/media_prep.rs (remote materialization and optional FFmpeg)
       -> core/grammers_ops/media_transfer.rs
       -> Grammers upload_stream/upload_file + send_album/send_message
       -> core/job_queue.rs and transfer events
  -> transferProgressStore / Transfer Manager UI
```

Interactive Drive list, thumbnails, special thumbnails, preview streaming, buffering, and HTTP range serving use separate Grammers modules. They are outside the planned write boundary unless an integration test exposes a regression.

## Sources of current policy

- UI schema/defaults: `frontend/src/lib/telegram/driveTypes.ts`.
- UI editors: `DriveTransferSettings.tsx` and duplicated `TransferTabContent` in `DriveToolsPanel/index.tsx`.
- Job snapshot: `MediaStudio/index.tsx` builds an `options` JSON object when the upload task is created.
- Runtime routing: `studio_orch.rs` derives `as_doc`, album enablement, topic, quality mode, and hardware preference from the frozen options object.
- Preparation: `media_prep.rs` uses extension-driven video checks and a best-effort re-encode function.
- Dispatch: `grammers_ops/media_transfer.rs` infers photo/video/document presentation largely from extension and one `as_document` boolean.

## Current upload paths

1. Album path executes before the normal preparation loop. It uploads source paths directly, classifies them by extension, chunks them at 9 items, and calls Grammers `send_album`.
2. Non-album path prepares one item at a time, then uploads the prepared path as a single message.
3. ORIGINAL currently sets `as_document`; thumbnail/preview derivatives may be attached without changing source bytes.
4. Album recovery uses chat history after RPC failure or missing message IDs.

## Baseline gaps against the specifications

- HEAD deliberately chunks albums at 9, conflicting with v4.6 ALB-001 and v4.7 ALB-005, which require a valid 10-item group to remain one commit.
- Album planning happens before preparation and final payload classification.
- ORIGINAL album semantics are controlled by `as_document`, not a distinct payload class.
- Automatic single fallback can resend an uncertain album item, which v4.6 forbids until non-delivery is proven.
- There is no persisted album commit intent with UNKNOWN_COMMIT/reconciliation state.
- `forceDocumentDefault` duplicates ORIGINAL instead of a conditional presentation override.
- Upload/download concurrency are single sliders rather than separate adaptive caps.
- Encoder UI mixes strategy, CPU/GPU preference, device identity, resource profile, and fallback.
- Encoder execution is best-effort and may silently return the source after a failed encode.
- The `autogram_core` tree is mostly a disconnected foundation; production Studio does not use its policy/orchestration types.
- Transfer Manager settings are implemented twice and can drift.
- No migration currently provides the v4 transfer/album/encoder persistence model.

## Database baseline

Migrations 001-014 exist under `AutoGram App/database/migrations`. Existing runtime databases cover jobs, sessions, duplicate detection, streaming metadata, and topic media cache. The required versioned transfer profiles, rate gates, album commits/items, encoder capabilities/jobs, oversize jobs, split parts, and download ranges are not present as one coherent migration.

## Toolchain evidence

```text
node v25.0.0
npm 11.6.2
rustc 1.97.0
cargo 1.97.0
cargo check: exit 0 (pre-existing warnings)
cargo test: exit 0 (pre-existing warnings)
npm run build: exit 0
npm test -- --run: 6 files, 31 tests passed
ffmpeg/ffprobe: not discoverable in the current environment
```

## Planned change boundary

Read and likely modify:

- `frontend/src-tauri/src/core/autogram_core/` for domain policy, album, oversize, encoder, scheduling, and persistence contracts.
- `frontend/src-tauri/src/core/studio_orch.rs` for integration with prepared-output album planning.
- `frontend/src-tauri/src/core/media_prep.rs` for explicit preparation receipts and fail-closed encode behavior.
- `frontend/src-tauri/src/core/grammers_ops/media_transfer.rs` for typed prepared album items and safer commit reconciliation.
- `frontend/src-tauri/src/lib.rs` and permissions for versioned commands if required.
- `frontend/src/lib/telegram/driveTypes.ts` and the Studio job snapshot for complete frozen settings.
- Transfer Settings and Drive Tools UI through one shared component.
- Indonesian and English locale files with exact key parity.
- A new idempotent SQLite migration and unit/regression tests.

Protected unless a failing test proves an integration defect:

- `core/grammers/stream.rs`
- `core/stream_server.rs`
- `core/grammers/thumbs.rs`
- `core/grammers/special_media_thumb.rs`
- preview cache, thumbnail scheduler, and `DrivePreviewModal` media path

## Primary risks

- Telegram commit uncertainty can create duplicate messages if a timeout is retried blindly.
- Temporary uploaded references can expire while a large group waits.
- Extension-only classification can corrupt semantics.
- A refactor that shares settings UI must preserve stored legacy settings.
- No local FFmpeg means encode behavior can be validated only at the planner/fail-closed boundary in this environment.
- Existing Rust warnings are numerous; new modules must avoid adding avoidable warnings while not broad-cleaning unrelated code.
