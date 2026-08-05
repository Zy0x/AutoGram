# AutoGram Remediation Backlog (V3 Machine-Verified)

Prioritized remediation backlog of technical tasks required to address all identified code gaps, stubs, and missing test infrastructure.

---

## Technical Remediation Priority Items

### `REM-P0-001`: OutputContract Validator Implementation
- **Target Requirement**: `AUD-V47-VAL-001`
- **Priority**: P0 (Critical / Output Integrity)
- **Files Affected**: `src/core/autogram_core/execution/remuxer.rs`, `src/core/media_prep.rs`
- **Description**: Implement `OutputContract` validator inspecting FFprobe JSON output for audio/video stream parity, non-zero duration, and valid container headers before passing to upload pipeline.

---

### `REM-P1-001`: FFmpeg Transcode Worker Implementation
- **Target Requirement**: `AUD-V47-ENC-002`
- **Priority**: P1 (High / Core Engine)
- **Files Affected**: `src/core/autogram_core/execution/encoder.rs`
- **Description**: Replace dummy stub `transcode_with_profile()` with full FFmpeg transcode process builder, capturing stderr, monitoring progress, and verifying output files.

---

### `REM-P2-001`: Physical Hardware GPU Probing (L0-L6)
- **Target Requirement**: `AUD-V47-ENC-001`
- **Priority**: P2 (Medium / Feature Hardware)
- **Files Affected**: `src/core/autogram_core/hardware/encoder_detector.rs`
- **Description**: Implement physical L0-L6 hardware probe executing `ffmpeg -hwaccels`, probing NVENC (`h264_nvenc`), AMF (`h264_amf`), QSV (`h264_qsv`), and running a synthetic 1-second smoke encode.

---

### `REM-P2-002`: Cross-Platform Merge Scripts (Python & Android)
- **Target Requirement**: `AUD-V44-SPLIT-003`
- **Priority**: P2 (Medium / Cross-Platform Parity)
- **Files Affected**: `src/core/autogram_core/execution/split_engine/manifest_builder.rs`
- **Description**: Add `python` and `android_posix` merge script generators to `MergeCommands`.

---

### `REM-P2-003`: Scale Benchmark Harness S0-S4
- **Target Requirement**: `AUD-V45-SCALE-001`
- **Priority**: P2 (Medium / Performance Benchmark)
- **Files Affected**: `src/core/media_bench.rs`
- **Description**: Implement scale benchmark test creating 100k items in SQLite queue and verifying bounded memory footprint under 50MB.

---

### `REM-P3-001`: Rustfmt Formatting Compliance
- **Target Requirement**: Quality Gate (`cargo fmt`)
- **Priority**: P3 (Low / Code Style)
- **Files Affected**: `src/core/autogram_core/transfer/caption.rs`, `media_classifier.rs`, `stream_server.rs`
- **Description**: Apply standard rustfmt formatting (`cargo fmt`).
