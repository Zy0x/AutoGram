//! channel_sync_manager.rs — Thread-Safe Manager for Telegram Channel Synchronization (P2.5 Hardened)
//!
//! Enforces single-worker per (accountId, peerId) atomic scope reservation, client request idempotency,
//! exact single-winner storage ACK backpressure claim validation, terminal worker TTL pruning,
//! and complete authoritative reconciliation handshakes.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::{mpsc, watch, Notify, RwLock};
use tokio_util::sync::CancellationToken;

use super::channel_sync_types::*;
use super::channel_sync_worker::{
    ChannelDifferenceSource, ChannelSyncControl, ChannelSyncDesiredState,
    ChannelSyncEventSink, ChannelSyncWorker, GrammersChannelDifferenceSource,
    PendingMutationBatch, now_epoch_ms,
};
use super::session_update_router::SessionUpdateRouterManager;
use super::tg_error::{TgErrorCode, TgErrorPublic};

struct ChannelSyncManagerInner {
    workers: HashMap<u64, Arc<ChannelSyncControl>>,
    active_channel_syncs: HashMap<String, u64>,
    client_request_map: HashMap<String, u64>,
}

impl ChannelSyncManagerInner {
    pub fn prune_terminal_workers(&mut self, now_ms: u64, ttl_ms: u64) {
        let mut to_remove = Vec::new();
        for (sync_id, control) in self.workers.iter() {
            let term_at = control.terminal_at_ms.load(Ordering::Acquire);
            if term_at > 0 && now_ms.saturating_sub(term_at) >= ttl_ms {
                to_remove.push(*sync_id);
            }
        }

        for sync_id in to_remove {
            self.workers.remove(&sync_id);
            self.active_channel_syncs.retain(|_, id| *id != sync_id);
            self.client_request_map.retain(|_, id| *id != sync_id);
        }
    }
}

/// Global thread-safe manager for all active ChannelSyncWorker instances in Tauri application state.
pub struct ChannelSyncManager {
    inner: Arc<RwLock<ChannelSyncManagerInner>>,
    pub router_manager: Arc<SessionUpdateRouterManager>,
    pub sessions_dir: PathBuf,
    pub difference_source: Arc<dyn ChannelDifferenceSource>,
    pub next_sync_id: AtomicU64,
}

impl Default for ChannelSyncManager {
    fn default() -> Self {
        Self::new(PathBuf::from("sessions"))
    }
}

impl ChannelSyncManager {
    pub fn new(sessions_dir: PathBuf) -> Self {
        let diff_source = Arc::new(GrammersChannelDifferenceSource {
            sessions_dir: sessions_dir.clone(),
        });
        Self::with_difference_source(sessions_dir, diff_source)
    }

    pub fn with_difference_source(
        sessions_dir: PathBuf,
        difference_source: Arc<dyn ChannelDifferenceSource>,
    ) -> Self {
        Self {
            inner: Arc::new(RwLock::new(ChannelSyncManagerInner {
                workers: HashMap::new(),
                active_channel_syncs: HashMap::new(),
                client_request_map: HashMap::new(),
            })),
            router_manager: Arc::new(SessionUpdateRouterManager::new()),
            sessions_dir,
            difference_source,
            next_sync_id: AtomicU64::new(1),
        }
    }

