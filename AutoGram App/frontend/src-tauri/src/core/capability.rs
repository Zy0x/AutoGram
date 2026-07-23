//! Capability router: which backend owns each domain.
//! Frontend can query this map for diagnostics; orchestration uses it as docs-as-code.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BackendOwner {
    /// Pure Rust (no Python process required)
    Rust,
    /// Python Telethon worker only
    Python,
    /// Rust orchestrates; Python executes Telegram
    Hybrid,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityEntry {
    pub id: &'static str,
    pub owner: BackendOwner,
    pub description: &'static str,
}

/// Static catalog — keep in sync with docs/architecture/HYBRID_RUST_PYTHON.md
pub fn capability_catalog() -> Vec<CapabilityEntry> {
    vec![
        CapabilityEntry {
            id: "worker_lifecycle",
            owner: BackendOwner::Rust,
            description: "Spawn/kill/stdin for Python workers",
        },
        CapabilityEntry {
            id: "session_lease",
            owner: BackendOwner::Rust,
            description: "Exclusive transfer session lease",
        },
        CapabilityEntry {
            id: "secrets",
            owner: BackendOwner::Rust,
            description: "Credential vault / secure dirs",
        },
        CapabilityEntry {
            id: "path_policy",
            owner: BackendOwner::Rust,
            description: "Upload/download path allow/deny",
        },
        CapabilityEntry {
            id: "streaming_policy",
            owner: BackendOwner::Rust,
            description: "Size-tier first_play / workers policy",
        },
        CapabilityEntry {
            id: "local_doc_preview",
            owner: BackendOwner::Rust,
            description: "Text/code/office extract from local cache path",
        },
        CapabilityEntry {
            id: "telegram_drive_serve",
            owner: BackendOwner::Rust,
            description: "Drive list/CRUD/thumbs/preview fully on Grammers (no Telethon)",
        },
        CapabilityEntry {
            id: "telegram_preview_download",
            owner: BackendOwner::Rust,
            description: "Grammers download + persistent progressive fill + native range seek",
        },
        CapabilityEntry {
            id: "telegram_thumbs_topics",
            owner: BackendOwner::Rust,
            description: "Thumbs batch + forum topics on Grammers",
        },
        CapabilityEntry {
            id: "telegram_media_studio",
            owner: BackendOwner::Rust,
            description: "Studio upload/album on Grammers orch (reencode/remote still expanding)",
        },
        CapabilityEntry {
            id: "telegram_migration",
            owner: BackendOwner::Rust,
            description: "Migration engine target: Grammers dual-session (port in progress)",
        },
        CapabilityEntry {
            id: "telegram_auth",
            owner: BackendOwner::Rust,
            description: "QR, phone, OTP, 2FA, verification, and session inventory via Grammers",
        },
        CapabilityEntry {
            id: "stream_http_serve",
            owner: BackendOwner::Rust,
            description: "Concurrent local Range HTTP, playable-prefix probe, chunk and seek",
        },
        CapabilityEntry {
            id: "zip_local",
            owner: BackendOwner::Rust,
            description: "List/preview local ZIP cache",
        },
        CapabilityEntry {
            id: "file_hash",
            owner: BackendOwner::Rust,
            description: "SHA256 / quick fingerprint of local files",
        },
        CapabilityEntry {
            id: "config_normalize",
            owner: BackendOwner::Rust,
            description: "Job config normalization before Python daemon",
        },
        CapabilityEntry {
            id: "progress_rate",
            owner: BackendOwner::Rust,
            description: "Transfer rate and ETA calculation",
        },
        CapabilityEntry {
            id: "network_proxy_vpn",
            owner: BackendOwner::Hybrid,
            description: "Proxy/VPN config in Rust; Telethon applies via env",
        },
        CapabilityEntry {
            id: "studio_job_queue",
            owner: BackendOwner::Rust,
            description: "Studio transfer/item queue and FSM",
        },
        CapabilityEntry {
            id: "studio_orchestrator",
            owner: BackendOwner::Rust,
            description: "Rust queue + Grammers upload only (no Python studio-serve)",
        },
        CapabilityEntry {
            id: "telegram_ops_trait",
            owner: BackendOwner::Rust,
            description: "TelegramOps router locked to Grammers",
        },
        CapabilityEntry {
            id: "grammers_mtproto",
            owner: BackendOwner::Rust,
            description: "Grammers: auth, dialogs, Drive CRUD, upload, download, session import",
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_is_rust_first() {
        let cat = capability_catalog();
        assert!(cat.iter().any(|c| c.owner == BackendOwner::Rust));
        assert!(cat.iter().any(|c| c.id == "local_doc_preview"));
        assert!(cat.iter().any(|c| c.id == "telegram_drive_serve"
            && c.owner == BackendOwner::Rust));
        // Telethon runtime domains must not remain Hybrid/Python after force cutover
        assert!(!cat.iter().any(|c| c.id == "telegram_drive_serve"
            && matches!(c.owner, BackendOwner::Python | BackendOwner::Hybrid)));
    }
}
