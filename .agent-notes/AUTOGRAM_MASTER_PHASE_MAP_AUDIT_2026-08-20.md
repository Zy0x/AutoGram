# AutoGram Master Phase Map - Implementation Audit

Date: 2026-08-20

This audit maps the external `AutoGram_Master_Phase_Map_Architecture_Workflows_and_Acceptance_Gates.md`
to the active React/Tauri/Rust/Grammers runtime. The external document is a reference specification;
repository code and repeatable runtime evidence remain authoritative.

## Status legend

- `PROVEN`: active-path implementation plus automated and/or `frontend.exe` evidence.
- `IMPLEMENTED`: active-path implementation and deterministic tests, but the full live acceptance scale was not available.
- `PARTIAL`: a meaningful subset is proven; at least one named acceptance gate remains.
- `OPEN`: not executed or not implemented.

## Current phase result

| Phase | Status | Evidence | Remaining gate |
| --- | --- | --- | --- |
| P4.4 Long-Haul Adaptive Ceiling | PROVEN at 43k; hardened from 558k live evidence | Rust governor tracks sustained/best-safe rate, degradation, cooldown, DB/resource bounds, and anti-oscillation. A 558,256-item live run exposed latency-only spacing accumulating to 1,875 ms with zero FloodWait; the source now cooldown-limits and caps that feedback while preserving the independent FloodWait path. All 133 Rust tests pass. | Resume the 558k checkpoint on the rebuilt native executable and prove sustained recovery/convergence. |
| P4.5 Durable Commit Coalescing | PROVEN at 43k scale | Adaptive durable batch sizing, terminal flush, ACK-safe checkpointing, and crash/ACK tests are active. Live DB ACK p95 was 26 ms and the final exact count converged. | Repeat under forced slow IndexedDB and destructive interruption at 100k+ scale. |
| P4.6 Live Ceiling Benchmark | PARTIAL | A 43,013-item peer completed exactly. A second live peer with 558,256 Telegram media committed 82,300 rows before its old-binary worker was cancelled; it began near 453-466 rows/s and exposed a flood-free pacing feedback defect. | Run the patched rebuilt executable to terminal convergence, then repeat across the requested device/network profiles. |
| P5 Destructive Production Endurance | OPEN | Deterministic crash/ACK/resume tests pass. | Do not claim P5 until destructive process/network/disk/flood scenarios are run against disposable data and final convergence is verified. |

## Live benchmark evidence

- Scope: Lavender session, `#Gudang`, peer `-1003214112048`, all topics.
- Exact candidate count: 43,013.
- Durable checkpoint before the final resumed job: 13,500 rows.
- Final job rows committed: 29,513.
- Final convergence: 13,500 + 29,513 = 43,013.
- FloodWait count: 0.
- ACK p95 at completion: 26 ms.
- Governor remained free of DB-bound and resource-bound states during sampled live execution.
- Explicit pause stopped the worker at a safe boundary; resume continued the same job/checkpoint.

### 558k long-haul continuation

- Scope: Mantan Gadis session, peer `-1001963951938`, all media.
- Telegram candidate count: 558,256.
- Sampled healthy ceiling: approximately 453-466 committed rows/s with FloodWait=0.
- At approximately 75,600 rows, throughput fell to 65.8 rows/s; terminal inspection at 82,300 committed rows reported 46.54 sustained rows/s against a 466.53 rows/s best-safe rate.
- Resource evidence remained healthy: ACK p95 approximately 64 ms, RPC p95 approximately 394 ms,
  frontend working set approximately 46 MB, WebView working set approximately 91 MB.
- Root cause: the stable branch added 25 ms on every successful RPC while the 128-sample rolling p95
  remained elevated, growing dispatch spacing to 1,875 ms despite no FloodWait.
- Job 4 first accepted `user_paused`, but the old UI resumed it through the already-fixed pause presentation race. It was then explicitly cancelled without deleting its 82,300 committed index rows. The running user application was not stopped or restarted.
- Source regression coverage now proves a two-second latency-backoff cooldown, 250 ms latency-only cap,
  severe flood-free decay recovery, and an independent FloodWait pacing path.

## Runtime issues found during the gate

1. A queued page event could overwrite the React `isPaused` presentation immediately after Rust entered
   `user_paused`, hiding the Resume action. The page reducer now reads the authoritative pause ref.
2. Multiple historical attempts can legitimately contribute to one durable exact count. UI progress must
   represent the durable accumulated checkpoint, while worker telemetry remains per-job.
3. A long pause makes lifetime `rows/sec` misleading. The governor's current sustained rate and best-safe
   rate are the correct live control signals; lifetime rate remains historical telemetry only.
4. `totalIndexedCount` was component-global and survived account/peer/topic navigation. The UI could show
   a prior peer's 43k progress inside a new 558k peer. Progress is now guarded by the exact
   account/peer/topic cache scope and reset at every context transition.
5. Rolling p95 is historical evidence, not a per-success failure signal. Applying pacing on every sample
   creates a positive feedback loop; latency-only adaptation now uses a cooldown/cap, while FloodWait
   continues to own the stronger monotonic safety path.

## Acceptance policy

- P4.4/P4.5 may be treated as implemented and proven for the tested 43k class.
- P4.6 remains partial until the required 100k-1M live matrix is executed.
- P5 remains open and separate; synthetic unit tests cannot replace destructive endurance evidence.
