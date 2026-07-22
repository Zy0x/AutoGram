//! Proxy + VPN optimizer (adapted from Telegram-Drive patterns for AutoGram hybrid).
//! Rust owns config + connectivity checks; Python Telethon applies proxy via env.

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::fs;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

static STATE: OnceLock<RwLock<NetworkConfigSnapshot>> = OnceLock::new();
static CONFIG_PATH: OnceLock<PathBuf> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfig {
    pub enabled: bool,
    /// "socks5" | "http" | "https" | "mtproto"
    pub proxy_type: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    /// MTProto secret (hex) when proxy_type == mtproto
    #[serde(default)]
    pub secret: String,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            proxy_type: "socks5".into(),
            host: String::new(),
            port: 1080,
            username: String::new(),
            password: String::new(),
            secret: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VpnConfig {
    pub enabled: bool,
    /// Multiplier for connect timeouts (1–5)
    pub timeout_multiplier: u32,
    pub retry_attempts: u32,
    pub retry_base_backoff_ms: u64,
    pub retry_max_backoff_ms: u64,
    pub flood_wait_respect: bool,
    pub bandwidth_limit_up_kbs: u32,
    pub bandwidth_limit_down_kbs: u32,
    pub chunk_size_kb: u32,
    pub keep_alive_interval_sec: u32,
    pub auto_detect_vpn: bool,
    pub connection_retries: u32,
    pub request_retries: u32,
}

impl Default for VpnConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            timeout_multiplier: 3,
            retry_attempts: 3,
            retry_base_backoff_ms: 1000,
            retry_max_backoff_ms: 30000,
            flood_wait_respect: true,
            bandwidth_limit_up_kbs: 0,
            bandwidth_limit_down_kbs: 0,
            chunk_size_kb: 512,
            keep_alive_interval_sec: 45,
            auto_detect_vpn: false,
            connection_retries: 15,
            request_retries: 10,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetworkConfigSnapshot {
    pub proxy: ProxyConfig,
    pub vpn: VpnConfig,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStatus {
    pub reachable: bool,
    pub latency_ms: i64,
    pub detail: String,
}

fn state() -> &'static RwLock<NetworkConfigSnapshot> {
    STATE.get_or_init(|| RwLock::new(NetworkConfigSnapshot::default()))
}

pub fn init_config_path(path: PathBuf) {
    let _ = CONFIG_PATH.set(path.clone());
    if let Ok(data) = fs::read_to_string(&path) {
        if let Ok(cfg) = serde_json::from_str::<NetworkConfigSnapshot>(&data) {
            *state().write() = cfg;
        }
    }
}

pub fn snapshot() -> NetworkConfigSnapshot {
    state().read().clone()
}

pub fn apply_proxy(proxy: ProxyConfig) -> Result<(), String> {
    {
        let mut s = state().write();
        s.proxy = proxy;
    }
    persist()?;
    Ok(())
}

pub fn apply_vpn(vpn: VpnConfig) -> Result<(), String> {
    {
        let mut s = state().write();
        s.vpn = clamp_vpn(vpn);
    }
    persist()?;
    Ok(())
}

pub fn apply_all(cfg: NetworkConfigSnapshot) -> Result<(), String> {
    {
        let mut s = state().write();
        s.proxy = cfg.proxy;
        s.vpn = clamp_vpn(cfg.vpn);
    }
    persist()?;
    Ok(())
}

fn clamp_vpn(mut v: VpnConfig) -> VpnConfig {
    v.timeout_multiplier = v.timeout_multiplier.clamp(1, 8);
    v.retry_attempts = v.retry_attempts.min(10);
    v.retry_base_backoff_ms = v.retry_base_backoff_ms.clamp(200, 10_000);
    v.retry_max_backoff_ms = v.retry_max_backoff_ms.clamp(1000, 120_000);
    v.chunk_size_kb = match v.chunk_size_kb {
        128 | 256 | 512 | 1024 => v.chunk_size_kb,
        _ => 512,
    };
    v.connection_retries = v.connection_retries.clamp(3, 30);
    v.request_retries = v.request_retries.clamp(3, 30);
    v.keep_alive_interval_sec = if v.keep_alive_interval_sec == 0 {
        0
    } else {
        v.keep_alive_interval_sec.clamp(20, 180)
    };
    v
}

fn persist() -> Result<(), String> {
    let path = CONFIG_PATH
        .get()
        .ok_or_else(|| "network config path not initialized".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(&snapshot()).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

/// Env vars injected into Python workers so Telethon picks up proxy/VPN.
pub fn worker_env_map() -> Vec<(String, String)> {
    let s = snapshot();
    let mut out = Vec::new();
    out.push((
        "AUTOGRAM_VPN_MODE".into(),
        if s.vpn.enabled { "1" } else { "0" }.into(),
    ));
    out.push((
        "AUTOGRAM_VPN_TIMEOUT_MULT".into(),
        s.vpn.timeout_multiplier.to_string(),
    ));
    out.push((
        "AUTOGRAM_CONNECTION_RETRIES".into(),
        s.vpn.connection_retries.to_string(),
    ));
    out.push((
        "AUTOGRAM_REQUEST_RETRIES".into(),
        s.vpn.request_retries.to_string(),
    ));
    out.push((
        "AUTOGRAM_RETRY_DELAY".into(),
        (s.vpn.retry_base_backoff_ms.max(500) / 1000).max(1).to_string(),
    ));
    out.push((
        "AUTOGRAM_KEEPALIVE_SEC".into(),
        s.vpn.keep_alive_interval_sec.to_string(),
    ));
    out.push((
        "AUTOGRAM_FLOOD_RESPECT".into(),
        if s.vpn.flood_wait_respect { "1" } else { "0" }.into(),
    ));
    out.push((
        "AUTOGRAM_CHUNK_KB".into(),
        s.vpn.chunk_size_kb.to_string(),
    ));
    out.push((
        "AUTOGRAM_BW_UP_KBS".into(),
        s.vpn.bandwidth_limit_up_kbs.to_string(),
    ));
    out.push((
        "AUTOGRAM_BW_DOWN_KBS".into(),
        s.vpn.bandwidth_limit_down_kbs.to_string(),
    ));

    if s.proxy.enabled && !s.proxy.host.is_empty() {
        out.push(("AUTOGRAM_PROXY_ENABLED".into(), "1".into()));
        out.push(("AUTOGRAM_PROXY_TYPE".into(), s.proxy.proxy_type.clone()));
        out.push(("AUTOGRAM_PROXY_HOST".into(), s.proxy.host.clone()));
        out.push(("AUTOGRAM_PROXY_PORT".into(), s.proxy.port.to_string()));
        out.push(("AUTOGRAM_PROXY_USER".into(), s.proxy.username.clone()));
        out.push(("AUTOGRAM_PROXY_PASS".into(), s.proxy.password.clone()));
        if !s.proxy.secret.is_empty() {
            out.push(("AUTOGRAM_PROXY_SECRET".into(), s.proxy.secret.clone()));
        }
    } else {
        out.push(("AUTOGRAM_PROXY_ENABLED".into(), "0".into()));
    }
    out
}

pub fn connect_timeout_secs() -> u64 {
    let s = snapshot();
    if s.vpn.enabled {
        5 * s.vpn.timeout_multiplier as u64
    } else {
        8
    }
}

pub fn test_proxy_tcp() -> ProxyStatus {
    let s = snapshot();
    if !s.proxy.enabled || s.proxy.host.is_empty() {
        return ProxyStatus {
            reachable: false,
            latency_ms: -1,
            detail: "proxy disabled".into(),
        };
    }
    let addr = format!("{}:{}", s.proxy.host, s.proxy.port);
    let timeout = Duration::from_secs(connect_timeout_secs().min(5));
    let start = Instant::now();
    let addrs = match addr.to_socket_addrs() {
        Ok(a) => a.collect::<Vec<_>>(),
        Err(e) => {
            return ProxyStatus {
                reachable: false,
                latency_ms: -1,
                detail: format!("resolve failed: {e}"),
            };
        }
    };
    for a in addrs {
        if TcpStream::connect_timeout(&a, timeout).is_ok() {
            return ProxyStatus {
                reachable: true,
                latency_ms: start.elapsed().as_millis() as i64,
                detail: format!("tcp ok {}", a),
            };
        }
    }
    ProxyStatus {
        reachable: false,
        latency_ms: -1,
        detail: "tcp connect failed".into(),
    }
}

/// Heuristic VPN detection: try Telegram DC TCP; if slow/fail while local net works, hint VPN.
pub fn detect_vpn_heuristic() -> bool {
    let dcs = [
        "149.154.167.50:443",
        "149.154.175.53:443",
        "91.108.56.130:443",
    ];
    let timeout = Duration::from_millis(800);
    let mut ok = 0;
    for dc in dcs {
        if let Ok(mut addrs) = dc.to_socket_addrs() {
            if let Some(a) = addrs.next() {
                if TcpStream::connect_timeout(&a, timeout).is_ok() {
                    ok += 1;
                }
            }
        }
    }
    // If none of DCs reachable quickly, suggest VPN/proxy path
    ok == 0
}

pub fn is_network_available() -> bool {
    let s = snapshot();
    if s.proxy.enabled && !s.proxy.host.is_empty() {
        return test_proxy_tcp().reachable;
    }
    let dcs = [
        "149.154.167.50:443",
        "149.154.175.53:443",
        "149.154.167.51:443",
    ];
    let timeout = Duration::from_secs(connect_timeout_secs().min(6));
    for dc in dcs {
        if let Ok(mut addrs) = dc.to_socket_addrs() {
            if let Some(a) = addrs.next() {
                if TcpStream::connect_timeout(&a, timeout).is_ok() {
                    return true;
                }
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_vpn_bounds() {
        let mut v = VpnConfig::default();
        v.timeout_multiplier = 99;
        v.chunk_size_kb = 77;
        let c = clamp_vpn(v);
        assert_eq!(c.timeout_multiplier, 8);
        assert_eq!(c.chunk_size_kb, 512);
    }

    #[test]
    fn worker_env_has_proxy_flag() {
        let e = worker_env_map();
        assert!(e.iter().any(|(k, _)| k == "AUTOGRAM_PROXY_ENABLED"));
        assert!(e.iter().any(|(k, _)| k == "AUTOGRAM_VPN_MODE"));
    }
}
