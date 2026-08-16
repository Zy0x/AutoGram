//! Account Health State Monitoring

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AccountHealthState {
    Healthy,
    Warning,
    Throttled,
    Banned,
}

impl AccountHealthState {
    pub fn score_points(&self) -> f64 {
        match self {
            AccountHealthState::Healthy => 100.0,
            AccountHealthState::Warning => 50.0,
            AccountHealthState::Throttled => 20.0,
            AccountHealthState::Banned => 0.0,
        }
    }
}
