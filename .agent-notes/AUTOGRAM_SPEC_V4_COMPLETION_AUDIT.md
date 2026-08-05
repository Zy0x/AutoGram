# AutoGram v4 Completion Audit

Last updated: 2026-08-05

This is the requirement-by-requirement truth source for the six attached plans. A green unit test or a compiled type does not by itself prove a runtime requirement. Plan v4.6 is authoritative for album behavior where v4.5 is broader or ambiguous.

## Status legend

- `PROVEN`: implemented in the active React/Tauri/Rust/Grammers path and covered by automated or direct `frontend.exe` evidence.
- `IMPLEMENTED_UNPROVEN_RUNTIME`: code and deterministic tests exist, but the required external binary/device/fault environment is absent.
- `PARTIAL`: a safe subset exists; at least one normative behavior remains.
- `OPEN`: no complete active-path implementation/evidence yet.
- `FUTURE_PLATFORM`: Android-specific runtime work has no Android application target in this checkout; shared domain contracts must still remain portable.

## Cross-spec control plane

| Requirement family | Status | Current evidence / remaining gap |
| --- | --- | --- |
| Frozen profile and per-item decisions | PROVEN | `transfer_runs`, `transfer_items_v4`, preflight, and live 11-item run. |
| Dynamic upload limit | PROVEN | Live/cached/fallback `help.getAppConfig`, part validator, live preflight evidence. |
| Dynamic caption limit | PROVEN | Live/cached/fallback config, UTF-16 policy, preflight reporting, execution validation, unit tests. |
| Feature-flag rollback | OPEN | No operational flag currently returns the new engine to an isolated safe legacy path. |
| Scoped policy precedence | PARTIAL | Named UI profiles and frozen snapshots exist; global/account/destination/mode/category precedence is not persisted/resolved. |
| Persistent 10k-100k pagination | OPEN | Preflight accepts up to 10k; queue remains an in-memory JSON map and no 100k bounded-memory benchmark exists. |
| Native Android runtime | FUTURE_PLATFORM | No Android target exists in this checkout. Shared Rust types are portable, but lifecycle/URI/foreground-service/MediaCodec behavior is not implemented. |

## v4.1 Quality Mode Engine

| Requirement family | Status | Current evidence / remaining gap |
| --- | --- | --- |
| ORIGINAL byte preservation | PROVEN | GenericDocument pass-through and tests. |
| Magic-aware categorization and safe unknown fallback | PROVEN | Analyzer/router tests and live document preflight. |
| SMART lossless-first video decision | IMPLEMENTED_UNPROVEN_RUNTIME | Remux/re-encode planning and post-output validation exist; FFmpeg/FFprobe absent on this machine. |
| Distinct subtitle actions | OPEN | Preservation guard prevents silent damage, but convert/embed/burn-in/drop policies are not implemented. |
| HEIC/AVIF/PNG conversion policy | PARTIAL | Unsafe conversion is refused and source is preserved as document; color-managed photo conversion is absent. |
| Encoder/backend-specific routing | IMPLEMENTED_UNPROVEN_RUNTIME | Physical device identity, NVENC exact selection, fail-closed AMF/QSV, and tests exist; no encoder runtime available. |
| Server-processing final ID mapping | OPEN | Upload results are committed, but large-channel `SERVER_PROCESSING`/`alt_documents` tracking is absent. |
| Feature-flag rollback | OPEN | Required non-destructive rollback path remains. |

## v4.3 Universal File / Batch Handling

| Requirement family | Status | Current evidence / remaining gap |
| --- | --- | --- |
| Universal unknown/document fallback | PROVEN | Unknown and preservation-sensitive inputs use GenericDocument. |
| Per-file planning before album | PROVEN | Prepared output classification and compatibility grouping. |
| Folder/relative-path manifest planning | PARTIAL | Split manifests preserve reconstruction; source-folder enumeration/relative-path batch manifest is absent. |
| Remote URL safety | PARTIAL | HTTP/HTTPS sources are deferred and downloaded in Rust; complete redirect/DNS rebinding/size-bomb fault suite is absent. |
| Album homogeneity | PROVEN | Native visual/document/audio/original payload classes and planner tests. |
| Restart/mutation/disk-full recovery | PARTIAL | Receipts/checkpoints/hash validation exist; end-to-end injected crash/mutation/disk-full suite is absent. |

## v4.4 Oversize Transfer Manager

| Requirement family | Status | Current evidence / remaining gap |
| --- | --- | --- |
| Split + public manifest + hashes | PROVEN | Split engine tests and deterministic merge metadata. |
| Alternate-account same-destination gates | PROVEN | Rights, membership, limit, FloodWait, Saved Messages non-equivalence, and explicit approval checks. |
| Whole-album alternate policy | PROVEN | Frozen all-item eligibility and sender compatibility. |
| Skip audit | PROVEN | Item state and reason persisted. |
| Cross-tool merge kit | PARTIAL | Public manifest and commands exist; packaged standalone GUI/Android merge utility is absent. |
| Policy scopes/precedence | OPEN | No persisted session/destination/mode/category/global resolver. |
| Mobile pause/decision flow | FUTURE_PLATFORM | No Android app target. |

