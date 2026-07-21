//! Import Telethon SQLite session → Grammers SessionData (auth_key + home DC).
//!
//! Persistence uses a custom JSON envelope (not grammers SqliteSession / libsql)
//! so we never double-link SQLite with rusqlite `bundled` on Windows.
//!
//! Safety: never log auth_key bytes. Caller must ensure exclusive session use.

use std::net::{Ipv4Addr, SocketAddrV4};
use std::path::{Path, PathBuf};

use grammers_session::types::DcOption;
use grammers_session::SessionData;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::tg_error::{TgError, TgErrorCode};
use super::tg_log;

/// Result of analyzing Telethon session without mutating Grammers store.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelethonSessionProbe {
    pub path: String,
    pub exists: bool,
    pub has_auth_key: bool,
    pub dc_id: Option<i32>,
    pub server_address: Option<String>,
    pub port: Option<i32>,
    pub auth_key_len: Option<usize>,
}

/// On-disk envelope for Grammers session (JSON, secrets as hex only on disk).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GrammersSessionFile {
    version: u32,
    home_dc: i32,
    /// hex-encoded 256-byte auth key for home_dc
    auth_key_hex: String,
    ipv4: String,
    port: u16,
}

pub fn telethon_session_path(sessions_dir: &Path, session_name: &str) -> PathBuf {
    let name = session_name.trim();
    let base = if name.ends_with(".session") {
        sessions_dir.join(name)
    } else {
        sessions_dir.join(format!("{name}.session"))
    };
    base
}

/// JSON session file (no second SQLite stack).
pub fn grammers_session_path(sessions_dir: &Path, session_name: &str) -> PathBuf {
    let name = session_name.trim().trim_end_matches(".session");
    sessions_dir.join(format!("{name}.grammers.json"))
}

pub fn probe_telethon_session(path: &Path) -> TelethonSessionProbe {
    let path_s = path.display().to_string();
    if !path.is_file() {
        return TelethonSessionProbe {
            path: path_s,
            exists: false,
            has_auth_key: false,
            dc_id: None,
            server_address: None,
            port: None,
            auth_key_len: None,
        };
    }
    match read_telethon_auth(path) {
        Ok(row) => TelethonSessionProbe {
            path: path_s,
            exists: true,
            has_auth_key: row.auth_key.len() == 256,
            dc_id: Some(row.dc_id),
            server_address: Some(row.server_address),
            port: Some(row.port),
            auth_key_len: Some(row.auth_key.len()),
        },
        Err(_) => TelethonSessionProbe {
            path: path_s,
            exists: true,
            has_auth_key: false,
            dc_id: None,
            server_address: None,
            port: None,
            auth_key_len: None,
        },
    }
}

struct TelethonAuthRow {
    dc_id: i32,
    server_address: String,
    port: i32,
    auth_key: Vec<u8>,
}

fn read_telethon_auth(path: &Path) -> Result<TelethonAuthRow, TgError> {
    let conn = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| {
        TgError::new(
            TgErrorCode::SessionLocked,
            format!("open telethon session (readonly): {e}"),
        )
    })?;
    let mut stmt = conn
        .prepare(
            "SELECT dc_id, server_address, port, auth_key FROM sessions \
             WHERE auth_key IS NOT NULL AND length(auth_key) > 0 \
             ORDER BY dc_id ASC LIMIT 5",
        )
        .map_err(|e| TgError::new(TgErrorCode::SessionImportFailed, e.to_string()))?;

    let mut rows = stmt
        .query([])
        .map_err(|e| TgError::new(TgErrorCode::SessionImportFailed, e.to_string()))?;

    let mut best: Option<TelethonAuthRow> = None;
    while let Some(row) = rows
        .next()
        .map_err(|e| TgError::new(TgErrorCode::SessionImportFailed, e.to_string()))?
    {
        let dc_id: i32 = row.get(0).unwrap_or(0);
        let server_address: String = row.get(1).unwrap_or_default();
        let port: i32 = row.get(2).unwrap_or(443);
        let auth_key: Vec<u8> = row.get(3).unwrap_or_default();
        if auth_key.len() == 256 {
            best = Some(TelethonAuthRow {
                dc_id,
                server_address,
                port,
                auth_key,
            });
            break;
        }
    }

    best.ok_or_else(|| {
        TgError::new(
            TgErrorCode::SessionImportFailed,
            "Telethon session has no 256-byte auth_key (not logged in?)",
        )
    })
}

