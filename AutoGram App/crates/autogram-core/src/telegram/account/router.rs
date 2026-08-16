//! Account Selection & Multi-Account Router Engine

use super::capability::AccountCapability;
use super::health::AccountHealthState;
use super::score::{calculate_account_score, AccountRoutingTier, AccountScore};

#[derive(Debug, Clone)]
pub struct AccountProfileInfo {
    pub capability: AccountCapability,
    pub health: AccountHealthState,
    pub latency_ms: u32,
    pub active_jobs: u32,
    pub is_flooded: bool,
}

pub fn select_best_account<'a>(
    accounts: &'a [AccountProfileInfo],
) -> Option<(&'a AccountProfileInfo, AccountScore)> {
    let mut scored: Vec<(&'a AccountProfileInfo, AccountScore)> = accounts
        .iter()
        .map(|acc| {
            let score = calculate_account_score(
                &acc.capability,
                &acc.health,
                acc.latency_ms,
                acc.active_jobs,
                acc.is_flooded,
            );
            (acc, score)
        })
        .collect();

    // Sort descending by score
    scored.sort_by(|a, b| {
        b.1.total_score
            .partial_cmp(&a.1.total_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Return the highest scoring non-CircuitBreaker account
    scored
        .into_iter()
        .find(|(_, score)| score.routing_tier != AccountRoutingTier::CircuitBreaker)
}
