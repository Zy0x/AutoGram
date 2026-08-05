# AutoGram Quality Mode Engine Overhaul (v4.1.0)
## ORIGINAL · HQ · SMART

**Versi:** v4.1.0 Agent Execution Edition  
**Platform:** Tauri v2, React 19, TypeScript, Rust, Grammers, FFmpeg/FFprobe, SQLite, IndexedDB  

### 1. Core Principles
- **Policy Engine**: Quality Mode Engine is a policy engine over media categories, not a rigid set of encoder presets.
- **ORIGINAL Policy**: Strictly preserves 100% file bytes (`transform == None`).
- **HQ Policy**: Maximize practical native Telegram media quality while maintaining compatibility. Lossless remuxing strictly prioritized over lossy transcoding.
- **SMART Policy**: Rank candidates by feasibility, policy compliance, required data preservation, loss tier, native compatibility, size margin, and processing cost.

### 2. Normative Invariants
- Per-file evaluation: Limits evaluated per file (`effective_max_bytes`), never per batch.
- Explicit stream mapping: No raw `ffmpeg -c copy` without explicit stream mapping and post-remux validation.
- Zero silent data loss: Subtitles, audio tracks, chapters, attachments, ICC profiles, and HDR metadata are never dropped silently.
- Feature flags: Incremental enablement with full rollback support.

### 3. Implementation Roadmap & Verification Gates
- **Phase 1**: Runtime limits and category router (`MediaCategory` enums and account capability).
- **Phase 2**: Media analysis and versioned cache (`MediaAnalysis` structs and DB schema).
- **Phase 3**: Candidate generation, feasibility gates, and lexicographic optimizer.
- **Phase 4**: Remux engine and subtitle action matrix (`RemuxPlan`).
- **Phase 5**: Backend-specific encoder settings and target-size transcode estimator.
- **Phase 6**: MTProto part upload, streamed upload, album packing, and server processing tracker.
- **Phase 7**: Frontend preflight UI and i18n key parity.
- **Phase 8**: Staged rollout, telemetry, and release report.
