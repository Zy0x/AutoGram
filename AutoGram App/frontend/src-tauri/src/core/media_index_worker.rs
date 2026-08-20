//! media_index_worker.rs — Long-Running Rust Media Index & Sync Worker (P3.2 Hardened)
//!
//! Orchestrates Telegram MTProto pagination, K-way buffered merge, rate gating,
//! bounded ACK backpressure synchronization, unified primary subscriber identity & generation tracking,
//! single-winner ACK idempotency, deterministic pending-page replay, and strict lifecycle control in pure Tokio async.
//! Authoritative storage and checkpoint truth remain in IndexedDB.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use tokio::sync::{mpsc, watch, Notify, RwLock};
use tokio_util::sync::CancellationToken;

use super::grammers_ops::media_list::{
    list_media_page_async, LaneCounts, LaneCursor, LaneDurability, LaneRpcObservation, LaneWatermark,
    ListMediaResult, MediaFileRow, ScopedMediaSearchCursor, SearchLane, SearchScope,
};
use super::media_index_types::*;
use super::telegram_ops::TelegramIdentity;
use super::adaptive_rate_governor::{AdaptiveRateGovernor, GovernorState, RpcObservation};
use super::telegram_rpc_guard::{IndexDispatchGate, RpcGuardControl, RpcObserver};
use super::tg_error::{TgError, TgErrorCode, TgErrorPublic};
use super::tg_log;

/// Default timeout for waiting on frontend storage ACK before marking job failed.
const DEFAULT_ACK_TIMEOUT: Duration = Duration::from_secs(120);

/// Timeout for waiting for a replacement frontend persistence subscriber before terminating.
const FRONTEND_REATTACH_TIMEOUT: Duration = Duration::from_secs(120);

/// Progress event broadcast throttle interval (~4 Hz).
const PROGRESS_BROADCAST_INTERVAL: Duration = Duration::from_millis(250);

/// Maximum retention duration for terminal (Completed/Cancelled/Failed) jobs in memory (5 minutes).
const TERMINAL_JOB_TTL_MS: u64 = 300_000;

/// Maximum number of terminal job records retained before forced oldest-first eviction.
const MAX_TERMINAL_JOBS: usize = 64;

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Abstract page source allowing production Grammers MTProto or fast deterministic mock injection in unit tests.
#[async_trait]
pub trait MediaPageSource: Send + Sync {
    async fn next_page(
        &self,
        identity: &TelegramIdentity,
        chat_id: &str,
        limit: usize,
        offset_id: Option<i64>,
        min_id: Option<i64>,
        topic_id: Option<i64>,
        search_cursor: Option<ScopedMediaSearchCursor>,
        max_inflight: usize,
        guard_control: RpcGuardControl,
    ) -> Result<ListMediaResult, TgError>;
}

/// Production implementation delegating directly to `list_media_page_async`.
pub struct GrammersMediaPageSource {
    pub sessions_dir: PathBuf,
}

#[async_trait]
impl MediaPageSource for GrammersMediaPageSource {
    async fn next_page(
        &self,
        identity: &TelegramIdentity,
        chat_id: &str,
        limit: usize,
        offset_id: Option<i64>,
        min_id: Option<i64>,
        topic_id: Option<i64>,
        search_cursor: Option<ScopedMediaSearchCursor>,
        max_inflight: usize,
        guard_control: RpcGuardControl,
    ) -> Result<ListMediaResult, TgError> {
        list_media_page_async(
            &self.sessions_dir,
            identity,
            chat_id,
            limit,
            offset_id,
            min_id,
            topic_id,
            search_cursor,
            max_inflight,
            Some(&guard_control),
        )
        .await
    }
}

/// Desired lifecycle state signaled by pause/resume controllers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaIndexDesiredState {
    Running,
    Paused,
}

/// Unique identifier for a persistence subscriber attachment.
pub type SubscriberId = u64;

/// Trait abstraction for dispatching events to a frontend sink (Tauri IPC Channel or closure).
pub trait MediaIndexEventSink: Send + Sync {
    fn send_event(&self, event: MediaIndexEvent) -> bool;
}

pub struct FnEventSink<F>(pub F)
where
    F: Fn(MediaIndexEvent) -> bool + Send + Sync;

impl<F> MediaIndexEventSink for FnEventSink<F>
where
    F: Fn(MediaIndexEvent) -> bool + Send + Sync,
{
    fn send_event(&self, event: MediaIndexEvent) -> bool {
        (self.0)(event)
    }
}

/// Active authoritative persistence subscriber attached to a job.
pub struct PrimarySubscriber {
    pub subscriber_id: SubscriberId,
    pub generation: u64,
    pub sink: Arc<dyn MediaIndexEventSink>,
}

/// Unacknowledged outstanding page retained in memory for instant replay upon reattach.
#[derive(Clone)]
pub struct PendingPage {
    pub ack_id: u64,
    pub event: MediaIndexPageEvent,
    pub emitted_at_ms: u64,
}

/// Result returned from attaching or reattaching a primary persistence subscriber.
#[derive(Debug, Clone)]
pub struct AttachSnapshot {
    pub subscriber_id: u64,
    pub generation: u64,
    pub state: MediaIndexJobState,
    pub replayed_ack_id: Option<u64>,
}

/// Thread-safe control handles for an active or recent indexing job.
pub struct MediaIndexJobControl {
    pub job_id: u64,
    pub session_key: String,
    pub client_request_id: String,
    pub request_fingerprint: String,
    pub peer_id: String,
    pub topic_id: Option<i64>,
    pub created_at_ms: u64,
    pub state_tx: watch::Sender<MediaIndexDesiredState>,
    pub cancel: CancellationToken,
    pub ack_tx: mpsc::Sender<MediaIndexPageAck>,

    // Three-stage ACK watermarks
    pub expected_ack_id: AtomicU64,
    pub claimed_ack_id: AtomicU64,
    pub last_processed_ack_id: AtomicU64,

    // Single replaceable primary persistence subscriber
    pub primary_subscriber: RwLock<Option<PrimarySubscriber>>,
    pub next_subscriber_id: AtomicU64,
    pub subscriber_generation: AtomicU64,
    pub subscriber_notify: Arc<Notify>,

    // Pending unacknowledged page for replay
    pub pending_page: RwLock<Option<PendingPage>>,

    pub status: Arc<RwLock<MediaIndexJobStatus>>,
    pub terminal_at_ms: AtomicU64,
}

impl MediaIndexJobControl {
    pub async fn emit_to_primary(&self, event: MediaIndexEvent) -> bool {
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

    /// Single unified helper for attaching or reattaching a primary persistence subscriber.
    /// Guarantees that subscriber ID, generation increment, state notification, and pending-page
    /// replay follow identical strict invariants across both `start_job` reuse and `attach_channel`.
    pub async fn attach_primary_and_snapshot(
        &self,
        sink: Arc<dyn MediaIndexEventSink>,
    ) -> AttachSnapshot {
        let gen = self.subscriber_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let sub_id = self.next_subscriber_id.fetch_add(1, Ordering::SeqCst);

        {
            let mut primary = self.primary_subscriber.write().await;
            *primary = Some(PrimarySubscriber {
                subscriber_id: sub_id,
                generation: gen,
                sink: sink.clone(),
            });
        }

        let st = self.status.read().await.clone();
        sink.send_event(MediaIndexEvent::State {
            job_id: self.job_id,
            state: st.state,
        });

        // Replay pending page ONLY IF:
        // 1. Expected ACK ID is positive (> 0)
        // 2. ACK has NOT already been claimed (claimed < expected)
        // 3. Pending page ACK ID exactly matches expected ACK ID
        let mut replayed_ack_id = None;
        let expected = self.expected_ack_id.load(Ordering::Acquire);
        let claimed = self.claimed_ack_id.load(Ordering::Acquire);

        if expected > 0 && claimed < expected {
            let pending_guard = self.pending_page.read().await;
            if let Some(ref p) = *pending_guard {
                if p.ack_id == expected {
                    sink.send_event(MediaIndexEvent::Page(p.event.clone()));
                    replayed_ack_id = Some(p.ack_id);
                }
            }
        }

        self.subscriber_notify.notify_waiters();

        AttachSnapshot {
            subscriber_id: sub_id,
            generation: gen,
            state: st.state,
            replayed_ack_id,
        }
    }
}

/// Idempotency reservation entry with scope fingerprint.
#[derive(Clone, Debug)]
pub struct ClientRequestReservation {
    pub job_id: u64,
    pub request_fingerprint: String,
}

/// Unified internal state of the manager guarded by a single RwLock.
pub struct MediaIndexJobManagerInner {
    pub jobs: HashMap<u64, Arc<MediaIndexJobControl>>,
    pub active_session_jobs: HashMap<String, u64>,
    pub client_request_map: HashMap<String, ClientRequestReservation>,
}

/// Global thread-safe manager for all active and recent indexing jobs in Tauri state.
pub struct MediaIndexJobManager {
    inner: Arc<RwLock<MediaIndexJobManagerInner>>,
    next_job_id: AtomicU64,
    sessions_dir: PathBuf,
    page_source: Arc<dyn MediaPageSource>,
}

impl Default for MediaIndexJobManager {
    fn default() -> Self {
        Self::new(PathBuf::from("sessions"))
    }
}

impl MediaIndexJobManager {
    pub fn new(sessions_dir: PathBuf) -> Self {
        let source = Arc::new(GrammersMediaPageSource {
            sessions_dir: sessions_dir.clone(),
        });
        Self::with_page_source(sessions_dir, source)
    }

    pub fn with_page_source(sessions_dir: PathBuf, page_source: Arc<dyn MediaPageSource>) -> Self {
        Self {
            inner: Arc::new(RwLock::new(MediaIndexJobManagerInner {
                jobs: HashMap::new(),
                active_session_jobs: HashMap::new(),
                client_request_map: HashMap::new(),
            })),
            next_job_id: AtomicU64::new(1),
            sessions_dir,
            page_source,
        }
    }

    /// Prunes expired and excess terminal jobs synchronously without holding locks across any async points.
    fn prune_terminal_jobs_locked(inner: &mut MediaIndexJobManagerInner) {
        let now_ms = now_epoch_ms();
        let mut to_purge = Vec::new();
        let mut terminal_jobs: Vec<(u64, u64)> = Vec::new();

        for (&id, ctrl) in inner.jobs.iter() {
            let term_at = ctrl.terminal_at_ms.load(Ordering::Acquire);
            if term_at > 0 {
                if now_ms.saturating_sub(term_at) > TERMINAL_JOB_TTL_MS {
                    to_purge.push(id);
                } else {
                    terminal_jobs.push((id, term_at));
                }
            }
        }

        if terminal_jobs.len() > MAX_TERMINAL_JOBS {
            terminal_jobs.sort_by_key(|(_, t)| *t);
            let excess = terminal_jobs.len() - MAX_TERMINAL_JOBS;
            for (id, _) in terminal_jobs.into_iter().take(excess) {
                if !to_purge.contains(&id) {
                    to_purge.push(id);
                }
            }
        }

        for id in to_purge {
            if let Some(ctrl) = inner.jobs.remove(&id) {
                if !ctrl.client_request_id.is_empty() {
                    if let Some(res) = inner.client_request_map.get(&ctrl.client_request_id) {
                        if res.job_id == id {
                            inner.client_request_map.remove(&ctrl.client_request_id);
                        }
                    }
                }
                if let Some(&active_id) = inner.active_session_jobs.get(&ctrl.session_key) {
                    if active_id == id {
                        inner.active_session_jobs.remove(&ctrl.session_key);
                    }
                }
            }
        }
    }

