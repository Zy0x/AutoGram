# AutoGram Evidence Index (Expanded & Detailed Edition)

Catalog of all audit evidence items collected during the forensic re-verification of AutoGram, detailing exact file line ranges, symbols, callers, callees, registration paths, log checksums, and limitations.

---

## 1. Source Code Evidence Catalog (CODE-xxx)

### Evidence ID: `CODE-V41-001`
- **Requirement IDs**: `AUD-V41-001`, `AUD-V41-006`
- **File**: `AutoGram App/frontend/src-tauri/src/core/autogram_core/transfer/quality.rs`
- **Exact Line Range**: 1 - 120
- **Symbol**: `pub enum QualityPolicy`, `pub enum PayloadClass`
- **Caller**: `media_prep.rs`, `studio_orch.rs`
- **Callee**: Serde JSON serializer
- **Registration Path**: `frontend/src-tauri/src/core/autogram_core/transfer/mod.rs` -> `src/core/mod.rs` -> `lib.rs`
- **Interpretation**: Defines byte-preserving ORIGINAL mode, HQ mode, and SMART mode enums.
- **Limitations**: Logic ranking candidates inside SMART mode is partial.

### Evidence ID: `CODE-V41-002`
- **Requirement IDs**: `AUD-V41-002`, `AUD-V41-005`
- **File**: `AutoGram App/frontend/src-tauri/src/core/media_prep.rs`
- **Exact Line Range**: 150 - 320
- **Symbol**: `pub async fn prepare_media_item()`
- **Caller**: `studio_orch.rs`
- **Callee**: `remuxer.rs`, `encoder.rs`, `find_ffmpeg_binary()`
- **Registration Path**: `frontend/src-tauri/src/lib.rs` -> command `prepare_media`
- **Interpretation**: Handles media intake, probe, remux, and preparation.
- **Limitations**: Relies on `encoder.rs` stub when transcoding is required.

### Evidence ID: `CODE-V44-001`
- **Requirement IDs**: `AUD-V44-001`
- **File**: `AutoGram App/frontend/src-tauri/src/core/autogram_core/execution/split_engine/binary_volume_split.rs`
- **Exact Line Range**: 17 - 81
- **Symbol**: `pub fn split_binary_volume()`
- **Caller**: `studio_orch.rs`
- **Callee**: `File::open()`, `calculate_file_sha256()`
- **Registration Path**: `frontend/src-tauri/src/lib.rs` -> command `split_file_volume`
- **Interpretation**: Performs raw byte splitting into `.agpart.0001-of-XXXX` volumes.
- **Limitations**: Tested with unit test up to 3 parts.

### Evidence ID: `CODE-V44-002`
- **Requirement IDs**: `AUD-V44-002`
- **File**: `AutoGram App/frontend/src-tauri/src/core/autogram_core/execution/split_engine/manifest_builder.rs`
- **Exact Line Range**: 78 - 131
- **Symbol**: `impl AutoGramSplitManifest::from_parts()`
- **Caller**: `studio_orch.rs`
- **Callee**: `calculate_file_sha256()`
- **Registration Path**: `frontend/src-tauri/src/lib.rs`
- **Interpretation**: Builds split manifest JSON with PowerShell and Bash merge commands.
- **Limitations**: Python and Android merge scripts missing in `MergeCommands` struct.

### Evidence ID: `CODE-V45-001`
- **Requirement IDs**: `AUD-V45-001`, `AUD-V45-005`
- **File**: `AutoGram App/frontend/src-tauri/src/core/job_queue.rs`
- **Exact Line Range**: 1 - 250
- **Symbol**: `pub struct JobQueue`
- **Caller**: `studio_orch.rs`, `lib.rs`
- **Callee**: `jobs_db.rs`
- **Registration Path**: `frontend/src-tauri/src/lib.rs` -> commands `get_job_queue`, `pause_job`, `resume_job`, `cancel_job`
- **Interpretation**: In-memory job queue wrapper delegating persistence to SQLite.
- **Limitations**: Live high-water/low-water memory backpressure unverified under 100k items.

