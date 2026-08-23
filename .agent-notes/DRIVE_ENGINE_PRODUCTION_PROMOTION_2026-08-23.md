# Drive Engine production promotion log — 2026-08-23

## Authority and compatibility

- Product reference: `C:\Users\aliri\Downloads\AutoGram_Drive_Beta_Master_Architecture_Plan.md`.
- Runtime authority: React UI, Tauri/Rust core, and Grammers-only MTProto.
- The filesystem engine is now the production path for newly created Drives.
- Existing verified legacy `[TD]` Drives remain discoverable and retain their established Grammers behavior. No automatic destructive migration is performed.
- Historical `drive_beta_*` SQLite table identifiers remain unchanged as a storage-compatibility contract. Migration filenames, public modules, commands, API types, paths, and feature flags use `drive_engine`.

## Production behavior

- A new root Drive provisions one clean Telegram storage peer and one local UUID Drive registry.
- Recursive folders are local UUID objects; creating a nested folder no longer creates another Telegram channel.
- UI-only negative handles bridge the existing numeric React navigation contract to canonical UUID Drive/folder identities.
- Sidebar restore is SQLite-local-first. Telegram scans run afterward to reconcile legacy Drives and filter engine backing peers from the legacy list.
- Files uploaded to an engine Drive are committed to folder-scoped local metadata with Telegram chat/topic/message mappings.
- Local listing, exact counters, filtering, and sorting are scoped to the logical folder rather than scanning the shared storage peer.
- Same-Drive moves update local logical membership without redundant Telegram forwarding. Delete operations soft-delete local mappings after Telegram deletion.
- Rename, recursive move, folder delete, Drive delete, events, snapshots, integrity checks, and transactional recovery are implemented locally.

## Recovery and preservation

- `system.db` and `drive.db` use WAL, busy timeout, schema versioning, account isolation, immutable UUIDs, event journaling, and SHA-256-verified snapshots.
- The first production open atomically adopts the previous `database/drive_beta` directory only when `database/drive` does not already exist. If both exist, neither is deleted.
- Drive deletion is a recoverable local soft delete and does not delete the Telegram storage peer.
- Preview, streaming, thumbnails, special thumbnails, and sparse ZIP paths were not changed by this promotion.

## Verification evidence

- `cargo test drive_engine --lib --no-default-features --features grammers`: 7 passed after production routing, recovery, server-side sort/filter, and exact filtered totals.
- Tests cover recursive hierarchy/cycle protection, account isolation, concurrent duplicate creation, soft-delete journal/snapshot preservation, four-layer file deduplication, hash-verified restore, and the production rename/move/delete lifecycle.
- `npx tsc --noEmit`: passed after production routing, account-scoped handle cleanup, and SQLite-local-first restore.
- `npm test`: 34 files and 300 tests passed; EN/ID locale parity is 5,351/5,351 with no missing keys, fallback calls, or audited hardcoded UI strings.
- `npm run build`: passed. Existing Vite chunk-size and mixed static/dynamic-import warnings remain non-blocking.
- Live `frontend.exe` CDP 9230 read-only verification: production engine enabled, schema v2, both SQLite integrity checks `ok`, zero orphan/missing-root/dangling mappings, Cloud Drives visible, and no engine error exposed in the UI.

## Remaining gates

1. In a separately authorized test Drive, verify root creation, folder-in-folder, upload, list, move, rename, delete, restart recovery, and legacy coexistence.
2. Add remote event transport and multi-device convergence before claiming cross-device metadata replication.
3. Keep legacy migration optional until count/hash comparison and rollback acceptance gates pass.