    /// Starts a new media index job or attaches to an existing active job idempotently under an atomic write lock.
    pub async fn start_job<S>(
        &self,
        request: StartMediaIndexJobRequest,
        event_sink: S,
    ) -> Result<StartMediaIndexJobResponse, TgErrorPublic>
    where
        S: MediaIndexEventSink + 'static,
    {
        // 1. Basic validation
        if request.identity.session.trim().is_empty() {
            return Err(TgErrorPublic {
                code: TgErrorCode::SessionMissing,
                message: "Telegram session is required".into(),
                flood_wait_secs: None,
                rpc_name: None,
                retryable: false,
            });
        }
        if request.identity.api_id <= 0 || request.identity.api_hash.trim().is_empty() {
            return Err(TgErrorPublic {
                code: TgErrorCode::NotConfigured,
                message: "API credentials (api_id and api_hash) are required".into(),
                flood_wait_secs: None,
                rpc_name: None,
                retryable: false,
            });
        }

        let session_key = request.identity.session.clone();
        let client_req_id = request.client_request_id.trim().to_string();
        let initial_mode = derive_job_mode(&request.initial_state, request.force_mode);
        let fingerprint = format!(
            "peer={}:top={}:mode={:?}",
            request.peer_id,
            request.topic_id.unwrap_or(-1),
            initial_mode
        );

        let sink_arc: Arc<dyn MediaIndexEventSink> = Arc::new(event_sink);

        // 2. Atomic manager state check & reservation under a single write lock
        let (job_id, control, is_reuse, initial_rx) = {
            let mut inner = self.inner.write().await;
            Self::prune_terminal_jobs_locked(&mut inner);

            // A. Check client_request_id reservation
            if !client_req_id.is_empty() {
                if let Some(res) = inner.client_request_map.get(&client_req_id) {
                    if res.request_fingerprint != fingerprint {
                        return Err(TgErrorPublic {
                            code: TgErrorCode::Internal,
                            message: format!(
                                "Client request ID conflict: ID already registered for a different scope"
                            ),
                            flood_wait_secs: None,
                            rpc_name: None,
                            retryable: false,
                        });
                    }
                    if let Some(ctrl) = inner.jobs.get(&res.job_id) {
                        let term_at = ctrl.terminal_at_ms.load(Ordering::Acquire);
                        if term_at == 0 {
                            let existing_id = ctrl.job_id;
                            let ctrl_clone = ctrl.clone();
                            drop(inner);

                            let snapshot = ctrl_clone.attach_primary_and_snapshot(sink_arc).await;

                            return Ok(StartMediaIndexJobResponse {
                                job_id: existing_id,
                                state: snapshot.state,
                                reused_existing_job: true,
                                subscriber_id: snapshot.subscriber_id,
                                generation: snapshot.generation,
                                replayed_ack_id: snapshot.replayed_ack_id,
                            });
                        }
                    }
                }
            }

            // B. Check active session exclusivity
            if let Some(&existing_id) = inner.active_session_jobs.get(&session_key) {
                if let Some(ctrl) = inner.jobs.get(&existing_id) {
                    let term_at = ctrl.terminal_at_ms.load(Ordering::Acquire);
                    if term_at == 0 {
                        if ctrl.peer_id == request.peer_id && ctrl.topic_id == request.topic_id {
                            let ctrl_clone = ctrl.clone();
                            drop(inner);

                            let snapshot = ctrl_clone.attach_primary_and_snapshot(sink_arc).await;

                            return Ok(StartMediaIndexJobResponse {
                                job_id: existing_id,
                                state: snapshot.state,
                                reused_existing_job: true,
                                subscriber_id: snapshot.subscriber_id,
                                generation: snapshot.generation,
                                replayed_ack_id: snapshot.replayed_ack_id,
                            });
                        }

                        return Err(TgErrorPublic {
                            code: TgErrorCode::SessionLocked,
                            message: format!(
                                "Telegram session is already actively running indexing job #{}",
                                existing_id
                            ),
                            flood_wait_secs: None,
                            rpc_name: None,
                            retryable: false,
                        });
                    }
                }
                inner.active_session_jobs.remove(&session_key);
            }

            // C. Allocate and atomically reserve new job
            let job_id = self.next_job_id.fetch_add(1, Ordering::SeqCst);
            let (state_tx, _) = watch::channel(MediaIndexDesiredState::Running);
            let (ack_tx, ack_rx) = mpsc::channel(1);
            let cancel = CancellationToken::new();
            let peer_safe = tg_log::session_label(&request.peer_id);

            let initial_status = MediaIndexJobStatus {
                job_id,
                state: MediaIndexJobState::Preparing,
                mode: initial_mode,
                peer_safe_label: peer_safe,
                topic_id: request.topic_id,
                created_at_ms: now_epoch_ms(),
                started_at_ms: None,
                updated_at_ms: now_epoch_ms(),
                expected_ack_id: None,
                metrics: MediaIndexMetricsSnapshot::default(),
                terminal_error: None,
            };

            let primary_subscriber = PrimarySubscriber {
                subscriber_id: 1,
                generation: 1,
                sink: sink_arc,
            };

            let control = Arc::new(MediaIndexJobControl {
                job_id,
                session_key: session_key.clone(),
                client_request_id: client_req_id.clone(),
                request_fingerprint: fingerprint.clone(),
                peer_id: request.peer_id.clone(),
                topic_id: request.topic_id,
                created_at_ms: now_epoch_ms(),
                state_tx,
                cancel: cancel.clone(),
                ack_tx,
                expected_ack_id: AtomicU64::new(0),
                claimed_ack_id: AtomicU64::new(0),
                last_processed_ack_id: AtomicU64::new(0),
                primary_subscriber: RwLock::new(Some(primary_subscriber)),
                next_subscriber_id: AtomicU64::new(2),
                subscriber_generation: AtomicU64::new(1),
                subscriber_notify: Arc::new(Notify::new()),
                pending_page: RwLock::new(None),
                status: Arc::new(RwLock::new(initial_status)),
                terminal_at_ms: AtomicU64::new(0),
            });

            inner.jobs.insert(job_id, control.clone());
            inner.active_session_jobs.insert(session_key.clone(), job_id);
            if !client_req_id.is_empty() {
                inner.client_request_map.insert(
                    client_req_id.clone(),
                    ClientRequestReservation {
                        job_id,
                        request_fingerprint: fingerprint,
                    },
                );
            }

            (job_id, control, false, Some(ack_rx))
        };

        // 3. Spawn Tokio worker task if newly created
        if let Some(ack_rx) = initial_rx {
            let worker = MediaIndexWorker {
                job_id,
                request,
                control: control.clone(),
                page_source: self.page_source.clone(),
                inner: self.inner.clone(),
                ack_rx,
            };

            tokio::spawn(async move {
                worker.run().await;
            });
        }

        Ok(StartMediaIndexJobResponse {
            job_id,
            state: MediaIndexJobState::Preparing,
            reused_existing_job: is_reuse,
            subscriber_id: 1,
            generation: 1,
            replayed_ack_id: None,
        })
    }

    /// Attaches a new primary persistence Channel to an existing active job.
    pub async fn attach_channel<S>(
        &self,
        job_id: u64,
        event_sink: S,
    ) -> Result<AttachMediaIndexJobResponse, TgErrorPublic>
    where
        S: MediaIndexEventSink + 'static,
    {
        let job = {
            let inner = self.inner.read().await;
            inner.jobs.get(&job_id).cloned()
        };

        let Some(job) = job else {
            return Err(TgErrorPublic {
                code: TgErrorCode::Internal,
                message: format!("Indexing job #{} not found", job_id),
                flood_wait_secs: None,
                rpc_name: None,
                retryable: false,
            });
        };

        let term_at = job.terminal_at_ms.load(Ordering::Acquire);
        if term_at > 0 {
            let st = job.status.read().await.clone();
            return Ok(AttachMediaIndexJobResponse {
                job_id,
                attached: false,
                subscriber_id: 0,
                generation: job.subscriber_generation.load(Ordering::Acquire),
                state: st.state,
                replayed_ack_id: None,
            });
        }

        let sink_arc: Arc<dyn MediaIndexEventSink> = Arc::new(event_sink);
        let snapshot = job.attach_primary_and_snapshot(sink_arc).await;

        Ok(AttachMediaIndexJobResponse {
            job_id,
            attached: true,
            subscriber_id: snapshot.subscriber_id,
            generation: snapshot.generation,
            state: snapshot.state,
            replayed_ack_id: snapshot.replayed_ack_id,
        })
    }

    /// Detaches a primary persistence subscriber if subscriber_id and generation still match.
    /// If detaching the current active primary while waiting for ACK, immediately transitions
    /// the job state to `WaitingFrontend` and notifies the worker loop.
    pub async fn detach_channel(
        &self,
        job_id: u64,
        subscriber_id: u64,
        generation: u64,
    ) -> DetachMediaIndexJobResponse {
        let job = {
            let inner = self.inner.read().await;
            inner.jobs.get(&job_id).cloned()
        };

        let Some(job) = job else {
            return DetachMediaIndexJobResponse {
                job_id,
                detached: false,
            };
        };

        let detached = {
            let mut primary = job.primary_subscriber.write().await;
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
            if job.expected_ack_id.load(Ordering::Acquire) > 0 {
                let mut st = job.status.write().await;
                if st.state == MediaIndexJobState::WaitingAck {
                    st.state = MediaIndexJobState::WaitingFrontend;
                    st.updated_at_ms = now_epoch_ms();
                }
            }
            job.subscriber_notify.notify_waiters();
        }

        DetachMediaIndexJobResponse {
            job_id,
            detached,
        }
    }

    /// Dispatches a storage ACK from the frontend to the matching job with atomic single-winner claim.
    pub async fn process_ack(&self, ack: MediaIndexPageAck) -> MediaIndexAckResult {
        let job = {
            let inner = self.inner.read().await;
            inner.jobs.get(&ack.job_id).cloned()
        };

        let Some(job) = job else {
            return MediaIndexAckResult::JobTerminal;
        };

        let processed = job.last_processed_ack_id.load(Ordering::Acquire);
        if ack.ack_id == processed && processed != 0 {
            return MediaIndexAckResult::AlreadyAcked;
        }
        if ack.ack_id < processed {
            return MediaIndexAckResult::Stale;
        }

        let expected = job.expected_ack_id.load(Ordering::Acquire);
        if expected == 0 {
            let claimed = job.claimed_ack_id.load(Ordering::Acquire);
            if ack.ack_id == claimed && claimed != 0 {
                return MediaIndexAckResult::AlreadyAcked;
            }
            return MediaIndexAckResult::JobTerminal;
        }

        if ack.ack_id < expected {
            return MediaIndexAckResult::Stale;
        }
        if ack.ack_id > expected {
            return MediaIndexAckResult::Unexpected;
        }

        // Exact match with expected ACK: single-winner atomic claim
        let claimed = job.claimed_ack_id.load(Ordering::Acquire);
        if claimed == ack.ack_id {
            return MediaIndexAckResult::AlreadyAcked;
        }
        if claimed > ack.ack_id {
            return MediaIndexAckResult::Stale;
        }

        match job.claimed_ack_id.compare_exchange(
            claimed,
            ack.ack_id,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => {
                // Winning claim! Send to ACK channel (capacity 1)
                match job.ack_tx.send(ack).await {
                    Ok(()) => MediaIndexAckResult::Accepted,
                    Err(_) => MediaIndexAckResult::JobTerminal,
                }
            }
            Err(actual) if actual == ack.ack_id => MediaIndexAckResult::AlreadyAcked,
            Err(actual) if actual > ack.ack_id => MediaIndexAckResult::Stale,
            Err(_) => {
                let cur = job.claimed_ack_id.load(Ordering::Acquire);
                if cur == ack.ack_id {
                    MediaIndexAckResult::AlreadyAcked
                } else if cur > ack.ack_id {
                    MediaIndexAckResult::Stale
                } else {
                    MediaIndexAckResult::Unexpected
                }
            }
        }
    }

    /// Pauses an active job before its next Telegram RPC.
    pub async fn pause_job(&self, job_id: u64) -> MediaIndexControlResponse {
        let job = {
            let inner = self.inner.read().await;
            inner.jobs.get(&job_id).cloned()
        };

        let Some(job) = job else {
            return MediaIndexControlResponse {
                job_id,
                accepted: false,
                state: MediaIndexJobState::Failed,
            };
        };

        let _ = job.state_tx.send(MediaIndexDesiredState::Paused);
        let mut st = job.status.write().await;
        if st.state == MediaIndexJobState::Running {
            st.state = MediaIndexJobState::UserPaused;
            st.updated_at_ms = now_epoch_ms();
        }

        MediaIndexControlResponse {
            job_id,
            accepted: true,
            state: st.state,
        }
    }

    /// Resumes a paused indexing job.
    pub async fn resume_job(&self, job_id: u64) -> MediaIndexControlResponse {
        let job = {
            let inner = self.inner.read().await;
            inner.jobs.get(&job_id).cloned()
        };

        let Some(job) = job else {
            return MediaIndexControlResponse {
                job_id,
                accepted: false,
                state: MediaIndexJobState::Failed,
            };
        };

        let _ = job.state_tx.send(MediaIndexDesiredState::Running);
        let mut st = job.status.write().await;
        if st.state == MediaIndexJobState::UserPaused {
            st.state = MediaIndexJobState::Running;
            st.updated_at_ms = now_epoch_ms();
        }

        MediaIndexControlResponse {
            job_id,
            accepted: true,
            state: st.state,
        }
    }

    /// Cancels a running indexing job immediately.
    pub async fn cancel_job(&self, job_id: u64) -> MediaIndexControlResponse {
        let job = {
            let inner = self.inner.read().await;
            inner.jobs.get(&job_id).cloned()
        };

        let Some(job) = job else {
            return MediaIndexControlResponse {
                job_id,
                accepted: false,
                state: MediaIndexJobState::Cancelled,
            };
        };

        job.cancel.cancel();
        job.subscriber_notify.notify_waiters();
        let mut st = job.status.write().await;
        st.state = MediaIndexJobState::Cancelled;
        st.updated_at_ms = now_epoch_ms();

        MediaIndexControlResponse {
            job_id,
            accepted: true,
            state: st.state,
        }
    }

