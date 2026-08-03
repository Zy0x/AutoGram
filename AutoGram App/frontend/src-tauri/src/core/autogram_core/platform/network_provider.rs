//! Network Abstraction Layer (PAL - NetworkProvider)
//! Handles network detection, metered status, bandwidth estimation, and latency monitoring across platforms.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NetworkType {
    Ethernet,
    WiFi,
    Cellular4G,
    Cellular5G,
    Unknown,
}

pub trait NetworkProvider: Send + Sync {
    fn network_type(&self) -> NetworkType;
    fn is_metered(&self) -> bool;
    fn bandwidth_estimate(&self) -> Option<u64>;
    fn latency_ms(&self) -> Option<u32>;
}

pub struct DesktopNetworkProvider;

impl DesktopNetworkProvider {
    pub fn new() -> Self {
        Self
    }
}

impl NetworkProvider for DesktopNetworkProvider {
    fn network_type(&self) -> NetworkType {
        NetworkType::Ethernet
    }

    fn is_metered(&self) -> bool {
        false
    }

    fn bandwidth_estimate(&self) -> Option<u64> {
        Some(100_000_000) // 100 Mbps default estimate
    }

    fn latency_ms(&self) -> Option<u32> {
        Some(25)
    }
}
