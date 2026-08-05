# AutoGram Evidence Index (V3 Machine-Verified)

Comprehensive index of code, registration, test, log, and manifest evidence files supporting the forensic baseline audit.

---

## 1. Command Execution & Raw Log Evidence Index

| Command ID | Executed Command Line | Working Directory | Exit Code | Raw Log File Path | SHA-256 Checksum Hash |
|---|---|---|---|---|---|
| `CMD-GIT-ROOT` | `git rev-parse --show-toplevel` | `f:\AutoGram` | 0 | `docs/audit_v3/evidence/raw/git_root.log` | Machine-computed in `AUTOGRAM_EVIDENCE_MANIFEST.json` |
| `CMD-GIT-BRANCH` | `git branch --show-current` | `f:\AutoGram` | 0 | `docs/audit_v3/evidence/raw/git_branch.log` | Machine-computed in `AUTOGRAM_EVIDENCE_MANIFEST.json` |
| `CMD-GIT-COMMIT` | `git log -1 --oneline` | `f:\AutoGram` | 0 | `docs/audit_v3/evidence/raw/git_commit.log` | Machine-computed in `AUTOGRAM_EVIDENCE_MANIFEST.json` |
| `CMD-GIT-STATUS` | `git status --short` | `f:\AutoGram` | 0 | `docs/audit_v3/evidence/raw/git_status.log` | Machine-computed in `AUTOGRAM_EVIDENCE_MANIFEST.json` |
| `CMD-CARGO-FMT` | `cargo fmt --all -- --check` | `src-tauri` | 1 | `docs/audit_v3/evidence/raw/cargo_fmt.log` | Machine-computed in `AUTOGRAM_EVIDENCE_MANIFEST.json` |
| `CMD-CARGO-CHECK` | `cargo check --manifest-path ...` | `f:\AutoGram` | 0 | `docs/audit_v3/evidence/raw/cargo_check.log` | Machine-computed in `AUTOGRAM_EVIDENCE_MANIFEST.json` |
| `CMD-CARGO-TEST-LIST` | `cargo test --manifest-path ... --list` | `f:\AutoGram` | 0 | `docs/audit_v3/evidence/raw/cargo_test_list.log` | Machine-computed in `AUTOGRAM_EVIDENCE_MANIFEST.json` |
| `CMD-CARGO-TEST` | `cargo test --manifest-path ...` | `f:\AutoGram` | 0 | `docs/audit_v3/evidence/raw/cargo_test.log` | Machine-computed in `AUTOGRAM_EVIDENCE_MANIFEST.json` |
| `CMD-TSC-CHECK` | `npx tsc --noEmit` | `frontend` | 0 | `docs/audit_v3/evidence/raw/tsc_check.log` | Machine-computed in `AUTOGRAM_EVIDENCE_MANIFEST.json` |
| `CMD-FRONTEND-BUILD` | `npm run build` | `frontend` | 0 | `docs/audit_v3/evidence/raw/frontend_build.log` | Machine-computed in `AUTOGRAM_EVIDENCE_MANIFEST.json` |

---

## 2. Core Code Evidence Symbols & Line Ranges

| Evidence ID | File Path | Line Range | Primary Symbols & Structs | Registration & Invocation Path |
|---|---|---|---|---|
| `CODE-ARCH-001` | `src/core/grammers_ops/session_auth.rs` | 1–150 | `GrammersSessionAuth`, `init_session` | `src/core/grammers_ops/mod.rs` |
| `CODE-SEC-001` | `src/core/path_policy.rs` | 1–45 | `is_safe_path`, `blocks_session_files` | `src/lib.rs` |
| `CODE-SEC-002` | `src/core/session_guard.rs` | 1–80 | `SessionGuard`, `lease_session` | `src/lib.rs` |
| `CODE-SEC-003` | `src/core/telegram_ops.rs` | 1–120 | `redact_account_label` | `src/lib.rs` |
| `CODE-SEC-004` | `src/core/tg_log.rs` | 1–95 | `redact_api_hash`, `clean_session_label` | `src/lib.rs` |
| `CODE-DUP-001` | `src/core/dup_checker.rs` | 1–160 | `DuplicateChecker`, `check_message_id` | `src/lib.rs` |
| `CODE-V41-001` | `src/core/autogram_core/transfer/quality.rs` | 1–200 | `QualityPolicy`, `OriginalDocumentBatch` | `src/core/media_prep.rs` |
| `CODE-V41-002` | `src/core/autogram_core/transfer/preflight.rs` | 1–250 | `PreflightChecker`, `validate_transform` | `src/core/studio_orch.rs` |
| `CODE-V43-001` | `src/core/media_classifier.rs` | 1–183 | `classify_media_item` | `src/lib.rs` |
| `CODE-V44-001` | `src/core/autogram_core/execution/split_engine/binary_volume_split.rs` | 1–107 | `split_parts_are_bounded` | `src/lib.rs` |
| `CODE-V44-002` | `src/core/autogram_core/execution/split_engine/manifest_builder.rs` | 1–132 | `AutoGramSplitManifest`, `build_merge_scripts` | `src/lib.rs` |
| `CODE-V45-001` | `src/core/session_rate.rs` | 1–404 | `SmartRateController`, `note_flood_wait` | `src/lib.rs` |
| `CODE-V45-002` | `src/core/job_queue.rs` | 1–350 | `JobQueue`, `create_item`, `pause_job` | `src/lib.rs` |
| `CODE-V45-003` | `src/core/autogram_core/transfer/download.rs` | 1–280 | `DownloadEngine`, `sanitize_filename` | `src/lib.rs` |
| `CODE-V46-001` | `src/core/autogram_core/transfer/album.rs` | 1–258 | `AlbumPlanner`, `build_album_plan` | `src/lib.rs` |
| `CODE-V46-002` | `src/core/autogram_core/transfer/caption.rs` | 1–190 | `CaptionEngine`, `shift_summary_caption` | `src/lib.rs` |
| `CODE-V47-001` | `src/core/autogram_core/hardware/encoder_detector.rs` | 1–39 | `EncoderDetector`, `HardwarePriority` | `src/lib.rs` |
| `CODE-V47-002` | `src/core/autogram_core/execution/encoder.rs` | 1–21 | `transcode_with_profile` (STUB) | `src/lib.rs` |