    /// Retrieves the current queryable status of an indexing job.
    pub async fn get_job_status(&self, job_id: u64) -> Option<MediaIndexJobStatus> {
        let job = {
            let inner = self.inner.read().await;
            inner.jobs.get(&job_id).cloned()
        };
        let job = job?;
        let status = job.status.read().await.clone();
        Some(status)
    }
}

/// Derives the initial operational mode based on the supplied durable snapshot.
pub fn derive_job_mode(
    state: &Option<MediaIndexStateSnapshot>,
    force_mode: Option<MediaIndexMode>,
) -> MediaIndexMode {
    if let Some(m) = force_mode {
        return m;
    }
    match state {
        Some(st) => {
            if !st.backfill_complete {
                MediaIndexMode::HistoricalBackfill
            } else {
                MediaIndexMode::DeltaSync
            }
        }
        None => MediaIndexMode::HistoricalBackfill,
    }
}

/// Observer for guard-owned FloodWait backoff, broadcasting typed Flood events to the UI and governor.
pub struct WorkerRpcObserver {
    pub job_id: u64,
    pub control: Arc<MediaIndexJobControl>,
    pub governor: Arc<tokio::sync::Mutex<AdaptiveRateGovernor>>,
    pub dispatch_gate: Arc<IndexDispatchGate>,
    pub last_ack_completed: Arc<tokio::sync::Mutex<Option<Instant>>>,
    pub active_guard_backoffs: Arc<AtomicU32>,
}

#[async_trait]
impl RpcObserver for WorkerRpcObserver {
    async fn on_guard_backoff_start(
        &self,
        wait_secs: u32,
        resume_at_ms: u64,
        _attempt: u32,
        _max_attempts: u32,
    ) {
        let (flood_count, last_wait, new_spacing) = {
            let mut gov = self.governor.lock().await;
            gov.on_flood_wait(wait_secs);
            (gov.flood_count(), gov.last_flood_wait_secs(), gov.spacing_ms())
        };

        // Immediately update dispatch gate spacing so internal retry cannot fire with stale spacing!
        self.dispatch_gate.set_spacing_ms(new_spacing);

        // Atomically track concurrent backoffs
        self.active_guard_backoffs.fetch_add(1, Ordering::SeqCst);

        {
            let mut st = self.control.status.write().await;
            st.state = MediaIndexJobState::FloodPaused;
            st.metrics.flood_count = flood_count;
            st.metrics.flood_seconds_total += u64::from(wait_secs);
            st.metrics.last_flood_wait_secs = last_wait;
            st.updated_at_ms = now_epoch_ms();
        }
        let _ = self.control
            .emit_to_primary(MediaIndexEvent::Flood {
                job_id: self.job_id,
                wait_secs,
                resume_at_ms,
            })
            .await;
    }

    async fn on_guard_backoff_end(&self, _attempt: u32) {
        if self.control.cancel.is_cancelled() {
            return;
        }

        let prev = self.active_guard_backoffs.fetch_sub(1, Ordering::SeqCst);
        // Only transition state when ALL concurrent backoffs have completed (remaining == 0)
        if prev > 1 {
            return;
        }

        let next_state = if *self.control.state_tx.borrow() == MediaIndexDesiredState::Paused {
            MediaIndexJobState::UserPaused
        } else {
            MediaIndexJobState::Running
        };

        {
            let mut st = self.control.status.write().await;
            if st.state == MediaIndexJobState::FloodPaused {
                st.state = next_state;
                st.updated_at_ms = now_epoch_ms();
            }
        }

        let _ = self.control
            .emit_to_primary(MediaIndexEvent::State {
                job_id: self.job_id,
                state: next_state,
            })
            .await;
    }

