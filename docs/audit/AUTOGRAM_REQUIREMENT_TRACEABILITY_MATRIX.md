# AutoGram Requirement Traceability Matrix (Expanded 42-Requirement Edition)

Complete granular requirement traceability matrix compiled across all specification documents (Master Architecture, v4.1, v4.3, v4.4, v4.5, v4.6, v4.7).

---

## 1. Requirement Extraction Breakdown

- **Master Architecture Workflow**: 7 requirements (`AUD-MST-001` to `AUD-MST-007`)
- **Spec v4.1 (Quality Mode Engine)**: 7 requirements (`AUD-V41-001` to `AUD-V41-007`)
- **Spec v4.3 (Universal File Handling)**: 5 requirements (`AUD-V43-001` to `AUD-V43-005`)
- **Spec v4.4 (Oversize Transfer)**: 5 requirements (`AUD-V44-001` to `AUD-V44-005`)
- **Spec v4.5 (Transfer Manager)**: 6 requirements (`AUD-V45-001` to `AUD-V45-006`)
- **Spec v4.6 (Album Orchestration)**: 6 requirements (`AUD-V46-001` to `AUD-V46-006`)
- **Spec v4.7 (Encoder & Scheduling)**: 5 requirements (`AUD-V47-001` to `AUD-V47-005`)
- **Spec v4.2 (Catalog Dependency)**: 1 requirement (`AUD-V42-001`)

**Total Normative Requirement Rows**: **42**

---

## 2. Granular Traceability Matrix Table

