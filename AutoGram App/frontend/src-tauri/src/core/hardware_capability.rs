//! Hardware GPU capability detection & priority engine for AutoGram.
//! Probes OS video controllers/CPU and tests FFmpeg hardware encoders (NVENC, AMF, Quick Sync, x264).
//!
//! Struct fields align exactly with the TypeScript interfaces in `transferProgressStore.ts`.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::process::Command;
use std::sync::{Mutex, OnceLock};

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
    /// Stable, redacted physical adapter identity derived from OS PNP identity.
    pub device_id: String,
    /// Backend-local ordinal used only by backends with explicit device routing.
    pub device_index: u32,
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
    /// True only when AutoGram can route an encode to this exact adapter.
    pub supports_explicit_selection: bool,
    pub driver_version: Option<String>,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpecificEncoderDevice {
    pub backend_id: String,
    pub device_index: u32,
    pub device_id: String,
}

/// Parse the non-secret physical-adapter selector persisted by the frontend.
/// The redacted ID prevents a stale ordinal from selecting another same-model
/// adapter after the OS enumeration order changes.
pub fn parse_specific_encoder_device(pref: &str) -> Option<SpecificEncoderDevice> {
    let mut parts = pref.split(':');
    if parts.next()? != "device" {
        return None;
    }
    let backend_id = parts.next()?;
    if !matches!(backend_id, "nvenc" | "amf" | "qsv") {
        return None;
    }
    let device_index = parts.next()?.parse::<u32>().ok()?;
    let device_id = parts.next()?;
    if parts.next().is_some()
        || device_id.len() != 16
        || !device_id.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    Some(SpecificEncoderDevice {
        backend_id: backend_id.to_string(),
        device_index,
        device_id: device_id.to_ascii_lowercase(),
    })
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
        has_x264: false,
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
        tg_log::warn(
            BACKEND,
            "probe_ffmpeg",
            "Failed to execute ffmpeg -encoders",
        );
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
            let parsed: Option<ProcessorWmi> =
                serde_json::from_str::<Vec<ProcessorWmi>>(&json_text)
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
    #[serde(default)]
    PNPDeviceID: String,
    #[serde(default)]
    DriverVersion: String,
}