    async fn on_actual_rpc_dispatch(&self, dispatch_instant: Instant) {
        let gap_ms_opt = {
            let mut last_ack = self.last_ack_completed.lock().await;
            last_ack.take().map(|ack_instant| {
                dispatch_instant.duration_since(ack_instant).as_millis().min(u64::MAX as u128) as u64
            })
        };
        if let Some(gap_ms) = gap_ms_opt {
            let mut gov = self.governor.lock().await;
            gov.on_ack_to_dispatch_gap(gap_ms);
        }
    }
}

/// Long-running Tokio worker instance for a single media index job.
pub struct MediaIndexWorker {
    job_id: u64,
    request: StartMediaIndexJobRequest,
    control: Arc<MediaIndexJobControl>,
    page_source: Arc<dyn MediaPageSource>,
    inner: Arc<RwLock<MediaIndexJobManagerInner>>,
    ack_rx: mpsc::Receiver<MediaIndexPageAck>,
}

impl MediaIndexWorker {
    pub async fn run(mut self) {
        let job_id = self.job_id;
        let cancel = self.control.cancel.clone();
        let session_key = self.request.identity.session.clone();
        let peer_id = self.request.peer_id.clone();
        let topic_id = self.request.topic_id;
        let page_size = self.request.page_size.unwrap_or(100).clamp(1, 100);

        let mode = derive_job_mode(&self.request.initial_state, self.request.force_mode);
        let normalized_topic = topic_id.unwrap_or(-1);

        // Update status to Running
        {
            let mut st = self.control.status.write().await;
            st.state = MediaIndexJobState::Running;
            st.mode = mode;
            st.started_at_ms = Some(now_epoch_ms());
            st.updated_at_ms = now_epoch_ms();
        }
        let _ = self.control
            .emit_to_primary(MediaIndexEvent::State {
                job_id,
                state: MediaIndexJobState::Running,
            })
            .await;

        // Initialize search scope and cursor
        let (min_id, mut search_cursor, delta_base_id, mut current_newest_id) = match &self.request.initial_state {
            Some(st) => {
                let s = SearchScope {
                    account_id: session_key.clone(),
                    peer_id: peer_id.clone(),
                    topic_id,
                    min_id: if mode == MediaIndexMode::DeltaSync {
                        if st.delta_active && st.delta_base_id > 0 {
                            st.delta_base_id as i32
                        } else {
                            st.newest_committed_id as i32
                        }
                    } else {
                        0
                    },
                };

                let cur = if mode == MediaIndexMode::DeltaSync {
                    if st.delta_active {
                        ScopedMediaSearchCursor {
                            scope: s.clone(),
                            photo_video: LaneCursor {
                                fetch_offset_id: st.delta_pv_committed_offset,
                                exhausted: st.delta_pv_exhausted,
                            },
                            document: LaneCursor {
                                fetch_offset_id: st.delta_doc_committed_offset,
                                exhausted: st.delta_doc_exhausted,
                            },
                            pending_photo_video: Vec::new(),
                            pending_document: Vec::new(),
                        }
                    } else {
                        ScopedMediaSearchCursor {
                            scope: s.clone(),
                            photo_video: LaneCursor { fetch_offset_id: 0, exhausted: false },
                            document: LaneCursor { fetch_offset_id: 0, exhausted: false },
                            pending_photo_video: Vec::new(),
                            pending_document: Vec::new(),
                        }
                    }
                } else {
                    ScopedMediaSearchCursor {
                        scope: s.clone(),
                        photo_video: LaneCursor {
                            fetch_offset_id: st.pv_committed_offset,
                            exhausted: st.pv_exhausted,
                        },
                        document: LaneCursor {
                            fetch_offset_id: st.doc_committed_offset,
                            exhausted: st.doc_exhausted,
                        },
                        pending_photo_video: Vec::new(),
                        pending_document: Vec::new(),
                    }
                };

                let base_id = if mode == MediaIndexMode::DeltaSync {
                    if st.delta_active && st.delta_base_id > 0 {
                        st.delta_base_id
                    } else {
                        st.newest_committed_id
                    }
                } else {
                    0
                };

                (s.min_id as i64, Some(cur), base_id, st.newest_committed_id)
            }
            None => {
                let s = SearchScope {
                    account_id: session_key.clone(),
                    peer_id: peer_id.clone(),
                    topic_id,
                    min_id: 0,
                };
                (0i64, None, 0i64, 0i64)
            }
        };

        let mut ack_counter = 0u64;
        let mut total_emitted = 0u64;
        let mut metrics = MediaIndexMetricsSnapshot::default();
        let governor = Arc::new(tokio::sync::Mutex::new(AdaptiveRateGovernor::new()));
        let dispatch_gate = Arc::new(IndexDispatchGate::new(0));
        let last_ack_completed = Arc::new(tokio::sync::Mutex::new(None));
        let active_guard_backoffs = Arc::new(AtomicU32::new(0));
        let mut last_progress_tick = Instant::now();
        let start_time = Instant::now();
        let mut delta_max_observed_id = current_newest_id;
        let mut pv_candidate_estimate: Option<u64> = None;
        let mut doc_candidate_estimate: Option<u64> = None;

        let observer = Arc::new(WorkerRpcObserver {
            job_id,
            control: self.control.clone(),
            governor: governor.clone(),
            dispatch_gate: dispatch_gate.clone(),
            last_ack_completed: last_ack_completed.clone(),
            active_guard_backoffs: active_guard_backoffs.clone(),
        });

        let guard_control = RpcGuardControl {
            cancel: Some(cancel.clone()),
            observer: Some(observer),
            dispatch_gate: Some(dispatch_gate.clone()),
        };

        let mut state_rx = self.control.state_tx.subscribe();

        // --- Core Pagination Loop with Bounded ACK Backpressure & Replay ---
        let control_ref = self.control.clone();
        let page_source_ref = self.page_source.clone();
        let request_identity = self.request.identity.clone();

        let mut accumulated_files: Vec<MediaFileRow> = Vec::with_capacity(400);
        let mut pending_search_cursor: Option<ScopedMediaSearchCursor> = search_cursor.clone();
        let mut pending_candidate_checkpoint: Option<MediaIndexCheckpointCandidate> = None;
        let mut pending_lane_counts: Option<LaneCounts> = None;
        let mut pending_emitted_watermark: Option<LaneWatermark> = None;
        let mut pending_lane_durability: Option<LaneDurability> = None;
        let mut pending_has_more: bool = true;
        let mut pending_is_complete: bool = false;

        let loop_result: Result<(), MediaIndexJobError> = async {
            loop {
                // 1. Cooperative Pause / Resume Check
                if *state_rx.borrow() == MediaIndexDesiredState::Paused {
                    {
                        let mut st = control_ref.status.write().await;
                        st.state = MediaIndexJobState::UserPaused;
                        st.updated_at_ms = now_epoch_ms();
                    }
                    let _ = control_ref
                        .emit_to_primary(MediaIndexEvent::State {
                            job_id,
                            state: MediaIndexJobState::UserPaused,
                        })
                        .await;

                    while *state_rx.borrow() == MediaIndexDesiredState::Paused {
                        tokio::select! {
                            _ = cancel.cancelled() => {
                                return Err(MediaIndexJobError {
                                    code: "job_cancelled".into(),
                                    message: "Job cancelled while paused".into(),
                                    recoverable: false,
                                });
                            }
                            res = state_rx.changed() => {
                                if res.is_err() {
                                    break;
                                }
                            }
                        }
                    }

                    {
                        let mut st = control_ref.status.write().await;
                        st.state = MediaIndexJobState::Running;
                        st.updated_at_ms = now_epoch_ms();
                    }
                    let _ = control_ref
                        .emit_to_primary(MediaIndexEvent::State {
                            job_id,
                            state: MediaIndexJobState::Running,
                        })
                        .await;
                }

                if cancel.is_cancelled() {
                    return Err(MediaIndexJobError {
                        code: "job_cancelled".into(),
                        message: "Job cancelled".into(),
                        recoverable: false,
                    });
                }

                // 2. Cancellation Check & Shared Dispatch Gate Synchronization
                let max_inflight = {
                    let mut gov = governor.lock().await;
                    gov.before_index_rpc(&cancel).map_err(|e| MediaIndexJobError {
                        code: "job_cancelled".into(),
                        message: e.to_string(),
                        recoverable: false,
                    })?;
                    dispatch_gate.set_spacing_ms(gov.spacing_ms());
                    gov.max_inflight()
                };

                metrics.page_cycles += 1;
                metrics.pages_fetched = Some(metrics.page_cycles);
                let fetch_start = Instant::now();

                let page_res = page_source_ref
                    .next_page(
                        &request_identity,
                        &peer_id,
                        page_size,
                        None,
                        Some(min_id),
                        topic_id,
                        search_cursor.clone(),
                        max_inflight,
                        guard_control.clone(),
                    )
                    .await;

                let page = match page_res {
                    Ok(p) => {
                        // Feed fine-grained lane RPC observations to telemetry and governor
                        {
                            let mut gov = governor.lock().await;
                            for obs in &p.rpc_observations {
                                metrics.search_rpc_calls += 1;
                                metrics.search_rpc_attempts += u64::from(obs.attempts);
                                metrics.successful_search_rpcs += 1;
                                match obs.lane {
                                    SearchLane::PhotoVideo => {
                                        metrics.pv_rpc_calls += 1;
                                        metrics.pv_rows_fetched += obs.rows_received as u64;
                                    }
                                    SearchLane::Document => {
                                        metrics.doc_rpc_calls += 1;
                                        metrics.doc_rows_fetched += obs.rows_received as u64;
                                    }
                                    _ => {}
                                }
                                gov.on_rpc_observation(RpcObservation {
                                    latency_ms: obs.latency_ms,
                                    rows_yielded: obs.rows_received,
                                    was_error: false,
                                });

                                let obs_latency_ms = obs.latency_ms as f64;
                                if metrics.rpc_latency_ewma_ms <= 0.0 {
                                    metrics.rpc_latency_ewma_ms = obs_latency_ms;
                                } else {
                                    metrics.rpc_latency_ewma_ms = (metrics.rpc_latency_ewma_ms * 0.85) + (obs_latency_ms * 0.15);
                                }
                            }

                            metrics.rpc_calls = Some(metrics.search_rpc_calls);
                            metrics.rpc_p50_ms = gov.rpc_p50();
                            metrics.rpc_p95_ms = gov.rpc_p95();
                            metrics.governor_state = gov.state().as_str().to_string();
                            metrics.governor_inflight_limit = gov.max_inflight() as u8;
                            metrics.governor_spacing_ms = gov.spacing_ms();
                            metrics.governor_confidence = gov.confidence();
                            metrics.best_safe_committed_rate = Some(gov.best_safe_committed_rate());
                            metrics.current_sustained_rate = Some(gov.current_sustained_rate());
                            metrics.rate_decay_percent = Some(gov.rate_decay_percent());
                            metrics.db_bound_active = Some(gov.is_db_bound());
                            metrics.resource_bound_active = Some(gov.is_resource_bound());
                        }

                        let total_wall_latency_ms = fetch_start.elapsed().as_millis() as f64;
                        if metrics.page_cycle_wall_ewma_ms.unwrap_or(0.0) <= 0.0 {
                            metrics.page_cycle_wall_ewma_ms = Some(total_wall_latency_ms);
                        } else {
                            metrics.page_cycle_wall_ewma_ms = Some(
                                (metrics.page_cycle_wall_ewma_ms.unwrap_or(total_wall_latency_ms) * 0.85) + (total_wall_latency_ms * 0.15)
                            );
                        }

                        metrics.rpc_ewma_ms = if metrics.search_rpc_calls > 0 {
                            Some(metrics.rpc_latency_ewma_ms)
                        } else {
                            None
                        };

                        if metrics.search_rpc_calls > 0 {
                            metrics.useful_rows_per_search_rpc = (metrics.pv_rows_fetched + metrics.doc_rows_fetched) as f64 / metrics.search_rpc_calls as f64;
                        }
                        if metrics.pv_rpc_calls > 0 {
                            metrics.pv_rows_per_rpc = metrics.pv_rows_fetched as f64 / metrics.pv_rpc_calls as f64;
                        }
                        if metrics.doc_rpc_calls > 0 {
                            metrics.doc_rows_per_rpc = metrics.doc_rows_fetched as f64 / metrics.doc_rpc_calls as f64;
                        }

                        metrics.pending_pv_items = p.search_cursor.as_ref().map(|c| c.pending_photo_video.len()).unwrap_or(0);
                        metrics.pending_doc_items = p.search_cursor.as_ref().map(|c| c.pending_document.len()).unwrap_or(0);
                        metrics.persistence_batch_rows = p.files.len();

                        // Feed resource observation to governor for buffer containment
                        {
                            let mut gov = governor.lock().await;
                            gov.on_resource_observation(
                                metrics.pending_pv_items,
                                metrics.pending_doc_items,
                                metrics.persistence_batch_rows,
                            );
                            metrics.governor_state = gov.state().as_str().to_string();
                            metrics.governor_inflight_limit = gov.max_inflight() as u8;
                            metrics.governor_spacing_ms = gov.spacing_ms();
                            metrics.governor_confidence = gov.confidence();
                            metrics.best_safe_committed_rate = Some(gov.best_safe_committed_rate());
                            metrics.current_sustained_rate = Some(gov.current_sustained_rate());
                            metrics.rate_decay_percent = Some(gov.rate_decay_percent());
                            metrics.db_bound_active = Some(gov.is_db_bound());
                            metrics.resource_bound_active = Some(gov.is_resource_bound());
                            dispatch_gate.set_spacing_ms(gov.spacing_ms());
                        }

                        if let Some(ref counts) = p.lane_counts {
                            if let Some(pv) = counts.photo_video {
                                pv_candidate_estimate = Some(pv as u64);
                            }
                            if let Some(doc) = counts.document {
                                doc_candidate_estimate = Some(doc as u64);
                            }

                            match (pv_candidate_estimate, doc_candidate_estimate) {
                                (Some(pv), Some(doc)) => {
                                    metrics.candidate_total_estimate = Some(pv.saturating_add(doc));
                                }
                                (Some(pv), None) => {
                                    metrics.candidate_total_estimate = Some(pv);
                                }
                                (None, Some(doc)) => {
                                    metrics.candidate_total_estimate = Some(doc);
                                }
                                (None, None) => {}
                            }
                        }
                        p
                    }
                    Err(e) => {
                        let code = e.code();
                        if code == TgErrorCode::Cancelled {
                            return Err(MediaIndexJobError {
                                code: "job_cancelled".into(),
                                message: "Job cancelled".into(),
                                recoverable: false,
                            });
                        }
                        if code == TgErrorCode::FloodWait {
                            let wait_secs = e.flood_wait_secs().unwrap_or(30);
                            let now_ms = now_epoch_ms();
                            let resume_at = now_ms + (u64::from(wait_secs) * 1000);

                            {
                                let mut gov = governor.lock().await;
                                gov.on_flood_wait(wait_secs);
                                metrics.flood_count = gov.flood_count();
                                metrics.governor_state = gov.state().as_str().to_string();
                                metrics.governor_spacing_ms = gov.spacing_ms();
                                metrics.governor_confidence = gov.confidence();
                            }
                            metrics.flood_seconds_total += u64::from(wait_secs);
                            metrics.last_flood_wait_secs = wait_secs;

                            {
                                let mut st = control_ref.status.write().await;
                                st.state = MediaIndexJobState::FloodPaused;
                                st.metrics = metrics.clone();
                                st.updated_at_ms = now_epoch_ms();
                            }
                            let _ = control_ref
                                .emit_to_primary(MediaIndexEvent::Flood {
                                    job_id,
                                    wait_secs,
                                    resume_at_ms: resume_at,
                                })
                                .await;

                            tokio::select! {
                                _ = cancel.cancelled() => {
                                    return Err(MediaIndexJobError {
                                        code: "job_cancelled".into(),
                                        message: "Job cancelled during FloodWait backoff".into(),
                                        recoverable: false,
                                    });
                                }
                                _ = tokio::time::sleep(Duration::from_secs(u64::from(wait_secs))) => {
                                    continue;
                                }
                            }
                        } else {
                            {
                                let mut gov = governor.lock().await;
                                gov.on_rpc_observation(RpcObservation {
                                    latency_ms: fetch_start.elapsed().as_millis() as u64,
                                    rows_yielded: 0,
                                    was_error: true,
                                });
                            }
                            return Err(MediaIndexJobError {
                                code: format!("{:?}", code),
                                message: e.to_string(),
                                recoverable: e.retryable(),
                            });
                        }
                    }
                };

                // Update accumulator state from latest page result
                pending_search_cursor = page.search_cursor.clone();
                pending_lane_counts = page.lane_counts;
                pending_emitted_watermark = page.emitted_watermark;
                pending_lane_durability = page.lane_durability;
                pending_has_more = page.has_more;
                let is_complete = !page.has_more;
                pending_is_complete = is_complete;

                // Track max observed ID in delta mode
                for f in &page.files {
                    if f.id > delta_max_observed_id {
                        delta_max_observed_id = f.id;
                    }
                }

                // Compute latest candidate checkpoint
                let pv_offset = pending_emitted_watermark.as_ref().map(|w| w.photo_video).unwrap_or(0);
                let doc_offset = pending_emitted_watermark.as_ref().map(|w| w.document).unwrap_or(0);
                let pv_drained = pending_lane_durability.as_ref().map(|d| d.photo_video_drained).unwrap_or(false);
                let doc_drained = pending_lane_durability.as_ref().map(|d| d.document_drained).unwrap_or(false);

                let candidate_checkpoint = if mode == MediaIndexMode::DeltaSync {
                    MediaIndexCheckpointCandidate {
                        account_id: session_key.clone(),
                        peer_id: peer_id.clone(),
                        scope_kind: if topic_id.is_some() { "topic".into() } else { "all".into() },
                        topic_id_normalized: normalized_topic,
                        mode: "delta".into(),
                        pv_committed_offset: 0,
                        doc_committed_offset: 0,
                        pv_committed_exhausted: false,
                        doc_committed_exhausted: false,
                        backfill_complete: true,
                        newest_committed_id: if is_complete {
                            Some(delta_max_observed_id.max(current_newest_id))
                        } else {
                            None
                        },
                        delta_active: !is_complete,
                        delta_base_id,
                        delta_pv_committed_offset: pv_offset,
                        delta_doc_committed_offset: doc_offset,
                        delta_pv_committed_exhausted: pv_drained,
                        delta_doc_committed_exhausted: doc_drained,
                        delta_complete: is_complete,
                    }
                } else {
                    MediaIndexCheckpointCandidate {
                        account_id: session_key.clone(),
                        peer_id: peer_id.clone(),
                        scope_kind: if topic_id.is_some() { "topic".into() } else { "all".into() },
                        topic_id_normalized: normalized_topic,
                        mode: "backfill".into(),
                        pv_committed_offset: pv_offset,
                        doc_committed_offset: doc_offset,
                        pv_committed_exhausted: pv_drained,
                        doc_committed_exhausted: doc_drained,
                        backfill_complete: is_complete,
                        newest_committed_id: if is_complete {
                            Some(delta_max_observed_id.max(current_newest_id))
                        } else {
                            None
                        },
                        delta_active: false,
                        delta_base_id: 0,
                        delta_pv_committed_offset: 0,
                        delta_doc_committed_offset: 0,
                        delta_pv_committed_exhausted: false,
                        delta_doc_committed_exhausted: false,
                        delta_complete: false,
                    }
                };
                pending_candidate_checkpoint = Some(candidate_checkpoint);

                accumulated_files.extend(page.files);

                // Determine dynamic commit target from governor:
                // Base 100, adaptive 200/300/400 when DB latency rises
                let commit_target = {
                    let gov = governor.lock().await;
                    let ack_p95 = gov.ack_p95();
                    if ack_p95 < 40 {
                        100
                    } else if ack_p95 < 100 {
                        200
                    } else if ack_p95 < 200 {
                        300
                    } else {
                        400
                    }
                };

                let is_paused_or_cancelled = cancel.is_cancelled() || *state_rx.borrow() == MediaIndexDesiredState::Paused;
                let should_flush = accumulated_files.len() >= commit_target
                    || !pending_has_more
                    || pending_is_complete
                    || is_paused_or_cancelled
                    || accumulated_files.len() >= 400;

                if !should_flush {
                    // Update search_cursor for next fetch and loop immediately without waiting for ACK!
                    search_cursor = pending_search_cursor.clone();
                    continue;
                }

                if accumulated_files.is_empty() && pending_has_more {
                    search_cursor = pending_search_cursor.clone();
                    continue;
                }

                let batch_files = std::mem::take(&mut accumulated_files);
                ack_counter += 1;
                let ack_id = ack_counter;

                total_emitted += batch_files.len() as u64;
                metrics.rows_emitted = total_emitted;

                let elapsed_secs = start_time.elapsed().as_secs_f64().max(0.001);
                metrics.emitted_rows_per_sec = total_emitted as f64 / elapsed_secs;
                metrics.committed_rows_per_sec = metrics.rows_committed as f64 / elapsed_secs;
                metrics.unique_media_per_sec = Some(metrics.emitted_rows_per_sec);
                metrics.search_rpc_per_sec = metrics.search_rpc_calls as f64 / elapsed_secs;
                metrics.rpc_per_sec = Some(metrics.search_rpc_per_sec);

                if let Some(total_est) = metrics.candidate_total_estimate {
                    if total_est > 0 {
                        let pct = (total_emitted as f64 / total_est as f64) * 100.0;
                        metrics.estimated_percent = Some(if pending_is_complete { 100.0 } else { pct.clamp(0.0, 99.5) });
                        if metrics.emitted_rows_per_sec > 0.0 && !pending_is_complete {
                            let rem = total_est.saturating_sub(total_emitted);
                            metrics.estimated_eta_secs = Some((rem as f64 / metrics.emitted_rows_per_sec) as u64);
                        }
                    }
                }

                let page_event = MediaIndexPageEvent {
                    job_id,
                    ack_id,
                    mode,
                    rows: batch_files,
                    candidate_checkpoint: pending_candidate_checkpoint.take().unwrap(),
                    lane_counts: pending_lane_counts.take(),
                    emitted_watermark: pending_emitted_watermark.take(),
                    lane_durability: pending_lane_durability.take(),
                    has_more: pending_has_more,
                    metrics: metrics.clone(),
                };

                // Store pending page and update expected ACK ID
                {
                    let mut pending = control_ref.pending_page.write().await;
                    *pending = Some(PendingPage {
                        ack_id,
                        event: page_event.clone(),
                        emitted_at_ms: now_epoch_ms(),
                    });
                }
                control_ref.expected_ack_id.store(ack_id, Ordering::Release);

                // 3. Emit page and wait for ACK / reattach / timeout
                let sent_ok = control_ref.emit_to_primary(MediaIndexEvent::Page(page_event)).await;

                if sent_ok {
                    let mut st = control_ref.status.write().await;
                    st.state = MediaIndexJobState::WaitingAck;
                    st.expected_ack_id = Some(ack_id);
                    st.metrics = metrics.clone();
                    st.updated_at_ms = now_epoch_ms();
                } else {
                    // Detached: clear primary and enter WaitingFrontend
                    {
                        let mut primary = control_ref.primary_subscriber.write().await;
                        *primary = None;
                    }
                    {
                        let mut st = control_ref.status.write().await;
                        st.state = MediaIndexJobState::WaitingFrontend;
                        st.expected_ack_id = Some(ack_id);
                        st.metrics = metrics.clone();
                        st.updated_at_ms = now_epoch_ms();
                    }
                }

                // 4. Bounded ACK Wait Loop with Reattach & Replay Support
                let ack_emit_start = Instant::now();

                // Wait loop
                let ack: MediaIndexPageAck = loop {
                    let is_waiting_frontend = {
                        let st = control_ref.status.read().await;
                        st.state == MediaIndexJobState::WaitingFrontend
                    };

                    if is_waiting_frontend {
                        tokio::select! {
                            _ = cancel.cancelled() => {
                                return Err(MediaIndexJobError {
                                    code: "job_cancelled".into(),
                                    message: "Job cancelled while awaiting frontend reattach".into(),
                                    recoverable: false,
                                });
                            }
                            _ = control_ref.subscriber_notify.notified() => {
                                {
                                    let mut st = control_ref.status.write().await;
                                    st.state = MediaIndexJobState::WaitingAck;
                                    st.updated_at_ms = now_epoch_ms();
                                }
                                continue;
                            }
                            _ = tokio::time::sleep(FRONTEND_REATTACH_TIMEOUT) => {
                                return Err(MediaIndexJobError {
                                    code: "frontend_detached_timeout".into(),
                                    message: format!("Timed out waiting for frontend reattach on page #{}", ack_id),
                                    recoverable: true,
                                });
                            }
                        }
                    } else {
                        tokio::select! {
                            _ = cancel.cancelled() => {
                                return Err(MediaIndexJobError {
                                    code: "job_cancelled".into(),
                                    message: "Job cancelled while awaiting storage ACK".into(),
                                    recoverable: false,
                                });
                            }
                            _ = tokio::time::sleep(DEFAULT_ACK_TIMEOUT) => {
                                return Err(MediaIndexJobError {
                                    code: "storage_ack_timeout".into(),
                                    message: format!("Frontend timed out acknowledging page #{}", ack_id),
                                    recoverable: true,
                                });
                            }
                            _ = control_ref.subscriber_notify.notified() => {
                                continue;
                            }
                            maybe_ack = self.ack_rx.recv() => {
                                match maybe_ack {
                                    Some(a) if a.ack_id == ack_id => break a,
                                    Some(_) => {
                                        return Err(MediaIndexJobError {
                                            code: "internal_invariant_violation".into(),
                                            message: "Received out-of-order ACK ID from receiver".into(),
                                            recoverable: false,
                                        });
                                    }
                                    None => {
                                        return Err(MediaIndexJobError {
                                            code: "frontend_detached".into(),
                                            message: "ACK channel closed".into(),
                                            recoverable: false,
                                        });
                                    }
                                }
                            }
                        }
                    }
                };

                // Processing received ACK
                let ack_latency_u64 = ack_emit_start.elapsed().as_millis() as u64;
                let ack_latency_ms = ack_latency_u64 as f64;
                if metrics.ack_latency_ewma_ms <= 0.0 {
                    metrics.ack_latency_ewma_ms = ack_latency_ms;
                } else {
                    metrics.ack_latency_ewma_ms = (metrics.ack_latency_ewma_ms * 0.8) + (ack_latency_ms * 0.2);
                }

                match ack.outcome {
                    MediaIndexAckOutcome::Committed => {
                        metrics.rows_committed = total_emitted;
                        let elapsed_secs = start_time.elapsed().as_secs_f64().max(0.001);
                        metrics.committed_rows_per_sec = metrics.rows_committed as f64 / elapsed_secs;
                        metrics.unique_media_per_sec = Some(metrics.committed_rows_per_sec);

                        // Feed durably committed throughput to governor & sync canonical metrics
                        {
                            let mut gov = governor.lock().await;
                            gov.on_ack_committed(
                                ack_latency_u64,
                                metrics.rows_committed,
                                metrics.committed_rows_per_sec,
                            );
                            metrics.ack_p50_ms = gov.ack_p50();
                            metrics.ack_p95_ms = gov.ack_p95();
                            metrics.ack_to_next_rpc_p95_ms = gov.ack_to_next_p95();
                            metrics.ack_to_next_rpc_ewma_ms = gov.ack_to_next_ewma();
                            metrics.ack_latency_p95_ms = Some(metrics.ack_p95_ms);
                            metrics.governor_state = gov.state().as_str().to_string();
                            metrics.governor_inflight_limit = gov.max_inflight() as u8;
                            metrics.governor_spacing_ms = gov.spacing_ms();
                            metrics.governor_confidence = gov.confidence();
                            metrics.best_safe_committed_rate = Some(gov.best_safe_committed_rate());
                            metrics.current_sustained_rate = Some(gov.current_sustained_rate());
                            metrics.rate_decay_percent = Some(gov.rate_decay_percent());
                            metrics.db_bound_active = Some(gov.is_db_bound());
                            metrics.resource_bound_active = Some(gov.is_resource_bound());
                            metrics.flood_count = gov.flood_count();
                            metrics.last_flood_wait_secs = gov.last_flood_wait_secs();
                            dispatch_gate.set_spacing_ms(gov.spacing_ms());
                        }

                        *last_ack_completed.lock().await = Some(Instant::now());

                        if let Some(comm) = ack.committed_state {
                            if comm.newest_committed_id > current_newest_id {
                                current_newest_id = comm.newest_committed_id;
                            }
                        }

                        // Mark ACK processed and clear pending page
                        control_ref.last_processed_ack_id.store(ack_id, Ordering::Release);
                        control_ref.expected_ack_id.store(0, Ordering::Release);
                        {
                            let mut pending = control_ref.pending_page.write().await;
                            *pending = None;
                        }

                        // Periodic progress broadcast (~4 Hz)
                        if last_progress_tick.elapsed() >= PROGRESS_BROADCAST_INTERVAL {
                            last_progress_tick = Instant::now();
                            let prog_event = MediaIndexProgressEvent {
                                job_id,
                                state: MediaIndexJobState::Running,
                                mode,
                                metrics: metrics.clone(),
                            };
                            let _ = control_ref.emit_to_primary(MediaIndexEvent::Progress(prog_event)).await;
                        }

                        {
                            let mut st = control_ref.status.write().await;
                            st.state = MediaIndexJobState::Running;
                            st.expected_ack_id = None;
                            st.metrics = metrics.clone();
                            st.updated_at_ms = now_epoch_ms();
                        }

                        // On ACK Committed: adopt durable checkpoint and cursor in Rust
                        search_cursor = pending_search_cursor.clone();

                        if pending_is_complete || (!pending_has_more && accumulated_files.is_empty()) {
                            break;
                        }
                    }
                    MediaIndexAckOutcome::Failed => {
                        control_ref.last_processed_ack_id.store(ack_id, Ordering::Release);
                        control_ref.expected_ack_id.store(0, Ordering::Release);
                        {
                            let mut pending = control_ref.pending_page.write().await;
                            *pending = None;
                        }
                        return Err(MediaIndexJobError {
                            code: "storage_ack_failed".into(),
                            message: ack.error_code.unwrap_or_else(|| "IndexedDB storage transaction failed".into()),
                            recoverable: false,
                        });
                    }
                }
            }

            Ok(())
        }.await;

        // Terminal state cleanup and event dispatch
        self.control.expected_ack_id.store(0, Ordering::Release);
        self.control.terminal_at_ms.store(now_epoch_ms(), Ordering::Release);

        match loop_result {
            Ok(()) => {
                {
                    let mut st = self.control.status.write().await;
                    st.state = MediaIndexJobState::Completed;
                    st.metrics = metrics.clone();
                    st.updated_at_ms = now_epoch_ms();
                }
                let _ = self.control
                    .emit_to_primary(MediaIndexEvent::Complete(MediaIndexCompleteEvent {
                        job_id,
                        mode,
                        total_emitted_rows: total_emitted,
                        metrics,
                    }))
                    .await;
            }
            Err(e) => {
                let is_cancelled = e.code == "job_cancelled";
                let final_state = if is_cancelled {
                    MediaIndexJobState::Cancelled
                } else {
                    MediaIndexJobState::Failed
                };

                {
                    let mut st = self.control.status.write().await;
                    st.state = final_state;
                    st.terminal_error = Some(e.clone());
                    st.updated_at_ms = now_epoch_ms();
                }

                if is_cancelled {
                    let _ = self.control
                        .emit_to_primary(MediaIndexEvent::State {
                            job_id,
                            state: MediaIndexJobState::Cancelled,
                        })
                        .await;
                } else {
                    let _ = self.control
                        .emit_to_primary(MediaIndexEvent::Failed {
                            job_id,
                            code: e.code,
                            message: e.message,
                            recoverable: e.recoverable,
                        })
                        .await;
                }
            }
        }

        // Safe release of active session lease
        {
            let mut inner = self.inner.write().await;
            if let Some(&active_id) = inner.active_session_jobs.get(&session_key) {
                if active_id == job_id {
                    inner.active_session_jobs.remove(&session_key);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::grammers_ops::media_list::MediaFileRow;
    use super::super::grammers_ops::{LaneRpcObservation, SearchLane};
    use std::sync::atomic::AtomicUsize;

    struct MockMediaPageSource {
        pages: Vec<ListMediaResult>,
        call_count: AtomicUsize,
    }

    #[async_trait]
    impl MediaPageSource for MockMediaPageSource {
        async fn next_page(
            &self,
            _identity: &TelegramIdentity,
            _chat_id: &str,
            _limit: usize,
            _offset_id: Option<i64>,
            _min_id: Option<i64>,
            _topic_id: Option<i64>,
            _search_cursor: Option<ScopedMediaSearchCursor>,
            _max_inflight: usize,
            _guard_control: RpcGuardControl,
        ) -> Result<ListMediaResult, TgError> {
            let idx = self.call_count.fetch_add(1, Ordering::SeqCst);
            if idx < self.pages.len() {
                Ok(self.pages[idx].clone())
            } else {
                Ok(ListMediaResult {
                    status: "ok".into(),
                    folder_id: None,
                    files: Vec::new(),
                    total: 0,
                    page_size: 10,
                    has_more: false,
                    next_offset_id: None,
                    lane_counts: None,
                    emitted_watermark: None,
                    lane_durability: None,
                    total_count: None,
                    backend: "grammers".into(),
                    cached: false,
                    search_cursor: None,
                    rpc_observations: Vec::new(),
                    pv_observation: None,
                    doc_observation: None,
                })
            }
        }
    }

    fn sample_media_row(id: i64) -> MediaFileRow {
        MediaFileRow {
            id,
            folder_id: None,
            name: format!("file_{}.jpg", id),
            size: 2048,
            mime_type: Some("image/jpeg".into()),
            icon_type: "photo".into(),
            created_at: None,
            has_thumb: false,
            as_document: false,
            backend: "grammers".into(),
            thumb_data_url: None,
            topic_id: None,
            identity_source: None,
            peer_id: None,
            account_id: None,
            peer_kind: None,
            peer_username: None,
            grouped_id: None,
            is_saved_messages: None,
            telegram_category: None,
            telegram_subtype: None,
            drive_category: None,
            drive_format: None,
        }
    }

    #[tokio::test]
    async fn test_duplicate_ack_idempotency_already_acked() {
        let manager = MediaIndexJobManager::with_page_source(
            PathBuf::from("dummy"),
            Arc::new(MockMediaPageSource {
                pages: Vec::new(),
                call_count: AtomicUsize::new(0),
            }),
        );

        let req = StartMediaIndexJobRequest {
            client_request_id: "req_ack_test".into(),
            identity: TelegramIdentity {
                session: "test_ack_sess".into(),
                api_id: 12345,
                api_hash: "hash123".into(),
            },
            peer_id: "100123".into(),
            topic_id: None,
            page_size: Some(10),
            initial_state: None,
            force_mode: None,
        };

        let start_res = manager.start_job(req, FnEventSink(|_| true)).await.unwrap();
        let job_id = start_res.job_id;

        let job = {
            let inner = manager.inner.read().await;
            inner.jobs.get(&job_id).cloned().unwrap()
        };

        job.expected_ack_id.store(42, Ordering::Release);

        let ack1 = MediaIndexPageAck {
            job_id,
            ack_id: 42,
            outcome: MediaIndexAckOutcome::Committed,
            committed_state: None,
            error_code: None,
        };

        let res1 = manager.process_ack(ack1.clone()).await;
        assert_eq!(res1, MediaIndexAckResult::Accepted);

        let res2 = manager.process_ack(ack1.clone()).await;
        assert_eq!(res2, MediaIndexAckResult::AlreadyAcked);

        let ack_stale = MediaIndexPageAck {
            job_id,
            ack_id: 41,
            outcome: MediaIndexAckOutcome::Committed,
            committed_state: None,
            error_code: None,
        };
        let res_stale = manager.process_ack(ack_stale).await;
        assert_eq!(res_stale, MediaIndexAckResult::Stale);

        let ack_unexpected = MediaIndexPageAck {
            job_id,
            ack_id: 43,
            outcome: MediaIndexAckOutcome::Committed,
            committed_state: None,
            error_code: None,
        };
        let res_unexp = manager.process_ack(ack_unexpected).await;
        assert_eq!(res_unexp, MediaIndexAckResult::Unexpected);
    }

    #[tokio::test]
    async fn test_32_concurrent_duplicate_acks_exactly_one_accepted() {
        let mock_file = sample_media_row(501);

        let page1 = ListMediaResult {
            status: "ok".into(),
            folder_id: None,
            files: vec![mock_file],
            total: 1,
            page_size: 10,
            has_more: false,
            next_offset_id: None,
            lane_counts: None,
            emitted_watermark: None,
            lane_durability: None,
            total_count: None,
            backend: "grammers".into(),
            cached: false,
            search_cursor: None,
            rpc_observations: vec![LaneRpcObservation {
                lane: SearchLane::PhotoVideo,
                latency_ms: 25,
                wall_latency_ms: 25,
                attempts: 1,
                rows_received: 1,
                candidate_count: Some(1),
            }],
            pv_observation: None,
            doc_observation: None,
        };

        let manager = Arc::new(MediaIndexJobManager::with_page_source(
            PathBuf::from("dummy"),
            Arc::new(MockMediaPageSource {
                pages: vec![page1],
                call_count: AtomicUsize::new(0),
            }),
        ));

        let req = StartMediaIndexJobRequest {
            client_request_id: "req_concurrent_ack".into(),
            identity: TelegramIdentity {
                session: "test_concurrent_sess".into(),
                api_id: 12345,
                api_hash: "hash123".into(),
            },
            peer_id: "100123".into(),
            topic_id: None,
            page_size: Some(10),
            initial_state: None,
            force_mode: None,
        };

        let start_res = manager.start_job(req, FnEventSink(|_| true)).await.unwrap();
        let job_id = start_res.job_id;

        let job = {
            let inner = manager.inner.read().await;
            inner.jobs.get(&job_id).cloned().unwrap()
        };

        // Wait until worker emits page 1 and enters WaitingAck
        for _ in 0..50 {
            let exp = job.expected_ack_id.load(Ordering::Acquire);
            if exp == 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        assert_eq!(job.expected_ack_id.load(Ordering::Acquire), 1);

        let mut handles = Vec::new();
        for _ in 0..32 {
            let mgr = manager.clone();
            let ack = MediaIndexPageAck {
                job_id,
                ack_id: 1,
                outcome: MediaIndexAckOutcome::Committed,
                committed_state: None,
                error_code: None,
            };
            handles.push(tokio::spawn(async move {
                mgr.process_ack(ack).await
            }));
        }

        let mut accepted_count = 0;
        let mut already_acked_count = 0;

        for h in handles {
            let res = h.await.unwrap();
            match res {
                MediaIndexAckResult::Accepted => accepted_count += 1,
                MediaIndexAckResult::AlreadyAcked => already_acked_count += 1,
                other => panic!("Unexpected ACK outcome: {:?}", other),
            }
        }

        assert_eq!(accepted_count, 1, "Exactly one ACK must be Accepted");
        assert_eq!(already_acked_count, 31, "31 duplicate ACKs must be AlreadyAcked");
    }

    #[tokio::test]
    async fn test_atomic_session_exclusivity_concurrent_starts_different_scope() {
        let manager = Arc::new(MediaIndexJobManager::with_page_source(
            PathBuf::from("dummy"),
            Arc::new(MockMediaPageSource {
                pages: Vec::new(),
                call_count: AtomicUsize::new(0),
            }),
        ));

        let req1 = StartMediaIndexJobRequest {
            client_request_id: "req_scope1".into(),
            identity: TelegramIdentity {
                session: "sess_exclusive".into(),
                api_id: 12345,
                api_hash: "hash123".into(),
            },
            peer_id: "peer_A".into(),
            topic_id: None,
            page_size: Some(10),
            initial_state: None,
            force_mode: None,
        };

        let req2 = StartMediaIndexJobRequest {
            client_request_id: "req_scope2".into(),
            identity: TelegramIdentity {
                session: "sess_exclusive".into(),
                api_id: 12345,
                api_hash: "hash123".into(),
            },
            peer_id: "peer_B".into(),
            topic_id: None,
            page_size: Some(10),
            initial_state: None,
            force_mode: None,
        };

        let res1 = manager.start_job(req1, FnEventSink(|_| true)).await;
        assert!(res1.is_ok(), "First job on session must succeed");

        let res2 = manager.start_job(req2, FnEventSink(|_| true)).await;
        assert!(res2.is_err(), "Second job on same session with different scope must fail");
        assert_eq!(res2.err().unwrap().code, TgErrorCode::SessionLocked);
    }

    #[tokio::test]
    async fn test_terminal_job_ttl_pruning_and_client_map_cleanup() {
        let manager = MediaIndexJobManager::with_page_source(
            PathBuf::from("dummy"),
            Arc::new(MockMediaPageSource {
                pages: Vec::new(),
                call_count: AtomicUsize::new(0),
            }),
        );

        let req = StartMediaIndexJobRequest {
            client_request_id: "req_prune_test".into(),
            identity: TelegramIdentity {
                session: "sess_prune".into(),
                api_id: 12345,
                api_hash: "hash123".into(),
            },
            peer_id: "peer_prune".into(),
            topic_id: None,
            page_size: Some(10),
            initial_state: None,
            force_mode: None,
        };

        let start_res = manager.start_job(req, FnEventSink(|_| true)).await.unwrap();
        let job_id = start_res.job_id;

        let job = {
            let inner = manager.inner.read().await;
            inner.jobs.get(&job_id).cloned().unwrap()
        };

        // Simulate job termination 10 minutes ago
        let old_time = now_epoch_ms() - 600_000;
        job.terminal_at_ms.store(old_time, Ordering::Release);

        {
            let mut inner = manager.inner.write().await;
            MediaIndexJobManager::prune_terminal_jobs_locked(&mut inner);

            assert!(!inner.jobs.contains_key(&job_id), "Expired job must be purged from jobs map");
            assert!(!inner.client_request_map.contains_key("req_prune_test"), "Client request map entry must be cleaned up");
            assert!(!inner.active_session_jobs.contains_key("sess_prune"), "Session mapping must be released");
        }
    }

    #[tokio::test]
    async fn test_client_request_idempotency_and_conflict() {
        let manager = MediaIndexJobManager::with_page_source(
            PathBuf::from("dummy"),
            Arc::new(MockMediaPageSource {
                pages: Vec::new(),
                call_count: AtomicUsize::new(0),
            }),
        );

        let req1 = StartMediaIndexJobRequest {
            client_request_id: "uuid_12345".into(),
            identity: TelegramIdentity {
                session: "sess_uuid".into(),
                api_id: 12345,
                api_hash: "hash123".into(),
            },
            peer_id: "peer_same".into(),
            topic_id: Some(10),
            page_size: Some(10),
            initial_state: None,
            force_mode: None,
        };

        let res1 = manager.start_job(req1.clone(), FnEventSink(|_| true)).await.unwrap();
        assert_eq!(res1.reused_existing_job, false);
        assert_eq!(res1.subscriber_id, 1);
        assert_eq!(res1.generation, 1);

        // Same UUID + same scope -> Idempotent reuse with incremented subscriber & generation
        let res2 = manager.start_job(req1, FnEventSink(|_| true)).await.unwrap();
        assert_eq!(res2.reused_existing_job, true);
        assert_eq!(res2.job_id, res1.job_id);
        assert_eq!(res2.subscriber_id, 2);
        assert_eq!(res2.generation, 2);

        // Same UUID + different scope -> Conflict error
        let req3 = StartMediaIndexJobRequest {
            client_request_id: "uuid_12345".into(),
            identity: TelegramIdentity {
                session: "sess_uuid".into(),
                api_id: 12345,
                api_hash: "hash123".into(),
            },
            peer_id: "peer_DIFFERENT".into(),
            topic_id: Some(10),
            page_size: Some(10),
            initial_state: None,
            force_mode: None,
        };

        let res3 = manager.start_job(req3, FnEventSink(|_| true)).await;
        assert!(res3.is_err(), "Same client request ID for different scope must fail");
    }

    #[tokio::test]
    async fn test_attach_and_stale_detach_behavior() {
        let manager = MediaIndexJobManager::with_page_source(
            PathBuf::from("dummy"),
            Arc::new(MockMediaPageSource {
                pages: Vec::new(),
                call_count: AtomicUsize::new(0),
            }),
        );

        let req = StartMediaIndexJobRequest {
            client_request_id: "req_attach_test".into(),
            identity: TelegramIdentity {
                session: "sess_attach".into(),
                api_id: 12345,
                api_hash: "hash123".into(),
            },
            peer_id: "peer_attach".into(),
            topic_id: None,
            page_size: Some(10),
            initial_state: None,
            force_mode: None,
        };

        let start_res = manager.start_job(req, FnEventSink(|_| true)).await.unwrap();
        let job_id = start_res.job_id;

        // Attach subscriber 2 (generation 2)
        let attach_res = manager.attach_channel(job_id, FnEventSink(|_| true)).await.unwrap();
        assert_eq!(attach_res.attached, true);
        assert_eq!(attach_res.generation, 2);
        let sub2_id = attach_res.subscriber_id;

        // Attach subscriber 3 (generation 3)
        let attach_res3 = manager.attach_channel(job_id, FnEventSink(|_| true)).await.unwrap();
        assert_eq!(attach_res3.attached, true);
        assert_eq!(attach_res3.generation, 3);

        // Stale detach from subscriber 2 (gen 2) must be ignored because generation 3 is now primary
        let detach_stale = manager.detach_channel(job_id, sub2_id, 2).await;
        assert_eq!(detach_stale.detached, false);

        // Valid detach from subscriber 3 (gen 3) must succeed
        let detach_valid = manager.detach_channel(job_id, attach_res3.subscriber_id, 3).await;
        assert_eq!(detach_valid.detached, true);
    }

    #[tokio::test]
    async fn test_start_reuse_returns_actual_subscriber_metadata_and_detach_succeeds() {
        let manager = MediaIndexJobManager::with_page_source(
            PathBuf::from("dummy"),
            Arc::new(MockMediaPageSource {
                pages: Vec::new(),
                call_count: AtomicUsize::new(0),
            }),
        );

        let req = StartMediaIndexJobRequest {
            client_request_id: "req_reuse_detach".into(),
            identity: TelegramIdentity {
                session: "sess_reuse_det".into(),
                api_id: 12345,
                api_hash: "hash123".into(),
            },
            peer_id: "peer_reuse_det".into(),
            topic_id: None,
            page_size: Some(10),
            initial_state: None,
            force_mode: None,
        };

        // First start -> subscriber 1, generation 1
        let res1 = manager.start_job(req.clone(), FnEventSink(|_| true)).await.unwrap();
        assert_eq!(res1.reused_existing_job, false);
        assert_eq!(res1.subscriber_id, 1);
        assert_eq!(res1.generation, 1);

        // Second start (reuse) -> subscriber 2, generation 2
        let res2 = manager.start_job(req, FnEventSink(|_| true)).await.unwrap();
        assert_eq!(res2.reused_existing_job, true);
        assert_eq!(res2.subscriber_id, 2);
        assert_eq!(res2.generation, 2);

        // Detaching with reused actual subscriber (2, 2) must succeed
        let detach_res = manager.detach_channel(res2.job_id, res2.subscriber_id, res2.generation).await;
        assert_eq!(detach_res.detached, true);
    }

    #[tokio::test]
    async fn test_ack_claimed_same_scope_start_does_not_replay_page() {
        let manager = Arc::new(MediaIndexJobManager::with_page_source(
            PathBuf::from("dummy"),
            Arc::new(MockMediaPageSource {
                pages: Vec::new(),
                call_count: AtomicUsize::new(0),
            }),
        ));

        let req = StartMediaIndexJobRequest {
            client_request_id: "req_ack_claim_replay".into(),
            identity: TelegramIdentity {
                session: "sess_claim_replay".into(),
                api_id: 12345,
                api_hash: "hash123".into(),
            },
            peer_id: "peer_claim_replay".into(),
            topic_id: None,
            page_size: Some(10),
            initial_state: None,
            force_mode: None,
        };

        let start_res = manager.start_job(req.clone(), FnEventSink(|_| true)).await.unwrap();
        let job_id = start_res.job_id;

        let job = {
            let inner = manager.inner.read().await;
            inner.jobs.get(&job_id).cloned().unwrap()
        };

        // Simulate page 42 waiting for ACK
        let page_event = MediaIndexPageEvent {
            job_id,
            ack_id: 42,
            mode: MediaIndexMode::HistoricalBackfill,
            rows: vec![sample_media_row(42)],
            candidate_checkpoint: MediaIndexCheckpointCandidate {
                account_id: "sess_claim_replay".into(),
                peer_id: "peer_claim_replay".into(),
                scope_kind: "all".into(),
                topic_id_normalized: -1,
                mode: "backfill".into(),
                pv_committed_offset: 42,
                doc_committed_offset: 0,
                pv_committed_exhausted: false,
                doc_committed_exhausted: false,
                backfill_complete: false,
                newest_committed_id: None,
                delta_active: false,
                delta_base_id: 0,
                delta_pv_committed_offset: 0,
                delta_doc_committed_offset: 0,
                delta_pv_committed_exhausted: false,
                delta_doc_committed_exhausted: false,
                delta_complete: false,
            },
            lane_counts: None,
            emitted_watermark: None,
            lane_durability: None,
            has_more: true,
            metrics: MediaIndexMetricsSnapshot::default(),
        };

        {
            let mut p = job.pending_page.write().await;
            *p = Some(PendingPage {
                ack_id: 42,
                event: page_event,
                emitted_at_ms: now_epoch_ms(),
            });
        }
        job.expected_ack_id.store(42, Ordering::Release);

        // Before claim: reuse start should replay page 42
        let reuse1 = manager.start_job(req.clone(), FnEventSink(|_| true)).await.unwrap();
        assert_eq!(reuse1.replayed_ack_id, Some(42));

        // Now claim ACK 42 (e.g. frontend sent ACK)
        let ack_res = manager.process_ack(MediaIndexPageAck {
            job_id,
            ack_id: 42,
            outcome: MediaIndexAckOutcome::Committed,
            committed_state: None,
            error_code: None,
        }).await;
        assert_eq!(ack_res, MediaIndexAckResult::Accepted);
        assert_eq!(job.claimed_ack_id.load(Ordering::Acquire), 42);

        // After claim: reuse start MUST NOT replay page 42 (claimed >= expected)
        let reuse2 = manager.start_job(req, FnEventSink(|_| true)).await.unwrap();
        assert_eq!(reuse2.replayed_ack_id, None, "Page must not replay once claimed");
    }

    #[tokio::test]
    async fn test_waiting_ack_explicit_detach_transitions_to_waiting_frontend_and_notifies() {
        let manager = MediaIndexJobManager::with_page_source(
            PathBuf::from("dummy"),
            Arc::new(MockMediaPageSource {
                pages: Vec::new(),
                call_count: AtomicUsize::new(0),
            }),
        );

        let req = StartMediaIndexJobRequest {
            client_request_id: "req_detach_wf".into(),
            identity: TelegramIdentity {
                session: "sess_detach_wf".into(),
                api_id: 12345,
                api_hash: "hash123".into(),
            },
            peer_id: "peer_detach_wf".into(),
            topic_id: None,
            page_size: Some(10),
            initial_state: None,
            force_mode: None,
        };

        let start_res = manager.start_job(req, FnEventSink(|_| true)).await.unwrap();
        let job_id = start_res.job_id;

        let job = {
            let inner = manager.inner.read().await;
            inner.jobs.get(&job_id).cloned().unwrap()
        };

        // Simulate state in WaitingAck with outstanding page 1
        {
            let mut st = job.status.write().await;
            st.state = MediaIndexJobState::WaitingAck;
        }
        job.expected_ack_id.store(1, Ordering::Release);

        // Explicit detach of primary subscriber (1, 1)
        let detach_res = manager.detach_channel(job_id, 1, 1).await;
        assert_eq!(detach_res.detached, true);

        // Status must transition to WaitingFrontend
        let st = job.status.read().await.clone();
        assert_eq!(st.state, MediaIndexJobState::WaitingFrontend);
    }

    #[tokio::test]
    async fn test_flood_observer_pause_during_flood_emits_user_paused() {
        let (state_tx, _state_rx) = watch::channel(MediaIndexDesiredState::Running);
        let cancel = CancellationToken::new();
        let (ack_tx, _) = mpsc::channel(1);

        let initial_status = MediaIndexJobStatus {
            job_id: 99,
            state: MediaIndexJobState::FloodPaused,
            mode: MediaIndexMode::HistoricalBackfill,
            peer_safe_label: "test".into(),
            topic_id: None,
            created_at_ms: now_epoch_ms(),
            started_at_ms: None,
            updated_at_ms: now_epoch_ms(),
            expected_ack_id: None,
            metrics: MediaIndexMetricsSnapshot::default(),
            terminal_error: None,
        };

        let control = Arc::new(MediaIndexJobControl {
            job_id: 99,
            session_key: "sess".into(),
            client_request_id: "req".into(),
            request_fingerprint: "fp".into(),
            peer_id: "peer".into(),
            topic_id: None,
            created_at_ms: now_epoch_ms(),
            state_tx: state_tx.clone(),
            cancel: cancel.clone(),
            ack_tx,
            expected_ack_id: AtomicU64::new(0),
            claimed_ack_id: AtomicU64::new(0),
            last_processed_ack_id: AtomicU64::new(0),
            primary_subscriber: RwLock::new(None),
            next_subscriber_id: AtomicU64::new(1),
            subscriber_generation: AtomicU64::new(1),
            subscriber_notify: Arc::new(Notify::new()),
            pending_page: RwLock::new(None),
            status: Arc::new(RwLock::new(initial_status)),
            terminal_at_ms: AtomicU64::new(0),
        });

        let observer = WorkerRpcObserver {
            job_id: 99,
            control: control.clone(),
            governor: Arc::new(tokio::sync::Mutex::new(AdaptiveRateGovernor::new())),
            dispatch_gate: Arc::new(IndexDispatchGate::new(0)),
            last_ack_completed: Arc::new(tokio::sync::Mutex::new(None)),
            active_guard_backoffs: Arc::new(AtomicU32::new(1)),
        };

        // User paused while in FloodPaused
        let _ = state_tx.send(MediaIndexDesiredState::Paused);

        // When guard backoff ends, observer must transition to UserPaused (not Running)
        observer.on_guard_backoff_end(1).await;

        let st = control.status.read().await.clone();
        assert_eq!(st.state, MediaIndexJobState::UserPaused);
    }

    #[tokio::test]
    async fn test_flood_observer_cancel_during_flood_does_not_emit_running() {
        let (state_tx, _state_rx) = watch::channel(MediaIndexDesiredState::Running);
        let cancel = CancellationToken::new();
        let (ack_tx, _) = mpsc::channel(1);

        let initial_status = MediaIndexJobStatus {
            job_id: 100,
            state: MediaIndexJobState::FloodPaused,
            mode: MediaIndexMode::HistoricalBackfill,
            peer_safe_label: "test".into(),
            topic_id: None,
            created_at_ms: now_epoch_ms(),
            started_at_ms: None,
            updated_at_ms: now_epoch_ms(),
            expected_ack_id: None,
            metrics: MediaIndexMetricsSnapshot::default(),
            terminal_error: None,
        };

        let control = Arc::new(MediaIndexJobControl {
            job_id: 100,
            session_key: "sess".into(),
            client_request_id: "req".into(),
            request_fingerprint: "fp".into(),
            peer_id: "peer".into(),
            topic_id: None,
            created_at_ms: now_epoch_ms(),
            state_tx,
            cancel: cancel.clone(),
            ack_tx,
            expected_ack_id: AtomicU64::new(0),
            claimed_ack_id: AtomicU64::new(0),
            last_processed_ack_id: AtomicU64::new(0),
            primary_subscriber: RwLock::new(None),
            next_subscriber_id: AtomicU64::new(1),
            subscriber_generation: AtomicU64::new(1),
            subscriber_notify: Arc::new(Notify::new()),
            pending_page: RwLock::new(None),
            status: Arc::new(RwLock::new(initial_status)),
            terminal_at_ms: AtomicU64::new(0),
        });

        let observer = WorkerRpcObserver {
            job_id: 100,
            control: control.clone(),
            governor: Arc::new(tokio::sync::Mutex::new(AdaptiveRateGovernor::new())),
            dispatch_gate: Arc::new(IndexDispatchGate::new(0)),
            last_ack_completed: Arc::new(tokio::sync::Mutex::new(None)),
            active_guard_backoffs: Arc::new(AtomicU32::new(1)),
        };

        // Cancel job
        cancel.cancel();

        // When guard backoff ends on cancelled job, observer must return early and NOT transition to Running
        observer.on_guard_backoff_end(1).await;

        let st = control.status.read().await.clone();
        assert_eq!(st.state, MediaIndexJobState::FloodPaused, "Status must not be overwritten to Running upon cancellation");
    }

    #[tokio::test]
    async fn test_concurrent_dual_lane_flood_backoffs_require_both_to_finish() {
        let (state_tx, _state_rx) = watch::channel(MediaIndexDesiredState::Running);
        let cancel = CancellationToken::new();
        let (ack_tx, _) = mpsc::channel(1);

        let initial_status = MediaIndexJobStatus {
            job_id: 101,
            state: MediaIndexJobState::Running,
            mode: MediaIndexMode::HistoricalBackfill,
            peer_safe_label: "test".into(),
            topic_id: None,
            created_at_ms: now_epoch_ms(),
            started_at_ms: None,
            updated_at_ms: now_epoch_ms(),
            expected_ack_id: None,
            metrics: MediaIndexMetricsSnapshot::default(),
            terminal_error: None,
        };

        let control = Arc::new(MediaIndexJobControl {
            job_id: 101,
            session_key: "sess".into(),
            client_request_id: "req".into(),
            request_fingerprint: "fp".into(),
            peer_id: "peer".into(),
            topic_id: None,
            created_at_ms: now_epoch_ms(),
            state_tx,
            cancel,
            ack_tx,
            expected_ack_id: AtomicU64::new(0),
            claimed_ack_id: AtomicU64::new(0),
            last_processed_ack_id: AtomicU64::new(0),
            primary_subscriber: RwLock::new(None),
            next_subscriber_id: AtomicU64::new(1),
            subscriber_generation: AtomicU64::new(1),
            subscriber_notify: Arc::new(Notify::new()),
            pending_page: RwLock::new(None),
            status: Arc::new(RwLock::new(initial_status)),
            terminal_at_ms: AtomicU64::new(0),
        });

        let dispatch_gate = Arc::new(IndexDispatchGate::new(0));
        let active_guard_backoffs = Arc::new(AtomicU32::new(0));

        let observer = WorkerRpcObserver {
            job_id: 101,
            control: control.clone(),
            governor: Arc::new(tokio::sync::Mutex::new(AdaptiveRateGovernor::new())),
            dispatch_gate: dispatch_gate.clone(),
            last_ack_completed: Arc::new(tokio::sync::Mutex::new(None)),
            active_guard_backoffs: active_guard_backoffs.clone(),
        };

        // 1. Lane 1 (PhotoVideo) enters FloodWait
        observer.on_guard_backoff_start(15, 1700000015000, 1, 3).await;
        assert_eq!(control.status.read().await.state, MediaIndexJobState::FloodPaused);
        assert!(dispatch_gate.spacing_ms() >= 200, "Gate spacing must be updated immediately upon FloodWait");
        assert_eq!(active_guard_backoffs.load(Ordering::SeqCst), 1);

        // 2. Lane 2 (Document) enters concurrent FloodWait
        observer.on_guard_backoff_start(20, 1700000020000, 1, 3).await;
        assert_eq!(control.status.read().await.state, MediaIndexJobState::FloodPaused);
        assert_eq!(active_guard_backoffs.load(Ordering::SeqCst), 2);

        // 3. Lane 1 finishes its backoff early
        observer.on_guard_backoff_end(1).await;
        // Status MUST remain FloodPaused because Lane 2 is still sleeping!
        assert_eq!(control.status.read().await.state, MediaIndexJobState::FloodPaused, "Status must remain FloodPaused while Lane 2 is still in backoff");
        assert_eq!(active_guard_backoffs.load(Ordering::SeqCst), 1);

        // 4. Lane 2 finishes its backoff
        observer.on_guard_backoff_end(1).await;
        // Only now should state transition to Running!
        assert_eq!(control.status.read().await.state, MediaIndexJobState::Running, "Status must transition to Running once ALL concurrent backoffs have completed");
        assert_eq!(active_guard_backoffs.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn test_zero_rpc_buffered_page_telemetry_integrity() {
        let mock_file1 = sample_media_row(100);
        let mock_file2 = sample_media_row(99);

        // Page 1: 1 Telegram RPC with 1 observation and candidate estimate = 250,000
        let page1 = ListMediaResult {
            status: "ok".into(),
            folder_id: None,
            files: vec![mock_file1],
            total: 1,
            page_size: 1,
            has_more: true,
            next_offset_id: Some(100),
            lane_counts: Some(LaneCounts {
                photo_video: Some(150_000),
                document: Some(100_000),
            }),
            emitted_watermark: Some(LaneWatermark { photo_video: 100, document: 0 }),
            lane_durability: None,
            total_count: Some(250_000),
            backend: "grammers".into(),
            cached: false,
            search_cursor: None,
            rpc_observations: vec![LaneRpcObservation {
                lane: SearchLane::PhotoVideo,
                latency_ms: 30,
                wall_latency_ms: 30,
                attempts: 1,
                rows_received: 1,
                candidate_count: Some(150_000),
            }],
            pv_observation: None,
            doc_observation: None,
        };

        // Page 2: 0 Telegram RPCs (served purely from buffered memory) with lane_counts = None
        let page2 = ListMediaResult {
            status: "ok".into(),
            folder_id: None,
            files: vec![mock_file2],
            total: 1,
            page_size: 1,
            has_more: false,
            next_offset_id: None,
            lane_counts: None, // 0-RPC page produces None lane_counts
            emitted_watermark: Some(LaneWatermark { photo_video: 99, document: 0 }),
            lane_durability: None,
            total_count: None,
            backend: "grammers".into(),
            cached: false,
            search_cursor: None,
            rpc_observations: Vec::new(), // 0 observations!
            pv_observation: None,
            doc_observation: None,
        };

        let pages = vec![page1, page2];
        let manager = Arc::new(MediaIndexJobManager::with_page_source(
            PathBuf::from("dummy"),
            Arc::new(MockMediaPageSource {
                pages,
                call_count: AtomicUsize::new(0),
            }),
        ));

        let req = StartMediaIndexJobRequest {
            client_request_id: "req_zero_rpc_test".into(),
            identity: TelegramIdentity {
                session: "sess_zero_rpc".into(),
                api_id: 12345,
                api_hash: "hash".into(),
            },
            peer_id: "100123".into(),
            topic_id: None,
            page_size: Some(1),
            initial_state: None,
            force_mode: None,
        };

        let (tx_events, mut rx_events) = tokio::sync::mpsc::unbounded_channel();
        let start_res = manager.start_job(req, FnEventSink(move |evt| {
            let _ = tx_events.send(evt);
            true
        })).await.unwrap();

        let job_id = start_res.job_id;

        // P4.5 coalesces both source pages into one terminal durable batch.
        // A timeout makes an ACK protocol regression fail instead of hanging.
        let ack1 = loop {
            let evt = tokio::time::timeout(Duration::from_secs(5), rx_events.recv())
                .await
                .expect("timed out waiting for terminal durable page")
                .expect("event channel closed before terminal durable page");
            if let MediaIndexEvent::Page(page) = evt {
                assert_eq!(page.rows.len(), 2, "terminal batch must contain both source pages");
                break page.ack_id;
            }
        };
        manager.process_ack(MediaIndexPageAck {
            job_id,
            ack_id: ack1,
            outcome: MediaIndexAckOutcome::Committed,
            committed_state: None,
            error_code: None,
        }).await;

        // Wait for job completion
        loop {
            let evt = tokio::time::timeout(Duration::from_secs(5), rx_events.recv())
                .await
                .expect("timed out waiting for completion")
                .expect("event channel closed before completion");
            if let MediaIndexEvent::Complete(_) = evt {
                break;
            }
        }

        let job = {
            let inner = manager.inner.read().await;
            inner.jobs.get(&job_id).cloned().unwrap()
        };

        let status = job.status.read().await;
        // Verify: Exactly 1 search RPC was performed across 2 pages!
        assert_eq!(status.metrics.search_rpc_calls, 1, "Zero-RPC page must NOT increment search_rpc_calls (+0)");
        assert_eq!(status.metrics.page_cycles, 2, "Page cycles must advance to 2");
        // Verify: Candidate total estimate was preserved at 250,000 and not overwritten by zero-RPC page!
        assert_eq!(status.metrics.candidate_total_estimate, Some(250_000), "Candidate total estimate must be preserved across zero-RPC buffered page");
    }

    #[tokio::test]
    async fn test_persistent_lane_estimates_and_pure_rpc_telemetry() {
        let f1 = sample_media_row(100);
        let f2 = sample_media_row(99);
        let f3 = sample_media_row(98);
        let f4 = sample_media_row(97);

        // Page 1: FetchBoth (PV=150,000, DOC=100,000) -> Candidate total = 250,000
        let page1 = ListMediaResult {
            status: "ok".into(),
            folder_id: None,
            files: vec![f1],
            total: 1,
            page_size: 1,
            has_more: true,
            next_offset_id: Some(100),
            lane_counts: Some(LaneCounts {
                photo_video: Some(150_000),
                document: Some(100_000),
            }),
            emitted_watermark: Some(LaneWatermark { photo_video: 100, document: 100 }),
            lane_durability: None,
            total_count: Some(250_000),
            backend: "grammers".into(),
            cached: false,
            search_cursor: None,
            rpc_observations: vec![
                LaneRpcObservation {
                    lane: SearchLane::PhotoVideo,
                    latency_ms: 100,
                    wall_latency_ms: 100,
                    attempts: 1,
                    rows_received: 1,
                    candidate_count: Some(150_000),
                },
                LaneRpcObservation {
                    lane: SearchLane::Document,
                    latency_ms: 120,
                    wall_latency_ms: 120,
                    attempts: 1,
                    rows_received: 1,
                    candidate_count: Some(100_000),
                },
            ],
            pv_observation: None,
            doc_observation: None,
        };

        // Page 2: FetchPv only (PV=149,000, DOC not queried -> document = None)
        // Candidate estimate MUST use 149,000 + previous DOC (100,000) = 249,000 (NOT 149,000!)
        let page2 = ListMediaResult {
            status: "ok".into(),
            folder_id: None,
            files: vec![f2],
            total: 1,
            page_size: 1,
            has_more: true,
            next_offset_id: Some(99),
            lane_counts: Some(LaneCounts {
                photo_video: Some(149_000),
                document: None, // Document lane was NOT queried in this page
            }),
            emitted_watermark: Some(LaneWatermark { photo_video: 99, document: 100 }),
            lane_durability: None,
            total_count: Some(149_000),
            backend: "grammers".into(),
            cached: false,
            search_cursor: None,
            rpc_observations: vec![
                LaneRpcObservation {
                    lane: SearchLane::PhotoVideo,
                    latency_ms: 80,
                    wall_latency_ms: 80,
                    attempts: 1,
                    rows_received: 1,
                    candidate_count: Some(149_000),
                },
            ],
            pv_observation: None,
            doc_observation: None,
        };

        // Page 3: 0-RPC buffered page (lane_counts = None, rpc_observations = empty)
        let page3 = ListMediaResult {
            status: "ok".into(),
            folder_id: None,
            files: vec![f3],
            total: 1,
            page_size: 1,
            has_more: true,
            next_offset_id: Some(98),
            lane_counts: None,
            emitted_watermark: Some(LaneWatermark { photo_video: 98, document: 100 }),
            lane_durability: None,
            total_count: None,
            backend: "grammers".into(),
            cached: false,
            search_cursor: None,
            rpc_observations: Vec::new(),
            pv_observation: None,
            doc_observation: None,
        };

        // Page 4: FetchDoc only where document count is 0 (valid known zero)
        // Candidate estimate MUST be 149,000 + 0 = 149,000
        let page4 = ListMediaResult {
            status: "ok".into(),
            folder_id: None,
            files: vec![f4],
            total: 1,
            page_size: 1,
            has_more: false,
            next_offset_id: None,
            lane_counts: Some(LaneCounts {
                photo_video: None, // PV not queried
                document: Some(0), // DOC queried and genuinely has 0 items
            }),
            emitted_watermark: Some(LaneWatermark { photo_video: 98, document: 0 }),
            lane_durability: None,
            total_count: Some(0),
            backend: "grammers".into(),
            cached: false,
            search_cursor: None,
            rpc_observations: vec![
                LaneRpcObservation {
                    lane: SearchLane::Document,
                    latency_ms: 50,
                    wall_latency_ms: 50,
                    attempts: 1,
                    rows_received: 1,
                    candidate_count: Some(0),
                },
            ],
            pv_observation: None,
            doc_observation: None,
        };

        let pages = vec![page1, page2, page3, page4];
        let manager = Arc::new(MediaIndexJobManager::with_page_source(
            PathBuf::from("dummy"),
            Arc::new(MockMediaPageSource {
                pages,
                call_count: AtomicUsize::new(0),
            }),
        ));

        let req = StartMediaIndexJobRequest {
            client_request_id: "req_p432_test".into(),
            identity: TelegramIdentity {
                session: "sess_p432".into(),
                api_id: 12345,
                api_hash: "hash".into(),
            },
            peer_id: "100123".into(),
            topic_id: None,
            page_size: Some(1),
            initial_state: None,
            force_mode: None,
        };

        let (tx_events, mut rx_events) = tokio::sync::mpsc::unbounded_channel();
        let start_res = manager.start_job(req, FnEventSink(move |evt| {
            let _ = tx_events.send(evt);
            true
        })).await.unwrap();

        let job_id = start_res.job_id;

        // Four source pages are intentionally committed as one terminal batch.
        let ack_id = loop {
            let evt = tokio::time::timeout(Duration::from_secs(5), rx_events.recv())
                .await
                .expect("timed out waiting for coalesced durable page")
                .expect("event channel closed before coalesced durable page");
            if let MediaIndexEvent::Page(page) = evt {
                assert_eq!(page.rows.len(), 4, "coalesced page must retain every source row");
                break page.ack_id;
            }
        };
        manager.process_ack(MediaIndexPageAck {
            job_id,
            ack_id,
            outcome: MediaIndexAckOutcome::Committed,
            committed_state: None,
            error_code: None,
        }).await;

        // Wait for complete event
        loop {
            let evt = tokio::time::timeout(Duration::from_secs(5), rx_events.recv())
                .await
                .expect("timed out waiting for completion")
                .expect("event channel closed before completion");
            if let MediaIndexEvent::Complete(_) = evt {
                break;
            }
        }

        let job = {
            let inner = manager.inner.read().await;
            inner.jobs.get(&job_id).cloned().unwrap()
        };

        let status = job.status.read().await;
        // Total search RPC calls: 2 (page 1) + 1 (page 2) + 0 (page 3) + 1 (page 4) = 4 RPCs!
        assert_eq!(status.metrics.search_rpc_calls, 4, "Total actual search RPCs must be 4");
        assert_eq!(status.metrics.page_cycles, 4, "Page cycles must be 4");
        // Final candidate estimate: PV 149k + DOC 0 = 149,000
        assert_eq!(status.metrics.candidate_total_estimate, Some(149_000), "Candidate total estimate must reflect known zero for DOC");
        // Verify pure RPC EWMA is present and positive
        assert!(status.metrics.rpc_latency_ewma_ms > 0.0, "RPC latency EWMA must be computed from pure RPC observations");
        assert!(status.metrics.page_cycle_wall_ewma_ms.is_some(), "Page cycle wall EWMA must be tracked separately");
    }

    #[tokio::test]
    async fn test_adaptive_durable_commit_coalescing_and_terminal_flush() {
        let make_files = |start_id: i64, count: usize| -> Vec<MediaFileRow> {
            (0..count).map(|i| sample_media_row(start_id + i as i64)).collect()
        };

        let make_page = |start_id: i64, count: usize, next_offset: i32, has_more: bool, total_count: Option<usize>| -> ListMediaResult {
            ListMediaResult {
                status: "ok".into(),
                folder_id: None,
                files: make_files(start_id, count),
                total: count,
                page_size: 100,
                has_more,
                next_offset_id: Some(next_offset.into()),
                lane_counts: Some(LaneCounts { photo_video: Some(237), document: Some(0) }),
                emitted_watermark: Some(LaneWatermark { photo_video: next_offset, document: 0 }),
                lane_durability: None,
                total_count,
                backend: "grammers".into(),
                cached: false,
                search_cursor: None,
                rpc_observations: vec![LaneRpcObservation {
                    lane: SearchLane::PhotoVideo,
                    latency_ms: 50,
                    wall_latency_ms: 50,
                    attempts: 1,
                    rows_received: count,
                    candidate_count: Some(237),
                }],
                pv_observation: None,
                doc_observation: None,
            }
        };

        // 4 sub-pages of 50 items each (= 200 items), then 1 terminal page of 37 items (= 237 total)
        let page1 = make_page(1, 50, 50, true, Some(237));
        let page2 = make_page(51, 50, 100, true, Some(237));
        let page3 = make_page(101, 50, 150, true, Some(237));
        let page4 = make_page(151, 50, 200, true, Some(237));
        let terminal_page = make_page(201, 37, 237, false, Some(237));

        let mock_source = Arc::new(MockMediaPageSource {
            pages: vec![page1, page2, page3, page4, terminal_page],
            call_count: AtomicUsize::new(0),
        });

        let manager = MediaIndexJobManager::with_page_source(PathBuf::from("dummy"), mock_source);
        let req = StartMediaIndexJobRequest {
            client_request_id: "req_coalesce_test".into(),
            identity: TelegramIdentity { session: "s".into(), api_id: 1, api_hash: "h".into() },
            peer_id: "peer_coalesce".into(),
            topic_id: None,
            page_size: Some(100),
            initial_state: None,
            force_mode: None,
        };

        let (tx_events, mut rx_events) = tokio::sync::mpsc::unbounded_channel();
        let start_res = manager.start_job(req, FnEventSink(move |evt| {
            let _ = tx_events.send(evt);
            true
        })).await.unwrap();

        let job_id = start_res.job_id;
        let mut emitted_page_events = Vec::new();

        while let Some(evt) = rx_events.recv().await {
            match evt {
                MediaIndexEvent::Page(p) => {
                    let ack_id = p.ack_id;
                    emitted_page_events.push(p);
                    manager.process_ack(MediaIndexPageAck {
                        job_id,
                        ack_id,
                        outcome: MediaIndexAckOutcome::Committed,
                        committed_state: None,
                        error_code: None,
                    }).await;
                }
                MediaIndexEvent::Complete(_) => break,
                _ => {}
            }
        }

        // With base commit_target = 100:
        // Batch 1: 50 + 50 = 100 rows
        // Batch 2: 50 + 50 = 100 rows
        // Batch 3: 37 rows (terminal flush!)
        assert_eq!(emitted_page_events.len(), 3, "Coalescer must emit exactly 3 durable batches for 237 total items");
        assert_eq!(emitted_page_events[0].rows.len(), 100);
        assert_eq!(emitted_page_events[1].rows.len(), 100);
        assert_eq!(emitted_page_events[2].rows.len(), 37, "Terminal partial tail must cleanly flush without hanging");

        let job = {
            let inner = manager.inner.read().await;
            inner.jobs.get(&job_id).cloned().unwrap()
        };
        let status = job.status.read().await;
        assert_eq!(status.metrics.rows_committed, 237, "Exact 237 rows must be durably committed");
        assert_eq!(status.metrics.search_rpc_calls, 5, "Total search RPCs must match the 5 sub-fetches");
    }
}