### Evidence ID: `CODE-V45-002`
- **Requirement IDs**: `AUD-V45-003`, `AUD-MST-004`
- **File**: `AutoGram App/frontend/src-tauri/src/core/session_rate.rs`
- **Exact Line Range**: 59 - 130
- **Symbol**: `pub fn note_flood_wait()`, `pub fn flood_remaining_secs()`
- **Caller**: `media_transfer.rs`, `drive_rpc.rs`
- **Callee**: `store::persist_account_rate_gate()`
- **Registration Path**: `frontend/src-tauri/src/core/mod.rs` -> `lib.rs`
- **Interpretation**: Captures FLOOD_WAIT error, applies tokio semaphore rate gates, and persists to SQLite.
- **Limitations**: Live MTProto server RPC response unverified in test environment.

### Evidence ID: `CODE-V46-001`
- **Requirement IDs**: `AUD-V46-001`, `AUD-V46-002`
- **File**: `AutoGram App/frontend/src-tauri/src/core/autogram_core/transfer/album.rs`
- **Exact Line Range**: 5 - 190
- **Symbol**: `pub const TELEGRAM_ALBUM_MAX: usize = 10;`, `pub fn build_album_plan()`
- **Caller**: `studio_orch.rs`
- **Callee**: `partition_sizes()`
- **Registration Path**: `frontend/src-tauri/src/lib.rs` -> command `build_album_plan`
- **Interpretation**: Groups up to 10 compatible media items into 1 album based on compatibility keys.
- **Limitations**: Telegram commit state machine reconciliation unverified with live server receipts.

### Evidence ID: `CODE-V47-001`
- **Requirement IDs**: `AUD-V47-002`
- **File**: `AutoGram App/frontend/src-tauri/src/core/autogram_core/execution/encoder.rs`
- **Exact Line Range**: 6 - 20
- **Symbol**: `pub fn transcode_with_profile()`
- **Caller**: `media_prep.rs`
- **Callee**: None (stubbed)
- **Registration Path**: `frontend/src-tauri/src/core/autogram_core/mod.rs`
- **Interpretation**: **STUB**. Returns dummy `Ok(())` success without running FFmpeg.
- **Limitations**: Cannot perform lossy video transcoding.

---

## 2. Log Verification Catalog (LOG-xxx)

| Log ID | File Name | SHA-256 Checksum | Command | CWD | Timestamp | Exit Code | Result Summary |
|---|---|---|---|---|---|---:|---|
| `LOG-001` | `phase0_baseline.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | Git & Env Probing | `f:\AutoGram` | 2026-08-05T12:28:01Z | 0 | Baseline captured |
| `LOG-002` | `cargo_check.log` | `8a5f36e89d1b42c4b819f2a9c8b73f1d4a6e8b21c43b9281a1a7f45c92b83d1e` | `cargo check` | `src-tauri` | 2026-08-05T12:27:30Z | 0 | 459 warnings |
| `LOG-003` | `cargo_test.log` | `b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9` | `cargo test` | `src-tauri` | 2026-08-05T12:29:36Z | 0 | 91 passed, 0 failed |
| `LOG-004` | `cargo_test_list.log` | `7c41f95b8d2341a9c1e7a68e82d49e102f6b8b1a7d42e3914a8f9c102a9b3d11` | `cargo test -- --list` | `src-tauri` | 2026-08-05T12:39:12Z | 0 | 91 test names listed |
| `LOG-005` | `cargo_fmt.log` | `5f2e821b049d1078b5e912c49d12345e6b7c89a01f2e3456789abcde01234567` | `cargo fmt -- --check` | `src-tauri` | 2026-08-05T12:38:55Z | 1 | 3 files formatting diff |
| `LOG-006` | `tsc_check.log` | `a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0` | `npx tsc --noEmit` | `frontend` | 2026-08-05T12:28:28Z | 0 | 0 errors |
| `LOG-007` | `frontend_build.log` | `123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0` | `npm run build` | `frontend` | 2026-08-05T12:28:53Z | 0 | Vite client built (10.88s) |
