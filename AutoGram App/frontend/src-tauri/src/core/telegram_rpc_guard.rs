//! telegram_rpc_guard.rs — Central Guarded MTProto RPC Invocation Layer
//!
//! Enforces FloodGate checks, class-specific rate isolation, adaptive latency tracking,
//! and uniform error mapping across all Telegram operations.

use std::time::Instant;

use crate::core::session_rate::{
    note_error, note_flood_wait_class, wait_if_flooded_class, RpcClass,
};
use crate::core::tg_error::{map_invocation, TgError, TgErrorCode};
use crate::core::tg_log;

/// Result metadata for telemetry recording.
pub struct GuardedRpcResult<T> {
    pub value: T,
    pub latency_ms: u64,
}

/// Invokes an asynchronous Telegram RPC operation through the centralized FloodGate and rate coordinator.
pub async fn invoke_guarded<T, F, Fut>(
    session: &str,
    class: RpcClass,
    op_name: &'static str,
    call: F,
) -> Result<GuardedRpcResult<T>, TgError>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<T, grammers_client::InvocationError>>,
{
    // 1. Wait for any active FloodGate cooldown for this specific RPC class
    wait_if_flooded_class(session, class).await?;

    // 2. Measure invocation latency
    let start = Instant::now();
    let result = call().await;
    let latency = start.elapsed();
    let latency_ms = latency.as_millis().min(u64::MAX as u128) as u64;

    match result {
        Ok(value) => {
            // Log high latency for diagnostic visibility
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
            Ok(GuardedRpcResult { value, latency_ms })
        }
        Err(err) => {
            let tg_err = map_invocation(&err);
            if tg_err.code() == TgErrorCode::FloodWait {
                let wait_secs = tg_err
                    .flood_wait_secs()
                    .or_else(|| crate::core::session_rate::parse_flood_secs(&err.to_string()))
                    .unwrap_or(30);

                note_flood_wait_class(session, class, wait_secs);
                tg_log::warn(
                    "rpc_guard",
                    "flood_wait_recorded",
                    format!(
                        "session={} class={:?} op={} wait_secs={} err={}",
                        tg_log::session_label(session),
                        class,
                        op_name,
                        wait_secs,
                        err
                    ),
                );
            } else {
                note_error(session, &tg_err);
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
            Err(tg_err)
        }
    }
}