/// Build Grammers SessionData from Telethon SQLite session.
pub fn session_data_from_telethon(path: &Path) -> Result<SessionData, TgError> {
    let row = read_telethon_auth(path)?;
    tg_log::info(
        "session_import",
        "telethon_read",
        format!(
            "dc={} port={} key_len={} host={}",
            row.dc_id,
            row.port,
            row.auth_key.len(),
            row.server_address
        ),
    );
    session_data_from_parts(
        row.dc_id,
        &row.auth_key,
        &row.server_address,
        row.port as u16,
    )
}

fn session_data_from_parts(
    home_dc: i32,
    auth_key: &[u8],
    ipv4_str: &str,
    port: u16,
) -> Result<SessionData, TgError> {
    if auth_key.len() != 256 {
        return Err(TgError::new(
            TgErrorCode::SessionImportFailed,
            format!("auth_key must be 256 bytes, got {}", auth_key.len()),
        ));
    }
    let mut data = SessionData::default();
    data.home_dc = home_dc;

    let mut auth = [0u8; 256];
    auth.copy_from_slice(auth_key);

    let ipv4 = parse_ipv4(ipv4_str).unwrap_or(Ipv4Addr::new(149, 154, 167, 51));
    let port = if port > 0 { port } else { 443 };
    let sock = SocketAddrV4::new(ipv4, port);

    if let Some(existing) = data.dc_options.get_mut(&home_dc) {
        existing.auth_key = Some(auth);
        if parse_ipv4(ipv4_str).is_some() {
            existing.ipv4 = sock;
        }
    } else {
        let dc = DcOption {
            id: home_dc,
            ipv4: sock,
            ipv6: std::net::SocketAddrV6::new(std::net::Ipv6Addr::UNSPECIFIED, port, 0, 0),
            auth_key: Some(auth),
        };
        data.dc_options.insert(home_dc, dc);
    }
    Ok(data)
}

fn parse_ipv4(s: &str) -> Option<Ipv4Addr> {
    s.trim().parse().ok()
}

/// Persist SessionData → custom JSON (home DC + auth key only).
pub fn write_session_data(path: &Path, data: &SessionData) -> Result<(), TgError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| TgError::new(TgErrorCode::Io, format!("create sessions dir: {e}")))?;
    }
    let home = data.home_dc;
    let dc = data.dc_options.get(&home).ok_or_else(|| {
        TgError::new(
            TgErrorCode::SessionImportFailed,
            format!("no dc_option for home_dc={home}"),
        )
    })?;
    let key = dc.auth_key.ok_or_else(|| {
        TgError::new(
            TgErrorCode::SessionImportFailed,
            "cannot persist session without auth_key (not logged in)",
        )
    })?;
    let file = GrammersSessionFile {
        version: 1,
        home_dc: home,
        auth_key_hex: hex::encode(key),
        ipv4: dc.ipv4.ip().to_string(),
        port: dc.ipv4.port(),
    };
    let json = serde_json::to_string_pretty(&file).map_err(|e| {
        TgError::new(TgErrorCode::SessionImportFailed, format!("serialize: {e}"))
    })?;
    std::fs::write(path, json)
        .map_err(|e| TgError::new(TgErrorCode::Io, format!("write grammers session: {e}")))?;
    Ok(())
}

pub fn read_session_data(path: &Path) -> Result<SessionData, TgError> {
    if !path.is_file() {
        return Ok(SessionData::default());
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|e| TgError::new(TgErrorCode::SessionMissing, format!("read session: {e}")))?;
    let file: GrammersSessionFile = serde_json::from_str(&raw).map_err(|e| {
        TgError::new(
            TgErrorCode::SessionImportFailed,
            format!("parse grammers json session: {e}"),
        )
    })?;
    let key = hex::decode(file.auth_key_hex.trim()).map_err(|e| {
        TgError::new(
            TgErrorCode::SessionImportFailed,
            format!("auth_key hex: {e}"),
        )
    })?;
    session_data_from_parts(file.home_dc, &key, &file.ipv4, file.port)
}

