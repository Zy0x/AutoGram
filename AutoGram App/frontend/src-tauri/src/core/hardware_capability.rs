//! Hardware GPU capability detection & priority engine for AutoGram.
//! Probes OS video controllers/CPU and tests FFmpeg hardware encoders (NVENC, AMF, Quick Sync, x264).
//!
//! Struct fields align exactly with the TypeScript interfaces in `transferProgressStore.ts`.

use serde::{Deserialize, Serialize};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use super::grammers::ffmpeg::find_ffmpeg_binary;
use super::tg_log;

const BACKEND: &str = "hardware_capability";

/// CPU capability info — field names match TypeScript `HardwareCpu` interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuCapability {
    /// Full CPU name from OS (e.g. "Intel Core i7-10750H @ 2.60GHz")
    pub processor_name: String,
    /// Physical cores count
    pub cores: u32,
    /// Logical thread count
    pub threads: u32,
    /// True when libx264 is available in FFmpeg
    pub x264_supported: bool,
}

/// GPU capability info — field names match TypeScript `HardwareGpu` interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuCapability {
    /// Short backend identifier: "nvenc" | "amf" | "qsv"
    pub backend_id: String,
    /// Full GPU name from OS (e.g. "NVIDIA GeForce RTX 3070")
    pub name: String,
    /// GPU type: "dedicated" | "integrated"
    pub gpu_type: String,
    /// Vendor name: "NVIDIA" | "AMD" | "Intel"
    pub vendor: String,
    /// FFmpeg encoder codec name (e.g. "h264_nvenc")
    pub encoder_codec: String,
    /// True when this GPU encoder was successfully verified in FFmpeg
    pub supported: bool,
    /// Priority rank: 1=best (NVENC), 2=AMF, 3=QSV, 99=CPU
    pub priority_rank: u32,
}

/// Best selected encoder — field names match TypeScript `SelectedEncoder` interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectedEncoder {
    /// Short backend name: "NVENC" | "AMF" | "Quick Sync" | "x264"
    pub encoder_backend: String,
    /// FFmpeg codec string: "h264_nvenc" | "h264_amf" | "h264_qsv" | "libx264"
    pub ffmpeg_codec: String,
    /// Device display name (GPU name or CPU name)
    pub device_name: String,
    /// Priority rank (1=best)
    pub priority_rank: u32,
}

/// Combined hardware capabilities — field names match TypeScript `HardwareCapabilities` interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareCapabilities {
    pub cpu: CpuCapability,
    pub gpu: Vec<GpuCapability>,
    /// Best available encoder based on supported GPUs + priority
    pub best_encoder: SelectedEncoder,
}

#[derive(Debug, Clone, Default)]
struct FfmpegEncoderSupport {
    has_nvenc: bool,
    has_amf: bool,
    has_qsv: bool,
    has_x264: bool,
}

fn probe_ffmpeg_encoders() -> FfmpegEncoderSupport {
    let mut support = FfmpegEncoderSupport {
        has_nvenc: false,
        has_amf: false,
        has_qsv: false,
        has_x264: true, // Default software x264 always assumed available
    };

    let Some(ff_path) = find_ffmpeg_binary() else {
        tg_log::warn(BACKEND, "probe_ffmpeg", "FFmpeg binary not found");
        return support;
    };

    let mut cmd = Command::new(&ff_path);
    cmd.arg("-hide_banner").arg("-encoders");

    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let Ok(output) = cmd.output() else {
        tg_log::warn(BACKEND, "probe_ffmpeg", "Failed to execute ffmpeg -encoders");
        return support;
    };

    let text = String::from_utf8_lossy(&output.stdout);
    support.has_nvenc = text.contains("h264_nvenc") || text.contains("hevc_nvenc");
    support.has_amf = text.contains("h264_amf") || text.contains("hevc_amf");
    support.has_qsv = text.contains("h264_qsv") || text.contains("hevc_qsv");
    support.has_x264 = text.contains("libx264") || text.contains("x264");

    tg_log::info(
        BACKEND,
        "ffmpeg_encoders_probed",
        format!(
            "nvenc={} amf={} qsv={} x264={}",
            support.has_nvenc, support.has_amf, support.has_qsv, support.has_x264
        ),
    );

    support
}

