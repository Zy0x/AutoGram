# Runtime Boundary: Rust + Grammers (AutoGram)

## Production rule

Rust + Grammers owns all Telegram authentication, capability probing, media transfer,
Forwarder orchestration, local SQLite, rate limiting, checkpointing, and reconciliation.
The frontend communicates only through Tauri IPC. Telegram sessions and API credentials
remain in the encrypted local vault.

Telethon/Python is retained only for importing legacy `.session` files and historical
compatibility tooling. It is not a Forwarder execution fallback. If a legacy command is
requested but its daemon is absent, the command fails closed.

## Active ownership

| Domain | Owner | Contract |
|---|---|---|
| Desktop UI | React + Tauri IPC | No direct Telegram calls |
| Telegram MTProto | Rust Grammers | Official API only |
| Forwarder V2 | Rust | Versioned config/state/event contracts |
| Local persistence | SQLite | WAL, foreign keys, guarded migrations |
| Android execution | Rust UniFFI + Kotlin | Enabled only after Forwarder bridge/FGS is available |
| Cloud control plane | Supabase | Metadata/ciphertext/status only |
| Legacy import | Rust importer | `.session` → encrypted Grammers session |

## Forwarder contract

`JobConfigV2`, `JobStateV2`, `TaskStateV2`, `ForwardEventV2`, `MirrorMutationV2`, and
`DeviceRelayCommandV1` are the only supported cross-surface payloads. Legacy job JSON is
accepted only through the normalizer adapter and is rewritten to canonical snake_case.

## Safety

1. Never log API hashes, session bytes, tokens, raw media, or decrypted cloud config.
2. Never bypass protected content, ACLs, paywalls, or undocumented Telegram behavior.
3. FloodWait follows the server-provided duration and the account circuit breaker.
4. Unknown Telegram commits are reconciled from the local mapping/history before retry.
5. Prefer `murid` over `siswa` in Indonesian product copy.

## Verification

- Rust desktop, `autogram-core`, and Android bridge tests.
- TypeScript/Vitest and explicit locale audit.
- SQLite migration replay and schema/master parity checks.
- Supabase RLS, relay signature, revision-conflict, and replay-protection tests.
- CDP smoke test on port 9230 for UI changes.
