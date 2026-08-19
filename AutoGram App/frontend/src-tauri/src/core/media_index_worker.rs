//! media_index_worker.rs — Long-Running Rust Media Index & Sync Worker (P3)
//!
//! Orchestrates Telegram MTProto pagination, K-way buffered merge, rate gating,
//! bounded ACK backpressure synchronization, and lifecycle control in pure Tokio async.
//! Authoritative storage and checkpoint truth remain in IndexedDB.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use tokio::sync::{mpsc, watch, RwLock};
use tokio_util::sync::CancellationToken;

use super::grammers_ops::media_list::{
    list_media_page_async, LaneCounts, LaneCursor, LaneDurability, LaneWatermark, ListMediaResult,
    ScopedMediaSearchCursor, SearchScope,
};
use super::media_index_types::*;
use super::telegram_ops::TelegramIdentity;
use super::tg_error::{TgError, TgErrorCode, TgErrorPublic};
use super::tg_log;

/// Default timeout for waiting on frontend storage ACK before marking job failed/detached.
const DEFAULT_ACK_TIMEOUT: Duration = Duration::from_secs(120);

/// Progress event broadcast throttle interval (~4 Hz).
const PROGRESS_BROADCAST_INTERVAL: Duration = Duration::from_millis(250);

/// Maximum retention duration for terminal (Completed/Cancelled/Failed) jobs in memory.
const TERMINAL_JOB_TTL: Duration = Duration::from_secs(300);

/// Maximum number of terminal job records retained before forced eviction.
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

/// Thread-safe control handles for an active or recent indexing job.
pub struct MediaIndexJobControl {
    pub job_id: u64,
    pub session_key: String,
    pub client_request_id: String,
    pub peer_id: String,
    pub topic_id: Option<i64>,
    pub created_at_ms: u64,
    pub state_tx: watch::Sender<MediaIndexDesiredState>,
    pub cancel: CancellationToken,
    pub ack_tx: mpsc::Sender<MediaIndexPageAck>,
    pub status: Arc<RwLock<MediaIndexJobStatus>>,
    pub last_expected_ack: AtomicU64,
    pub terminal_at: Arc<RwLock<Option<Instant>>>,
}

