# Session Isolation, Upload Limits, and Migration Scale

## Scope

- Isolate every Media Studio cache and navigation state by Telegram session/account.
- Restore complete Telegram chat folders and prevent stale peers from crossing sessions.
- Make upload planning and re-encode output respect the active account's effective limit.
- Harden Migration/Jobs for bounded, resumable processing at 1k/10k/100k items.

## Safety constraints

- Never log session material, API hashes, access hashes, or credentials.
- Preserve the dirty worktree and do not reset unrelated changes.
- Remote Telegram validation is read-only; high-volume writes use fakes/dry-run fixtures.

## Investigation log

### 2026-07-17 - Baseline

- Status: investigating.
- Screenshot evidence: a peer from one session is opened after selecting another session, Telethon cannot resolve its `PeerChannel`, and only the synthetic chat folder is visible.
- Screenshot evidence: a 3.45 GiB transfer is rejected by the active account limit before upload.
- Parallel audits started for session/folders, upload policy, and Migration/Jobs scale.

## Pending evidence

- Exact session-key/cache leakage path.
- Dialog-filter response/serialization behavior for all Telegram filter variants.
- Effective per-account upload limit source and final-output convergence behavior.
- Peak-memory and persistence behavior at 100,000 dummy migration items.
