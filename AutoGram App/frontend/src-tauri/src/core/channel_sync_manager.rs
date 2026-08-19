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

/// Global thread-safe manager for all active ChannelSyncWorker instances in Tauri application state.
pub struct ChannelSyncManager {
    pub workers: Arc<RwLock<HashMap<u64, Arc<ChannelSyncControl>>>>,
    pub active_channel_syncs: Arc<RwLock<HashMap<String, u64>>>,
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
            workers: Arc::new(RwLock::new(HashMap::new())),
            active_channel_syncs: Arc::new(RwLock::new(HashMap::new())),
            router_manager: Arc::new(SessionUpdateRouterManager::new()),
            sessions_dir,
            difference_source,
            next_sync_id: AtomicU64::new(1),
        }
    }

    /// Starts a new or reattaches to an existing active ChannelSyncWorker for (accountId, peerId).
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

        let sink_arc: Arc<dyn ChannelSyncEventSink> = Arc::new(event_sink);

        // Check if an existing worker is already active for this channel
        {
            let active_map = self.active_channel_syncs.read().await;
            if let Some(&existing_id) = active_map.get(&scope_key) {
                let workers_guard = self.workers.read().await;
                if let Some(ctrl) = workers_guard.get(&existing_id) {
                    let term_at = ctrl.terminal_at_ms.load(Ordering::Acquire);
                    if term_at == 0 {
                        let ctrl_clone = ctrl.clone();
                        drop(workers_guard);
                        drop(active_map);

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
                    }
                }
            }
        }

        // Allocate new ChannelSyncWorker
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
            client_request_id: request.client_request_id.clone(),
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
        let update_rx = router.register_channel(parsed_channel_id).await;

        {
            let mut workers_guard = self.workers.write().await;
            let mut active_map = self.active_channel_syncs.write().await;
            workers_guard.insert(sync_id, control.clone());
            active_map.insert(scope_key, sync_id);
        }

        // Spawn background worker
        let worker = ChannelSyncWorker {
            sync_id,
            request,
            control: control.clone(),
            difference_source: self.difference_source.clone(),
            router,
            ack_rx,
            update_rx,
        };

        tokio::spawn(async move {
            worker.run().await;
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
            let workers = self.workers.read().await;
            workers.get(&sync_id).cloned()
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
            let workers = self.workers.read().await;
            workers.get(&sync_id).cloned()
        };

        let Some(worker) = worker else {
            return DetachChannelSyncResponse {
                sync_id,
                detached: false,
            };
        };

        let detached = {
            let mut primary = worker.primary_subscriber.write().await;
            if let Some(ref sub) = *primary {
                if sub.subscriber_id == subscriber_id && sub.generation == generation {
                    *primary = None;
                    true
                } else {
                    false
                }
            } else {
                false
            }
        };

        if detached {
            if worker.expected_batch_id.load(Ordering::Acquire) > 0 {
                let mut st = worker.status.write().await;
                if *st == ChannelSyncStatus::WaitingAck {
                    *st = ChannelSyncStatus::WaitingFrontend;
                }
            }
            worker.subscriber_notify.notify_waiters();
        }

        DetachChannelSyncResponse {
            sync_id,
            detached,
        }
    }

    /// Dispatches a storage ACK from the frontend with atomic single-winner claim.
    pub async fn process_ack(&self, ack: ChannelSyncAck) -> ChannelSyncAckResult {
        let worker = {
            let workers = self.workers.read().await;
            workers.get(&ack.sync_id).cloned()
        };

        let Some(worker) = worker else {
            return ChannelSyncAckResult::SyncTerminal;
        };

        let processed = worker.last_processed_batch_id.load(Ordering::Acquire);
        if ack.batch_id == processed && processed != 0 {
            return ChannelSyncAckResult::AlreadyAcked;
        }
        if ack.batch_id < processed {
            return ChannelSyncAckResult::Stale;
        }

        let expected = worker.expected_batch_id.load(Ordering::Acquire);
        if expected == 0 {
            let claimed = worker.claimed_batch_id.load(Ordering::Acquire);
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

        let claimed = worker.claimed_batch_id.load(Ordering::Acquire);
        if claimed == ack.batch_id {
            return ChannelSyncAckResult::AlreadyAcked;
        }
        if claimed > ack.batch_id {
            return ChannelSyncAckResult::Stale;
        }

        match worker.claimed_batch_id.compare_exchange(
            claimed,
            ack.batch_id,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => {
                match worker.ack_tx.send(ack).await {
                    Ok(()) => ChannelSyncAckResult::Accepted,
                    Err(_) => ChannelSyncAckResult::SyncTerminal,
                }
            }
            Err(actual) if actual == ack.batch_id => ChannelSyncAckResult::AlreadyAcked,
            Err(actual) if actual > ack.batch_id => ChannelSyncAckResult::Stale,
            Err(_) => ChannelSyncAckResult::Unexpected,
        }
    }

    /// Sets whether this channel is actively viewed in the foreground UI (governing short polling).
    pub async fn set_active_view(&self, sync_id: u64, is_active: bool) {
        let worker = {
            let workers = self.workers.read().await;
            workers.get(&sync_id).cloned()
        };
        if let Some(w) = worker {
            w.is_actively_viewed.store(is_active, Ordering::Release);
        }
    }

    /// Pauses an active channel synchronization stream.
    pub async fn pause_sync(&self, sync_id: u64) -> ChannelSyncControlResponse {
        let worker = {
            let workers = self.workers.read().await;
            workers.get(&sync_id).cloned()
        };

        let Some(worker) = worker else {
            return ChannelSyncControlResponse {
                sync_id,
                accepted: false,
                state: ChannelSyncStatus::Failed,
            };
        };

        let _ = worker.state_tx.send(ChannelSyncDesiredState::Paused);
        let mut st = worker.status.write().await;
        *st = ChannelSyncStatus::Paused;

        ChannelSyncControlResponse {
            sync_id,
            accepted: true,
            state: *st,
        }
    }

    /// Resumes a paused channel synchronization stream.
    pub async fn resume_sync(&self, sync_id: u64) -> ChannelSyncControlResponse {
        let worker = {
            let workers = self.workers.read().await;
            workers.get(&sync_id).cloned()
        };

        let Some(worker) = worker else {
            return ChannelSyncControlResponse {
                sync_id,
                accepted: false,
                state: ChannelSyncStatus::Failed,
            };
        };

        let _ = worker.state_tx.send(ChannelSyncDesiredState::Running);
        let mut st = worker.status.write().await;
        *st = ChannelSyncStatus::LiveSynced;

        ChannelSyncControlResponse {
            sync_id,
            accepted: true,
            state: *st,
        }
    }

    /// Stops and terminates a channel synchronization worker.
    pub async fn stop_sync(&self, sync_id: u64) -> ChannelSyncControlResponse {
        let worker = {
            let workers = self.workers.read().await;
            workers.get(&sync_id).cloned()
        };

        let Some(worker) = worker else {
            return ChannelSyncControlResponse {
                sync_id,
                accepted: false,
                state: ChannelSyncStatus::Stopped,
            };
        };

        worker.cancel.cancel();
        worker.subscriber_notify.notify_waiters();
        let mut st = worker.status.write().await;
        *st = ChannelSyncStatus::Stopped;

        ChannelSyncControlResponse {
            sync_id,
            accepted: true,
            state: *st,
        }
    }
}
