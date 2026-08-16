//! Platform Abstraction Layer (PAL)

pub mod encoder_provider;
pub mod network_provider;
pub mod resource_provider;
pub mod storage_provider;

pub use encoder_provider::{
    DesktopEncoderProvider, EncoderProvider, EncoderQualityProfile, HardwareCapability,
};
pub use network_provider::{DesktopNetworkProvider, NetworkProvider, NetworkType};
pub use resource_provider::{DesktopResourceProvider, DeviceThermalState, ResourceProvider};
pub use storage_provider::{DesktopStorageProvider, StorageProvider};

use std::path::PathBuf;

pub fn find_ffmpeg_binary() -> Option<PathBuf> {
    if let Ok(path_var) = std::env::var("AUTOGRAM_FFMPEG_PATH") {
        let p = PathBuf::from(path_var);
        if p.is_file() {
            return Some(p);
        }
    }
    which_tool("ffmpeg")
}

pub fn find_ffprobe_binary() -> Option<PathBuf> {
    if let Ok(path_var) = std::env::var("AUTOGRAM_FFPROBE_PATH") {
        let p = PathBuf::from(path_var);
        if p.is_file() {
            return Some(p);
        }
    }
    which_tool("ffprobe")
}

fn which_tool(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let full = if cfg!(windows) {
            dir.join(format!("{name}.exe"))
        } else {
            dir.join(name)
        };
        if full.is_file() {
            return Some(full);
        }
    }
    None
}
