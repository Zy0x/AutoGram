//! channel_sync_worker.rs — Long-Running Rust Channel Synchronization Worker (P2.5 Hardened)
//!
//! Maintains Telegram channel PTS sequence, 500ms reorder grace buffer,
//! getChannelDifference pagination, updateChannelTooLong recovery,
//! active-channel short polling, ReconcileRequired barrier,
//! and single-winner atomic ACK backpressure with IndexedDB.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use tokio::sync::{mpsc, watch, Notify, RwLock};
use tokio_util::sync::CancellationToken;

use super::channel_sync_types::*;
use super::grammers_ops::channel_updates::{
    fetch_channel_pts, get_channel_difference_page, ChannelDifferenceResult,
};
use super::media_mutation::MediaMutation;
use super::session_update_router::{ChannelUpdateType, PendingChannelUpdate, SessionUpdateRouter};
use super::telegram_ops::TelegramIdentity;
use super::telegram_rpc_guard::RpcGuardControl;
use super::tg_error::TgError;

const DEFAULT_ACK_TIMEOUT: Duration = Duration::from_secs(120);
const FRONTEND_REATTACH_TIMEOUT: Duration = Duration::from_secs(120);
const REORDER_GRACE_DURATION: Duration = Duration::from_millis(500);
const DEFAULT_SHORT_POLL_TIMEOUT: Duration = Duration::from_secs(2);

pub(crate) fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Abstract channel difference source allowing production Grammers MTProto or mock injection in unit tests.
#[async_trait]
pub trait ChannelDifferenceSource: Send + Sync {
    async fn fetch_pts(
        &self,
        identity: &TelegramIdentity,
        chat_id: &str,
        guard_control: RpcGuardControl,
    ) -> Result<i32, TgError>;

    async fn get_difference(
        &self,
        identity: &TelegramIdentity,
        chat_id: &str,
        pts: i32,
        limit: i32,
        guard_control: RpcGuardControl,
    ) -> Result<ChannelDifferenceResult, TgError>;
}

/// Production implementation of ChannelDifferenceSource.
pub struct GrammersChannelDifferenceSource {
    pub sessions_dir: PathBuf,
}

#[async_trait]
impl ChannelDifferenceSource for GrammersChannelDifferenceSource {
    async fn fetch_pts(
        &self,
        identity: &TelegramIdentity,
        chat_id: &str,
        guard_control: RpcGuardControl,
    ) -> Result<i32, TgError> {
        fetch_channel_pts(&self.sessions_dir, identity, chat_id, &guard_control).await
    }

    async fn get_difference(
        &self,
        identity: &TelegramIdentity,
        chat_id: &str,
        pts: i32,
        limit: i32,
        guard_control: RpcGuardControl,
    ) -> Result<ChannelDifferenceResult, TgError> {
        get_channel_difference_page(&self.sessions_dir, identity, chat_id, pts, limit, &guard_control).await
    }
}

/// Trait abstraction for dispatching events to a frontend sink (Tauri IPC Channel or closure).
pub trait ChannelSyncEventSink: Send + Sync {
    fn send_event(&self, event: ChannelSyncEvent) -> bool;
}

pub struct FnChannelSyncEventSink<F>(pub F)
where
    F: Fn(ChannelSyncEvent) -> bool + Send + Sync;

impl<F> ChannelSyncEventSink for FnChannelSyncEventSink<F>
where
    F: Fn(ChannelSyncEvent) -> bool + Send + Sync,
{
    fn send_event(&self, event: ChannelSyncEvent) -> bool {
        (self.0)(event)
    }
}

/// Active authoritative persistence subscriber attached to a channel sync worker.
pub struct PrimaryChannelSubscriber {
    pub subscriber_id: u64,
    pub generation: u64,
    pub sink: Arc<dyn ChannelSyncEventSink>,
}

/// Unacknowledged outstanding mutation batch retained in memory for instant replay upon reattach.
#[derive(Clone)]
pub struct PendingMutationBatch {
    pub batch_id: u64,
    pub event: ChannelSyncMutationBatchEvent,
    pub emitted_at_ms: u64,
}

/// Result returned from attaching or reattaching a primary persistence subscriber.
#[derive(Debug, Clone)]
pub struct ChannelAttachSnapshot {
    pub subscriber_id: u64,
    pub generation: u64,
    pub state: ChannelSyncStatus,
    pub current_pts: i32,
    pub replayed_batch_id: Option<u64>,
}

/// Desired lifecycle state signaled by pause/resume controllers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelSyncDesiredState {
    Running,
    Paused,
}

/// Thread-safe control handles for an active channel sync worker.
pub struct ChannelSyncControl {
    pub sync_id: u64,
    pub session_key: String,
    pub client_request_id: String,
    pub peer_id: String,
    pub created_at_ms: u64,
    pub current_pts: AtomicI32,
    pub state_tx: watch::Sender<ChannelSyncDesiredState>,
    pub cancel: CancellationToken,
    pub ack_tx: mpsc::Sender<ChannelSyncAck>,

    // Three-stage ACK watermarks
    pub expected_batch_id: AtomicU64,
    pub claimed_batch_id: AtomicU64,
    pub last_processed_batch_id: AtomicU64,

    // Single replaceable primary persistence subscriber
    pub primary_subscriber: RwLock<Option<PrimaryChannelSubscriber>>,
    pub next_subscriber_id: AtomicU64,
    pub subscriber_generation: AtomicU64,
    pub subscriber_notify: Arc<Notify>,

    // Reconcile Barrier & Target PTS Binding
    pub reconcile_target_pts: AtomicI32,
    pub reconcile_notify: Arc<Notify>,

    // Pending unacknowledged batch for replay
    pub pending_batch: RwLock<Option<PendingMutationBatch>>,

    pub status: Arc<RwLock<ChannelSyncStatus>>,
    pub is_actively_viewed: AtomicBool,
    pub terminal_at_ms: AtomicU64,
}

impl ChannelSyncControl {
    pub async fn emit_to_primary(&self, event: ChannelSyncEvent) -> bool {
        let sub = {
            let guard = self.primary_subscriber.read().await;
            guard.as_ref().map(|s| s.sink.clone())
        };
        if let Some(sink) = sub {
            sink.send_event(event)
        } else {
            false
        }
    }

