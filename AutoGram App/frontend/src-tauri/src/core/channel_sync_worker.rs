//! channel_sync_worker.rs — Long-Running Rust Channel Synchronization Worker (P2.5 Hardened)
//!
//! Maintains Telegram channel PTS sequence, 500ms reorder grace buffer,
//! getChannelDifference pagination, updateChannelTooLong recovery,
//! active-channel short polling, and single-winner atomic ACK backpressure with IndexedDB.

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

fn now_epoch_ms() -> u64 {
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

        let st = *self.status.read().await;
        sink.send_event(ChannelSyncEvent::State {
            sync_id: self.sync_id,
            state: st,
        });

        // Instant Replay of pending unacked batch if any
        let mut replayed_id = None;
        let pending = {
            let pb = self.pending_batch.read().await;
            pb.clone()
        };

        if let Some(p) = pending {
            replayed_id = Some(p.batch_id);
            sink.send_event(ChannelSyncEvent::Batch(p.event));
        }

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
                return true;
            }
        }
        false
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
            {
                let mut st = self.control.status.write().await;
                *st = ChannelSyncStatus::Bootstrapping;
            }
            let _ = self.control.emit_to_primary(ChannelSyncEvent::State {
                sync_id,
                state: ChannelSyncStatus::Bootstrapping,
            }).await;

            let guard_ctrl = RpcGuardControl {
                cancel: Some(cancel.clone()),
                observer: None,
            };

            let fetched_pts = match self.difference_source.fetch_pts(&self.request.identity, &peer_id, guard_ctrl).await {
                Ok(pts) => pts,
                Err(e) => {
                    {
                        let mut st = self.control.status.write().await;
                        *st = ChannelSyncStatus::Failed;
                    }
                    let _ = self.control.emit_to_primary(ChannelSyncEvent::Failed {
                        sync_id,
                        code: format!("{:?}", e.code()),
                        message: e.to_string(),
                        recoverable: e.retryable(),
                    }).await;
                    self.router.unregister_channel(parsed_channel_id).await;
                    return;
                }
            };

            // Emit Bootstrap Batch with empty mutations and candidate PTS to persist durable state
            batch_counter += 1;
            let batch_id = batch_counter;
            let bootstrap_batch = ChannelSyncMutationBatchEvent {
                sync_id,
                batch_id,
                account_id: session_key.clone(),
                peer_id: peer_id.clone(),
                previous_pts: 0,
                candidate_pts: fetched_pts,
                source: ChannelMutationSource::Bootstrap,
                mutations: Vec::new(),
                is_final: true,
            };

            {
                let mut pb = self.control.pending_batch.write().await;
                *pb = Some(PendingMutationBatch {
                    batch_id,
                    event: bootstrap_batch.clone(),
                    emitted_at_ms: now_epoch_ms(),
                });
            }
            self.control.expected_batch_id.store(batch_id, Ordering::Release);

            let sent_ok = self.control.emit_to_primary(ChannelSyncEvent::Batch(bootstrap_batch)).await;
            if sent_ok {
                let mut st = self.control.status.write().await;
                *st = ChannelSyncStatus::WaitingAck;
            } else {
                let mut st = self.control.status.write().await;
                *st = ChannelSyncStatus::WaitingFrontend;
            }

            let ack = Self::wait_for_ack(&self.control, &mut self.ack_rx, batch_id, &cancel).await;
            match ack {
                Ok(a) if a.outcome == ChannelSyncAckOutcome::Committed => {
                    self.control.current_pts.store(fetched_pts, Ordering::Release);
                    self.control.last_processed_batch_id.store(batch_id, Ordering::Release);
                    self.control.expected_batch_id.store(0, Ordering::Release);
                    {
                        let mut pb = self.control.pending_batch.write().await;
                        *pb = None;
                    }
                    fetched_pts
                }
                Ok(a) => {
                    let err_msg = a.error_code.unwrap_or_else(|| "Bootstrap storage ACK failed".into());
                    {
                        let mut st = self.control.status.write().await;
                        *st = ChannelSyncStatus::Failed;
                    }
                    let _ = self.control.emit_to_primary(ChannelSyncEvent::Failed {
                        sync_id,
                        code: "bootstrap_storage_error".into(),
                        message: err_msg,
                        recoverable: true,
                    }).await;
                    self.router.unregister_channel(parsed_channel_id).await;
                    return;
                }
                Err(e) => {
                    {
                        let mut st = self.control.status.write().await;
                        *st = ChannelSyncStatus::Failed;
                    }
                    let _ = self.control.emit_to_primary(ChannelSyncEvent::Failed {
                        sync_id,
                        code: "bootstrap_ack_error".into(),
                        message: e,
                        recoverable: true,
                    }).await;
                    self.router.unregister_channel(parsed_channel_id).await;
                    return;
                }
            }
        };

        {
            let mut st = self.control.status.write().await;
            *st = ChannelSyncStatus::LiveSynced;
        }
        let _ = self.control.emit_to_primary(ChannelSyncEvent::State {
            sync_id,
            state: ChannelSyncStatus::LiveSynced,
        }).await;

        let control_ref = self.control.clone();
        let diff_source_ref = self.difference_source.clone();
        let request_identity = self.request.identity.clone();

        let mut next_short_poll_at = Instant::now() + DEFAULT_SHORT_POLL_TIMEOUT;

        // 2. Main Event & Sequencing Loop
        let loop_result: Result<(), String> = async {
            loop {
                // Cooperative Pause Check
                if *state_rx.borrow() == ChannelSyncDesiredState::Paused {
                    {
                        let mut st = control_ref.status.write().await;
                        *st = ChannelSyncStatus::Paused;
                    }
                    let _ = control_ref.emit_to_primary(ChannelSyncEvent::State {
                        sync_id,
                        state: ChannelSyncStatus::Paused,
                    }).await;

                    while *state_rx.borrow() == ChannelSyncDesiredState::Paused {
                        tokio::select! {
                            _ = cancel.cancelled() => return Err("Cancelled while paused".into()),
                            res = state_rx.changed() => {
                                if res.is_err() { break; }
                            }
                        }
                    }

                    {
                        let mut st = control_ref.status.write().await;
                        *st = ChannelSyncStatus::LiveSynced;
                    }
                    let _ = control_ref.emit_to_primary(ChannelSyncEvent::State {
                        sync_id,
                        state: ChannelSyncStatus::LiveSynced,
                    }).await;
                }

                if cancel.is_cancelled() {
                    return Err("Cancelled".into());
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
                        DifferenceRecoveryOutcome::ReconcileRequired { .. } => {}
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

                        // Handle updateChannelTooLong explicitly
                        if let ChannelUpdateType::ChannelTooLong { pts } = upd.update_type {
                            let candidate = pts.unwrap_or(local_pts);
                            {
                                let mut st = control_ref.status.write().await;
                                *st = ChannelSyncStatus::ReconcileRequired;
                            }
                            let _ = control_ref.emit_to_primary(ChannelSyncEvent::ReconcileRequired {
                                sync_id,
                                latest_pts: candidate,
                                reason: "updateChannelTooLong received from server".into(),
                            }).await;
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
                                    DifferenceRecoveryOutcome::ReconcileRequired { .. } => {}
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
                            DifferenceRecoveryOutcome::ReconcileRequired { .. } => {}
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
                    _ = cancel.cancelled() => return Err("Cancelled while waiting for storage ACK".into()),
                    _ = tokio::time::sleep(DEFAULT_ACK_TIMEOUT) => {
                        return Err(format!("Storage ACK timed out on batch #{}", expected_batch_id));
                    }
                    _ = control.subscriber_notify.notified() => continue,
                    maybe_ack = ack_rx.recv() => {
                        match maybe_ack {
                            Some(a) if a.batch_id == expected_batch_id => return Ok(a),
                            Some(_) => return Err("Out of order batch ACK received".into()),
                            None => return Err("ACK channel disconnected".into()),
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

                control.emit_to_primary(ChannelSyncEvent::Batch(batch_event)).await;

                let ack = Self::wait_for_ack(control, ack_rx, batch_id, cancel).await?;
                if ack.outcome == ChannelSyncAckOutcome::Committed {
                    control.current_pts.store(upd.pts, Ordering::Release);
                    control.last_processed_batch_id.store(batch_id, Ordering::Release);
                    control.expected_batch_id.store(0, Ordering::Release);
                    {
                        let mut pb = control.pending_batch.write().await;
                        *pb = None;
                    }
                    drained_any = true;
                } else {
                    return Err(ack.error_code.unwrap_or_else(|| "Drain storage commit failed".into()));
                }
            } else if local_pts + upd.pts_count > upd.pts {
                reorder_buffer.remove(&pts);
            } else {
                break;
            }
        }

        Ok(drained_any)
    }

    /// Executes `updates.getChannelDifference` pagination loop until final or TooLong.
    async fn run_difference_recovery(
        control: &Arc<ChannelSyncControl>,
        diff_source: &Arc<dyn ChannelDifferenceSource>,
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
        let _ = control.emit_to_primary(ChannelSyncEvent::State {
            sync_id: control.sync_id,
            state: ChannelSyncStatus::RecoveringDifference,
        }).await;

        let guard_ctrl = RpcGuardControl {
            cancel: Some(cancel.clone()),
            observer: None,
        };

        let mut final_timeout_secs = None;

        loop {
            let current_pts = control.current_pts.load(Ordering::Acquire);

            let page_res = diff_source.get_difference(
                identity,
                peer_id,
                current_pts,
                100,
                guard_ctrl.clone(),
            ).await;

            let diff = match page_res {
                Ok(d) => d,
                Err(e) => {
                    return Err(format!("getChannelDifference RPC error: {}", e));
                }
            };

            match diff {
                ChannelDifferenceResult::Empty { pts, timeout } => {
                    if let Some(t) = timeout {
                        final_timeout_secs = Some(t as u32);
                    }

                    *batch_counter += 1;
                    let batch_id = *batch_counter;

                    let batch_event = ChannelSyncMutationBatchEvent {
                        sync_id: control.sync_id,
                        batch_id,
                        account_id: session_key.to_string(),
                        peer_id: peer_id.to_string(),
                        previous_pts: current_pts,
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

                    control.emit_to_primary(ChannelSyncEvent::Batch(batch_event)).await;

                    let ack = Self::wait_for_ack(control, ack_rx, batch_id, cancel).await?;
                    if ack.outcome == ChannelSyncAckOutcome::Committed {
                        control.current_pts.store(pts, Ordering::Release);
                        control.last_processed_batch_id.store(batch_id, Ordering::Release);
                        control.expected_batch_id.store(0, Ordering::Release);
                        {
                            let mut pb = control.pending_batch.write().await;
                            *pb = None;
                        }
                    }
                    break;
                }

                ChannelDifferenceResult::Difference { pts, is_final, new_messages, other_mutations, timeout } => {
                    if let Some(t) = timeout {
                        final_timeout_secs = Some(t as u32);
                    }

                    let mut muts = other_mutations;
                    for row in new_messages {
                        let mid = row.id;
                        let tid = row.topic_id;
                        muts.push(MediaMutation::upsert(peer_id, mid, tid, row));
                    }

                    *batch_counter += 1;
                    let batch_id = *batch_counter;

                    let batch_event = ChannelSyncMutationBatchEvent {
                        sync_id: control.sync_id,
                        batch_id,
                        account_id: session_key.to_string(),
                        peer_id: peer_id.to_string(),
                        previous_pts: current_pts,
                        candidate_pts: pts,
                        source: ChannelMutationSource::Difference,
                        mutations: muts,
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

                    control.emit_to_primary(ChannelSyncEvent::Batch(batch_event)).await;

                    let ack = Self::wait_for_ack(control, ack_rx, batch_id, cancel).await?;
                    if ack.outcome == ChannelSyncAckOutcome::Committed {
                        control.current_pts.store(pts, Ordering::Release);
                        control.last_processed_batch_id.store(batch_id, Ordering::Release);
                        control.expected_batch_id.store(0, Ordering::Release);
                        {
                            let mut pb = control.pending_batch.write().await;
                            *pb = None;
                        }
                    } else {
                        return Err(ack.error_code.unwrap_or_else(|| "Difference page commit failed".into()));
                    }

                    if is_final {
                        break;
                    }
                }

                ChannelDifferenceResult::TooLong { latest_pts, .. } => {
                    {
                        let mut st = control.status.write().await;
                        *st = ChannelSyncStatus::ReconcileRequired;
                    }
                    let _ = control.emit_to_primary(ChannelSyncEvent::ReconcileRequired {
                        sync_id: control.sync_id,
                        latest_pts,
                        reason: "channelDifferenceTooLong received from server".into(),
                    }).await;

                    // Stop loop immediately without emitting LiveSynced
                    return Ok(DifferenceRecoveryOutcome::ReconcileRequired { latest_pts });
                }
            }
        }

        {
            let mut st = control.status.write().await;
            if *st == ChannelSyncStatus::RecoveringDifference {
                *st = ChannelSyncStatus::LiveSynced;
            }
        }
        let _ = control.emit_to_primary(ChannelSyncEvent::State {
            sync_id: control.sync_id,
            state: ChannelSyncStatus::LiveSynced,
        }).await;

        Ok(DifferenceRecoveryOutcome::Synced {
            next_short_poll_secs: final_timeout_secs,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

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
        let (ack_tx, mut ack_rx) = mpsc::channel(1);
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
            pending_batch: RwLock::new(None),
            status: Arc::new(RwLock::new(ChannelSyncStatus::LiveSynced)),
            is_actively_viewed: AtomicBool::new(true),
            terminal_at_ms: AtomicU64::new(0),
        });

        let mut reorder_buffer = BTreeMap::new();
        // Insert update for pts 101
        reorder_buffer.insert(
            101,
            PendingChannelUpdate {
                channel_id: -100123,
                pts: 101,
                pts_count: 1,
                update_type: ChannelUpdateType::DeleteMessages(vec![10]),
            },
        );

        // Spawn mock ACK responder
        let ack_tx_clone = ack_tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            let _ = ack_tx_clone.send(ChannelSyncAck {
                sync_id: 1,
                batch_id: 1,
                outcome: ChannelSyncAckOutcome::Committed,
                committed_pts: Some(101),
                error_code: None,
            }).await;
        });

        let mut batch_counter = 0;
        let drained = ChannelSyncWorker::drain_reorder_buffer(
            &control,
            &mut ack_rx,
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
    async fn test_difference_recovery_empty_advances_pts() {
        let (ack_tx, mut ack_rx) = mpsc::channel(1);
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
            pending_batch: RwLock::new(None),
            status: Arc::new(RwLock::new(ChannelSyncStatus::RecoveringDifference)),
            is_actively_viewed: AtomicBool::new(true),
            terminal_at_ms: AtomicU64::new(0),
        });

        let mock_source: Arc<dyn ChannelDifferenceSource> = Arc::new(MockDifferenceSource {
            pts: 105,
            difference_pages: vec![ChannelDifferenceResult::Empty {
                pts: 105,
                timeout: Some(2),
            }],
            call_count: AtomicUsize::new(0),
        });

        // Spawn mock ACK responder
        let ack_tx_clone = ack_tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            let _ = ack_tx_clone.send(ChannelSyncAck {
                sync_id: 1,
                batch_id: 1,
                outcome: ChannelSyncAckOutcome::Committed,
                committed_pts: Some(105),
                error_code: None,
            }).await;
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

        assert_eq!(outcome, DifferenceRecoveryOutcome::Synced { next_short_poll_secs: Some(2) });
        assert_eq!(control.current_pts.load(Ordering::Acquire), 105);
    }

    #[tokio::test]
    async fn test_difference_recovery_too_long_returns_reconcile_required() {
        let (ack_tx, mut ack_rx) = mpsc::channel(1);
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
    }
}
