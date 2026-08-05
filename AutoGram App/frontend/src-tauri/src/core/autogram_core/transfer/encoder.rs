use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EncoderStrategy {
    AutoAdaptive,
    HardwarePreferred,
    SoftwarePreferred,
    HardwareOnly,
    SoftwareOnly,
    SpecificDevice,
    DisableReencode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EncoderResourceProfile {
    Eco,
    Balanced,
    Performance,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncoderPolicy {
    pub strategy: EncoderStrategy,
    pub resource_profile: EncoderResourceProfile,
    pub specific_device: Option<String>,
    pub max_parallel_encodes: usize,
    pub max_cpu_percent: u8,
    pub max_memory_mb: u32,
    pub allow_software_fallback: bool,
}

impl Default for EncoderPolicy {
    fn default() -> Self {
        Self {
            strategy: EncoderStrategy::AutoAdaptive,
            resource_profile: EncoderResourceProfile::Balanced,
            specific_device: None,
            max_parallel_encodes: 1,
            max_cpu_percent: 75,
            max_memory_mb: 2048,
            allow_software_fallback: true,
        }
    }
}
