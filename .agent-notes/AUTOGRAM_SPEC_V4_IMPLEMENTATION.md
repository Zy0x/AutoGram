# AutoGram Spec v4 Implementation Log

## Objective

Implement the v4.1, v4.3, v4.4, v4.5, v4.6, and v4.7 transfer plans in the active React + Tauri + Rust/Grammers application. The v4.6 album contract is authoritative wherever v4.5 wording conflicts.

## Decisions

- Use Grammers/Rust only for MTProto.
- ORIGINAL always preserves source bytes as GenericDocument.
- Album membership is decided from final prepared output plus account, destination, topic, reply, send-as, schedule, silent, and payload compatibility.
- Protocol commits may contain ten compatible items. With avoid-single enabled, eleven compatible items pack as 9+2.
- UNKNOWN_COMMIT is never retried as an implicit single send.
- Missing FFmpeg, unsupported exact-device routing, and unverifiable native playback all fail closed.
- Transfer Settings and Drive Tools & Settings share the same typed settings editor, while the standalone top-bar settings entry remains independent.
- Preview, range streaming, buffering, standard thumbnails, and special thumbnails stay isolated from transfer-control changes.

## Implemented

1. Added typed quality, category, feasibility, prepared-output, oversize, album, encoder, resource, checkpoint, and transfer-ledger domains.
2. Added magic-aware routing with safe GenericDocument fallback and preservation guards for subtitle, multi-audio, attachment, data-stream, and HDR cases.
3. Added raw Grammers media upload and `messages.sendMultiMedia` commits with random IDs, ordering, silent, spoiler, topic/reply, schedule, and send-as context.
4. Added v4.6 album compatibility buckets, 2-10 packing, avoid-single 9+2 behavior, atomic failure modes, grouped-ID verification, and durable UNKNOWN_COMMIT recovery state.
5. Added exact SHA-256 duplicate prevention, filename+size probable-duplicate telemetry, and an upload ledger bound to Telegram message IDs.
6. Added effective account-limit discovery with live, cached, and conservative fallback sources plus whole-album alternate-account eligibility.
7. Added oversize split manifests with exact reconstruction hashes, alternate-account routing, skip audit records, and explicit resolver behavior.
8. Added resumable range downloads, checkpoints, safe finalization, conflict policies, integrity verification, cancellation, and bounded batch concurrency.
9. Added media-analysis and decision caches, FFprobe validation, output duration/size checks, bounded target-size encode retries, and no infinite degradation.
10. Added physical GPU identity, backend/device smoke tests, strict NVENC device selection, resource admission, and fail-closed AMF/QSV exact-device behavior.
11. Added pause/cancel safe boundaries and frozen profile snapshots.
12. Added complete orchestration controls, named profiles, search, section reset, download policy, and EN/ID parity to both settings surfaces.
13. Added item-level preflight to every upload and corrected the Tauri capability allowlist for preflight, pause, hardware discovery, and encoder selection.
14. Kept protected stream/preview/thumbnail modules outside the write set.
15. Added account-runtime caption limits, UTF-16-safe truncate/fail policy, one-summary album reassignment after duplicate/preparation filtering, caption-aware preflight, and one-caption split delivery.

## Verification

- Rust library tests: 86 passed, 0 failed.
- Rust compile check: passed; warning debt remains.
- Frontend tests: 33 passed, 0 failed.
- Frontend production build: passed.
- EN/ID `speedtest.json`: 1,132 keys each, zero parity differences.
- `frontend.exe` direct QA:
  - standalone Transfer Settings opens, scrolls, and saves without hook-order errors;
  - Drive Tools & Settings exposes the same policy surface;
  - cached thumbnails render and an existing PNG preview opens/closes correctly;
  - preflight analyzed 11 text documents with a live 1.95 GB account limit and safe Document-group decisions;
  - Transfer Manager completed all 11 items;
  - SQLite recorded two committed album groups with indices `[0..8]` and `[9,10]`, and message IDs `308..318`;
  - repeating the same files produced `11 skipped`, `0/11 commit`, no new ledger row, and no new Telegram message.
- All 11 local dummy files and their isolated test directory were removed after QA.

## Environment limits and deferred edges

- FFmpeg and FFprobe are absent, so real transcode, remux, and GPU device execution could not be exercised on this machine. The runtime reports unavailable capability instead of claiming success.
- Grammers currently exposes the committed message ID used by the exact SHA ledger, but no populated Telegram unique-file ID is available in this path.
- Historical remote duplicate scanning/reuse and full policy hierarchy across persisted global/account/destination scopes are not part of the active Studio executor.
- HEIC/PNG conversion, subtitle conversion/burn-in, large-channel server-processing tracking, full per-DC adaptive scheduling, and Android parity remain separate follow-up surfaces. Unsafe inputs stay byte-preserving documents.
- Telegram dummy messages require action-time deletion confirmation.
- The full requirement audit is tracked in `AUTOGRAM_SPEC_V4_COMPLETION_AUDIT.md`; feature flags, scoped policy precedence, template/entity captions, remote-history duplicate scanning, massive persistent pagination, and several platform/runtime-specific requirements remain open.