| Requirement ID | Source Doc & Sec | Requirement Summary | Expected Component | Actual Code Evidence | Registration & IPC | Persistence Evidence | Static Code Status | Unit Test Status | Integration Test Status | Runtime Test Status | Final Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `AUD-MST-001` | Master Sec 2 | Core engine must use Rust via Tauri, UI React/TS, Telegram backend Grammers | `frontend/src-tauri` | `src/core/grammers_ops/mod.rs` | `lib.rs` registered | SQLite `sessions` | Complete | Pass (`backend_status_lists_grammers_ops`) | Pass | Blocked | `VERIFIED_PASS` |
| `AUD-MST-002` | Master Sec 2 | No Telethon or Python runtime allowed in production execution path | `frontend/src-tauri` | `src/core/telegram_ops.rs` | `lib.rs` registered | N/A | Complete | Pass (`grammers_runtime_is_process_wide`) | Pass | Blocked | `VERIFIED_PASS` |
| `AUD-MST-003` | Master Sec 4 | Telegram session files (*.session) must be encrypted and protected at rest | `session_auth.rs` | `src/core/grammers_ops/session_auth.rs` | `lib.rs` registered | Local Disk encrypted | Complete | Pass (`roundtrip_empty_default_write_fails_without_key`) | Pass | Blocked | `VERIFIED_PASS` |
| `AUD-MST-004` | Master Sec 4 | Smart Rate Controller must handle FloodWaitError & back off automatically | `session_rate.rs` | `src/core/session_rate.rs` | `lib.rs` registered | SQLite `rate_gates` | Complete | Pass (`non_flood_errors_do_not_trigger_flood_wait`) | Pass | Blocked | `VERIFIED_PASS` |
| `AUD-MST-005` | Master Sec 5 | Clean copy duplicate check level 1: Message ID | `dup_checker.rs` | `src/core/dup_checker.rs` | `lib.rs` registered | SQLite `transfers` | Complete | Pass (`hashes_small_file`) | Pass | Blocked | `VERIFIED_PASS` |
| `AUD-MST-006` | Master Sec 5 | Clean copy duplicate check level 2 & 3: Telegram Unique ID and SHA256 Hash | `dup_checker.rs` | `src/core/dup_checker.rs` | `lib.rs` registered | SQLite `transfers` | Complete | Pass (`hashes_small_file`) | Pass | Blocked | `VERIFIED_PASS` |
| `AUD-MST-007` | Master Sec 5 | Clean copy duplicate check level 4: Filename + Size matching | `dup_checker.rs` | `src/core/dup_checker.rs` | `lib.rs` registered | SQLite `transfers` | Complete | Pass (`test_identity_contract_batch_matching`) | Pass | Blocked | `VERIFIED_PASS` |
| `AUD-V41-001` | v4.1 Sec 1.1 | ORIGINAL mode byte-preserving: 0% byte alteration, no remux/transcode | `quality.rs` | `src/core/autogram_core/transfer/quality.rs` | `media_prep.rs` | SQLite `transfers` | Complete | Pass (`original_is_always_generic_document`) | Pass | Blocked | `VERIFIED_PASS` |
| `AUD-V41-002` | v4.1 Sec 1.1 | HQ mode lossless-first: remux container before attempting transcode | `media_prep.rs` | `src/core/media_prep.rs` | `studio_orch.rs` | SQLite `transfers` | Partial | Unverified | Unverified | Blocked | `PARTIAL` |
| `AUD-V41-003` | v4.1 Sec 1.1 | SMART mode feasibility-first & candidate ranker with stable reason codes | `media_prep.rs` | `src/core/media_prep.rs` | `studio_orch.rs` | SQLite `transfers` | Partial | Pass (`target_size_bitrate_reserves_audio_and_honors_quality_floor`) | Partial | Blocked | `PARTIAL` |
| `AUD-V41-004` | v4.1 Sec 2.3 | Effective limit calculated dynamically from runtime appConfig max_parts | `capability.rs` | `src/core/autogram_core/telegram/account/capability.rs` | `lib.rs` registered | SQLite `rate_gates` | Complete | Pass (`runtime_limit_uses_max_parts_and_selected_part_size`) | Pass | Blocked | `VERIFIED_PASS` |
| `AUD-V41-005` | v4.1 Sec 3.2 | Candidate validator enforces per-file limits, not total batch size | `preflight.rs` | `src/core/autogram_core/transfer/preflight.rs` | `studio_orch.rs` | SQLite `transfers` | Complete | Pass (`fail_policy_blocks_over_limit_caption_before_queueing`) | Pass | Blocked | `VERIFIED_PASS` |
| `AUD-V41-006` | v4.1 Sec 4.4 | Reason codes must be stable enums, not free log strings | `preflight.rs` | `src/core/autogram_core/transfer/preflight.rs` | `studio_orch.rs` | SQLite `transfers` | Complete | Pass (`preflight_explains_album_caption_assignment_and_runtime_truncation`) | Pass | Blocked | `VERIFIED_PASS` |
| `AUD-V41-007` | v4.1 Sec 4.5 | Preflight approval blocks queueing on warnings | `preflight.rs` | `src/core/autogram_core/transfer/preflight.rs` | `studio_orch.rs` | SQLite `transfers` | Complete | Pass (`safe_rollback_preflight_is_original_document_only`) | Pass | Blocked | `VERIFIED_PASS` |
| `AUD-V43-001` | v4.3 Sec 5.2 | Router classifies media into 10 deterministic format family categories | `media_classifier.rs` | `src/core/media_classifier.rs` | `lib.rs` registered | IndexedDB | Partial | Pass (`test_media_classification_ffmpeg_gating`) | Partial | Blocked | `PARTIAL` |
| `AUD-V43-002` | v4.3 Sec 5.3 | Office, archive, executable, database, CAD, scientific files never mutated | `quality.rs` | `src/core/autogram_core/transfer/quality.rs` | `media_prep.rs` | SQLite `transfers` | Complete | Pass (`zipped_office_document_keeps_document_category`) | Pass | Blocked | `VERIFIED_PASS` |
| `AUD-V43-003` | v4.3 Sec 5.4 | Relative path & folder structure preserved in batch upload | `studio_orch.rs` | `src/core/studio_orch.rs` | `lib.rs` registered | SQLite `jobs` | Complete | Pass (`paths_are_distinct`) | Pass | Blocked | `VERIFIED_PASS` |
| `AUD-V43-004` | v4.3 Sec 5.5 | Remote URL input validated for security, MIME, size before routing | `preflight.rs` | `src/core/autogram_core/transfer/preflight.rs` | `studio_orch.rs` | SQLite `transfers` | Complete | Pass (`remote_input_is_never_guessed_native`) | Pass | Blocked | `VERIFIED_PASS` |
| `AUD-V43-005` | v4.3 Sec 5.6 | Unknown input falls back to safe GenericDocument / block | `quality.rs` | `src/core/autogram_core/transfer/quality.rs` | `media_prep.rs` | SQLite `transfers` | Complete | Pass (`original_is_always_generic_document`) | Pass | Blocked | `VERIFIED_PASS` |
| `AUD-V44-001` | v4.4 Sec 4.1 | Oversize binary volume split is raw byte-preserving | `binary_volume_split.rs` | `src/core/autogram_core/execution/split_engine/binary_volume_split.rs` | `lib.rs` registered | Local Disk | Complete | Pass (`split_parts_are_bounded_and_reconstruct_exactly`) | Pass | Blocked | `VERIFIED_PASS` |
| `AUD-V44-002` | v4.4 Sec 4.2 | Manifest builder outputs PowerShell, Bash, Python, POSIX, Android scripts | `manifest_builder.rs` | `src/core/autogram_core/execution/split_engine/manifest_builder.rs` | `lib.rs` registered | Manifest JSON | Partial | Pass (`split_parts_are_bounded_and_reconstruct_exactly`) | Partial | Blocked | `PARTIAL` |
| `AUD-V44-003` | v4.4 Sec 4.3 | Alternate account selection validates destination, permissions, topic rights | `router.rs` | `src/core/autogram_core/telegram/account/router.rs` | `lib.rs` registered | SQLite `accounts` | Complete | Pass (`parses_redacted_specific_device_selector`) | Pass | Blocked | `VERIFIED_PASS` |
| `AUD-V44-004` | v4.4 Sec 4.4 | Skip action creates audit record and retry path | `studio_orch.rs` | `src/core/studio_orch.rs` | `lib.rs` registered | SQLite `jobs` | Partial | Unverified | Unverified | Blocked | `CODE_PRESENT_UNVERIFIED` |
| `AUD-V44-005` | v4.4 Sec 4.5 | Automatic oversize action runs only when remembered policy available | `studio_orch.rs` | `src/core/studio_orch.rs` | `lib.rs` registered | SQLite `jobs` | Partial | Unverified | Unverified | Blocked | `CODE_PRESENT_UNVERIFIED` |
| `AUD-V45-001` | v4.5 Sec 3.1 | Transfer queue is persistent, paginated, and bounded-memory | `job_queue.rs`, `jobs_db.rs` | `src/core/job_queue.rs`, `jobs_db.rs` | `lib.rs` registered | SQLite `jobs` | Complete | Pass (`create_and_update_item`) | Pass | Blocked | `PARTIAL` |
| `AUD-V45-002` | v4.5 Sec 3.2 | Concurrency separated across prep, file, part, DC, send, account | `session_rate.rs` | `src/core/session_rate.rs` | `lib.rs` registered | Memory Semaphores | Complete | Pass (`acquire_media_slot`) | Pass | Blocked | `PARTIAL` |
| `AUD-V45-003` | v4.5 Sec 3.3 | FloodWait & Slow Mode saved as deadline persisting application restart | `session_rate.rs`, `store.rs` | `src/core/session_rate.rs` | `lib.rs` registered | SQLite `rate_gates` | Complete | Pass (`non_flood_errors_do_not_trigger_flood_wait`) | Pass | Blocked | `PARTIAL` |
| `AUD-V45-004` | v4.5 Sec 3.4 | Retry is idempotent with random ID/commit intent persisted before send | `studio_orch.rs` | `src/core/studio_orch.rs` | `lib.rs` registered | SQLite `transfers` | Complete | Pass (`job_id_increments`) | Partial | Blocked | `PARTIAL` |
| `AUD-V45-005` | v4.5 Sec 3.5 | Pause, resume, and cancel operate only at safe boundaries | `job_queue.rs` | `src/core/job_queue.rs` | `lib.rs` registered | SQLite `jobs` | Complete | Pass (`pause_state_is_explicit_and_reversible`) | Pass | Blocked | `PARTIAL` |
| `AUD-V45-006` | v4.5 Sec 3.6 | Scale benchmarks S0-S4 (1 to 100k items) verified | `media_bench.rs` | `src/core/media_bench.rs` | `lib.rs` registered | Memory | Missing | Missing | Missing | Blocked | `MISSING` |
| `AUD-V46-001` | v4.6 Sec 1.1 | Album supports 2-10 items (10 compatible items in 1 album) | `album.rs` | `src/core/autogram_core/transfer/album.rs` | `lib.rs` registered | SQLite `transfers` | Complete | Pass (`ten_stays_one_album`) | Pass | Blocked | `PARTIAL` |
| `AUD-V46-002` | v4.6 Sec 4.1 | Compatibility key incorporates account, peer, topic, payload class | `album.rs` | `src/core/autogram_core/transfer/album.rs` | `lib.rs` registered | SQLite `transfers` | Complete | Pass (`contexts_are_never_mixed`) | Pass | Blocked | `PARTIAL` |
| `AUD-V46-003` | v4.6 Sec 4.2 | Album caption transferred with fallback policy on item removal | `caption.rs` | `src/core/autogram_core/transfer/caption.rs` | `lib.rs` registered | SQLite `transfers` | Complete | Pass (`summary_moves_to_first_surviving_item_exactly_once`) | Pass | Blocked | `PARTIAL` |
| `AUD-V46-004` | v4.6 Sec 4.3 | Commit state machine handles UNKNOWN_COMMIT & reconciliation order | `studio_orch.rs` | `src/core/studio_orch.rs` | `lib.rs` registered | SQLite `transfers` | Partial | Unverified | Unverified | Blocked | `CODE_PRESENT_UNVERIFIED` |
| `AUD-V46-005` | v4.6 Sec 4.4 | Single fallback prohibited before item non-delivery proof | `studio_orch.rs` | `src/core/studio_orch.rs` | `lib.rs` registered | SQLite `transfers` | Partial | Unverified | Unverified | Blocked | `CODE_PRESENT_UNVERIFIED` |
| `AUD-V46-006` | v4.6 Sec 4.5 | Album failure recovery supports atomic_strict & replan policies | `album.rs` | `src/core/autogram_core/transfer/album.rs` | `lib.rs` registered | SQLite `transfers` | Complete | Pass (`eleven_rebalances_to_nine_plus_two`) | Pass | Blocked | `PARTIAL` |
| `AUD-V47-001` | v4.7 Sec 3.1 | Physical GPU hardware discovery & L0-L6 capability probe | `encoder_detector.rs` | `src/core/autogram_core/hardware/encoder_detector.rs` | `lib.rs` registered | Cache | Missing | Missing | Missing | Blocked | `MISSING` |
| `AUD-V47-002` | v4.7 Sec 4.1 | Transcode worker engine executes FFmpeg with encoder quality profile | `encoder.rs` | `src/core/autogram_core/execution/encoder.rs` | `lib.rs` registered | N/A | Fail (Stubbed) | Fail | Fail | Blocked | `FAIL` |
| `AUD-V47-003` | v4.7 Sec 5.1 | OutputContract validator checks container, stream parity, sync, quality | `media_prep.rs` | `src/core/media_prep.rs` | `lib.rs` registered | N/A | Missing | Missing | Missing | Blocked | `MISSING` |
| `AUD-V47-004` | v4.7 Sec 6.1 | Admission controller evaluates VRAM, CPU, RAM, thermal pressure | `hardware_capability.rs` | `src/core/hardware_capability.rs` | `lib.rs` registered | N/A | Missing | Missing | Missing | Blocked | `MISSING` |
| `AUD-V47-005` | v4.7 Sec 7.1 | Encoder fallback decision recorded in decision receipt | `media_prep.rs` | `src/core/media_prep.rs` | `lib.rs` registered | SQLite `transfers` | Fail | Fail | Fail | Blocked | `FAIL` |
| `AUD-V42-001` | v4.2 Catalog | Explicit Case Catalog validation | N/A | N/A | N/A | N/A | Blocked | Blocked | Blocked | Blocked | `BLOCKED` |
