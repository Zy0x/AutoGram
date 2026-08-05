//! Multi-Tier Error Classification Engine
//! Categorizes errors into actionable categories (FILE_ERROR, SIZE_LIMIT, RATE_LIMIT, NETWORK_ERROR, SYSTEM_ERROR).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorClass {
    FileError,
    SizeLimit,
    RateLimit,
    NetworkError,
    SystemError,
    Unknown,
}

impl ErrorClass {
    pub fn as_str(&self) -> &'static str {
        match self {
            ErrorClass::FileError => "FILE_ERROR",
            ErrorClass::SizeLimit => "SIZE_LIMIT",
            ErrorClass::RateLimit => "RATE_LIMIT",
            ErrorClass::NetworkError => "NETWORK_ERROR",
            ErrorClass::SystemError => "SYSTEM_ERROR",
            ErrorClass::Unknown => "UNKNOWN",
        }
    }
}

pub fn classify_error(error_message: &str) -> ErrorClass {
    let msg_lower = error_message.to_lowercase();

    if msg_lower.contains("flood_wait")
        || msg_lower.contains("420")
        || msg_lower.contains("rate_limit")
    {
        ErrorClass::RateLimit
    } else if msg_lower.contains("file_too_big")
        || msg_lower.contains("size limit")
        || msg_lower.contains("2gb")
        || msg_lower.contains("4gb")
    {
        ErrorClass::SizeLimit
    } else if msg_lower.contains("connection reset")
        || msg_lower.contains("timeout")
        || msg_lower.contains("network")
        || msg_lower.contains("dns")
        || msg_lower.contains("socket")
    {
        ErrorClass::NetworkError
    } else if msg_lower.contains("moov atom")
        || msg_lower.contains("corrupt")
        || msg_lower.contains("invalid data")
        || msg_lower.contains("not found")
        || msg_lower.contains("permission denied")
    {
        ErrorClass::FileError
    } else {
        ErrorClass::SystemError
    }
}
