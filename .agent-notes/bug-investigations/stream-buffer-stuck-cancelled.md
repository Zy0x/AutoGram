# Buffer bar stuck + “Stream bermasalah”

## Evidence (`worker/temp` + `worker/cache`)
- `temp/autogram_debug.log`: drive-serve restarts; no GetFile detail lines.
- `cache/stream_registry/*.json` (all recent):
  - `34.mp4` total ~107MB, ranges only `[0, 1.5MB]`, **`cancelled: true`**
  - `33.mp4` ~404MB, ranges ~0.9MB, **cancelled**
  - Multiple streamIds per same path — thrash restart
- `cache/previews/*stream.mp4`: many **0 byte** or small partials; fill stopped.

## Root cause
1. UI `stopAll incomplete` + `delete_partial=true` on unmount/nav cancelled live GetFile and wiped progress.
2. Hard recover “Stream bermasalah” → force `loadPreview` created new stream while cancelling old.
3. No reuse of live stream for same path → endless cancel/register.

## Fix (v2.1.81)
- No stopAll on unmount; stop only current sid; keep partials.
- register_stream reuses live path; resume partial/manifest.
- onError never force-reloads progressive.
- Grammers album dual-path (migration step).

## Verify
- Open 34.mp4, leave modal open: buffer % should climb past 2%.
- Registry entry should stay `cancelled:false` while watching.
