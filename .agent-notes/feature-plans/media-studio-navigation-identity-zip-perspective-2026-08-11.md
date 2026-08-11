# Media Studio navigation, identity, ZIP, and perspective plan

## Scope

Implement and verify the seven Media Studio requests from 2026-08-11 without changing protected preview, stream, buffer, or thumbnail behavior.

## Active call-chain map

- Sidebar chat folders: `MediaStudio/index.tsx` owns folder state -> `DriveSidebarIndex.tsx` renders filter/folder pills and pointer drop keys -> Media Studio document-level pointer handlers own internal media drag completion.
- Media totals: Grammers `tg_get_media_statistics` -> `driveGetMediaStats` -> `refreshMediaStats`; complete pagination/deep-index snapshots persist exact unique totals through `tg_save_exact_media_statistics`.
- File context menu: `MediaStudioModalsContainer.tsx` builds copy values -> `DriveContextMenu.tsx` renders menu actions.
- Transfer Manager: `MediaStudio/index.tsx` owns `transferMinimized`; `DriveTopBar.tsx` invokes the toolbar callback.
- Download all: `DriveTopBar.tsx` -> `handleDownloadAll` in `MediaStudio/index.tsx`; the current localhost ZIP endpoint is an obsolete incomplete path and must be replaced by an indexed workflow.
- Perspective: `MediaStudio/index.tsx` owns `viewPerspective`; `DriveTopBar.tsx` changes filter labels; `DriveExplorer.tsx` currently ignores the perspective prop.

## Acceptance criteria

1. During internal media drag, hovering a Telegram folder pill activates it after a bounded delay, refreshes its chat rows, preserves the drag, and releasing directly on the organizational pill never moves/deletes media.
2. Filter and folder pills share one horizontal scroller. At scroll start the active filter label is visible; after horizontal movement it compacts to the active icon while retaining state color. The dropdown is not clipped.
3. Last exact cached totals render immediately per session/peer/topic, with exact per-category counts. Complete scans reconcile unique media IDs and update count, bytes, and breakdown atomically.
4. Copy ID copies only the message/location ID. Copy Path ID uses deterministic typed segments: `U`, `D`, `G`, `CH`, `B`, `C`, `T` as applicable.
5. The toolbar Transfer Manager button toggles open/minimized; programmatic transfer actions still force it open.
6. Download All ZIP opens a responsive preflight modal, indexes the complete active scope first, exposes selection/type options and exact totals, and cannot start from only viewport-loaded files.
7. Telegram and Drive perspectives change classification/filter semantics and ordering, keep their own last filter, and expose clear active-state metadata for QA.

## Safety boundaries

- No changes to ordinary/split preview, streaming, buffering, or thumbnail fetch code.
- No destructive remote drag/drop or multi-gigabyte ZIP creation during QA.
- All added visible copy is localized with ID/EN key parity.
- Restore the default Lavender session after desktop QA.

## Verification matrix

- Unit tests: folder drag target classification, path ID construction, exact media breakdown, perspective filtering/sorting.
- Frontend: test suite, locale parity/audit, production build.
- Rust: focused tests/build for any command/schema changes.
- Desktop: rebuilt `frontend.exe`; verify folder hover, scroller compaction, stats badges, context submenu, Transfer Manager toggle, ZIP preflight/index state, and perspective differences across at least Saved Messages plus a forum topic.
