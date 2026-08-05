//! Transfer control-plane types shared by Studio orchestration and settings.
//!
//! This module deliberately does not depend on preview, streaming, or thumbnail
//! code. It turns a frozen user profile plus prepared artifacts into a safe,
//! deterministic delivery plan.

pub mod album;
pub mod analysis;
pub mod caption;
pub mod download;
pub mod encoder;
pub mod feature_flags;
pub mod oversize;
pub mod preflight;
pub mod profile;
pub mod quality;
pub mod store;

pub use album::*;
pub use analysis::*;
pub use caption::*;
pub use download::*;
pub use encoder::*;
pub use feature_flags::*;
pub use oversize::*;
pub use preflight::*;
pub use profile::*;
pub use quality::*;
pub use store::*;
