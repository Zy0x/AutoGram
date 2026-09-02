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
    which_tool("ffmpeg").or_else(|| bundled_tool("ffmpeg"))
}

pub fn find_ffprobe_binary() -> Option<PathBuf> {
    if let Ok(path_var) = std::env::var("AUTOGRAM_FFPROBE_PATH") {
        let p = PathBuf::from(path_var);
        if p.is_file() {
            return Some(p);
        }
    }
    which_tool("ffprobe").or_else(|| bundled_tool("ffprobe"))
}

/// Resolve the ffmpeg-extractor plugin shipped with the desktop app. The
/// shared core cannot depend on the Tauri-specific resolver, so it checks a
/// bounded set of paths relative to the working directory and executable.
/// This keeps media probing available in packaged/dev builds even when the
/// plugin directory is not on PATH.
fn bundled_tool(name: &str) -> Option<PathBuf> {
    let filename = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    let sub_paths = [
        "plugins/ffmpeg-extractor/bin",
        "AutoGram App/plugins/ffmpeg-extractor/bin",
        "../plugins/ffmpeg-extractor/bin",
        "../../plugins/ffmpeg-extractor/bin",
    ];
    let mut roots = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        let mut current = Some(cwd.as_path());
        while let Some(dir) = current {
            roots.push(dir.to_path_buf());
            current = dir.parent();
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut current = exe.parent();
        while let Some(dir) = current {
            roots.push(dir.to_path_buf());
            current = dir.parent();
        }
    }
    for root in roots {
        // Development workspaces commonly keep the ffmpeg bundle under a
        // versioned `.toolchains/ffmpeg-release-essentials` directory.  Walk
        // only that bounded directory (never the whole workspace) so media
        // probing remains available even when ffprobe is not on PATH.
        let toolchain_root = root.join(".toolchains").join("ffmpeg-release-essentials");
        if let Ok(entries) = std::fs::read_dir(&toolchain_root) {
            for entry in entries.flatten() {
                let candidate = entry.path().join("bin").join(&filename);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
        for sub_path in sub_paths {
            let candidate = root.join(sub_path).join(&filename);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
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
