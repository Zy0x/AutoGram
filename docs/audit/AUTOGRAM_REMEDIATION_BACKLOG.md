# AutoGram Remediation Backlog (Comprehensive Edition)

Prioritized remediation backlog of technical items required after the forensic baseline audit correction pass.

---

## Remediation Priority Classification

- **P0**: Data loss, security, duplicate send, or corrupt output risk.
- **P1**: Core specification contract failure or stubbed execution.
- **P2**: Missing integration, failure recovery, or hardware discovery.
- **P3**: UI, explainability, testing gaps, or formatting non-compliance.
- **P4**: Optimization or future cross-platform parity.

---

## Remediation Items

### `REM-P0-001`: OutputContract Validator Missing
- **Requirement IDs**: `AUD-V47-003`
- **Current Status**: `MISSING`
- **Root Cause**: Remuxer and video prep routines check `exit code 0` without validating container streams, duration, timestamp sync, color space, or decode integrity.
- **Files Affected**: `frontend/src-tauri/src/core/autogram_core/execution/remuxer.rs`, `frontend/src-tauri/src/core/media_prep.rs`
- **Recommended Change**: Implement `OutputContract` validator inspecting FFprobe JSON output for audio/video stream parity, non-zero duration, and valid container headers before passing to upload pipeline.
- **Required Tests**: Unit test with corrupted remux fixture asserting validation failure.
- **Regression Risk**: Low.

---

### `REM-P1-001`: Encoder Transcode Worker Stub
- **Requirement IDs**: `AUD-V47-002`
- **Current Status**: `FAIL` (Stubbed)
- **Root Cause**: `transcode_with_profile()` in `encoder.rs` returns dummy `Ok(())` without spawning FFmpeg.
- **Files Affected**: `frontend/src-tauri/src/core/autogram_core/execution/encoder.rs`
- **Recommended Change**: Implement full FFmpeg transcode process builder with rate control parameters (`crf`, `preset`, `bitrate`, `maxrate`, `bufsize`), stderr capture, child process cancellation handles, and output verification.
- **Required Tests**: Integration test transcoding synthetic video input.
- **Regression Risk**: Medium.

---

### `REM-P1-002`: Universal Format Category Enum Alignment
- **Requirement IDs**: `AUD-V43-001`
- **Current Status**: `PARTIAL`
- **Root Cause**: `media_classifier.rs` outputs string-based `drive_category` rather than the typed `MediaCategory` enum specified in Spec v4.3.
- **Files Affected**: `frontend/src-tauri/src/core/media_classifier.rs`
- **Recommended Change**: Refactor `classify_media_item()` to return `MediaCategory` (`ImageConsumer`, `ImageProfessional`, `VideoConsumer`, `VideoProduction`, `AudioConsumer`, `AudioLossless`, `BinaryAsset`, `Unknown`).
- **Required Tests**: Classification contract tests for all format families.
- **Regression Risk**: Low.

---

### `REM-P2-001`: Physical Hardware GPU Probing (L0-L6)
- **Requirement IDs**: `AUD-V47-001`, `AUD-V47-004`
- **Current Status**: `MISSING`
- **Root Cause**: `encoder_detector.rs` lacks physical hardware probing (L0-L6) and FFmpeg hwaccels execution.
- **Files Affected**: `frontend/src-tauri/src/core/autogram_core/hardware/encoder_detector.rs`, `hardware_capability.rs`
- **Recommended Change**: Implement L0-L6 hardware probe executing `ffmpeg -hwaccels`, probing NVENC (`h264_nvenc`), AMF (`h264_amf`), QSV (`h264_qsv`), and running a 1-second synthetic smoke encode.
- **Required Tests**: Mocked & live hardware detection unit tests.
- **Regression Risk**: Low.

---

### `REM-P2-002`: Cross-Platform Merge Scripts (Python & Android)
- **Requirement IDs**: `AUD-V44-002`
- **Current Status**: `PARTIAL`
- **Root Cause**: `AutoGramSplitManifest` generates PowerShell and Bash scripts, but lacks Python and Android merge scripts specified in v4.4.
- **Files Affected**: `frontend/src-tauri/src/core/autogram_core/execution/split_engine/manifest_builder.rs`
- **Recommended Change**: Add `python` and `android_posix` merge script generators to `MergeCommands`.
- **Required Tests**: Unit test validating cross-platform SHA256 parity for merge scripts.
- **Regression Risk**: Low.

---

### `REM-P2-003`: Album Commit Reconciliation & UNKNOWN_COMMIT Handler
- **Requirement IDs**: `AUD-V46-004`, `AUD-V46-005`
- **Current Status**: `CODE_PRESENT_UNVERIFIED`
- **Root Cause**: Live MTProto `sendMultiMedia` RPC timeout reconciliation and UNKNOWN_COMMIT order state machine un-executed with live server receipts.
- **Files Affected**: `frontend/src-tauri/src/core/studio_orch.rs`, `frontend/src-tauri/src/core/grammers_ops/media_transfer.rs`
- **Recommended Change**: Implement explicit UNKNOWN_COMMIT post-send reconciliation step before single item fallback.
- **Required Tests**: Fault injection test for network RPC drop during album send.
- **Regression Risk**: Medium.

---

### `REM-P2-004`: Scale Benchmark Suite S0-S4
- **Requirement IDs**: `AUD-V45-006`
- **Current Status**: `MISSING`
- **Root Cause**: Scale benchmark harness for 1 to 100,000 pending items is absent in `media_bench.rs`.
- **Files Affected**: `frontend/src-tauri/src/core/media_bench.rs`
- **Recommended Change**: Implement scale benchmark test creating 100k items in SQLite queue and verifying bounded memory footprint under 50MB.
- **Required Tests**: Scale benchmark test suite.
- **Regression Risk**: Low.

---

### `REM-P3-001`: Formatting Non-Compliance (`cargo fmt`)
- **Requirement IDs**: N/A (Quality Gate)
- **Current Status**: `FAIL` (Exit Code 1)
- **Root Cause**: `cargo fmt --all -- --check` surfaced formatting diffs in `caption.rs`, `media_classifier.rs`, `stream_server.rs`.
- **Files Affected**: `frontend/src-tauri/src/core/autogram_core/transfer/caption.rs`, `media_classifier.rs`, `stream_server.rs`
- **Recommended Change**: Apply standard rustfmt formatting (`cargo fmt`).
- **Required Tests**: `cargo fmt --all -- --check` exits with 0.
- **Regression Risk**: None.

---

### `REM-P3-002`: Unused Dead-Code Integration
- **Requirement IDs**: N/A (Compiler Warnings)
- **Current Status**: `PARTIAL`
- **Root Cause**: 459 compiler warnings for unused structs and functions in `features/topic_media/`.
- **Files Affected**: `frontend/src-tauri/src/features/topic_media/*`
- **Recommended Change**: Wire unused scheduler/thumbnail components into active Tauri commands or prune legacy helpers.
- **Required Tests**: `cargo check` with zero dead-code warnings.
- **Regression Risk**: Low.
