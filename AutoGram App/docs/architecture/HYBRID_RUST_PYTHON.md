# Hybrid Rust–Python Architecture (AutoGram)

## Goal

**Rust is the default backend** for orchestration, local I/O, and (where parity exists)
**Grammers MTProto**. Python **Telethon** remains the companion for features that are not
yet fully ported: multi-DC seek progressive fill, full Media Studio (album/reencode/remote),
and migration.

**Hard rule:** never break existing Media Drive, Studio transfer, migration, or auth
flows. Migrations are dual-path (new path first, automatic fallback).

## Status (honest — hybrid Phase 6)

| Domain | Owner today | Notes |
|--------|-------------|--------|
| Worker spawn / lease / secrets | **Rust** | |
| Stream HTTP Range serve | **Rust** | tiny_http |
| Progressive video preview | **Python Telethon + Rust Range** | moov/multi-DC; Grammers video progressive deferred (reload-loop risk) |
| Progressive image (small full) | **Rust Grammers** | dual-path when warm idle |
| Progressive seek / multi-DC | **Python Telethon** | media_stream advanced path |
| Drive list / dialogs (first paint) | **Rust Grammers first** | only when Telethon warm idle |
| Thumbs batch / forum topics | **Rust Grammers first** | dual-path when warm idle |
| Drive warm RPC (bootstrap extras) | **Python Telethon** | drive-serve when warm |
| Studio upload (local files) | **Rust Grammers first** | fallback studio-serve → media-studio |
| Studio album (2–10 local) | **Rust Grammers first** | `send_album`; >10 or remote → Telethon |
| Full download ≤200MB | **Rust Grammers** | larger → progressive |
| Media studio reencode / album / remote | **Python Telethon** | |
| Migration engine | **Python Telethon** | |
| Auth / dialogs / simple upload | **Rust Grammers** | `tg_*` |

### Not full Grammers yet

Multi-DC concurrent seek, album upload, reencode, and migration engine remain Telethon.
Sequential progressive + thumbs/topics/list/upload cover the common interactive path.

### Env

| Variable | Meaning |
|----------|---------|
| `AUTOGRAM_TELEGRAM_BACKEND=grammers` | Default — prefer Grammers dual-path |
| `AUTOGRAM_TELEGRAM_BACKEND=telethon` | Force Telethon for orch + dual-path |
| `AUTOGRAM_SESSIONS_DIR` | `worker/sessions` |
| `AUTOGRAM_DEBUG=1` | Verbose multi-layer logs |

Session bridge: Telethon `Name.session` → import auth_key → `Name.grammers.json`.

Settings UI: **Settings → Telegram Backend** toggles Grammers vs Telethon-only.

## Layer map

```text
React UI
   │ Tauri IPC
   ▼
RUST CORE (default)
  • job_queue / studio_orch  ──► Grammers upload (primary)
  • drive list/thumbs/topics ──► Grammers when warm idle
  • progressive preview      ──► Grammers sequential GetFile + registry
  • stream_server Range HTTP
  • grammers_ops / grammers_media
   │ spawn
   ▼
PYTHON TELETHON (companion)
  • drive-serve warm (when active), multi-DC seek stream,
    media_studio, migration, auth_manager
```

## Safety

1. Never log api_hash / session bytes / passwords.
2. Do not open the same auth_key with Telethon and Grammers at once.
   Dual-path **skips Grammers** when `drive-serve` warm session is ready.
3. Dual-path: Grammers fail → Telethon automatically where wired.
4. Prefer murid over siswa in Indonesian product copy.

## Verification

- `cargo check` / `cargo test` for Rust modules
- Frontend `tsc` + Vitest
- Manual: list files (Grammers idle), open video preview (Grammers progressive or Telethon), thumbs grid, forum topics
