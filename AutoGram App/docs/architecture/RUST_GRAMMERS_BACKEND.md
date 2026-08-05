# Rust + Grammers Backend (Force — no Telethon runtime)

## Status (v2.8.7)

**Interactive Media Drive, Studio upload, and Shared Core (`autogram-core`) are Grammers-only on desktop.**

Python Telethon `drive-serve` is **disabled** (`FORCE_RUST_DRIVE` in `driveSession.ts`).
Studio orchestrator no longer falls back to `studio-serve`.

| Domain | Owner | Status / Architecture (v2.8.7) |
|--------|--------|--------------------------------|
| Auth / QR / sessions | Rust Grammers | Native MTProto sessions (`{account}.grammers.json`), multi-DC pool, fresh reconnect on RPC timeout -503 |
| Shared Modular Core | Rust `autogram-core` | Persistent job queue with SQLite WAL, dependency graph, byte-offset checkpoint resume, faststart MP4 repair, policy engine, intent engine, account score (0-100), audit trail logging |
| Drive list / bootstrap / thumbs / topics | Rust Grammers | Instant 0ms mini-thumb (`PhotoSize::Stripped`), LIFO Viewport Priority Scheduler, topic media search via `messages.search` |
| Folder CRUD / file delete / move | Rust `drive_rpc` | Native RPC execution with canonical `MediaIdentity` (`accountId`, `peerId`, `topicId`, `messageId`) |
| Avatars batch | Rust Grammers | Direct DC batch fetch |
| Progressive preview + Range HTTP | Rust Grammers + `stream_server` | Ephemeral Range HTTP `206 Partial Content` server with 512KB MTProto boundary alignment |
| Studio local upload / album (3x3 grid) | Rust `studio_orch` + Grammers | Smart 3x3 Grid Chunking Engine (max ≤9 items per album), explicit `reply_to` forum topic routing, single upload fallback retry, partial album history recovery (`try_recover_album_from_history`), committing phase state |
| Studio remote URL + Hardware GPU reencode | Rust `media_prep` + `hardware_capability` | Dynamic GPU allocation (NVENC / AMF / QSV / CPU), FFmpeg encoder params (`-rc vbr`, `-quality speed`), video document attribute & 320px thumbnail injection, dynamic re-encoded size sync |
| Thumbs Hemat / Seimbang / Jelas | Grammers `pick_thumb` + `special_media_thumb` | Dual-tier async special media background worker for videos without static thumbnails, terminal `.nothumb` & `"NOT_FOUND"` negative cache |
| Realtime Progress Streaming | Rust `upload_stream` + Tauri Events | `ProgressAsyncReader` emitting `StudioProgress` and `StudioItemDone` real-time progress events |
| Python `drive-serve` / `media-studio` / `studio-serve` | **Blocked** in `validate_worker_args` | Blocked permanently |
| Jobs CRUD + WAL checkpoint | Rust `jobs_db` + `autogram-core` | SQLite WAL job queue, task execution tracking, cache size/clear |
| Migration execute MVP | Rust `migration_run` | Clean copy forward/upload up to N messages via Grammers + 4-level dedupe engine |
| ZIP-in-message / file rename | Grammers `grammers_sparse_zip` | Seekable local HTTP range bridge, 64-bit MOOV atom parser, sparse entry preview |

## Session files

- Runtime: `{name}.grammers.json`
- Legacy import only: `{name}.session` → import once via `tg_import_telethon_session`

## Frontend rules

1. Prefer `telegramBackend.ts` `tg_*` invokes.
2. Never start Python for thumbs/list/preview/CRUD on Tauri.
3. `driveSessionCallFor` throws `TELETHON_DISABLED` when force-rust is on.
4. Always consume 100% extracted i18n text keys via `useTranslation()` (zero hardcoded strings).

## Remaining work

1. Full media_stats walk + index_folder on Grammers
2. Migration: Advanced Rule Engine UI parity & automated batch scheduling
3. Document rename re-upload pipeline + ZIP-in-message write back
4. Profiles/Automation/Statistics pure Rust SQLite UI integration
5. Remove legacy worker packaging from release