#[derive(Deserialize)]
#[allow(non_snake_case)]
struct ProcessorWmi {
    #[serde(default)]
    Name: String,
    #[serde(default)]
    NumberOfCores: Option<u32>,
    #[serde(default)]
    NumberOfLogicalProcessors: Option<u32>,
}

fn query_cpu_info() -> (String, u32, u32) {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("powershell");
        cmd.args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors | ConvertTo-Json",
        ]);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        if let Ok(output) = cmd.output() {
            let json_text = String::from_utf8_lossy(&output.stdout);
            // Handle both array and single object
            let parsed: Option<ProcessorWmi> = serde_json::from_str::<Vec<ProcessorWmi>>(&json_text)
                .ok()
                .and_then(|v| v.into_iter().next())
                .or_else(|| serde_json::from_str::<ProcessorWmi>(&json_text).ok());

            if let Some(p) = parsed {
                if !p.Name.is_empty() {
                    return (
                        p.Name.trim().to_string(),
                        p.NumberOfCores.unwrap_or(1),
                        p.NumberOfLogicalProcessors.unwrap_or(1),
                    );
                }
            }
        }
    }

    let name = std::env::var("PROCESSOR_IDENTIFIER").unwrap_or_else(|_| "Generic CPU".to_string());
    (name, 1, 1)
}

#[derive(Deserialize)]
#[allow(non_snake_case)]
struct VideoControllerInfo {
    #[serde(default)]
    Name: String,
    #[serde(default)]
    AdapterCompatibility: String,
}

fn query_gpu_devices() -> Vec<(String, String)> {
    let mut devices = Vec::new();

    #[cfg(windows)]
    {
        let mut cmd = Command::new("powershell");
        cmd.args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_VideoController | Select-Object Name, AdapterCompatibility | ConvertTo-Json",
        ]);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        if let Ok(output) = cmd.output() {
            let json_text = String::from_utf8_lossy(&output.stdout);
            if let Ok(items) = serde_json::from_str::<Vec<VideoControllerInfo>>(&json_text) {
                for item in items {
                    if !item.Name.is_empty() {
                        devices.push((item.Name, item.AdapterCompatibility));
                    }
                }
            } else if let Ok(single) = serde_json::from_str::<VideoControllerInfo>(&json_text) {
                if !single.Name.is_empty() {
                    devices.push((single.Name, single.AdapterCompatibility));
                }
            }
        }
    }

    devices
}

pub fn detect_hardware_capabilities() -> HardwareCapabilities {
    let (cpu_name, cores, threads) = query_cpu_info();
    let raw_gpus = query_gpu_devices();
    let ff_support = probe_ffmpeg_encoders();

    let mut gpu_caps: Vec<GpuCapability> = Vec::new();

    for (name, vendor_hint) in raw_gpus {
        let name_upper = name.to_uppercase();
        let vendor_upper = vendor_hint.to_uppercase();

        if name_upper.contains("NVIDIA") || vendor_upper.contains("NVIDIA") {
            gpu_caps.push(GpuCapability {
                backend_id: "nvenc".to_string(),
                name: name.clone(),
                gpu_type: "dedicated".to_string(),
                vendor: "NVIDIA".to_string(),
                encoder_codec: "h264_nvenc".to_string(),
                supported: ff_support.has_nvenc,
                priority_rank: 1,
            });
        } else if name_upper.contains("AMD")
            || name_upper.contains("RADEON")
            || vendor_upper.contains("ADVANCED MICRO")
            || vendor_upper.contains("AMD")
        {
            let is_integrated = name_upper.contains("GRAPHICS") && !name_upper.contains(" RX ");
            gpu_caps.push(GpuCapability {
                backend_id: "amf".to_string(),
                name: name.clone(),
                gpu_type: if is_integrated { "integrated".to_string() } else { "dedicated".to_string() },
                vendor: "AMD".to_string(),
                encoder_codec: "h264_amf".to_string(),
                supported: ff_support.has_amf,
                priority_rank: if is_integrated { 3 } else { 2 },
            });
        } else if name_upper.contains("INTEL") || vendor_upper.contains("INTEL") {
            let is_arc = name_upper.contains("ARC");
            gpu_caps.push(GpuCapability {
                backend_id: "qsv".to_string(),
                name: name.clone(),
                gpu_type: if is_arc { "dedicated".to_string() } else { "integrated".to_string() },
                vendor: "Intel".to_string(),
                encoder_codec: "h264_qsv".to_string(),
                supported: ff_support.has_qsv,
                priority_rank: if is_arc { 2 } else { 4 },
            });
        }
    }

    // Deduplicate GPUs by name
    gpu_caps.dedup_by(|a, b| a.name == b.name);

    // Sort by priority rank
    gpu_caps.sort_by_key(|g| g.priority_rank);

    let best_encoder = compute_best_encoder(&gpu_caps, &cpu_name, &ff_support);

    HardwareCapabilities {
        cpu: CpuCapability {
            processor_name: cpu_name,
            cores,
            threads,
            x264_supported: ff_support.has_x264,
        },
        gpu: gpu_caps,
        best_encoder,
    }
}

