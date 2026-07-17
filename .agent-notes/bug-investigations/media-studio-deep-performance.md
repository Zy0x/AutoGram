# Bug Investigation: Media Studio Deep Performance

## Symptoms
- Thumbnail cards can remain empty after deep scrolling and switching Drive, Chat, or topic.
- Telegram chat folders are not exposed in the Chats sidebar.
- Re-encode progress is presented as upload bytes and does not identify the active hardware backend.
- Large upload can fail with `The number of file parts is invalid (caused by SaveBigFilePartRequest)`.

## Expected behavior
- Visible thumbnails win over stale/prefetch work and never cross location boundaries.
- Telegram/Nagram dialog filters appear as responsive chat-folder tabs.
- Encode and upload telemetry are phase-accurate with safe hardware fallback.
- Large-file part count always matches Telegram's accepted request shape.

## Suspected files
- `frontend/src/lib/thumbBatcher.ts`
- `frontend/src/components/media-drive/*`
- `frontend/src/lib/transferProgress.ts`
- `worker/engine/drive_fs.py`
- `worker/engine/media_meta.py`
- `worker/engine/media_studio.py`
- `worker/engine/fast_transfer.py`

## Hypotheses tried
- Confirmed stale global thumbnail work could survive a location switch; fixed with a generation-scoped scheduler and AbortSignal waiters.
- Confirmed the 3.45 GB failure exceeded the account-specific Telegram upload-part limit at 512 KiB per part; native retry would repeat the same invalid request.
- Confirmed a late live-sync lower bound could overwrite a larger already-loaded unique count (96 loaded vs 64 reported).
- Confirmed topic changes intentionally cancel the old media-stat walk, but the cancellation sentinel was rendered as a red error banner.

## Failed fixes
- First unit-test invocation used the repository root, so `engine` was not on `PYTHONPATH`; rerun from `worker/` passed.
- Initial hardware smoke frame was 128x72, below NVENC's supported minimum; raised to 320x180.
- First Tauri build caught a test-fixture type mismatch (`apiId` number vs string); corrected before rebuilding.

## Working fix
- Visible/near/prefetch scheduler, bulk IndexedDB reads, stale queue cancellation, bounded retry, and explicit thumbnail states.
- Telegram dialog-filter worker endpoint plus per-folder cursor/list/loading/scroll state and accessible horizontal chips.
- Portal combobox replaces native Media Studio selects.
- Encoder capability smoke tests keyed by FFmpeg/GPU-driver signature, hardware decode + encode fallbacks, adaptive RAM/VRAM concurrency, and phase-correct progress events.
- Upload part limit is checked before transfer; file-part-invalid and oversize-limit failures are marked non-retryable. HQ/Smart re-encodes oversize video below the safe limit.
- Counts and bytes are clamped to unique loaded metadata so a stale lower bound cannot shrink visible totals.
- Runtime detection accepts both Tauri's flag and IPC marker, fixing false `requires desktop app` results.

## Verification
- Frontend final: 18 Vitest files / 95 tests passed.
- Worker final: 9 unit tests passed plus Python compile checks; capability probe selected usable NVENC, QSV, and x264 on the RTX 3050 machine.
- Real VP9 720p smoke re-encoded with NVENC + CUDA/NVDEC at 18.6x reported speed; test artifacts removed.
- Cold-cache desktop QA: first visible page resolved with no error; deep scroll at 25/50/75/100% had zero loading/error cards after each observation and after retry window.
- Live QA: custom Telegram chat folder reduced the chat set from 17 to 10, chat/forum topic navigation loaded without thumbnail gaps, modern comboboxes exposed keyboard-accessible options.
- Tauri debug no-bundle build passed after all guard patches.
- Final desktop smoke: connected live, topic switch finished with zero loading/error state, stale-stat banner absent, and reported total never fell below loaded cards.

## Next steps
- Optional release-only benchmark: compare the same cold-cache route/network against a tagged pre-change binary; no trustworthy pre-change binary was available in this dirty worktree.

## Status
Completed and verified.