    /// Starts a new or reattaches to an existing active ChannelSyncWorker for (accountId, peerId) atomically.
    pub async fn start_sync<S>(
        &self,
        request: StartChannelSyncRequest,
        event_sink: S,
    ) -> Result<StartChannelSyncResponse, TgErrorPublic>
    where
        S: ChannelSyncEventSink + 'static,
    {
        if request.identity.session.trim().is_empty() {
            return Err(TgErrorPublic {
                code: TgErrorCode::SessionMissing,
                message: "Telegram session is required".into(),
                flood_wait_secs: None,
                rpc_name: None,
                retryable: false,
            });
        }

        let session_key = request.identity.session.clone();
        let peer_id = request.peer_id.trim().to_string();
        let parsed_channel_id: i64 = peer_id.parse().unwrap_or(0);
        let scope_key = format!("{}:{}", session_key, peer_id);
        let client_req_id = request.client_request_id.clone();

        let sink_arc: Arc<dyn ChannelSyncEventSink> = Arc::new(event_sink);

        let (control, sync_id, ack_rx, state_tx) = {
            let mut inner = self.inner.write().await;
            inner.prune_terminal_workers(now_epoch_ms(), 300_000);

            // 1. Client Request Idempotency Check
            if let Some(&existing_sync_id) = inner.client_request_map.get(&client_req_id) {
                if let Some(ctrl) = inner.workers.get(&existing_sync_id) {
                    let term_at = ctrl.terminal_at_ms.load(Ordering::Acquire);
                    if term_at == 0 {
                        let ctrl_clone = ctrl.clone();
                        drop(inner);

                        let snapshot = ctrl_clone.attach_primary_and_snapshot(sink_arc).await;
                        if let Some(is_viewed) = request.is_actively_viewed {
                            ctrl_clone.is_actively_viewed.store(is_viewed, Ordering::Release);
                        }

                        return Ok(StartChannelSyncResponse {
                            sync_id: existing_sync_id,
                            state: snapshot.state,
                            reused_existing_sync: true,
                            subscriber_id: snapshot.subscriber_id,
                            generation: snapshot.generation,
                            current_pts: snapshot.current_pts,
                            reconcile_target_pts: snapshot.reconcile_target_pts,
                        });
                    }
                }
            }

            // 2. Active Channel Scope Check (Single Active Worker per Session + Peer)
            if let Some(&existing_id) = inner.active_channel_syncs.get(&scope_key) {
                if let Some(ctrl) = inner.workers.get(&existing_id) {
                    let term_at = ctrl.terminal_at_ms.load(Ordering::Acquire);
                    if term_at == 0 {
                        let ctrl_clone = ctrl.clone();
                        drop(inner);

                        let snapshot = ctrl_clone.attach_primary_and_snapshot(sink_arc).await;
                        if let Some(is_viewed) = request.is_actively_viewed {
                            ctrl_clone.is_actively_viewed.store(is_viewed, Ordering::Release);
                        }

                        return Ok(StartChannelSyncResponse {
                            sync_id: existing_id,
                            state: snapshot.state,
                            reused_existing_sync: true,
                            subscriber_id: snapshot.subscriber_id,
                            generation: snapshot.generation,
                            current_pts: snapshot.current_pts,
                            reconcile_target_pts: snapshot.reconcile_target_pts,
                        });
                    }
                }
            }

            // 3. Launch New Authoritative ChannelSyncWorker with Atomic Scope Reservation
            let sync_id = self.next_sync_id.fetch_add(1, Ordering::SeqCst);
            let (ack_tx, ack_rx) = mpsc::channel(1);
            let (state_tx, _) = watch::channel(ChannelSyncDesiredState::Running);

            let is_viewed_init = request.is_actively_viewed.unwrap_or(true);
            let current_pts_init = request.initial_pts.unwrap_or(0);

            let control = Arc::new(ChannelSyncControl {
                sync_id,
                session_key: session_key.clone(),
                client_request_id: client_req_id.clone(),
                peer_id: peer_id.clone(),
                created_at_ms: now_epoch_ms(),
                cancel: CancellationToken::new(),
                state_tx: state_tx.clone(),
                ack_tx,
                current_pts: AtomicI32::new(current_pts_init),
                expected_batch_id: AtomicU64::new(0),
                claimed_batch_id: AtomicU64::new(0),
                last_processed_batch_id: AtomicU64::new(0),
                primary_subscriber: RwLock::new(None),
                next_subscriber_id: AtomicU64::new(1),
                subscriber_generation: AtomicU64::new(0),
                subscriber_notify: Arc::new(Notify::new()),
                reconcile_target_pts: AtomicI32::new(0),
                reconcile_notify: Arc::new(Notify::new()),
                pending_batch: RwLock::new(None),
                status: Arc::new(RwLock::new(ChannelSyncStatus::Preparing)),
                is_actively_viewed: AtomicBool::new(is_viewed_init),
                terminal_at_ms: AtomicU64::new(0),
            });

            // Reserve scope & request map under write lock and drop lock immediately
            inner.workers.insert(sync_id, control.clone());
            inner.active_channel_syncs.insert(scope_key.clone(), sync_id);
            inner.client_request_map.insert(client_req_id.clone(), sync_id);

            (control, sync_id, ack_rx, state_tx)
        };

        // Long asynchronous operations executed outside manager inner write lock:
        let router = self
            .router_manager
            .get_or_create(self.sessions_dir.clone(), &request.identity)
            .await;

        let (update_rx, mailbox_overflowed) = router.register_channel(parsed_channel_id).await;

        let inner_arc = self.inner.clone();
        let scope_key_clone = scope_key.clone();
        let req_id_clone = client_req_id.clone();

        // Attach initial primary subscriber
        let snapshot = control.attach_primary_and_snapshot(sink_arc).await;

        let worker = ChannelSyncWorker {
            sync_id,
            request,
            control: control.clone(),
            difference_source: self.difference_source.clone(),
            router: router.clone(),
            ack_rx,
            update_rx,
            mailbox_overflowed,
        };

        tokio::spawn(async move {
            worker.run().await;
            let mut guard = inner_arc.write().await;
            guard.active_channel_syncs.remove(&scope_key_clone);
            guard.client_request_map.remove(&req_id_clone);
        });

        Ok(StartChannelSyncResponse {
            sync_id,
            state: snapshot.state,
            reused_existing_sync: false,
            subscriber_id: snapshot.subscriber_id,
            generation: snapshot.generation,
            current_pts: snapshot.current_pts,
            reconcile_target_pts: snapshot.reconcile_target_pts,
        })
    }

