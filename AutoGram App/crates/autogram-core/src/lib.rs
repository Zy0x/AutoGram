//! AutoGram Core Engine (`autogram-core`)
//! Production Reliability & Platform-Independent Core Engine (v2.8.0 Hardened Edition).

pub mod engine;
pub mod execution;
pub mod hardware;
pub mod intelligence;
pub mod network;
pub mod platform;
pub mod reliability;
pub mod storage;
pub mod telegram;
pub mod transfer;

// Re-export common public domain types
pub use engine::*;
pub use execution::*;
pub use hardware::*;
pub use intelligence::*;
pub use network::*;
pub use platform::*;
pub use reliability::*;
pub use storage::*;
pub use telegram::*;
pub use transfer::*;
