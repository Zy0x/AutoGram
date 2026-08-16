//! Hardware & Resource Management

pub mod encoder_detector;
pub mod hardware_capability;
pub mod resource_scheduler;

pub use encoder_detector::HardwareEncoderType;
pub use hardware_capability::{select_best_hardware_profile, HardwareProfileInfo};
pub use resource_scheduler::{ResourceBudget, ResourceScheduler};