    /// Attaches a replacement primary persistence subscriber to an active worker.
    pub async fn attach_channel<S>(
        &self,
        sync_id: u64,
        event_sink: S,
    ) -> Result<AttachChannelSyncResponse, TgErrorPublic>
    where
        S: ChannelSyncEventSink + 'static,
    {
        let worker = {
            let inner = self.inner.read().await;
            inner.workers.get(&sync_id).cloned()
        };

        let Some(control) = worker else {
            return Err(TgErrorPublic {
                code: TgErrorCode::PeerNotFound,
                message: format!("ChannelSync #{} not found or terminal", sync_id),
                flood_wait_secs: None,
                rpc_name: None,
                retryable: false,
            });
        };

        let term_at = control.terminal_at_ms.load(Ordering::Acquire);
        if term_at > 0 {
            return Err(TgErrorPublic {
                code: TgErrorCode::PeerNotFound,
                message: format!("ChannelSync #{} is terminal", sync_id),
                flood_wait_secs: None,
                rpc_name: None,
                retryable: false,
            });
        }

        let snapshot = control
            .attach_primary_and_snapshot(Arc::new(event_sink))
            .await;

        Ok(AttachChannelSyncResponse {
            sync_id,
            attached: true,
            subscriber_id: snapshot.subscriber_id,
            generation: snapshot.generation,
            state: snapshot.state,
            current_pts: snapshot.current_pts,
            replayed_batch_id: snapshot.replayed_batch_id,
            reconcile_target_pts: snapshot.reconcile_target_pts,
        })
    }

    /// Explicitly detaches a persistence subscriber from an active worker.
    pub async fn detach_channel(
        &self,
        sync_id: u64,
        subscriber_id: u64,
        generation: u64,
    ) -> DetachChannelSyncResponse {
        let worker = {
            let inner = self.inner.read().await;
            inner.workers.get(&sync_id).cloned()
        };

        let Some(control) = worker else {
            return DetachChannelSyncResponse {
                sync_id,
                detached: false,
            };
        };

        let detached = control.detach_primary(subscriber_id, generation).await;
        DetachChannelSyncResponse {
            sync_id,
            detached,
        }
    }