/// Global thread-safe manager for all active and recent indexing jobs in Tauri state.
pub struct MediaIndexJobManager {
    jobs: Arc<RwLock<HashMap<u64, Arc<MediaIndexJobControl>>>>,
    active_session_jobs: Arc<RwLock<HashMap<String, u64>>>,
    client_request_map: Arc<RwLock<HashMap<String, u64>>>,
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
            jobs: Arc::new(RwLock::new(HashMap::new())),
            active_session_jobs: Arc::new(RwLock::new(HashMap::new())),
            client_request_map: Arc::new(RwLock::new(HashMap::new())),
            next_job_id: AtomicU64::new(1),
            sessions_dir,
            page_source,
        }
    }

    /// Prunes expired terminal jobs to prevent unbounded memory growth.
    async fn prune_terminal_jobs_locked(&self, jobs: &mut HashMap<u64, Arc<MediaIndexJobControl>>) {
        let now = Instant::now();
        if jobs.len() > MAX_TERMINAL_JOBS {
            let mut expired = Vec::new();
            for (&id, ctrl) in jobs.iter() {
                if let Some(term_at) = *ctrl.terminal_at.read().await {
                    if now.duration_since(term_at) > TERMINAL_JOB_TTL || jobs.len() - expired.len() > MAX_TERMINAL_JOBS {
                        expired.push(id);
                    }
                }
            }
            for id in expired {
                jobs.remove(&id);
            }
        }
    }

    /// Starts a new media index job or returns the active job if already running idempotently.
    pub async fn start_job<F>(
        &self,
        request: StartMediaIndexJobRequest,
        event_sink: F,
    ) -> Result<StartMediaIndexJobResponse, TgErrorPublic>
    where
        F: Fn(MediaIndexEvent) -> bool + Send + Sync + 'static,
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

        // 2. Check client_request_id and active session exclusivity
        {
            let req_map = self.client_request_map.read().await;
            if let Some(&existing_id) = req_map.get(&client_req_id) {
                let jobs = self.jobs.read().await;
                if let Some(ctrl) = jobs.get(&existing_id) {
                    let st = ctrl.status.read().await.clone();
                    if st.state != MediaIndexJobState::Completed
                        && st.state != MediaIndexJobState::Cancelled
                        && st.state != MediaIndexJobState::Failed
                    {
                        return Ok(StartMediaIndexJobResponse {
                            job_id: existing_id,
                            state: st.state,
                            reused_existing_job: true,
                        });
                    }
                }
            }
        }

        {
            let active_sessions = self.active_session_jobs.read().await;
            if let Some(&existing_id) = active_sessions.get(&session_key) {
                let jobs = self.jobs.read().await;
                if let Some(ctrl) = jobs.get(&existing_id) {
                    let st = ctrl.status.read().await.clone();
                    if ctrl.peer_id == request.peer_id && ctrl.topic_id == request.topic_id {
                        return Ok(StartMediaIndexJobResponse {
                            job_id: existing_id,
                            state: st.state,
                            reused_existing_job: true,
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
        }

        let job_id = self.next_job_id.fetch_add(1, Ordering::SeqCst);
        let (state_tx, state_rx) = watch::channel(MediaIndexDesiredState::Running);
        let (ack_tx, ack_rx) = mpsc::channel(16);
        let cancel = CancellationToken::new();
        let terminal_at = Arc::new(RwLock::new(None));

        let initial_mode = derive_job_mode(&request.initial_state, request.force_mode);
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

        let status_arc = Arc::new(RwLock::new(initial_status));

        let control = Arc::new(MediaIndexJobControl {
            job_id,
            session_key: session_key.clone(),
            client_request_id: client_req_id.clone(),
            peer_id: request.peer_id.clone(),
            topic_id: request.topic_id,
            created_at_ms: now_epoch_ms(),
            state_tx,
            cancel: cancel.clone(),
            ack_tx,
            status: status_arc.clone(),
            last_expected_ack: AtomicU64::new(0),
            terminal_at: terminal_at.clone(),
        });

        // Register job
        {
            let mut jobs = self.jobs.write().await;
            self.prune_terminal_jobs_locked(&mut jobs).await;
            jobs.insert(job_id, control.clone());
        }
        {
            let mut active_sessions = self.active_session_jobs.write().await;
            active_sessions.insert(session_key.clone(), job_id);
        }
        if !client_req_id.is_empty() {
            let mut req_map = self.client_request_map.write().await;
            req_map.insert(client_req_id, job_id);
        }

        // Spawn Tokio worker task
        let worker = MediaIndexWorker {
            job_id,
            request,
            control: control.clone(),
            page_source: self.page_source.clone(),
            state_rx,
            ack_rx,
            event_sink: Box::new(event_sink),
            active_sessions: self.active_session_jobs.clone(),
        };

        tokio::spawn(async move {
            worker.run().await;
        });

        Ok(StartMediaIndexJobResponse {
            job_id,
            state: MediaIndexJobState::Preparing,
            reused_existing_job: false,
        })
    }

    /// Dispatches a storage ACK from the frontend to the matching job worker.
    pub async fn process_ack(&self, ack: MediaIndexPageAck) -> MediaIndexAckResult {
        let job = {
            let jobs = self.jobs.read().await;
            jobs.get(&ack.job_id).cloned()
        };

        let Some(job) = job else {
            return MediaIndexAckResult::JobTerminal;
        };

        let expected = job.last_expected_ack.load(Ordering::SeqCst);
        if expected == 0 {
            return MediaIndexAckResult::JobTerminal;
        }

        if ack.ack_id < expected {
            return MediaIndexAckResult::Stale;
        }
        if ack.ack_id > expected {
            return MediaIndexAckResult::Unexpected;
        }

        // Send ACK to worker
        if job.ack_tx.send(ack).await.is_err() {
            return MediaIndexAckResult::JobTerminal;
        }

        MediaIndexAckResult::Accepted
    }

    /// Pauses an active job before its next Telegram RPC.
    pub async fn pause_job(&self, job_id: u64) -> MediaIndexControlResponse {
        let job = {
            let jobs = self.jobs.read().await;
            jobs.get(&job_id).cloned()
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
            let jobs = self.jobs.read().await;
            jobs.get(&job_id).cloned()
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
            let jobs = self.jobs.read().await;
            jobs.get(&job_id).cloned()
        };

        let Some(job) = job else {
            return MediaIndexControlResponse {
                job_id,
                accepted: false,
                state: MediaIndexJobState::Cancelled,
            };
        };

        job.cancel.cancel();
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
            let jobs = self.jobs.read().await;
            jobs.get(&job_id).cloned()
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

/// Long-running Tokio worker instance for a single media index job.
pub struct MediaIndexWorker {
    job_id: u64,
    request: StartMediaIndexJobRequest,
    control: Arc<MediaIndexJobControl>,
    page_source: Arc<dyn MediaPageSource>,
    state_rx: watch::Receiver<MediaIndexDesiredState>,
    ack_rx: mpsc::Receiver<MediaIndexPageAck>,
    event_sink: Box<dyn Fn(MediaIndexEvent) -> bool + Send + Sync>,
    active_sessions: Arc<RwLock<HashMap<String, u64>>>,
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
        (self.event_sink)(MediaIndexEvent::State {
            job_id,
            state: MediaIndexJobState::Running,
        });

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
        let mut last_progress_tick = Instant::now();
        let start_time = Instant::now();

        let mut delta_max_observed_id = current_newest_id;

        // --- Core Pagination Loop with Bounded ACK Backpressure ---
        let loop_result: Result<(), MediaIndexJobError> = async {
            loop {
                // 1. Cancellation Check
                if cancel.is_cancelled() {
                    return Err(MediaIndexJobError {
                        code: "job_cancelled".into(),
                        message: "Job cancelled by user".into(),
                        recoverable: false,
                    });
                }

                // 2. Pause Handling
                if *self.state_rx.borrow() == MediaIndexDesiredState::Paused {
                    {
                        let mut st = self.control.status.write().await;
                        st.state = MediaIndexJobState::UserPaused;
                        st.updated_at_ms = now_epoch_ms();
                    }
                    (self.event_sink)(MediaIndexEvent::State {
                        job_id,
                        state: MediaIndexJobState::UserPaused,
                    });

                    // Wait until resumed or cancelled
                    tokio::select! {
                        _ = cancel.cancelled() => {
                            return Err(MediaIndexJobError {
                                code: "job_cancelled".into(),
                                message: "Job cancelled while paused".into(),
                                recoverable: false,
                            });
                        }
                        res = self.state_rx.wait_for(|st| *st == MediaIndexDesiredState::Running) => {
                            if res.is_err() {
                                return Err(MediaIndexJobError {
                                    code: "frontend_detached".into(),
                                    message: "State channel closed".into(),
                                    recoverable: false,
                                });
                            }
                        }
                    }

                    {
                        let mut st = self.control.status.write().await;
                        st.state = MediaIndexJobState::Running;
                        st.updated_at_ms = now_epoch_ms();
                    }
                    (self.event_sink)(MediaIndexEvent::State {
                        job_id,
                        state: MediaIndexJobState::Running,
                    });
                }

                // 3. Fetch next page asynchronously from page source
                let fetch_start = Instant::now();
                metrics.rpc_calls += 1;

                let page_res = tokio::select! {
                    _ = cancel.cancelled() => {
                        return Err(MediaIndexJobError {
                            code: "job_cancelled".into(),
                            message: "Job cancelled before RPC".into(),
                            recoverable: false,
                        });
                    }
                    res = self.page_source.next_page(
                        &self.request.identity,
                        &peer_id,
                        page_size,
                        None,
                        if min_id > 0 { Some(min_id) } else { None },
                        topic_id,
                        search_cursor.clone(),
                    ) => res
                };

                let page = match page_res {
                    Ok(p) => p,
                    Err(ref e) if e.flood_wait_secs().is_some() => {
                        let secs = e.flood_wait_secs().unwrap();
                        metrics.flood_count += 1;
                        metrics.flood_seconds_total += secs as u64;

                        {
                            let mut st = self.control.status.write().await;
                            st.state = MediaIndexJobState::FloodPaused;
                            st.updated_at_ms = now_epoch_ms();
                        }
                        let resume_at = now_epoch_ms() + (secs as u64 * 1000);
                        (self.event_sink)(MediaIndexEvent::Flood {
                            job_id,
                            wait_secs: secs,
                            resume_at_ms: resume_at,
                        });

                        // Sleep for FloodWait duration with cancellation awareness
                        tokio::select! {
                            _ = cancel.cancelled() => {
                                return Err(MediaIndexJobError {
                                    code: "job_cancelled".into(),
                                    message: "Job cancelled during FloodWait".into(),
                                    recoverable: false,
                                });
                            }
                            _ = tokio::time::sleep(Duration::from_secs(secs as u64 + 1)) => {
                                {
                                    let mut st = self.control.status.write().await;
                                    st.state = MediaIndexJobState::Running;
                                    st.updated_at_ms = now_epoch_ms();
                                }
                                (self.event_sink)(MediaIndexEvent::State {
                                    job_id,
                                    state: MediaIndexJobState::Running,
                                });
                                continue;
                            }
                        }
                    }
                    Err(e) => {
                        return Err(MediaIndexJobError {
                            code: "telegram_rpc_failed".into(),
                            message: e.to_string(),
                            recoverable: false,
                        });
                    }
                };

                let rpc_latency_ms = fetch_start.elapsed().as_millis() as f64;
                if metrics.rpc_ewma_ms <= 0.0 {
                    metrics.rpc_ewma_ms = rpc_latency_ms;
                } else {
                    metrics.rpc_ewma_ms = (metrics.rpc_ewma_ms * 0.8) + (rpc_latency_ms * 0.2);
                }
                metrics.pages_fetched += 1;

                // Update candidate estimate
                if let Some(total_est) = page.total_count {
                    metrics.candidate_total_estimate = Some(total_est as u64);
                }

                // Update search cursor from page result
                search_cursor = page.search_cursor.clone();

                // Compute candidate checkpoint
                let pv_offset = page.emitted_watermark.as_ref().map(|w| w.photo_video).unwrap_or(0);
                let doc_offset = page.emitted_watermark.as_ref().map(|w| w.document).unwrap_or(0);
                let pv_drained = page.lane_durability.as_ref().map(|d| d.photo_video_drained).unwrap_or(false);
                let doc_drained = page.lane_durability.as_ref().map(|d| d.document_drained).unwrap_or(false);
                let is_complete = !page.has_more;

                // Track max observed ID in delta mode
                for f in &page.files {
                    if f.id > delta_max_observed_id {
                        delta_max_observed_id = f.id;
                    }
                }

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

                ack_counter += 1;
                let ack_id = ack_counter;
                self.control.last_expected_ack.store(ack_id, Ordering::SeqCst);

                total_emitted += page.files.len() as u64;
                metrics.rows_emitted = total_emitted;

                let elapsed_secs = start_time.elapsed().as_secs_f64().max(0.001);
                metrics.unique_media_per_sec = total_emitted as f64 / elapsed_secs;
                metrics.rpc_per_sec = metrics.rpc_calls as f64 / elapsed_secs;

                if let Some(total_est) = metrics.candidate_total_estimate {
                    if total_est > 0 {
                        let pct = (total_emitted as f64 / total_est as f64) * 100.0;
                        metrics.estimated_percent = Some(if is_complete { 100.0 } else { pct.clamp(0.0, 99.5) });
                        if metrics.unique_media_per_sec > 0.0 && !is_complete {
                            let rem = total_est.saturating_sub(total_emitted);
                            metrics.estimated_eta_secs = Some((rem as f64 / metrics.unique_media_per_sec) as u64);
                        }
                    }
                }

                let page_event = MediaIndexPageEvent {
                    job_id,
                    ack_id,
                    mode,
                    rows: page.files,
                    candidate_checkpoint,
                    lane_counts: page.lane_counts,
                    emitted_watermark: page.emitted_watermark,
                    lane_durability: page.lane_durability,
                    has_more: page.has_more,
                    metrics: metrics.clone(),
                };

                // 4. Emit page to frontend channel
                let sent_ok = (self.event_sink)(MediaIndexEvent::Page(page_event));
                if !sent_ok {
                    return Err(MediaIndexJobError {
                        code: "frontend_detached".into(),
                        message: "Tauri IPC Channel send failed (frontend detached)".into(),
                        recoverable: false,
                    });
                }

                // 5. Transition to WaitingAck & block until ACK is received
                {
                    let mut st = self.control.status.write().await;
                    st.state = MediaIndexJobState::WaitingAck;
                    st.expected_ack_id = Some(ack_id);
                    st.metrics = metrics.clone();
                    st.updated_at_ms = now_epoch_ms();
                }

                let ack_emit_start = Instant::now();

                let ack = tokio::select! {
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
                    maybe_ack = self.ack_rx.recv() => {
                        match maybe_ack {
                            Some(a) if a.ack_id == ack_id => a,
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
                };

                let ack_latency_ms = ack_emit_start.elapsed().as_millis() as f64;
                if metrics.ack_latency_ewma_ms <= 0.0 {
                    metrics.ack_latency_ewma_ms = ack_latency_ms;
                } else {
                    metrics.ack_latency_ewma_ms = (metrics.ack_latency_ewma_ms * 0.8) + (ack_latency_ms * 0.2);
                }

                match ack.outcome {
                    MediaIndexAckOutcome::Committed => {
                        metrics.rows_committed = total_emitted;
                        if let Some(comm) = ack.committed_state {
                            if comm.newest_committed_id > current_newest_id {
                                current_newest_id = comm.newest_committed_id;
                            }
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
                            (self.event_sink)(MediaIndexEvent::Progress(prog_event));
                        }

                        {
                            let mut st = self.control.status.write().await;
                            st.state = MediaIndexJobState::Running;
                            st.expected_ack_id = None;
                            st.metrics = metrics.clone();
                            st.updated_at_ms = now_epoch_ms();
                        }

                        // Completion break
                        if !page.has_more {
                            break;
                        }
                    }
                    MediaIndexAckOutcome::Failed => {
                        return Err(MediaIndexJobError {
                            code: "storage_ack_failed".into(),
                            message: ack.error_code.unwrap_or_else(|| "IndexedDB storage transaction failed".into()),
                            recoverable: false,
                        });
                    }
                }
            }
            Ok(())
        }
        .await;

        // Finalize state
        let final_now = Instant::now();
        *self.control.terminal_at.write().await = Some(final_now);

        match loop_result {
            Ok(()) => {
                metrics.estimated_percent = Some(100.0);
                metrics.estimated_eta_secs = Some(0);

                let comp_event = MediaIndexCompleteEvent {
                    job_id,
                    mode,
                    total_emitted_rows: total_emitted,
                    metrics: metrics.clone(),
                };
                (self.event_sink)(MediaIndexEvent::Complete(comp_event));

                let mut st = self.control.status.write().await;
                st.state = MediaIndexJobState::Completed;
                st.metrics = metrics;
                st.updated_at_ms = now_epoch_ms();
            }
            Err(e) => {
                if e.code == "job_cancelled" {
                    (self.event_sink)(MediaIndexEvent::State {
                        job_id,
                        state: MediaIndexJobState::Cancelled,
                    });
                    let mut st = self.control.status.write().await;
                    st.state = MediaIndexJobState::Cancelled;
                    st.updated_at_ms = now_epoch_ms();
                } else {
                    (self.event_sink)(MediaIndexEvent::Failed {
                        job_id,
                        code: e.code.clone(),
                        message: e.message.clone(),
                        recoverable: e.recoverable,
                    });
                    let mut st = self.control.status.write().await;
                    st.state = MediaIndexJobState::Failed;
                    st.terminal_error = Some(e);
                    st.updated_at_ms = now_epoch_ms();
                }
            }
        }

        // Release session exclusivity lease
        {
            let mut active = self.active_sessions.write().await;
            if active.get(&session_key) == Some(&job_id) {
                active.remove(&session_key);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct MockMediaPageSource {
        pages: Mutex<Vec<ListMediaResult>>,
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
        ) -> Result<ListMediaResult, TgError> {
            let mut guard = self.pages.lock().unwrap();
            if guard.is_empty() {
                Ok(ListMediaResult {
                    status: "ok".into(),
                    folder_id: None,
                    files: vec![],
                    total: 0,
                    page_size: 100,
                    has_more: false,
                    next_offset_id: None,
                    search_cursor: None,
                    lane_counts: None,
                    emitted_watermark: None,
                    lane_durability: None,
                    total_count: Some(0),
                    backend: "mock".into(),
                    cached: false,
                })
            } else {
                Ok(guard.remove(0))
            }
        }
    }

    #[tokio::test]
    async fn test_media_index_state_machine_flow() {
        let mock_pages = vec![
            ListMediaResult {
                status: "ok".into(),
                folder_id: None,
                files: vec![],
                total: 0,
                page_size: 100,
                has_more: true,
                next_offset_id: None,
                search_cursor: None,
                lane_counts: None,
                emitted_watermark: Some(LaneWatermark { photo_video: 50, document: 0 }),
                lane_durability: None,
                total_count: Some(200),
                backend: "mock".into(),
                cached: false,
            },
            ListMediaResult {
                status: "ok".into(),
                folder_id: None,
                files: vec![],
                total: 0,
                page_size: 100,
                has_more: false,
                next_offset_id: None,
                search_cursor: None,
                lane_counts: None,
                emitted_watermark: Some(LaneWatermark { photo_video: 10, document: 0 }),
                lane_durability: None,
                total_count: Some(200),
                backend: "mock".into(),
                cached: false,
            },
        ];

        let page_source = Arc::new(MockMediaPageSource {
            pages: Mutex::new(mock_pages),
        });

        let manager = MediaIndexJobManager::with_page_source(PathBuf::from("sessions"), page_source);

        let req = StartMediaIndexJobRequest {
            client_request_id: "req_1".into(),
            identity: TelegramIdentity {
                session: "test_session".into(),
                api_id: 12345,
                api_hash: "hash".into(),
            },
            peer_id: "-100123".into(),
            topic_id: None,
            page_size: Some(100),
            initial_state: None,
            force_mode: None,
        };

        let events = Arc::new(Mutex::new(Vec::new()));
        let events_clone = events.clone();

        let resp = manager
            .start_job(req, move |evt| {
                events_clone.lock().unwrap().push(evt);
                true
            })
            .await
            .unwrap();

        assert_eq!(resp.job_id, 1);

        // Wait for page 1
        tokio::time::sleep(Duration::from_millis(50)).await;

        // ACK page 1
        let ack1_res = manager
            .process_ack(MediaIndexPageAck {
                job_id: 1,
                ack_id: 1,
                outcome: MediaIndexAckOutcome::Committed,
                committed_state: None,
                error_code: None,
            })
            .await;
        assert_eq!(ack1_res, MediaIndexAckResult::Accepted);

        // Wait for page 2
        tokio::time::sleep(Duration::from_millis(50)).await;

        // ACK page 2
        let ack2_res = manager
            .process_ack(MediaIndexPageAck {
                job_id: 1,
                ack_id: 2,
                outcome: MediaIndexAckOutcome::Committed,
                committed_state: None,
                error_code: None,
            })
            .await;
        assert_eq!(ack2_res, MediaIndexAckResult::Accepted);

        // Wait for completion
        tokio::time::sleep(Duration::from_millis(50)).await;

        let status = manager.get_job_status(1).await.unwrap();
        assert_eq!(status.state, MediaIndexJobState::Completed);
    }

    #[tokio::test]
    async fn test_session_exclusivity() {
        let page_source = Arc::new(MockMediaPageSource {
            pages: Mutex::new(vec![]),
        });

        let manager = MediaIndexJobManager::with_page_source(PathBuf::from("sessions"), page_source);

        let req1 = StartMediaIndexJobRequest {
            client_request_id: "req_1".into(),
            identity: TelegramIdentity {
                session: "exclusive_session".into(),
                api_id: 12345,
                api_hash: "hash".into(),
            },
            peer_id: "-100123".into(),
            topic_id: None,
            page_size: Some(100),
            initial_state: None,
            force_mode: None,
        };

        let req2 = StartMediaIndexJobRequest {
            client_request_id: "req_2".into(),
            identity: TelegramIdentity {
                session: "exclusive_session".into(),
                api_id: 12345,
                api_hash: "hash".into(),
            },
            peer_id: "-100456".into(),
            topic_id: None,
            page_size: Some(100),
            initial_state: None,
            force_mode: None,
        };

        let r1 = manager.start_job(req1, |_| true).await;
        assert!(r1.is_ok());

        let r2 = manager.start_job(req2, |_| true).await;
        assert!(r2.is_err());
        assert_eq!(r2.unwrap_err().code, TgErrorCode::SessionLocked);
    }

    #[tokio::test]
    async fn test_stale_and_duplicate_ack_handling() {
        let mock_pages = vec![
            ListMediaResult {
                status: "ok".into(),
                folder_id: None,
                files: vec![],
                total: 0,
                page_size: 100,
                has_more: true,
                next_offset_id: None,
                search_cursor: None,
                lane_counts: None,
                emitted_watermark: None,
                lane_durability: None,
                total_count: Some(100),
                backend: "mock".into(),
                cached: false,
            },
        ];

        let page_source = Arc::new(MockMediaPageSource {
            pages: Mutex::new(mock_pages),
        });

        let manager = MediaIndexJobManager::with_page_source(PathBuf::from("sessions"), page_source);

        let req = StartMediaIndexJobRequest {
            client_request_id: "req_ack_test".into(),
            identity: TelegramIdentity {
                session: "ack_session".into(),
                api_id: 12345,
                api_hash: "hash".into(),
            },
            peer_id: "-100123".into(),
            topic_id: None,
            page_size: Some(100),
            initial_state: None,
            force_mode: None,
        };

        manager.start_job(req, |_| true).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;

        // Stale ACK (ack_id: 0 when expected: 1)
        let stale_res = manager
            .process_ack(MediaIndexPageAck {
                job_id: 1,
                ack_id: 0,
                outcome: MediaIndexAckOutcome::Committed,
                committed_state: None,
                error_code: None,
            })
            .await;
        assert_eq!(stale_res, MediaIndexAckResult::Stale);

        // Future unexpected ACK (ack_id: 99 when expected: 1)
        let future_res = manager
            .process_ack(MediaIndexPageAck {
                job_id: 1,
                ack_id: 99,
                outcome: MediaIndexAckOutcome::Committed,
                committed_state: None,
                error_code: None,
            })
            .await;
        assert_eq!(future_res, MediaIndexAckResult::Unexpected);
    }
}
