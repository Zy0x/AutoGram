# Transfer v4 Regression Report

Date: 2026-08-05
Baseline: `9142181fe413d21039de4f010f04b9d7257a8206`

## Automated evidence

| Gate | Result |
| --- | --- |
| Rust library tests | 86 passed, 0 failed |
| Rust compile check | Passed; existing warning debt only |
| Frontend tests | 33 passed, 0 failed |
| Frontend production build | Passed |
| Locale parity | EN 1,132 / ID 1,132 / no missing keys |
| Diff whitespace check | Passed |

## Contract scenarios

| Contract | Evidence |
| --- | --- |
| Magic bytes outrank misleading extension | Quality-router unit tests |
| ORIGINAL remains byte-preserving document | Quality and preflight unit tests |
| Unverified native playback falls back safely | Media-preparation and preflight tests |
| Ten items remain one album | Album planner unit test |
| Eleven items avoid a 10+1 remainder | Unit test and live 9+2 SQLite commits |
| Payload/context incompatibility partitions groups | Album compatibility tests |
| Unknown commit never becomes blind single retry | Album recovery tests |
| Split parts reconstruct exact source | Split-engine unit test |
| Live/cached/fallback account limits are explicit | Capability tests and live preflight |
| Specific GPU selection never silently migrates | Hardware and media-preparation tests |
| Target-size encode retries are bounded | Media-preparation tests |
| Resumable downloads verify final output | Download and checkpoint tests |
| Exact SHA duplicates are skipped | Live duplicate re-upload and ledger evidence |
| Tauri command allowlist matches new UI calls | Direct `frontend.exe` preflight after capability fix |
| Album summary caption is assigned exactly once | UTF-16 policy and first-surviving-item unit tests |
| Split delivery does not duplicate captions | Split parts are captionless; manifest owns the single caption |

## Direct frontend.exe QA

- Started the rebuilt `src-tauri/target/debug/frontend.exe` and used the connected Grammers session in Saved Messages.
- Opened the standalone Transfer Settings from the top bar, verified the upload/download policy surface, scrolled through album controls, and saved it.
- Confirmed Drive Tools & Settings retains its integrated Transfer Settings category.
- Confirmed existing thumbnails remained visible and opened/closed an existing PNG preview.
- Selected 11 isolated text documents through the native Tauri file dialog.
- Preflight reported 11 analyzed items, a live 1.95 GB account limit, Text document category, pass-through transform, Document group payload, and provisional album eligibility.
- Approved the upload. Transfer Manager reached 100%, 11/11 commit, and every item Completed.
- Read-only SQLite verification found:
  - group 1: ordered indices `[0,1,2,3,4,5,6,7,8]`, state COMMITTED, message IDs `[308..316]`;
  - group 2: ordered indices `[9,10]`, state COMMITTED, message IDs `[317,318]`;
  - 11 exact SHA-256 ledger bindings with `document_group` payload;
  - terminal transfer state COMPLETED.
- Repeated the same native upload. Transfer Manager reported 11 skipped and 0/11 commit; ledger count remained 11 and maximum QA message ID remained 318.
- Removed all 11 local dummy files and the isolated `.agent-qa/transfer-v4-final` directory.

## Protected media surface

`core/grammers/stream.rs`, `core/stream_server.rs`, `core/grammers/thumbs.rs`, and `core/grammers/special_media_thumb.rs` have zero source diff. Direct preview and thumbnail checks also passed.

## Environment limitations

- FFmpeg and FFprobe are not installed or bundled, so real transcode/remux/device smoke execution remains unverified on this host.
- Telegram QA messages `306..318` remain until the user gives action-time confirmation for remote deletion.
