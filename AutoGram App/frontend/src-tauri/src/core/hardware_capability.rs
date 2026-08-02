//! Hardware GPU capability detection & priority engine for AutoGram.
//! Probes OS video controllers/CPU and tests FFmpeg hardware encoders (NVENC, AMF, Quick Sync, x264).

use serde::{Deserialize, Serialize};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use super::grammers::ffmpeg::find_ffmpeg_binary;
use super::tg_log;

const BACKEND: &str = "hardware_capability";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuCapability {
    pub name: String,
    pub encoder: String,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuCapability {
    pub vendor: String,
    pub name: String,
    pub r#type: String, // "dedicated" | "integrated"
    pub encoder: String, // "NVENC" | "AMF" | "Quick Sync"
    pub supported: bool,
    pub priority: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareCapabilities {
    pub cpu: CpuCapability,
    pub gpu: Vec<GpuCapability>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectedEncoder {
    pub encoder: String,
    pub device: String,
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

fn query_cpu_name() -> String {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("powershell");
        cmd.args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Name",
        ]);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        if let Ok(output) = cmd.output() {
            let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !text.is_empty() {
                return text;
            }
        }
    }

    std::env::var("PROCESSOR_IDENTIFIER").unwrap_or_else(|_| "Generic CPU".to_string())
}

#[derive(Deserialize)]
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
    let cpu_name = query_cpu_name();
    let raw_gpus = query_gpu_devices();
    let ff_support = probe_ffmpeg_encoders();

    let mut gpu_caps = Vec::new();

    for (name, vendor_hint) in raw_gpus {
        let name_upper = name.to_uppercase();
        let vendor_upper = vendor_hint.to_uppercase();

        if name_upper.contains("NVIDIA") || vendor_upper.contains("NVIDIA") {
            gpu_caps.push(GpuCapability {
                vendor: "NVIDIA".to_string(),
                name: name.clone(),
                r#type: "dedicated".to_string(),
                encoder: "NVENC".to_string(),
                supported: ff_support.has_nvenc,
                priority: 1,
            });
        } else if name_upper.contains("AMD")
            || name_upper.contains("RADEON")
            || vendor_upper.contains("ADVANCED MICRO")
            || vendor_upper.contains("AMD")
        {
            let is_integrated = name_upper.contains("GRAPHICS") && !name_upper.contains("RX");
            gpu_caps.push(GpuCapability {
                vendor: "AMD".to_string(),
                name: name.clone(),
                r#type: if is_integrated { "integrated".to_string() } else { "dedicated".to_string() },
                encoder: "AMF".to_string(),
                supported: ff_support.has_amf,
                priority: 2,
            });
        } else if name_upper.contains("INTEL") || vendor_upper.contains("INTEL") {
            let is_arc = name_upper.contains("ARC");
            gpu_caps.push(GpuCapability {
                vendor: "Intel".to_string(),
                name: name.clone(),
                r#type: if is_arc { "dedicated".to_string() } else { "integrated".to_string() },
                encoder: "Quick Sync".to_string(),
                supported: ff_support.has_qsv,
                priority: 3,
            });
        }
    }

    // Deduplicate GPUs by name if OS reported duplicate entries
    gpu_caps.dedup_by(|a, b| a.name == b.name);

    HardwareCapabilities {
        cpu: CpuCapability {
            name: cpu_name,
            encoder: "x264".to_string(),
            available: ff_support.has_x264,
        },
        gpu: gpu_caps,
    }
}

pub fn select_best_encoder_internal() -> SelectedEncoder {
    let caps = detect_hardware_capabilities();

    // Priority order: 1. NVENC, 2. AMF, 3. Quick Sync, 4. CPU x264
    let mut supported_gpus = caps.gpu.into_iter().filter(|g| g.supported).collect::<Vec<_>>();
    supported_gpus.sort_by_key(|g| g.priority);

    if let Some(best) = supported_gpus.first() {
        SelectedEncoder {
            encoder: best.encoder.clone(),
            device: best.name.clone(),
        }
    } else {
        SelectedEncoder {
            encoder: "x264".to_string(),
            device: caps.cpu.name,
        }
    }
}

#[tauri::command]
pub fn get_hardware_capabilities() -> HardwareCapabilities {
    detect_hardware_capabilities()
}

#[tauri::command]
pub fn select_best_encoder() -> SelectedEncoder {
    select_best_encoder_internal()
}