fn compute_best_encoder(
    gpus: &[GpuCapability],
    cpu_name: &str,
    ff_support: &FfmpegEncoderSupport,
) -> SelectedEncoder {
    // Find best supported GPU ordered by priority
    let mut supported: Vec<&GpuCapability> = gpus.iter().filter(|g| g.supported).collect();
    supported.sort_by_key(|g| g.priority_rank);

    if let Some(best) = supported.first() {
        let encoder_backend = match best.backend_id.as_str() {
            "nvenc" => "NVENC",
            "amf" => "AMF",
            "qsv" => "Quick Sync",
            _ => "GPU",
        };
        return SelectedEncoder {
            encoder_backend: encoder_backend.to_string(),
            ffmpeg_codec: best.encoder_codec.clone(),
            device_name: best.name.clone(),
            priority_rank: best.priority_rank,
        };
    }

    // Fallback to CPU x264
    SelectedEncoder {
        encoder_backend: "x264".to_string(),
        ffmpeg_codec: if ff_support.has_x264 { "libx264".to_string() } else { "libx264".to_string() },
        device_name: cpu_name.to_string(),
        priority_rank: 99,
    }
}

/// Resolve the best encoder codec string from a user-specified hardware preference.
/// `pref` matches the `reencodeHardware` values from Transfer Settings UI:
///   - "auto" → auto-detect best
///   - "nvenc" → NVIDIA NVENC (h264_nvenc)
///   - "amf" → AMD AMF (h264_amf)
///   - "qsv" → Intel Quick Sync (h264_qsv)
///   - "cpu" → CPU x264 (libx264)
/// Returns (ffmpeg_codec, encoder_display_name).
pub fn resolve_encoder_from_preference(pref: &str) -> (String, String) {
    match pref.to_ascii_lowercase().as_str() {
        "nvenc" | "nvidia" => ("h264_nvenc".to_string(), "NVIDIA NVENC".to_string()),
        "amf" | "amd" => ("h264_amf".to_string(), "AMD AMF".to_string()),
        "qsv" | "intel" => ("h264_qsv".to_string(), "Intel Quick Sync".to_string()),
        "cpu" | "x264" | "libx264" => ("libx264".to_string(), "CPU x264".to_string()),
        _ => {
            // "auto" or anything else: detect best available
            let caps = detect_hardware_capabilities();
            let best = &caps.best_encoder;
            (best.ffmpeg_codec.clone(), format!("{} ({})", best.encoder_backend, best.device_name))
        }
    }
}

/// Legacy: select best encoder for internal use (reencode pipeline).
pub fn select_best_encoder_internal_legacy() -> (String, String) {
    let caps = detect_hardware_capabilities();
    let best = &caps.best_encoder;
    (best.ffmpeg_codec.clone(), format!("{} ({})", best.encoder_backend, best.device_name))
}

#[tauri::command]
pub fn get_hardware_capabilities() -> HardwareCapabilities {
    detect_hardware_capabilities()
}

#[tauri::command]
pub fn select_best_encoder() -> SelectedEncoder {
    detect_hardware_capabilities().best_encoder
}
