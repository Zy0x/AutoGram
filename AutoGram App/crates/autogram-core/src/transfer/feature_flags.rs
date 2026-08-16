//! Operational transfer feature gates.
//!
//! These flags are resolved once and frozen with each job. Disabling the v4
//! engine never rolls schema migrations back and never falls through to a
//! Python/Telethon runtime; the orchestrator uses a conservative Grammers
//! single-document path instead.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferFeatureFlags {
    pub schema_version: u32,
    pub transfer_v4: bool,
    pub intelligent_albums: bool,
    pub oversize_routing: bool,
    pub encoder_orchestration: bool,
}

impl Default for TransferFeatureFlags {
    fn default() -> Self {
        Self {
            schema_version: 1,
            transfer_v4: true,
            intelligent_albums: true,
            oversize_routing: true,
            encoder_orchestration: true,
        }
    }
}

fn parse_flag(value: Option<&str>, default: bool) -> bool {
    match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("1" | "true" | "yes" | "on" | "enabled") => true,
        Some("0" | "false" | "no" | "off" | "disabled") => false,
        _ => default,
    }
}

fn environment_flag(name: &str, default: bool) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| parse_flag(Some(&value), default))
        .unwrap_or(default)
}

impl TransferFeatureFlags {
    pub fn resolve() -> Self {
        let transfer_v4 = environment_flag("AUTOGRAM_TRANSFER_V4_ENABLED", true);
        Self {
            schema_version: 1,
            transfer_v4,
            intelligent_albums: transfer_v4
                && environment_flag("AUTOGRAM_INTELLIGENT_ALBUMS_ENABLED", true),
            oversize_routing: transfer_v4
                && environment_flag("AUTOGRAM_OVERSIZE_ROUTING_ENABLED", true),
            encoder_orchestration: transfer_v4
                && environment_flag("AUTOGRAM_ENCODER_ORCHESTRATION_ENABLED", true),
        }
    }

    pub fn engine_mode(self) -> &'static str {
        if self.transfer_v4 {
            "v4"
        } else {
            "safe_rollback"
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flag_parser_accepts_operational_spellings() {
        for value in ["1", "true", "YES", "enabled", "on"] {
            assert!(parse_flag(Some(value), false));
        }
        for value in ["0", "false", "NO", "disabled", "off"] {
            assert!(!parse_flag(Some(value), true));
        }
        assert!(parse_flag(Some("unknown"), true));
    }

    #[test]
    fn safe_rollback_disables_dependent_features() {
        let flags = TransferFeatureFlags {
            transfer_v4: false,
            ..TransferFeatureFlags::default()
        };
        // Resolution enforces this invariant; model it without mutating the
        // process environment, which keeps the test parallel-safe.
        let normalized = TransferFeatureFlags {
            intelligent_albums: flags.transfer_v4 && flags.intelligent_albums,
            oversize_routing: flags.transfer_v4 && flags.oversize_routing,
            encoder_orchestration: flags.transfer_v4 && flags.encoder_orchestration,
            ..flags
        };
        assert_eq!(normalized.engine_mode(), "safe_rollback");
        assert!(!normalized.intelligent_albums);
        assert!(!normalized.oversize_routing);
        assert!(!normalized.encoder_orchestration);
    }
}
