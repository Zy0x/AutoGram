//! telegram_rpc_guard.rs — Central Guarded MTProto RPC Invocation Layer
//!
//! Enforces FloodGate checks, class-specific rate isolation, adaptive latency tracking,
//! automatic Rust-side backoff/retry, and uniform error mapping across all Telegram operations.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use tokio_util::sync::CancellationToken;

use crate::core::session_rate::{
    acquire_index_slot, acquire_media_slot, acquire_preview_slot, note_error, note_flood_wait_class,
    wait_if_flooded_class, RpcClass,
};
use crate::core::tg_error::{map_invocation, TgError, TgErrorCode};
use crate::core::tg_log;

/// Trait for observing guard-owned internal FloodWait retries and backoff states.
#[async_trait::async_trait]
pub trait RpcObserver: Send + Sync {
    async fn on_guard_backoff_start(
        &self,
        wait_secs: u32,
        resume_at_ms: u64,
        attempt: u32,
        max_attempts: u32,
    );
    async fn on_guard_backoff_end(&self, attempt: u32);
}

/// Optional control handles passed to guarded RPC invocations (cancellation + telemetry observers).
#[derive(Clone, Default)]
pub struct RpcGuardControl {
    pub cancel: Option<CancellationToken>,
    pub observer: Option<Arc<dyn RpcObserver>>,
}

/// Rolling telemetry metrics per RPC class and operation.
#[derive(Default, Debug, Clone)]
pub struct RpcTelemetry {
    pub total_calls: u64,
    pub success_calls: u64,
    pub error_calls: u64,
    pub flood_count: u64,
    pub flood_seconds_total: u64,
    pub ewma_latency_ms: f64,
    pub p95_latency_ms: u64,
}

struct GuardTelemetryState {
    metrics: HashMap<String, RpcTelemetry>,
    recent_latencies: HashMap<String, Vec<u64>>,
}

fn telemetry_state() -> &'static Mutex<GuardTelemetryState> {
    static STATE: OnceLock<Mutex<GuardTelemetryState>> = OnceLock::new();
    STATE.get_or_init(|| {
        Mutex::new(GuardTelemetryState {
            metrics: HashMap::new(),
            recent_latencies: HashMap::new(),
        })
    })
}

/// Result metadata for telemetry recording.
#[derive(Debug, Clone)]
pub struct GuardedRpcResult<T> {
    pub value: T,
    pub latency_ms: u64,
    pub attempts: u32,
}

/// Invokes an asynchronous Telegram RPC operation through the centralized FloodGate and rate coordinator.
/// Enforces index semaphore permits, auto-retries short flood waits, and records structured telemetry.
pub async fn invoke_guarded<T, F, Fut>(
    session: &str,
    class: RpcClass,
    op_name: &'static str,
    call: F,
) -> Result<GuardedRpcResult<T>, TgError>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, grammers_client::InvocationError>>,
{
    invoke_guarded_with_control(session, class, op_name, &RpcGuardControl::default(), call).await
}

