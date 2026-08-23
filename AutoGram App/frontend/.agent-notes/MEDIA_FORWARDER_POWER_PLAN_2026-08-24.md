# Media Forwarder Power Plan

Status: execution plan. Runtime work must preserve the existing Drive preview, streaming, thumbnail, and transfer contracts.

## Product outcome

Media Forwarder is a persistent rule-driven pipeline that observes authorized Telegram sources, evaluates items exactly once, previews the plan, and forwards/copies the intended output to one or more destinations with recoverable progress and server-confirmed completion.

## End-to-end workflow

1. Select source sessions and chats/topics; show membership/restriction state in context.
2. Select destination session, chat, and optional forum topic.
3. Define filters: Telegram delivery type, MIME, extension, size, date, sender, caption/text, URL/domain, album, reply, and topic.
4. Define transforms: copy/forward mode, media-vs-document presentation, album size 2-10, caption template, filename policy, metadata policy, quality/oversize policy, and optional approved re-encode.
5. Define duplicate policy and deleted-file guardrail.
6. Run a dry preflight that lists every planned action, skip, warning, duplicate match, album packing result, and estimated bytes.
7. Freeze a versioned plan and enqueue it in the Transfer Manager.
8. Execute stage-by-stage with persistent checkpoints and server confirmation.
9. Reconcile destination messages, update the duplicate ledger, and expose retry/rollback decisions for partial failures.

## Control plane

- Durable SQLite jobs: rule, source cursor, frozen item plan, item attempts, output message IDs, album identity, stage progress, pause intent, and audit events.
- State machine: Draft -> Scanning -> Preflight -> Queued -> Preparing -> Uploading/Forwarding -> Committing -> Verifying -> Completed, Failed, Cancelled, or Attention required.
- Pause is cooperative: stop scheduling new work, finish or safely checkpoint the active Telegram request, then mark Paused. Resume continues from the last verified boundary.
- Application/session/drive switches never discard active jobs; startup reconciliation finds unfinished work and asks whether to resume, retry, inspect, or clear.

## Correctness contracts

- Four-level duplicate checks: source message ID, Telegram unique media ID, SHA-256, filename+size.
- Source identity includes account, peer, topic, message, grouped/album ID, and edit version.
- Destination success requires Telegram server message IDs; UI completion alone is not success.
- Album grouping follows the configured 2-10 size exactly. A set of 10 with size 7 becomes server-confirmed groups 7+3.
- Edits/deletes are explicit rule options. Default behavior never propagates a destructive action silently.
- Caption length/entities, forum topic, reply target, and protected-content constraints are validated before queueing.

## Throughput model

- Separate scan, download, prepare/encode, upload, and commit pools with bounded queues and backpressure.
- Smart Rate Controller per account and data center: token bucket, FloodWait-aware pause, exponential backoff, and fairness across jobs.
- Stream large payloads to disk-backed partial files; keep React as a view of backend state, not a transfer engine.
- Adaptive concurrency respects Telegram limits, network quality, disk latency, CPU/GPU utilization, memory pressure, and active previews.
- Reuse the persistent media index and duplicate index; do not rescan the same chat independently.

## Transfer Manager UX

- Aggregate progress is weighted across all items and all required stages, not copied from the active item.
- Stage colors and labels: Scan, Download, Verify, Re-encode, Upload, Commit, and Reconcile.
- Per-item row exposes source/destination, current stage, bytes, speed, ETA, attempt, Telegram result, and a compact diagnostic drawer.
- Actions: Pause/resume, stop safely, retry selected, retry failed, clear completed, clear failed after confirmation, and export diagnostic bundle with secrets redacted.
- Rules can be enabled/disabled independently; editing a rule creates a new version and does not mutate a frozen running plan.

## Rule and trigger modes

- Manual selection, historical bounded range, live new-message trigger, scheduled window, and one-time migration.
- Source cursor persists by account+peer+topic and reconciles gaps after reconnect.
- Optional edit/delete propagation is isolated behind explicit high-risk settings and preview.
- Bot/channel join/start actions are contextual only when opening an unresolved Telegram target and are never global sidebar automation.

## Failure and recovery

- Classify transient network/DC migration/FloodWait, authorization/membership, missing peer/topic, removed source, incompatible media, disk full, transform failure, duplicate, and server-commit ambiguity.
- Retriable failures retain exact checkpoints. Commit ambiguity queries Telegram before any resend to prevent duplicates.
- Album partial failure follows the selected atomic/replan/best-effort policy and records every output ID.
- Session revoked or 2FA-required jobs enter Attention required without deleting local state.

## Delivery phases

1. Durable rules and state machine; startup reconciliation and dry run.
2. Single-source/single-destination copy with exact dedup and confirmation.
3. Albums, topics, caption templates, oversize decisions, and transforms.
4. Multi-source/destination fairness, live triggers, schedules, and pause/resume.
5. Edit/delete policies, diagnostics, recovery drills, and large-scale performance hardening.

## Acceptance matrix

- Sessions: saved messages, user chat, bot, group, supergroup, forum topic, channel, restricted/unavailable.
- Delivery: native photo/video/audio, document-as-media, archive, text, one/many links, album, reply, caption entities.
- Sizes: tiny through Telegram account limit, including resumable large documents.
- Policies: skip/force duplicate, album sizes 2-10, presentation modes, quality modes, caption overflow, oversize handling, pause/resume during each stage.
- Recovery: app crash, session switch, DC migration, FloodWait, network loss, disk pressure, destination deletion, ambiguous commit.

Release requires unit/state-machine tests, migration tests, a synthetic high-volume soak, native `frontend.exe` remote QA, and Telegram-side verification that output count, albums, captions, topics, and message IDs match the frozen plan exactly.