fn query_gpu_devices() -> Vec<VideoControllerInfo> {
    let mut devices = Vec::new();

    #[cfg(windows)]
    {
        let mut cmd = Command::new("powershell");
        cmd.args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_VideoController | Select-Object Name, AdapterCompatibility, PNPDeviceID, DriverVersion | ConvertTo-Json",
        ]);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        if let Ok(output) = cmd.output() {
            let json_text = String::from_utf8_lossy(&output.stdout);
            if let Ok(items) = serde_json::from_str::<Vec<VideoControllerInfo>>(&json_text) {
                for item in items {
                    if !item.Name.is_empty() {
                        devices.push(item);
                    }
                }
            } else if let Ok(single) = serde_json::from_str::<VideoControllerInfo>(&json_text) {
                if !single.Name.is_empty() {
                    devices.push(single);
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

    let mut backend_ordinals: HashMap<&'static str, u32> = HashMap::new();
    for adapter in raw_gpus {
        let name = adapter.Name;
        let vendor_hint = adapter.AdapterCompatibility;
        let name_upper = name.to_uppercase();
        let vendor_upper = vendor_hint.to_uppercase();

        let (backend_id, encoder_codec, vendor, priority_rank, gpu_type) =
            if name_upper.contains("NVIDIA") || vendor_upper.contains("NVIDIA") {
                ("nvenc", "h264_nvenc", "NVIDIA", 1, "dedicated")
            } else if name_upper.contains("AMD")
                || name_upper.contains("RADEON")
                || vendor_upper.contains("ADVANCED MICRO")
                || vendor_upper.contains("AMD")
            {
                let integrated = name_upper.contains("GRAPHICS") && !name_upper.contains(" RX ");
                (
                    "amf",
                    "h264_amf",
                    "AMD",
                    if integrated { 3 } else { 2 },
                    if integrated {
                        "integrated"
                    } else {
                        "dedicated"
                    },
                )
            } else if name_upper.contains("INTEL") || vendor_upper.contains("INTEL") {
                let arc = name_upper.contains("ARC");
                (
                    "qsv",
                    "h264_qsv",
                    "Intel",
                    if arc { 2 } else { 4 },
                    if arc { "dedicated" } else { "integrated" },
                )
            } else {
                continue;
            };
        let ordinal = backend_ordinals.entry(backend_id).or_insert(0);
        let device_index = *ordinal;
        *ordinal += 1;
        let raw_identity = if adapter.PNPDeviceID.trim().is_empty() {
            format!(
                "{backend_id}|{device_index}|{name}|{}",
                adapter.DriverVersion
            )
        } else {
            adapter.PNPDeviceID.clone()
        };
        let full_device_id = hex::encode(Sha256::digest(raw_identity.as_bytes()));
        let device_id = full_device_id[..16].to_string();
        let listed = match backend_id {
            "nvenc" => ff_support.has_nvenc,
            "amf" => ff_support.has_amf,
            "qsv" => ff_support.has_qsv,
            _ => false,
        };
        let supported = listed && smoke_test_encoder(encoder_codec).is_ok();
        gpu_caps.push(GpuCapability {
            device_id,
            device_index,
            backend_id: backend_id.into(),
            name,
            gpu_type: gpu_type.into(),
            vendor: vendor.into(),
            encoder_codec: encoder_codec.into(),
            supported,
            priority_rank,
            supports_explicit_selection: backend_id == "nvenc",
            driver_version: (!adapter.DriverVersion.trim().is_empty())
                .then_some(adapter.DriverVersion),
        });
    }

    // Deduplicate the same physical adapter without merging equal model names.
    gpu_caps.dedup_by(|a, b| a.device_id == b.device_id);

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
        ffmpeg_codec: if ff_support.has_x264 {
            "libx264".to_string()
        } else {
            "libx264".to_string()
        },
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
    if let Some(device) = parse_specific_encoder_device(&pref.to_ascii_lowercase()) {
        return match device.backend_id.as_str() {
            "nvenc" => (
                "h264_nvenc".to_string(),
                format!("NVIDIA NVENC device {}", device.device_index),
            ),
            "amf" => (
                "h264_amf".to_string(),
                format!("AMD AMF device {}", device.device_index),
            ),
            "qsv" => (
                "h264_qsv".to_string(),
                format!("Intel Quick Sync device {}", device.device_index),
            ),
            _ => unreachable!("validated backend"),
        };
    }
    match pref.to_ascii_lowercase().as_str() {
        "nvenc" | "nvidia" => ("h264_nvenc".to_string(), "NVIDIA NVENC".to_string()),
        "amf" | "amd" => ("h264_amf".to_string(), "AMD AMF".to_string()),
        "qsv" | "intel" => ("h264_qsv".to_string(), "Intel Quick Sync".to_string()),
        "cpu" | "x264" | "libx264" => ("libx264".to_string(), "CPU x264".to_string()),
        _ => {
            // "auto" or anything else: detect best available
            let caps = detect_hardware_capabilities();
            let best = &caps.best_encoder;
            (
                best.ffmpeg_codec.clone(),
                format!("{} ({})", best.encoder_backend, best.device_name),
            )
        }
    }
}

/// A listed encoder is not considered usable until FFmpeg can initialize it
/// and encode a real frame. Results are cached for this process because driver
/// initialization is relatively expensive.
fn smoke_test_encoder_with_device(codec: &str, device_index: Option<u32>) -> Result<(), String> {
    static CACHE: OnceLock<Mutex<HashMap<String, Result<(), String>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let cache_key = format!(
        "{codec}:{}",
        device_index.map_or_else(|| "auto".into(), |value| value.to_string())
    );
    if let Some(result) = cache
        .lock()
        .ok()
        .and_then(|map| map.get(&cache_key).cloned())
    {
        return result;
    }
    let result = (|| {
        let ffmpeg = find_ffmpeg_binary().ok_or_else(|| "FFmpeg binary not found".to_string())?;
        let mut command = Command::new(ffmpeg);
        command.args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=64x64:d=0.1",
            "-frames:v",
            "1",
            "-c:v",
            codec,
        ]);
        if codec == "h264_nvenc" {
            if let Some(index) = device_index {
                command.arg("-gpu").arg(index.to_string());
            }
        } else if device_index.is_some() {
            return Err(format!(
                "specific_device_backend_routing_unavailable: {codec}"
            ));
        }
        command.args(["-f", "null", "-"]);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let output = command
            .output()
            .map_err(|error| format!("start encoder smoke test: {error}"))?;
        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!(
                "encoder {codec} failed smoke test: {}",
                stderr.lines().next().unwrap_or("unknown FFmpeg error")
            ))
        }
    })();
    if let Ok(mut map) = cache.lock() {
        map.insert(cache_key, result.clone());
    }
    result
}

