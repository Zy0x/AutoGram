# Bug Investigation: Adaptive Indexer Long-Haul Spacing Runaway

## Symptoms

- Live `frontend.exe` index on peer `-1001963951938` (558,256 Telegram media) began near 453-466 committed rows/s.
- At roughly 75,600 committed rows, sustained throughput fell to 65.8 rows/s, then 57.8 rows/s.
- Terminal inspection at 82,300 committed rows reported 46.54 sustained rows/s against a 466.53 rows/s best-safe rate.
- FloodWait stayed at 0, ACK p95 was 63 ms, RPC p95 314 ms, while dispatch spacing grew to 2,155 ms and ACK-to-next-RPC p95 to 1,921 ms.

## Reproduction steps

1. Attach to the already-running native `frontend.exe` on CDP port 9230.
2. Select the Mantan Gadis session and peer `-1001963951938`.
3. Start one full media index job and sample authoritative governor telemetry during the long haul.
4. Observe spacing after the rolling RPC p95 exceeds 1.8 times its warmup baseline.

## Expected behavior

Latency pacing should react conservatively without accumulating on every successful page. A flood-free scan should recover toward its best safe sustained rate.

## Actual behavior

The stable-state branch added 25 ms of spacing for every successful RPC while the 128-sample rolling p95 remained elevated. The old high samples persisted, so spacing grew without a cooldown or cap and became the throughput bottleneck.

## Working fix

- Apply latency-only pacing at most once per two-second cooldown.
- Cap latency-only spacing at 250 ms.
- If sustained throughput decays at least 45% with no FloodWait in the job, clamp runaway spacing and progressively relieve it.
- Keep FloodWait recovery independent and monotonic; its pacing may exceed the latency-only cap.
- Add a deterministic regression test for the repeated-success feedback loop and the observed 1,875 ms recovery case.

## Verification

- Live job 4 initially accepted pause, but the old UI resumed through the already-fixed pause presentation race. The worker was explicitly cancelled at 82,300 committed rows; persisted index rows were not deleted, and the running user application was not closed or restarted.
- Rust and frontend gates are pending after this patch.
- A live resumed benchmark on the rebuilt binary is still required before P4.6 can be marked complete.

## Status

Source fix implemented; automated and rebuilt-native verification pending.
