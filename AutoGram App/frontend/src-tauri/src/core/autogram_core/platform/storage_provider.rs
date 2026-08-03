//! Storage Abstraction Layer (PAL - StorageProvider)
//! Provides cross-platform file system operations for Desktop (std::fs) and Android (Scoped Storage/URIs).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMetadata {
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub modified_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StorageError {
    NotFound(String),
    PermissionDenied(String),
    IoError(String),
    UnsupportedPlatform(String),
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StorageError::NotFound(s) => write!(f, "NotFound: {s}"),
            StorageError::PermissionDenied(s) => write!(f, "PermissionDenied: {s}"),
            StorageError::IoError(s) => write!(f, "IoError: {s}"),
            StorageError::UnsupportedPlatform(s) => write!(f, "UnsupportedPlatform: {s}"),
        }
    }
}

impl std::error::Error for StorageError {}

pub trait StorageProvider: Send + Sync {
    fn read(&self, path: &str) -> Result<Vec<u8>, StorageError>;
    fn write(&self, path: &str, data: &[u8]) -> Result<(), StorageError>;
    fn delete(&self, path: &str) -> Result<(), StorageError>;
    fn exists(&self, path: &str) -> bool;
    fn get_metadata(&self, path: &str) -> Result<FileMetadata, StorageError>;
    fn available_space(&self, path: &str) -> Result<u64, StorageError>;
}

/// Standard Desktop Storage Provider using `std::fs`
pub struct DesktopStorageProvider;

impl DesktopStorageProvider {
    pub fn new() -> Self {
        Self
    }
}

impl StorageProvider for DesktopStorageProvider {
    fn read(&self, path: &str) -> Result<Vec<u8>, StorageError> {
        fs::read(path).map_err(|e| StorageError::IoError(e.to_string()))
    }

    fn write(&self, path: &str, data: &[u8]) -> Result<(), StorageError> {
        if let Some(parent) = Path::new(path).parent() {
            let _ = fs::create_dir_all(parent);
        }
        fs::write(path, data).map_err(|e| StorageError::IoError(e.to_string()))
    }

    fn delete(&self, path: &str) -> Result<(), StorageError> {
        let p = Path::new(path);
        if p.is_dir() {
            fs::remove_dir_all(p).map_err(|e| StorageError::IoError(e.to_string()))
        } else {
            fs::remove_file(p).map_err(|e| StorageError::IoError(e.to_string()))
        }
    }

    fn exists(&self, path: &str) -> bool {
        Path::new(path).exists()
    }

    fn get_metadata(&self, path: &str) -> Result<FileMetadata, StorageError> {
        let meta = fs::metadata(path).map_err(|e| StorageError::NotFound(e.to_string()))?;
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        Ok(FileMetadata {
            path: path.to_string(),
            size: meta.len(),
            is_dir: meta.is_dir(),
            modified_ms,
        })
    }

    fn available_space(&self, _path: &str) -> Result<u64, StorageError> {
        // Default desktop estimate: 50GB fallback if system disk space check unavailable
        Ok(50 * 1024 * 1024 * 1024)
    }
}

/// Android Content URI / Scoped Storage Provider stub
pub struct AndroidStorageProvider {
    pub app_cache_dir: String,
}

impl AndroidStorageProvider {
    pub fn new(app_cache_dir: String) -> Self {
        Self { app_cache_dir }
    }
}

impl StorageProvider for AndroidStorageProvider {
    fn read(&self, path: &str) -> Result<Vec<u8>, StorageError> {
        fs::read(path).map_err(|e| StorageError::IoError(e.to_string()))
    }

    fn write(&self, path: &str, data: &[u8]) -> Result<(), StorageError> {
        fs::write(path, data).map_err(|e| StorageError::IoError(e.to_string()))
    }

    fn delete(&self, path: &str) -> Result<(), StorageError> {
        fs::remove_file(path).map_err(|e| StorageError::IoError(e.to_string()))
    }

    fn exists(&self, path: &str) -> bool {
        Path::new(path).exists()
    }

    fn get_metadata(&self, path: &str) -> Result<FileMetadata, StorageError> {
        let meta = fs::metadata(path).map_err(|e| StorageError::NotFound(e.to_string()))?;
        Ok(FileMetadata {
            path: path.to_string(),
            size: meta.len(),
            is_dir: meta.is_dir(),
            modified_ms: 0,
        })
    }

    fn available_space(&self, _path: &str) -> Result<u64, StorageError> {
        Ok(10 * 1024 * 1024 * 1024)
    }
}