    pub async fn attach_primary_and_snapshot(
        &self,
        sink: Arc<dyn ChannelSyncEventSink>,
    ) -> ChannelAttachSnapshot {
        let gen = self.subscriber_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let sub_id = self.next_subscriber_id.fetch_add(1, Ordering::SeqCst);

        {
            let mut primary = self.primary_subscriber.write().await;
            *primary = Some(PrimaryChannelSubscriber {
                subscriber_id: sub_id,
                generation: gen,
                sink: sink.clone(),
            });
        }

        let mut st = *self.status.read().await;

        // P3.2 Invariant: only replay pending batch if it has NOT been claimed yet
        let mut replayed_id = None;
        let expected = self.expected_batch_id.load(Ordering::Acquire);
        let claimed = self.claimed_batch_id.load(Ordering::Acquire);

        if expected > 0 && claimed < expected {
            let pb = self.pending_batch.read().await;
            if let Some(ref p) = *pb {
                if p.batch_id == expected {
                    replayed_id = Some(p.batch_id);
                    sink.send_event(ChannelSyncEvent::Batch(p.event.clone()));

                    // If replayed, ensure state is WaitingAck
                    let mut st_guard = self.status.write().await;
                    if *st_guard == ChannelSyncStatus::WaitingFrontend {
                        *st_guard = ChannelSyncStatus::WaitingAck;
                    }
                    st = *st_guard;
                }
            }
        }

        sink.send_event(ChannelSyncEvent::State {
            sync_id: self.sync_id,
            state: st,
        });

        self.subscriber_notify.notify_waiters();

        ChannelAttachSnapshot {
            subscriber_id: sub_id,
            generation: gen,
            state: st,
            current_pts: self.current_pts.load(Ordering::Acquire),
            replayed_batch_id: replayed_id,
        }
    }

    pub async fn detach_primary(&self, subscriber_id: u64, generation: u64) -> bool {
        let mut primary = self.primary_subscriber.write().await;
        if let Some(ref current) = *primary {
            if current.subscriber_id == subscriber_id && current.generation == generation {
                *primary = None;
                let mut st = self.status.write().await;
                if *st == ChannelSyncStatus::WaitingAck {
                    *st = ChannelSyncStatus::WaitingFrontend;
                }
                drop(st);
                drop(primary);
                self.subscriber_notify.notify_waiters();
                return true;
            }
        }
        false
    }

    pub async fn complete_reconcile(&self, latest_pts: i32) -> bool {
        let target = self.reconcile_target_pts.load(Ordering::Acquire);
        let current = self.current_pts.load(Ordering::Acquire);
        let current_status = {
            let st = self.status.read().await;
            *st
        };

        if current_status != ChannelSyncStatus::ReconcileRequired {
            return false;
        }

        // Validate target PTS strictly: must match target server PTS and cannot regress
        if target > 0 && latest_pts != target {
            return false;
        }
        if latest_pts < current {
            return false;
        }

        self.current_pts.store(latest_pts, Ordering::Release);
        self.reconcile_target_pts.store(0, Ordering::Release);
        self.expected_batch_id.store(0, Ordering::Release);
        self.claimed_batch_id.store(0, Ordering::Release);
        {
            let mut pb = self.pending_batch.write().await;
            *pb = None;
        }
        {
            let mut st = self.status.write().await;
            *st = ChannelSyncStatus::LiveSynced;
        }

        self.reconcile_notify.notify_waiters();
        let _ = self.emit_to_primary(ChannelSyncEvent::State {
            sync_id: self.sync_id,
            state: ChannelSyncStatus::LiveSynced,
        }).await;
        true
    }
}

/// Long-running async worker driving channel synchronization.
pub struct ChannelSyncWorker {
    pub sync_id: u64,
    pub request: StartChannelSyncRequest,
    pub control: Arc<ChannelSyncControl>,
    pub difference_source: Arc<dyn ChannelDifferenceSource>,
    pub router: Arc<SessionUpdateRouter>,
    pub ack_rx: mpsc::Receiver<ChannelSyncAck>,
    pub update_rx: mpsc::Receiver<PendingChannelUpdate>,
    pub mailbox_overflowed: Arc<AtomicBool>,
}

