//! Normalized Account Scoring System (0.0 - 100.0)
//! Implements Master Plan Section 6.5.2 proportional weighted scoring matrix.

use super::capability::AccountCapability;
use super::health::AccountHealthState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AccountRoutingTier {
    Primary,
    Secondary,
    CircuitBreaker,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountScore {
    pub account_id: String,
    pub total_score: f64,
    pub capability_score: f64,
    pub health_score: f64,
    pub latency_score: f64,
    pub queue_score: f64,
    pub flood_penalty: f64,
    pub routing_tier: AccountRoutingTier,
}

pub fn calculate_account_score(
    capability: &AccountCapability,
    health: &AccountHealthState,
    latency_ms: u32,
    active_jobs: u32,
    is_flooded: bool,
) -> AccountScore {
    // Capability score (30%)
    let s_cap = if capability.is_premium { 100.0 } else { 50.0 };

    // Health score (30%)
    let s_health = health.score_points();

    // Latency score (15%)
    let s_latency = if latency_ms > 0 {
        (1000.0 / latency_ms as f64).min(100.0)
    } else {
        100.0
    };

    // Queue score (15%)
    let s_queue = (100.0 - (active_jobs as f64 * 20.0)).max(0.0);

    // Flood penalty
    let s_flood_penalty = if is_flooded { 100.0 } else { 0.0 };

    let total = (0.30 * s_cap) + (0.30 * s_health) + (0.15 * s_latency) + (0.15 * s_queue)
        - s_flood_penalty;
    let total_score = total.clamp(0.0, 100.0);

    let routing_tier = if total_score >= 80.0 {
        AccountRoutingTier::Primary
    } else if total_score >= 50.0 {
        AccountRoutingTier::Secondary
    } else {
        AccountRoutingTier::CircuitBreaker
    };

    AccountScore {
        account_id: capability.account_id.clone(),
        total_score,
        capability_score: s_cap,
        health_score: s_health,
        latency_score: s_latency,
        queue_score: s_queue,
        flood_penalty: s_flood_penalty,
        routing_tier,
    }
}