    /// Processes an incoming storage ACK with exact single-winner atomic claim validation (P3.2 gold standard).
    pub async fn process_ack(&self, ack: ChannelSyncAck) -> ChannelSyncAckResult {
        let worker = {
            let inner = self.inner.read().await;
            inner.workers.get(&ack.sync_id).cloned()
        };

        let Some(control) = worker else {
            return ChannelSyncAckResult::SyncTerminal;
        };

        let processed = control.last_processed_batch_id.load(Ordering::Acquire);
        if ack.batch_id == processed && processed != 0 {
            return ChannelSyncAckResult::AlreadyAcked;
        }
        if ack.batch_id < processed {
            return ChannelSyncAckResult::Stale;
        }

        let expected = control.expected_batch_id.load(Ordering::Acquire);
        if expected == 0 {
            let claimed = control.claimed_batch_id.load(Ordering::Acquire);
            if ack.batch_id == claimed && claimed != 0 {
                return ChannelSyncAckResult::AlreadyAcked;
            }
            return ChannelSyncAckResult::SyncTerminal;
        }

        if ack.batch_id < expected {
            return ChannelSyncAckResult::Stale;
        }
        if ack.batch_id > expected {
            return ChannelSyncAckResult::Unexpected;
        }

        // Exact match with expected batch: single-winner atomic claim
        let claimed = control.claimed_batch_id.load(Ordering::Acquire);
        if claimed == ack.batch_id {
            return ChannelSyncAckResult::AlreadyAcked;
        }
        if claimed > ack.batch_id {
            return ChannelSyncAckResult::Stale;
        }

        match control.claimed_batch_id.compare_exchange(
            claimed,
            ack.batch_id,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => {
                // Winning claim! Send to ACK channel
                match control.ack_tx.send(ack).await {
                    Ok(()) => ChannelSyncAckResult::Accepted,
                    Err(_) => {
                        control.claimed_batch_id.store(0, Ordering::Release);
                        ChannelSyncAckResult::SyncTerminal
                    }
                }
            }
            Err(actual) if actual == ack.batch_id => ChannelSyncAckResult::AlreadyAcked,
            Err(actual) if actual > ack.batch_id => ChannelSyncAckResult::Stale,
            Err(_) => {
                let cur = control.claimed_batch_id.load(Ordering::Acquire);
                if cur == ack.batch_id {
                    ChannelSyncAckResult::AlreadyAcked
                } else if cur > ack.batch_id {
                    ChannelSyncAckResult::Stale
                } else {
                    ChannelSyncAckResult::Unexpected
                }
            }
        }
    }

    /// Completes authoritative reconciliation for an active ChannelSyncWorker and advances current PTS.
    pub async fn complete_reconcile(&self, sync_id: u64, latest_pts: i32) -> bool {
        let worker = {
            let inner = self.inner.read().await;
            inner.workers.get(&sync_id).cloned()
        };
        if let Some(control) = worker {
            control.complete_reconcile(latest_pts).await
        } else {
            false
        }
    }

    /// Sets foreground/background active-view state for a channel sync.
    pub async fn set_active_view(&self, sync_id: u64, is_active: bool) {
        let worker = {
            let inner = self.inner.read().await;
            inner.workers.get(&sync_id).cloned()
        };
        if let Some(w) = worker {
            w.is_actively_viewed.store(is_active, Ordering::Release);
        }
    }

    /// Pauses an active channel synchronization stream.
    pub async fn pause_sync(&self, sync_id: u64) -> ChannelSyncControlResponse {
        let worker = {
            let inner = self.inner.read().await;
            inner.workers.get(&sync_id).cloned()
        };
        let Some(control) = worker else {
            return ChannelSyncControlResponse {
                sync_id,
                accepted: false,
                state: ChannelSyncStatus::Stopped,
            };
        };

        let _ = control.state_tx.send(ChannelSyncDesiredState::Paused);
        ChannelSyncControlResponse {
            sync_id,
            accepted: true,
            state: ChannelSyncStatus::Paused,
        }
    }

    /// Resumes a paused channel synchronization stream.
    pub async fn resume_sync(&self, sync_id: u64) -> ChannelSyncControlResponse {
        let worker = {
            let inner = self.inner.read().await;
            inner.workers.get(&sync_id).cloned()
        };
        let Some(control) = worker else {
            return ChannelSyncControlResponse {
                sync_id,
                accepted: false,
                state: ChannelSyncStatus::Stopped,
            };
        };

        let _ = control.state_tx.send(ChannelSyncDesiredState::Running);
        ChannelSyncControlResponse {
            sync_id,
            accepted: true,
            state: ChannelSyncStatus::LiveSynced,
        }
    }

