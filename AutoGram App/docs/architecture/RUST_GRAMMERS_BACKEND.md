# Rust + Grammers Backend (Force — no Telethon runtime)

## Status

**Interactive Media Drive and Studio upload are Grammers-only on desktop.**

Python Telethon `drive-serve` is **disabled** (`FORCE_RUST_DRIVE` in `driveSession.ts`).
Studio orchestrator no longer falls back to `studio-serve`.

| Domain | Owner |
|--------|--------|
| Auth / QR / sessions | Rust Grammers |
| Drive list / bootstrap / thumbs / topics | Rust Grammers |
| Folder CRUD / file delete / move | Rust `drive_rpc` |
| Avatars batch | Rust Grammers |
| Progressive preview + Range HTTP | Rust Grammers + stream_server |
| Studio local upload / album (chunked ≤10) + forum `topic_id` | Rust `studio_orch` + Grammers |
| Studio remote URL + lean ffmpeg reencode | Rust `media_prep` (ureq + ffmpeg) |
| Thumbs Hemat / Seimbang / Jelas | Grammers `pick_thumb` + no stripped disk cache for seimbang/jelas |
| Python `drive-serve` / `media-studio` / `studio-serve` | **Blocked** in `validate_worker_args` |
| Jobs CRUD + cache size/clear | Rust `jobs_db` SQLite |
| Migration execute MVP | Rust `migration_run` (forward up to N messages via Grammers) |
| ZIP-in-message / file rename | Port in progress (Telegram limits) |

## Session files

- Runtime: `{name}.grammers.json`
- Legacy import only: `{name}.session` → import once via `tg_import_telethon_session`

## Frontend rules

1. Prefer `telegramBackend.ts` `tg_*` invokes.
2. Never start Python for thumbs/list/preview/CRUD on Tauri.
3. `driveSessionCallFor` throws `TELETHON_DISABLED` when force-rust is on.

## Remaining work

1. Full media_stats walk + index_folder on Grammers
2. Migration: Clean Copy re-upload, 4-level dedupe, resume/FloodWait parity
3. Document rename re-upload pipeline + ZIP-in-message
4. Profiles/Automation/Statistics pure Rust SQLite
5. Remove worker packaging from release