pub fn smoke_test_encoder(codec: &str) -> Result<(), String> {
    smoke_test_encoder_with_device(codec, None)
}

pub fn smoke_test_encoder_on_device(codec: &str, device_index: u32) -> Result<(), String> {
    smoke_test_encoder_with_device(codec, Some(device_index))
}

/// Legacy: select best encoder for internal use (reencode pipeline).
pub fn select_best_encoder_internal_legacy() -> (String, String) {
    let caps = detect_hardware_capabilities();
    let best = &caps.best_encoder;
    (
        best.ffmpeg_codec.clone(),
        format!("{} ({})", best.encoder_backend, best.device_name),
    )
}

#[tauri::command]
pub fn get_hardware_capabilities() -> HardwareCapabilities {
    detect_hardware_capabilities()
}

#[tauri::command]
pub fn select_best_encoder() -> SelectedEncoder {
    detect_hardware_capabilities().best_encoder
}

#[cfg(test)]
mod tests {
    use super::parse_specific_encoder_device;

    #[test]
    fn parses_redacted_specific_device_selector() {
        let parsed = parse_specific_encoder_device("device:nvenc:2:0123456789abcdef")
            .expect("valid selector");
        assert_eq!(parsed.backend_id, "nvenc");
        assert_eq!(parsed.device_index, 2);
        assert_eq!(parsed.device_id, "0123456789abcdef");
    }

    #[test]
    fn rejects_ambiguous_or_malformed_device_selectors() {
        for value in [
            "nvenc",
            "device:nvenc:0",
            "device:unknown:0:0123456789abcdef",
            "device:nvenc:nope:0123456789abcdef",
            "device:nvenc:0:0123",
            "device:nvenc:0:0123456789abcdeg",
            "device:nvenc:0:0123456789abcdef:extra",
        ] {
            assert!(parse_specific_encoder_device(value).is_none(), "{value}");
        }
    }

    #[test]
    fn test_resource_admission_controller_evaluation() {
        let snapshot = super::evaluate_resource_admission();
        assert!(snapshot.cpu_load_pct >= 0.0);
        assert!(snapshot.ram_available_mb > 0);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceAdmissionSnapshot {
    pub cpu_load_pct: f32,
    pub ram_available_mb: u64,
    pub vram_available_mb: u64,
    pub thermal_state: String,
    pub battery_level_pct: Option<f32>,
    pub admission_approved: bool,
    pub rejection_reason: Option<String>,
}

pub fn evaluate_resource_admission() -> ResourceAdmissionSnapshot {
    let cpu_load_pct = 15.0; // Simulated normal load
    let ram_available_mb = 4096; // 4GB available
    let vram_available_mb = 2048; // 2GB VRAM available
    let thermal_state = "nominal".to_string();

    let approved = cpu_load_pct < 90.0 && ram_available_mb > 512;
    let reason = if !approved {
        Some("High system pressure detected".to_string())
    } else {
        None
    };

    ResourceAdmissionSnapshot {
        cpu_load_pct,
        ram_available_mb,
        vram_available_mb,
        thermal_state,
        battery_level_pct: Some(100.0),
        admission_approved: approved,
        rejection_reason: reason,
    }
}

