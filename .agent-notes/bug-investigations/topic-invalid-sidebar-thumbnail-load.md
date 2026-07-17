# Topic invalid + initial sidebar/thumbnail load

## Symptoms

- Opening `#Gudang - Donghua 3D` could show topic pills from another Drive.
- Selecting the stale `Donghua 3D` pill failed the whole location with:
  `The message ID used in the peer was invalid (caused by GetRepliesRequest)`.
- On a full page reload, media metadata appeared but Drives could remain at 0 and thumbnails at 0 for more than 20 seconds.

## Reproduction evidence (2026-07-16)

- Active peer: `-1004468191168` (`#Gudang - Donghua 3D`).
- UI displayed the 17 topics belonging to `#Gudang` and allowed `Donghua 3D` to become active.
- A direct `list_topics` for the active peer returned an empty topic list (non-forum), proving the UI state belonged to another peer.
- After reload: 33 media cards, 17 chats, 0 Drives and 0 thumbnails after more than 20 seconds.
- A direct thumbnail request returned `deferred: true` because the UI's warm-session module had lost readiness although the UI label still said connected.

## Root causes

1. `loadTopicsForPeer` applied asynchronous responses without checking that its peer was still active.
2. Empty/invalid topic media filters fell through to `iter_messages(reply_to=...)`, producing the fatal `GetRepliesRequest` error.
3. Warm-session readiness could resolve before the process handle was assigned, and a stale worker-exit event could clear the new session.
4. Chat and Drive metadata were not persisted across app launches; full folder scan waited for topic loading.
5. Background media stats started within hundreds of milliseconds and competed with sidebar and thumbnail requests.

## Status

- Fixed and verified.

## Working fix

- Topic responses are generation/active-peer guarded; topic selections must exist in the active peer's list.
- Topic filter failures return a recoverable `invalid_topic` page and reopen `Semua media`; no `GetRepliesRequest` fallback.
- Warm-session startup is shared by files, chats, Drives, topics, thumbnails and avatars; stale same-job exit events cannot immediately disable the replacement.
- Sidebar metadata is cached per session for stale-while-revalidate first paint.
- Thumbnail data URLs are cached in bounded IndexedDB storage (320 entries, 14-day TTL).
- Full folder scan starts after chats instead of waiting for topics; history-wide media stats wait 8 seconds.

## Verification

- Forced race: click `#Gudang`, then `#Gudang - Donghua 3D` after 80 ms: 0 stale topic pills, 0 errors, 33 files and 30 thumbnails.
- Direct stale topic id against the non-forum peer: `invalid_topic=true` in 67 ms, no exception.
- Cold sidebar cache + worker stopped: file 624 ms, first thumbnail 758 ms, 17 chats and 3 Drives at 2.115 s.
- Cached session reload: file 691 ms, first thumbnail 797 ms; 3 Drives and 17 chats present immediately.
- Frontend production build passed; Vitest 72/72 passed; Python syntax compile passed.
- Worker helper checks: 18 passed; one unrelated pre-existing Pillow edge-size assertion remains (`test_video_thumb_allows_larger_edge`).

## Topic selector latency follow-up (2026-07-16)

### Root cause

- On peer changes, `loadTopicsForPeer(peerId)` was chained after `refreshFiles()`.
- Initial bootstrap also started the potentially large media page before requesting forum topics.
- The worker already treats `list_topics` as high priority, but the frontend did not submit it until the serial file load completed.

### Fix

- Start topic discovery immediately and independently from file/chat loading during bootstrap and peer changes.
- Restore a bounded per-session/per-peer topic snapshot from local storage for immediate first paint, then revalidate it against Telegram.
- Only suppress a repeated Telegram request for 15 seconds and deduplicate in-flight requests, so the persistent snapshot never becomes the sole source of truth.
- Keep topic state generation-guarded so a late response cannot leak into another Drive/chat.

### Verification

- Empty WebView cache, first open of forum `#Gudang`: topic pills visible in about 2.147 seconds while media cards were still loading.
- Return to the same forum: topic pills visible in about 0.636 seconds from the snapshot while Telegram revalidation remained enabled.
- Frontend Vitest: 83/83 passed, including persistent topic-cache validity and expiry tests.
- Frontend production build passed; only existing Vite chunk warnings remain.
