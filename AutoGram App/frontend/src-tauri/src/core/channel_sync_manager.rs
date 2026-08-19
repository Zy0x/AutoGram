//! channel_sync_manager.rs — Global Thread-Safe Manager for Channel Sync Workers (P2.5)

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::{mpsc, watch, Notify, RwLock};
use tokio_util::sync::CancellationToken;

use super::channel_sync_types::*;
use super::channel_sync_worker::{
    ChannelDifferenceSource, ChannelSyncControl, ChannelSyncDesiredState, ChannelSyncEventSink,
    ChannelSyncWorker, GrammersChannelDifferenceSource, PrimaryChannelSubscriber,
};
use super::session_update_router::SessionUpdateRouterManager;
use super::tg_error::{TgErrorCode, TgErrorPublic};

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

struct ChannelSyncManagerInner {
    workers: HashMap<u64, Arc<ChannelSyncControl>>,
    active_channel_syncs: HashMap<String, u64>,
    client_request_map: HashMap<String, u64>,
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

        let mut inner = self.inner.write().await;

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
                    });
                } else {
                    inner.active_channel_syncs.remove(&scope_key);
                }
            }
        }

        // 3. Allocate new ChannelSyncWorker atomically under write lock
        let sync_id = self.next_sync_id.fetch_add(1, Ordering::SeqCst);
        let (state_tx, _) = watch::channel(ChannelSyncDesiredState::Running);
        let (ack_tx, ack_rx) = mpsc::channel(1);
        let cancel = CancellationToken::new();

        let initial_pts = request.initial_pts.unwrap_or(0);

        let primary_subscriber = PrimaryChannelSubscriber {
            subscriber_id: 1,
            generation: 1,
            sink: sink_arc,
        };

        let control = Arc::new(ChannelSyncControl {
            sync_id,
            session_key: session_key.clone(),
            client_request_id: client_req_id.clone(),
            peer_id: peer_id.clone(),
            created_at_ms: now_epoch_ms(),
            current_pts: AtomicI32::new(initial_pts),
            state_tx,
            cancel: cancel.clone(),
            ack_tx,
            expected_batch_id: AtomicU64::new(0),
            claimed_batch_id: AtomicU64::new(0),
            last_processed_batch_id: AtomicU64::new(0),
            primary_subscriber: RwLock::new(Some(primary_subscriber)),
            next_subscriber_id: AtomicU64::new(2),
            subscriber_generation: AtomicU64::new(1),
            subscriber_notify: Arc::new(Notify::new()),
            pending_batch: RwLock::new(None),
            status: Arc::new(RwLock::new(ChannelSyncStatus::Preparing)),
            is_actively_viewed: AtomicBool::new(request.is_actively_viewed.unwrap_or(false)),
            terminal_at_ms: AtomicU64::new(0),
        });

        // Register with SessionUpdateRouter
        let router = self.router_manager.get_or_create(self.sessions_dir.clone(), &request.identity).await;
        let (update_rx, mailbox_overflowed) = router.register_channel(parsed_channel_id).await;

        inner.workers.insert(sync_id, control.clone());
        inner.active_channel_syncs.insert(scope_key.clone(), sync_id);
        inner.client_request_map.insert(client_req_id, sync_id);

        drop(inner);

        // Spawn background worker with scope-cleanup on completion
        let inner_ref = self.inner.clone();
        let worker = ChannelSyncWorker {
            sync_id,
            request,
            control: control.clone(),
            difference_source: self.difference_source.clone(),
            router,
            ack_rx,
            update_rx,
            mailbox_overflowed,
        };

        tokio::spawn(async move {
            worker.run().await;
            // Clean up active scope map
            let mut guard = inner_ref.write().await;
            if let Some(&active_id) = guard.active_channel_syncs.get(&scope_key) {
                if active_id == sync_id {
                    guard.active_channel_syncs.remove(&scope_key);
                }
            }
        });

        Ok(StartChannelSyncResponse {
            sync_id,
            state: ChannelSyncStatus::Preparing,
            reused_existing_sync: false,
            subscriber_id: 1,
            generation: 1,
            current_pts: initial_pts,
        })
    }

    /// Attaches a replacement primary persistence Channel to an existing active worker.
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

        let Some(worker) = worker else {
            return Err(TgErrorPublic {
                code: TgErrorCode::Internal,
                message: format!("Channel sync stream #{} not found", sync_id),
                flood_wait_secs: None,
                rpc_name: None,
                retryable: false,
            });
        };

        let term_at = worker.terminal_at_ms.load(Ordering::Acquire);
        if term_at > 0 {
            let st = *worker.status.read().await;
            return Ok(AttachChannelSyncResponse {
                sync_id,
                attached: false,
                subscriber_id: 0,
                generation: worker.subscriber_generation.load(Ordering::Acquire),
                state: st,
                current_pts: worker.current_pts.load(Ordering::Acquire),
                replayed_batch_id: None,
            });
        }

        let sink_arc: Arc<dyn ChannelSyncEventSink> = Arc::new(event_sink);
        let snapshot = worker.attach_primary_and_snapshot(sink_arc).await;

        Ok(AttachChannelSyncResponse {
            sync_id,
            attached: true,
            subscriber_id: snapshot.subscriber_id,
            generation: snapshot.generation,
            state: snapshot.state,
            current_pts: snapshot.current_pts,
            replayed_batch_id: snapshot.replayed_batch_id,
        })
    }

    /// Detaches a primary persistence subscriber if subscriber_id and generation still match.
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

        if let Some(w) = worker {
            let detached = w.detach_primary(subscriber_id, generation).await;
            DetachChannelSyncResponse { sync_id, detached }
        } else {
            DetachChannelSyncResponse { sync_id, detached: false }
        }
    }

    /// Processes an incoming storage ACK with three-stage atomic claim validation.
    pub async fn process_ack(&self, ack: ChannelSyncAck) -> ChannelSyncAckResult {
        let worker = {
            let inner = self.inner.read().await;
            inner.workers.get(&ack.sync_id).cloned()
        };

        let Some(control) = worker else {
            return ChannelSyncAckResult::SyncTerminal;
        };

        let expected = control.expected_batch_id.load(Ordering::Acquire);
        if expected == 0 {
            let last_processed = control.last_processed_batch_id.load(Ordering::Acquire);
            if ack.batch_id <= last_processed && ack.batch_id > 0 {
                return ChannelSyncAckResult::AlreadyAcked;
            }
            return ChannelSyncAckResult::Unexpected;
        }

        if ack.batch_id != expected {
            if ack.batch_id < expected {
                return ChannelSyncAckResult::Stale;
            }
            return ChannelSyncAckResult::Unexpected;
        }

        // Atomic claim
        if control
            .claimed_batch_id
            .compare_exchange(0, ack.batch_id, Ordering::SeqCst, Ordering::Relaxed)
            .is_err()
        {
            return ChannelSyncAckResult::AlreadyAcked;
        }

        let sent = control.ack_tx.try_send(ack).is_ok();
        control.claimed_batch_id.store(0, Ordering::Release);

        if sent {
            ChannelSyncAckResult::Accepted
        } else {
            ChannelSyncAckResult::Unexpected
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

        if let Some(w) = worker {
            let _ = w.state_tx.send(ChannelSyncDesiredState::Paused);
            let st = *w.status.read().await;
            ChannelSyncControlResponse {
                sync_id,
                accepted: true,
                state: st,
            }
        } else {
            ChannelSyncControlResponse {
                sync_id,
                accepted: false,
                state: ChannelSyncStatus::Failed,
            }
        }
    }

    /// Resumes a paused channel synchronization stream.
    pub async fn resume_sync(&self, sync_id: u64) -> ChannelSyncControlResponse {
        let worker = {
            let inner = self.inner.read().await;
            inner.workers.get(&sync_id).cloned()
        };

        if let Some(w) = worker {
            let _ = w.state_tx.send(ChannelSyncDesiredState::Running);
            let st = *w.status.read().await;
            ChannelSyncControlResponse {
                sync_id,
                accepted: true,
                state: st,
            }
        } else {
            ChannelSyncControlResponse {
                sync_id,
                accepted: false,
                state: ChannelSyncStatus::Failed,
            }
        }
    }

    /// Stops and terminates a channel synchronization stream.
    pub async fn stop_sync(&self, sync_id: u64) -> ChannelSyncControlResponse {
        let worker = {
            let inner = self.inner.read().await;
            inner.workers.get(&sync_id).cloned()
        };

        if let Some(w) = worker {
            w.cancel.cancel();
            let mut st = w.status.write().await;
            *st = ChannelSyncStatus::Stopped;
            ChannelSyncControlResponse {
                sync_id,
                accepted: true,
                state: ChannelSyncStatus::Stopped,
            }
        } else {
            ChannelSyncControlResponse {
                sync_id,
                accepted: false,
                state: ChannelSyncStatus::Stopped,
            }
        }
    }
}