/// Import Telethon → Grammers JSON session file.
pub async fn import_telethon_to_grammers_file(
    telethon_path: &Path,
    grammers_path: &Path,
) -> Result<(), TgError> {
    if !telethon_path.is_file() {
        return Err(TgError::new(
            TgErrorCode::SessionMissing,
            format!("Telethon session missing: {}", telethon_path.display()),
        ));
    }

    let data = session_data_from_telethon(telethon_path)?;
    write_session_data(grammers_path, &data)?;

    tg_log::info(
        "session_import",
        "import_ok",
        format!(
            "from={} to={} home_dc={}",
            telethon_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("?"),
            grammers_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("?"),
            data.home_dc
        ),
    );
    Ok(())
}

/// Export Grammers JSON session file → Telethon SQLite session file.
pub fn export_grammers_to_telethon_file(
    grammers_path: &Path,
    telethon_path: &Path,
) -> Result<(), TgError> {
    let file: GrammersSessionFile = {
        let raw = std::fs::read_to_string(grammers_path)
            .map_err(|e| TgError::new(TgErrorCode::SessionMissing, format!("read grammers session: {e}")))?;
        serde_json::from_str(&raw).map_err(|e| TgError::new(TgErrorCode::SessionImportFailed, format!("parse json: {e}")))?
    };

    let key = hex::decode(file.auth_key_hex.trim())
        .map_err(|e| TgError::new(TgErrorCode::SessionImportFailed, format!("auth_key hex: {e}")))?;

    if let Some(parent) = telethon_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let conn = Connection::open(telethon_path)
        .map_err(|e| TgError::new(TgErrorCode::Io, format!("open sqlite telethon session: {e}")))?;

    let _ = conn.execute_batch("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");

    conn.execute(
        "CREATE TABLE IF NOT EXISTS sessions (
            dc_id INTEGER PRIMARY KEY,
            server_address TEXT,
            port INTEGER,
            auth_key BLOB
        )",
        [],
    ).map_err(|e| TgError::new(TgErrorCode::Io, format!("create sessions table: {e}")))?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS version (
            version INTEGER PRIMARY KEY
        )",
        [],
    ).map_err(|e| TgError::new(TgErrorCode::Io, format!("create version table: {e}")))?;

    let _ = conn.execute("DELETE FROM sessions", []);
    conn.execute(
        "INSERT INTO sessions (dc_id, server_address, port, auth_key) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![file.home_dc, file.ipv4, file.port, key],
    ).map_err(|e| TgError::new(TgErrorCode::Io, format!("insert sessions row: {e}")))?;

    let _ = conn.execute("DELETE FROM version", []);
    let _ = conn.execute("INSERT INTO version (version) VALUES (7)", []);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn paths_are_distinct() {
        let dir = Path::new("/tmp/sessions");
        let t = telethon_session_path(dir, "Lavender");
        let g = grammers_session_path(dir, "Lavender");
        assert!(t.to_string_lossy().ends_with("Lavender.session"));
        assert!(g.to_string_lossy().ends_with("Lavender.grammers.json"));
        assert_ne!(t, g);
    }

    #[test]
    fn probe_missing() {
        let p = probe_telethon_session(Path::new("/no/such/file.session"));
        assert!(!p.exists);
        assert!(!p.has_auth_key);
    }

    #[test]
    fn roundtrip_empty_default_write_fails_without_key() {
        let dir = std::env::temp_dir().join("ag_sess_rt");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("x.grammers.json");
        let data = SessionData::default();
        // default has no auth key for home → write should fail
        assert!(write_session_data(&path, &data).is_err());
    }

    #[test]
    fn import_from_synthetic_telethon_db() {
        let dir = std::env::temp_dir().join("ag_tt_import_test2");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("test_import.session");
        let _ = fs::remove_file(&path);
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (
                dc_id INTEGER PRIMARY KEY,
                server_address TEXT,
                port INTEGER,
                auth_key BLOB,
                takeout_id INTEGER
            );",
        )
        .unwrap();
        let key = vec![7u8; 256];
        conn.execute(
            "INSERT INTO sessions (dc_id, server_address, port, auth_key) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![2, "149.154.167.51", 443, key],
        )
        .unwrap();
        drop(conn);

        let data = session_data_from_telethon(&path).unwrap();
        assert_eq!(data.home_dc, 2);
        assert!(data.dc_options.get(&2).unwrap().auth_key.is_some());

        let gpath = dir.join("out.grammers.json");
        write_session_data(&gpath, &data).unwrap();
        let again = read_session_data(&gpath).unwrap();
        assert_eq!(again.home_dc, 2);
        assert!(again.dc_options.get(&2).unwrap().auth_key.is_some());
    }
}
