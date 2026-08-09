# Large-stream and duplicate split investigation — 2026-08-09

## Scope

- Special large MP4 preview at peer `-1003319619788`, message `1618` (about 1.50 GB).
- Duplicate comparison modal behavior, responsive layout, selection state, navigation, and drag/drop.
- Settings navigation cleanup, duplicate index/list synchronization, transfer preflight layout, and sidebar pin action.

## Root causes found

1. The progressive stream command waited for an initial MTProto chunk before returning a local Range URL. On large files, the UI therefore remained at zero even though the local streaming server was ready.
2. Parallel tail probes were concatenated in completion order. MP4 metadata scanning could miss a valid `moov` atom because the reconstructed byte order was not deterministic.
3. Duplicate comparison reused one preview surface instead of treating A and B as independently scoped media slots. It also lacked explicit invariants preventing the same file from occupying both slots.
4. The chat-index action used its own scan entry path and the rescan control could become inert after pagination exhaustion instead of refreshing the same authoritative file list first.
5. Transfer preflight styles did not define the overlay positioning contract, allowing the dialog to collapse into the page layout.

## Fix strategy

- For files at or above 1 GiB, return the local streaming URL immediately and let the browser issue sparse Range requests; retain the existing boot target for smaller files.
- Preserve source offsets when rebuilding tail probe data and scan the bytes in correct file order.
- Give split A/B independent scoped preview sources, enforce distinct-file selection, keep/discard state, responsive vertical fallback, a thin resizer, keyboard navigation, and split-only fullscreen/reload/info behavior.
- Refresh the visible media list before extending the same pagination cursor during an index rescan.
- Make transfer preflight a fixed responsive overlay and render available local thumbnails.

## Verification evidence

- Exact 1.50 GB target played through the local Range URL; duration metadata resolved and playback time advanced.
- Head and tail 64 KiB Range probes returned HTTP 206 with the expected `Content-Range` total.
- Rust large-stream tests, frontend unit tests, TypeScript build, locale parity audit, and desktop Settings viewport matrix passed.
- A later Telegram RPC outage reproduced `RPC_CALL_FAIL`; this was kept separate from local stream correctness and is not treated as an application regression.

## Remaining caution

- Telegram currently caps the supported one-file progressive cache at 4 GiB in this application. Larger theoretical ranges cannot be remotely proven without a valid Telegram object of that size.
- Re-run the exact remote matrix when Telegram RPC connectivity is stable if fresh network evidence is required.

## Split video playback follow-up

### Symptom

- Split duplicate video cards exposed no dedicated seek/buffer track.
- Selecting a card could start its preview pipeline before the user pressed Play.
- The hidden regular-preview pipeline could also load while the split UI was mounted.

### Root cause and fix

- Card selection and playback permission shared the same `active` state. They are now separate: `activeSplitSlot` controls tools while `splitPlaybackSlot` is the only slot allowed to attach a video source.
- Split videos now render a poster-only state with no `<video>` element until Play is requested.
- The regular preview loader exits early in split mode, and switching playback slots stops and invalidates the previous split-owned progressive stream.
- A split-only player now exposes elapsed time, seek input, browser/backend buffered progress, and MTProto sparse seek requests.

### Verification

- Production build and all 40 frontend tests passed; locale parity remained 2922 EN / 2922 ID with zero hardcoded strings.
- Direct WebView2 harness against `frontend.exe` proved 0 video elements before Play, exactly 1 after Play A, and still exactly 1 after switching to Play B. The seek control and 36% buffered indicator were present after activation.
- Fresh Telegram network playback could not be repeated because both configured sessions were disconnected during the final check.
