# Session Launcher status race — 2026-08-27

## Root cause

`tg_auth_status` successfully verified a session and saved refreshed Telegram
metadata. That metadata event triggered a second forced offline inventory load.
The inventory only knows that a Grammers session file exists, so its provisional
status is `checking`. A slower inventory response could therefore overwrite the
newer live `connected` result while the Refresh control still displayed
`Synced`.

## Fix

- Metadata-only events now update labels without reloading session inventory.
- Inventory-changing events remain explicit and still force a new list.
- Focus refreshes are cache-first and do not start redundant MTProto checks.
- A provisional `checking` inventory row cannot overwrite a verified status.
- Stale healthy evidence is displayed honestly as last verified while the live
  check runs; it is not counted as fully synchronized.
- The Refresh control derives `Synced` from every stable card being live
  `connected`, rather than from a 1.6-second success animation.
- Concurrent refresh accounting prevents one request from clearing the busy
  indicator while another request is still active.

## Evidence

- Regression suite: `sessionPicker.test.ts` 8/8 passed.
- Native `frontend.exe` CDP: three sessions painted Connected immediately.
- Manual live refresh completed all three at 40–59 ms and remained Connected.
- Refresh control remained `Synced` with `is-success`; no card reverted to
  `Checking Connection` after 8.5 seconds.
- Full frontend suite: 37 files / 325 tests passed.
- Locale audit: 5,500 ID and 5,500 EN keys, zero missing or hardcoded strings.
- Production TypeScript/Vite build passed.
