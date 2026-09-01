# Hybrid Rust–Python Architecture (AutoGram)

## Goal

**Rust + Grammers is the production backend** for orchestration, local I/O, and Telegram
MTProto. Python/Telethon is retained only as a compatibility/import adapter and is not an
execution runtime for Forwarder V2.

**Hard rule:** never break existing Media Drive, Studio transfer, migration, or auth
flows. New Forwarder execution is official-API-only with capability routing and retry;
there is no undocumented or restriction-bypassing fallback.

## Status (honest — hybrid Phase 6)

| Domain | Owner today | Notes |
|--------|-------------|--------|
| Worker spawn / lease / secrets | **Rust** | |
| Stream HTTP Range serve | **Rust** | tiny_http |
| Progressive video preview | **Rust Grammers + Rust Range** | local range proxy and sparse readers |
| Progressive image (small full) | **Rust Grammers** | dual-path when warm idle |
| Progressive seek / multi-DC | **Rust Grammers** | native MTProto range path |
| Drive list / dialogs (first paint) | **Rust Grammers first** | only when Telethon warm idle |
| Thumbs batch / forum topics | **Rust Grammers first** | dual-path when warm idle |
| Drive warm RPC (bootstrap extras) | **Rust Grammers** | native command path |
| Studio upload (local files) | **Rust Grammers first** | fallback studio-serve → media-studio |
| Studio album (2–10 local) | **Rust Grammers first** | `send_album`; >10 or remote → Telethon |
| Full download ≤200MB | **Rust Grammers** | larger → progressive |
| Media studio reencode / album / remote | **Rust Grammers** | |
| Migration engine | **Rust Grammers** | Forwarder V2 pipeline |
| Auth / dialogs / simple upload | **Rust Grammers** | `tg_*` |

### Compatibility boundary

Legacy daemon commands may still be imported during the deprecation window, but all new
forwarder jobs use the versioned Rust contract and local encrypted credential vault.

### Env

| Variable | Meaning |
|----------|---------|
| `AUTOGRAM_TELEGRAM_BACKEND=grammers` | Production Rust/Grammers path |
| `AUTOGRAM_TELEGRAM_BACKEND=telethon` | Legacy compatibility/import only |
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