/// Invokes a guarded RPC with explicit cancellation and observer control handles.
pub async fn invoke_guarded_with_control<T, F, Fut>(
    session: &str,
    class: RpcClass,
    op_name: &'static str,
    control: &RpcGuardControl,
    call: F,
) -> Result<GuardedRpcResult<T>, TgError>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, grammers_client::InvocationError>>,
{
    // 1. Acquire appropriate semaphore permit based on RPC class with cancellation awareness
    let _permit = match class {
        RpcClass::IndexSearch | RpcClass::IndexCounters | RpcClass::IndexRepair => {
            if let Some(ref c) = control.cancel {
                tokio::select! {
                    _ = c.cancelled() => return Err(TgError::new(TgErrorCode::Cancelled, "guarded index slot acquisition cancelled")),
                    res = acquire_index_slot(session) => Some(res?),
                }
            } else {
                Some(acquire_index_slot(session).await?)
            }
        }
        RpcClass::MediaDownload => {
            if let Some(ref c) = control.cancel {
                tokio::select! {
                    _ = c.cancelled() => return Err(TgError::new(TgErrorCode::Cancelled, "guarded media slot acquisition cancelled")),
                    res = acquire_media_slot(session) => Some(res?),
                }
            } else {
                Some(acquire_media_slot(session).await?)
            }
        }
        RpcClass::MediaPreview => {
            if let Some(ref c) = control.cancel {
                tokio::select! {
                    _ = c.cancelled() => return Err(TgError::new(TgErrorCode::Cancelled, "guarded preview slot acquisition cancelled")),
                    res = acquire_preview_slot(session) => Some(res?),
                }
            } else {
                Some(acquire_preview_slot(session).await?)
            }
        }
        _ => None,
    };

    let mut attempts = 0u32;
    let max_attempts = 3u32;

    loop {
        if let Some(ref c) = control.cancel {
            if c.is_cancelled() {
                return Err(TgError::new(TgErrorCode::Cancelled, "guarded operation cancelled"));
            }
        }

        attempts += 1;

        // 2. Wait for any active FloodGate cooldown for this specific RPC class
        if let Some(ref c) = control.cancel {
            tokio::select! {
                _ = c.cancelled() => return Err(TgError::new(TgErrorCode::Cancelled, "guarded flood gate wait cancelled")),
                res = wait_if_flooded_class(session, class) => res?,
            }
        } else {
            wait_if_flooded_class(session, class).await?;
        }

        // 3. Measure invocation latency
        let start = Instant::now();
        let result = if let Some(ref c) = control.cancel {
            tokio::select! {
                _ = c.cancelled() => return Err(TgError::new(TgErrorCode::Cancelled, "guarded rpc invocation cancelled")),
                res = call() => res,
            }
        } else {
            call().await
        };
        let latency = start.elapsed();
        let latency_ms = latency.as_millis().min(u64::MAX as u128) as u64;

        let telemetry_key = format!("{}:{:?}:{}", tg_log::session_label(session), class, op_name);

        match result {
            Ok(value) => {
                // Record telemetry on success
                {
                    let mut state = telemetry_state().lock();
                    let lat_vec = state.recent_latencies.entry(telemetry_key.clone()).or_default();
                    lat_vec.push(latency_ms);
                    if lat_vec.len() > 100 {
                        lat_vec.remove(0);
                    }
                    let mut sorted = lat_vec.clone();
                    sorted.sort_unstable();
                    let idx = (sorted.len() as f64 * 0.95).floor() as usize;
                    let p95_calc = sorted.get(idx.min(sorted.len().saturating_sub(1))).copied().unwrap_or(latency_ms);

                    let m = state.metrics.entry(telemetry_key).or_default();
                    m.total_calls += 1;
                    m.success_calls += 1;
                    if m.ewma_latency_ms == 0.0 {
                        m.ewma_latency_ms = latency_ms as f64;
                    } else {
                        m.ewma_latency_ms = 0.85 * m.ewma_latency_ms + 0.15 * (latency_ms as f64);
                    }
                    m.p95_latency_ms = p95_calc;
                }

                if latency_ms > 450 {
                    tg_log::info(
                        "rpc_guard",
                        "elevated_latency",
                        format!(
                            "session={} class={:?} op={} latency_ms={}",
                            tg_log::session_label(session),
                            class,
                            op_name,
                            latency_ms
                        ),
                    );
                }

                return Ok(GuardedRpcResult {
                    value,
                    latency_ms,
                    attempts,
                });
            }
            Err(err) => {
                let tg_err = map_invocation(&err);
                let is_flood = tg_err.code() == TgErrorCode::FloodWait;

                if is_flood {
                    let wait_secs = tg_err
                        .flood_wait_secs()
                        .or_else(|| crate::core::session_rate::parse_flood_secs(&err.to_string()))
                        .unwrap_or(30);

                    note_flood_wait_class(session, class, wait_secs);

                    {
                        let mut state = telemetry_state().lock();
                        let m = state.metrics.entry(telemetry_key).or_default();
                        m.total_calls += 1;
                        m.error_calls += 1;
                        m.flood_count += 1;
                        m.flood_seconds_total += u64::from(wait_secs);
                    }

                    tg_log::warn(
                        "rpc_guard",
                        "flood_wait_recorded",
                        format!(
                            "session={} class={:?} op={} wait_secs={} attempt={}/{}",
                            tg_log::session_label(session),
                            class,
                            op_name,
                            wait_secs,
                            attempts,
                            max_attempts
                        ),
                    );

                    // Auto-retry in Rust for reasonable flood waits (e.g. <= 45 seconds)
                    if wait_secs <= 45 && attempts < max_attempts {
                        let now_ms = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .map(|d| d.as_millis() as u64)
                            .unwrap_or(0);
                        let resume_at_ms = now_ms + (u64::from(wait_secs) * 1000);

                        if let Some(ref obs) = control.observer {
                            obs.on_guard_backoff_start(wait_secs, resume_at_ms, attempts, max_attempts).await;
                        }

                        let sleep_duration = Duration::from_secs(u64::from(wait_secs)) + Duration::from_millis(50);
                        let interrupted = if let Some(ref c) = control.cancel {
                            tokio::select! {
                                _ = c.cancelled() => true,
                                _ = tokio::time::sleep(sleep_duration) => false,
                            }
                        } else {
                            tokio::time::sleep(sleep_duration).await;
                            false
                        };

                        if let Some(ref obs) = control.observer {
                            obs.on_guard_backoff_end(attempts).await;
                        }

                        if interrupted {
                            return Err(TgError::new(TgErrorCode::Cancelled, "guarded flood wait cancelled"));
                        }

                        continue;
                    }
                } else {
                    note_error(session, &tg_err);

                    {
                        let mut state = telemetry_state().lock();
                        let m = state.metrics.entry(telemetry_key).or_default();
                        m.total_calls += 1;
                        m.error_calls += 1;
                    }

                    tg_log::warn(
                        "rpc_guard",
                        "rpc_failed",
                        format!(
                            "session={} class={:?} op={} err={}",
                            tg_log::session_label(session),
                            class,
                            op_name,
                            err
                        ),
                    );
                }

                return Err(tg_err);
            }
        }
    }
}
