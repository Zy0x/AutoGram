# Bug Investigation: Native Account, Session, Document and Video Preview

## Symptoms
- QR scan succeeds in Telegram but Account stays on the QR screen.
- QR expiry requires manual refresh; phone/OTP/2FA can leave an unverified session.
- Account activation is local UI state and multiple accounts can appear active.
- Media Studio account switching spawns/stops a Python drive process and feels slow.
- Text/code previews intermittently fail or wait for a Python stream.
- Progressive video buffers indefinitely, reloads, and cannot seek to an unfilled range.

## Confirmed root causes
1. Account mixed Rust QR auth with Python phone/list auth and stored active state only in `localStorage`.
2. Brand-new phone login tried to open a Grammers JSON session before creating it.
3. Rust QR command errors were swallowed, so React never received a terminal event.
4. QR timeout cleanup deleted session material; repeated token events also repainted the same QR.
5. Progressive fill was spawned on a temporary Tokio runtime that was dropped when the Tauri command returned.
6. Rust Range HTTP handled requests serially, so a waiting hole blocked status/resume requests.
7. Grammers progressive download only advanced from byte zero; browser seek could not reprioritize it.
8. UI treated a small byte prefix as playable even when MP4 metadata was unavailable, then rebound the media element repeatedly.
9. Document parsing ran only after another backend had already produced a local cache file.
10. Fresh QR/phone login persisted `SessionData::default()` before SenderPool had negotiated an auth key, producing `cannot persist session without auth_key (not logged in)`.
11. Network-bound Grammers Tauri commands called blocking runtime wrappers on the command/UI thread.
12. Media Studio opened a second auth connection every 12 seconds, started file/dialog work together even though the account lock serialized it, then ran an automatic 500-dialog scan.
13. Chat soft-prefetch used `min(15s, 600ms)`, accidentally starting new dialog pages every 600 ms and extending the session queue.

## Fixes applied
- Account inventory, QR, phone, OTP, 2FA, delete, and post-auth verification use Rust + Grammers.
- Legacy Python `auth_manager` Tauri commands and permissions were removed, so Account cannot silently fall back.
- QR refresh stays inside the native loop; duplicate QR repaint is suppressed; incomplete native session material is retained.
- Session status is verified against Telegram and includes account identity and measured latency.
- Only one interactive account target is persisted; same-account Grammers operations use an async session lock.
- Shared process-wide Tokio runtime keeps progressive download tasks alive after the preview URL is returned.
- Native preview downloads text/code documents directly and runs the Rust document parser.
- Rust stream status reports contiguous and filled bytes, MP4 `moov`, seek capability, pause/error, and truthful readiness.
- Range holes queue a Grammers offset jump; HTTP requests are handled concurrently.
- Preview polling waits for backend/browser playability and limits same-URL recovery instead of restarting the stream.
- Desktop preview/status/seek/stop paths no longer fall through to a second Python MTProto owner.
- Fresh auth stays in memory until Telegram supplies a real auth key; a regression test covers this exact failure.
- All network-heavy Grammers Tauri commands now use asynchronous `spawn_blocking`, keeping WebView2 responsive during slow Telegram operations.
- Healthy Grammers SenderPools are reused per account and evicted on errors, login/QR restart, or account deletion.
- Media Studio uses one cold auth check and one warm post-bootstrap latency sample instead of a permanent 12-second probe.
- Visible files receive first network priority; chat/Drive discovery is incremental and the 500-dialog bootstrap scan was removed.
- Soft dialog prefetch now waits the intended 15 seconds instead of firing after 600 ms.

## Verification
- `npm run build`: passed (TypeScript + Vite production build).
- `cargo check`: passed; remaining warnings are pre-existing dead-code/incremental-cache warnings.
- `cargo test`: 32 passed, including fresh-session/auth-key, runtime, window, and seek-gap regressions.
- `npm test`: 116 passed across 20 files.
- `cargo fmt --all -- --check`: repository-wide pre-existing formatting differences; no bulk formatting was applied to avoid rewriting unrelated dirty files.
- Remote CDP smoke: passed URL, application shell, and no Chrome/WebView error page.
- Remote responsiveness during a real Media Studio refresh: p95 frame gap 7 ms, max 159.3 ms, zero gaps over 250 ms; the app remained interactive while 96/42,338+ media items were being resolved.
- Warm Grammers auth on the connected account: 103 ms, 85 ms, then 75 ms (all authorized, backend `grammers`).
- Final remote UI cycle after reload: 111 ms `Sangat Kuat`; entry p95 13.9 ms/max 200.7 ms and manual refresh p95 7 ms/max 103.9 ms, with zero frame gaps over 250 ms and no `Not Responding` state.

## Remaining live check
- Remote testing used the existing authorized desktop account and verified Media Studio responsiveness and warm account health. Completing a brand-new QR/phone + 2FA login still requires the user-controlled Telegram confirmation step; never record credentials or session material in this note.