## v4.5 Scale / FloodWait / Download Reliability

| Requirement family | Status | Current evidence / remaining gap |
| --- | --- | --- |
| Account FloodWait persistence | PROVEN | Durable account gate and bounded wait behavior. |
| Destination Slow Mode lane | PARTIAL | RPC waits are handled, but independent durable destination/topic send gates are absent. |
| Pause/resume/cancel safe boundaries | PROVEN | Queue controls and direct UI path. |
| Album commit idempotency | PROVEN | Persisted random IDs, UNKNOWN_COMMIT, grouped/order verification, no blind retry. |
| Caption single-summary semantics | PROVEN | Runtime caption limit, UTF-16-safe overflow, first surviving prepared item reassignment, one-caption split behavior, preflight explanation, tests. |
| Caption templates/entities/sidecars | OPEN | Filename fallback exists; template variables, sidecar mapping, and MTProto entity validation are absent. |
| Exact local ledger duplicate | PROVEN | SHA-256 destination-scoped skip and live repeat-upload evidence. |
| Telegram historical duplicate scan | OPEN | Filename+size is only ledger telemetry; no separate remote history/index scan or stale-reference reuse. |
| Resumable/integrity downloads | PROVEN | Sparse ranges, receipts, conflict policy, atomic finalization, SHA/size checks. |
| DC migration/file-reference refresh | PARTIAL | Download path has index-specific reference refresh; per-DC adaptive scheduler and full migration tests are absent. |
| Massive queue 100k | OPEN | Persistent pagination, bounded UI virtualization, and 100k benchmark absent. |

## v4.6 Intelligent Album Orchestration

| Priority | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| P0 | Prepared-output groups, payload classes, ORIGINAL separation, homogeneous groups | PROVEN | Planner, classifier, and live 9+2 document groups. |
| P0 | No automatic single fallback | PROVEN | Atomic/unknown commit handling. |
| P0 | UNKNOWN_COMMIT, random IDs, count/group/order/context verification | PROVEN | Durable commit tables and tests. |
| P0 | Replan after preparation/oversize/duplicate | PROVEN | Final prepared list is constructed after these decisions. |
| P0 | Failure policy and confirmation | PROVEN | Typed policies and preflight approval. |
| P1 | Caption/spoiler/context | PROVEN | Per-item spoiler, single logical album summary, silent/topic/send-as/schedule. |
| P1 | Index-specific file-reference repair | PARTIAL | Fresh upload media has no reusable file reference; reused-remote album media path is not implemented. |
| P1 | Explainable preview | PROVEN | Per-item transform/payload/reason/warnings plus provisional album/caption placement. |
| P1 | Custom packing + avoid-single | PROVEN | 2-10 custom packing and 11 => 9+2. |
| P1 | Crash recovery + receipts | PROVEN | Durable commit intent/random IDs/UNKNOWN_COMMIT; injected process-kill test still desirable. |
| P2 | Constraint solver / visual coherence | PARTIAL | Deterministic compatibility and packing constraints exist; visual-coherence heuristic is absent. |
| P2 | Scoped policy learning | OPEN | No persisted precedence resolver. |
| P2 | Anomaly telemetry | PARTIAL | Structured logs and durable decisions exist; anomaly detector is absent. |
| P2 | Large-scale album planning | PARTIAL | Linear deterministic planner exists; 100k persistence/benchmark absent. |

## v4.7 Encoder Orchestration

| Requirement family | Status | Current evidence / remaining gap |
| --- | --- | --- |
| Device registry and exact routing | IMPLEMENTED_UNPROVEN_RUNTIME | Discovery/identity/smoke/admission/tests exist; exact hardware not available for runtime proof. |
| Strategy/resource profiles | PROVEN | Typed UI policy and frozen options. |
| Bounded target-size retry | IMPLEMENTED_UNPROVEN_RUNTIME | Deterministic tests; no FFmpeg runtime. |
| Output validation/fallback | IMPLEMENTED_UNPROVEN_RUNTIME | FFprobe contracts and fail-closed behavior; no local binary. |
| Live resource pressure | PARTIAL | Static admission and bounded parallelism exist; continuous CPU/GPU/thermal feedback loop is absent. |
| HDR/color contracts | PARTIAL | HDR is protected from unsafe conversion; explicit tone-map/color-managed execution is absent. |
| Benchmarks/quirk registry | OPEN | No runtime encoder benchmark or versioned device-quirk store. |
| Android MediaCodec parity | FUTURE_PLATFORM | No Android target. |

## Next closure order

1. Operational feature flags and non-destructive rollback.
2. Persisted scoped policy resolver and precedence tests.
3. Caption templates/per-item sidecars/entity-safe rendering.
4. Separate remote duplicate confidence/index path.
5. Durable destination/Slow Mode gates and paginated persistent queue.
6. Server-processing tracker and fault-injection suites.
7. Encoder pressure/benchmark/quirk registry where runtime dependencies permit.

