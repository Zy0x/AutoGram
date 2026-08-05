# AutoGram Real Remediation Plan (Phases 1 to 7)

Prioritized implementation and remediation plan to systematically resolve all identified code gaps, stubs, and missing test infrastructure across AutoGram.

---

## Remediation Roadmap & Phase Schedule

### Phase 1: P0 Output Safety Chain Implementation
- **Target Requirements**: `AUD-V47-ENC-002`, `AUD-V47-VAL-001`, `AUD-V47-FALL-001`
- **Key Deliverables**:
  1. Real FFmpeg transcode process builder in `encoder.rs` with quality profiles (`crf`, `preset`, `bitrate`, `maxrate`, `bufsize`).
  2. Cancellable child process handle, progress monitoring, timeout, stderr capture, and process-tree termination.
  3. `OutputContract` validator inspecting FFprobe JSON output for container streams, non-zero duration, timestamp sync, color space, HDR metadata, and rotation.
  4. Fail-closed upload gate and decision receipt logger.

### Phase 2: P0 Album Idempotency & UNKNOWN_COMMIT State Machine
- **Target Requirements**: `AUD-V46-ALB-001`, `AUD-V46-ALB-002`, `AUD-V46-REC-001`
- **Key Deliverables**:
  1. `AlbumCommitIntent` persistence & logical commit ID in SQLite database.
  2. `UNKNOWN_COMMIT` state machine and server message receipt reconciliation order.
  3. Avoid-single partition rebalancing (11 items rebalance to 9+2).
  4. Removal of legacy automatic single item fallback.

### Phase 3: P1 Universal Quality Engine & Router Alignment
- **Target Requirements**: `AUD-V43-FMT-001`, `AUD-V41-HQ-001`, `AUD-V41-SMART-001`
- **Key Deliverables**:
  1. Refactor `classify_media_item()` to return typed `MediaCategory` enum (`ImageConsumer`, `ImageProfessional`, `VideoConsumer`, `VideoProduction`, `AudioConsumer`, `AudioLossless`, `BinaryAsset`, `Unknown`).
  2. Magic byte & MIME precedence engine.
  3. Metadata preservation pass (HDR, ICC, alpha, rotation, audio tracks).

### Phase 4: P1 Oversize Transfer Engine & Merge Scripts
- **Target Requirements**: `AUD-V44-SPLIT-003`, `AUD-V44-ACCT-001`, `AUD-V44-SKIP-001`
- **Key Deliverables**:
  1. Python, PowerShell, Bash, POSIX, and Android merge script generators in `manifest_builder.rs`.
  2. Alternate account destination-equivalence validator.
  3. Skip/defer audit record & retry path.

### Phase 5: P1 Physical Hardware & Resource Admission Controller
- **Target Requirements**: `AUD-V47-ENC-001`, `AUD-V47-ADM-001`
- **Key Deliverables**:
  1. Physical GPU device registry and L0-L6 capability probe executing `ffmpeg -hwaccels`.
  2. Per-codec smoke encode test.
  3. Resource admission controller evaluating CPU, RAM, VRAM, thermal, and battery pressure snapshots.

### Phase 6: P2 Transfer Scale & Reliability Engine
- **Target Requirements**: `AUD-V45-QUEUE-001`, `AUD-V45-SCALE-001`, `AUD-V45-RATE-001`
- **Key Deliverables**:
  1. Bounded-memory SQLite job queue pagination under 100k pending items.
  2. Scale benchmark harness S0-S4 in `media_bench.rs`.
  3. Smart Rate Controller FloodWait & Slow Mode deadline persistence.

### Phase 7: P2 Frontend UI, i18n & Final Verification Gate
- **Target Requirements**: `AUD-V41-PRE-001`, i18n Parity, Quality Gates
- **Key Deliverables**:
  1. Item-level preflight UI dialog.
  2. 100% i18n key parity between `id/*.json` and `en/*.json`.
  3. Complete verification pass (`cargo fmt`, `cargo check`, `cargo test`, `npx tsc`, `npm run build`).
