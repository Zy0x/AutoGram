# Bug Investigation: Preview Random Seek

## Symptoms
- Video preview sometimes cannot seek until most or all of the Telegram file is downloaded.
- Seeking far ahead can buffer for a long time and consumes unnecessary quota.

## Expected behavior
- Opening downloads only metadata plus a bounded playback window.
- A seek immediately prioritizes a small byte window around the requested point.
- Superseded seek work is cancelled and does not continue consuming quota.
- HTTP Range responses never expose sparse holes as downloaded bytes.

## Evidence and root-cause hypotheses
- `fill_stream_from_telegram` bootstraps head/tail, then continues sequentially to the end even when playback is paused.
- React asks the worker for a random-access range only from `onSeeked`; an unbuffered seek may never emit `seeked`, creating a deadlock until sequential download reaches the target.
- `register_stream` marks any file whose disk length reaches the declared total as fully populated; sparse head/tail or seek files can have that length while their middle remains hollow.
- Multiple distant seeks are deduplicated but old range tasks are not cancelled or deprioritized.

## Suspected files
- `AutoGram App/worker/engine/media_stream.py`
- `AutoGram App/worker/engine/drive_fs.py`
- `AutoGram App/frontend/src/components/media-drive/DrivePreviewModal.tsx`
- `AutoGram App/frontend/src/lib/driveApi.ts`

## Constraints
- Preserve Media Studio session lease and existing preview fallbacks.
- Do not fetch the full media merely to enable seek.
- Keep Telegram FloodWait handling and never log session/API secrets.

## Status
- Reproduced from code path; patch and remote verification pending.
