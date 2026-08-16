use super::quality::{MediaCategory, QualityMode};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OversizeAction {
    Split,
    AlternateAccount,
    Skip,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OversizeDecision {
    pub action: OversizeAction,
    pub reason_code: String,
}

pub fn resolve_oversize(
    mode: QualityMode,
    category: MediaCategory,
    configured: OversizeAction,
) -> OversizeDecision {
    let action = match (mode, category, configured) {
        (QualityMode::Original | QualityMode::Document, _, OversizeAction::Split) => {
            OversizeAction::Split
        }
        (_, MediaCategory::Mp4Video | MediaCategory::OtherVideo, OversizeAction::Split) => {
            OversizeAction::Split
        }
        (_, _, value) => value,
    };
    OversizeDecision {
        action,
        reason_code: format!("oversize_{:?}", action).to_ascii_lowercase(),
    }
}