    /// Stops and terminates a channel synchronization stream.
    pub async fn stop_sync(&self, sync_id: u64) -> ChannelSyncControlResponse {
        let worker = {
            let inner = self.inner.read().await;
            inner.workers.get(&sync_id).cloned()
        };
        let Some(control) = worker else {
            return ChannelSyncControlResponse {
                sync_id,
                accepted: false,
                state: ChannelSyncStatus::Stopped,
            };
        };

        control.cancel.cancel();
        ChannelSyncControlResponse {
            sync_id,
            accepted: true,
            state: ChannelSyncStatus::Stopped,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockEventSink;
    impl ChannelSyncEventSink for MockEventSink {
        fn send_event(&self, _event: ChannelSyncEvent) -> bool {
            true
        }
    }

    #[tokio::test]
    async fn test_process_ack_single_winner_and_duplicate_rejection() {
        let (ack_tx, mut ack_rx) = mpsc::channel(32);
        let (state_tx, _) = watch::channel(ChannelSyncDesiredState::Running);

        let control = Arc::new(ChannelSyncControl {
            sync_id: 42,
            session_key: "sess".into(),
            client_request_id: "req_42".into(),
            peer_id: "-100123".into(),
            created_at_ms: now_epoch_ms(),
            cancel: CancellationToken::new(),
            state_tx,
            ack_tx,
            current_pts: AtomicI32::new(100),
            expected_batch_id: AtomicU64::new(1),
            claimed_batch_id: AtomicU64::new(0),
            last_processed_batch_id: AtomicU64::new(0),
            primary_subscriber: RwLock::new(None),
            next_subscriber_id: AtomicU64::new(1),
            subscriber_generation: AtomicU64::new(1),
            subscriber_notify: Arc::new(Notify::new()),
            reconcile_target_pts: AtomicI32::new(0),
            reconcile_notify: Arc::new(Notify::new()),
            pending_batch: RwLock::new(None),
            status: Arc::new(RwLock::new(ChannelSyncStatus::WaitingAck)),
            is_actively_viewed: AtomicBool::new(true),
            terminal_at_ms: AtomicU64::new(0),
        });

        let mut workers = HashMap::new();
        workers.insert(42, control.clone());

        let manager = ChannelSyncManager {
            inner: Arc::new(RwLock::new(ChannelSyncManagerInner {
                workers,
                active_channel_syncs: HashMap::new(),
                client_request_map: HashMap::new(),
            })),
            router_manager: Arc::new(SessionUpdateRouterManager::new()),
            sessions_dir: PathBuf::from("sessions"),
            difference_source: Arc::new(GrammersChannelDifferenceSource {
                sessions_dir: PathBuf::from("sessions"),
            }),
            next_sync_id: AtomicU64::new(43),
        };

        // 1. Stale ACK
        let stale_ack = ChannelSyncAck {
            sync_id: 42,
            batch_id: 0,
            outcome: ChannelSyncAckOutcome::Committed,
            committed_pts: Some(100),
            error_code: None,
        };
        assert_eq!(manager.process_ack(stale_ack).await, ChannelSyncAckResult::Stale);

        // 2. Future unexpected ACK
        let unexp_ack = ChannelSyncAck {
            sync_id: 42,
            batch_id: 5,
            outcome: ChannelSyncAckOutcome::Committed,
            committed_pts: Some(105),
            error_code: None,
        };
        assert_eq!(manager.process_ack(unexp_ack).await, ChannelSyncAckResult::Unexpected);

        // 3. Winning claim on expected batch #1
        let valid_ack = ChannelSyncAck {
            sync_id: 42,
            batch_id: 1,
            outcome: ChannelSyncAckOutcome::Committed,
            committed_pts: Some(101),
            error_code: None,
        };
        assert_eq!(manager.process_ack(valid_ack.clone()).await, ChannelSyncAckResult::Accepted);

        // 4. Duplicate claim while worker is still processing (claimed == 1)
        assert_eq!(manager.process_ack(valid_ack.clone()).await, ChannelSyncAckResult::AlreadyAcked);

        // Worker drains and completes processing of batch #1
        let received = ack_rx.recv().await.unwrap();
        assert_eq!(received.batch_id, 1);
        control.last_processed_batch_id.store(1, Ordering::Release);
        control.claimed_batch_id.store(0, Ordering::Release);
        control.expected_batch_id.store(0, Ordering::Release);

        // 5. Subsequent duplicate ACK after worker completion
        assert_eq!(manager.process_ack(valid_ack).await, ChannelSyncAckResult::AlreadyAcked);
    }

    #[tokio::test]
    async fn test_complete_reconcile_handshake() {
        let (ack_tx, _) = mpsc::channel(32);
        let (state_tx, _) = watch::channel(ChannelSyncDesiredState::Running);

        let control = Arc::new(ChannelSyncControl {
            sync_id: 99,
            session_key: "sess".into(),
            client_request_id: "req_99".into(),
            peer_id: "-100123".into(),
            created_at_ms: now_epoch_ms(),
            cancel: CancellationToken::new(),
            state_tx,
            ack_tx,
            current_pts: AtomicI32::new(100),
            expected_batch_id: AtomicU64::new(3),
            claimed_batch_id: AtomicU64::new(0),
            last_processed_batch_id: AtomicU64::new(2),
            primary_subscriber: RwLock::new(None),
            next_subscriber_id: AtomicU64::new(1),
            subscriber_generation: AtomicU64::new(1),
            subscriber_notify: Arc::new(Notify::new()),
            reconcile_target_pts: AtomicI32::new(450), // Target is 450
            reconcile_notify: Arc::new(Notify::new()),
            pending_batch: RwLock::new(None),
            status: Arc::new(RwLock::new(ChannelSyncStatus::ReconcileRequired)),
            is_actively_viewed: AtomicBool::new(true),
            terminal_at_ms: AtomicU64::new(0),
        });

        let mut workers = HashMap::new();
        workers.insert(99, control.clone());

        let manager = ChannelSyncManager {
            inner: Arc::new(RwLock::new(ChannelSyncManagerInner {
                workers,
                active_channel_syncs: HashMap::new(),
                client_request_map: HashMap::new(),
            })),
            router_manager: Arc::new(SessionUpdateRouterManager::new()),
            sessions_dir: PathBuf::from("sessions"),
            difference_source: Arc::new(GrammersChannelDifferenceSource {
                sessions_dir: PathBuf::from("sessions"),
            }),
            next_sync_id: AtomicU64::new(100),
        };

        // 1. Wrong target PTS (400 != 450) is rejected
        assert!(!manager.complete_reconcile(99, 400).await);

        // 2. Correct target PTS (450) is accepted
        assert!(manager.complete_reconcile(99, 450).await);

        assert_eq!(control.current_pts.load(Ordering::Acquire), 450);
        let st = *control.status.read().await;
        assert_eq!(st, ChannelSyncStatus::LiveSynced);
        assert_eq!(control.reconcile_target_pts.load(Ordering::Acquire), 0);
        assert_eq!(control.expected_batch_id.load(Ordering::Acquire), 0);

        // 3. Second call is rejected because state is no longer ReconcileRequired
        assert!(!manager.complete_reconcile(99, 450).await);
    }

    #[tokio::test]
    async fn test_prune_terminal_workers_and_scope_release() {
        let (ack_tx, _) = mpsc::channel(32);
        let (state_tx, _) = watch::channel(ChannelSyncDesiredState::Running);

        let control = Arc::new(ChannelSyncControl {
            sync_id: 77,
            session_key: "sess".into(),
            client_request_id: "req_77".into(),
            peer_id: "-100123".into(),
            created_at_ms: now_epoch_ms(),
            cancel: CancellationToken::new(),
            state_tx,
            ack_tx,
            current_pts: AtomicI32::new(100),
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
            status: Arc::new(RwLock::new(ChannelSyncStatus::Stopped)),
            is_actively_viewed: AtomicBool::new(false),
            terminal_at_ms: AtomicU64::new(10_000), // Terminated at 10,000ms
        });

        let mut inner = ChannelSyncManagerInner {
            workers: HashMap::new(),
            active_channel_syncs: HashMap::new(),
            client_request_map: HashMap::new(),
        };
        inner.workers.insert(77, control);
        inner.active_channel_syncs.insert("sess:-100123".into(), 77);
        inner.client_request_map.insert("req_77".into(), 77);

        // Not yet expired at 100_000ms with TTL 300_000ms
        inner.prune_terminal_workers(100_000, 300_000);
        assert_eq!(inner.workers.len(), 1);

        // Expired at 350_000ms with TTL 300_000ms
        inner.prune_terminal_workers(350_000, 300_000);
        assert_eq!(inner.workers.len(), 0);
        assert_eq!(inner.active_channel_syncs.len(), 0);
        assert_eq!(inner.client_request_map.len(), 0);
    }
}
