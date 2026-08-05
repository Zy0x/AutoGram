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
