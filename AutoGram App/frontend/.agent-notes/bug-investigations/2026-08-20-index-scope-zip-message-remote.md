# Index scope, ZIP, message preview, and Remote Link investigation

## Symptoms

- An indexing progress badge from one peer remained visible after navigation to another Drive.
- Closing the visible index control made it unclear whether committed progress was retained.
- Cached Drive labels and cached message-derived captions could diverge from Telegram.
- ZIP folders opened on a single click and the wide table became cramped on tablet/mobile widths.
- Link previews could not copy individual URLs or hand a URL to Remote Link.
- The session launcher had no explicit live refresh action.

## Root causes

- Index progress presentation was global while the worker/database checkpoint identity was scoped.
- The active scope was not carried through the React index job state or checked before rendering events.
- Breadcrumbs preferred the local folder snapshot over the authoritative live dialog title.
- Message preview reused indexed card labels instead of fetching the source message text.
- ZIP table breakpoints assumed desktop space too early and folder activation used a single click.

## Fixes

- Added a session/peer/topic scope key to index presentation and ignored events outside the active scope.
- Kept atomic page commits/checkpoints as the durable boundary; closing cancels future work but retains committed rows.
- Raised the adaptive durable batch baseline from 100 to 200 rows to reduce frontend storage ACK overhead while keeping a 400-row memory bound and FloodWait governor.
- Prefer live Telegram dialog names and merge authoritative names into cached folder records.
- Fetch exact message text from Grammers for previews and ZIP password suggestions.
- Added responsive ZIP table/card breakpoints, mobile full-screen dialogs, two-column tablet cards, and double-click folder navigation with an explicit touch-safe chevron.
- Added individual link copy/open/Remote Link controls and safe host recognition. Telegram bot links remain manual Telegram handoffs; no ad bypass or automated join/follow is performed.
- Added an explicit launcher session refresh that forces re-enumeration and connection verification.

## Verification

- `npm test`: 29 files, 236 tests passed; locale parity 5,154/5,154, 0 missing, 0 hardcoded.
- `npm run build`: passed (existing Vite chunk-size/static-dynamic import warnings only).
- `cargo test media_index_worker --lib`: 15 passed.
- Live `frontend.exe` CDP: navigating away during indexing did not leak the prior Drive's progress badge.
- Live `frontend.exe` CDP: exact Telegram message URL rendered, individual copy/Remote actions appeared, and Remote Link opened with the original URL prefilled.
- Live `frontend.exe` CDP: launcher refresh action displayed a loading spinner and retained the session cards after verification.

## Safety boundary

- Protected archive handling only suggests explicitly labelled passwords found in the source Telegram message. It does not brute-force passwords.
- Telegram access restrictions are surfaced accurately and cached authorized rows are retained. Restrictions are not bypassed.
- Shortlink ad gates and Telegram membership requirements require user confirmation; the application does not simulate clicks or automatically join chats/channels.
