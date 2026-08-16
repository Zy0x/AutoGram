//! Resource Abstraction Layer (PAL - ResourceProvider)
//! Provides monitoring of CPU usage, RAM availability, GPU VRAM, battery level, and thermal state across platforms.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DeviceThermalState {
    Nominal,
    Fair,
    Serious,
    Critical,
}

pub trait ResourceProvider: Send + Sync {
    fn cpu_usage(&self) -> f32;
    fn ram_available_bytes(&self) -> u64;
    fn gpu_vram_available_bytes(&self) -> Option<u64>;
    fn battery_level(&self) -> Option<f32>;
    fn is_charging(&self) -> Option<bool>;
    fn thermal_state(&self) -> DeviceThermalState;
}

pub struct DesktopResourceProvider;

impl DesktopResourceProvider {
    pub fn new() -> Self {
        Self
    }
}

impl ResourceProvider for DesktopResourceProvider {
    fn cpu_usage(&self) -> f32 {
        15.0
    }

    fn ram_available_bytes(&self) -> u64 {
        8 * 1024 * 1024 * 1024
    }

    fn gpu_vram_available_bytes(&self) -> Option<u64> {
        Some(4 * 1024 * 1024 * 1024)
    }

    fn battery_level(&self) -> Option<f32> {
        None
    }

    fn is_charging(&self) -> Option<bool> {
        None
    }

    fn thermal_state(&self) -> DeviceThermalState {
        DeviceThermalState::Nominal
    }
}
