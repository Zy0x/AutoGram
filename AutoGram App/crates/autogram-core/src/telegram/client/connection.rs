//! DC Connection Pool & Routing Manager

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DcConnectionInfo {
    pub dc_id: i32,
    pub ip_address: String,
    pub port: u16,
    pub active_connections: usize,
}
