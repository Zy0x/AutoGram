# AutoGram Specification Conflict Register

This register documents all conflicting requirements discovered between legacy architecture baselines and current v4.x specifications, along with precedence decisions and migration impact.

---

## Conflict 01: Album Maximum Item Capacity (Master Architecture v2.8.7 vs Spec v4.6)

- **Source A**: Master Architecture v2.8.7, Section "Album Policy"
  - *Rule A*: Maximum 9 items per album to fit 3x3 UI grid layout.
- **Source B**: Spec v4.6 (`AUTOGRAM_INTELLIGENT_ALBUM_ORCHESTRATION_AND_FAILURE_RECOVERY_SPEC_v4.6.0.md`), Section 1.1 & Explicit Case `ALB-001`.
  - *Rule B*: Grouped media supports 2–10 items. 10 compatible photo/document/audio items MUST be grouped into 1 album of 10 items. Splitting 10 items into 9+1 is explicitly **FORBIDDEN**.
- **Current Implementation**:
  - `frontend/src-tauri/src/core/autogram_core/transfer/album.rs` defines `pub const TELEGRAM_ALBUM_MAX: usize = 10;` and includes unit test `ten_stays_one_album()` asserting 10 items form a single group of 10.
- **Precedence Decision**:
  - **Spec v4.6 takes precedence** as per Spec Precedence Rule #3. The 10-item album capacity is verified present in `album.rs`.
- **Migration Impact**:
  - Legacy UI callers expecting 9-item grid bounds must ensure 10-item rendering support.

---

## Conflict 02: Default Video Re-encode Transcode Behavior (Master Architecture v2.8.7 vs Spec v4.1 & v4.7)

- **Source A**: Master Architecture v2.8.7, Section "Video Transfer Pipeline"
  - *Rule A*: Transcode all videos to MP4 H.264/AAC regardless of source format.
- **Source B**: Spec v4.1 (Section 0.2 item 9) & Spec v4.7 (Section 2)
  - *Rule B*: **Lossless-First Principle**: Do NOT re-encode if passthrough or remux is safe and feasible. Remux lossless container before attempting lossy transcode.
- **Current Implementation**:
  - `frontend/src-tauri/src/core/autogram_core/execution/remuxer.rs` implements lossless remux (`ffmpeg -c copy`), but output contract validation (v4.7) is missing. `execution/encoder.rs` transcode worker is currently a STUB returning dummy `Ok(())`.
- **Precedence Decision**:
  - **Spec v4.7 / v4.1 takes precedence**.
- **Migration Impact**:
  - Complete implementation of FFmpeg transcode worker in `encoder.rs` is required to fulfill the lossy fallback contract when remux is not feasible.

---

## Conflict 03: Missing Specification Dependency v4.2 Catalog

- **Source**: Directive Section 1 & Section 2
  - *Dependency*: `v4.2 Explicit Case Catalog` is referenced as a dependency for explicit test cases across v4.x specs, but is missing from the provided specification documents.
- **Audit Decision**:
  - Any audit item requiring validation against specific v4.2 catalog IDs is marked as `BLOCKED — DEPENDENCY_MISSING_V4_2`.