impl ChannelSyncWorker {
    pub async fn run(mut self) {
        let session_key = self.request.identity.session.clone();
        let peer_id = self.request.peer_id.clone();
        let parsed_channel_id: i64 = peer_id.parse().unwrap_or(0);
        let sync_id = self.sync_id;
        let cancel = self.control.cancel.clone();
        let mut state_rx = self.control.state_tx.subscribe();

        let mut batch_counter: u64 = 0;
        let mut reorder_buffer: BTreeMap<i32, PendingChannelUpdate> = BTreeMap::new();

        // 1. Initial PTS Bootstrap & Durable Baseline Persistence
        let initial_pts = if let Some(pts) = self.request.initial_pts {
            self.control.current_pts.store(pts, Ordering::Release);
            pts
        } else {
            let pts_res = self
                .difference_source
                .fetch_pts(
                    &self.request.identity,
                    &peer_id,
                    RpcGuardControl::default(),
                )
                .await;

            match pts_res {
                Ok(pts) => {
                    batch_counter += 1;
                    let batch_id = batch_counter;
                    self.control.current_pts.store(pts, Ordering::Release);

                    let batch_event = ChannelSyncMutationBatchEvent {
                        sync_id,
                        batch_id,
                        account_id: session_key.clone(),
                        peer_id: peer_id.clone(),
                        previous_pts: 0,
                        candidate_pts: pts,
                        source: ChannelMutationSource::Bootstrap,
                        mutations: Vec::new(),
                        is_final: true,
                    };

                    {
                        let mut pb = self.control.pending_batch.write().await;
                        *pb = Some(PendingMutationBatch {
                            batch_id,
                            event: batch_event.clone(),
                            emitted_at_ms: now_epoch_ms(),
                        });
                    }
                    self.control.expected_batch_id.store(batch_id, Ordering::Release);

                    let sent = self
                        .control
                        .emit_to_primary(ChannelSyncEvent::Batch(batch_event))
                        .await;

                    if sent {
                        let mut st = self.control.status.write().await;
                        *st = ChannelSyncStatus::WaitingAck;
                    } else {
                        let mut st = self.control.status.write().await;
                        *st = ChannelSyncStatus::WaitingFrontend;
                    }

                    // Await storage ACK
                    match Self::wait_for_ack(
                        &self.control,
                        &mut self.ack_rx,
                        batch_id,
                        &cancel,
                    )
                    .await
                    {
                        Ok(ack) => {
                            if ack.outcome == ChannelSyncAckOutcome::Committed {
                                self.control.last_processed_batch_id.store(batch_id, Ordering::Release);
                                self.control.expected_batch_id.store(0, Ordering::Release);
                                {
                                    let mut pb = self.control.pending_batch.write().await;
                                    *pb = None;
                                }
                            } else {
                                let mut st = self.control.status.write().await;
                                *st = ChannelSyncStatus::Failed;
                                let err_msg = ack.error_code.unwrap_or_else(|| "Bootstrap commit rejected".into());
                                let _ = self.control.emit_to_primary(ChannelSyncEvent::Failed {
                                    sync_id,
                                    code: "bootstrap_storage_error".into(),
                                    message: err_msg,
                                    recoverable: true,
                                }).await;
                                return;
                            }
                        }
                        Err(e) => {
                            let mut st = self.control.status.write().await;
                            *st = ChannelSyncStatus::Failed;
                            let _ = self.control.emit_to_primary(ChannelSyncEvent::Failed {
                                sync_id,
                                code: "bootstrap_ack_timeout".into(),
                                message: e,
                                recoverable: true,
                            }).await;
                            return;
                        }
                    }
                    pts
                }
                Err(e) => {
                    let mut st = self.control.status.write().await;
                    *st = ChannelSyncStatus::Failed;
                    let _ = self.control.emit_to_primary(ChannelSyncEvent::Failed {
                        sync_id,
                        code: "bootstrap_pts_fetch_error".into(),
                        message: e.to_string(),
                        recoverable: true,
                    }).await;
                    return;
                }
            }
        };

        // 2. Initial Baseline Gate: Check if initial authoritative reconciliation is required
        let requires_reconcile = self.request.requires_initial_reconcile.unwrap_or(false);
        if requires_reconcile {
            self.control.reconcile_target_pts.store(initial_pts, Ordering::Release);
            {
                let mut st = self.control.status.write().await;
                *st = ChannelSyncStatus::ReconcileRequired;
            }
            let _ = self.control.emit_to_primary(ChannelSyncEvent::ReconcileRequired {
                sync_id,
                latest_pts: initial_pts,
                reason: "Initial cached media requires authoritative reconciliation".into(),
            }).await;

            // Enter the exact same reconcile barrier!
            // Buffers incoming passive updates, suspends difference recovery & short polling until frontend finishes exhaustive scan + commit + complete_reconcile(initial_pts)
            if let Err(e) = Self::wait_for_reconcile_completion(
                &self.control,
                &mut self.update_rx,
                &mut reorder_buffer,
                &cancel,
            ).await {
                let mut st = self.control.status.write().await;
                *st = ChannelSyncStatus::Failed;
                let _ = self.control.emit_to_primary(ChannelSyncEvent::Failed {
                    sync_id,
                    code: "initial_reconcile_barrier_failed".into(),
                    message: e,
                    recoverable: true,
                }).await;
                return;
            }
        } else {
            // Clean slate / already reconciled: transition to LiveSynced baseline
            {
                let mut st = self.control.status.write().await;
                if *st != ChannelSyncStatus::ReconcileRequired {
                    *st = ChannelSyncStatus::LiveSynced;
                }
            }
            let _ = self
                .control
                .emit_to_primary(ChannelSyncEvent::State {
                    sync_id,
                    state: ChannelSyncStatus::LiveSynced,
                })
                .await;
        }

        let mut next_short_poll_at = Instant::now() + DEFAULT_SHORT_POLL_TIMEOUT;
        let control_ref = self.control.clone();
        let diff_source_ref = self.difference_source.clone();
        let request_identity = self.request.identity.clone();

        // Main Event Loop
        let loop_result: Result<(), String> = async {
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => return Err("Cancelled".into()),
                    changed = state_rx.changed() => {
                        if changed.is_ok() {
                            let desired = *state_rx.borrow();
                            match desired {
                                ChannelSyncDesiredState::Paused => {
                                    let mut st = control_ref.status.write().await;
                                    *st = ChannelSyncStatus::Paused;
                                    let _ = control_ref.emit_to_primary(ChannelSyncEvent::State {
                                        sync_id,
                                        state: ChannelSyncStatus::Paused,
                                    }).await;
                                }
                                ChannelSyncDesiredState::Running => {
                                    let mut st = control_ref.status.write().await;
                                    *st = ChannelSyncStatus::LiveSynced;
                                    let _ = control_ref.emit_to_primary(ChannelSyncEvent::State {
                                        sync_id,
                                        state: ChannelSyncStatus::LiveSynced,
                                    }).await;
                                }
                            }
                        }
                    }
                }

                // If paused, wait for resume or cancellation
                {
                    let is_paused = {
                        let st = control_ref.status.read().await;
                        *st == ChannelSyncStatus::Paused
                    };
                    if is_paused {
                        tokio::select! {
                            _ = cancel.cancelled() => return Err("Cancelled while paused".into()),
                            changed = state_rx.changed() => {
                                if changed.is_ok() {
                                    let desired = *state_rx.borrow();
                                    if desired == ChannelSyncDesiredState::Running {
                                        let mut st = control_ref.status.write().await;
                                        *st = ChannelSyncStatus::LiveSynced;
                                    }
                                }
                            }
                        }
                        continue;
                    }
                }

                // Check mailbox overflow flag
                if self.mailbox_overflowed.swap(false, Ordering::AcqRel) {
                    let outcome = Self::run_difference_recovery(
                        &control_ref,
                        &diff_source_ref,
                        &request_identity,
                        &peer_id,
                        &session_key,
                        &mut self.ack_rx,
                        &mut batch_counter,
                        &cancel,
                    ).await?;
                    match outcome {
                        DifferenceRecoveryOutcome::Synced { next_short_poll_secs } => {
                            next_short_poll_at = Instant::now()
                                + Duration::from_secs(next_short_poll_secs.unwrap_or(2).clamp(1, 60) as u64);
                        }
                        DifferenceRecoveryOutcome::ReconcileRequired { latest_pts } => {
                            control_ref.reconcile_target_pts.store(latest_pts, Ordering::Release);
                            Self::wait_for_reconcile_completion(
                                &control_ref,
                                &mut self.update_rx,
                                &mut reorder_buffer,
                                &cancel,
                            ).await?;
                        }
                        DifferenceRecoveryOutcome::TerminalFailed(e) => return Err(e),
                    }
                }

                // Calculate sleep duration for active short polling
                let is_active = control_ref.is_actively_viewed.load(Ordering::Acquire);
                let poll_duration = if is_active {
                    let now = Instant::now();
                    if now >= next_short_poll_at {
                        Duration::from_millis(0)
                    } else {
                        next_short_poll_at - now
                    }
                } else {
                    Duration::from_secs(3600)
                };

                tokio::select! {
                    _ = cancel.cancelled() => return Err("Cancelled".into()),

                    // Incoming routed update from SessionUpdateRouter
                    maybe_update = self.update_rx.recv() => {
                        let Some(upd) = maybe_update else {
                            return Err("Update channel closed".into());
                        };

                        let local_pts = control_ref.current_pts.load(Ordering::Acquire);

                        // Handle updateChannelTooLong explicitly: triggers getChannelDifference recovery per Telegram MTProto spec
                        if let ChannelUpdateType::ChannelTooLong { pts: _ } = upd.update_type {
                            let outcome = Self::run_difference_recovery(
                                &control_ref,
                                &diff_source_ref,
                                &request_identity,
                                &peer_id,
                                &session_key,
                                &mut self.ack_rx,
                                &mut batch_counter,
                                &cancel,
                            ).await?;
                            match outcome {
                                DifferenceRecoveryOutcome::Synced { next_short_poll_secs } => {
                                    next_short_poll_at = Instant::now()
                                        + Duration::from_secs(next_short_poll_secs.unwrap_or(2).clamp(1, 60) as u64);
                                }
                                DifferenceRecoveryOutcome::ReconcileRequired { latest_pts } => {
                                    control_ref.reconcile_target_pts.store(latest_pts, Ordering::Release);
                                    Self::wait_for_reconcile_completion(
                                        &control_ref,
                                        &mut self.update_rx,
                                        &mut reorder_buffer,
                                        &cancel,
                                    ).await?;
                                }
                                DifferenceRecoveryOutcome::TerminalFailed(e) => return Err(e),
                            }
                            continue;
                        }

                        // Telegram PTS Sequencing logic
                        if local_pts + upd.pts_count == upd.pts {
                            // Exact sequential match! Emit mutation batch immediately
                            let muts = match upd.update_type {
                                ChannelUpdateType::NewMessage(m) | ChannelUpdateType::EditMessage(m) => vec![m],
                                ChannelUpdateType::DeleteMessages(ids) => vec![MediaMutation::delete(&peer_id, ids)],
                                _ => Vec::new(),
                            };

                            batch_counter += 1;
                            let batch_id = batch_counter;

                            let batch_event = ChannelSyncMutationBatchEvent {
                                sync_id,
                                batch_id,
                                account_id: session_key.clone(),
                                peer_id: peer_id.clone(),
                                previous_pts: local_pts,
                                candidate_pts: upd.pts,
                                source: ChannelMutationSource::Passive,
                                mutations: muts,
                                is_final: true,
                            };

                            // Save pending batch
                            {
                                let mut pb = control_ref.pending_batch.write().await;
                                *pb = Some(PendingMutationBatch {
                                    batch_id,
                                    event: batch_event.clone(),
                                    emitted_at_ms: now_epoch_ms(),
                                });
                            }
                            control_ref.expected_batch_id.store(batch_id, Ordering::Release);

                            let sent_ok = control_ref.emit_to_primary(ChannelSyncEvent::Batch(batch_event)).await;
                            if sent_ok {
                                let mut st = control_ref.status.write().await;
                                *st = ChannelSyncStatus::WaitingAck;
                            } else {
                                let mut st = control_ref.status.write().await;
                                *st = ChannelSyncStatus::WaitingFrontend;
                            }

                            // Wait for storage ACK
                            let ack = Self::wait_for_ack(
                                &control_ref,
                                &mut self.ack_rx,
                                batch_id,
                                &cancel,
                            ).await?;

                            if ack.outcome == ChannelSyncAckOutcome::Committed {
                                control_ref.current_pts.store(upd.pts, Ordering::Release);
                                control_ref.last_processed_batch_id.store(batch_id, Ordering::Release);
                                control_ref.expected_batch_id.store(0, Ordering::Release);
                                {
                                    let mut pb = control_ref.pending_batch.write().await;
                                    *pb = None;
                                }
                                {
                                    let mut st = control_ref.status.write().await;
                                    *st = ChannelSyncStatus::LiveSynced;
                                }

                                // Check if reorder buffer can now be drained
                                Self::drain_reorder_buffer(
                                    &control_ref,
                                    &mut self.ack_rx,
                                    &mut reorder_buffer,
                                    &mut batch_counter,
                                    &session_key,
                                    &peer_id,
                                    &cancel,
                                ).await?;
                            } else {
                                return Err(ack.error_code.unwrap_or_else(|| "Storage commit failed".into()));
                            }
                        } else if local_pts + upd.pts_count > upd.pts {
                            // Old or duplicate update: ignore idempotently
                            continue;
                        } else {
                            // Gap detected! (local_pts + pts_count < upd.pts)
                            let gap_pts = upd.pts;
                            reorder_buffer.insert(upd.pts, upd);

                            {
                                let mut st = control_ref.status.write().await;
                                *st = ChannelSyncStatus::GapGrace;
                            }
                            let _ = control_ref.emit_to_primary(ChannelSyncEvent::GapDetected {
                                sync_id,
                                local_pts,
                                incoming_pts: gap_pts,
                                pts_count: 1,
                            }).await;

                            // 500ms Reorder Grace Timer
                            let grace_deadline = Instant::now() + REORDER_GRACE_DURATION;
                            let mut gap_closed = false;

                            while Instant::now() < grace_deadline {
                                let rem = grace_deadline.saturating_duration_since(Instant::now());
                                tokio::select! {
                                    _ = cancel.cancelled() => return Err("Cancelled during grace".into()),
                                    _ = tokio::time::sleep(rem) => break,
                                    extra_upd = self.update_rx.recv() => {
                                        if let Some(u) = extra_upd {
                                            reorder_buffer.insert(u.pts, u);
                                            // Try draining buffer
                                            let drained = Self::drain_reorder_buffer(
                                                &control_ref,
                                                &mut self.ack_rx,
                                                &mut reorder_buffer,
                                                &mut batch_counter,
                                                &session_key,
                                                &peer_id,
                                                &cancel,
                                            ).await?;
                                            if drained && reorder_buffer.is_empty() {
                                                gap_closed = true;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }

                            if !gap_closed && !reorder_buffer.is_empty() {
                                // Gap still persists: trigger getChannelDifference recovery
                                let outcome = Self::run_difference_recovery(
                                    &control_ref,
                                    &diff_source_ref,
                                    &request_identity,
                                    &peer_id,
                                    &session_key,
                                    &mut self.ack_rx,
                                    &mut batch_counter,
                                    &cancel,
                                ).await?;
                                match outcome {
                                    DifferenceRecoveryOutcome::Synced { next_short_poll_secs } => {
                                        next_short_poll_at = Instant::now()
                                            + Duration::from_secs(next_short_poll_secs.unwrap_or(2).clamp(1, 60) as u64);
                                    }
                                    DifferenceRecoveryOutcome::ReconcileRequired { latest_pts } => {
                                        control_ref.reconcile_target_pts.store(latest_pts, Ordering::Release);
                                        Self::wait_for_reconcile_completion(
                                            &control_ref,
                                            &mut self.update_rx,
                                            &mut reorder_buffer,
                                            &cancel,
                                        ).await?;
                                    }
                                    DifferenceRecoveryOutcome::TerminalFailed(e) => return Err(e),
                                }
                            }
                        }
                    }

                    // Active short polling tick
                    _ = tokio::time::sleep(poll_duration), if is_active => {
                        let outcome = Self::run_difference_recovery(
                            &control_ref,
                            &diff_source_ref,
                            &request_identity,
                            &peer_id,
                            &session_key,
                            &mut self.ack_rx,
                            &mut batch_counter,
                            &cancel,
                        ).await?;
                        match outcome {
                            DifferenceRecoveryOutcome::Synced { next_short_poll_secs } => {
                                next_short_poll_at = Instant::now()
                                    + Duration::from_secs(next_short_poll_secs.unwrap_or(2).clamp(1, 60) as u64);
                            }
                            DifferenceRecoveryOutcome::ReconcileRequired { latest_pts } => {
                                control_ref.reconcile_target_pts.store(latest_pts, Ordering::Release);
                                Self::wait_for_reconcile_completion(
                                    &control_ref,
                                    &mut self.update_rx,
                                    &mut reorder_buffer,
                                    &cancel,
                                ).await?;
                            }
                            DifferenceRecoveryOutcome::TerminalFailed(e) => return Err(e),
                        }
                    }
                }
            }
        }.await;

        // Termination cleanup
        control_ref.expected_batch_id.store(0, Ordering::Release);
        control_ref.terminal_at_ms.store(now_epoch_ms(), Ordering::Release);
        self.router.unregister_channel(parsed_channel_id).await;

        match loop_result {
            Ok(()) => {
                let mut st = control_ref.status.write().await;
                *st = ChannelSyncStatus::Stopped;
            }
            Err(e) => {
                let mut st = control_ref.status.write().await;
                *st = ChannelSyncStatus::Failed;
                let _ = control_ref.emit_to_primary(ChannelSyncEvent::Failed {
                    sync_id,
                    code: "sync_error".into(),
                    message: e,
                    recoverable: true,
                }).await;
            }
        }
    }

    /// Blocks the worker while in ReconcileRequired state, buffering incoming updates
    /// and suspending short polling / difference recovery until the frontend completes authoritative reconcile.
    async fn wait_for_reconcile_completion(
        control: &Arc<ChannelSyncControl>,
        update_rx: &mut mpsc::Receiver<PendingChannelUpdate>,
        reorder_buffer: &mut BTreeMap<i32, PendingChannelUpdate>,
        cancel: &CancellationToken,
    ) -> Result<(), String> {
        loop {
            let current_status = {
                let st = control.status.read().await;
                *st
            };

            if current_status != ChannelSyncStatus::ReconcileRequired {
                let reconciled_pts = control.current_pts.load(Ordering::Acquire);
                reorder_buffer.retain(|pts, _| *pts > reconciled_pts);
                return Ok(());
            }

            tokio::select! {
                _ = cancel.cancelled() => return Err("Cancelled during reconcile barrier".into()),
                _ = control.reconcile_notify.notified() => {
                    let st = control.status.read().await;
                    if *st != ChannelSyncStatus::ReconcileRequired {
                        let reconciled_pts = control.current_pts.load(Ordering::Acquire);
                        reorder_buffer.retain(|pts, _| *pts > reconciled_pts);
                        return Ok(());
                    }
                }
                maybe_upd = update_rx.recv() => {
                    if let Some(upd) = maybe_upd {
                        // Buffer incoming update during reconcile
                        reorder_buffer.insert(upd.pts, upd);
                    } else {
                        return Err("Update channel closed during reconcile".into());
                    }
                }
            }
        }
    }

    /// Waits for a storage ACK from the frontend with bounded reattach awareness.
    async fn wait_for_ack(
        control: &Arc<ChannelSyncControl>,
        ack_rx: &mut mpsc::Receiver<ChannelSyncAck>,
        expected_batch_id: u64,
        cancel: &CancellationToken,
    ) -> Result<ChannelSyncAck, String> {
        loop {
            let is_waiting_frontend = {
                let st = control.status.read().await;
                *st == ChannelSyncStatus::WaitingFrontend
            };

            if is_waiting_frontend {
                tokio::select! {
                    _ = cancel.cancelled() => return Err("Cancelled while waiting for frontend".into()),
                    _ = control.subscriber_notify.notified() => {
                        let mut st = control.status.write().await;
                        *st = ChannelSyncStatus::WaitingAck;
                        continue;
                    }
                    _ = tokio::time::sleep(FRONTEND_REATTACH_TIMEOUT) => {
                        return Err("Frontend reattach timed out".into());
                    }
                }
            } else {
                tokio::select! {
                    _ = cancel.cancelled() => {
                        control.claimed_batch_id.store(0, Ordering::Release);
                        return Err("Cancelled while waiting for storage ACK".into());
                    }
                    _ = tokio::time::sleep(DEFAULT_ACK_TIMEOUT) => {
                        control.claimed_batch_id.store(0, Ordering::Release);
                        return Err(format!("Storage ACK timed out on batch #{}", expected_batch_id));
                    }
                    _ = control.subscriber_notify.notified() => continue,
                    maybe_ack = ack_rx.recv() => {
                        match maybe_ack {
                            Some(a) if a.batch_id == expected_batch_id => {
                                control.last_processed_batch_id.store(expected_batch_id, Ordering::Release);
                                control.claimed_batch_id.store(0, Ordering::Release);
                                control.expected_batch_id.store(0, Ordering::Release);
                                return Ok(a);
                            }
                            Some(_) => {
                                control.claimed_batch_id.store(0, Ordering::Release);
                                return Err("Out of order batch ACK received".into());
                            }
                            None => {
                                control.claimed_batch_id.store(0, Ordering::Release);
                                return Err("ACK channel disconnected".into());
                            }
                        }
                    }
                }
            }
        }
    }

    /// Drains sequential items from the reorder buffer as long as `local_pts + pts_count == item.pts`.
    async fn drain_reorder_buffer(
        control: &Arc<ChannelSyncControl>,
        ack_rx: &mut mpsc::Receiver<ChannelSyncAck>,
        reorder_buffer: &mut BTreeMap<i32, PendingChannelUpdate>,
        batch_counter: &mut u64,
        session_key: &str,
        peer_id: &str,
        cancel: &CancellationToken,
    ) -> Result<bool, String> {
        let mut drained_any = false;

        loop {
            let local_pts = control.current_pts.load(Ordering::Acquire);
            let next_key = reorder_buffer.keys().next().copied();

            let Some(pts) = next_key else { break; };
            let upd = reorder_buffer.get(&pts).unwrap();

            if local_pts + upd.pts_count == upd.pts {
                let upd = reorder_buffer.remove(&pts).unwrap();
                let muts = match upd.update_type {
                    ChannelUpdateType::NewMessage(m) | ChannelUpdateType::EditMessage(m) => vec![m],
                    ChannelUpdateType::DeleteMessages(ids) => vec![MediaMutation::delete(peer_id, ids)],
                    _ => Vec::new(),
                };

                *batch_counter += 1;
                let batch_id = *batch_counter;

                let batch_event = ChannelSyncMutationBatchEvent {
                    sync_id: control.sync_id,
                    batch_id,
                    account_id: session_key.to_string(),
                    peer_id: peer_id.to_string(),
                    previous_pts: local_pts,
                    candidate_pts: upd.pts,
                    source: ChannelMutationSource::Passive,
                    mutations: muts,
                    is_final: true,
                };

                {
                    let mut pb = control.pending_batch.write().await;
                    *pb = Some(PendingMutationBatch {
                        batch_id,
                        event: batch_event.clone(),
                        emitted_at_ms: now_epoch_ms(),
                    });
                }
                control.expected_batch_id.store(batch_id, Ordering::Release);

                let sent_ok = control.emit_to_primary(ChannelSyncEvent::Batch(batch_event)).await;
                if sent_ok {
                    let mut st = control.status.write().await;
                    *st = ChannelSyncStatus::WaitingAck;
                } else {
                    let mut st = control.status.write().await;
                    *st = ChannelSyncStatus::WaitingFrontend;
                }

                let ack = Self::wait_for_ack(control, ack_rx, batch_id, cancel).await?;
                if ack.outcome == ChannelSyncAckOutcome::Committed {
                    control.current_pts.store(upd.pts, Ordering::Release);
                    control.last_processed_batch_id.store(batch_id, Ordering::Release);
                    control.expected_batch_id.store(0, Ordering::Release);
                    {
                        let mut pb = control.pending_batch.write().await;
                        *pb = None;
                    }
                    {
                        let mut st = control.status.write().await;
                        *st = ChannelSyncStatus::LiveSynced;
                    }
                    drained_any = true;
                } else {
                    return Err(ack.error_code.unwrap_or_else(|| "Storage commit failed".into()));
                }
            } else if local_pts >= upd.pts {
                // Stale or duplicate in buffer: remove
                reorder_buffer.remove(&pts);
            } else {
                // Gap still present
                break;
            }
        }

        Ok(drained_any)
    }

    /// Runs a getChannelDifference pagination loop until `final == true` or `TooLong`.
    pub async fn run_difference_recovery(
        control: &Arc<ChannelSyncControl>,
        difference_source: &Arc<dyn ChannelDifferenceSource>,
        identity: &TelegramIdentity,
        peer_id: &str,
        session_key: &str,
        ack_rx: &mut mpsc::Receiver<ChannelSyncAck>,
        batch_counter: &mut u64,
        cancel: &CancellationToken,
    ) -> Result<DifferenceRecoveryOutcome, String> {
        {
            let mut st = control.status.write().await;
            *st = ChannelSyncStatus::RecoveringDifference;
        }
        let _ = control
            .emit_to_primary(ChannelSyncEvent::State {
                sync_id: control.sync_id,
                state: ChannelSyncStatus::RecoveringDifference,
            })
            .await;

        let mut next_poll = None;

        loop {
            if cancel.is_cancelled() {
                return Err("Cancelled during difference recovery".into());
            }

            let local_pts = control.current_pts.load(Ordering::Acquire);
            let diff_res = difference_source
                .get_difference(
                    identity,
                    peer_id,
                    local_pts,
                    100,
                    RpcGuardControl::default(),
                )
                .await
                .map_err(|e| e.to_string())?;

            match diff_res {
                ChannelDifferenceResult::Empty { pts, timeout } => {
                    next_poll = timeout.map(|t| t.max(0) as u32);
                    if pts > local_pts {
                        *batch_counter += 1;
                        let batch_id = *batch_counter;

                        let batch_event = ChannelSyncMutationBatchEvent {
                            sync_id: control.sync_id,
                            batch_id,
                            account_id: session_key.to_string(),
                            peer_id: peer_id.to_string(),
                            previous_pts: local_pts,
                            candidate_pts: pts,
                            source: ChannelMutationSource::DifferenceEmpty,
                            mutations: Vec::new(),
                            is_final: true,
                        };

                        {
                            let mut pb = control.pending_batch.write().await;
                            *pb = Some(PendingMutationBatch {
                                batch_id,
                                event: batch_event.clone(),
                                emitted_at_ms: now_epoch_ms(),
                            });
                        }
                        control.expected_batch_id.store(batch_id, Ordering::Release);

                        let sent = control.emit_to_primary(ChannelSyncEvent::Batch(batch_event)).await;
                        if sent {
                            let mut st = control.status.write().await;
                            *st = ChannelSyncStatus::WaitingAck;
                        } else {
                            let mut st = control.status.write().await;
                            *st = ChannelSyncStatus::WaitingFrontend;
                        }

                        let ack = Self::wait_for_ack(control, ack_rx, batch_id, cancel).await?;
                        if ack.outcome == ChannelSyncAckOutcome::Committed {
                            control.current_pts.store(pts, Ordering::Release);
                            control.last_processed_batch_id.store(batch_id, Ordering::Release);
                            control.expected_batch_id.store(0, Ordering::Release);
                            {
                                let mut pb = control.pending_batch.write().await;
                                *pb = None;
                            }
                            {
                                let mut st = control.status.write().await;
                                *st = ChannelSyncStatus::LiveSynced;
                            }
                        } else {
                            return Err(ack.error_code.unwrap_or_else(|| "Storage commit failed".into()));
                        }
                    } else {
                        let mut st = control.status.write().await;
                        *st = ChannelSyncStatus::LiveSynced;
                    }
                    break;
                }

                ChannelDifferenceResult::Difference {
                    pts,
                    is_final,
                    new_messages,
                    other_mutations,
                    timeout,
                } => {
                    next_poll = timeout.map(|t| t.max(0) as u32);

                    let mut mutations = Vec::new();
                    for m in new_messages {
                        mutations.push(MediaMutation::upsert(peer_id, m.id, m.topic_id, m));
                    }
                    mutations.extend(other_mutations);

                    *batch_counter += 1;
                    let batch_id = *batch_counter;

                    let batch_event = ChannelSyncMutationBatchEvent {
                        sync_id: control.sync_id,
                        batch_id,
                        account_id: session_key.to_string(),
                        peer_id: peer_id.to_string(),
                        previous_pts: local_pts,
                        candidate_pts: pts,
                        source: ChannelMutationSource::Difference,
                        mutations,
                        is_final,
                    };

                    {
                        let mut pb = control.pending_batch.write().await;
                        *pb = Some(PendingMutationBatch {
                            batch_id,
                            event: batch_event.clone(),
                            emitted_at_ms: now_epoch_ms(),
                        });
                    }
                    control.expected_batch_id.store(batch_id, Ordering::Release);

                    let sent = control.emit_to_primary(ChannelSyncEvent::Batch(batch_event)).await;
                    if sent {
                        let mut st = control.status.write().await;
                        *st = ChannelSyncStatus::WaitingAck;
                    } else {
                        let mut st = control.status.write().await;
                        *st = ChannelSyncStatus::WaitingFrontend;
                    }

                    let ack = Self::wait_for_ack(control, ack_rx, batch_id, cancel).await?;
                    if ack.outcome == ChannelSyncAckOutcome::Committed {
                        control.current_pts.store(pts, Ordering::Release);
                        control.last_processed_batch_id.store(batch_id, Ordering::Release);
                        control.expected_batch_id.store(0, Ordering::Release);
                        {
                            let mut pb = control.pending_batch.write().await;
                            *pb = None;
                        }
                        {
                            let mut st = control.status.write().await;
                            *st = ChannelSyncStatus::LiveSynced;
                        }
                    } else {
                        return Err(ack.error_code.unwrap_or_else(|| "Storage commit failed".into()));
                    }

                    if is_final {
                        break;
                    }
                }

                ChannelDifferenceResult::TooLong { latest_pts, timeout: _ } => {
                    control.reconcile_target_pts.store(latest_pts, Ordering::Release);
                    {
                        let mut st = control.status.write().await;
                        *st = ChannelSyncStatus::ReconcileRequired;
                    }
                    let _ = control.emit_to_primary(ChannelSyncEvent::ReconcileRequired {
                        sync_id: control.sync_id,
                        latest_pts,
                        reason: "getChannelDifference returned channelDifferenceTooLong".into(),
                    }).await;
                    return Ok(DifferenceRecoveryOutcome::ReconcileRequired { latest_pts });
                }
            }
        }

        Ok(DifferenceRecoveryOutcome::Synced {
            next_short_poll_secs: next_poll,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    struct MockEventSink;
    impl ChannelSyncEventSink for MockEventSink {
        fn send_event(&self, _event: ChannelSyncEvent) -> bool {
            true
        }
    }

    struct MockDifferenceSource {
        pts: i32,
        difference_pages: Vec<ChannelDifferenceResult>,
        call_count: AtomicUsize,
    }

    #[async_trait]
    impl ChannelDifferenceSource for MockDifferenceSource {
        async fn fetch_pts(
            &self,
            _identity: &TelegramIdentity,
            _chat_id: &str,
            _guard_control: RpcGuardControl,
        ) -> Result<i32, TgError> {
            Ok(self.pts)
        }

        async fn get_difference(
            &self,
            _identity: &TelegramIdentity,
            _chat_id: &str,
            _pts: i32,
            _limit: i32,
            _guard_control: RpcGuardControl,
        ) -> Result<ChannelDifferenceResult, TgError> {
            let idx = self.call_count.fetch_add(1, Ordering::SeqCst);
            if idx < self.difference_pages.len() {
                Ok(self.difference_pages[idx].clone())
            } else {
                Ok(ChannelDifferenceResult::Empty {
                    pts: self.pts,
                    timeout: Some(2),
                })
            }
        }
    }

    #[tokio::test]
    async fn test_drain_reorder_buffer_advances_pts() {
        let (worker_ack_tx, mut worker_ack_rx) = mpsc::channel(32);
        let (state_tx, _) = watch::channel(ChannelSyncDesiredState::Running);
        let cancel = CancellationToken::new();

        let control = Arc::new(ChannelSyncControl {
            sync_id: 1,
            session_key: "test_session".into(),
            client_request_id: "req_1".into(),
            peer_id: "-100123".into(),
            created_at_ms: now_epoch_ms(),
            current_pts: AtomicI32::new(100),
            state_tx,
            cancel: cancel.clone(),
            ack_tx: worker_ack_tx,
            expected_batch_id: AtomicU64::new(0),
            claimed_batch_id: AtomicU64::new(0),
            last_processed_batch_id: AtomicU64::new(0),
            primary_subscriber: RwLock::new(None),
            next_subscriber_id: AtomicU64::new(1),
            subscriber_generation: AtomicU64::new(1),
            subscriber_notify: Arc::new(Notify::new()),
            reconcile_target_pts: AtomicI32::new(0),
            reconcile_notify: Arc::new(Notify::new()),
            pending_batch: RwLock::new(None),
            status: Arc::new(RwLock::new(ChannelSyncStatus::LiveSynced)),
            is_actively_viewed: AtomicBool::new(true),
            terminal_at_ms: AtomicU64::new(0),
        });

        // Attach primary subscriber so emit_to_primary succeeds
        control.attach_primary_and_snapshot(Arc::new(MockEventSink)).await;

        let mut reorder_buffer = BTreeMap::new();
        reorder_buffer.insert(
            101,
            PendingChannelUpdate {
                channel_id: 100123,
                pts: 101,
                pts_count: 1,
                update_type: ChannelUpdateType::DeleteMessages(vec![42]),
            },
        );

        let mut batch_counter = 0;

        let ack_tx_clone = control.ack_tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            let _ = ack_tx_clone.send(ChannelSyncAck {
                sync_id: 1,
                batch_id: 1,
                outcome: ChannelSyncAckOutcome::Committed,
                committed_pts: Some(101),
                error_code: None,
            }).await;
        });

        let drained = ChannelSyncWorker::drain_reorder_buffer(
            &control,
            &mut worker_ack_rx,
            &mut reorder_buffer,
            &mut batch_counter,
            "test_session",
            "-100123",
            &cancel,
        )
        .await
        .unwrap();

        assert!(drained);
        assert_eq!(control.current_pts.load(Ordering::Acquire), 101);
        assert!(reorder_buffer.is_empty());
    }

    #[tokio::test]
    async fn test_difference_recovery_too_long_returns_reconcile_required() {
        let (ack_tx, mut ack_rx) = mpsc::channel(32);
        let (state_tx, _) = watch::channel(ChannelSyncDesiredState::Running);
        let cancel = CancellationToken::new();

        let control = Arc::new(ChannelSyncControl {
            sync_id: 1,
            session_key: "test_session".into(),
            client_request_id: "req_1".into(),
            peer_id: "-100123".into(),
            created_at_ms: now_epoch_ms(),
            current_pts: AtomicI32::new(100),
            state_tx,
            cancel: cancel.clone(),
            ack_tx: ack_tx.clone(),
            expected_batch_id: AtomicU64::new(0),
            claimed_batch_id: AtomicU64::new(0),
            last_processed_batch_id: AtomicU64::new(0),
            primary_subscriber: RwLock::new(None),
            next_subscriber_id: AtomicU64::new(1),
            subscriber_generation: AtomicU64::new(1),
            subscriber_notify: Arc::new(Notify::new()),
            reconcile_target_pts: AtomicI32::new(0),
            reconcile_notify: Arc::new(Notify::new()),
            pending_batch: RwLock::new(None),
            status: Arc::new(RwLock::new(ChannelSyncStatus::RecoveringDifference)),
            is_actively_viewed: AtomicBool::new(true),
            terminal_at_ms: AtomicU64::new(0),
        });

        let mock_source: Arc<dyn ChannelDifferenceSource> = Arc::new(MockDifferenceSource {
            pts: 200,
            difference_pages: vec![ChannelDifferenceResult::TooLong {
                latest_pts: 200,
                timeout: Some(5),
            }],
            call_count: AtomicUsize::new(0),
        });

        let mut batch_counter = 0;
        let outcome = ChannelSyncWorker::run_difference_recovery(
            &control,
            &mock_source,
            &TelegramIdentity {
                session: "test".into(),
                api_id: 123,
                api_hash: "abc".into(),
            },
            "-100123",
            "test_session",
            &mut ack_rx,
            &mut batch_counter,
            &cancel,
        )
        .await
        .unwrap();

        assert_eq!(outcome, DifferenceRecoveryOutcome::ReconcileRequired { latest_pts: 200 });
        let st = *control.status.read().await;
        assert_eq!(st, ChannelSyncStatus::ReconcileRequired);
        assert_eq!(control.reconcile_target_pts.load(Ordering::Acquire), 200);
    }

    #[tokio::test]
    async fn test_reconcile_barrier_buffers_updates_and_wakes_on_completion() {
        let (ack_tx, _) = mpsc::channel(32);
        let (update_tx, mut update_rx) = mpsc::channel(32);
        let (state_tx, _) = watch::channel(ChannelSyncDesiredState::Running);
        let cancel = CancellationToken::new();

        let control = Arc::new(ChannelSyncControl {
            sync_id: 10,
            session_key: "sess".into(),
            client_request_id: "req_10".into(),
            peer_id: "-100123".into(),
            created_at_ms: now_epoch_ms(),
            current_pts: AtomicI32::new(100),
            state_tx,
            cancel: cancel.clone(),
            ack_tx,
            expected_batch_id: AtomicU64::new(0),
            claimed_batch_id: AtomicU64::new(0),
            last_processed_batch_id: AtomicU64::new(0),
            primary_subscriber: RwLock::new(None),
            next_subscriber_id: AtomicU64::new(1),
            subscriber_generation: AtomicU64::new(1),
            subscriber_notify: Arc::new(Notify::new()),
            reconcile_target_pts: AtomicI32::new(500),
            reconcile_notify: Arc::new(Notify::new()),
            pending_batch: RwLock::new(None),
            status: Arc::new(RwLock::new(ChannelSyncStatus::ReconcileRequired)),
            is_actively_viewed: AtomicBool::new(true),
            terminal_at_ms: AtomicU64::new(0),
        });

        let mut reorder_buffer = BTreeMap::new();
        let control_clone = control.clone();
        let cancel_clone = cancel.clone();

        // Spawn barrier waiter
        let handle = tokio::spawn(async move {
            ChannelSyncWorker::wait_for_reconcile_completion(
                &control_clone,
                &mut update_rx,
                &mut reorder_buffer,
                &cancel_clone,
            ).await.unwrap();
            reorder_buffer
        });

        // 1. Send an old update (pts 450 <= 500) and a new update (pts 505 > 500) during barrier
        let _ = update_tx.send(PendingChannelUpdate {
            channel_id: 100123,
            pts: 450,
            pts_count: 1,
            update_type: ChannelUpdateType::DeleteMessages(vec![1]),
        }).await;

        let _ = update_tx.send(PendingChannelUpdate {
            channel_id: 100123,
            pts: 505,
            pts_count: 1,
            update_type: ChannelUpdateType::DeleteMessages(vec![2]),
        }).await;

        tokio::time::sleep(Duration::from_millis(50)).await;

        // 2. Complete reconcile with target 500
        let completed = control.complete_reconcile(500).await;
        assert!(completed);

        let final_buf = handle.await.unwrap();
        // Old update 450 was discarded; new update 505 was preserved!
        assert_eq!(final_buf.len(), 1);
        assert!(final_buf.contains_key(&505));
    }

    #[tokio::test]
    async fn test_bootstrap_with_initial_reconcile_barrier_buffers_updates_and_wakes_on_complete() {
        let (ack_tx, ack_rx) = mpsc::channel(32);
        let (update_tx, update_rx) = mpsc::channel(32);
        let (state_tx, _) = watch::channel(ChannelSyncDesiredState::Running);
        let cancel = CancellationToken::new();

        let control = Arc::new(ChannelSyncControl {
            sync_id: 101,
            session_key: "test_session".into(),
            client_request_id: "req_101".into(),
            peer_id: "-100123".into(),
            created_at_ms: now_epoch_ms(),
            current_pts: AtomicI32::new(0),
            state_tx,
            cancel: cancel.clone(),
            ack_tx: ack_tx.clone(),
            expected_batch_id: AtomicU64::new(0),
            claimed_batch_id: AtomicU64::new(0),
            last_processed_batch_id: AtomicU64::new(0),
            primary_subscriber: RwLock::new(None),
            next_subscriber_id: AtomicU64::new(1),
            subscriber_generation: AtomicU64::new(1),
            subscriber_notify: Arc::new(Notify::new()),
            reconcile_target_pts: AtomicI32::new(0),
            reconcile_notify: Arc::new(Notify::new()),
            pending_batch: RwLock::new(None),
            status: Arc::new(RwLock::new(ChannelSyncStatus::Preparing)),
            is_actively_viewed: AtomicBool::new(true),
            terminal_at_ms: AtomicU64::new(0),
        });

        // Attach primary subscriber
        control.attach_primary_and_snapshot(Arc::new(MockEventSink)).await;

        let mock_source: Arc<dyn ChannelDifferenceSource> = Arc::new(MockDifferenceSource {
            pts: 1000,
            difference_pages: vec![],
            call_count: AtomicUsize::new(0),
        });

        let identity = TelegramIdentity {
            session: "test_session".into(),
            api_id: 123,
            api_hash: "abc".into(),
        };
        let router = Arc::new(SessionUpdateRouter::new(PathBuf::from("sessions"), identity.clone()));

        let worker = ChannelSyncWorker {
            sync_id: 101,
            request: StartChannelSyncRequest {
                client_request_id: "req_101".into(),
                identity: identity.clone(),
                peer_id: "-100123".into(),
                initial_pts: None,
                is_actively_viewed: Some(true),
                requires_initial_reconcile: Some(true),
            },
            control: control.clone(),
            difference_source: mock_source,
            router,
            ack_rx,
            update_rx,
            mailbox_overflowed: Arc::new(AtomicBool::new(false)),
        };

        // Handle bootstrap ACK
        let ack_tx_clone = control.ack_tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            let _ = ack_tx_clone.send(ChannelSyncAck {
                sync_id: 101,
                batch_id: 1,
                outcome: ChannelSyncAckOutcome::Committed,
                committed_pts: Some(1000),
                error_code: None,
            }).await;
        });

        // Spawn worker
        let cancel_clone = cancel.clone();
        let worker_handle = tokio::spawn(async move {
            worker.run().await;
        });

        // Wait until worker enters ReconcileRequired barrier
        tokio::time::sleep(Duration::from_millis(60)).await;
        let st = *control.status.read().await;
        assert_eq!(st, ChannelSyncStatus::ReconcileRequired);
        assert_eq!(control.reconcile_target_pts.load(Ordering::Acquire), 1000);

        // Send a passive update with pts 1001 while in barrier
        let _ = update_tx.send(PendingChannelUpdate {
            channel_id: 100123,
            pts: 1001,
            pts_count: 1,
            update_type: ChannelUpdateType::DeleteMessages(vec![99]),
        }).await;

        tokio::time::sleep(Duration::from_millis(30)).await;

        // Complete reconcile with target 1000
        let completed = control.complete_reconcile(1000).await;
        assert!(completed);

        tokio::time::sleep(Duration::from_millis(60)).await;

        // Clean cancel
        cancel_clone.cancel();
        let _ = worker_handle.await;
    }
}
